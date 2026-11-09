/**
 * Test d'intégration de la connexion SSO : un faux site (127.0.0.1) redirige ses
 * pages protégées vers un faux fournisseur d'identité (localhost, autre origine)
 * qui présente un formulaire, puis renvoie vers le site avec un cookie de session.
 * Vérifie que rgaa-ci se connecte une seule fois, réutilise la session sur les
 * pages suivantes, et analyse bien le contenu réservé aux utilisateurs connectés.
 *
 * Lancement : npm run test:sso (un run Cypress, compter ~1 minute).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP_DIR = join(ROOT, 'test', '.tmp-sso');
const USER = 'auditeur';
const PASSWORD = 'motdepasse-de-test';

const page = (title, body) => `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title></head>
<body><header><p>Site de test</p></header><main><h1>${title}</h1>${body}</main><footer><p>Pied</p></footer></body></html>`;

function listen(server) {
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)));
}

test('connexion SSO : session unique réutilisée et contenu protégé analysé', { timeout: 300_000 }, async (t) => {
  let logins = 0;
  let siteBase = '';
  let ssoBase = '';

  // Faux fournisseur d'identité (origine « localhost », différente de « 127.0.0.1 »)
  const sso = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/auth' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Connexion', `<form method="post" action="/auth?redirect=${encodeURIComponent(u.searchParams.get('redirect'))}">
        <label for="u">Identifiant</label><input id="u" name="username">
        <label for="p">Mot de passe</label><input id="p" name="password" type="password">
        <button type="submit">Se connecter</button></form>`));
      return;
    }
    if (u.pathname === '/auth' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        const form = new URLSearchParams(body);
        if (form.get('username') !== USER || form.get('password') !== PASSWORD) {
          res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
          res.end(page('Identifiants invalides', ''));
          return;
        }
        logins += 1;
        res.writeHead(302, { location: `${u.searchParams.get('redirect')}?code=ok` });
        res.end();
      });
      return;
    }
    res.writeHead(404); res.end();
  });

  // Faux site : /publique accessible, /protegee et /compte exigent le cookie de session
  const site = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const connecte = /(^|;\s*)session=ok/.test(req.headers.cookie ?? '');
    if (u.pathname === '/publique') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Page publique', '<p>Visible par tous.</p>'));
      return;
    }
    if (u.pathname === '/login/check') {
      res.writeHead(302, { 'set-cookie': 'session=ok; Path=/; HttpOnly', location: u.searchParams.get('next') ?? '/protegee' });
      res.end();
      return;
    }
    if (u.pathname === '/protegee' || u.pathname === '/compte') {
      if (!connecte) {
        const next = `${siteBase}/login/check?next=${encodeURIComponent(u.pathname)}`;
        res.writeHead(302, { location: `${ssoBase}/auth?redirect=${encodeURIComponent(next)}` });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      // Défaut 7.1 (bouton sans nom) présent uniquement dans l'espace connecté
      res.end(page(u.pathname === '/compte' ? 'Mon compte' : 'Espace protégé', `<p>Bonjour ${USER}.</p><button type="button"></button>`));
      return;
    }
    res.writeHead(404); res.end();
  });

  const ssoPort = await listen(sso);
  const sitePort = await listen(site);
  ssoBase = `http://localhost:${ssoPort}`;
  siteBase = `http://127.0.0.1:${sitePort}`;

  try {
    rmSync(TMP_DIR, { recursive: true, force: true });
    mkdirSync(TMP_DIR, { recursive: true });
    const output = join(TMP_DIR, 'rapport');
    const confPath = join(TMP_DIR, 'config.json');
    writeFileSync(confPath, JSON.stringify({
      // La première URL est publique : --login-url désigne la page qui déclenche la connexion
      urls: [`${siteBase}/publique`, `${siteBase}/protegee`, `${siteBase}/compte`],
      login: { origin: ssoBase, url: `${siteBase}/protegee` },
      output,
      failOn: 'any',
      html: false,
      quiet: true,
      waitAfterLoad: 0,
      interactions: false
    }, null, 2));

    const run = await new Promise((done) => {
      const child = spawn(process.execPath, [join(ROOT, 'bin', 'rgaa-ci.js'), '--config', confPath], {
        cwd: ROOT,
        env: { ...process.env, RGAA_LOGIN_USER: USER, RGAA_LOGIN_PASSWORD: PASSWORD }
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

    await t.test('les trois pages sont analysées', () => {
      assert.equal(rapport.totals.pageErrors, 0, `${JSON.stringify(rapport.errors)}\n${sortieCli}`);
      assert.equal(rapport.pages.length, 3);
    });
    await t.test('une seule authentification pour toutes les pages', () => {
      assert.equal(logins, 1, `${logins} connexion(s) au SSO`);
    });
    await t.test('le contenu protégé est bien celui analysé (7.1 détecté hors page publique)', () => {
      for (const path of ['/protegee', '/compte']) {
        const p = rapport.pages.find((x) => x.url.endsWith(path));
        assert.ok(p.violations.some((v) => v.rgaaCriteria.includes('7.1')), `7.1 absent sur ${path} : ${p.violations.map((v) => v.rule).join(', ') || 'aucune violation'}`);
      }
      const pub = rapport.pages.find((x) => x.url.endsWith('/publique'));
      assert.equal(pub.violations.length, 0, pub.violations.map((v) => v.rule).join(', '));
    });
  } finally {
    sso.close();
    site.close();
  }
});
