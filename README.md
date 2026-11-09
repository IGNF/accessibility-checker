# rgaa-ci — Tests d'accessibilité RGAA automatisés pour CI

Outil en ligne de commande qui exécute les tests d'accessibilité **automatisables du RGAA 4.1**
sur une liste de pages web, et fait échouer le pipeline CI en cas de violations.
En complément des tests déterministes (~30 critères), un tier optionnel de **signalements
« à vérifier »** (heuristiques et IA) étend la couverture à la moitié des critères (54/106),
sans jamais faire échouer la CI.

Il s'appuie sur [axe-core](https://github.com/dequelabs/axe-core) (moteur de référence,
locale française) piloté par **Cypress** (via [cypress-axe](https://github.com/component-driven/cypress-axe)),
avec une **table de correspondance règles axe → critères RGAA** ([src/rgaa-mapping.js](src/rgaa-mapping.js)).

> ⚠️ Les tests automatiques ne couvrent qu'une partie du RGAA. Un audit manuel reste
> indispensable pour établir une déclaration d'accessibilité.

📘 **Vous voulez juste utiliser l'outil sur votre plateforme ?**
Suivez le [guide développeur](GUIDE-DEVELOPPEUR.md) (2 fichiers à créer, 5 minutes).
Pour lancer un audit depuis votre poste : [guide d'utilisation en local](GUIDE-UTILISATION-LOCALE.md).

## Installation

```bash
npm install
```

Le binaire Cypress est téléchargé automatiquement à l'installation.
Pour ouvrir l'interface Cypress en local : `npm run cypress:open`.

## Utilisation

```bash
# URLs en ligne de commande
node bin/rgaa-ci.js --url https://mon-site.fr --url https://mon-site.fr/contact

# Ou via un fichier de configuration
node bin/rgaa-ci.js --config rgaa.config.json
```

### Options

| Option | Description | Défaut |
|---|---|---|
| `--url <url>` | URL à analyser (répétable) | — |
| `--sitemap <url>` | URL d'un sitemap.xml : ses pages sont ajoutées à l'analyse (index de sitemaps supportés) | — |
| `--max-pages <n>` | Nombre max de pages issues du sitemap | `25` |
| `--config <fichier>` | Fichier de configuration JSON | — |
| `--output <dossier>` | Dossier des rapports | `rgaa-report` |
| `--fail-on <niveau>` | Seuil d'échec : `critical`, `serious`, `moderate`, `minor`, `any` | `serious` |
| `--max-violations <n>` | Tolérance d'occurrences au-dessus du seuil | `0` |
| `--viewport <LxH>` | Taille du viewport | `1280x720` |
| `--timeout <ms>` | Timeout de chargement | `30000` |
| `--ai` | Active les signalements IA « à vérifier » (nécessite `ANTHROPIC_API_KEY`) | désactivé |
| `--ai-model <nom>` | Modèle Anthropic utilisé | `claude-haiku-4-5` |
| `--ai-max-items <n>` | Éléments max soumis à l'IA par page | `20` |
| `--no-interactions` | Désactive les scénarios d'interaction génériques (voir ci-dessous) | activés |
| `--login-origin <url>` | Origine du SSO (Keycloak…) vers lequel redirigent les pages protégées ; identifiants dans `RGAA_LOGIN_USER` / `RGAA_LOGIN_PASSWORD` | — |
| `--login-url <url>` | Page qui déclenche la connexion (ex. `https://site/login`) | première URL |
| `--parcours <fichier>` | Fichier JSON de parcours (actions rejouées avant analyse, voir ci-dessous) | — |
| `--no-html` | Désactive le rapport HTML | — |
| `--quiet` | Sortie console minimale | — |

### Scénarios d'interaction

Une part importante des non-conformités relevées en audit manuel se trouve dans des
contenus masqués au chargement : menus, accordéons, panneaux, modales. Après l'analyse
de la page telle que chargée, l'outil :

1. ouvre les **contenus dépliables** détectés par leur sémantique (`aria-expanded="false"`,
   `<details>` fermé, `aria-controls` vers une cible masquée) puis réanalyse la page ;
2. ouvre **chaque modale** (`aria-haspopup="dialog"`, `data-fr-opened` du DSFR,
   `aria-controls` vers un `role="dialog"`) une à une, l'analyse, puis la ferme ;
3. à 320 px de large, ouvre le **menu** de l'en-tête et ses sous-menus avant de
   revérifier l'absence de défilement horizontal (critère 10.11).

Aucun sélecteur propre à un site n'est utilisé ; les liens et boutons de soumission ne
sont jamais activés, et toute navigation hors de la page interrompt la passe. Seules les
occurrences **nouvelles** sont ajoutées au rapport, annotées de l'état qui les a révélées
(ex. « après ouverture de la modale « Paramètres d'affichage » »). Limites : 20 dépliables
et 5 modales par page. Désactivable avec `--no-interactions` ou `"interactions": false`
dans la configuration.

### Parcours (états après action)

Les scénarios génériques n'activent jamais de lien ni de soumission. Pour auditer un
**état précis** — formulaire soumis vide, recherche effectuée, filtre appliqué — décrivez un
parcours (`--parcours fichier.json` ou champ `parcours` de la configuration) :

```json
{ "parcours": [{
  "nom": "Contact — soumission du formulaire vide",
  "url": "https://cartes.gouv.fr/aide/fr/nous-ecrire/",
  "etapes": [
    { "cliquer": "button[title='Envoyer la demande de contact']" },
    { "attendre": 800 },
    { "analyser": "après soumission du formulaire vide", "formulaire": true }
  ]
}]}
```

Actions : `cliquer` (sélecteur), `saisir` (sélecteur + `valeur`), `soumettre` (sélecteur du
formulaire ou d'un de ses éléments), `attendre` (millisecondes ou sélecteur à attendre),
`analyser` (libellé de l'état). Chaque étape `analyser` relance axe-core et les contrôles
maison ; **seuls les défauts absents de l'état initial** sont rapportés, annotés du libellé.
Avec `"formulaire": true`, l'étape vérifie aussi l'état du formulaire soumis et produit des
signalements « à vérifier » : erreurs non reliées aux champs (**11.10**), focus non déplacé
vers la première erreur (**12.8**), `<title>` inchangé (**8.6**), messages hors zone de
statut (**7.5**). Un parcours apparaît dans le rapport comme une section « Parcours « nom » ».
Exemple complet : [exemples/parcours-cartesgouv.json](exemples/parcours-cartesgouv.json).

### Pages protégées (connexion SSO)

Pour auditer des pages réservées aux utilisateurs connectés (tableau de bord, espace
personnel…), indiquez l'origine du fournisseur d'identité et fournissez les identifiants
**par variables d'environnement**, jamais en ligne de commande ni dans un fichier versionné :

```bash
export RGAA_LOGIN_USER='auditeur@example.org'
export RGAA_LOGIN_PASSWORD='…'
rgaa-ci --login-origin https://sso.geopf.fr --login-url https://cartes.gouv.fr/login \
        --url https://cartes.gouv.fr/tableau-de-bord/ --url https://cartes.gouv.fr/accessibilite/
```

Fonctionnement : un test Cypress dédié visite `--login-url` (redirection HTTP ou côté
client vers le SSO), remplit le formulaire (sélecteurs Keycloak par défaut :
`input[name="username"]`, `input[name="password"]`, `button[type="submit"]`) et attend le
retour sur le site. La session (cookies, stockage) est ensuite **restaurée pour chaque
page** via `cy.session` : une seule authentification par exécution. Si la première URL
analysée est publique, `--login-url` est indispensable. Les sélecteurs se personnalisent
dans la configuration (`login.usernameSelector`, `login.passwordSelector`,
`login.submitSelector`).

### Fichier de configuration

Voir [rgaa.config.json](rgaa.config.json). Champs supplémentaires disponibles :

- `parcours` : tableau de parcours (voir ci-dessus) ;
- `ignoreRules` : liste de règles axe à désactiver (ex. `["color-contrast"]`) ;
- `httpHeaders` : en-têtes HTTP à envoyer (ex. jeton d'accès à un environnement de recette) ;
- `basicAuth` : `{ "username": "...", "password": "..." }` ;
- `login` : `{ "origin": "https://sso.example.org", "url": "https://site/login", "usernameSelector": "…", "passwordSelector": "…", "submitSelector": "…" }` — les identifiants restent dans `RGAA_LOGIN_USER` / `RGAA_LOGIN_PASSWORD` ;
- `ai` : `{ "enabled": true, "model": null, "maxItemsPerPage": 20 }` — la clé API n'est
  **jamais** mise dans ce fichier : uniquement la variable d'environnement `ANTHROPIC_API_KEY`.

### Coût et réseau du mode IA

- La consommation de tokens est affichée dans le résumé console et écrite dans le
  rapport JSON (champ `aiUsage`). Ordre de grandeur avec le modèle par défaut :
  ≈ 4 500 tokens par page, soit moins d'un centime de dollar par page.
- Derrière un proxy d'entreprise, le `fetch` natif de Node ignore `http_proxy`/`https_proxy` :
  lancer la commande avec `NODE_USE_ENV_PROXY=1` (Node ≥ 24), sinon l'appel à l'API
  Anthropic échoue avec « fetch failed ».

### Codes de sortie

| Code | Signification |
|---|---|
| `0` | Aucun dépassement du seuil |
| `1` | Violations au-delà du seuil → le pipeline échoue |
| `2` | Erreur d'exécution (config invalide, pages inaccessibles) |

## Rapports

Deux rapports sont générés dans le dossier de sortie :

- `rgaa-report.json` : exploitable en CI (par exemple pour un commentaire de merge request).
  Chaque page y liste aussi ses liens internes (`links`), utiles pour élargir l'échantillon —
  notamment découvrir les pages d'un espace connecté ;
- `rgaa-report.html` : rapport lisible avec critères RGAA, thématiques, sévérités et extraits HTML fautifs.

Pour un **rapport de synthèse autonome** (taux indicatif, synthèse par critère, anomalies
prioritaires, pages, parcours, signalements, couverture, annexe) en HTML et PDF :
`node scripts/rapport-plateforme.mjs <dossier-de-sortie> --nom "Ma plateforme"` (PDF via google-chrome).

En cas d'échec d'analyse inexpliqué (SSO, SPA), `RGAA_DEBUG=1` enregistre une capture d'écran du
navigateur dans `<sortie>/captures-echecs/`.

## Intégration CI

### GitHub Action réutilisable (recommandé pour plusieurs dépôts)

Ce dépôt est aussi une **action composite** ([action.yml](action.yml)) : n'importe quel projet
GitHub peut l'utiliser sans rien installer, en quelques lignes :

```yaml
# .github/workflows/rgaa.yml du projet consommateur
name: Accessibilité RGAA
on: [pull_request]

permissions:
  pull-requests: write   # requis pour le commentaire de PR

jobs:
  rgaa:
    runs-on: ubuntu-latest
    steps:
      - uses: IGNF/accessibility-checker@v1
        with:
          urls: https://mon-site.fr https://mon-site.fr/contact
          fail-on: serious
```

Entrées disponibles : `urls`, `sitemap`, `config` (un `rgaa.config.json` du dépôt appelant,
ajouter alors un `actions/checkout` avant), `fail-on`, `max-violations`, `max-pages`,
`output`, `comment-pr`, `artifact-name`, `github-token`, `ai`, `ai-model` et
`anthropic-api-key` (à passer via `${{ secrets.ANTHROPIC_API_KEY }}`, jamais en clair).

L'action publie les rapports en artefact, **commente automatiquement la pull request**
avec la synthèse par critère RGAA (commentaire mis à jour à chaque push), et fait échouer
le job selon le seuil. Pensez à créer un tag (`git tag v1 && git push --tags`) pour figer
la version consommée.

### Workflows fournis

- **Exemple prêt à copier** : [.github/workflows/rgaa.yml](.github/workflows/rgaa.yml)
  (utilise l'action sur PR avec commentaire automatique — remplacer `uses: ./` par
  `uses: IGNF/accessibility-checker@v1` dans vos dépôts).
- **GitHub Actions** : [.github/workflows/accessibility.yml](.github/workflows/accessibility.yml)
  (déclenchement sur push/PR, rapports publiés en artefacts).
- **GitLab CI** : [.gitlab-ci.yml](.gitlab-ci.yml) (image Cypress officielle, artefacts 30 jours).

Adaptez `rgaa.config.json` avec les URLs de votre environnement de recette. Pour tester une
application non déployée, démarrez-la dans une étape précédente du pipeline puis pointez
les URLs vers `http://localhost:<port>`.

## Couverture RGAA

Deux niveaux de résultats, pour concilier couverture et fiabilité :

1. **Violations (bloquantes selon `--fail-on`)** — politique « tests solides » : règles axe
   taguées WCAG A/AA, règles « best practice » rendues normatives par le RGAA (hiérarchie de
   titres, landmarks…) et vérifications maison (doctype, balises de présentation, fieldset
   sans légende, reflow à 320 px), dont une violation prouve objectivement l'échec du critère.
   Critères concernés : 1.1, 2.1, 2.2, 3.1, 3.2, 4.3, 4.10, 5.7, 6.2, 7.1, 7.3, 8.1–8.5,
   8.8, 8.9, 9.1–9.3, 10.4, 10.11, 10.12, 11.1, 11.6, 11.13, 12.6, 12.7, 13.1, 13.8.
2. **Signalements « à vérifier » (jamais bloquants)** — détections demandant une confirmation
   humaine :
   - heuristiques : images légendées (1.9), médias temporels (4.1), couleurs de fond (10.5),
     liens signalés par la seule couleur (10.6), focus visible (10.7), champs obligatoires
     non indiqués (11.10), systèmes de navigation (12.1) et cohérence des menus entre pages (12.2), lien
     d'évitement (12.7), tabindex positifs (12.8), piège clavier (12.9), documents
     bureautiques en téléchargement (13.3), contrastes indéterminables par axe — fond
     d'image, dégradé… (3.2) ;
   - règles axe expérimentales (titre de tableau 5.4, en-têtes de cellules 5.7, paragraphe
     stylé en titre 9.1, étiquette visible ≠ nom accessible 11.2, orientation
     verrouillée 13.9) ;
   - IA (option `--ai`, API Anthropic) : pertinence des alternatives d'images (1.2, 1.3),
     description détaillée des images complexes (1.6), images-texte (1.8), liens
     explicites (6.1), titre de page (8.6), changements de langue (8.7), pertinence des
     titres (9.1), cohérence des landmarks (9.2), étiquettes (11.2), regroupements de
     champs (11.5) et intitulés de bouton (11.9).

Le rapport affiche la couverture effective (critères testés / 106). Les signalements IA
peuvent comporter des faux positifs : ils alimentent une revue humaine, pas une déclaration
de conformité.

Le détail règle par règle se trouve dans [src/rgaa-mapping.js](src/rgaa-mapping.js).
