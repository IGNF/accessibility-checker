# Guide développeur — Tester l'accessibilité RGAA de votre plateforme

`rgaa-ci` analyse automatiquement vos pages web et détecte les violations
des critères **RGAA automatisables** (contrastes, alternatives d'images,
étiquettes de formulaires, structure…). Il bloque vos pull requests en cas
de régression et poste un rapport directement dans la PR.

> ⚠️ L'outil couvre ~30 % des critères RGAA. Un pipeline vert ≠ site conforme.
> C'est un filet anti-régression, pas un audit.

---

## 1. Essayer en 2 minutes (en local)

```bash
git clone https://github.com/IGNF/accessibility-checker
cd accessibility-checker
npm install
node bin/rgaa-ci.js --url https://ma-plateforme.fr
```

Ouvrez ensuite `rgaa-report/rgaa-report.html` dans un navigateur :
chaque violation y figure avec le code HTML fautif et comment la corriger.

Plus de détails (options, dépannage, audit d'une appli locale) :
[guide d'utilisation en local](GUIDE-UTILISATION-LOCALE.md).

---

## 2. Intégrer à votre dépôt GitHub (2 fichiers à créer)

### Fichier 1 : `rgaa.config.json` (à la racine de votre projet)

Listez 3 à 10 pages **aux gabarits différents** (accueil, formulaire,
liste de résultats, page de contenu…) :

```json
{
  "urls": [
    "https://recette.ma-plateforme.fr/",
    "https://recette.ma-plateforme.fr/connexion",
    "https://recette.ma-plateforme.fr/recherche"
  ],
  "failOn": "serious"
}
```

### Fichier 2 : `.github/workflows/rgaa.yml`

```yaml
name: Accessibilité RGAA
on: [pull_request]

permissions:
  contents: read
  pull-requests: write

jobs:
  rgaa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: IGNF/accessibility-checker@v1
        with:
          config: rgaa.config.json
```

**C'est terminé.** À chaque pull request :

- ✅ pas de violation au-dessus du seuil → job vert ;
- ❌ violations détectées → job rouge + **commentaire automatique dans la PR**
  avec le détail par critère RGAA + rapports téléchargeables en artefact.

---

## 3. Options utiles

| Besoin | Solution |
|---|---|
| Adoption en douceur | `"failOn": "critical"` d'abord, puis durcir vers `serious` / `any` |
| Tolérer N violations | `"maxViolations": 5` |
| Beaucoup de pages | `"sitemap": "https://ma-plateforme.fr/sitemap.xml"` + `"maxPages": 25` |
| Recette protégée par jeton | `"httpHeaders": { "Authorization": "Bearer …" }` |
| Recette protégée par mot de passe | `"basicAuth": { "username": "…", "password": "…" }` |
| Ignorer une règle (faux positif assumé) | `"ignoreRules": ["color-contrast"]` |
| Appli non déployée | Démarrez-la dans un step précédent, puis `"urls": ["http://localhost:3000"]` |
| Signalements IA « à vérifier » (liens explicites, pertinence des alternatives…) | `ai: "true"` + `anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}` dans le `with:` de l'action — jamais bloquant, nécessite un secret de dépôt |

Toutes les options : voir le [README](README.md).

---

## 4. Ajouter des tests de performance

Les tests de performance concernent le site consommateur : ajoutez-les dans un job CI
distinct du job RGAA, après le déploiement de la prévisualisation de la pull request.
Lighthouse CI peut auditer quelques pages représentatives. Remplacez les chemins
ci-dessous par ceux de votre site et reliez `PREVIEW_URL` à l'URL de prévisualisation
produite par votre étape de déploiement.

Par exemple, créez `.github/workflows/performance.yml` :

```yaml
name: Performance
on: [pull_request]

jobs:
  lighthouse:
    runs-on: ubuntu-latest
    steps:
      - name: Mesures Lighthouse
        uses: treosh/lighthouse-ci-action@v12
        with:
          urls: |
            ${{ vars.PREVIEW_URL }}/
            ${{ vars.PREVIEW_URL }}/contenu
            ${{ vars.PREVIEW_URL }}/recherche
            ${{ vars.PREVIEW_URL }}/formulaire
          configPath: .lighthouserc.json
          uploadArtifacts: true
```

Si l'URL change à chaque pull request, utilisez la sortie de votre étape de déploiement
à la place de `vars.PREVIEW_URL` et faites dépendre ce job de cette étape. Créez aussi
`.lighthouserc.json` pour définir les seuils :

```json
{
  "ci": {
    "assert": {
      "assertions": {
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }],
        "total-blocking-time": ["warn", { "maxNumericValue": 200 }]
      }
    }
  }
}
```

LCP ≤ 2,5 s et CLS ≤ 0,1 sont les seuils « bons » des Core Web Vitals. Lighthouse CI
mesure ces valeurs en laboratoire ; **INP ≤ 200 ms doit être suivi avec des données
réelles** (par exemple CrUX ou un outil de RUM), car une mesure de laboratoire ne
remplace pas l'INP terrain. Le TBT est un indicateur de laboratoire complémentaire,
pas un équivalent de l'INP.

Commencez par enregistrer plusieurs exécutions et examiner les rapports artefacts pour
établir une référence, car les mesures de laboratoire varient. Activez d'abord les
seuils en avertissement si nécessaire, puis faites échouer le job sur les seuils
stables. Pour mesurer les régressions au fil des déploiements, conservez et comparez
les rapports ; les seuils fixes ci-dessus ne calculent pas à eux seuls une différence
par rapport à une exécution précédente.

---

## 5. Lire les résultats

- **Commentaire de PR** : synthèse par sévérité et par critère RGAA ;
- **`rgaa-report.html`** (artefact du job) : rapport détaillé, avec pour chaque
  violation le sélecteur CSS, l'extrait HTML et le correctif attendu ;
- **`rgaa-report.json`** : exploitable par vos propres scripts.

Codes de sortie : `0` = OK, `1` = seuil dépassé, `2` = erreur (page inaccessible…).

---

## 6. Questions fréquentes

**Le job échoue dès l'installation ?**
Vérifiez Node ≥ 18. Le binaire Cypress (~200 Mo) est mis en cache automatiquement
par l'action après le premier run.

**Une violation est un faux positif ?**
Ajoutez la règle axe concernée dans `ignoreRules` avec un commentaire de revue
expliquant pourquoi.

**Le site est une SPA, certaines pages semblent vides ?**
L'analyse se fait après chargement de la page. Les contenus qui n'apparaissent
qu'après interaction (modales, menus…) ne sont pas couverts : ils relèvent de
l'audit manuel.

**Qui contacter ?**
Ouvrez une issue sur le dépôt [IGNF/accessibility-checker](https://github.com/IGNF/accessibility-checker/issues).
