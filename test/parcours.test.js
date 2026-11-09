/**
 * Test d'intégration du mode parcours : soumission vide d'un formulaire dont les
 * erreurs sont mal gérées. Vérifie que seuls les défauts révélés par l'action sont
 * rapportés (violation 7.1 dans la zone d'erreur, signalements 11.10, 12.8, 8.6),
 * annotés de l'état de l'étape « analyser ».
 *
 * Lancement : npm run test:parcours (un run Cypress, ~30 s).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = join(ROOT, 'test', 'fixtures');
const TMP_DIR = join(ROOT, 'test', '.tmp-parcours');

test('mode parcours : défauts révélés par la soumission d’un formulaire', { timeout: 300_000 }, async (t) => {
  const server = http.createServer((req, res) => {
    const fichier = join(FIXTURES_DIR, basename(new URL(req.url, 'http://localhost').pathname));
    if (!existsSync(fichier)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(fichier));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/parcours-formulaire-erreurs.html`;

  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
    mkdirSync(TMP_DIR, { recursive: true });
    const output = join(TMP_DIR, 'rapport');
    const confPath = join(TMP_DIR, 'config.json');
    writeFileSync(confPath, JSON.stringify({
      urls: [url],
      parcours: [{
        nom: 'Contact — soumission vide',
        url,
        etapes: [
          { soumettre: '#contact' },
          { attendre: 300 },
          { analyser: 'après soumission du formulaire vide', formulaire: true }
        ]
      }],
      output, failOn: 'any', html: true, quiet: true, waitAfterLoad: 0, interactions: false
    }, null, 2));

    const run = await new Promise((done) => {
      const child = spawn(process.execPath, [join(ROOT, 'bin', 'rgaa-ci.js'), '--config', confPath], { cwd: ROOT });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (status) => done({ status, stdout, stderr }));
    });
    const sortieCli = `sortie CLI :\n${run.stdout}\n${run.stderr}`;
    const jsonPath = join(output, 'rgaa-report.json');
    assert.ok(existsSync(jsonPath), `rapport JSON absent — ${sortieCli}`);
    const rapport = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const initial = rapport.pages.find((p) => !p.parcours);
    const parcours = rapport.pages.find((p) => p.parcours === 'Contact — soumission vide');

    await t.test('page et parcours analysés sans erreur', () => {
      assert.equal(rapport.totals.pageErrors, 0, `${JSON.stringify(rapport.errors)}\n${sortieCli}`);
      assert.ok(initial && parcours, 'page initiale ou parcours absent du rapport');
      assert.equal(rapport.totals.parcours, 1);
    });
    await t.test('l’état initial ne présente aucune violation', () => {
      assert.equal(initial.violations.length, 0, initial.violations.map((v) => v.rule).join(', '));
    });
    await t.test('la violation 7.1 n’apparaît qu’après soumission, avec son état', () => {
      const v = parcours.violations.find((x) => x.rgaaCriteria.includes('7.1'));
      assert.ok(v, `7.1 absent — violations : ${parcours.violations.map((x) => x.rule).join(', ') || 'aucune'}`);
      assert.equal(v.state, 'après soumission du formulaire vide');
    });
    await t.test('signalements d’état du formulaire : 11.10, 12.8, 8.6', () => {
      const crits = parcours.findings.map((f) => f.criterion);
      for (const c of ['11.10', '12.8', '8.6']) assert.ok(crits.includes(c), `${c} absent — signalements : ${crits.join(', ')}`);
      assert.ok(parcours.findings.every((f) => f.state), 'tous les signalements du parcours portent un état');
    });
    await t.test('le rapport HTML présente le parcours', () => {
      const html = readFileSync(join(output, 'rgaa-report.html'), 'utf8');
      assert.match(html, /Parcours « Contact — soumission vide »/);
      assert.match(html, /1<\/strong> parcours rejoué/);
    });
  } finally {
    server.close();
  }
});
