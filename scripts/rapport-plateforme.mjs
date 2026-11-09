#!/usr/bin/env node
/**
 * Rapport de synthèse autonome d'une plateforme à partir du JSON produit par rgaa-ci :
 * synthèse visuelle (taux indicatif, sévérités, thématiques, pages les plus touchées),
 * fiches d'anomalies prioritaires avec impact utilisateur et correction, résultats par
 * page, parcours, signalements « à vérifier », mosaïque de couverture des 106 critères
 * et annexe détaillée repliable. Produit <dossier>/rapport-complet.html et, si
 * google-chrome est disponible, <dossier>/rapport-complet.pdf (annexes dépliées).
 *
 * Usage : node scripts/rapport-plateforme.mjs <dossier-de-sortie-rgaa-ci> [--nom "Cartes.gouv.fr"]
 *         [--connecte <regex des URL de l'espace connecté>] [--seuil-ia 0.7] [--sans-pdf]
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const AVEC_VALEUR = ['--nom', '--connecte', '--seuil-ia'];
const dossier = args.find((a, i) => !a.startsWith('--') && !AVEC_VALEUR.includes(args[i - 1]));
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
const short = (u) => (u.replace(origine, '').replace(/%20/g, ' ').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')) || '/';
const THEMES = { 1: 'Images', 2: 'Cadres', 3: 'Couleurs', 4: 'Multimédia', 5: 'Tableaux', 6: 'Liens', 7: 'Scripts', 8: 'Éléments obligatoires', 9: 'Structuration', 10: 'Présentation', 11: 'Formulaires', 12: 'Navigation', 13: 'Consultation' };
const theme = (c) => THEMES[Number(String(c).split('.')[0])] ?? '';
const SEV = { critical: 'Critique', serious: 'Sérieuse', moderate: 'Modérée', minor: 'Mineure' };
const SEV_ORDER = ['critical', 'serious', 'moderate', 'minor'];
const SEV_COLOR = { critical: '#ce0500', serious: '#e4794a', moderate: '#716043', minor: '#929292' };
const chip = (s) => `<span class="chip chip-${s}">${SEV[s] ?? s}</span>`;
const resume = (m) => String(m ?? '').replace(/\s+/g, ' ').trim();
const date = new Date(d.date).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

/** Impact utilisateur et correction, en langage clair, pour les critères les plus fréquents. */
const GUIDE = {
  '1.1': ['Les personnes aveugles entendent le nom du fichier, ou rien, à la place de l’image.', 'Ajouter un attribut <code>alt</code> décrivant l’information portée par l’image (ou <code>alt=""</code> si elle est décorative).'],
  '2.1': ['Un cadre sans titre est annoncé « cadre » sans indication de son contenu.', 'Renseigner <code>title</code> sur chaque <code>&lt;iframe&gt;</code>.'],
  '3.2': ['Les personnes malvoyantes, ou en plein soleil, ne lisent pas le texte.', 'Atteindre un rapport de contraste de 4,5:1 (texte courant) ou 3:1 (texte large) entre le texte et son fond.'],
  '6.2': ['Un lien sans intitulé est annoncé « lien » : impossible de savoir où il mène.', 'Donner un texte au lien, un <code>alt</code> à son image, ou un <code>aria-label</code>.'],
  '7.1': ['Un bouton sans nom ou un composant mal construit est inutilisable au lecteur d’écran et au clavier.', 'Nommer chaque bouton (texte, <code>aria-label</code>) et ne pas imbriquer d’éléments interactifs.'],
  '7.3': ['Un composant inaccessible au clavier bloque la navigation sans souris.', 'Utiliser des éléments natifs (<code>button</code>, <code>a</code>) ou gérer <code>tabindex</code> et les touches clavier.'],
  '8.1': ['Sans doctype valide, le rendu et la restitution peuvent varier.', 'Déclarer <code>&lt;!DOCTYPE html&gt;</code>.'],
  '8.2': ['Un attribut ARIA invalide fausse ce qu’annoncent les technologies d’assistance.', 'Corriger les valeurs : <code>aria-owns</code> / <code>aria-controls</code> doivent référencer des <code>id</code> existants.'],
  '8.9': ['Les balises détournées pour la mise en forme perturbent la lecture structurée.', 'Remplacer les attributs et balises de présentation par du CSS.'],
  '9.1': ['Les titres servent de table des matières au lecteur d’écran : un saut de niveau ou un titre vide désoriente.', 'Un seul <code>h1</code>, des niveaux consécutifs, aucun titre vide.'],
  '9.2': ['Sans zone principale identifiée, impossible d’aller directement au contenu.', 'Entourer le contenu principal d’un <code>&lt;main&gt;</code> unique ; <code>header</code>, <code>nav</code>, <code>footer</code> pour les autres zones.'],
  '9.3': ['Une liste mal formée n’est pas annoncée comme telle (nombre d’éléments, position).', 'Ne placer que des <code>&lt;li&gt;</code> dans <code>&lt;ul&gt;</code> / <code>&lt;ol&gt;</code>, et des <code>&lt;li&gt;</code> uniquement dans une liste.'],
  '10.11': ['Le défilement horizontal sur mobile ou en zoom 400 % rend la lecture pénible.', 'Mise en page fluide : largeurs relatives, media queries, images redimensionnables.'],
  '11.1': ['Un champ sans étiquette est annoncé « champ de saisie » sans indication de ce qu’il attend.', 'Associer un <code>&lt;label for&gt;</code> à chaque champ, ou <code>aria-label</code> / <code>aria-labelledby</code>.'],
  '11.6': ['Sans légende, le lien entre des champs regroupés (boutons radio, cases) n’est pas annoncé.', 'Ajouter une <code>&lt;legend&gt;</code> non vide en premier enfant de chaque <code>&lt;fieldset&gt;</code>.'],
  '11.10': ['Sans message d’erreur relié au champ, l’utilisateur ne sait pas quoi corriger.', 'Relier le message au champ par <code>aria-describedby</code> et marquer <code>aria-invalid="true"</code>.'],
  '12.6': ['Le contenu hors de toute région (en-tête, navigation, principal, pied) échappe à la navigation rapide.', 'Inclure chaque bloc dans un landmark (<code>main</code>, <code>aside</code>, <code>footer</code>…).'],
  '12.8': ['Après une action, un focus mal placé oblige à tout reparcourir au clavier.', 'Déplacer le focus vers le premier champ en erreur ou vers le nouveau contenu.']
};

const pages = d.pages.filter((p) => !p.parcours);
const parcours = d.pages.filter((p) => p.parcours);
const estConnecte = (p) => CONNECTE.test(p.url);
const pagesConnectees = pages.filter(estConnecte);
const label = (p) => (p.parcours ? `parcours « ${p.parcours} »` : short(p.url));

// ---------- Indicateurs ----------
const testes = d.coverage.auto;
const critEchec = new Set(d.pages.flatMap((p) => p.violations.flatMap((v) => v.rgaaCriteria ?? [])).filter((c) => testes.includes(c)));
const taux = Math.round((100 * (testes.length - critEchec.size)) / testes.length);
const couleurTaux = taux >= 90 ? '#18753c' : taux >= 70 ? '#b34000' : '#ce0500';
const sevCount = d.totals.violationsBySeverity;
const totalOcc = Object.values(sevCount).reduce((s, n) => s + n, 0);
const occRevelees = d.pages.reduce((s, p) => s + p.violations.filter((v) => v.state).reduce((t, v) => t + v.nodeCount, 0), 0);

// ---------- Agrégats ----------
const parCritere = {};
const parTheme = {};
const parPage = [];
for (const p of d.pages) {
  const b = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of p.violations) {
    b[v.impact] = (b[v.impact] ?? 0) + v.nodeCount;
    for (const c of v.rgaaCriteria?.length ? v.rgaaCriteria : ['—']) {
      const e = (parCritere[c] ??= { occ: 0, pages: new Set(), regles: {}, sev: 'minor', revele: 0, exemples: [] });
      e.occ += v.nodeCount;
      e.pages.add(label(p));
      e.regles[v.rule] = (e.regles[v.rule] ?? 0) + v.nodeCount;
      if (SEV_ORDER.indexOf(v.impact) < SEV_ORDER.indexOf(e.sev)) e.sev = v.impact;
      if (v.state) e.revele += v.nodeCount;
      if (e.exemples.length < 4) e.exemples.push({ page: label(p), help: v.help, node: v.nodes[0], state: v.state, impact: v.impact });
      const t = theme(c) || 'Hors RGAA';
      parTheme[t] = (parTheme[t] ?? 0) + v.nodeCount;
    }
  }
  parPage.push({ p, b, total: Object.values(b).reduce((s, n) => s + n, 0) });
}
const criteresTries = Object.keys(parCritere).sort((a, b) => SEV_ORDER.indexOf(parCritere[a].sev) - SEV_ORDER.indexOf(parCritere[b].sev) || parCritere[b].occ - parCritere[a].occ || numSort(a, b));
const prioritaires = criteresTries.filter((c) => ['critical', 'serious'].includes(parCritere[c].sev));
const autres = criteresTries.filter((c) => !prioritaires.includes(c));
const maxTheme = Math.max(1, ...Object.values(parTheme));
const topPages = [...parPage].sort((a, b) => b.total - a.total).slice(0, 8).filter((x) => x.total);
const maxPage = Math.max(1, ...topPages.map((x) => x.total));

const findings = d.pages.flatMap((p) => p.findings.map((f) => ({ ...f, page: label(p) })));
const heur = findings.filter((f) => f.source !== 'ia');
const ia = findings.filter((f) => f.source === 'ia');
const iaRetenus = ia.filter((f) => typeof f.confidence === 'number' && f.confidence >= SEUIL_IA);
const grouper = (list) => { const g = {}; for (const f of list) (g[f.criterion] ??= []).push(f); return Object.entries(g).sort((a, b) => numSort(a[0], b[0])); };

// ---------- Composants ----------
const barre = (counts) => {
  const tot = Object.values(counts).reduce((s, n) => s + n, 0);
  if (!tot) return '<span class="vide">aucune</span>';
  return `<span class="stack" title="${SEV_ORDER.map((s) => `${SEV[s]} : ${counts[s] ?? 0}`).join(', ')}">${SEV_ORDER.filter((s) => counts[s]).map((s) => `<i style="width:${(100 * counts[s]) / tot}%;background:${SEV_COLOR[s]}"></i>`).join('')}</span> <b>${tot}</b>`;
};
const kpi = (n, l, color) => `<div class="kpi"${color ? ` style="border-top-color:${color}"` : ''}><strong${color ? ` style="color:${color}"` : ''}>${n}</strong><span>${l}</span></div>`;
const exemple = (x) => `<li><span class="ex-head">${chip(x.impact)} ${esc(x.help)}${x.state ? ` <span class="state">${esc(x.state)}</span>` : ''} <code class="page">${esc(x.page)}</code></span><code class="sel">${esc(x.node.target)}</code><pre>${esc(x.node.html.slice(0, 200))}</pre>${x.node.failureSummary ? `<p class="fix">${esc(resume(x.node.failureSummary).replace(/^Corriger (tous|l’un) (les|des) éléments suivants\s*:\s*/i, '').slice(0, 260))}</p>` : ''}</li>`;

const ficheCritere = (c, compact = false) => {
  const e = parCritere[c];
  const [impact, fix] = GUIDE[c] ?? [];
  return `<article class="fiche fiche-${e.sev}">
  <header><span class="num">${esc(c)}</span><div><h3>${esc(INTITULES[c] ?? 'Hors RGAA (bonne pratique)')}</h3><p class="meta">${esc(theme(c) || 'Hors RGAA')} · ${chip(e.sev)} · <b>${e.occ}</b> occurrence(s) sur <b>${e.pages.size}</b> page(s)/parcours${e.revele ? ` · <span class="state">${e.revele} révélée(s) par interaction</span>` : ''}</p></div></header>
  ${impact ? `<div class="guide"><p><b>Impact :</b> ${impact}</p><p><b>Correction :</b> ${fix}</p></div>` : ''}
  <p class="ou"><b>Où :</b> ${[...e.pages].slice(0, 10).map((p) => `<code>${esc(p)}</code>`).join(' ')}${e.pages.size > 10 ? ` <small>… +${e.pages.size - 10}</small>` : ''}</p>
  ${compact ? '' : `<ul class="exemples">${e.exemples.slice(0, 1).map(exemple).join('')}</ul>${e.exemples.length > 1 ? `<details><summary>${e.exemples.length - 1} autre(s) exemple(s)</summary><ul class="exemples">${e.exemples.slice(1).map(exemple).join('')}</ul></details>` : ''}`}
</article>`;
};

const mosaique = Object.keys(INTITULES).sort(numSort).map((c) => {
  const st = critEchec.has(c) ? 'echec' : testes.includes(c) ? 'ok' : d.coverage.review.includes(c) ? 'review' : 'hors';
  const nb = parCritere[c]?.occ;
  return `<span class="tuile t-${st}" title="${esc(c)} — ${esc(INTITULES[c])}">${c}${nb ? `<small>${nb}</small>` : ''}</span>`;
}).join('');

// ---------- Sections ----------
const htmlPages = parPage.filter((x) => !x.p.parcours).map(({ p, b }) => {
  const inter = p.interactions ?? {};
  const crits = [...new Set(p.violations.flatMap((v) => v.rgaaCriteria))].sort(numSort);
  const interTxt = p.interactions ? `${(inter.disclosures ?? []).length} dépliable(s), ${(inter.modals ?? []).length} modale(s)${inter.menu320?.length ? ', menu 320 px' : ''}${inter.aborted ? ` ⚠ ${inter.aborted}` : ''}` : '—';
  return `<tr><td><code>${esc(short(p.url))}</code><br><small>${estConnecte(p) ? '🔒 espace connecté' : 'public'} · ${esc(interTxt)}</small></td><td class="bar">${barre(b)}</td><td>${crits.map((c) => `<span class="mini">${c}</span>`).join(' ') || '—'}</td><td class="n">${p.findings.length}</td></tr>`;
}).join('');

const htmlParcours = parcours.map((pc) => `<article class="fiche fiche-parcours">
  <header><span class="num">▶</span><div><h3>${esc(pc.parcours)}</h3><p class="meta"><code>${esc(short(pc.url))}</code></p></div></header>
  <ol class="etapes">${(pc.etapes ?? []).map((e) => `<li>${esc(e.replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol>
  ${pc.violations.length ? `<p><b>${pc.violations.reduce((s, v) => s + v.nodeCount, 0)} occurrence(s) révélée(s) :</b></p><ul class="exemples">${pc.violations.map((v) => exemple({ impact: v.impact, help: `${v.rgaaCriteria.join(', ')} — ${v.help}`, state: v.state, page: label(pc), node: v.nodes[0] })).join('')}</ul>` : '<p class="ok">Aucune violation supplémentaire révélée par ce parcours.</p>'}
  ${pc.findings.length ? `<div class="guide"><p><b>À vérifier après l’action :</b></p><ul>${pc.findings.map((f) => `<li><b>${esc(f.criterion)}</b> ${esc(resume(f.message))}</li>`).join('')}</ul></div>` : ''}
</article>`).join('');

const htmlHeur = grouper(heur).map(([c, list]) => {
  const msgs = {};
  for (const f of list) (msgs[resume(f.message).replace(/\d+/g, 'N').slice(0, 80)] ??= { msg: resume(f.message), pages: new Set() }).pages.add(f.page);
  return `<tr><td><b>${esc(c)}</b><br><small>${esc(theme(c))}</small></td><td>${esc(INTITULES[c] ?? '')}</td><td class="n">${list.length}</td><td>${Object.values(msgs).slice(0, 3).map((m) => `<p>${esc(m.msg.slice(0, 200))}${m.msg.length > 200 ? '…' : ''} <small>(${m.pages.size} page(s))</small></p>`).join('')}</td></tr>`;
}).join('');

const jauge = (c) => `<span class="jauge" title="confiance ${Math.round(c * 100)} %"><i style="width:${Math.round(c * 100)}%"></i></span> ${Math.round(c * 100)} %`;
const htmlIA = grouper(iaRetenus).map(([c, list]) => `<tr><td><b>${esc(c)}</b><br><small>${esc(theme(c))}</small></td><td>${esc(INTITULES[c] ?? '')}</td><td class="n">${list.length}</td><td>${list.sort((a, b) => b.confidence - a.confidence).slice(0, 4).map((f) => `<p>${jauge(f.confidence)} ${esc(resume(f.message).slice(0, 170))}${f.message.length > 170 ? '…' : ''} <code class="page">${esc(f.page)}</code></p>`).join('')}${list.length > 4 ? `<p><small>… et ${list.length - 4} autre(s)</small></p>` : ''}</td></tr>`).join('');

const htmlAnnexe = d.pages.map((p) => `<details class="annexe"><summary><code>${esc(label(p))}</code> — ${barre(parPage.find((x) => x.p === p).b)} · ${p.findings.length} signalement(s)</summary>
  ${p.violations.length ? `<table><thead><tr><th>Critère</th><th>Règle</th><th>Sév.</th><th>Occ.</th><th>Exemples</th></tr></thead><tbody>${p.violations.map((v) => `<tr><td><b>${esc(v.rgaaCriteria.join(', ') || '—')}</b></td><td>${esc(v.help)}<br><code>${esc(v.rule)}</code>${v.state ? `<br><span class="state">${esc(v.state)}</span>` : ''}</td><td>${chip(v.impact)}</td><td class="n">${v.nodeCount}</td><td>${v.nodes.slice(0, 3).map((nd) => `<code class="sel">${esc(nd.target)}</code><pre>${esc(nd.html.slice(0, 140))}</pre>`).join('')}</td></tr>`).join('')}</tbody></table>` : '<p class="ok">Aucune violation sur cette page.</p>'}
  ${p.findings.length ? `<details><summary>${p.findings.length} signalement(s) « à vérifier »</summary><ul class="liste">${p.findings.map((f) => `<li><b>${esc(f.criterion)}</b> <small>${esc(f.source)}${typeof f.confidence === 'number' ? ` ${Math.round(f.confidence * 100)} %` : ''}</small> — ${esc(resume(f.message).slice(0, 240))}${f.state ? ` <span class="state">${esc(f.state)}</span>` : ''}</li>`).join('')}</ul></details>` : ''}
</details>`).join('');

const u = d.aiUsage;
let n = 0;
const sommaire = [];
const S = (t) => { n += 1; sommaire.push(`<a href="#s${n}">${n}. ${t}</a>`); return `<h2 id="s${n}"><span>${n}</span>${t}</h2>`; };

const corps = `
<div class="note"><b>Comment lire ce rapport.</b> Le taux porte sur les ${testes.length} critères RGAA qu’un test automatique peut trancher objectivement (sur 106) ; il n’est pas le taux officiel d’un audit, qui exige l’évaluation manuelle de tous les critères applicables. Les <b>violations</b> prouvent un échec ; les <b>signalements « à vérifier »</b> (heuristiques, IA, parcours) demandent une confirmation humaine et ne bloquent pas l’intégration continue. Les occurrences <span class="state">révélées par interaction</span> n’apparaissent qu’après ouverture d’un menu, d’un panneau ou d’une modale, ou après une action d’un parcours.</div>
${S('Vue d’ensemble')}
<div class="grid2">
  <div>
    <h3>Occurrences par sévérité</h3>
    <div class="kpis">${SEV_ORDER.map((s) => kpi(sevCount[s], SEV[s] + 's', SEV_COLOR[s])).join('')}</div>
    <div class="kpis">${kpi(totalOcc, 'occurrences au total')}${kpi(occRevelees, 'révélées par interaction ou parcours', '#7a4d00')}${kpi(critEchec.size, 'critères RGAA en échec')}${kpi(d.totals.findings, 'signalements « à vérifier »')}</div>
  </div>
  <div>
    <h3>Occurrences par thématique RGAA</h3>
    <div class="bars">${Object.entries(parTheme).sort((a, b) => b[1] - a[1]).map(([t, v]) => `<div class="row"><span class="lbl">${esc(t)}</span><span class="trk"><i style="width:${(100 * v) / maxTheme}%"></i></span><span class="val">${v}</span></div>`).join('')}</div>
  </div>
</div>
<h3>Pages et parcours les plus concernés</h3>
<div class="bars">${topPages.map(({ p, b, total }) => `<div class="row"><span class="lbl"><code>${esc(label(p))}</code></span><span class="trk">${SEV_ORDER.filter((s) => b[s]).map((s) => `<i style="width:${(100 * b[s]) / maxPage}%;background:${SEV_COLOR[s]}"></i>`).join('')}</span><span class="val">${total}</span></div>`).join('')}</div>
<p class="legende">${SEV_ORDER.map((s) => `<i style="background:${SEV_COLOR[s]}"></i>${SEV[s]}`).join(' ')}</p>


${S('Anomalies à corriger en priorité')}
<p>Critères présentant au moins une occurrence <b>critique</b> ou <b>sérieuse</b>, classés par gravité puis par nombre d’occurrences. Chaque fiche donne l’impact pour les utilisateurs, la correction attendue et des exemples localisés.</p>
${prioritaires.map((c) => ficheCritere(c)).join('') || '<p class="ok">Aucune violation critique ou sérieuse.</p>'}

${S('Autres anomalies')}
<p>Occurrences de sévérité modérée ou mineure.</p>
${autres.map((c) => ficheCritere(c, true)).join('') || '<p class="ok">Aucune.</p>'}

${S('Résultats par page')}
<table class="pages"><thead><tr><th>Page</th><th>Violations</th><th>Critères en échec</th><th>Signal.</th></tr></thead><tbody>${htmlPages}</tbody></table>

${parcours.length ? `${S('Parcours')}
<p>Un parcours rejoue des actions (recherche, soumission d’un formulaire…) puis analyse l’état obtenu ; seuls les défauts absents de l’état initial sont rapportés. Les vérifications d’état portent sur le contrôle de saisie (11.10), le focus (12.8), le titre de page (8.6) et les messages de statut (7.5).</p>
${htmlParcours}` : ''}

${S('À vérifier manuellement')}
<h3>Heuristiques et règles axe non concluantes <small>(${heur.length})</small></h3>
<table><thead><tr><th>Critère</th><th>Intitulé</th><th>Nb</th><th>Constats</th></tr></thead><tbody>${htmlHeur || '<tr><td colspan="4">Aucun</td></tr>'}</tbody></table>
${d.config.ai ? `<h3>Signalements IA <small>(${iaRetenus.length} retenus sur ${ia.length}, confiance ≥ ${Math.round(SEUIL_IA * 100)} %)</small></h3>
<p class="legende">Produits par le modèle ${esc(u?.model ?? 'IA')} sur les critères de jugement (pertinence des alternatives, intitulés, titres…). La confiance est auto-déclarée par le modèle : utile pour prioriser, pas une probabilité calibrée.${u ? ` ${u.calls} appel(s)${u.estimatedCostUsd != null ? `, coût ≈ ${u.estimatedCostUsd.toFixed(2)} $` : ''}.` : ''}</p>
<table><thead><tr><th>Critère</th><th>Intitulé</th><th>Nb</th><th>Signalements les plus sûrs</th></tr></thead><tbody>${htmlIA || '<tr><td colspan="4">Aucun</td></tr>'}</tbody></table>` : ''}
${d.siteFindings?.length ? `<h3>Inter-pages</h3><ul class="liste">${d.siteFindings.map((f) => `<li><b>${esc(f.criterion)}</b> — ${esc(resume(f.message))}</li>`).join('')}</ul>` : ''}

${S('Couverture des 106 critères RGAA')}
<p class="legende"><i class="t-echec"></i>en échec (nombre d’occurrences) <i class="t-ok"></i>testé automatiquement, conforme sur l’échantillon <i class="t-review"></i>couvert par des signalements « à vérifier » <i class="t-hors"></i>hors portée : audit manuel</p>
<div class="mosaique">${mosaique}</div>

${S('Annexe — détail par page')}
<p class="legende">Cliquer sur une page pour afficher le détail (dans le PDF, tout est déplié).</p>
${htmlAnnexe}`;

const doc = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Rapport d’accessibilité RGAA 4.1 — ${esc(NOM)}</title>
<style>
:root{--bleu:#000091;--gris:#666;--fond:#f6f6f6}
*{box-sizing:border-box} body{font-family:Marianne,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;color:#161616;line-height:1.5;background:#fff}
.bandeau{background:var(--bleu);color:#fff;padding:2.2rem 1.5rem 1.8rem} .bandeau .in{max-width:1100px;margin:0 auto;display:flex;flex-wrap:wrap;gap:2rem;align-items:center;justify-content:space-between}
.bandeau h1{margin:0 0 .4rem;font-size:1.9rem} .bandeau p{margin:.2rem 0;opacity:.92} .bandeau a{color:#fff}
.taux{background:#fff;color:${couleurTaux};border-radius:12px;padding:.8rem 1.4rem;text-align:center;min-width:12rem} .taux b{font-size:3rem;line-height:1;display:block} .taux span{font-size:.85rem;color:#333}
main{max-width:1100px;margin:0 auto;padding:0 1.5rem 3rem}
nav.sommaire{display:flex;flex-wrap:wrap;gap:.4rem .9rem;margin:1.2rem 0 0;font-size:.9rem} nav.sommaire a{color:var(--bleu);text-decoration:none;border-bottom:1px solid #ccd}
h2{display:flex;align-items:center;gap:.7rem;margin:2.6rem 0 1rem;font-size:1.45rem;color:var(--bleu);border-bottom:2px solid var(--bleu);padding-bottom:.3rem} h2 span{background:var(--bleu);color:#fff;border-radius:50%;width:2rem;height:2rem;display:inline-flex;align-items:center;justify-content:center;font-size:1rem;flex:none}
h3{font-size:1.05rem;margin:1.4rem 0 .5rem} h3 small{color:var(--gris);font-weight:normal}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:2rem} @media(max-width:800px){.grid2{grid-template-columns:1fr}}
.kpis{display:flex;flex-wrap:wrap;gap:.6rem;margin:.6rem 0} .kpi{flex:1 1 7rem;background:var(--fond);border-top:4px solid var(--bleu);border-radius:6px;padding:.6rem .8rem} .kpi strong{display:block;font-size:1.7rem;line-height:1.1;color:var(--bleu)} .kpi span{font-size:.82rem;color:#333}
.bars .row{display:grid;grid-template-columns:minmax(9rem,16rem) 1fr 3rem;align-items:center;gap:.6rem;margin:.3rem 0;font-size:.88rem} .bars .lbl{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .bars .trk{background:#eee;border-radius:4px;height:1rem;overflow:hidden;display:flex} .bars .trk i{display:block;height:100%;background:var(--bleu)} .bars .val{font-weight:600}
.legende{font-size:.82rem;color:#444;margin:.4rem 0} .legende i{display:inline-block;width:.9rem;height:.9rem;border-radius:3px;vertical-align:-2px;margin:0 .3rem 0 .6rem}
.note{background:#f5f5fe;border-left:4px solid var(--bleu);padding:.7rem 1rem;margin:1.4rem 0;font-size:.92rem;border-radius:0 6px 6px 0}
.chip{display:inline-block;border-radius:1rem;padding:0 .55rem;font-size:.75rem;font-weight:700;color:#fff;vertical-align:middle;white-space:nowrap} .chip-critical{background:#ce0500} .chip-serious{background:#e4794a} .chip-moderate{background:#716043} .chip-minor{background:#929292}
.state{background:#fef3e0;color:#7a4d00;border-radius:4px;padding:0 .4rem;font-size:.8em;white-space:nowrap}
.mini{display:inline-block;background:#e8edff;color:var(--bleu);border-radius:4px;padding:0 .35rem;font-size:.8rem;font-weight:600}
code{background:#f0f0f0;border-radius:3px;padding:0 .25rem;font-size:.85em} code.sel{color:var(--bleu);display:block;margin:.3rem 0 .1rem;word-break:break-all} code.page{background:#eef;color:#333;font-size:.78em}
pre{white-space:pre-wrap;word-break:break-all;background:#f7f7f7;border:1px solid #e5e5e5;border-radius:4px;padding:.35rem .5rem;font-size:.74rem;margin:.15rem 0 .3rem}
.fiche{border:1px solid #ddd;border-left:6px solid #929292;border-radius:8px;padding:.8rem 1rem .6rem;margin:.9rem 0;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.05)} .fiche-critical{border-left-color:#ce0500} .fiche-serious{border-left-color:#e4794a} .fiche-moderate{border-left-color:#716043} .fiche-parcours{border-left-color:var(--bleu)}
.fiche header{display:flex;gap:.9rem;align-items:flex-start} .fiche .num{background:var(--bleu);color:#fff;font-weight:700;border-radius:6px;padding:.25rem .5rem;font-size:1rem;min-width:3.2rem;text-align:center;flex:none} .fiche h3{margin:0;font-size:1rem} .fiche .meta{margin:.15rem 0 0;font-size:.85rem;color:#444}
.guide{background:var(--fond);border-radius:6px;padding:.4rem .8rem;margin:.6rem 0;font-size:.9rem} .guide p{margin:.25rem 0} .guide ul{margin:.2rem 0;padding-left:1.2rem}
.ou{font-size:.85rem;margin:.4rem 0} .ou code{margin-right:.2rem}
.exemples{list-style:none;padding:0;margin:.4rem 0} .exemples li{border-top:1px dashed #ddd;padding:.45rem 0;font-size:.88rem} .ex-head{display:block} .fix{margin:.1rem 0 0;font-size:.82rem;color:#444}
details{margin:.3rem 0} summary{cursor:pointer;color:var(--bleu);font-size:.9rem} details.annexe{border:1px solid #e5e5e5;border-radius:6px;padding:.3rem .8rem;margin:.5rem 0} details.annexe>summary{font-size:.95rem;color:#161616;padding:.3rem 0}
.etapes{margin:.4rem 0 .6rem;padding-left:1.4rem;font-size:.9rem} .etapes li{margin:.1rem 0}
table{border-collapse:collapse;width:100%;font-size:.88rem;margin:.6rem 0} th,td{border-bottom:1px solid #ddd;padding:.45rem .5rem;vertical-align:top;text-align:left} th{background:var(--fond);font-weight:600} td.n{text-align:right;white-space:nowrap} td.bar{min-width:11rem} table p{margin:.2rem 0}
.stack{display:inline-flex;width:7rem;height:.8rem;background:#eee;border-radius:4px;overflow:hidden;vertical-align:middle;margin-right:.4rem} .stack i{display:block;height:100%} .vide{color:#18753c;font-size:.85rem}
.jauge{display:inline-block;width:3.2rem;height:.55rem;background:#eee;border-radius:3px;overflow:hidden;vertical-align:middle} .jauge i{display:block;height:100%;background:#6e445a}
.mosaique{display:grid;grid-template-columns:repeat(auto-fill,minmax(4.2rem,1fr));gap:.3rem;margin:.6rem 0} .tuile{display:flex;justify-content:center;align-items:center;gap:.25rem;border-radius:4px;padding:.3rem .2rem;font-size:.82rem;font-weight:600;color:#161616} .tuile small{font-weight:400;opacity:.8}
.t-echec{background:#ffd6d6;color:#8b0000} .t-ok{background:#d9f3dd} .t-review{background:#fff2cc} .t-hors{background:#eee;color:#666}
.legende i.t-echec{background:#ffd6d6} .legende i.t-ok{background:#d9f3dd} .legende i.t-review{background:#fff2cc} .legende i.t-hors{background:#eee}
.liste{font-size:.88rem;padding-left:1.2rem} .liste li{margin:.25rem 0} .ok{color:#18753c}
footer{color:var(--gris);font-size:.8rem;margin-top:2rem;text-align:center}
@media print{
  @page{size:A4 portrait;margin:11mm 10mm}
  body{font-size:9.4pt;line-height:1.35} .bandeau{padding:1rem 1rem} .bandeau .in{flex-wrap:nowrap;gap:1rem} .bandeau h1{font-size:1.4rem} .taux{min-width:10rem;padding:.5rem .8rem} .taux b{font-size:2rem}
  main{max-width:none;padding:0} nav.sommaire{display:none}
  h2{break-before:page;margin-top:0;font-size:1.2rem} h2:first-of-type{break-before:auto} .note{margin:.8rem 0}
  .grid2{grid-template-columns:1fr 1fr;gap:1rem} .kpi strong{font-size:1.3rem}
  .fiche{box-shadow:none} .fiche header,.exemples li,tr,.kpi{break-inside:avoid}
  details>summary{list-style:none} details>summary::-webkit-details-marker{display:none}
  table{font-size:8pt} th,td{padding:.25rem .35rem} thead{display:table-header-group}
  pre{font-size:7pt} a{color:inherit;text-decoration:none}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style></head><body>
<div class="bandeau"><div class="in">
  <div>
    <h1>Rapport d’accessibilité RGAA 4.1 — ${esc(NOM)}</h1>
    <p>Analyse automatisée <b>rgaa-ci</b> · ${esc(date)}</p>
    <p>${pages.length} pages${pagesConnectees.length ? ` dont ${pagesConnectees.length} de l’espace connecté` : ''}${parcours.length ? ` · ${parcours.length} parcours` : ''} · axe-core, vérifications RGAA, scénarios d’interaction${d.config.ai ? ', tier IA' : ''}${pagesConnectees.length ? ', session SSO' : ''}</p>
    <p><a href="${esc(origine)}">${esc(origine)}</a></p>
  </div>
  <div class="taux"><b>${taux} %</b><span>de conformité sur les ${testes.length} critères testables automatiquement<br>(${testes.length - critEchec.size} sans violation)</span></div>
</div></div>
<main>
<nav class="sommaire">${sommaire.join('')}</nav>
${corps}
<footer>Généré par <code>scripts/rapport-plateforme.mjs</code> (rgaa-ci) à partir de <code>${esc(dossier)}/rgaa-report.json</code>.</footer>
</main></body></html>`;

const sortieHtml = join(dossier, 'rapport-complet.html');
writeFileSync(sortieHtml, doc, 'utf8');
console.log(`HTML : ${sortieHtml}`);
if (!SANS_PDF) {
  const sortiePdf = join(dossier, 'rapport-complet.pdf');
  // Version imprimable : toutes les sections repliables sont dépliées
  const tmp = join(dossier, '.rapport-complet-print.html');
  writeFileSync(tmp, doc.replaceAll('<details', '<details open'), 'utf8');
  try {
    execFileSync('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${resolve(sortiePdf)}`, `file://${resolve(tmp)}`], { stdio: 'ignore' });
    console.log(`PDF  : ${sortiePdf}`);
  } catch { console.warn('PDF non généré (google-chrome indisponible)'); } finally { rmSync(tmp, { force: true }); }
}
