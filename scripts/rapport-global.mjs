#!/usr/bin/env node
/**
 * Génère rapport-rgaa-global.html (détails cliquables) et rapport-rgaa-global.pdf
 * (détails dépliés) à partir des rapports JSON/HTML de plusieurs plateformes,
 * avec le taux de conformité sur les critères RGAA testables automatiquement.
 * Usage : node scripts/rapport-global.mjs   (nécessite google-chrome pour le PDF)
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLATEFORMES = [
  ['pf-remonterletemps', 'Remonter le temps', 'https://remonterletemps.ign.fr'],
  ['pf-boutique', 'Boutique IGN', 'https://boutique.ign.fr'],
  ['pf-cartesgouv', 'Cartes.gouv.fr', 'https://cartes.gouv.fr'],
  ['pf-cartosp', 'Cartographie des services publics', 'https://cartographie-services-publics.modernisation.gouv.fr']
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

const data = PLATEFORMES.map(([dir, nom, url]) => {
  const d = JSON.parse(readFileSync(`${dir}/rgaa-report.json`, 'utf8'));
  const html = readFileSync(`${dir}/rgaa-report.html`, 'utf8');
  return { dir, nom, url, d, html, s: score(d), ia: d.pages.reduce((n, p) => n + p.findings.filter((f) => f.source === 'ia').length, 0) };
});

const note = `Taux de conformité = critères RGAA testés automatiquement sans aucune violation ÷ critères testés automatiquement (31 sur 106). Indicatif : ce n'est pas le taux officiel d'un audit RGAA, qui exige l'évaluation manuelle de tous les critères applicables.`;
const badge = (x) => `<span style="display:inline-block;background:${couleur(x.s.taux)};color:#fff;font-weight:bold;padding:4px 12px;border-radius:4px">${x.s.taux} %</span>`;
const tableau = `<table class="sc"><tr><th>Plateforme</th><th>Taux de conformité (critères testables)</th><th>Critères en échec</th><th>Pages</th><th>Critiques</th><th>Sérieuses</th><th>Modérées</th><th>Mineures</th><th>Signalements IA</th></tr>${data.map((x) => {
  const b = x.d.totals.violationsBySeverity;
  return `<tr><td><b>${x.nom}</b></td><td>${badge(x)} (${x.s.testes - x.s.echecs.length}/${x.s.testes})</td><td>${x.s.echecs.join(', ') || '—'}</td><td>${x.d.totals.pages}</td><td>${b.critical}</td><td>${b.serious}</td><td>${b.moderate}</td><td>${b.minor}</td><td>${x.ia}</td></tr>`;
}).join('')}</table><p><small>${note}</small></p>`;

const css = readFileSync(`${data[0].dir}/rgaa-report.html`, 'utf8').match(/<style>[\s\S]*?<\/style>/)[0];
const extra = `<style>.pf{background:#000091;color:#fff;padding:16px 24px;margin:48px 0 16px}.pf h1{margin:0;color:#fff;border:0}.pf p{margin:4px 0 0}section{page-break-before:always}table.sc{border-collapse:collapse;width:100%}table.sc td,table.sc th{border:1px solid #888;padding:6px;text-align:left}table.sc th{background:#000091;color:#fff}</style>`;
const sections = data.map((x, i) => {
  const b = x.html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  return `<section id="p${i + 1}"><div class="pf"><h1>${x.nom}</h1><p>${x.url}</p><p style="font-size:1.4em;margin-top:12px">Taux de conformité (critères testables) : <b>${x.s.taux} %</b></p></div>${b}</section>`;
}).join('');
const doc = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport RGAA – toutes plateformes</title>${css}${extra}</head><body><h1>Rapport d'accessibilité RGAA 4.1 – toutes plateformes</h1>${tableau}<ul>${data.map((x, i) => `<li><a href="#p${i + 1}">${x.nom}</a></li>`).join('')}</ul>${sections}</body></html>`;
writeFileSync('rapport-rgaa-global.html', doc, 'utf8');

// PDF : détails dépliés, nom de la plateforme en en-tête de chaque page
const tmp = mkdtempSync(join(tmpdir(), 'rgaa-pdf-'));
const pdfs = [];
const imprimer = (nom, contenu) => {
  writeFileSync(join(tmp, `${nom}.html`), contenu, 'utf8');
  execFileSync('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${join(tmp, nom)}.pdf`, `file://${join(tmp, nom)}.html`], { stdio: 'ignore' });
  pdfs.push(join(tmp, `${nom}.pdf`));
};
imprimer('cover', `<meta charset="utf-8">${extra}<style>body{font-family:sans-serif;margin:30px}</style><h1>Rapport d'accessibilité RGAA 4.1 – synthèse multi-plateformes</h1><p>Généré le ${new Date().toLocaleDateString('fr-FR')} avec rgaa-ci (axe-core + Cypress + signalements IA « à vérifier »). Détails dépliés ; version interactive : rapport-rgaa-global.html.</p>${tableau}`);
data.forEach((x, i) => {
  imprimer(`div${i}`, `<meta charset="utf-8"><style>@page{margin:0}body{font-family:sans-serif;margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:0 60px;background:#000091;color:#fff}h1{font-size:56px;margin:0}h2{font-weight:400}li{font-size:14px}.k{background:#fff;color:#000;padding:12px 20px;display:inline-block;margin-top:16px}</style><h2>Plateforme ${i + 1}/${data.length}</h2><h1>${x.nom}</h1><h2>${x.url}</h2><div class="k" style="font-size:28px">Taux de conformité (critères testables) : <b style="color:${couleur(x.s.taux)}">${x.s.taux} %</b></div><p>Critères en échec : ${x.s.echecs.join(', ') || '—'}</p><h3>Pages auditées (${x.d.totals.pages})</h3><ul>${x.d.pages.map((p) => `<li>${esc(p.url)}</li>`).join('')}${x.d.errors.map((e) => `<li>${esc(e.url)} (analyse impossible)</li>`).join('')}</ul>`);
  const run = `<style>@page{margin:18mm 10mm 12mm}@page{@top-center{content:'${x.nom} — ${x.url}';font:bold 11pt sans-serif;color:#000091}}body::before{content:'${x.nom} — ${x.s.taux} %';display:block;background:#000091;color:#fff;font:bold 22pt sans-serif;padding:12px 20px;margin-bottom:12px}</style>`;
  imprimer(`rep${i}`, x.html.replace('<details>', '<details open>').replaceAll('<details>', '<details open>').replace('</head>', `${run}</head>`));
});
const ordre = ['cover', ...data.flatMap((_, i) => [`div${i}`, `rep${i}`])].map((n) => join(tmp, `${n}.pdf`));
execFileSync('pdfunite', [...ordre, 'rapport-rgaa-global.pdf']);
rmSync(tmp, { recursive: true, force: true });
console.table(data.map((x) => ({ plateforme: x.nom, taux: `${x.s.taux} %`, echecs: x.s.echecs.join(' ') })));
