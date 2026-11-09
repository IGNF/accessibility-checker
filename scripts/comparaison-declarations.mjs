#!/usr/bin/env node
/**
 * Compare les déclarations d'accessibilité publiées (taux officiel, non-conformités
 * citées) avec les résultats de rgaa-ci (pf-<nom>/rgaa-report.json).
 * Les déclarations ne citent que les NC « les plus bloquantes », en prose : le
 * rattachement à un critère RGAA 4.1 est une lecture (champ `nc`, commentaire = extrait).
 * Usage : node scripts/comparaison-declarations.mjs  → comparaison-declarations.html (+ .pdf si google-chrome)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const INTITULES = JSON.parse(readFileSync(new URL('../src/rgaa-intitules.json', import.meta.url), 'utf8'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tri = (a, b) => a.localeCompare(b, 'fr', { numeric: true });

const DECLARATIONS = [
  {
    dir: 'pf-geoportail-urbanisme', nom: 'Géoportail de l’urbanisme', site: 'https://www.geoportail-urbanisme.gouv.fr',
    url: 'https://www.geoportail-urbanisme.gouv.fr/accessibilite/',
    etat: 'non conforme', taux: 0, auditeur: 'aucun audit publié', date: '—', version: '—',
    remarque: 'La page « Accessibilité » du site est vide (« Aucun article ») : absence de déclaration, assimilée à « non conforme ». Comparaison limitée aux résultats de l’outil.',
    nc: {}
  },
  {
    dir: 'pf-adresse', nom: 'Base Adresse Nationale', site: 'https://adresse.data.gouv.fr',
    url: 'https://adresse.data.gouv.fr/accessibilite',
    etat: 'non conforme', taux: 0, auditeur: 'aucun audit réalisé', date: '—', version: 'RGAA 4',
    remarque: 'Déclaration « non conforme » faute d’audit : aucune non-conformité listée.',
    nc: {}
  },
  {
    dir: 'pf-mondiagartif', nom: 'Mon Diagnostic Artificialisation', site: 'https://mondiagartif.beta.gouv.fr',
    url: 'https://mondiagartif.beta.gouv.fr/accessibilite',
    etat: 'non conforme', taux: 0, auditeur: 'aucun audit réalisé', date: '07/07/2022', version: 'RGAA',
    remarque: 'Déclaration « non conforme » faute d’audit (générateur BetaGouv) : aucune non-conformité listée.',
    nc: {}
  },
  {
    dir: 'pf-cartesgouv', nom: 'Cartes.gouv.fr', site: 'https://cartes.gouv.fr',
    url: 'https://cartes.gouv.fr/accessibilite/',
    etat: 'non conforme', taux: 46.77, auditeur: 'SMILE (Maroua Ouri)', date: '08/09/2026', version: 'RGAA 4.1.2',
    remarque: 'Déclaration arrivant à terme, nouvel audit de contrôle planifié fin 2026 ; NC « en cours de correction ».',
    nc: { '1.1': 'Images dépourvues d’attribut alt', '1.2': 'Images décoratives non ignorées par les TA', '1.6': 'Image nécessitant une description détaillée sans description', '2.1': 'Cadres (iframe) sans title', '3.2': 'Contraste insuffisant textes', '3.3': 'Contraste insuffisant composants d’interface', '6.2': 'Lien non fonctionnel et lien vide', '7.1': 'Composants riches ne respectant pas les bonnes pratiques', '7.3': 'Composants non utilisables au clavier', '7.4': 'Absence de bouton de validation sur les filtres', '7.5': 'Messages de statut non restitués', '8.4': 'Code de langue incorrect (en sur page FR)', '8.6': 'Intitulé de page (title) peu pertinent', '8.7': 'Termes en anglais sans changement de langue', '8.9': 'Balises HTML à des fins de présentation', '9.1': 'Structuration titres incorrecte', '9.2': 'Structure du document non homogène', '10.2': 'Information incompréhensible CSS désactivées', '10.7': 'Indicateur de focus peu visible', '10.11': 'Défilement horizontal à 320 px / mobile tronqué', '10.12': 'Contenus tronqués avec espacement de texte', '11.1': 'Champs sans étiquette', '11.5': 'Absence de regroupement de champs identiques', '11.9': 'Intitulé de bouton imprécis', '11.10': 'Contrôle / aide à la saisie inadapté', '11.13': 'autocomplete manquant', '12.6': 'Rôles absents ou incorrects sur les régions', '12.7': 'Absence de liens d’accès rapide', '12.8': 'Ordre de tabulation incohérent' }
  },
  {
    dir: 'pf-planification', nom: 'Portail cartographique des énergies renouvelables', site: 'https://planification.climat-energie.gouv.fr',
    url: 'https://planification.climat-energie.gouv.fr/accessibilite/',
    etat: 'partiellement conforme', taux: 94.6, auditeur: 'SMILE (Maroua Ouri)', date: '24/11/2023 (màj 07/12/2023)', version: 'RGAA 4.1',
    remarque: 'Déclaration ancienne (près de 3 ans) ; carte et outils de traçage dérogés.',
    nc: { '11.5': 'Regroupement inutile sur quelques champs', '11.6': 'Structure manquante au niveau du regroupement', '11.10': 'Erreurs de saisie avec attributs mal placés', '12.8': 'Tabulation incohérente après erreur ou validation' }
  },
  {
    dir: 'pf-observatoire-foret', nom: 'Observatoire des forêts françaises', site: 'https://observatoire.foret.gouv.fr',
    url: 'https://observatoire.foret.gouv.fr/accessibilite',
    etat: 'partiellement conforme', taux: 87, auditeur: 'Brigade d’intervention numérique (DINUM), contre-audit IGN (Damien D’Arras)', date: '31/01/2025 (màj 06/02/2025)', version: 'RGAA 4',
    remarque: 'La déclaration ne liste aucune non-conformité : comparaison limitée au taux. Carte exemptée.',
    nc: {}
  },
  {
    dir: 'pf-ign', nom: 'IGN – site institutionnel', site: 'https://www.ign.fr',
    url: 'https://www.ign.fr/declaration-daccessibilite-rgaa',
    etat: 'partiellement conforme', taux: 68, auditeur: 'Smile', date: 'màj 16/05/2025', version: 'RGAA 4.1.2',
    remarque: 'La déclaration couvre aussi l’application mobile Cartes IGN (non comparée).',
    nc: { '1.5': 'Pas d’alternative sur le composant captcha', '2.2': 'Titre d’iframe pas totalement pertinent', '3.2': 'Texte pas assez contrasté (iframe)', '3.3': 'Composant pas assez contrasté (iframe)', '7.1': 'Composant non compatible avec les TA', '7.3': 'Élément non contrôlable au clavier comme à la souris', '7.4': 'Changement de contexte sans avertir', '7.5': 'Message d’alerte non identifié', '8.2': 'Attribut non autorisé dans le code', '8.6': 'Title de page pas totalement pertinent', '8.9': 'Balise p vide dans un contenu textuel', '9.2': 'Structure en bas de page à améliorer', '10.4': 'Perte d’information en zoom 200 %', '11.4': 'Étiquette et champ pas accolés', '11.5': 'Regroupement de champs appliqué à tort / manquant (boutons radio)', '11.9': 'Intitulé du bouton pas pertinent', '11.10': 'Aucune indication des champs obligatoires', '11.11': 'Pas de suggestion de saisie', '11.13': 'autocomplete manquant', '13.5': 'Alternative manquante sur contenu cryptique' }
  },
  {
    dir: 'pf-geodesie', nom: 'Géodésie', site: 'https://geodesie.ign.fr',
    url: 'https://geodesie.ign.fr/declaration-daccessibilite',
    etat: 'partiellement conforme', taux: 83.33, auditeur: 'SMILE', date: 'màj 16/05/2025', version: 'RGAA 4.1.2',
    remarque: 'Géodésie de poche et serveur de fiches déclarés non conformes et non audités ; PDF dérogés.',
    nc: { '7.1': 'Disclosure implémenté comme système d’onglets', '7.4': 'Changement de contexte sans avertir', '8.2': 'Attribut align non autorisé dans table', '8.6': 'Title de la page de recherche pas pertinent', '8.7': 'Changement de langue sur un mot sans indication', '8.9': 'Balise p vide dans un contenu textuel', '9.2': 'Structure bas de page à améliorer', '11.1': 'Champ de recherche sans étiquette', '12.8': 'Tabulation dans le vide dans la modale de recherche' }
  },
  {
    dir: 'pf-remonterletemps', nom: 'Remonter le temps', site: 'https://remonterletemps.ign.fr',
    url: 'https://remonterletemps.ign.fr/accessibilite',
    etat: 'non conforme', taux: 43, auditeur: 'Smile', date: '13/01/2025 (màj 24/09/2025)', version: 'RGAA 4.1.2',
    remarque: 'Cartes des pages « Voir et comparer » et « Télécharger » exemptées ; vidéo YouTube et Piwik dérogés.',
    nc: { '1.2': 'Images décoratives non déterminées comme telles', '3.1': 'Information donnée uniquement par la couleur', '3.2': 'Contrastes insuffisants', '4.1': 'Vidéo sans transcription', '4.11': 'Pas de contrôle de la vidéo d’accueil', '7.1': 'Composants riches non conformes / scripts incompatibles TA / modales', '7.3': 'Composants riches non manipulables au clavier', '8.6': 'Pertinence des titres à revoir', '9.2': 'Structure de la page incohérente', '10.7': 'Prise de focus non visible', '11.1': 'Étiquettes manquantes', '12.7': 'Lien d’accès rapide', '12.8': 'Ordre de tabulation incohérent', '13.3': 'PDF sans alternative' }
  },
  {
    dir: 'pf-geodata-paris', nom: 'Geodata Paris (ex-ENSG)', site: 'https://geodata-paris.fr/fr/',
    url: 'https://geodata-paris.fr/fr/declaration-daccessibilite-rgaa',
    etat: 'partiellement conforme', taux: 80.28, auditeur: 'SMILE (Maroua Ouri)', date: '22/07/2026', version: 'RGAA 4.1.2',
    remarque: 'Lecteur YouTube dérogé (contenu tiers).',
    nc: { '1.2': 'Images décoratives non ignorées', '1.4': 'CAPTCHA avec alternative peu pertinente', '1.5': 'CAPTCHA sans alternative non visuelle', '3.1': 'Information uniquement par la couleur', '4.1': 'Vidéos sans transcription', '4.3': 'Vidéos sans sous-titres', '7.3': 'Navigation clavier d’un carrousel', '8.7': 'Termes anglais sans indication de langue', '11.9': 'Intitulé de bouton imprécis', '11.10': 'Champs obligatoires mal indiqués', '11.11': 'Message d’erreur de date non associé au champ', '11.13': 'autocomplete manquant', '12.6': 'Rôle navigation absent du menu en version réduite', '13.3': 'PDF non accessibles sans alternative' }
  },
  {
    dir: 'pf-boutique', nom: 'Boutique IGN', site: 'https://boutique.ign.fr',
    url: 'https://boutique.ign.fr/accessibilite',
    etat: 'partiellement conforme', taux: 64.8, auditeur: 'Clever Age (suivi SU4)', date: '01/10/2026', version: 'RGAA 4.1.2',
    remarque: '46 C / 25 NC / 35 NA ; seules 6 familles de NC « les plus bloquantes » sont citées.',
    nc: { '1.5': 'Absence d’accès alternatif au CAPTCHA', '3.1': 'Informations portées uniquement par couleur/forme/position', '3.2': 'Contrastes insuffisants', '3.3': 'Contrastes insuffisants (composants)', '4.13': 'Médias non compatibles avec les TA', '8.9': 'Balises uniquement à des fins de présentation', '9.1': 'Structuration insuffisante (titres)' }
  },
  {
    dir: 'pf-macarte', nom: 'Ma carte', site: 'https://macarte.ign.fr',
    url: 'https://macarte.ign.fr/declaration-daccessibilite-rgaa.pdf',
    etat: 'non conforme', taux: 30, auditeur: 'SMILE (Maroua Ouri)', date: '12/04/2023', version: 'RGAA 4.1',
    remarque: 'Audit réalisé sur macarte-qualif.ign.fr ; carte, barre d’outils et éditeur dérogés. Déclaration de plus de 3 ans.',
    nc: { '1.2': 'Images décoratives non ignorées', '1.5': 'Captcha sans alternative', '2.1': 'Cadre sans titre', '3.1': 'Indication par la couleur sans alternative', '3.2': 'Texte avec contraste insuffisant', '3.3': 'Composant avec contraste insuffisant', '5.4': 'Tableau sans titre', '5.7': 'En-têtes de tableau mal renseignés', '6.1': 'Intitulé de lien pas pertinent', '6.2': 'Liens vides', '7.1': 'Scripts incompatibles avec les TA', '7.3': 'Scripts non contrôlables au clavier', '7.4': 'Changements de contexte non signalés', '7.5': 'Messages non vocalisés', '8.2': 'Code source non valide', '8.6': 'Title pas pertinent', '8.9': 'Balises à des fins de présentation', '9.1': 'Structuration titres incorrecte', '9.2': 'Problèmes de structuration sur l’ensemble des pages', '9.3': 'Listes utilisées pour structurer formulaires/texte', '10.1': 'Attributs de présentation dans le HTML', '10.2': 'Contenu porteur d’information en CSS', '10.3': 'Information incompréhensible CSS désactivées', '10.6': 'Lien non visible comme cliquable', '10.7': 'Focus non visible', '10.11': 'Défilement horizontal à 320 px / version réduite', '10.12': 'Perte d’information en espacement de texte', '11.1': 'Champs sans étiquette', '11.5': 'Regroupement manquant sur des zones de choix', '11.9': 'Intitulé de bouton pas pertinent', '11.10': 'Champs obligatoires / aide à la saisie / erreurs par la couleur', '11.13': 'autocomplete manquant', '12.1': 'Système de navigation manquant', '12.7': 'Lien d’accès rapide absent', '12.8': 'Ordre de tabulation incorrect' }
  }
];

/** Agrège par critère les NC (violations) et signalements d'un rapport rgaa-ci. */
function lireOutil(dir) {
  const d = JSON.parse(readFileSync(`${dir}/rgaa-report.json`, 'utf8'));
  const nc = {}; const sig = {};
  for (const p of d.pages) {
    for (const v of p.violations) for (const c of v.rgaaCriteria ?? []) { nc[c] ??= { occ: 0, regles: new Set() }; nc[c].occ += v.nodeCount; nc[c].regles.add(v.rule); }
    for (const f of p.findings ?? []) { sig[f.criterion] ??= { n: 0, sources: new Set() }; sig[f.criterion].n++; sig[f.criterion].sources.add(f.source); }
  }
  for (const f of d.siteFindings ?? []) { sig[f.criterion] ??= { n: 0, sources: new Set() }; sig[f.criterion].n++; sig[f.criterion].sources.add(f.source); }
  const testes = d.coverage.auto;
  const echecs = Object.keys(nc).filter((c) => testes.includes(c));
  return { d, nc, sig, taux: Math.round((100 * (testes.length - echecs.length)) / testes.length), auto: new Set(d.coverage.auto), review: new Set(d.coverage.review) };
}

const lignes = DECLARATIONS.map((decl) => {
  const o = lireOutil(decl.dir);
  const declares = Object.keys(decl.nc).sort(tri);
  const classer = (c) => (o.nc[c] ? 'concordance' : o.sig[c] ? 'signale' : o.auto.has(c) || o.review.has(c) ? 'manque' : 'hors');
  const classes = Object.fromEntries(declares.map((c) => [c, classer(c)]));
  const compte = (k) => declares.filter((c) => classes[c] === k);
  const nonCites = Object.keys(o.nc).filter((c) => !decl.nc[c]).sort(tri);
  return { decl, o, declares, classes, concordance: compte('concordance'), signale: compte('signale'), manque: compte('manque'), hors: compte('hors'), nonCites };
});

const LIB = { concordance: 'Concordance : NC détectée par l’outil', signale: 'Signalé « à vérifier » par l’outil', manque: 'Testable mais non détecté', hors: 'Hors portée de l’outil (jugement / interaction)' };
const CLS = { concordance: 'ok', signale: 'sig', manque: 'ko', hors: 'oos' };

const synthese = `<table class="sc"><thead><tr><th>Plateforme</th><th>Déclaration : état / taux officiel</th><th>Auditeur, date</th><th>Outil : taux indicatif (29 critères testables)</th><th>NC citées</th><th>Concordances</th><th>Signalées</th><th>Testables non détectées</th><th>Hors portée</th><th>NC outil non citées</th></tr></thead><tbody>${lignes.map((l) => `<tr><td><b>${esc(l.decl.nom)}</b><br><a href="${esc(l.decl.url)}">déclaration</a></td><td><span class="etat etat-${l.decl.etat.replace(/\s.*/, '')}">${esc(l.decl.etat)}</span> ${l.decl.taux} % (${esc(l.decl.version)})</td><td>${esc(l.decl.auditeur)}<br><small>${esc(l.decl.date)}</small></td><td>${l.o.taux} %</td><td>${l.declares.length}</td><td class="ok">${l.concordance.length}</td><td class="sig">${l.signale.length}</td><td class="ko">${l.manque.length}</td><td class="oos">${l.hors.length}</td><td>${l.nonCites.length}</td></tr>`).join('')}</tbody></table>`;

const tot = (k) => lignes.reduce((n, l) => n + l[k].length, 0);
const totalDeclares = lignes.reduce((n, l) => n + l.declares.length, 0);

const sections = lignes.map((l) => {
  const rows = l.declares.map((c) => {
    const k = l.classes[c];
    const outil = k === 'concordance' ? `${l.o.nc[c].occ} occurrence(s) — <code>${[...l.o.nc[c].regles].join(', ')}</code>` : k === 'signale' ? `${l.o.sig[c].n} signalement(s) (${[...l.o.sig[c].sources].join(', ')})` : k === 'manque' ? `rien détecté (${l.o.auto.has(c) ? 'test automatique' : 'signalement'} disponible)` : 'non testable automatiquement';
    return `<tr class="${CLS[k]}"><td class="crit">${c}</td><td class="intitule">${esc(INTITULES[c] ?? '')}</td><td>${esc(l.decl.nc[c])}</td><td>${outil}</td><td>${LIB[k]}</td></tr>`;
  }).join('');
  const nonCites = l.nonCites.map((c) => `<li><b>${c}</b> ${esc(INTITULES[c] ?? '')} — ${l.o.nc[c].occ} occurrence(s), <code>${[...l.o.nc[c].regles].join(', ')}</code></li>`).join('');
  return `<section><h2>${esc(l.decl.nom)} — <small>${esc(l.decl.site)}</small></h2>
<p class="meta">Déclaration : <a href="${esc(l.decl.url)}">${esc(l.decl.url)}</a>${l.decl.redirige ? ` (redirige vers ${esc(l.decl.redirige)})` : ''} — <b>${esc(l.decl.etat)}</b>, ${l.decl.taux} % des critères ${esc(l.decl.version)} respectés — audit ${esc(l.decl.auditeur)}, ${esc(l.decl.date)}.<br>
Outil rgaa-ci : ${l.o.d.totals.pages} page(s) analysée(s) le ${new Date(l.o.d.date).toLocaleDateString('fr-FR')}, taux indicatif ${l.o.taux} % sur les critères testables, ${Object.keys(l.o.nc).length} critère(s) en NC, ${Object.keys(l.o.sig).length} critère(s) signalés.</p>
${l.decl.remarque ? `<p class="note">${esc(l.decl.remarque)}</p>` : ''}
<div class="cards"><div class="card ok"><b>${l.concordance.length}</b>concordances<br><small>${l.concordance.join(', ') || '—'}</small></div><div class="card sig"><b>${l.signale.length}</b>signalées à vérifier<br><small>${l.signale.join(', ') || '—'}</small></div><div class="card ko"><b>${l.manque.length}</b>testables non détectées<br><small>${l.manque.join(', ') || '—'}</small></div><div class="card oos"><b>${l.hors.length}</b>hors portée<br><small>${l.hors.join(', ') || '—'}</small></div></div>
${l.declares.length ? `<table><thead><tr><th>Critère</th><th>Intitulé RGAA 4.1</th><th>Non-conformité citée dans la déclaration</th><th>Résultat de l’outil</th><th>Lecture</th></tr></thead><tbody>${rows}</tbody></table>` : '<p><em>Aucune non-conformité détaillée dans la déclaration.</em></p>'}
${nonCites ? `<h3>NC détectées par l’outil mais non citées dans la déclaration (${l.nonCites.length})</h3><ul>${nonCites}</ul>` : ''}
</section>`;
}).join('');

const doc = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Comparaison déclarations d’accessibilité vs rgaa-ci</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font: 10pt/1.4 system-ui, sans-serif; color: #1a1a1a; max-width: 90rem; margin: 1.5rem auto; padding: 0 1rem; }
  h1 { border-bottom: 3px solid #000091; padding-bottom: .4rem; } h2 { margin-top: 2rem; color: #000091; } section { page-break-before: always; }
  table { border-collapse: collapse; width: 100%; margin: .8rem 0; } th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; } th { background: #000091; color: #fff; }
  tr { page-break-inside: avoid; } .crit { font-weight: bold; white-space: nowrap; } .intitule { font-size: 8.5pt; color: #333; }
  tr.ok td { background: #e3f3e3; } tr.sig td { background: #fff3cd; } tr.ko td { background: #fdd; } tr.oos td { background: #f4e8ff; }
  td.ok { color: #18753c; font-weight: bold; } td.sig { color: #8a5a00; font-weight: bold; } td.ko { color: #a00; font-weight: bold; } td.oos { color: #6e3fa0; }
  .cards { display: flex; gap: 10px; margin: .8rem 0; flex-wrap: wrap; } .card { border: 1px solid #ccc; border-radius: 5px; padding: 7px 12px; min-width: 11rem; } .card b { font-size: 14pt; display: block; }
  .card.ok { background: #e3f3e3; } .card.sig { background: #fff3cd; } .card.ko { background: #fdd; } .card.oos { background: #f4e8ff; }
  .meta { color: #333; } .note { background: #fffae0; border: 1px solid #e0d080; padding: 6px 10px; border-radius: 5px; }
  .etat { padding: 2px 8px; border-radius: 4px; font-weight: bold; color: #fff; white-space: nowrap; } .etat-non { background: #c9191e; } .etat-partiellement { background: #b86e00; }
  .legend span { display: inline-block; padding: 2px 8px; margin-right: 8px; border-radius: 3px; font-size: 9pt; border: 1px solid #999; }
</style></head><body>
<h1>Comparaison : déclarations d’accessibilité publiées vs outil automatique rgaa-ci</h1>
<p class="meta">Généré le ${new Date().toLocaleDateString('fr-FR')}. Déclarations consultées le 03/11/2026 ; audits rgaa-ci du 03/11/2026 (axe-core + checks maison + signalements heuristiques/IA, ~10 pages par site).</p>
<p class="note"><b>Comment lire.</b> Les déclarations ne publient que les non-conformités « les plus bloquantes », en prose ; chaque formulation a été rattachée au critère RGAA 4.1 le plus proche (lecture indiquée dans la colonne « Non-conformité citée »). Le taux officiel résulte d’un audit manuel des 106 critères sur un échantillon défini par l’auditeur ; le taux de l’outil ne porte que sur les 29 critères testables automatiquement et sur notre propre échantillon : les deux ne sont pas comparables terme à terme. Les écarts peuvent aussi venir de corrections ou d’évolutions du site depuis la date de la déclaration.</p>
<p class="legend"><span style="background:#e3f3e3">Concordance : NC citée et détectée</span><span style="background:#fff3cd">NC citée, signalée « à vérifier » par l’outil</span><span style="background:#fdd">NC citée, testable mais non détectée</span><span style="background:#f4e8ff">NC citée hors portée de l’outil</span></p>
<h2>Synthèse</h2>
${synthese}
<div class="cards"><div class="card"><b>${totalDeclares}</b>NC citées au total</div><div class="card ok"><b>${tot('concordance')}</b>concordances (${Math.round((100 * tot('concordance')) / totalDeclares)} %)</div><div class="card sig"><b>${tot('signale')}</b>signalées à vérifier (${Math.round((100 * tot('signale')) / totalDeclares)} %)</div><div class="card ko"><b>${tot('manque')}</b>testables non détectées</div><div class="card oos"><b>${tot('hors')}</b>hors portée (${Math.round((100 * tot('hors')) / totalDeclares)} %)</div><div class="card"><b>${tot('nonCites')}</b>NC détectées par l’outil, non citées</div></div>
<ul>${lignes.map((l) => `<li><b>${esc(l.decl.nom)}</b> : déclaré ${l.decl.taux} % (${esc(l.decl.etat)}) / outil ${l.o.taux} % — ${l.concordance.length + l.signale.length}/${l.declares.length} NC citées retrouvées${l.manque.length ? `, à creuser : ${l.manque.join(', ')}` : ''}${l.nonCites.length ? ` ; détecté en plus : ${l.nonCites.join(', ')}` : ''}</li>`).join('')}</ul>
${sections}
</body></html>`;

writeFileSync('comparaison-declarations.html', doc, 'utf8');
try {
  execFileSync('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf=comparaison-declarations.pdf', `file://${process.cwd()}/comparaison-declarations.html`], { stdio: 'ignore' });
} catch { console.warn('PDF non généré (google-chrome indisponible)'); }
console.table(lignes.map((l) => ({ plateforme: l.decl.nom, declare: `${l.decl.taux} %`, outil: `${l.o.taux} %`, citees: l.declares.length, concord: l.concordance.join(' '), signale: l.signale.join(' '), manque: l.manque.join(' '), hors: l.hors.length, nonCites: l.nonCites.join(' ') })));
