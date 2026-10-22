/**
 * Correspondance règles axe-core → critères RGAA 4.1.
 * Politique « tests solides » : seules figurent les règles dont une violation
 * prouve objectivement l'échec du critère : règles axe taguées WCAG A/AA,
 * règles axe « best practice » explicitement activées lorsque le RGAA les rend
 * normatives (9.1, 9.2, 12.6), et vérifications maison (préfixe rgaa-,
 * implémentées dans src/custom-checks.js).
 * Les critères de pertinence (jugement humain : 1.2, 1.3, 6.1, 8.6, 11.2…)
 * restent exclus des violations : ils sont traités par le tier « à vérifier »
 * (signalements heuristiques et IA, jamais bloquants pour la CI).
 * Chaque entrée : ruleId axe → { rgaa: [critères], theme }.
 */
export const AXE_TO_RGAA = {
  // Thématique 1 — Images (1.2/1.3 exclus : caractère décoratif et pertinence = jugement humain)
  'image-alt':            { rgaa: ['1.1'], theme: 'Images' },
  'input-image-alt':      { rgaa: ['1.1'], theme: 'Images' },
  'area-alt':             { rgaa: ['1.1'], theme: 'Images' },
  'object-alt':           { rgaa: ['1.1'], theme: 'Images' },
  'svg-img-alt':          { rgaa: ['1.1'], theme: 'Images' },
  'role-img-alt':         { rgaa: ['1.1'], theme: 'Images' },

  // Thématique 2 — Cadres (2.2 : via AXE_REVIEW_RULES, axe ne produit jamais de violation)
  'frame-title':          { rgaa: ['2.1'], theme: 'Cadres' },

  // Thématique 3 — Couleurs (3.3 exclu : axe ne teste que le contraste du texte, pas des composants)
  'color-contrast':       { rgaa: ['3.2'], theme: 'Couleurs' },
  'link-in-text-block':   { rgaa: ['3.1'], theme: 'Couleurs' },

  // Thématique 4 — Multimédia
  'video-caption':        { rgaa: ['4.3'], theme: 'Multimédia' },
  'audio-caption':        { rgaa: ['4.3'], theme: 'Multimédia' },   // 4.3.1 : média temporel sans sous-titres synchronisés
  'no-autoplay-audio':    { rgaa: ['4.10'], theme: 'Multimédia' },

  // Thématique 5 — Tableaux
  'td-headers-attr':      { rgaa: ['5.7'], theme: 'Tableaux' },
  'th-has-data-cells':    { rgaa: ['5.7'], theme: 'Tableaux' },

  // Thématique 6 — Liens (6.1 exclu : caractère explicite d'un lien = jugement humain)
  'link-name':            { rgaa: ['6.2'], theme: 'Liens' },

  // Thématique 7 — Scripts
  'button-name':          { rgaa: ['7.1'], theme: 'Scripts' },
  'input-button-name':    { rgaa: ['7.1'], theme: 'Scripts' },      // 7.1.1 : bouton <input> sans nom accessible
  'summary-name':         { rgaa: ['7.1'], theme: 'Scripts' },      // 7.1.1 : <summary> sans nom accessible
  'aria-tab-name':        { rgaa: ['7.1'], theme: 'Scripts' },      // 7.1.3 : onglet ARIA sans nom accessible
  'aria-meter-name':      { rgaa: ['7.1'], theme: 'Scripts' },      // 7.1.3 : composant meter sans nom accessible
  'aria-progressbar-name': { rgaa: ['7.1'], theme: 'Scripts' },     // 7.1.3 : barre de progression sans nom accessible
  'nested-interactive':   { rgaa: ['7.1'], theme: 'Scripts' },
  'aria-command-name':    { rgaa: ['7.1'], theme: 'Scripts' },
  'aria-toggle-field-name': { rgaa: ['7.1'], theme: 'Scripts' },
  'aria-tooltip-name':    { rgaa: ['7.1'], theme: 'Scripts' },
  'frame-focusable-content': { rgaa: ['7.3'], theme: 'Scripts' },
  'scrollable-region-focusable': { rgaa: ['7.3'], theme: 'Scripts' },

  // ARIA / états et propriétés (rattachés à la thématique 7 et 8)
  'aria-allowed-attr':    { rgaa: ['8.2'], theme: 'Éléments obligatoires' },
  'aria-required-attr':   { rgaa: ['8.2'], theme: 'Éléments obligatoires' },
  'aria-required-children': { rgaa: ['8.2'], theme: 'Éléments obligatoires' },
  'aria-required-parent': { rgaa: ['8.2'], theme: 'Éléments obligatoires' },
  'aria-roles':           { rgaa: ['8.2'], theme: 'Éléments obligatoires' },
  'aria-valid-attr':      { rgaa: ['8.2'], theme: 'Éléments obligatoires' },
  'aria-valid-attr-value': { rgaa: ['8.2'], theme: 'Éléments obligatoires' },
  'aria-hidden-body':     { rgaa: ['8.2'], theme: 'Éléments obligatoires' },
  'aria-hidden-focus':    { rgaa: ['7.1'], theme: 'Scripts' },
  'aria-conditional-attr': { rgaa: ['8.2'], theme: 'Éléments obligatoires' },
  'aria-deprecated-role': { rgaa: ['8.2'], theme: 'Éléments obligatoires' },
  'aria-prohibited-attr': { rgaa: ['8.2'], theme: 'Éléments obligatoires' },
  'aria-roledescription': { rgaa: ['8.2'], theme: 'Éléments obligatoires' }, // 8.2.1 : aria-roledescription hors rôle valide
  'aria-braille-equivalent': { rgaa: ['8.2'], theme: 'Éléments obligatoires' }, // 8.2.1 : équivalent braille sans alternative standard

  // Thématique 8 — Éléments obligatoires
  'document-title':       { rgaa: ['8.5'], theme: 'Éléments obligatoires' },
  'html-has-lang':        { rgaa: ['8.3'], theme: 'Éléments obligatoires' },
  'html-lang-valid':      { rgaa: ['8.4'], theme: 'Éléments obligatoires' },
  'html-xml-lang-mismatch': { rgaa: ['8.4'], theme: 'Éléments obligatoires' },
  'valid-lang':           { rgaa: ['8.8'], theme: 'Éléments obligatoires' },
  'duplicate-id-aria':    { rgaa: ['8.2'], theme: 'Éléments obligatoires' },
  'meta-refresh':         { rgaa: ['13.1'], theme: 'Consultation' },

  // Thématique 9 — Structuration (9.1/9.2 : via les règles best-practice activées ci-dessous)
  'list':                 { rgaa: ['9.3'], theme: 'Structuration' },
  'listitem':             { rgaa: ['9.3'], theme: 'Structuration' },
  'definition-list':      { rgaa: ['9.3'], theme: 'Structuration' },
  'dlitem':               { rgaa: ['9.3'], theme: 'Structuration' },

  // Thématique 10 — Présentation de l'information
  'meta-viewport':        { rgaa: ['10.4'], theme: 'Présentation' },
  'avoid-inline-spacing': { rgaa: ['10.12'], theme: 'Présentation' },

  // Thématique 11 — Formulaires
  'label':                { rgaa: ['11.1'], theme: 'Formulaires' },
  'select-name':          { rgaa: ['11.1'], theme: 'Formulaires' },
  'aria-input-field-name': { rgaa: ['11.1'], theme: 'Formulaires' },
  'form-field-multiple-labels': { rgaa: ['11.1'], theme: 'Formulaires' },
  'autocomplete-valid':   { rgaa: ['11.13'], theme: 'Formulaires' },

  // Thématique 12 — Navigation (12.8 exclu : cohérence de l'ordre de tabulation = jugement
  // humain ; 12.7 : via AXE_REVIEW_RULES, axe ne produit jamais de violation)

  // Thématique 13 — Consultation
  'blink':                { rgaa: ['13.8'], theme: 'Consultation' },
  'marquee':              { rgaa: ['13.8'], theme: 'Consultation' },
  'server-side-image-map': { rgaa: ['1.1'], theme: 'Images' },

  // Règles axe « best practice » activées explicitement (normatives en RGAA)
  'heading-order':        { rgaa: ['9.1'], theme: 'Structuration' },   // 9.1.3 : hiérarchie de titres cohérente
  'page-has-heading-one': { rgaa: ['9.1'], theme: 'Structuration' },   // 9.1.1 : présence d'un titre principal
  'empty-heading':        { rgaa: ['9.1'], theme: 'Structuration' },   // un titre vide ne structure rien
  'landmark-one-main':    { rgaa: ['9.2'], theme: 'Structuration' },   // 9.2.1 : zone de contenu principal unique
  'landmark-no-duplicate-banner':      { rgaa: ['9.2'], theme: 'Structuration' }, // 9.2.1 : en-tête unique
  'landmark-no-duplicate-contentinfo': { rgaa: ['9.2'], theme: 'Structuration' }, // 9.2.1 : pied de page unique
  'region':               { rgaa: ['12.6'], theme: 'Navigation' },     // 12.6 : contenu hors zone de regroupement

  // Vérifications maison (src/custom-checks.js)
  'rgaa-doctype':         { rgaa: ['8.1'], theme: 'Éléments obligatoires' }, // 8.1.1/8.1.2 : doctype présent et valide
  'rgaa-presentation-markup': { rgaa: ['8.9'], theme: 'Éléments obligatoires' }, // 8.9.1 : balises/attributs de présentation
  'rgaa-fieldset-legend': { rgaa: ['11.6'], theme: 'Formulaires' },    // 11.6.1 : regroupement de champs sans légende
  'rgaa-reflow-320':      { rgaa: ['10.11'], theme: 'Présentation' }   // 10.11.1 : défilement horizontal à 320 px
};

/** Règles axe hors tags WCAG à activer explicitement (normatives en RGAA). */
export const BEST_PRACTICE_RULES = [
  'heading-order',
  'page-has-heading-one',
  'empty-heading',
  'landmark-one-main',
  'landmark-no-duplicate-banner',
  'landmark-no-duplicate-contentinfo',
  'region'
];

/**
 * Règles axe « reviewOnFail » : en cas d'échec, axe les classe en `incomplete`,
 * jamais en violation. Elles alimentent donc le tier « à vérifier » (signalements
 * non bloquants), pas les violations.
 */
export const AXE_REVIEW_RULES = {
  'bypass':             { rgaa: ['12.7'], theme: 'Navigation' },
  'frame-title-unique': { rgaa: ['2.2'], theme: 'Cadres' }
};

/**
 * Règles axe dont le classement en `incomplete` mérite un signalement : axe n'a
 * pas pu conclure (ex. contraste sur fond d'image ou dégradé) mais un auditeur
 * humain doit vérifier. Jamais bloquant.
 */
export const AXE_INCOMPLETE_RULES = {
  'color-contrast': { rgaa: ['3.2'], theme: 'Couleurs' }
};

/**
 * Règles axe expérimentales : activées explicitement, mais leur fiabilité ne
 * permet pas d'en faire des violations bloquantes → leurs échecs (violations
 * comme incomplete) alimentent le tier « à vérifier ».
 */
export const AXE_EXPERIMENTAL_RULES = {
  'table-fake-caption':          { rgaa: ['5.4'], theme: 'Tableaux' },      // 5.4.1 : titre de tableau non associé (caption)
  'td-has-header':               { rgaa: ['5.7'], theme: 'Tableaux' },      // 5.7 : cellules sans en-tête associé
  'p-as-heading':                { rgaa: ['9.1'], theme: 'Structuration' }, // 9.1 : paragraphe stylé utilisé comme titre
  'label-content-name-mismatch': { rgaa: ['11.2'], theme: 'Formulaires' },  // 11.2.5 : nom accessible ≠ étiquette visible
  'css-orientation-lock':        { rgaa: ['13.9'], theme: 'Consultation' }  // 13.9.1 : orientation verrouillée par CSS
};

/** Critères couverts par des signalements heuristiques « à vérifier » (jamais bloquants). */
export const HEURISTIC_CRITERIA = ['4.1', '10.5', '10.7', '12.1', '12.2', '12.8', '12.9', '13.3'];

/** Critères couverts par les signalements IA « à vérifier » (option --ai). */
export const AI_CRITERIA = ['1.2', '1.3', '1.6', '1.8', '6.1', '8.6', '8.7', '9.1', '9.2', '11.2', '11.5', '11.9'];

const THEME_BY_SECTION = {
  1: 'Images', 2: 'Cadres', 3: 'Couleurs', 4: 'Multimédia', 5: 'Tableaux',
  6: 'Liens', 7: 'Scripts', 8: 'Éléments obligatoires', 9: 'Structuration',
  10: 'Présentation', 11: 'Formulaires', 12: 'Navigation', 13: 'Consultation'
};

/** Thématique RGAA d'un critère (« 8.6 » → « Éléments obligatoires »). */
export function themeOf(critere) {
  return THEME_BY_SECTION[Number(String(critere).split('.')[0])] ?? '';
}

/** Couverture du référentiel : critères testés automatiquement / signalés « à vérifier ». */
export function coveredCriteria({ ai = false } = {}) {
  const auto = [...new Set(Object.values(AXE_TO_RGAA).flatMap((e) => e.rgaa))];
  const axeReview = [
    ...Object.values(AXE_REVIEW_RULES),
    ...Object.values(AXE_INCOMPLETE_RULES),
    ...Object.values(AXE_EXPERIMENTAL_RULES)
  ].flatMap((e) => e.rgaa);
  const review = [...new Set([...HEURISTIC_CRITERIA, ...axeReview, ...(ai ? AI_CRITERIA : [])])]
    .filter((c) => !auto.includes(c));
  const byNum = (a, b) => {
    const [ta, ca] = a.split('.').map(Number);
    const [tb, cb] = b.split('.').map(Number);
    return ta - tb || ca - cb;
  };
  return { auto: auto.sort(byNum), review: review.sort(byNum), total: 106 };
}

/** Retourne le mapping RGAA pour une règle axe, ou une valeur par défaut. */
export function mapRule(ruleId) {
  return AXE_TO_RGAA[ruleId] ?? { rgaa: [], theme: 'Hors RGAA (bonnes pratiques)' };
}
