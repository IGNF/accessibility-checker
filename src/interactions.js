/**
 * Scénarios d'interaction génériques exécutés dans le navigateur (spec Cypress).
 *
 * Une part importante des non-conformités relevées en audit manuel se trouve
 * dans des contenus absents du DOM rendu au chargement, ou masqués : menus,
 * panneaux dépliables, modales (cookies, bienvenue, paramètres d'affichage…).
 * Ce module détecte les déclencheurs de ces contenus à partir de la sémantique
 * ARIA/HTML (jamais de sélecteurs propres à un site) :
 *
 * - « dépliables » : `aria-expanded="false"`, `<summary>` d'un `<details>` fermé,
 *   `aria-controls` vers une cible masquée ;
 * - « modales » : `aria-haspopup="dialog"`, `data-fr-opened` (modales DSFR),
 *   `aria-controls` vers un élément `dialog` / `role="dialog"`.
 *
 * Les dépliables sont ouverts tous ensemble puis la page est réanalysée ; les
 * modales sont ouvertes une à une (analyse puis fermeture). Seules les
 * occurrences nouvelles sont ajoutées au rapport, avec l'état qui les a révélées.
 */

export const INTERACTION_LIMITS = { disclosures: 20, modals: 5 };

const DIALOG_SELECTOR = 'dialog, [role="dialog"], [role="alertdialog"]';

function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function controlledTargets(el, doc) {
  const ids = (el.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => doc.getElementById(id)).filter(Boolean);
}

/** Vrai si l'activation de l'élément risque de quitter la page (lien, soumission). */
function mayNavigate(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    return !(href === '' || href.startsWith('#'));
  }
  if (tag === 'input') return true;
  if (tag === 'button') {
    const type = (el.getAttribute('type') ?? 'submit').toLowerCase();
    return el.closest('form') && type !== 'button';
  }
  return false;
}

/** Vrai si l'élément ouvre une boîte de dialogue. */
export function isDialogTrigger(el, doc) {
  if (el.getAttribute('aria-haspopup') === 'dialog') return true;
  if (el.hasAttribute('data-fr-opened')) return true;
  return controlledTargets(el, doc).some((t) => t.matches(DIALOG_SELECTOR) || t.classList.contains('fr-modal'));
}

/** Vrai si l'élément déplie un contenu actuellement masqué (hors boîte de dialogue). */
export function isClosedDisclosure(el, doc) {
  if (el.getAttribute('aria-expanded') === 'false') return true;
  if (el.tagName.toLowerCase() === 'summary') {
    const details = el.closest('details');
    return !!details && !details.open;
  }
  const targets = controlledTargets(el, doc);
  return targets.length > 0 && targets.every((t) => !isVisible(t));
}

/** Libellé lisible d'un déclencheur (pour le rapport). */
export function describeTrigger(el) {
  const label = el.getAttribute('aria-label')
    || el.getAttribute('title')
    || el.textContent.replace(/\s+/g, ' ').trim()
    || el.querySelector('img[alt]')?.getAttribute('alt')
    || `<${el.tagName.toLowerCase()}>`;
  return label.slice(0, 60);
}

/**
 * Recense les déclencheurs visibles et actionnables de la page (ou d'un sous-arbre).
 * Retourne { disclosures, modals } : tableaux de { el, label }, bornés par `limits`.
 * `inDialogs` autorise les déclencheurs situés dans une boîte de dialogue ouverte
 * (sous-menus du menu mobile, par exemple).
 */
export function findTriggers(doc, root = doc.body, limits = INTERACTION_LIMITS, { inDialogs = false } = {}) {
  const candidates = Array.from(root.querySelectorAll(
    'button, [role="button"], summary, a[href^="#"], [aria-expanded], [aria-haspopup="dialog"], [aria-controls], [data-fr-opened]'
  ));
  const disclosures = [];
  const modals = [];
  const seen = new Set();
  for (const el of candidates) {
    if (seen.has(el) || !isVisible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
    if (mayNavigate(el)) continue;
    // Les commandes situées dans une boîte de dialogue fermée ne sont pas visibles ; celles
    // d'une boîte ouverte au chargement (cookies) sont laissées de côté : son contenu est déjà analysé.
    if (!inDialogs && el.closest(DIALOG_SELECTOR)) continue;
    seen.add(el);
    if (isDialogTrigger(el, doc)) {
      if (modals.length < limits.modals) modals.push({ el, label: describeTrigger(el) });
    } else if (isClosedDisclosure(el, doc)) {
      if (disclosures.length < limits.disclosures) disclosures.push({ el, label: describeTrigger(el) });
    }
  }
  return { disclosures, modals };
}

/** Boîtes de dialogue actuellement affichées. */
export function openDialogs(doc) {
  return Array.from(doc.querySelectorAll(`${DIALOG_SELECTOR}, .fr-modal--opened`)).filter(isVisible);
}

/**
 * Tente de fermer les boîtes de dialogue ouvertes : bouton de fermeture explicite,
 * puis touche Échap, puis nouveau clic sur le déclencheur.
 */
export function closeDialogs(doc, trigger) {
  for (const dlg of openDialogs(doc)) {
    const close = Array.from(dlg.querySelectorAll('button, [role="button"]')).find((b) => {
      if (!isVisible(b)) return false;
      const txt = `${b.getAttribute('aria-label') ?? ''} ${b.getAttribute('title') ?? ''} ${b.textContent}`.toLowerCase();
      return b.classList.contains('fr-btn--close') || b.hasAttribute('data-fr-js-modal-button') || /fermer|close/.test(txt);
    });
    if (close) close.click();
    if (dlg.tagName.toLowerCase() === 'dialog' && dlg.open && typeof dlg.close === 'function') dlg.close();
  }
  const esc = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
  doc.activeElement?.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', esc));
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', esc));
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keyup', esc));
  if (openDialogs(doc).length && trigger && isVisible(trigger) && trigger.getAttribute('aria-expanded') === 'true') {
    trigger.click();
  }
}

/** Empreinte d'une occurrence de violation, pour ne compter chaque défaut qu'une fois. */
export function violationKeys(violation) {
  return violation.nodes.map((n) => `${violation.rule}|${n.target}`);
}

/**
 * Ne conserve d'une liste de violations que les occurrences dont l'empreinte est
 * inconnue de `seen` (mis à jour), en annotant l'état qui les a révélées.
 */
export function newViolations(violations, seen, state) {
  const out = [];
  for (const v of violations) {
    const nodes = [];
    for (const n of v.nodes) {
      const key = `${v.rule}|${n.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push(n);
    }
    if (nodes.length) out.push({ ...v, nodes, nodeCount: nodes.length, state });
  }
  return out;
}
