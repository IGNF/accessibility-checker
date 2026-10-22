/**
 * Test unitaire du pipeline IA (src/ai-checker.js) avec API Anthropic simulée :
 * vérifie le formatage des signalements, le filtrage des critères hors
 * périmètre, le bornage de la confiance, la robustesse aux réponses invalides
 * et le cumul de la consommation de tokens. Aucun appel réseau, aucune clé requise.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runAiChecks } from '../src/ai-checker.js';

const fetchOriginal = globalThis.fetch;
const cleOriginale = process.env.ANTHROPIC_API_KEY;
const silencieux = { error: () => {} };
const conf = { ai: { model: null } };

beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'cle-de-test'; });
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  if (cleOriginale === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = cleOriginale;
});

function reponseApi(texte) {
  return {
    ok: true,
    json: async () => ({
      content: [{ type: 'text', text: texte }],
      usage: { input_tokens: 100, output_tokens: 20 }
    })
  };
}

// Extraits sans images : un seul appel API (texte) par page
function pageDeTest() {
  return {
    url: 'http://exemple.local/page.html',
    findings: [],
    aiExtracts: {
      lang: 'fr', titre: 'Titre', h1: 'H1', headings: [], liens: [], boutons: [],
      champs: [], texte: 'contenu', imagesDecoratives: [], imagesInformatives: []
    }
  };
}

test('signalements IA : mapping, filtrage des critères hors périmètre et bornage de la confiance', async () => {
  globalThis.fetch = async () => reponseApi('```json\n' + JSON.stringify({
    signalements: [
      { critere: '6.1', cible: 'Cliquez ici', probleme: 'Lien non explicite', confiance: 0.8 },
      { critere: '3.2', cible: 'texte gris', probleme: 'hors périmètre IA, doit être filtré', confiance: 0.9 },
      { critere: '11.9', cible: 'Bouton « 1 »', probleme: 'Intitulé non pertinent', confiance: 1.4 }
    ]
  }) + '\n```');

  const page = pageDeTest();
  const usage = await runAiChecks([page], conf, silencieux);

  assert.equal(page.findings.length, 2, JSON.stringify(page.findings));
  const [lien, bouton] = page.findings;
  assert.deepEqual(
    { criterion: lien.criterion, theme: lien.theme, source: lien.source, confidence: lien.confidence },
    { criterion: '6.1', theme: 'Liens', source: 'ia', confidence: 0.8 }
  );
  assert.equal(bouton.criterion, '11.9');
  assert.equal(bouton.confidence, 1, 'confiance > 1 doit être bornée à 1');
  assert.equal(page.aiExtracts, undefined, 'les extraits de transport doivent être supprimés');
  assert.deepEqual(
    { calls: usage.calls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
    { calls: 1, inputTokens: 100, outputTokens: 20 }
  );
});

test('réponse IA non analysable : aucun signalement, pas d\'exception', async () => {
  globalThis.fetch = async () => reponseApi('Je ne peux pas répondre en JSON, désolé.');
  const page = pageDeTest();
  await runAiChecks([page], conf, silencieux);
  assert.deepEqual(page.findings, []);
});

test('erreur API : la page est ignorée sans interrompre l\'audit', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  const erreurs = [];
  const page = pageDeTest();
  const usage = await runAiChecks([page], conf, { error: (m) => erreurs.push(m) });
  assert.deepEqual(page.findings, []);
  assert.equal(usage.calls, 0);
  assert.equal(erreurs.length, 1);
  assert.match(erreurs[0], /500/);
});

test('clé API absente : erreur explicite', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(() => runAiChecks([pageDeTest()], conf, silencieux), /ANTHROPIC_API_KEY/);
});
