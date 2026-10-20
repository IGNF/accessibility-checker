# Guide d'utilisation en local — rgaa-ci

Ce guide s'adresse aux collègues qui veulent **lancer un audit d'accessibilité RGAA
depuis leur poste**, sans passer par la CI. Aucune connaissance de Cypress n'est requise.

> ⚠️ L'outil ne couvre que les critères RGAA **automatisables** (~30 %).
> Un rapport sans violation ne signifie pas que le site est conforme.

---

## 1. Prérequis

- **Node.js ≥ 18** — vérifiez avec `node --version` ;
- **git** ;
- ~500 Mo d'espace disque (le binaire Cypress est téléchargé à l'installation).

Sous Linux, si Cypress refuse de démarrer, installez ses dépendances système :

```bash
sudo apt-get install libgtk2.0-0 libgtk-3-0 libgbm-dev libnotify-dev \
  libnss3 libxss1 libasound2 libxtst6 xauth xvfb
```

## 2. Installation (une seule fois)

```bash
git clone https://github.com/tgerbeau/accessibility-checker
cd accessibility-checker
npm install
```

## 3. Lancer un audit

### Audit rapide d'une ou plusieurs pages

```bash
node bin/rgaa-ci.js --url https://ma-plateforme.fr
node bin/rgaa-ci.js --url https://ma-plateforme.fr --url https://ma-plateforme.fr/contact
```

### Audit d'un site entier via son sitemap

```bash
node bin/rgaa-ci.js --sitemap https://ma-plateforme.fr/sitemap.xml --max-pages 25
```

### Audit reproductible via un fichier de configuration

Créez un fichier `ma-config.json` :

```json
{
  "urls": [
    "https://ma-plateforme.fr/",
    "https://ma-plateforme.fr/connexion",
    "https://ma-plateforme.fr/recherche"
  ],
  "failOn": "serious"
}
```

Puis :

```bash
node bin/rgaa-ci.js --config ma-config.json
```

Conseil : choisissez 3 à 10 pages **aux gabarits différents** (accueil, formulaire,
liste de résultats, page de contenu…) plutôt que 50 pages similaires.

### Auditer une application lancée en local

Démarrez votre application, puis pointez l'outil dessus :

```bash
node bin/rgaa-ci.js --url http://localhost:3000
```

## 4. Lire les résultats

À la fin de l'audit, deux rapports sont générés dans `rgaa-report/` :

- **`rgaa-report.html`** — à ouvrir dans un navigateur. Pour chaque violation :
  le critère RGAA, la thématique, la sévérité, le sélecteur CSS, l'extrait HTML
  fautif et la piste de correction ;
- **`rgaa-report.json`** — pour un traitement par script.

La console affiche aussi une synthèse par sévérité. Codes de sortie :

| Code | Signification |
|---|---|
| `0` | Aucun dépassement du seuil |
| `1` | Violations au-delà du seuil |
| `2` | Erreur d'exécution (config invalide, page inaccessible…) |

## 5. Options utiles

| Besoin | Commande / champ de config |
|---|---|
| Changer le dossier de sortie | `--output mon-dossier` |
| Ne remonter que les violations graves | `--fail-on critical` (défaut : `serious`) |
| Tester en mobile | `--viewport 375x667` |
| Page lente à charger | `--timeout 60000` |
| Site de recette protégé par jeton | `"httpHeaders": { "Authorization": "Bearer …" }` dans la config |
| Site protégé par mot de passe | `"basicAuth": { "username": "…", "password": "…" }` dans la config |
| Ignorer une règle (faux positif assumé) | `"ignoreRules": ["color-contrast"]` dans la config |

Liste complète des options : [README.md](README.md).

## 6. Déboguer visuellement (optionnel)

Pour voir l'audit s'exécuter dans un navigateur (utile pour comprendre une violation) :

```bash
npm run cypress:open
```

Choisissez « E2E Testing », puis la spec `rgaa.cy.js`.

## 7. Problèmes fréquents

**`command not found: node` ou version < 18**
Installez Node.js ≥ 18 (par exemple via [nvm](https://github.com/nvm-sh/nvm) :
`nvm install --lts`).

**L'installation de Cypress échoue derrière un proxy d'entreprise**
Définissez les variables `HTTP_PROXY` / `HTTPS_PROXY` avant `npm install`.

**Le rapport indique « page inaccessible »**
Vérifiez que l'URL répond depuis votre poste (`curl -I <url>`), y compris VPN
et authentification éventuels.

**Une page SPA semble vide dans le rapport**
L'analyse a lieu après le chargement initial. Les contenus qui n'apparaissent
qu'après interaction (modales, menus…) relèvent de l'audit manuel.

**Une violation est un faux positif ?**
Ajoutez la règle axe dans `ignoreRules` — et documentez pourquoi.

---

Pour intégrer l'outil dans la CI de votre projet (blocage des PR, commentaire
automatique), suivez le [guide développeur](GUIDE-DEVELOPPEUR.md).
