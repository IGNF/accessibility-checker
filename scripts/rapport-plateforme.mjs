#!/usr/bin/env node
/**
 * Rapport de synthèse autonome d'une plateforme à partir du JSON produit par rgaa-ci :
 * taux indicatif, synthèse par critère, anomalies prioritaires, pages, parcours,
 * signalements « à vérifier » (heuristiques, IA, inter-pages), couverture et annexe
 * détaillée. Produit <dossier>/rapport-complet.html et, si google-chrome est disponible,
 * <dossier>/rapport-complet.pdf.
 *
 * Usage : node scripts/rapport-plateforme.mjs <dossier-de-sortie-rgaa-ci> [--nom "Cartes.gouv.fr"]
 *         [--connecte <motif-regex-des-URL-de-l-espace-connecte>] [--seuil-ia 0.7] [--sans-pdf]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dossier = args.find((a) => !a.startsWith('--'));
if (!dossier || !existsSync(join(dossier, 'rgaa-report.json'))) {
  console.error('Usage : node scripts/rapport-plateforme.mjs <dossier contenant rgaa-report.json> [--nom …] [--connecte <regex>] [--seuil-ia 0.7] [--sans-pdf]');
  process.exit(2);
}
const opt = (n, def) => { const i = args.indexOf(n); return i === -1 ? def : args[i + 1]; };
const d = JSON.parse(readFileSync(join(dossier, 'rgaa-report.json'), 'utf8'));
const INTITULES = JSON.parse(readFileSync(new URL('../src/rgaa-intitules.json', import.meta.url), 'utf8'));
const origine = new URL(d.pages[0].url).origin;
const NOM = opt('--nom', new URL(origine).host);
const CONNECTE = new RegExp(opt('--connecte', 'tableau-de-bord|mes-cles|mon-compte|mon-espace|compte'), 'i');
const SEUIL_IA = Number(opt('--seuil-ia', '0.7'));
const SANS_PDF = args.includes('--sans-pdf');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const numSort = (a, b) => a.localeCompare(b, 'fr', { numeric: true });
const short = (u) => { const x = u.replace(origine, '').replace(/%20/g, ' ').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>'); return x || '/'; };
const THEMES = { 1: 'Images', 2: 'Cadres', 3: 'Couleurs', 4: 'Multimédia', 5: 'Tableaux', 6: 'Liens', 7: 'Scripts', 8: 'Éléments obligatoires', 9: 'Structuration', 10: 'Présentation', 11: 'Formulaires', 12: 'Navigation', 13: 'Consultation' };
const theme = (c) => THEMES[Number(String(c).split('.')[0])] ?? '';
const SEV = { critical: 'Critique', serious: 'Sérieuse', moderate: 'Modérée', minor: 'Mineure' };
const SEV_ORDER = ['critical', 'serious', 'moderate', 'minor'];
const sevBadge = (s) => `<span class="sev sev-${s}">${SEV[s] ?? s}</span>`;
const date = new Date(d.date).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

const pages = d.pages.filter((p) => !p.parcours);
const parcours = d.pages.filter((p) => p.parcours);
const estConnecte = (p) => CONNECTE.test(p.url);
const pagesConnectees = pages.filter(estConnecte);

// ---------- Taux indicatif ----------
const testes = d.coverage.auto;
const critEchec = new Set(d.pages.flatMap((p) => p.violations.flatMap((v) => v.rgaaCriteria ?? [])).filter((c) => testes.includes(c)));
const taux = Math.round((100 * (testes.length - critEchec.size)) / testes.length);
const couleurTaux = taux >= 90 ? '#0a7d2c' : taux >= 70 ? '#b86e00' : '#c9191e';

// ---------- Synthèse par critère ----------
const parCritere = {};
for (const p of d.pages) {
  for (const v of p.violations) {
    for (const c of v.rgaaCriteria?.length ? v.rgaaCriteria : ['—']) {
      const e = (parCritere[c] ??= { occ: 0, pages: new Set(), regles: {}, sev: 'minor', revele: 0, exemples: [] });
      e.occ += v.nodeCount;
      e.pages.add(p.parcours ? `parcours « ${p.parcours} »` : short(p.url));
      e.regles[v.rule] = (e.regles[v.rule] ?? 0) + v.nodeCount;
      if (SEV_ORDER.indexOf(v.impact) < SEV_ORDER.indexOf(e.sev)) e.sev = v.impact;
      if (v.state) e.revele += v.nodeCount;
      if (e.exemples.length < 3) e.exemples.push({ page: p.parcours ? `parcours « ${p.parcours} »` : short(p.url), help: v.help, node: v.nodes[0], state: v.state });
    }
  }
}
const criteresTries = Object.keys(parCritere).sort((a, b) => SEV_ORDER.indexOf(parCritere[a].sev) - SEV_ORDER.indexOf(parCritere[b].sev) || parCritere[b].occ - parCritere[a].occ || numSort(a, b));
const totalOcc = Object.values(d.totals.violationsBySeverity).reduce((s, n) => s + n, 0);
const occRevelees = d.pages.reduce((s, p) => s + p.violations.filter((v) => v.state).reduce((t, v) => t + v.nodeCount, 0), 0);

// ---------- Signalements ----------
const findings = d.pages.flatMap((p) => p.findings.map((f) => ({ ...f, page: p.parcours ? `parcours « ${p.parcours} »` : short(p.url) })));
const heur = findings.filter((f) => f.source === 'heuristique' || f.source === 'axe');
const ia = findings.filter((f) => f.source === 'ia');
const iaRetenus = ia.filter((f) => typeof f.confidence === 'number' && f.confidence >= SEUIL_IA);
const grouper = (list) => {
  const g = {};
  for (const f of list) (g[f.criterion] ??= []).push(f);
  return Object.entries(g).sort((a, b) => numSort(a[0], b[0]));
};
const resumeMsg = (m) => m.replace(/\s+/g, ' ').trim();

// ---------- Rendu ----------
const kpi = (n, l) => `<div class="kpi"><strong>${n}</strong>${l}</div>`;
const sevCount = d.totals.violationsBySeverity;

const htmlCriteres = criteresTries.map((c) => {
  const e = parCritere[c];
  return `<tr><td><strong>${esc(c)}</strong></td><td>${esc(theme(c))}</td><td class="lib">${esc(INTITULES[c] ?? '')}</td><td>${sevBadge(e.sev)}</td><td class="num">${e.occ}${e.revele ? `<br><small>dont ${e.revele} après interaction</small>` : ''}</td><td class="num">${e.pages.size}</td><td><small>${Object.entries(e.regles).map(([r, n]) => `<code>${esc(r)}</code> ×${n}`).join('<br>')}</small></td></tr>`;
}).join('');

const prioritaires = criteresTries.filter((c) => ['critical', 'serious'].includes(parCritere[c].sev));
const htmlPrioritaires = prioritaires.map((c) => {
  const e = parCritere[c];
  return `<article class="prio"><h3>${esc(c)} — ${esc(INTITULES[c] ?? '')} ${sevBadge(e.sev)}</h3>
  <p><strong>${e.occ} occurrence(s)</strong> sur ${e.pages.size} page(s)/parcours : ${[...e.pages].slice(0, 8).map((p) => `<code>${esc(p)}</code>`).join(', ')}${e.pages.size > 8 ? ' …' : ''}</p>
  <ul>${e.exemples.map((x) => `<li><strong>${esc(x.help)}</strong>${x.state ? ` <span class="state">${esc(x.state)}</span>` : ''} — <code>${esc(x.page)}</code><br><code class="sel">${esc(x.node.target)}</code><pre>${esc(x.node.html.slice(0, 220))}</pre>${x.node.failureSummary ? `<small>${esc(resumeMsg(x.node.failureSummary).slice(0, 300))}</small>` : ''}</li>`).join('')}</ul></article>`;
}).join('');

const htmlPages = pages.map((p) => {
  const b = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of p.violations) b[v.impact] = (b[v.impact] ?? 0) + v.nodeCount;
  const inter = p.interactions ?? {};
  const interTxt = p.interactions ? `${(inter.disclosures ?? []).length} dépliable(s), ${(inter.modals ?? []).length} modale(s)${inter.menu320?.length ? ', menu 320 px' : ''}${inter.aborted ? ` — interrompu : ${inter.aborted}` : ''}` : '—';
  const crits = [...new Set(p.violations.flatMap((v) => v.rgaaCriteria))].sort(numSort);
  return `<tr><td><code>${esc(short(p.url))}</code></td><td>${estConnecte(p) ? 'Espace connecté' : 'Public'}</td><td class="num">${b.critical}</td><td class="num">${b.serious}</td><td class="num">${b.moderate}</td><td class="num">${b.minor}</td><td>${crits.join(', ') || '—'}</td><td class="num">${p.findings.length}</td><td><small>${esc(interTxt)}</small></td></tr>`;
}).join('');

const htmlParcours = parcours.map((pc) => `<article class="prio"><h3>Parcours « ${esc(pc.parcours)} »</h3>
  <p><code>${esc(short(pc.url))}</code> — étapes : ${esc((pc.etapes ?? []).join(' → '))}</p>
  ${pc.violations.length ? `<table><thead><tr><th>Critère</th><th>Règle</th><th>Sévérité</th><th>Occ.</th><th>État</th><th>Exemple</th></tr></thead><tbody>${pc.violations.map((v) => `<tr><td><strong>${esc(v.rgaaCriteria.join(', '))}</strong></td><td>${esc(v.help)}<br><code>${esc(v.rule)}</code></td><td>${sevBadge(v.impact)}</td><td class="num">${v.nodeCount}</td><td><span class="state">${esc(v.state ?? '')}</span></td><td><code class="sel">${esc(v.nodes[0].target)}</code></td></tr>`).join('')}</tbody></table>` : '<p>Aucune violation supplémentaire révélée par ce parcours.</p>'}
  ${pc.findings.length ? `<p><strong>Signalements d'état « à vérifier » :</strong></p><ul>${pc.findings.map((f) => `<li><strong>${esc(f.criterion)}</strong> (${esc(theme(f.criterion))}) — ${esc(resumeMsg(f.message))}${f.state ? ` <span class="state">${esc(f.state)}</span>` : ''}</li>`).join('')}</ul>` : ''}
</article>`).join('');

const htmlHeur = grouper(heur).map(([c, list]) => {
  const msgs = {};
  for (const f of list) (msgs[resumeMsg(f.message).replace(/\d+/g, 'N')] ??= { msg: resumeMsg(f.message), pages: new Set() }).pages.add(f.page);
  return `<tr><td><strong>${esc(c)}</strong><br><small>${esc(theme(c))}</small></td><td class="lib">${esc(INTITULES[c] ?? '')}</td><td class="num">${list.length}</td><td>${Object.values(msgs).map((m) => `<p><small>${esc(m.msg.slice(0, 260))}${m.msg.length > 260 ? '…' : ''} <em>(${m.pages.size} page(s))</em></small></p>`).join('')}</td></tr>`;
}).join('');

const htmlIA = grouper(iaRetenus).map(([c, list]) => `<tr><td><strong>${esc(c)}</strong><br><small>${esc(theme(c))}</small></td><td class="lib">${esc(INTITULES[c] ?? '')}</td><td class="num">${list.length}</td><td>${list.sort((a, b) => b.confidence - a.confidence).slice(0, 6).map((f) => `<p><small><strong>${Math.round(f.confidence * 100)} %</strong> — ${esc(resumeMsg(f.message).slice(0, 220))}${f.message.length > 220 ? '…' : ''} <code>${esc(f.page)}</code></small></p>`).join('')}${list.length > 6 ? `<p><small>… et ${list.length - 6} autre(s)</small></p>` : ''}</td></tr>`).join('');

const htmlSite = (d.siteFindings ?? []).map((f) => `<li><strong>${esc(f.criterion)}</strong> — ${esc(resumeMsg(f.message))}</li>`).join('');

const critConformes = testes.filter((c) => !critEchec.has(c));
const critReview = d.coverage.review;
const critHors = Object.keys(INTITULES).filter((c) => !testes.includes(c) && !critReview.includes(c)).sort(numSort);

const htmlAnnexe = d.pages.map((p) => `<section class="annexe"><h3>${p.parcours ? `Parcours « ${esc(p.parcours)} » — ` : ''}<code>${esc(short(p.url))}</code></h3>
  <p><small>${p.violations.length} règle(s) en échec, ${p.passesCount} règle(s) axe conformes, ${p.findings.length} signalement(s)${p.interactions ? ` — interactions : ${(p.interactions.disclosures ?? []).length} dépliable(s), ${(p.interactions.modals ?? []).length} modale(s)` : ''}</small></p>
  ${p.violations.length ? `<table><thead><tr><th>Critère</th><th>Règle</th><th>Sévérité</th><th>Occ.</th><th>Exemples (3 max)</th></tr></thead><tbody>${p.violations.map((v) => `<tr><td><strong>${esc(v.rgaaCriteria.join(', ') || '—')}</strong></td><td>${esc(v.help)}<br><code>${esc(v.rule)}</code>${v.state ? `<br><span class="state">${esc(v.state)}</span>` : ''}</td><td>${sevBadge(v.impact)}</td><td class="num">${v.nodeCount}</td><td>${v.nodes.slice(0, 3).map((n) => `<code class="sel">${esc(n.target)}</code><pre>${esc(n.html.slice(0, 160))}</pre>`).join('')}</td></tr>`).join('')}</tbody></table>` : '<p>Aucune violation.</p>'}
</section>`).join('');

const u = d.aiUsage;
const doc = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Rapport d'accessibilité RGAA 4.1 — ${esc(NOM)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:1300px;margin:2rem auto;padding:0 1rem;color:#1a1a1a;line-height:1.45}
h1{border-bottom:3px solid #000091;padding-bottom:.4rem;font-size:1.7rem} h2{margin-top:2.4rem;border-bottom:2px solid #000091;padding-bottom:.2rem;font-size:1.3rem} h3{font-size:1.05rem;margin:1.2rem 0 .4rem}
table{border-collapse:collapse;width:100%;font-size:.88rem;margin:.8rem 0} th,td{border:1px solid #bbb;padding:.35rem .5rem;vertical-align:top;text-align:left} th{background:#eef} td.num{text-align:right;white-space:nowrap} td.lib{max-width:26rem}
pre{white-space:pre-wrap;word-break:break-all;background:#f5f5f5;padding:.3rem;font-size:.75rem;margin:.2rem 0} code{background:#f3f3f3;padding:0 .2rem;font-size:.85em} code.sel{color:#000091}
.kpis{display:flex;flex-wrap:wrap;gap:.6rem;margin:1rem 0} .kpi{border:1px solid #ddd;border-radius:6px;padding:.5rem .9rem;background:#fafafa;min-width:9rem} .kpi strong{font-size:1.5rem;display:block}
.taux{display:inline-block;background:${couleurTaux};color:#fff;font-weight:bold;padding:.3rem 1rem;border-radius:6px;font-size:1.6rem}
.sev{padding:.1rem .45rem;border-radius:.25rem;font-weight:600;white-space:nowrap;font-size:.8rem} .sev-critical{background:#ce0500;color:#fff} .sev-serious{background:#b34000;color:#fff} .sev-moderate{background:#716043;color:#fff} .sev-minor{background:#ddd}
.state{background:#fef3e0;color:#7a4d00;border-radius:4px;padding:0 .35rem;font-size:.8em}
.note{background:#f5f5fe;border-left:4px solid #000091;padding:.6rem 1rem;margin:1rem 0}
.prio{border:1px solid #ddd;border-radius:6px;padding:.4rem 1rem;margin:.8rem 0;background:#fcfcfc} .prio ul{padding-left:1.2rem} .prio li{margin:.5rem 0}
.annexe{margin:1rem 0}
@media print{
  @page{size:A4 landscape;margin:12mm}
  body{max-width:none;margin:0;font-size:9.5pt;line-height:1.3} h1{font-size:16pt} h2{font-size:13pt;break-before:page} h2:first-of-type{break-before:auto}
  table{font-size:8pt} th,td{padding:.2rem .3rem} thead{display:table-header-group} tr,.prio li{break-inside:avoid}
  a{color:inherit;text-decoration:none} *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style></head><body>
<h1>Rapport d'accessibilité RGAA 4.1 — ${esc(NOM)}</h1>
<p>Analyse automatisée <strong>rgaa-ci</strong> (axe-core + vérifications maison, scénarios d'interaction, ${d.config.ai ? 'tier IA, ' : ''}${parcours.length ? 'parcours, ' : ''}${pagesConnectees.length ? 'session SSO' : ''}) — ${esc(date)}.<br>
Périmètre : <strong>${pages.length} pages</strong>${pagesConnectees.length ? ` dont ${pagesConnectees.length} de l'espace connecté` : ''}${parcours.length ? ` et <strong>${parcours.length} parcours</strong>` : ''} sur ${esc(origine)}.</p>

<h2>1. Synthèse</h2>
<p><span class="taux">${taux} %</span> &nbsp; de conformité sur les critères testables automatiquement (${testes.length - critEchec.size} critères sans violation sur ${testes.length} testés).</p>
<div class="kpis">
${kpi(totalOcc, 'occurrences de violations')}${kpi(sevCount.critical, 'critiques')}${kpi(sevCount.serious, 'sérieuses')}${kpi(sevCount.moderate, 'modérées')}${kpi(sevCount.minor, 'mineures')}
${kpi(occRevelees, 'révélées par interaction ou parcours')}${kpi(critEchec.size, 'critères RGAA en échec')}${kpi(d.totals.findings, 'signalements « à vérifier »')}${kpi(iaRetenus.length, `signalements IA ≥ ${Math.round(SEUIL_IA * 100)} %`)}
</div>
<div class="note"><strong>Lecture.</strong> Le taux est indicatif : il porte sur les ${testes.length} critères RGAA qu'un test automatique peut trancher objectivement (sur 106) et n'est pas le taux officiel d'un audit, qui exige l'évaluation manuelle de tous les critères applicables. Les <em>violations</em> prouvent un échec de critère ; les <em>signalements « à vérifier »</em> (heuristiques, IA, parcours) demandent une confirmation humaine et ne bloquent pas la CI. Les occurrences « révélées par interaction » n'existent qu'après ouverture d'un menu, d'un panneau, d'une modale, ou après une action d'un parcours (recherche, soumission de formulaire).</div>
<p><strong>Critères en échec :</strong> ${[...critEchec].sort(numSort).map((c) => `<strong>${c}</strong> (${esc(theme(c))})`).join(', ') || 'aucun'}.</p>

<h2>2. Synthèse par critère RGAA</h2>
<table><thead><tr><th>Critère</th><th>Thématique</th><th>Intitulé</th><th>Sévérité max.</th><th>Occurrences</th><th>Pages</th><th>Règles</th></tr></thead><tbody>${htmlCriteres}</tbody></table>

<h2>3. Anomalies prioritaires (critiques et sérieuses)</h2>
${htmlPrioritaires || '<p>Aucune violation critique ou sérieuse.</p>'}

<h2>4. Résultats par page</h2>
<table><thead><tr><th>Page</th><th>Espace</th><th>Crit.</th><th>Sér.</th><th>Mod.</th><th>Min.</th><th>Critères en échec</th><th>Signal.</th><th>Interactions rejouées</th></tr></thead><tbody>${htmlPages}</tbody></table>

${parcours.length ? `<h2>5. Parcours</h2>
<p>Chaque parcours rejoue une suite d'actions puis analyse l'état obtenu ; seuls les défauts absents de l'état initial de la page sont rapportés. Les signalements d'état vérifient le contrôle de saisie (11.10), la gestion du focus (12.8), le titre de page (8.6) et les messages de statut (7.5).</p>${htmlParcours}` : ''}

<h2>${parcours.length ? 6 : 5}. Signalements « à vérifier »</h2>
<h3>Heuristiques et règles axe non concluantes (${heur.length})</h3>
<table><thead><tr><th>Critère</th><th>Intitulé</th><th>Nb</th><th>Constats</th></tr></thead><tbody>${htmlHeur || '<tr><td colspan="4">Aucun</td></tr>'}</tbody></table>
${d.config.ai ? `<h3>Signalements IA (${iaRetenus.length} retenus sur ${ia.length}, confiance ≥ ${Math.round(SEUIL_IA * 100)} %)</h3>
<p><small>Produits par le modèle ${esc(u?.model ?? 'IA')} sur les critères de jugement (pertinence des alternatives, des intitulés, des titres…). La confiance est auto-déclarée par le modèle : utile pour prioriser, pas une probabilité calibrée.${u ? ` ${u.calls} appel(s), ${u.inputTokens.toLocaleString('fr-FR')} + ${u.outputTokens.toLocaleString('fr-FR')} tokens${u.estimatedCostUsd != null ? `, ≈ ${u.estimatedCostUsd.toFixed(2)} $` : ''}.` : ''}</small></p>
<table><thead><tr><th>Critère</th><th>Intitulé</th><th>Nb</th><th>Signalements les plus sûrs</th></tr></thead><tbody>${htmlIA || '<tr><td colspan="4">Aucun</td></tr>'}</tbody></table>` : ''}
${htmlSite ? `<h3>Inter-pages</h3><ul>${htmlSite}</ul>` : ''}

<h2>${parcours.length ? 7 : 6}. Couverture du référentiel</h2>
<div class="kpis">${kpi(testes.length, 'critères testés automatiquement')}${kpi(critReview.length, 'critères couverts par signalements')}${kpi(critHors.length, 'critères hors portée (audit manuel)')}</div>
<p><strong>Testés, conformes sur l'échantillon :</strong> ${critConformes.join(', ')}.<br>
<strong>Testés, en échec :</strong> ${[...critEchec].sort(numSort).join(', ') || '—'}.<br>
<strong>Couverts par signalements « à vérifier » :</strong> ${critReview.join(', ')}.<br>
<strong>Hors portée :</strong> ${critHors.join(', ')}.</p>

<h2>${parcours.length ? 8 : 7}. Annexe — détail par page</h2>
${htmlAnnexe}
<p><small>Généré par scripts/rapport-plateforme.mjs à partir de ${esc(dossier)}/rgaa-report.json.</small></p>
</body></html>`;

const sortieHtml = join(dossier, 'rapport-complet.html');
writeFileSync(sortieHtml, doc, 'utf8');
console.log(`HTML : ${sortieHtml}`);
if (!SANS_PDF) {
  const sortiePdf = join(dossier, 'rapport-complet.pdf');
  try {
    execFileSync('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${resolve(sortiePdf)}`, `file://${resolve(sortieHtml)}`], { stdio: 'ignore' });
    console.log(`PDF  : ${sortiePdf}`);
  } catch { console.warn('PDF non généré (google-chrome indisponible)'); }
}
