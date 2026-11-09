/**
 * Vérifications RGAA complémentaires exécutées dans le navigateur (spec Cypress) :
 * violations déterministes (même format que les résultats axe, mappées via
 * rgaa-mapping.js), signalements heuristiques « à vérifier », collecte des
 * caractéristiques de page (tests inter-pages) et des extraits pour le tier IA.
 */

const RGAA_URL = (c) => `https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#${c}`;

/** Sélecteur approximatif mais lisible d'un élément (tag + position). */
function cssPath(el) {
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && cur.tagName !== 'HTML' && parts.length < 4) {
    const tag = cur.tagName.toLowerCase();
    if (cur.id) { parts.unshift(`${tag}#${cur.id}`); break; }
    const siblings = cur.parentElement
      ? Array.from(cur.parentElement.children).filter((c) => c.tagName === cur.tagName)
      : [];
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(cur) + 1})` : tag);
    cur = cur.parentElement;
  }
  return parts.join(' > ') || el.tagName?.toLowerCase() || '?';
}

function isVisible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function nodeOf(el, failureSummary) {
  return { target: [cssPath(el)], html: (el.outerHTML ?? '').slice(0, 300), failureSummary };
}

/** Violations déterministes hors axe-core : 8.1, 8.9, 11.6. */
export function runCustomChecks(win) {
  const doc = win.document;
  const out = [];

  // RGAA 8.1 (tests 8.1.1/8.1.2) : type de document présent et valide
  const dt = doc.doctype;
  if (!dt || dt.name.toLowerCase() !== 'html') {
    out.push({
      id: 'rgaa-doctype',
      impact: 'moderate',
      description: 'Chaque page web doit être définie par un type de document valide (RGAA 8.1)',
      help: dt ? `Doctype invalide : <!DOCTYPE ${dt.name}>` : 'Doctype absent',
      helpUrl: RGAA_URL('8.1'),
      nodes: [{
        target: ['html'],
        html: dt ? `<!DOCTYPE ${dt.name}>` : '(aucune déclaration de doctype)',
        failureSummary: 'Déclarer <!DOCTYPE html> avant la balise <html>.'
      }]
    });
  }

  // RGAA 8.9 (test 8.9.1) : balises et attributs employés uniquement à des fins de présentation
  const presentational = Array.from(doc.querySelectorAll(
    'basefont, big, blink, center, font, marquee, strike, tt, [align], [bgcolor], [background], [hspace], [vspace]'
  ));
  if (presentational.length) {
    out.push({
      id: 'rgaa-presentation-markup',
      impact: 'minor',
      description: 'Les balises ne doivent pas être utilisées uniquement à des fins de présentation (RGAA 8.9)',
      help: 'Balises ou attributs de présentation obsolètes détectés',
      helpUrl: RGAA_URL('8.9'),
      nodes: presentational.map((el) => nodeOf(el, 'Remplacer la mise en forme en HTML par des styles CSS.'))
    });
  }

  // RGAA 11.6 (test 11.6.1) : chaque regroupement de champs (fieldset) a une légende
  const fieldsets = Array.from(doc.querySelectorAll('fieldset')).filter((fs) => {
    if (!fs.querySelector('input:not([type="hidden"]), select, textarea')) return false;
    const legend = fs.querySelector(':scope > legend');
    return !legend || !legend.textContent.trim();
  });
  if (fieldsets.length) {
    out.push({
      id: 'rgaa-fieldset-legend',
      impact: 'moderate',
      description: 'Chaque regroupement de champs de formulaire doit avoir une légende (RGAA 11.6)',
      help: 'Élément <fieldset> sans <legend> renseignée',
      helpUrl: RGAA_URL('11.6'),
      nodes: fieldsets.map((el) => nodeOf(el, 'Ajouter une <legend> non vide en premier enfant du <fieldset>.'))
    });
  }

  return out;
}

const REFLOW_EXCEPTIONS = 'table, img, svg, video, canvas, iframe, object, embed, pre';

/**
 * RGAA 10.11 (test 10.11.1) : pas de défilement horizontal à 320 px de large.
 * À appeler sous un viewport de 320 px. Retourne { violation } ou { finding }
 * (signalement si le débordement vient d'un contenu bénéficiant d'une exception :
 * tableau de données, image, carte…), ou null.
 */
export function checkReflow(win) {
  const doc = win.document;
  const de = doc.documentElement;
  const width = de.clientWidth;
  // Le débordement d'une boîte de dialogue ouverte (menu mobile, modale) n'est pas
  // reflété par documentElement.scrollWidth : on examine aussi ces conteneurs.
  const roots = [de, doc.body, ...doc.querySelectorAll('dialog[open], [role="dialog"], .fr-modal--opened')]
    .filter((el) => el && (el === de || isVisible(el)));
  const scrollWidth = Math.max(...roots.map((el) => el.scrollWidth));
  if (scrollWidth <= width + 16) return null;

  const offenders = [];
  for (const el of doc.body.querySelectorAll('*')) {
    if (isVisible(el) && el.getBoundingClientRect().right > width + 16) {
      offenders.push(el);
      if (offenders.length >= 5) break;
    }
  }

  const wideException = Array.from(doc.querySelectorAll(REFLOW_EXCEPTIONS))
    .some((el) => el.getBoundingClientRect().width > width);
  const detail = `largeur de contenu ${scrollWidth}px pour un viewport de ${width}px`;

  if (wideException) {
    return {
      finding: {
        criterion: '10.11',
        theme: 'Présentation',
        source: 'heuristique',
        target: offenders.map(cssPath).join(' ; ') || 'html',
        message: `Défilement horizontal à 320 px (${detail}), causé au moins en partie par un contenu pouvant bénéficier d'une exception (tableau de données, image, carte…). Vérifier manuellement.`
      }
    };
  }
  return {
    violation: {
      id: 'rgaa-reflow-320',
      impact: 'moderate',
      description: 'Le contenu doit rester consultable sans défilement horizontal à 320 px de large (RGAA 10.11)',
      help: `Défilement horizontal à 320 px (${detail})`,
      helpUrl: RGAA_URL('10.11'),
      nodes: offenders.length
        ? offenders.map((el) => nodeOf(el, 'Adapter la mise en page (largeurs fluides, media queries).'))
        : [{ target: ['html'], html: detail, failureSummary: 'Adapter la mise en page.' }]
    }
  };
}

/**
 * État d'un formulaire après soumission (mode parcours) : signalements « à vérifier »
 * sur le contrôle de saisie (11.10), la gestion du focus (12.8), le titre de page (8.6)
 * et les messages de statut (7.5). `titleBefore` est le <title> relevé avant l'action.
 */
export function checkFormState(win, { titleBefore } = {}) {
  const doc = win.document;
  const txt = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const out = [];
  const push = (criterion, theme, target, message) => out.push({ criterion, theme, source: 'heuristique', target, message });

  const invalidFields = Array.from(doc.querySelectorAll(
    'input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"], ' +
    '.fr-input-group--error input, .fr-input-group--error textarea, .fr-select-group--error select, ' +
    '.fr-fieldset--error input, .fr-checkbox-group--error input, .fr-radio-group--error input, ' +
    'input:invalid, select:invalid, textarea:invalid'
  )).filter(isVisible);
  const errorMessages = Array.from(doc.querySelectorAll(
    '.fr-error-text, .fr-message--error, [role="alert"], [aria-live="assertive"], [aria-live="polite"], .error, .invalid-feedback'
  )).filter((el) => isVisible(el) && txt(el));

  if (!invalidFields.length && !errorMessages.length) {
    push('11.10', 'Formulaires', 'form',
      'Après soumission, aucun champ marqué invalide ni message d’erreur visible n’a été trouvé : vérifier que le contrôle de saisie signale les erreurs (champs obligatoires, format attendu).');
    return out;
  }

  // 11.10 : chaque champ en erreur doit être relié à son message (aria-describedby / aria-errormessage)
  const unlinked = invalidFields.filter((f) => {
    const ids = `${f.getAttribute('aria-describedby') ?? ''} ${f.getAttribute('aria-errormessage') ?? ''}`.split(/\s+/).filter(Boolean);
    return !ids.some((id) => txt(doc.getElementById(id)));
  });
  if (unlinked.length) {
    push('11.10', 'Formulaires', unlinked.slice(0, 5).map(cssPath).join(' ; '),
      `${unlinked.length} champ(s) en erreur sans message relié par aria-describedby/aria-errormessage (ou cible vide) : vérifier que le message d’erreur est restitué avec le champ.`);
  }

  // 12.8 : le focus doit être déplacé vers la première erreur (champ ou résumé d'erreurs)
  const active = doc.activeElement;
  const firstInvalid = invalidFields[0];
  const focusOnError = active && active !== doc.body
    && (invalidFields.includes(active) || errorMessages.some((m) => m === active || m.contains(active)) || active.closest('[role="alert"], [aria-live]'));
  if (!focusOnError) {
    push('12.8', 'Navigation', firstInvalid ? cssPath(firstInvalid) : 'form',
      `Après soumission avec erreurs, le focus est sur « ${active && active !== doc.body ? cssPath(active) : 'body'} » et non sur le premier champ en erreur ou un résumé des erreurs : vérifier l’ordre de tabulation et la gestion du focus.`);
  }

  // 8.6 : le titre de page devrait refléter l'état d'erreur
  if (titleBefore && doc.title === titleBefore) {
    push('8.6', 'Éléments obligatoires', 'title',
      `Le <title> est inchangé (« ${doc.title.slice(0, 80)} ») alors que le formulaire présente des erreurs : vérifier qu’il annonce l’erreur (ex. « Erreur – … »).`);
  }

  // 7.5 : les messages d'erreur apparus doivent être restitués (zone de statut ou focus)
  const announced = errorMessages.some((m) => m.closest('[role="alert"], [role="status"], [aria-live]'));
  if (errorMessages.length && !announced && !focusOnError) {
    push('7.5', 'Scripts', errorMessages.slice(0, 3).map(cssPath).join(' ; '),
      'Des messages d’erreur sont apparus hors de toute zone de statut (role="alert"/"status", aria-live) et sans déplacement du focus : vérifier qu’ils sont restitués par les technologies d’assistance.');
  }
  return out;
}

/** Signalements heuristiques « à vérifier » : 1.9, 4.1, 10.5, 10.6, 10.7, 11.10, 12.7, 12.8, 12.9 et 13.3. */
export function collectFindings(win) {
  return [
    ...scanCaptionedImages(win),
    ...scanFocusSuppression(win),
    ...scanColorOnlyLinks(win),
    ...scanRequiredIndication(win),
    ...scanTabBlocking(win),
    ...scanSkipLink(win),
    ...scanPositiveTabindex(win),
    ...scanOfficeDocuments(win),
    ...scanMultimedia(win),
    ...scanDefaultBackground(win)
  ];
}

// RGAA 1.9 (test 1.9.1) : image légendée = <figure role="group"> dont l'aria-label reprend la <figcaption>
function scanCaptionedImages(win) {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  const offenders = Array.from(win.document.querySelectorAll('figure')).filter((fig) => {
    const caption = fig.querySelector(':scope > figcaption');
    if (!caption || !fig.querySelector('img, svg, canvas, picture, [role="img"]')) return false;
    return fig.getAttribute('role') !== 'group' || norm(fig.getAttribute('aria-label')) !== norm(caption.textContent);
  });
  if (!offenders.length) return [];
  return [{
    criterion: '1.9',
    theme: 'Images',
    source: 'heuristique',
    target: offenders.slice(0, 5).map(cssPath).join(' ; '),
    message: `${offenders.length} image(s) légendée(s) (<figure> + <figcaption>) sans role="group" ou dont l'aria-label ne reprend pas la légende. Vérifier que la légende est correctement liée à l'image (RGAA 1.9).`
  }];
}

// RGAA 10.6 (test 10.6.1) : lien texte dans un bloc de texte signalé uniquement par la couleur
function scanColorOnlyLinks(win) {
  const doc = win.document;
  const style = (el) => win.getComputedStyle(el);
  const hasOwnText = (block, a) => Array.from(block.childNodes)
    .some((n) => n.nodeType === 3 && n.textContent.trim().length > 1 && !a.contains(n));
  const offenders = [];
  for (const a of Array.from(doc.querySelectorAll('p a[href], li a[href], td a[href], dd a[href]'))) {
    const block = a.closest('p, li, td, dd');
    if (!block || !isVisible(a) || !a.textContent.trim() || !hasOwnText(block, a)) continue;
    if (a.querySelector('img, svg')) continue;
    const sa = style(a); const sb = style(block);
    const decorated = ['text-decoration-line', 'border-bottom-style', 'outline-style']
      .some((p) => !['none', ''].includes(sa.getPropertyValue(p)));
    const otherCue = sa.fontWeight !== sb.fontWeight || sa.fontStyle !== sb.fontStyle ||
      sa.backgroundColor !== sb.backgroundColor || sa.textTransform !== sb.textTransform;
    if (!decorated && !otherCue && sa.color !== sb.color) offenders.push(a);
    if (offenders.length >= 20) break;
  }
  if (!offenders.length) return [];
  return [{
    criterion: '10.6',
    theme: 'Présentation',
    source: 'heuristique',
    target: offenders.slice(0, 5).map(cssPath).join(' ; '),
    message: `${offenders.length} lien(s) dans un bloc de texte ne se distinguent du texte environnant que par la couleur (ni soulignement, ni graisse, ni bordure). Vérifier qu'un indice autre que la couleur existe (RGAA 10.6).`
  }];
}

// RGAA 11.10 (test 11.10.1) : champs obligatoires sans indication visible du caractère obligatoire
function scanRequiredIndication(win) {
  const offenders = [];
  for (const form of Array.from(win.document.querySelectorAll('form'))) {
    const required = Array.from(form.querySelectorAll('[required], [aria-required="true"]')).filter(isVisible);
    if (!required.length) continue;
    const texte = `${form.textContent} ${Array.from(form.querySelectorAll('[placeholder], [title]'))
      .map((el) => `${el.getAttribute('placeholder')} ${el.getAttribute('title')}`).join(' ')}`;
    if (!/\*|obligatoire|requis|required|mandatory/i.test(texte)) offenders.push(form);
  }
  if (!offenders.length) return [];
  return [{
    criterion: '11.10',
    theme: 'Formulaires',
    source: 'heuristique',
    target: offenders.slice(0, 5).map(cssPath).join(' ; '),
    message: `${offenders.length} formulaire(s) comportent des champs obligatoires (required / aria-required) sans indication textuelle visible du caractère obligatoire (astérisque, mention « obligatoire »…). Vérifier l'aide à la saisie (RGAA 11.10).`
  }];
}

// RGAA 4.1 : présence de médias temporels → transcription/sous-titres/audiodescription à vérifier
function scanMultimedia(win) {
  const media = Array.from(win.document.querySelectorAll(
    'video, audio, iframe[src*="youtube" i], iframe[src*="youtu.be" i], iframe[src*="vimeo" i], iframe[src*="dailymotion" i]'
  ));
  if (!media.length) return [];
  return [{
    criterion: '4.1',
    theme: 'Multimédia',
    source: 'heuristique',
    target: media.slice(0, 5).map(cssPath).join(' ; '),
    message: `${media.length} média(s) temporel(s) détecté(s). Vérifier la transcription textuelle (4.1), les sous-titres synchronisés (4.3) et l'audiodescription (4.5).`
  }];
}

// RGAA 10.5 : couleurs de police utilisées sans couleur de fond définie (fond par défaut du navigateur)
function scanDefaultBackground(win) {
  const transparent = (el) => {
    const bg = win.getComputedStyle(el).backgroundColor;
    return bg === 'transparent' || /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)$/.test(bg);
  };
  const doc = win.document;
  if (!transparent(doc.documentElement) || !transparent(doc.body)) return [];
  return [{
    criterion: '10.5',
    theme: 'Présentation',
    source: 'heuristique',
    target: 'html, body',
    message: 'Aucune couleur de fond n\u2019est définie sur html/body : la page repose sur le fond par défaut du navigateur. Vérifier que chaque couleur de police s\u2019accompagne d\u2019une couleur de fond définie (RGAA 10.5).'
  }];
}

// RGAA 10.7 : règles CSS qui suppriment l'indicateur de focus sans alternative dans la même règle
function scanFocusSuppression(win) {
  const offenders = [];
  const visit = (rules) => {
    for (const r of Array.from(rules ?? [])) {
      if (r.cssRules?.length) visit(r.cssRules); // @media et règles imbriquées
      const sel = r.selectorText;
      if (!sel || !sel.includes(':focus') || !r.style) continue;
      const st = r.style;
      const outlineOff =
        st.getPropertyValue('outline-style') === 'none' ||
        ['0', '0px'].includes(st.getPropertyValue('outline-width')) ||
        /^(none|0)/.test(st.getPropertyValue('outline'));
      const hasAlternative = ['box-shadow', 'border', 'border-color', 'border-bottom',
        'background', 'background-color', 'text-decoration']
        .some((p) => { const v = st.getPropertyValue(p); return v && v !== 'none'; });
      if (outlineOff && !hasAlternative) offenders.push(sel);
    }
  };
  for (const sheet of Array.from(win.document.styleSheets)) {
    try { visit(sheet.cssRules); } catch { /* feuille cross-origin illisible */ }
  }
  if (!offenders.length) return [];
  return [{
    criterion: '10.7',
    theme: 'Présentation',
    source: 'heuristique',
    target: offenders.slice(0, 10).join(' ; '),
    message: `${offenders.length} règle(s) CSS suppriment l'indicateur de focus (outline) sans alternative visible dans la même règle. Vérifier au clavier que la prise de focus reste visible.`
  }];
}

// RGAA 12.9 : gestionnaires qui bloquent la touche Tab (piège clavier potentiel)
function scanTabBlocking(win) {
  const doc = win.document;
  const focusables = Array.from(doc.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'))
    .filter((el) => isVisible(el) && el.tabIndex >= 0)
    .slice(0, 30);
  const blocked = [];
  for (const el of focusables) {
    try { el.focus({ preventScroll: true }); } catch { continue; }
    if (doc.activeElement !== el) continue;
    const ev = new win.KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    if (ev.defaultPrevented) blocked.push(el);
  }
  try { doc.activeElement?.blur?.(); } catch { /* sans conséquence */ }
  if (!blocked.length) return [];
  return [{
    criterion: '12.9',
    theme: 'Navigation',
    source: 'heuristique',
    target: blocked.slice(0, 5).map(cssPath).join(' ; '),
    message: `${blocked.length} élément(s) interceptent la touche Tab (preventDefault). Vérifier au clavier qu'il ne s'agit pas d'un piège (une fenêtre modale qui gère elle-même le focus est légitime).`
  }];
}

// RGAA 12.7 : présence d'un lien d'évitement vers la zone de contenu principal
function scanSkipLink(win) {
  const doc = win.document;
  const anchors = Array.from(doc.querySelectorAll('a[href^="#"]')).filter((a) => a.hash.length > 1);
  const hasSkip = anchors.some((a) => {
    const target = doc.getElementById(decodeURIComponent(a.hash.slice(1)));
    if (!target) return false;
    return target.matches('main, [role="main"]') || /contenu|content|main/i.test(target.id) ||
      /aller au contenu|accès rapide|skip|éviter/i.test(a.textContent);
  });
  if (hasSkip) return [];
  return [{
    criterion: '12.7',
    theme: 'Navigation',
    source: 'heuristique',
    target: 'body',
    message: 'Aucun lien d’évitement (ancre interne) vers la zone de contenu principal n’a été trouvé. Vérifier au clavier qu’un accès rapide au contenu existe.'
  }];
}

// RGAA 12.8 : tabindex positifs = ordre de tabulation imposé, souvent incohérent
function scanPositiveTabindex(win) {
  const offenders = Array.from(win.document.querySelectorAll('[tabindex]'))
    .filter((el) => Number(el.getAttribute('tabindex')) > 0);
  if (!offenders.length) return [];
  return [{
    criterion: '12.8',
    theme: 'Navigation',
    source: 'heuristique',
    target: offenders.slice(0, 5).map(cssPath).join(' ; '),
    message: `${offenders.length} élément(s) avec tabindex positif imposent un ordre de tabulation artificiel. Vérifier au clavier que l’ordre de tabulation reste cohérent.`
  }];
}

const OFFICE_EXT = /\.(pdf|docx?|odt|ods|odp|xlsx?|pptx?|rtf)([?#]|$)/i;

// RGAA 13.3 : documents bureautiques en téléchargement → vérifier leur accessibilité
function scanOfficeDocuments(win) {
  const seen = new Set();
  const docs = [];
  for (const a of Array.from(win.document.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    if (!OFFICE_EXT.test(href) || seen.has(href)) continue;
    seen.add(href);
    docs.push(a);
  }
  if (!docs.length) return [];
  return [{
    criterion: '13.3',
    theme: 'Consultation',
    source: 'heuristique',
    target: docs.slice(0, 10).map((a) => a.getAttribute('href')).join(' ; '),
    message: `${docs.length} document(s) bureautique(s) en téléchargement (PDF, Office…). Vérifier que chacun est accessible (balisage, ordre de lecture) ou possède une version accessible équivalente.`
  }];
}

/** Caractéristiques de page pour les tests inter-pages (12.1, 12.2). */
export function collectPageFeatures(win) {
  const doc = win.document;
  const navPaths = Array.from(doc.querySelectorAll('nav, [role="navigation"]')).slice(0, 5).map(cssPath);
  const hasSearch = !!doc.querySelector(
    '[role="search"], input[type="search"], form[action*="search" i], form[action*="recherche" i]'
  );
  const hasSitemapLink = Array.from(doc.querySelectorAll('a[href]'))
    .some((a) => /plan\s*du\s*site|sitemap/i.test(`${a.textContent} ${a.getAttribute('href')}`));
  return { navPaths, hasSearch, hasSitemapLink };
}

/**
 * Liens internes (même origine) de la page, dédoublonnés et sans fragment :
 * sert de graine pour élargir l'échantillon (espace connecté, pages profondes).
 */
export function collectInternalLinks(win, max = 150) {
  const doc = win.document;
  const out = new Set();
  for (const a of doc.querySelectorAll('a[href]')) {
    let u;
    try { u = new win.URL(a.getAttribute('href'), win.location.href); } catch { continue; }
    if (u.origin !== win.location.origin || !/^https?:$/.test(u.protocol)) continue;
    u.hash = '';
    if (u.href === win.location.href.split('#')[0]) continue;
    out.add(u.href);
    if (out.size >= max) break;
  }
  return Array.from(out);
}

/** Extraits de page soumis au tier IA (uniquement si --ai est actif). */
export function collectAiExtracts(win, maxItems = 20) {
  const doc = win.document;
  const txt = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const absUrl = (src) => { try { return new win.URL(src, win.location.href).href; } catch { return null; } };

  const seen = new Set();
  const liens = [];
  for (const a of doc.querySelectorAll('a[href]')) {
    if (liens.length >= maxItems || !isVisible(a)) continue;
    const texte = txt(a) || a.getAttribute('aria-label') || a.title || '';
    if (!texte) continue;
    const key = `${texte}|${a.getAttribute('href')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    liens.push({
      texte: texte.slice(0, 120),
      href: (a.getAttribute('href') ?? '').slice(0, 150),
      contexte: txt(a.closest('p, li, td, th, h1, h2, h3, nav') ?? a.parentElement).slice(0, 150)
    });
  }

  const boutons = Array.from(doc.querySelectorAll(
    'button, input[type="submit"], input[type="button"], input[type="reset"], [role="button"]'
  )).filter(isVisible).slice(0, maxItems).map((b) => ({
    intitule: (txt(b) || b.value || b.getAttribute('aria-label') || b.title || '').slice(0, 120),
    contexte: txt(b.closest('form, p, li, td') ?? b.parentElement).slice(0, 150)
  }));

  const labelOf = (f) => {
    if (f.id) {
      const l = doc.querySelector(`label[for="${win.CSS?.escape ? win.CSS.escape(f.id) : f.id}"]`);
      if (l) return txt(l);
    }
    return txt(f.closest('label')) || f.getAttribute('aria-label') || f.placeholder || '';
  };
  const champs = Array.from(doc.querySelectorAll('input:not([type="hidden"]), select, textarea'))
    .filter(isVisible).slice(0, maxItems).map((f) => ({
      type: f.type ?? f.tagName.toLowerCase(),
      name: f.name ?? '',
      etiquette: labelOf(f).slice(0, 120),
      regroupement: txt(f.closest('fieldset')?.querySelector(':scope > legend')) ||
        (f.closest('[role="group"], [role="radiogroup"]')?.getAttribute('aria-label') ?? '')
    }));

  const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6')).slice(0, 20)
    .map((h) => ({ niveau: Number(h.tagName[1]), texte: txt(h).slice(0, 120) }));

  // Plan des zones de regroupement (9.2) : landmarks dans l'ordre du document
  const landmarks = Array.from(doc.querySelectorAll(
    'header, nav, main, footer, aside, [role="banner"], [role="navigation"], [role="main"], [role="contentinfo"], [role="complementary"], [role="search"]'
  )).slice(0, 15).map((el) => ({
    balise: el.tagName.toLowerCase(),
    role: el.getAttribute('role') ?? '',
    chemin: cssPath(el)
  }));

  const bigEnough = (img) => img.naturalWidth >= 32 && img.naturalHeight >= 32;
  const imagesDecoratives = Array.from(doc.querySelectorAll(
    'img[alt=""], img[role="presentation"], img[role="none"], img[aria-hidden="true"]'
  )).filter((i) => isVisible(i) && bigEnough(i)).slice(0, 8)
    .map((i) => ({ src: absUrl(i.getAttribute('src')), contexte: txt(i.parentElement).slice(0, 150) }))
    .filter((i) => i.src);
  const imagesInformatives = Array.from(doc.querySelectorAll('img[alt]:not([alt=""])'))
    .filter((i) => isVisible(i) && bigEnough(i)).slice(0, 8)
    .map((i) => ({
      src: absUrl(i.getAttribute('src')),
      alt: i.getAttribute('alt').slice(0, 200),
      descriptionDetaillee: !!(i.getAttribute('longdesc') || i.getAttribute('aria-describedby') ||
        i.closest('figure')?.querySelector('figcaption'))
    }))
    .filter((i) => i.src);

  return {
    lang: doc.documentElement.lang || '',
    titre: doc.title,
    h1: txt(doc.querySelector('h1')),
    headings,
    landmarks,
    liens,
    boutons,
    champs,
    texte: txt(doc.body).slice(0, 3000),
    imagesDecoratives,
    imagesInformatives
  };
}
