/**
 * Spec Cypress : audite chaque URL avec axe-core (locale fr), exécute les
 * vérifications maison (doctype, reflow 320 px…) et mappe les violations vers
 * les critères RGAA 4.1. Collecte aussi des signalements heuristiques « à
 * vérifier », les caractéristiques de page (tests inter-pages) et, si --ai est
 * actif, les extraits soumis au tier IA. Sauf --no-interactions, la page est
 * ensuite réanalysée après ouverture des contenus dépliables, de chaque modale
 * et du menu à 320 px (src/interactions.js). Les résultats sont remontés au
 * processus Node via cy.task ; le seuil d'échec est appliqué par la CLI.
 */
import { mapRule, BEST_PRACTICE_RULES, AXE_REVIEW_RULES, AXE_INCOMPLETE_RULES, AXE_EXPERIMENTAL_RULES } from '../../src/rgaa-mapping.js';
import {
  runCustomChecks,
  checkReflow,
  collectFindings,
  collectPageFeatures,
  collectAiExtracts
} from '../../src/custom-checks.js';
import { findTriggers, describeTrigger, closeDialogs, violationKeys, newViolations } from '../../src/interactions.js';
import frLocale from 'axe-core/locales/fr.json';

const conf = Cypress.env('rgaa');
const SETTLE_MS = 500; // laisse les transitions d'ouverture/fermeture se terminer

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  rules: {
    // Règles « best practice » rendues normatives par le RGAA (9.1, 9.2, 12.6)
    ...Object.fromEntries(BEST_PRACTICE_RULES.map((r) => [r, { enabled: true }])),
    // Règles expérimentales : activées, mais routées vers les signalements « à vérifier »
    ...Object.fromEntries(Object.keys(AXE_EXPERIMENTAL_RULES).map((r) => [r, { enabled: true }])),
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

/**
 * Verse les résultats d'une exécution axe dans `page`. `seen` (empreintes des
 * occurrences déjà rapportées) permet de n'ajouter que les nouveautés révélées
 * par une interaction, annotées de `state`.
 */
function ingestAxeResults(results, page, { state = null, seen, seenFindings } = {}) {
  const violations = [];
  const findings = [];
  // Les échecs des règles expérimentales deviennent des signalements, pas des violations
  for (const v of results.violations) {
    const exp = AXE_EXPERIMENTAL_RULES[v.id];
    if (!exp) {
      violations.push(toViolation(v));
      continue;
    }
    for (const criterion of exp.rgaa) {
      findings.push({
        criterion,
        theme: exp.theme,
        source: 'axe',
        target: v.nodes.slice(0, 5).map((n) => n.target.join(' ')).join(' ; '),
        message: `${v.help} (règle axe expérimentale « ${v.id} », à confirmer manuellement).`
      });
    }
  }
  // Règles « reviewOnFail » (bypass, frame-title-unique…) : axe classe
  // leur échec en incomplete → signalement « à vérifier », jamais bloquant.
  // Idem pour les règles où axe ne peut pas conclure (color-contrast sur fond d'image…).
  for (const inc of results.incomplete) {
    const review = AXE_REVIEW_RULES[inc.id] ?? AXE_INCOMPLETE_RULES[inc.id];
    if (!review) continue;
    for (const criterion of review.rgaa) {
      findings.push({
        criterion,
        theme: review.theme,
        source: 'axe',
        target: inc.nodes.slice(0, 5).map((n) => n.target.join(' ')).join(' ; '),
        message: `${inc.help} (règle axe « ${inc.id} », à confirmer manuellement).`
      });
    }
  }

  if (!seen) {
    page.passesCount = results.passes.length;
    page.incompleteCount = results.incomplete.length;
    page.violations.push(...violations);
    page.findings.push(...findings);
    return;
  }
  page.violations.push(...newViolations(violations, seen, state));
  for (const f of findings) {
    const key = `${f.criterion}|${f.target}`;
    if (seenFindings.has(key)) continue;
    seenFindings.add(key);
    page.findings.push({ ...f, state });
  }
}

/** Analyse axe + vérifications maison dans l'état courant de la page, n'ajoutant que les nouveautés. */
function analyseState(page, state, seen, seenFindings) {
  cy.window({ log: false })
    .then({ timeout: 120000 }, (win) => win.axe.run(win.document, AXE_OPTIONS))
    .then((results) => ingestAxeResults(results, page, { state, seen, seenFindings }));
  cy.window({ log: false }).then((win) => {
    page.violations.push(...newViolations(runCustomChecks(win).map(toViolation), seen, state));
  });
}

/**
 * Passe « après interaction » : ouvre les contenus dépliables (menus, accordéons,
 * panneaux) puis chaque modale, et réanalyse la page dans chacun de ces états.
 * Toute navigation hors de la page interrompt la passe.
 */
function runInteractionPasses(page) {
  const seen = new Set(page.violations.flatMap(violationKeys));
  const seenFindings = new Set(page.findings.map((f) => `${f.criterion}|${f.target}`));
  const samePage = (win) => win.location.href.split('#')[0] === page.resolvedUrl;

  cy.window({ log: false }).then((win) => {
    const { disclosures, modals } = findTriggers(win.document);
    page.interactions = {
      ...(page.interactions ?? {}),
      disclosures: disclosures.map((t) => t.label),
      modals: modals.map((t) => t.label),
      aborted: null
    };
    if (!disclosures.length && !modals.length) return;

    if (disclosures.length) {
      disclosures.forEach((t) => t.el.click());
      cy.wait(SETTLE_MS, { log: false });
      cy.window({ log: false }).then((w) => {
        if (!samePage(w)) { page.interactions.aborted = 'navigation déclenchée par un contenu dépliable'; return; }
        analyseState(page, `après ouverture des contenus dépliables (${disclosures.length})`, seen, seenFindings);
      });
    }

    modals.forEach((t) => {
      cy.window({ log: false }).then((w) => {
        if (page.interactions.aborted || !samePage(w) || !t.el.isConnected) return;
        t.el.click();
        cy.wait(SETTLE_MS, { log: false });
        cy.window({ log: false }).then((w2) => {
          if (!samePage(w2)) { page.interactions.aborted = `navigation déclenchée par « ${t.label} »`; return; }
          analyseState(page, `après ouverture de la modale « ${t.label} »`, seen, seenFindings);
          cy.window({ log: false }).then((w3) => closeDialogs(w3.document, t.el));
          cy.wait(SETTLE_MS, { log: false });
        });
      });
    });
  });
}

/** Remplit et soumet le formulaire de connexion. Autonome : cy.origin la sérialise. */
function fillLoginForm({ user, password, usernameSelector, passwordSelector, submitSelector }) {
  cy.get(usernameSelector, { timeout: 30000 }).clear().type(user, { log: false, parseSpecialCharSequences: false });
  cy.get(passwordSelector).clear().type(password, { log: false, parseSpecialCharSequences: false });
  cy.get(submitSelector).first().click();
}

/**
 * Connexion SSO mémorisée par cy.session : le formulaire n'est rempli qu'une fois
 * (dans un test dédié, exécuté en premier), puis cookies et stockage sont restaurés
 * pour chaque page, Cypress isolant chaque test. L'origine principale d'un test est
 * celle où aboutit sa première visite : si la connexion était faite dans le test
 * d'une page, la visite du SSO deviendrait cette origine et les commandes sur la
 * page échoueraient.
 */
function restoreLoginSession() {
  const creds = {
    ...conf.login,
    user: Cypress.env('RGAA_LOGIN_USER'),
    password: Cypress.env('RGAA_LOGIN_PASSWORD')
  };
  const loginUrl = conf.login.url ?? conf.urls[0];
  const siteOrigin = new URL(loginUrl).origin;
  cy.session(['rgaa-sso', conf.login.origin, loginUrl], () => {
    cy.visit(loginUrl, { headers: conf.httpHeaders ?? {}, auth: conf.basicAuth ?? undefined, failOnStatusCode: false });
    cy.location('origin', { log: false }).then((origin) => {
      // Redirection HTTP suivie par cy.visit : le formulaire est déjà l'origine courante.
      // Redirection côté client (SPA) : il faut basculer sur l'origine du SSO.
      if (origin === conf.login.origin) fillLoginForm(creds);
      else cy.origin(conf.login.origin, { args: creds }, fillLoginForm);
    });
    // Retour sur le site : la connexion a abouti (un échec laisserait sur le SSO)
    cy.location('origin', { timeout: 30000 }).should('eq', siteOrigin);
  });
}

describe('Audit RGAA (critères automatisables)', () => {
  if (conf.login) it(`connexion SSO via ${conf.login.origin}`, restoreLoginSession);

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

      if (conf.login) restoreLoginSession();

      cy.visit(url, {
        headers: conf.httpHeaders ?? {},
        auth: conf.basicAuth ?? undefined,
        failOnStatusCode: false
      });

      // Session restaurée : un éventuel aller-retour silencieux vers le SSO (cookie de
      // session) doit être terminé avant toute commande sur le DOM ; cy.location
      // patiente tant que l'application est sur une autre origine.
      if (conf.login) {
        const pageOrigin = new URL(url).origin;
        cy.wait(conf.waitAfterLoad || 1000);
        cy.location('origin', { timeout: 30000 }).should('eq', pageOrigin);
        cy.wait(500);
        cy.location('origin', { timeout: 30000 }).should('eq', pageOrigin);
      }

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
        interactions: null,
        pageFeatures: null,
        aiExtracts: null
      };

      cy.window({ log: false })
        .then({ timeout: 120000 }, (win) => {
          page.resolvedUrl = win.location.href.split('#')[0];
          return win.axe.run(win.document, AXE_OPTIONS);
        })
        .then((results) => ingestAxeResults(results, page));

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

      // 10.11 avec le menu ouvert : à 320 px, la navigation est généralement repliée derrière
      // un bouton ; on ouvre les déclencheurs de l'en-tête (menu, puis ses sous-menus) et on
      // revérifie le défilement horizontal. Seul un défaut nouveau est rapporté.
      if (conf.interactions) {
        cy.window({ log: false }).then((win) => {
          const doc = win.document;
          const header = doc.querySelector('header, [role="banner"]') ?? doc.body;
          const opened = [];
          const openHeaderTriggers = () => {
            const { disclosures, modals } = findTriggers(doc, header, { disclosures: 5, modals: 1 }, { inDialogs: true });
            const triggers = [...modals, ...disclosures].filter((t) => !opened.includes(t.el));
            triggers.forEach((t) => { opened.push(t.el); t.el.click(); });
            return triggers.length;
          };
          if (!openHeaderTriggers()) return;
          cy.wait(SETTLE_MS, { log: false });
          cy.then(() => { openHeaderTriggers(); }); // sous-menus devenus visibles
          cy.wait(SETTLE_MS, { log: false });
          cy.window({ log: false }).then((w) => {
            page.interactions = { ...(page.interactions ?? {}), menu320: opened.map(describeTrigger) };
            if (w.location.href.split('#')[0] !== page.resolvedUrl) return;
            const already = page.violations.some((v) => v.rule === 'rgaa-reflow-320');
            const r = checkReflow(w);
            const state = 'à 320 px, menu ouvert';
            if (r?.violation && !already) page.violations.push({ ...toViolation(r.violation), state });
            else if (r?.finding && !already && !page.findings.some((f) => f.criterion === '10.11')) page.findings.push({ ...r.finding, state });
            closeDialogs(w.document);
          });
        });
      }

      // Contenus révélés par interaction (menus, panneaux, modales), au viewport demandé
      if (conf.interactions) {
        cy.viewport(Cypress.config('viewportWidth'), Cypress.config('viewportHeight'));
        cy.wait(300);
        cy.then(() => runInteractionPasses(page));
      }

      cy.then(() => {
        cy.task('rgaaResult', page);
        cy.log(`${page.violations.length} règle(s) en échec, ${page.findings.length} signalement(s) à vérifier`);
      });
    });
  });
});
