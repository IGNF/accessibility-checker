import cypress from 'cypress';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHtmlReport } from './report.js';
import { runCrossPageChecks } from './cross-page-checks.js';
import { runAiChecks } from './ai-checker.js';
import { coveredCriteria } from './rgaa-mapping.js';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SEVERITY_ORDER = ['minor', 'moderate', 'serious', 'critical'];

/** true si `impact` atteint ou dépasse le seuil `failOn`. */
function reachesThreshold(impact, failOn) {
  if (failOn === 'any') return true;
  return SEVERITY_ORDER.indexOf(impact) >= SEVERITY_ORDER.indexOf(failOn);
}

export async function runAudit(conf) {
  const outputDir = resolve(conf.output);
  mkdirSync(outputDir, { recursive: true });

  // Les résultats sont échangés avec le processus Cypress via un fichier NDJSON
  const resultsFile = join(outputDir, '.rgaa-results.ndjson');
  rmSync(resultsFile, { force: true });

  if (!conf.quiet) console.log(`▶ Audit Cypress de ${conf.urls.length} page(s) …`);

  const run = await cypress.run({
    project: PKG_ROOT,
    browser: 'electron',
    quiet: conf.quiet,
    config: {
      viewportWidth: conf.viewportSize.width,
      viewportHeight: conf.viewportSize.height,
      pageLoadTimeout: conf.timeout,
      video: false,
      screenshotOnRunFailure: false
    },
    env: {
      rgaa: {
        urls: conf.urls,
        ignoreRules: conf.ignoreRules,
        httpHeaders: conf.httpHeaders,
        basicAuth: conf.basicAuth,
        waitAfterLoad: conf.waitAfterLoad,
        ai: conf.ai?.enabled ? { maxItemsPerPage: conf.ai.maxItemsPerPage } : null,
        resultsFile
      }
    }
  });

  if (run.status === 'failed' && run.failures) {
    throw new Error(`Cypress n'a pas pu s'exécuter : ${run.message}`);
  }

  const pages = existsSync(resultsFile)
    ? readFileSync(resultsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  rmSync(resultsFile, { force: true });

  // URLs sans résultat = test Cypress en échec (page inaccessible, etc.)
  const analyzed = new Set(pages.map((p) => p.url));
  const errors = conf.urls
    .filter((u) => !analyzed.has(u))
    .map((url) => ({ url, error: "analyse impossible (voir la sortie Cypress)" }));
  for (const e of errors) console.error(`  ✖ Impossible d'analyser ${e.url}`);

  if (!conf.quiet) {
    for (const p of pages) {
      console.log(`  ${p.url} : ${p.violations.length} règle(s) en échec (${p.violations.reduce((s, v) => s + v.nodeCount, 0)} occurrence(s))`);
    }
  }

  // Tests inter-pages (12.1, 12.2) — signalements « à vérifier », jamais bloquants
  const siteFindings = runCrossPageChecks(pages);

  // Tier IA « à vérifier » (option --ai) — jamais bloquant
  let aiUsage = null;
  if (conf.ai?.enabled && pages.length) {
    if (!conf.quiet) console.log('▶ Analyse IA des critères de jugement (signalements « à vérifier ») …');
    aiUsage = await runAiChecks(pages, conf);
  } else {
    for (const p of pages) delete p.aiExtracts;
  }

  const findingsCount = pages.reduce((s, p) => s + (p.findings?.length ?? 0), 0) + siteFindings.length;

  // Comptage des violations au-dessus du seuil
  let failingCount = 0;
  const bySeverity = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const p of pages) {
    for (const v of p.violations) {
      bySeverity[v.impact] = (bySeverity[v.impact] ?? 0) + v.nodeCount;
      if (reachesThreshold(v.impact, conf.failOn)) failingCount += v.nodeCount;
    }
  }

  const summary = {
    tool: 'rgaa-ci',
    referential: 'RGAA 4.1 (critères automatisables via axe-core/Cypress)',
    date: new Date().toISOString(),
    config: {
      failOn: conf.failOn,
      maxViolations: conf.maxViolations,
      viewport: conf.viewport,
      ignoreRules: conf.ignoreRules,
      ai: !!conf.ai?.enabled
    },
    coverage: coveredCriteria({ ai: !!conf.ai?.enabled }),
    totals: {
      pages: pages.length,
      pageErrors: errors.length,
      violationsBySeverity: bySeverity,
      violationsAboveThreshold: failingCount,
      findings: findingsCount
    },
    aiUsage,
    pages,
    siteFindings,
    errors
  };

  // Rapport JSON (exploitable en CI)
  const jsonPath = join(outputDir, 'rgaa-report.json');
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

  // Rapport HTML lisible
  if (conf.html) {
    const htmlPath = join(outputDir, 'rgaa-report.html');
    writeFileSync(htmlPath, buildHtmlReport(summary), 'utf8');
  }

  // Résumé console
  if (!conf.quiet) {
    console.log('\n════════ Résumé RGAA ════════');
    console.log(`Pages analysées : ${pages.length} (erreurs : ${errors.length})`);
    console.log(`Occurrences par sévérité : critique=${bySeverity.critical} sérieuse=${bySeverity.serious} modérée=${bySeverity.moderate} mineure=${bySeverity.minor}`);
    console.log(`Signalements « à vérifier » (heuristiques${conf.ai?.enabled ? ' + IA' : ''}) : ${findingsCount} — non bloquants`);
    console.log(`Couverture : ${summary.coverage.auto.length} critère(s) testé(s) automatiquement + ${summary.coverage.review.length} signalé(s) à vérifier, sur ${summary.coverage.total}`);
    if (aiUsage?.calls) {
      console.log(`Consommation IA : ${aiUsage.calls} appel(s), ${aiUsage.inputTokens} tokens en entrée + ${aiUsage.outputTokens} en sortie (${aiUsage.model})`);
    }
    console.log(`Seuil d'échec : ${conf.failOn} (tolérance : ${conf.maxViolations})`);
    console.log(`Rapports : ${jsonPath}${conf.html ? ` et ${join(outputDir, 'rgaa-report.html')}` : ''}`);
  }

  let exitCode = 0;
  if (errors.length && !pages.length) {
    exitCode = 2;
  } else if (failingCount > conf.maxViolations) {
    console.error(`\n✖ ÉCHEC : ${failingCount} occurrence(s) de niveau "${conf.failOn}" ou plus (tolérance : ${conf.maxViolations}).`);
    exitCode = 1;
  } else if (!conf.quiet) {
    console.log('\n✔ SUCCÈS : aucun dépassement du seuil.');
  }

  return { exitCode, summary };
}
