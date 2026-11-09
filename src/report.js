const IMPACT_LABELS = {
  critical: 'Critique',
  serious: 'Sérieuse',
  moderate: 'Modérée',
  minor: 'Mineure'
};

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const SOURCE_LABELS = { heuristique: 'Heuristique', ia: 'IA', axe: 'axe-core' };

function findingsTable(findings, caption) {
  if (!findings?.length) return '';
  const rows = findings.map((f) => `
      <tr>
        <td><strong>${esc(f.criterion)}</strong></td>
        <td>${esc(f.theme)}</td>
        <td><span class="source source-${esc(f.source)}">${esc(SOURCE_LABELS[f.source] ?? f.source)}</span>${typeof f.confidence === 'number' ? ` (${Math.round(f.confidence * 100)} %)` : ''}</td>
        <td><code>${esc(f.target)}</code></td>
        <td>${esc(f.message)}${f.state ? ` <span class="state">${esc(f.state)}</span>` : ''}</td>
      </tr>`).join('');
  return `
      <table>
        <caption>${esc(caption)}</caption>
        <thead>
          <tr>
            <th scope="col">Critère RGAA</th>
            <th scope="col">Thématique</th>
            <th scope="col">Source</th>
            <th scope="col">Cible</th>
            <th scope="col">À vérifier</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
}

/** Génère un rapport HTML autonome et accessible à partir du résumé JSON. */
export function buildHtmlReport(summary) {
  const { totals } = summary;
  const pagesHtml = summary.pages.map((p) => {
    const rows = p.violations.map((v) => `
      <tr>
        <td><code>${esc(v.rule)}</code></td>
        <td>${v.rgaaCriteria.length ? v.rgaaCriteria.map((c) => `<strong>${esc(c)}</strong>`).join(', ') : '—'}</td>
        <td>${esc(v.rgaaTheme)}</td>
        <td><span class="impact impact-${esc(v.impact)}">${esc(IMPACT_LABELS[v.impact] ?? v.impact)}</span></td>
        <td>${v.nodeCount}</td>
        <td>
          ${esc(v.help)}${v.state ? ` <span class="state">${esc(v.state)}</span>` : ''}
          ${v.impact === 'critical' ? `
          <details>
            <summary>Détails (${v.nodes.length} exemple(s))</summary>
            <ul>
              ${v.nodes.map((n) => `<li><code>${esc(n.target)}</code><pre>${esc(n.html)}</pre></li>`).join('')}
            </ul>
            <p><a href="${esc(v.helpUrl)}" rel="noopener noreferrer">Documentation de la règle</a></p>
          </details>` : ''}
        </td>
      </tr>`).join('');

    const inter = p.interactions;
    const interHtml = inter
      ? `<p class="interactions">Scénarios d'interaction : ${(inter.disclosures ?? []).length} contenu(s) dépliable(s) et ${(inter.modals ?? []).length} modale(s) ouverts puis réanalysés${(inter.disclosures ?? []).length + (inter.modals ?? []).length ? ` (${esc([...(inter.disclosures ?? []), ...(inter.modals ?? [])].slice(0, 12).join(' · '))}${(inter.disclosures ?? []).length + (inter.modals ?? []).length > 12 ? ' …' : ''})` : ''}${inter.menu320?.length ? ` ; à 320 px, menu ouvert via ${esc(inter.menu320.join(' · '))}` : ''}.${inter.aborted ? ` <strong>Interrompus :</strong> ${esc(inter.aborted)}.` : ''}</p>`
      : '';

    const sectionId = `page-${esc(encodeURIComponent(p.parcours ? `${p.url}#parcours:${p.parcours}` : p.url))}`;
    const titre = p.parcours ? `Parcours « ${esc(p.parcours)} » — ${esc(p.url)}` : esc(p.url);
    const etapesHtml = p.parcours
      ? `<p class="interactions">Étapes : ${esc((p.etapes ?? []).join(' → '))}. Seuls les défauts absents de l'état initial de la page sont rapportés ici.</p>`
      : '';
    return `
    <section aria-labelledby="${sectionId}">
      <h2 id="${sectionId}">${titre}</h2>
      <p>${p.violations.length} règle(s) en échec — ${p.passesCount} règle(s) conformes — ${p.incompleteCount} à vérifier manuellement.</p>
      ${etapesHtml}
      ${interHtml}
      ${p.violations.length ? `
      <table>
        <caption>Violations détectées sur ${esc(p.url)}</caption>
        <thead>
          <tr>
            <th scope="col">Règle axe</th>
            <th scope="col">Critère(s) RGAA</th>
            <th scope="col">Thématique</th>
            <th scope="col">Sévérité</th>
            <th scope="col">Occurrences</th>
            <th scope="col">Description</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>` : '<p><strong>Aucune violation détectée.</strong></p>'}
      ${findingsTable(p.findings, `Signalements à vérifier manuellement sur ${p.url} (non bloquants)`)}
    </section>`;
  }).join('');

  const errorsHtml = summary.errors.length ? `
    <section aria-labelledby="titre-erreurs">
      <h2 id="titre-erreurs">Pages non analysées</h2>
      <ul>${summary.errors.map((e) => `<li>${e.parcours ? `Parcours « ${esc(e.parcours)} » — ` : ''}${esc(e.url)} — ${esc(e.error)}</li>`).join('')}</ul>
    </section>` : '';

  const siteFindingsHtml = summary.siteFindings?.length ? `
    <section aria-labelledby="titre-site">
      <h2 id="titre-site">Signalements à l'échelle du site</h2>
      ${findingsTable(summary.siteFindings, 'Signalements inter-pages à vérifier manuellement (non bloquants)')}
    </section>` : '';

  const cov = summary.coverage;
  const coverageHtml = cov ? `
<p><em>Couverture : <strong>${cov.auto.length}</strong> critère(s) RGAA testé(s) automatiquement et <strong>${cov.review.length}</strong> couvert(s) par des signalements « à vérifier », sur ${cov.total} (${Math.round(((cov.auto.length + cov.review.length) / cov.total) * 100)} %).
Les signalements (heuristiques${summary.config.ai ? ' et IA' : ''}) demandent une confirmation humaine et ne font pas échouer la CI.
Un audit manuel reste indispensable pour une déclaration de conformité.</em></p>` : `
<p><em>Avertissement : ces tests automatiques ne couvrent qu'une partie des critères RGAA.
Un audit manuel reste indispensable pour une déclaration de conformité.</em></p>`;

  const u = summary.aiUsage;
  const aiUsageHtml = u?.calls ? `
<p><em>Coût du tier IA : ${u.calls} appel(s) au modèle ${esc(u.model)}, ${u.inputTokens.toLocaleString('fr-FR')} tokens en entrée + ${u.outputTokens.toLocaleString('fr-FR')} en sortie${u.estimatedCostUsd == null ? '' : `, soit environ <strong>${u.estimatedCostUsd.toFixed(3)} $</strong> pour ce rapport (tarif indicatif)`}.</em></p>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rapport d'accessibilité RGAA — ${esc(summary.date)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 70rem; padding: 0 1rem; color: #1a1a1a; }
  h1 { border-bottom: 3px solid #000091; padding-bottom: .5rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  caption { text-align: left; font-weight: bold; margin-bottom: .5rem; }
  th, td { border: 1px solid #666; padding: .5rem; text-align: left; vertical-align: top; }
  th { background: #eee; }
  pre { white-space: pre-wrap; word-break: break-all; background: #f5f5f5; padding: .5rem; font-size: .8rem; }
  .impact { padding: .15rem .5rem; border-radius: .25rem; font-weight: bold; white-space: nowrap; }
  .impact-critical { background: #ce0500; color: #fff; }
  .impact-serious { background: #b34000; color: #fff; }
  .impact-moderate { background: #716043; color: #fff; }
  .impact-minor { background: #eee; color: #1a1a1a; }
  .source { padding: .15rem .5rem; border-radius: .25rem; font-weight: bold; white-space: nowrap; }
  .source-heuristique { background: #e8edff; color: #000091; }
  .source-ia { background: #feebcb; color: #6e445a; }
  .source-axe { background: #e3f3e3; color: #18753c; }
  .state { display: inline-block; margin-left: .25rem; padding: .1rem .4rem; border-radius: .25rem; background: #fef3e0; color: #7a4d00; font-size: .85em; }
  .interactions { color: #444; font-size: .9em; }
  .kpi { display: inline-block; margin-right: 2rem; }
  .kpi strong { font-size: 1.5rem; display: block; }
</style>
</head>
<body>
<h1>Rapport d'accessibilité RGAA</h1>
<p>Référentiel : ${esc(summary.referential)} — Généré le ${esc(new Date(summary.date).toLocaleString('fr-FR'))}</p>
${coverageHtml}
${aiUsageHtml}
<section aria-labelledby="titre-synthese">
  <h2 id="titre-synthese">Synthèse</h2>
  <p>
    <span class="kpi"><strong>${totals.pages}</strong> pages analysées</span>${totals.parcours ? `
    <span class="kpi"><strong>${totals.parcours}</strong> parcours rejoués</span>` : ''}
    <span class="kpi"><strong>${totals.violationsBySeverity.critical}</strong> critiques</span>
    <span class="kpi"><strong>${totals.violationsBySeverity.serious}</strong> sérieuses</span>
    <span class="kpi"><strong>${totals.violationsBySeverity.moderate}</strong> modérées</span>
    <span class="kpi"><strong>${totals.violationsBySeverity.minor}</strong> mineures</span>
    <span class="kpi"><strong>${totals.findings ?? 0}</strong> signalements à vérifier</span>
  </p>
  <p>Seuil d'échec CI : <code>${esc(summary.config.failOn)}</code> — Occurrences au-dessus du seuil : <strong>${totals.violationsAboveThreshold}</strong> (tolérance : ${summary.config.maxViolations})</p>
</section>
${siteFindingsHtml}
${pagesHtml}
${errorsHtml}
</body>
</html>`;
}
