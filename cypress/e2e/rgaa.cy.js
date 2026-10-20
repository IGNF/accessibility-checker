/**
 * Spec Cypress : audite chaque URL avec axe-core (locale fr), exécute les
 * vérifications maison (doctype, reflow 320 px…) et mappe les violations vers
 * les critères RGAA 4.1. Collecte aussi des signalements heuristiques « à
 * vérifier », les caractéristiques de page (tests inter-pages) et, si --ai est
 * actif, les extraits soumis au tier IA. Les résultats sont remontés au
 * processus Node via cy.task ; le seuil d'échec est appliqué par la CLI.
 */
import { mapRule, BEST_PRACTICE_RULES } from '../../src/rgaa-mapping.js';
import {
  runCustomChecks,
  checkReflow,
  collectFindings,
  collectPageFeatures,
  collectAiExtracts
} from '../../src/custom-checks.js';
import frLocale from 'axe-core/locales/fr.json';

const conf = Cypress.env('rgaa');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: {
    // Règles « best practice » rendues normatives par le RGAA (9.1, 9.2, 12.6)
    ...Object.fromEntries(BEST_PRACTICE_RULES.map((r) => [r, { enabled: true }])),
    ...Object.fromEntries((conf.ignoreRules ?? []).map((r) => [r, { enabled: false }]))
  }
};

/** Convertit une violation (axe ou vérification maison) au format du rapport. */
function toViolation(v) {
  const { rgaa, theme } = mapRule(v.id);
  return {
    rule: v.id,
    impact: v.impact ?? 'minor',
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    rgaaCriteria: rgaa,
    rgaaTheme: theme,
    nodes: v.nodes.slice(0, 20).map((n) => ({
      target: n.target.join(' '),
      html: n.html.slice(0, 300),
      failureSummary: n.failureSummary
    })),
    nodeCount: v.nodes.length
  };
}

describe('Audit RGAA (critères automatisables)', () => {
  conf.urls.forEach((url) => {
    it(`analyse ${url}`, () => {
      // Neutralise la CSP (en-tête et balise meta) qui bloquerait l'injection d'axe-core
      cy.intercept({ resourceType: 'document' }, (req) => {
        req.continue((res) => {
          delete res.headers['content-security-policy'];
          delete res.headers['content-security-policy-report-only'];
          if (typeof res.body === 'string') {
            res.body = res.body.replace(
              /<meta[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi,
              ''
            );
          }
        });
      });

      cy.visit(url, {
        headers: conf.httpHeaders ?? {},
        auth: conf.basicAuth ?? undefined,
        failOnStatusCode: false
      });

      // Attend le rendu effectif (SPA) : le DOM doit contenir un contenu significatif
      // (un shell SPA non rendu n'a ni éléments nombreux ni texte)
      cy.get('body', { timeout: 30000 }).should(($b) => {
        const significatif = $b.find('*').length > 10 || $b.text().trim().length > 0;
        expect(significatif, 'contenu significatif dans <body>').to.be.true;
      });
      if (conf.waitAfterLoad) cy.wait(conf.waitAfterLoad);

      cy.injectAxe();
      cy.configureAxe({ locale: frLocale });

      const page = {
        url,
        timestamp: new Date().toISOString(),
        passesCount: 0,
        incompleteCount: 0,
        violations: [],
        findings: [],
        pageFeatures: null,
        aiExtracts: null
      };

      cy.window({ log: false })
        .then({ timeout: 120000 }, (win) => win.axe.run(win.document, AXE_OPTIONS))
        .then((results) => {
          page.passesCount = results.passes.length;
          page.incompleteCount = results.incomplete.length;
          page.violations = results.violations.map(toViolation);
        });

      // Vérifications maison, signalements heuristiques et collectes complémentaires
      cy.window({ log: false }).then((win) => {
        page.violations.push(...runCustomChecks(win).map(toViolation));
        page.findings.push(...collectFindings(win));
        page.pageFeatures = collectPageFeatures(win);
        if (conf.ai) page.aiExtracts = collectAiExtracts(win, conf.ai.maxItemsPerPage);
      });

      // RGAA 10.11 : absence de défilement horizontal à 320 px de large
      cy.viewport(320, 660);
      cy.wait(300); // laisse le relayout et les media queries s'appliquer
      cy.window({ log: false }).then((win) => {
        const r = checkReflow(win);
        if (r?.violation) page.violations.push(toViolation(r.violation));
        else if (r?.finding) page.findings.push(r.finding);
      });

      cy.then(() => {
        cy.task('rgaaResult', page);
        cy.log(`${page.violations.length} règle(s) en échec, ${page.findings.length} signalement(s) à vérifier`);
      });
    });
  });
});
