/**
 * Tests inter-pages (nécessitent au moins 2 pages analysées) : produisent des
 * signalements « à vérifier », jamais bloquants, car la détection des systèmes
 * de navigation reste heuristique (recherche derrière un menu replié, etc.).
 */

/** Signalements RGAA 12.1 et 12.2 à partir des caractéristiques collectées par page. */
export function runCrossPageChecks(pages) {
  const findings = [];
  const withFeatures = pages.filter((p) => p.pageFeatures);
  if (withFeatures.length < 2) return findings;

  // RGAA 12.1 : au moins deux systèmes de navigation parmi menu, recherche, plan du site
  const systems = [
    withFeatures.some((p) => p.pageFeatures.navPaths.length > 0),
    withFeatures.some((p) => p.pageFeatures.hasSearch),
    withFeatures.some((p) => p.pageFeatures.hasSitemapLink)
  ].filter(Boolean).length;
  if (systems < 2) {
    findings.push({
      criterion: '12.1',
      theme: 'Navigation',
      source: 'heuristique',
      target: `ensemble du site (${withFeatures.length} pages analysées)`,
      message: `${systems} système(s) de navigation détecté(s) parmi : menu de navigation, moteur de recherche, plan du site. Le RGAA en exige au moins deux. Vérifier qu'un second système n'est pas présent sous une autre forme (menu replié, recherche dans un panneau…).`
    });
  }

  // RGAA 12.2 : les zones de navigation doivent occuper la même place sur toutes les pages
  const withNav = withFeatures.filter((p) => p.pageFeatures.navPaths.length > 0);
  if (withNav.length >= 2) {
    const common = withNav
      .map((p) => new Set(p.pageFeatures.navPaths))
      .reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
    if (common.size === 0) {
      findings.push({
        criterion: '12.2',
        theme: 'Navigation',
        source: 'heuristique',
        target: withNav.slice(0, 3).map((p) => p.url).join(' ; '),
        message: 'Aucune zone de navigation commune (même emplacement dans le DOM) entre les pages analysées. Vérifier que les menus sont présents au même endroit d\'une page à l\'autre.'
      });
    }
  }

  return findings;
}
