/**
 * Tier IA « à vérifier » : soumet des extraits de page à l'API Anthropic pour
 * les critères RGAA nécessitant un jugement humain (pertinence des alternatives,
 * caractère explicite des liens…). Les signalements produits ne sont JAMAIS
 * comptés dans le seuil d'échec de la CI : ils demandent une revue humaine.
 * La clé API est lue exclusivement dans la variable d'environnement
 * ANTHROPIC_API_KEY (jamais dans la configuration, jamais journalisée).
 */
import { AI_CRITERIA, themeOf } from './rgaa-mapping.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
export const DEFAULT_MODEL = 'claude-haiku-4-5';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const JSON_FORMAT = `Réponds UNIQUEMENT avec un objet JSON de la forme :
{"signalements":[{"critere":"6.1","cible":"<extrait ou élément concerné>","probleme":"<explication courte en français>","confiance":0.8}]}
N'inclus que les problèmes dont tu estimes la confiance à 0,6 ou plus. S'il n'y a rien à signaler : {"signalements":[]}.`;

const TEXT_SYSTEM = `Tu es un auditeur expert du RGAA 4.1. On te fournit des extraits structurés d'une page web.
Signale uniquement des manquements probables aux critères suivants :
- 6.1 : lien dont l'intitulé, même avec son contexte, n'est pas explicite (destination/fonction incompréhensible) ;
- 8.6 : titre de page (title) non pertinent par rapport au contenu ;
- 8.7 : passage de texte dans une autre langue que la langue de la page, visiblement non balisé (attribut lang) ;
- 9.1 : titre de section (h1…h6) non pertinent ou trompeur par rapport à la structure ;
- 9.2 : structure du document incohérente au vu de la liste des landmarks fournie (en-tête, navigation, contenu principal ou pied de page absent, dupliqué ou imbriqué de façon aberrante) ;
- 11.2 : étiquette de champ de formulaire non pertinente (ne décrit pas la saisie attendue) ;
- 11.5 : champs de même nature (mêmes informations, ex. plusieurs radios ou cases d'un même choix, adresse en plusieurs champs) sans regroupement (champ « regroupement » vide) ;
- 11.9 : intitulé de bouton non pertinent (ne décrit pas l'action).
Sois conservateur : en cas de doute, ne signale rien.
${JSON_FORMAT}`;

const VISION_SYSTEM = `Tu es un auditeur expert du RGAA 4.1. On te fournit des images extraites d'une page web, avec leur statut déclaré.
Signale uniquement des manquements probables aux critères suivants :
- 1.2 : image déclarée décorative (alt vide, role=presentation ou aria-hidden) alors qu'elle est porteuse d'information ;
- 1.3 : image informative dont l'alternative textuelle (alt fourni) n'est pas pertinente par rapport au contenu de l'image ;
- 1.6 : image complexe (graphique, diagramme, schéma, carte riche en données) dont l'information ne peut tenir dans un alt court, sans description détaillée associée (statut « sans description détaillée ») ;
- 1.8 : image contenant du texte porteur d'information qui pourrait être rendu en texte stylé (hors logos).
Sois conservateur : en cas de doute, ne signale rien.
${JSON_FORMAT}`;

/**
 * Analyse les pages (mutées en place) : ajoute les signalements IA dans
 * page.findings et supprime les extraits de transport page.aiExtracts.
 * Retourne la consommation de tokens cumulée { model, calls, inputTokens, outputTokens }.
 */
export async function runAiChecks(pages, conf, log = console) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('variable d\'environnement ANTHROPIC_API_KEY absente (requise par --ai)');
  const model = conf.ai.model || DEFAULT_MODEL;
  const usage = { model, calls: 0, inputTokens: 0, outputTokens: 0 };

  for (const page of pages) {
    const extracts = page.aiExtracts;
    if (!extracts) continue;
    const findings = [];
    try {
      findings.push(...await analyzeText(apiKey, model, extracts, usage));
    } catch (e) {
      log.error(`  ⚠ Analyse IA (texte) impossible sur ${page.url} : ${e.message}`);
    }
    try {
      findings.push(...await analyzeImages(apiKey, model, extracts, usage));
    } catch (e) {
      log.error(`  ⚠ Analyse IA (images) impossible sur ${page.url} : ${e.message}`);
    }
    page.findings = [...(page.findings ?? []), ...findings];
    delete page.aiExtracts;
  }
  return usage;
}

async function analyzeText(apiKey, model, extracts, usage) {
  const { imagesDecoratives, imagesInformatives, ...textExtracts } = extracts;
  const content = [{
    type: 'text',
    text: `Extraits de la page à auditer (JSON) :\n${JSON.stringify(textExtracts, null, 1)}`
  }];
  const answer = await callAnthropic(apiKey, model, TEXT_SYSTEM, content, usage);
  return parseFindings(answer);
}

async function analyzeImages(apiKey, model, extracts, usage) {
  const items = [
    ...extracts.imagesDecoratives.map((i) => ({ ...i, statut: 'déclarée décorative' })),
    ...extracts.imagesInformatives.map((i) => ({
      ...i,
      statut: `informative, alt="${i.alt}", ${i.descriptionDetaillee ? 'avec' : 'sans'} description détaillée`
    }))
  ].slice(0, 10);
  const content = [];
  for (const [idx, item] of items.entries()) {
    const img = await fetchImage(item.src);
    if (!img) continue;
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
    content.push({
      type: 'text',
      text: `Image ${idx + 1} (${item.src}) : ${item.statut}.${item.contexte ? ` Contexte : ${item.contexte}` : ''}`
    });
  }
  if (!content.length) return [];
  content.push({ type: 'text', text: 'Audite ces images au regard des critères 1.2, 1.3, 1.6 et 1.8.' });
  const answer = await callAnthropic(apiKey, model, VISION_SYSTEM, content, usage);
  return parseFindings(answer);
}

async function fetchImage(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const mediaType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!IMAGE_TYPES.includes(mediaType)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
    return { mediaType, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

async function callAnthropic(apiKey, model, system, content, usage) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ model, max_tokens: 1500, system, messages: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(90000)
  });
  if (!res.ok) {
    throw new Error(`API Anthropic ${res.status} — ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  if (usage) {
    usage.calls += 1;
    usage.inputTokens += data.usage?.input_tokens ?? 0;
    usage.outputTokens += data.usage?.output_tokens ?? 0;
  }
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function parseFindings(answer) {
  const cleaned = answer.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return [];
  let parsed;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  return (parsed.signalements ?? [])
    .filter((s) => s && AI_CRITERIA.includes(String(s.critere)))
    .map((s) => ({
      criterion: String(s.critere),
      theme: themeOf(s.critere),
      source: 'ia',
      target: String(s.cible ?? '').slice(0, 300),
      message: String(s.probleme ?? '').slice(0, 500),
      confidence: typeof s.confiance === 'number' ? Math.min(1, Math.max(0, s.confiance)) : null
    }));
}
