/**
 * Fixtures « mutantes » : une page HTML par critère RGAA couvert automatiquement
 * (mapping AXE_TO_RGAA + vérifications maison), construite d'après le test
 * officiel du critère (https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/).
 *
 * `criteres` : critères RGAA qui DOIVENT figurer dans les violations de la page
 * (test d'inclusion : des violations annexes peuvent s'y ajouter, par exemple
 * 12.6 « region » sur la fixture 9.2 qui supprime la zone main).
 * `signalements` : critères attendus dans les signalements « à vérifier » de la
 * page (règles axe « reviewOnFail » : bypass, frame-title-unique).
 * Une liste vide = page témoin : aucune violation attendue.
 *
 * Critères couverts par le mapping mais sans fixture : 4.3 et 4.10 (multimédia) —
 * axe-core classe ces cas en « incomplete », pas en violation déterministe.
 */
export const FIXTURES = {
  'page-saine.html': { criteres: [] },
  '1.1-image-sans-alternative.html': { criteres: ['1.1'] },
  '2.1-cadre-sans-titre.html': { criteres: ['2.1'] },
  '2.2-cadres-titres-identiques.html': { criteres: [], signalements: ['2.2'] },
  '3.1-lien-couleur-seule.html': { criteres: ['3.1'] },
  '3.2-contraste-insuffisant.html': { criteres: ['3.2'] },
  '5.7-entetes-tableau.html': { criteres: ['5.7'] },
  '6.2-lien-sans-intitule.html': { criteres: ['6.2'] },
  '7.1-bouton-sans-nom.html': { criteres: ['7.1'] },
  '7.3-zone-defilante-non-focusable.html': { criteres: ['7.3'] },
  '8.1-doctype-absent.html': { criteres: ['8.1'] },
  '8.2-aria-invalide.html': { criteres: ['8.2'] },
  '8.3-langue-absente.html': { criteres: ['8.3'] },
  '8.4-langue-invalide.html': { criteres: ['8.4'] },
  '8.5-titre-de-page-absent.html': { criteres: ['8.5'] },
  '8.8-changement-langue-invalide.html': { criteres: ['8.8'] },
  '8.9-presentation-obsolete.html': { criteres: ['8.9'] },
  '9.1-hierarchie-titres.html': { criteres: ['9.1'] },
  '9.2-structure-sans-main.html': { criteres: ['9.2'] },
  '9.3-liste-mal-formee.html': { criteres: ['9.3'] },
  '10.4-zoom-bloque.html': { criteres: ['10.4'] },
  '10.11-defilement-horizontal.html': { criteres: ['10.11'] },
  '10.12-espacement-impose.html': { criteres: ['10.12'] },
  '11.1-champ-sans-etiquette.html': { criteres: ['11.1'] },
  '11.6-fieldset-sans-legende.html': { criteres: ['11.6'] },
  '11.13-autocomplete-invalide.html': { criteres: ['11.13'] },
  '12.6-contenu-hors-zones.html': { criteres: ['12.6'] },
  '12.7-aucun-moyen-eviter.html': { criteres: [], signalements: ['12.7'] },
  '13.1-rafraichissement-automatique.html': { criteres: ['13.1'] },
  '13.8-contenu-en-mouvement.html': { criteres: ['13.8'] }
};
