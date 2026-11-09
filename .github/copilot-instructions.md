# rgaa-ci — Instructions projet

Outil CLI de tests d'accessibilité RGAA 4.1 automatisés pour CI, basé sur axe-core piloté par Cypress (cypress-axe). Aussi publié comme GitHub Action composite ([action.yml](../action.yml)).

## Architecture

- [bin/rgaa-ci.js](../bin/rgaa-ci.js) : point d'entrée CLI (parsing des options, codes de sortie 0/1/2).
- [src/runner.js](../src/runner.js) : orchestre Cypress ; les résultats transitent par un fichier NDJSON temporaire (`.rgaa-results.ndjson`).
- [src/rgaa-mapping.js](../src/rgaa-mapping.js) : table `AXE_TO_RGAA` (règle axe → critères RGAA + thématique). **Politique « tests solides »** : n'y ajouter que des règles taguées WCAG A/AA dont une violation prouve objectivement l'échec du critère — jamais de critère nécessitant un jugement humain (pertinence d'une alternative, caractère explicite d'un lien…).
- [src/report.js](../src/report.js) : génération des rapports `rgaa-report.json` et `rgaa-report.html`.
- [src/sitemap.js](../src/sitemap.js) : récupération des URLs depuis un sitemap.xml.
- [src/interactions.js](../src/interactions.js) : scénarios d'interaction génériques (détection sémantique des dépliables et modales, dédoublonnage des occurrences par état) ; jamais de sélecteur propre à un site.
- [cypress/e2e/rgaa.cy.js](../cypress/e2e/rgaa.cy.js) : spec Cypress qui exécute axe-core sur chaque page.

## Conventions

- ESM uniquement (`type: module`), Node ≥ 20.1, pas de dépendance ajoutée sans nécessité.
- Code, commentaires et messages utilisateur **en français**.
- Locale française d'axe-core pour les messages de violations.
- Toute modification du mapping doit citer le critère RGAA officiel et justifier la solidité du test (voir l'en-tête de [src/rgaa-mapping.js](../src/rgaa-mapping.js)).
- Ne pas modifier les dossiers `rgaa-report/`, `rgaa-run1/`, `rgaa-run2/`, `rgaa-cartesgouv/`, `rgaa-test-action/` : ce sont des sorties générées.

## Tester

```bash
npm install
node bin/rgaa-ci.js --url https://example.com   # audit rapide
npm run cypress:open                            # débogage interactif
```

Documentation : [README.md](../README.md) (utilisation, options, CI) et [GUIDE-DEVELOPPEUR.md](../GUIDE-DEVELOPPEUR.md) (intégration dans un projet consommateur).
