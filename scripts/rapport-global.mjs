#!/usr/bin/env node
/**
 * Génère rapport-rgaa-global.html (détails cliquables) et rapport-rgaa-global.pdf
 * (détails dépliés) à partir des rapports JSON/HTML de plusieurs plateformes,
 * avec le taux de conformité sur les critères RGAA testables automatiquement.
 * Usage : node scripts/rapport-global.mjs [--critiques | --ia [--seuil 0.8]]   (nécessite google-chrome pour le PDF)
 * --critiques : variante rapport-rgaa-global-critiques.{html,pdf} ne détaillant que les
 * violations de sévérité critique (sans signalements), le taux restant calculé sur tout.
 * --ia : variante rapport-rgaa-global-ia.{html,pdf} ne contenant que les signalements IA
 * des critères à fort impact (IA_CRITERES) dont la confiance atteint le seuil (défaut 0,7).
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHtmlReport } from '../src/report.js';
import { estimateCost } from '../src/ai-checker.js';

const MODE = process.argv.includes('--critiques') ? 'critiques' : process.argv.includes('--ia') ? 'ia' : 'complet';
const CRITIQUES = MODE === 'critiques';
const IA = MODE === 'ia';
const SORTIE = MODE === 'complet' ? 'rapport-rgaa-global' : `rapport-rgaa-global-${MODE}`;
// Critères de jugement à fort impact utilisateur : alternatives d'images, intitulés de liens, étiquettes et boutons
const IA_CRITERES = new Set(['1.2', '1.3', '6.1', '11.2', '11.9']);
const IA_SEUIL = Number(process.argv[process.argv.indexOf('--seuil') + 1]) || 0.7;

// Dossiers produits par scripts/audits-plateformes.sh
const PLATEFORMES = [
  ['pf-geoportail-urbanisme', 'Géoportail de l’urbanisme', 'https://www.geoportail-urbanisme.gouv.fr'],
  ['pf-adresse', 'Base Adresse Nationale', 'https://adresse.data.gouv.fr'],
  ['pf-mondiagartif', 'Mon Diagnostic Artificialisation', 'https://mondiagartif.beta.gouv.fr'],
  ['pf-cartesgouv', 'Cartes.gouv.fr', 'https://cartes.gouv.fr'],
  ['pf-planification', 'Portail cartographique des énergies renouvelables', 'https://planification.climat-energie.gouv.fr'],
  ['pf-observatoire-foret', 'Observatoire des forêts françaises', 'https://observatoire.foret.gouv.fr'],
  ['pf-ign', 'IGN – site institutionnel', 'https://www.ign.fr'],
  ['pf-geodesie', 'Géodésie', 'https://geodesie.ign.fr'],
  ['pf-remonterletemps', 'Remonter le temps', 'https://remonterletemps.ign.fr'],
  ['pf-geodata-paris', 'Geodata Paris (ex-ENSG)', 'https://geodata-paris.fr/fr/'],
  ['pf-boutique', 'Boutique IGN', 'https://boutique.ign.fr'],
  ['pf-macarte', 'Ma carte', 'https://macarte.ign.fr']
];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Taux = critères testés sans violation / critères testés automatiquement. */
function score(d) {
  const testes = d.coverage.auto;
  const echecs = new Set(d.pages.flatMap((p) => p.violations.flatMap((v) => v.rgaaCriteria ?? [])).filter((c) => testes.includes(c)));
  const taux = Math.round((100 * (testes.length - echecs.size)) / testes.length);
  return { taux, testes: testes.length, echecs: [...echecs].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })) };
}
const couleur = (t) => (t >= 90 ? '#0a7d2c' : t >= 70 ? '#b86e00' : '#c9191e');

/** Copie du résumé réduite aux violations critiques, sans signalements. */
function seulementCritiques(d) {
  return {
    ...d,
    siteFindings: [],
    pages: d.pages.map((p) => ({ ...p, findings: [], violations: p.violations.filter((v) => v.impact === 'critical') })),
    totals: { ...d.totals, findings: 0 }
  };
}

const retenuIA = (f) => f.source === 'ia' && IA_CRITERES.has(f.criterion) && typeof f.confidence === 'number' && f.confidence >= IA_SEUIL;

/** Copie du résumé réduite aux signalements IA retenus, sans violations ni heuristiques. */
function seulementIA(d) {
  const pages = d.pages.map((p) => ({ ...p, violations: [], findings: p.findings.filter(retenuIA) }));
  return {
    ...d,
    siteFindings: [],
    pages,
    totals: { ...d.totals, violationsBySeverity: { critical: 0, serious: 0, moderate: 0, minor: 0 }, violationsAboveThreshold: 0, findings: pages.reduce((n, p) => n + p.findings.length, 0) }
  };
}

const data = PLATEFORMES.map(([dir, nom, url]) => {
  const d = JSON.parse(readFileSync(`${dir}/rgaa-report.json`, 'utf8'));
  const html = CRITIQUES ? buildHtmlReport(seulementCritiques(d)) : IA ? buildHtmlReport(seulementIA(d)) : readFileSync(`${dir}/rgaa-report.html`, 'utf8');
  const iaTous = d.pages.flatMap((p) => p.findings.filter((f) => f.source === 'ia'));
  const iaRetenus = iaTous.filter(retenuIA);
  const parCritere = {};
  for (const f of iaRetenus) parCritere[f.criterion] = (parCritere[f.criterion] ?? 0) + 1;
  const u = d.aiUsage ?? { model: null, inputTokens: 0, outputTokens: 0, calls: 0 };
  const cout = u.estimatedCostUsd ?? estimateCost(u) ?? 0;
  return { dir, nom, url, d, html, s: score(d), ia: iaTous.length, iaRetenus: iaRetenus.length, parCritere, usage: u, cout };
});

const noteIA = `Signalements produits par le modèle ${esc(data.find((x) => x.d.aiUsage)?.d.aiUsage.model ?? 'IA')} sur les critères de jugement, filtrés sur les critères à fort impact (${[...IA_CRITERES].join(', ')}) et une confiance ≥ ${Math.round(IA_SEUIL * 100)} %. Ils demandent une confirmation humaine et ne font jamais échouer la CI ; les violations axe-core et les heuristiques ne figurent pas dans cette version. Coût estimé au tarif indicatif du modèle (1 $/M tokens en entrée et 5 $/M en sortie pour claude-haiku-4-5).`;
const note = IA ? noteIA : `Taux de conformité = critères RGAA testés automatiquement sans aucune violation ÷ critères testés automatiquement (${data[0].s.testes} sur ${data[0].d.coverage.total}). Indicatif : ce n'est pas le taux officiel d'un audit RGAA, qui exige l'évaluation manuelle de tous les critères applicables.${CRITIQUES ? ' Cette version ne détaille que les violations de sévérité critique (axe-core) ; le taux et les compteurs tiennent compte de toutes les sévérités.' : ''}`;
const critCritiques = (d) => [...new Set(d.pages.flatMap((p) => p.violations.filter((v) => v.impact === 'critical').flatMap((v) => v.rgaaCriteria ?? [])))].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
const badge = (x) => `<span style="display:inline-block;background:${couleur(x.s.taux)};color:#fff;font-weight:bold;padding:4px 12px;border-radius:4px">${x.s.taux} %</span>`;
const parCritereTxt = (x) => Object.entries(x.parCritere).sort((a, b) => a[0].localeCompare(b[0], 'fr', { numeric: true })).map(([c, n]) => `${c} (${n})`).join(', ') || '—';
const tableau = IA
  ? `<table class="sc"><tr><th>Plateforme</th><th>Pages</th><th>Signalements IA (tous)</th><th>Retenus (fort impact, confiance ≥ ${Math.round(IA_SEUIL * 100)} %)</th><th>Par critère</th><th>Appels</th><th>Tokens entrée / sortie</th><th>Coût estimé</th></tr>${data.map((x) => `<tr><td><b>${x.nom}</b></td><td>${x.d.totals.pages}</td><td>${x.ia}</td><td><b>${x.iaRetenus}</b></td><td>${parCritereTxt(x)}</td><td>${x.usage.calls}</td><td>${x.usage.inputTokens.toLocaleString('fr-FR')} / ${x.usage.outputTokens.toLocaleString('fr-FR')}</td><td>${x.cout.toFixed(2)} $</td></tr>`).join('')}<tr><td><b>Total</b></td><td>${data.reduce((n, x) => n + x.d.totals.pages, 0)}</td><td>${data.reduce((n, x) => n + x.ia, 0)}</td><td><b>${data.reduce((n, x) => n + x.iaRetenus, 0)}</b></td><td></td><td>${data.reduce((n, x) => n + x.usage.calls, 0)}</td><td>${data.reduce((n, x) => n + x.usage.inputTokens, 0).toLocaleString('fr-FR')} / ${data.reduce((n, x) => n + x.usage.outputTokens, 0).toLocaleString('fr-FR')}</td><td>${data.reduce((n, x) => n + x.cout, 0).toFixed(2)} $</td></tr></table><p><small>${note}</small></p>`
  : CRITIQUES
  ? `<table class="sc"><tr><th>Plateforme</th><th>Taux de conformité (critères testables)</th><th>Pages</th><th>Occurrences critiques</th><th>Critères concernés par une violation critique</th></tr>${data.map((x) => `<tr><td><b>${x.nom}</b></td><td>${badge(x)} (${x.s.testes - x.s.echecs.length}/${x.s.testes})</td><td>${x.d.totals.pages}</td><td>${x.d.totals.violationsBySeverity.critical}</td><td>${critCritiques(x.d).join(', ') || '—'}</td></tr>`).join('')}</table><p><small>${note}</small></p>`
  : `<table class="sc"><tr><th>Plateforme</th><th>Taux de conformité (critères testables)</th><th>Critères en échec</th><th>Pages</th><th>Critiques</th><th>Sérieuses</th><th>Modérées</th><th>Mineures</th><th>Signalements IA</th><th>Coût IA estimé</th></tr>${data.map((x) => {
  const b = x.d.totals.violationsBySeverity;
  return `<tr><td><b>${x.nom}</b></td><td>${badge(x)} (${x.s.testes - x.s.echecs.length}/${x.s.testes})</td><td>${x.s.echecs.join(', ') || '—'}</td><td>${x.d.totals.pages}</td><td>${b.critical}</td><td>${b.serious}</td><td>${b.moderate}</td><td>${b.minor}</td><td>${x.ia}</td><td>${x.cout.toFixed(2)} $</td></tr>`;
}).join('')}<tr><td><b>Total</b></td><td></td><td></td><td>${data.reduce((n, x) => n + x.d.totals.pages, 0)}</td><td></td><td></td><td></td><td></td><td>${data.reduce((n, x) => n + x.ia, 0)}</td><td>${data.reduce((n, x) => n + x.cout, 0).toFixed(2)} $</td></tr></table><p><small>${note}</small></p>`;

const css = data[0].html.match(/<style>[\s\S]*?<\/style>/)[0];
const extra = `<style>.pf{background:#000091;color:#fff;padding:16px 24px;margin:48px 0 16px}.pf h1{margin:0;color:#fff;border:0}.pf p{margin:4px 0 0}section{page-break-before:always}table.sc{border-collapse:collapse;width:100%}table.sc td,table.sc th{border:1px solid #888;padding:6px;text-align:left}table.sc th{background:#000091;color:#fff}</style>`;
const sections = data.map((x, i) => {
  const b = x.html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  const kpi = IA ? `Signalements IA retenus : <b>${x.iaRetenus}</b> sur ${x.ia}` : `Taux de conformité (critères testables) : <b>${x.s.taux} %</b>`;
  return `<section id="p${i + 1}"><div class="pf"><h1>${x.nom}</h1><p>${x.url}</p><p style="font-size:1.4em;margin-top:12px">${kpi}</p></div>${b}</section>`;
}).join('');
const titre = IA ? 'Rapport d\'accessibilité RGAA 4.1 – signalements IA à fort impact, toutes plateformes' : CRITIQUES ? 'Rapport d\'accessibilité RGAA 4.1 – violations critiques, toutes plateformes' : 'Rapport d\'accessibilité RGAA 4.1 – toutes plateformes';
const doc = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${titre}</title>${css}${extra}</head><body><h1>${titre}</h1>${tableau}<ul>${data.map((x, i) => `<li><a href="#p${i + 1}">${x.nom}</a></li>`).join('')}</ul>${sections}</body></html>`;
writeFileSync(`${SORTIE}.html`, doc, 'utf8');

// PDF : détails dépliés, nom de la plateforme en en-tête de chaque page
const tmp = mkdtempSync(join(tmpdir(), 'rgaa-pdf-'));
const pdfs = [];
const imprimer = (nom, contenu) => {
  writeFileSync(join(tmp, `${nom}.html`), contenu, 'utf8');
  execFileSync('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${join(tmp, nom)}.pdf`, `file://${join(tmp, nom)}.html`], { stdio: 'ignore' });
  pdfs.push(join(tmp, `${nom}.pdf`));
};
imprimer('cover', `<meta charset="utf-8">${extra}<style>body{font-family:sans-serif;margin:30px}</style><h1>${titre}</h1><p>Généré le ${new Date().toLocaleDateString('fr-FR')} avec rgaa-ci (${IA ? 'signalements IA « à vérifier » uniquement' : `axe-core + Cypress${CRITIQUES ? '' : ' + signalements IA « à vérifier »'}`}). Détails dépliés ; version interactive : ${SORTIE}.html.</p>${tableau}`);
data.forEach((x, i) => {
  const kpi = IA ? `Signalements IA retenus : <b>${x.iaRetenus}</b> / ${x.ia}` : `Taux de conformité (critères testables) : <b style="color:${couleur(x.s.taux)}">${x.s.taux} %</b>`;
  const detail = IA ? `Par critère : ${parCritereTxt(x)}` : CRITIQUES ? `Critères avec violation critique : ${critCritiques(x.d).join(', ') || '—'}` : `Critères en échec : ${x.s.echecs.join(', ') || '—'}`;
  imprimer(`div${i}`, `<meta charset="utf-8"><style>@page{margin:0}body{font-family:sans-serif;margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:0 60px;background:#000091;color:#fff}h1{font-size:56px;margin:0}h2{font-weight:400}li{font-size:14px}.k{background:#fff;color:#000;padding:12px 20px;display:inline-block;margin-top:16px}</style><h2>Plateforme ${i + 1}/${data.length}</h2><h1>${x.nom}</h1><h2>${x.url}</h2><div class="k" style="font-size:28px">${kpi}</div><p>${detail}</p><h3>Pages auditées (${x.d.totals.pages})</h3><ul>${x.d.pages.map((p) => `<li>${esc(p.url)}</li>`).join('')}${x.d.errors.map((e) => `<li>${esc(e.url)} (analyse impossible)</li>`).join('')}</ul>`);
  const bandeau = IA ? `${x.nom} — ${x.iaRetenus} signalement(s) IA` : `${x.nom} — ${x.s.taux} %`;
  const run = `<style>@page{margin:18mm 10mm 12mm}@page{@top-center{content:'${x.nom} — ${x.url}';font:bold 11pt sans-serif;color:#000091}}body::before{content:'${bandeau}';display:block;background:#000091;color:#fff;font:bold 22pt sans-serif;padding:12px 20px;margin-bottom:12px}</style>`;
  imprimer(`rep${i}`, x.html.replace('<details>', '<details open>').replaceAll('<details>', '<details open>').replace('</head>', `${run}</head>`));
});
const ordre = ['cover', ...data.flatMap((_, i) => [`div${i}`, `rep${i}`])].map((n) => join(tmp, `${n}.pdf`));
execFileSync('pdfunite', [...ordre, `${SORTIE}.pdf`]);
rmSync(tmp, { recursive: true, force: true });
console.table(data.map((x) => ({ plateforme: x.nom, taux: `${x.s.taux} %`, echecs: x.s.echecs.join(' '), critiques: x.d.totals.violationsBySeverity.critical, ia: `${x.iaRetenus}/${x.ia}` })));
