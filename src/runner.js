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

  if (!conf.quiet) console.log(`▶ Audit Cypress de ${conf.urls.length} page(s)${conf.parcours?.length ? ` et ${conf.parcours.length} parcours` : ''} …`);

  // Identifiants SSO transmis par l'environnement hérité (préfixe CYPRESS_), pas en argument de ligne de commande
  if (conf.login) {
    process.env.CYPRESS_RGAA_LOGIN_USER = process.env.RGAA_LOGIN_USER;
    process.env.CYPRESS_RGAA_LOGIN_PASSWORD = process.env.RGAA_LOGIN_PASSWORD;
  }

  const run = await cypress.run({
    project: PKG_ROOT,
    browser: 'electron',
    quiet: conf.quiet,
    config: {
      viewportWidth: conf.viewportSize.width,
      viewportHeight: conf.viewportSize.height,
      pageLoadTimeout: conf.timeout,
      // Une page qui échoue (SSO lent, SPA non rendue…) est rejouée une fois avant d'être déclarée inaccessible
      retries: { runMode: 1, openMode: 0 },
      video: false,
      // RGAA_DEBUG=1 : capture d'écran du navigateur à chaque échec (diagnostic SSO, SPA…)
      screenshotOnRunFailure: !!process.env.RGAA_DEBUG,
      screenshotsFolder: join(outputDir, 'captures-echecs')
    },
    env: {
      rgaa: {
        urls: conf.urls,
        ignoreRules: conf.ignoreRules,
        httpHeaders: conf.httpHeaders,
        basicAuth: conf.basicAuth,
        login: conf.login,
        waitAfterLoad: conf.waitAfterLoad,
        interactions: conf.interactions !== false,
        parcours: conf.parcours ?? [],
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

  // URLs / parcours sans résultat = test Cypress en échec (page inaccessible, étape introuvable…)
  const analyzed = new Set(pages.filter((p) => !p.parcours).map((p) => p.url));
  const parcoursDone = new Set(pages.filter((p) => p.parcours).map((p) => p.parcours));
  const errors = [
    ...conf.urls.filter((u) => !analyzed.has(u)).map((url) => ({ url, error: 'analyse impossible (voir la sortie Cypress)' })),
    ...(conf.parcours ?? []).filter((pc) => !parcoursDone.has(pc.nom)).map((pc) => ({ url: pc.url, parcours: pc.nom, error: 'parcours interrompu (voir la sortie Cypress)' }))
  ];
  for (const e of errors) console.error(`  ✖ Impossible d'analyser ${e.parcours ? `le parcours « ${e.parcours} » (${e.url})` : e.url}`);

  if (!conf.quiet) {
    for (const p of pages) {
      const apresInteraction = p.violations.filter((v) => v.state).reduce((s, v) => s + v.nodeCount, 0);
      const detail = apresInteraction ? `, dont ${apresInteraction} révélée(s) par interaction` : '';
      const label = p.parcours ? `parcours « ${p.parcours} » (${p.url})` : p.url;
      console.log(`  ${label} : ${p.violations.length} règle(s) en échec (${p.violations.reduce((s, v) => s + v.nodeCount, 0)} occurrence(s)${detail})`);
      if (p.interactions?.aborted) console.log(`    ⚠ scénarios d'interaction interrompus : ${p.interactions.aborted}`);
    }
  }

  // Tests inter-pages (12.1, 12.2) — signalements « à vérifier », jamais bloquants
  const siteFindings = runCrossPageChecks(pages.filter((p) => !p.parcours));

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
      interactions: conf.interactions !== false,
      ai: !!conf.ai?.enabled
    },
    coverage: coveredCriteria({ ai: !!conf.ai?.enabled }),
    totals: {
      pages: pages.filter((p) => !p.parcours).length,
      parcours: pages.filter((p) => p.parcours).length,
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
    const nbParcours = pages.filter((p) => p.parcours).length;
    console.log(`Pages analysées : ${pages.length - nbParcours}${nbParcours ? ` + ${nbParcours} parcours` : ''} (erreurs : ${errors.length})`);
    console.log(`Occurrences par sévérité : critique=${bySeverity.critical} sérieuse=${bySeverity.serious} modérée=${bySeverity.moderate} mineure=${bySeverity.minor}`);
    console.log(`Signalements « à vérifier » (heuristiques${conf.ai?.enabled ? ' + IA' : ''}) : ${findingsCount} — non bloquants`);
    console.log(`Couverture : ${summary.coverage.auto.length} critère(s) testé(s) automatiquement + ${summary.coverage.review.length} signalé(s) à vérifier, sur ${summary.coverage.total}`);
    if (aiUsage?.calls) {
      const cout = aiUsage.estimatedCostUsd == null ? '' : `, coût estimé ≈ ${aiUsage.estimatedCostUsd.toFixed(3)} $`;
      console.log(`Consommation IA : ${aiUsage.calls} appel(s), ${aiUsage.inputTokens} tokens en entrée + ${aiUsage.outputTokens} en sortie (${aiUsage.model}${cout})`);
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
