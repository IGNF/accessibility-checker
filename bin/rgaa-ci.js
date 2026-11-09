#!/usr/bin/env node
/**
 * rgaa-ci — Tests d'accessibilité RGAA automatisés pour CI.
 * Analyse une liste d'URLs avec axe-core (via Cypress) et mappe
 * les résultats vers les critères RGAA 4 automatisables.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAudit } from '../src/runner.js';
import { fetchSitemapUrls } from '../src/sitemap.js';

function printHelp() {
  console.log(`
rgaa-ci — Tests d'accessibilité RGAA automatisés (CI)

Usage :
  rgaa-ci --url https://example.org [--url ...] [options]
  rgaa-ci --config rgaa.config.json

Options :
  --url <url>            URL à analyser (répétable)
  --sitemap <url>        URL d'un sitemap.xml : toutes ses pages sont analysées
  --max-pages <n>        Nombre max de pages issues du sitemap (défaut : 25)
  --config <fichier>     Fichier de configuration JSON
  --output <dossier>     Dossier de sortie des rapports (défaut : ./rgaa-report)
  --fail-on <niveau>     Seuil d'échec : critical | serious | moderate | minor | any
                         (défaut : serious)
  --max-violations <n>   Nombre max de violations tolérées au-dessus du seuil (défaut : 0)
  --viewport <LxH>       Taille du viewport, ex. 1280x720 (défaut : 1280x720)
  --timeout <ms>         Timeout de chargement de page (défaut : 30000)
  --ai                   Activer les signalements IA « à vérifier » (critères de
                         jugement : 1.2, 1.3, 6.1, 8.6, 8.7, 11.2, 11.9…).
                         Nécessite la variable d'environnement ANTHROPIC_API_KEY.
                         Jamais bloquant pour la CI.
  --ai-model <nom>       Modèle Anthropic à utiliser (défaut : claude-haiku-4-5)
  --ai-max-items <n>     Nombre max d'éléments soumis à l'IA par page (défaut : 20)
  --login-origin <url>   Origine du formulaire de connexion (SSO Keycloak…) vers lequel
                         les pages protégées redirigent, ex. https://sso.example.org. Les
                         identifiants sont lus dans RGAA_LOGIN_USER et RGAA_LOGIN_PASSWORD
                         (jamais en CLI). La connexion est faite une fois, puis la session
                         est réutilisée pour toutes les pages.
  --login-url <url>      Page qui déclenche la connexion (ex. https://site/login). Défaut :
                         la première URL analysée — à préciser si celle-ci est publique.
  --no-interactions      Désactiver les scénarios d'interaction génériques (ouverture des
                         menus, dépliables et modales avant réanalyse ; menu ouvert à 320 px).
  --no-html              Ne pas générer le rapport HTML
  --quiet                Sortie console minimale
  --help                 Affiche cette aide

Codes de sortie :
  0  aucun dépassement du seuil
  1  violations au-delà du seuil
  2  erreur d'exécution (page inaccessible, config invalide…)
`);
}

function parseArgs(argv) {
  const args = { urls: [], html: true, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--url': args.urls.push(argv[++i]); break;
      case '--sitemap': args.sitemap = argv[++i]; break;
      case '--max-pages': args.maxPages = Number(argv[++i]); break;
      case '--config': args.config = argv[++i]; break;
      case '--output': args.output = argv[++i]; break;
      case '--fail-on': args.failOn = argv[++i]; break;
      case '--max-violations': args.maxViolations = Number(argv[++i]); break;
      case '--viewport': args.viewport = argv[++i]; break;
      case '--timeout': args.timeout = Number(argv[++i]); break;
      case '--ai': args.ai = true; break;
      case '--ai-model': args.aiModel = argv[++i]; break;
      case '--ai-max-items': args.aiMaxItems = Number(argv[++i]); break;
      case '--login-origin': args.loginOrigin = argv[++i]; break;
      case '--login-url': args.loginUrl = argv[++i]; break;
      case '--no-interactions': args.interactions = false; break;
      case '--no-html': args.html = false; break;
      case '--quiet': args.quiet = true; break;
      case '--help': case '-h': printHelp(); process.exit(0); break;
      default:
        console.error(`Option inconnue : ${a}`);
        printHelp();
        process.exit(2);
    }
  }
  return args;
}

function loadConfig(args) {
  let fileConf = {};
  if (args.config) {
    const path = resolve(args.config);
    if (!existsSync(path)) {
      console.error(`Fichier de configuration introuvable : ${path}`);
      process.exit(2);
    }
    try {
      fileConf = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      console.error(`Configuration JSON invalide : ${e.message}`);
      process.exit(2);
    }
  }

  const conf = {
    urls: args.urls.length ? args.urls : (fileConf.urls ?? []),
    sitemap: args.sitemap ?? fileConf.sitemap ?? null,
    maxPages: args.maxPages ?? fileConf.maxPages ?? 25,
    output: args.output ?? fileConf.output ?? 'rgaa-report',
    failOn: args.failOn ?? fileConf.failOn ?? 'serious',
    maxViolations: args.maxViolations ?? fileConf.maxViolations ?? 0,
    viewport: args.viewport ?? fileConf.viewport ?? '1280x720',
    timeout: args.timeout ?? fileConf.timeout ?? 30000,
    html: args.html && (fileConf.html ?? true),
    quiet: args.quiet || (fileConf.quiet ?? false),
    ignoreRules: fileConf.ignoreRules ?? [],
    waitAfterLoad: fileConf.waitAfterLoad ?? 1000,
    interactions: args.interactions ?? fileConf.interactions ?? true,
    httpHeaders: fileConf.httpHeaders ?? {},
    basicAuth: fileConf.basicAuth ?? null,
    // Connexion via un formulaire sur une autre origine (SSO) ; sélecteurs par défaut = Keycloak
    login: (args.loginOrigin ?? fileConf.login?.origin)
      ? {
          origin: args.loginOrigin ?? fileConf.login.origin,
          url: args.loginUrl ?? fileConf.login?.url ?? null,
          // name="username"/"password" est stable sur Keycloak, l'id varie selon le thème (ex. DSFR : id généré)
          usernameSelector: fileConf.login?.usernameSelector ?? 'input[name="username"], #username',
          passwordSelector: fileConf.login?.passwordSelector ?? 'input[name="password"], #password',
          submitSelector: fileConf.login?.submitSelector ?? 'button[type="submit"], input[type="submit"]'
        }
      : null,
    ai: {
      enabled: args.ai ?? fileConf.ai?.enabled ?? false,
      model: args.aiModel ?? fileConf.ai?.model ?? null,
      maxItemsPerPage: args.aiMaxItems ?? fileConf.ai?.maxItemsPerPage ?? 20
    }
  };

  if (!conf.urls.length && !conf.sitemap) {
    console.error('Aucune URL fournie. Utilisez --url, --sitemap ou un fichier de configuration.');
    printHelp();
    process.exit(2);
  }

  const levels = ['critical', 'serious', 'moderate', 'minor', 'any'];
  if (!levels.includes(conf.failOn)) {
    console.error(`--fail-on doit être : ${levels.join(' | ')}`);
    process.exit(2);
  }

  if (conf.ai.enabled && !process.env.ANTHROPIC_API_KEY) {
    console.error('--ai nécessite la variable d\'environnement ANTHROPIC_API_KEY (ne mettez jamais la clé dans un fichier versionné).');
    process.exit(2);
  }

  if (conf.login) {
    if (!/^https?:\/\/[^/]+$/.test(conf.login.origin)) {
      console.error('--login-origin doit être une origine sans chemin, ex. https://sso.example.org');
      process.exit(2);
    }
    if (conf.login.url && !/^https?:\/\//.test(conf.login.url)) {
      console.error('--login-url doit être une URL absolue, ex. https://site.example.org/login');
      process.exit(2);
    }
    if (!process.env.RGAA_LOGIN_USER || !process.env.RGAA_LOGIN_PASSWORD) {
      console.error('La connexion SSO nécessite les variables d\'environnement RGAA_LOGIN_USER et RGAA_LOGIN_PASSWORD (jamais dans un fichier versionné).');
      process.exit(2);
    }
  }

  const m = /^(\d+)x(\d+)$/.exec(conf.viewport);
  if (!m) {
    console.error('--viewport doit être au format LARGEURxHAUTEUR, ex. 1280x720');
    process.exit(2);
  }
  conf.viewportSize = { width: Number(m[1]), height: Number(m[2]) };

  return conf;
}

const conf = loadConfig(parseArgs(process.argv.slice(2)));

try {
  if (conf.sitemap) {
    if (!conf.quiet) console.log(`▶ Lecture du sitemap ${conf.sitemap} …`);
    const found = await fetchSitemapUrls(conf.sitemap, conf.timeout);
    conf.urls = [...new Set([...conf.urls, ...found])].slice(0, conf.maxPages);
    if (!conf.quiet) console.log(`  ${found.length} URL(s) découverte(s), ${conf.urls.length} retenue(s) (max-pages : ${conf.maxPages})`);
    if (!conf.urls.length) {
      console.error('Le sitemap ne contient aucune URL.');
      process.exit(2);
    }
  }
  const { exitCode } = await runAudit(conf);
  process.exit(exitCode);
} catch (e) {
  console.error(`Erreur d'exécution : ${e.message}`);
  process.exit(2);
}
