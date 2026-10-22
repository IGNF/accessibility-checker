/**
 * Évaluation du tier IA sur fixtures « jugement » (test/fixtures-ia/) : pages
 * aux défauts de pertinence flagrants (liens « cliquez ici », titre hors sujet…)
 * que la vraie IA doit signaler. Ignoré si ANTHROPIC_API_KEY est absente.
 *
 * Avertissement : appelle l'API Anthropic (coût ≈ 0,01 $ avec haiku) et reste
 * une évaluation statistique — un modèle non déterministe peut manquer un cas
 * limite ; les défauts sont volontairement grossiers pour minimiser ce risque.
 * Derrière un proxy : lancer avec NODE_USE_ENV_PROXY=1 (Node ≥ 24).
 * Lancement : npm run test:ia
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = join(ROOT, 'test', 'fixtures-ia');
const TMP_DIR = join(ROOT, 'test', '.tmp-ia');

/** Fixture → critère attendu dans les signalements IA de la page. */
const FIXTURES_IA = {
  '6.1-liens-non-explicites.html': '6.1',
  '8.6-titre-non-pertinent.html': '8.6',
  '8.7-langue-non-balisee.html': '8.7',
  '9.1-titre-trompeur.html': '9.1',
  '11.2-etiquette-non-pertinente.html': '11.2',
  '11.9-bouton-non-pertinent.html': '11.9'
};

test('signalements IA sur les fixtures « jugement »', {
  skip: !process.env.ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY absente (test ignoré : nécessite l\'API Anthropic)',
  timeout: 900_000
}, async (t) => {
  const server = http.createServer((req, res) => {
    const fichier = join(FIXTURES_DIR, basename(new URL(req.url, 'http://localhost').pathname));
    if (!existsSync(fichier)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(fichier));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
    mkdirSync(TMP_DIR, { recursive: true });
    const output = join(TMP_DIR, 'rapport');
    const confPath = join(TMP_DIR, 'config.json');
    writeFileSync(confPath, JSON.stringify({
      urls: Object.keys(FIXTURES_IA).map((f) => `${base}/${f}`),
      output,
      failOn: 'any',
      html: false,
      quiet: true,
      waitAfterLoad: 0,
      ai: { enabled: true }
    }, null, 2));

    const run = await new Promise((done) => {
      const child = spawn(process.execPath, [join(ROOT, 'bin', 'rgaa-ci.js'), '--config', confPath], { cwd: ROOT });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (status) => done({ status, stdout, stderr }));
    });

    const jsonPath = join(output, 'rgaa-report.json');
    assert.ok(existsSync(jsonPath), `rapport JSON absent — sortie CLI :\n${run.stdout}\n${run.stderr}`);
    const rapport = JSON.parse(readFileSync(jsonPath, 'utf8'));

    await t.test('toutes les pages ont été analysées', () => {
      assert.equal(rapport.totals.pageErrors, 0, JSON.stringify(rapport.errors));
    });

    await t.test('la consommation IA est comptabilisée', () => {
      assert.ok(rapport.aiUsage?.calls > 0, JSON.stringify(rapport.aiUsage));
    });

    for (const [fichier, critere] of Object.entries(FIXTURES_IA)) {
      await t.test(`${fichier} → signale ${critere}`, () => {
        const page = rapport.pages.find((p) => p.url.endsWith(`/${fichier}`));
        assert.ok(page, 'page absente du rapport');
        const ia = (page.findings ?? []).filter((f) => f.source === 'ia');
        assert.ok(ia.some((f) => f.criterion === critere),
          `critère ${critere} non signalé — signalements IA : ${ia.map((f) => `${f.criterion} (${f.message})`).join(' ; ') || 'aucun'}`);
      });
    }

    console.log(`Consommation IA : ${rapport.aiUsage?.calls} appel(s), ${rapport.aiUsage?.inputTokens} tokens entrée + ${rapport.aiUsage?.outputTokens} sortie (${rapport.aiUsage?.model})`);
  } finally {
    server.close();
  }
});
