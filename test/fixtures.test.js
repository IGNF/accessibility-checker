/**
 * Test d'intégration par injection de défauts (« fault seeding ») :
 * sert les fixtures sur un serveur HTTP local, lance la CLI rgaa-ci dessus,
 * puis vérifie que chaque page « mutante » remonte bien son critère RGAA
 * et que la page saine ne remonte aucune violation (mesure du rappel et
 * des faux positifs du mapping).
 *
 * Lancement : npm run test:fixtures (npm install requis ; un seul run Cypress,
 * compter 2 à 5 minutes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from './fixtures-attendus.js';
import { coveredCriteria } from '../src/rgaa-mapping.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = join(ROOT, 'test', 'fixtures');
const TMP_DIR = join(ROOT, 'test', '.tmp');

test('les critères attendus par les fixtures figurent dans la couverture annoncée', () => {
  const { auto, review } = coveredCriteria();
  for (const [fichier, { criteres, signalements = [] }] of Object.entries(FIXTURES)) {
    for (const c of criteres) {
      assert.ok(auto.includes(c), `${fichier} : le critère ${c} n'est pas dans la couverture automatique`);
    }
    for (const c of signalements) {
      assert.ok(review.includes(c), `${fichier} : le critère ${c} n'est pas dans la couverture « à vérifier »`);
    }
  }
});

test('détection des critères RGAA sur les fixtures', { timeout: 900_000 }, async (t) => {
  // Serveur statique minimal (basename : pas de traversée de répertoires)
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
      urls: Object.keys(FIXTURES).map((f) => `${base}/${f}`),
      output,
      failOn: 'any',
      html: false,
      quiet: true,
      waitAfterLoad: 0
    }, null, 2));

    // spawn asynchrone obligatoire : spawnSync bloquerait la boucle d'événements
    // et empêcherait le serveur de fixtures de répondre pendant l'audit
    const run = await new Promise((done) => {
      const child = spawn(process.execPath, [join(ROOT, 'bin', 'rgaa-ci.js'), '--config', confPath], {
        cwd: ROOT
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (status) => done({ status, stdout, stderr }));
    });
    const sortieCli = `sortie CLI :\n${run.stdout}\n${run.stderr}`;
    const jsonPath = join(output, 'rgaa-report.json');
    assert.ok(existsSync(jsonPath), `rapport JSON absent — ${sortieCli}`);
    const rapport = JSON.parse(readFileSync(jsonPath, 'utf8'));

    await t.test('code de sortie 1 (violations au-dessus du seuil « any »)', () => {
      assert.equal(run.status, 1, sortieCli);
    });

    await t.test('toutes les pages ont été analysées', () => {
      assert.equal(rapport.totals.pageErrors, 0, JSON.stringify(rapport.errors));
    });

    for (const [fichier, { criteres, signalements = [] }] of Object.entries(FIXTURES)) {
      const attendus = [
        criteres.length ? `détecte ${criteres.join(', ')}` : '',
        signalements.length ? `signale ${signalements.join(', ')}` : ''
      ].filter(Boolean).join(' et ') || 'aucune violation (page témoin)';
      await t.test(`${fichier} → ${attendus}`, () => {
        const page = rapport.pages.find((p) => p.url.endsWith(`/${fichier}`));
        assert.ok(page, 'page absente du rapport');
        const detectes = [...new Set(page.violations.flatMap((v) => v.rgaaCriteria))];
        if (!criteres.length && !signalements.length) {
          assert.equal(page.violations.length, 0,
            `violations inattendues sur la page témoin : ${page.violations.map((v) => `${v.rule} (${v.rgaaCriteria.join(',')})`).join(' ; ')}`);
        }
        for (const c of criteres) {
          assert.ok(detectes.includes(c),
            `critère ${c} non détecté — détectés : ${detectes.join(', ') || 'aucun'} ; règles : ${page.violations.map((v) => v.rule).join(', ') || 'aucune'}`);
        }
        for (const c of signalements) {
          assert.ok((page.findings ?? []).some((f) => f.criterion === c),
            `signalement ${c} absent — signalements : ${(page.findings ?? []).map((f) => f.criterion).join(', ') || 'aucun'}`);
        }
      });
    }
  } finally {
    server.close();
  }
});
