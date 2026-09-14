/* ============================================================================
   MARLOWE VINEYARD — point d'entrée Node.js
   ----------------------------------------------------------------------------
   Ce fichier remplace wrangler / Cloudflare Workers. Il fait trois choses :

     1. charge la configuration depuis .env (au lieu de wrangler.toml + secrets
        Cloudflare) et ouvre la base MariaDB/MySQL ;
     2. traduit chaque requête HTTP Node en objet Request/Response du Web —
        celui qu'index.js attend, puisqu'il est écrit sans rien connaître de
        Cloudflare à part env.DB (déjà remplacé, voir db.js). Les fichiers
        déposés depuis le panel (visuels, PDF) ne passent plus par ici : ils
        partent directement sur le service de stockage de l'opérateur
        FlashbackFA (STORAGE_BASE/STORAGE_TOKEN dans .env, voir handleUpload
        dans index.js) ;
     3. rejoue toutes les deux minutes ce que le cron Cloudflare faisait
        (lecture des logs de vente + rappels d'agenda), via node-cron.

   index.js lui-même n'a presque pas bougé : c'est le principe de cette
   migration — remplacer la maison, pas les meubles.
   ============================================================================ */

import 'dotenv/config';
import http from 'node:http';
import cron from 'node-cron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import handler from './index.js';
import { creerBase } from './db.js';
import { cheminStatique } from './chemins.js';

/* --------------------------------------------------------------------------
   0. Le site statique — même conteneur, même origine, pas de CORS
   --------------------------------------------------------------------------
   index.js ne connaît que /api/* : tout le reste (index.html, gestion.html,
   marlowe-*.js, img/, fonts/…) est servi ici, directement depuis les
   fichiers du dépôt. Ce dossier est la racine du dépôt, deux niveaux
   au-dessus de ce fichier (backend/src → backend → racine). */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RACINE_SITE = path.resolve(__dirname, '..', '..');

/* Liste blanche par extension : plus sûr qu'une liste noire, ça exclut
   silencieusement backend/.env, package.json, les scripts test-*.mjs et tout
   ce qu'on n'a pas explicitement prévu de rendre public. */
const TYPES_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.pdf':  'application/pdf',
  '.webmanifest': 'application/manifest+json',
};

/* La CSP qui autorise l'affichage dans l'ordinateur en jeu (FolkOS / FiveM) —
   voir docs/A-TRANSMETTRE-AU-RESPONSABLE.md. Sans elle l'iframe reste
   blanche, sans le moindre message d'erreur. X-Frame-Options ne doit JAMAIS
   être posé : il contredirait frame-ancestors et bloquerait l'affichage même
   quand la CSP est correcte. */
const CSP_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://*.fbfa.fr https://fbfa.fr https://cfx-nui-external-iframe nui://game nui:";

function poserEntetesCadre(resNode) {
  resNode.setHeader('Content-Security-Policy', CSP_FRAME_ANCESTORS);
  resNode.removeHeader('X-Frame-Options');

  /* Posés ici parce que cette fonction est le seul passage obligé des DEUX
     sorties : les fichiers du site (servirStatique) et les réponses de l'API
     (envoyerResponse). Un oubli d'un côté ne se serait pas vu.

     nosniff : interdit au navigateur de deviner le type d'un fichier au lieu
     de croire celui qu'on annonce. Les types servis ici sont une liste blanche
     de 13 extensions (TYPES_MIME), donc le risque était théorique — mais
     « théorique » veut dire « jusqu'à ce qu'on ajoute une extension ».

     Referrer-Policy : sans elle, le navigateur joint l'adresse COMPLÈTE de la
     page en cours à chaque requête sortante — vers Discord, vers le service de
     stockage. strict-origin-when-cross-origin n'envoie que le domaine dès
     qu'on sort de chez nous, et rien du tout en passant de https à http.

     Volontairement PAS de Strict-Transport-Security ici : c'est un engagement
     que le navigateur MET EN CACHE pour des mois, et qu'on ne peut plus
     reprendre. Il a sa place dans le Caddyfile, une fois le domaine
     définitif en service — pas dans un code qui tourne aussi en local. */
  resNode.setHeader('X-Content-Type-Options', 'nosniff');
  resNode.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

async function servirStatique(pathname, resNode) {
  /* Décodage, normalisation et dossiers interdits : tout est dans chemins.js,
     une fonction pure que backend/test-passage2.mjs éprouve sur 16 adresses
     tordues et 8 adresses légitimes. Cette porte s'est déjà fait ouvrir deux
     fois faute d'un banc d'essai capable de la surveiller — d'où la sortie
     du code hors de ce fichier, qui ouvre la base au chargement et ne peut
     donc pas être importé par un banc d'essai. */
  const relatif = cheminStatique(pathname);
  if (relatif === null) return false;

  const ext = path.extname(relatif).toLowerCase();
  const type = TYPES_MIME[ext];
  if (!type) return false;

  const chemin = path.resolve(RACINE_SITE, '.' + relatif);
  if (!chemin.startsWith(RACINE_SITE + path.sep)) return false; // pas de ../

  try {
    const contenu = await readFile(chemin);
    poserEntetesCadre(resNode);
    resNode.statusCode = 200;
    resNode.setHeader('Content-Type', type);
    resNode.end(contenu);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

/* --------------------------------------------------------------------------
   1. Configuration
   -------------------------------------------------------------------------- */

const REQUIS = [
  'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN',
  'DISCORD_GUILD_ID', 'SITE_URL',
  'DB_HOST', 'DB_USER', 'DB_NAME',
];
const manquantes = REQUIS.filter(k => !process.env[k]);
if (manquantes.length) {
  console.warn(
    '[config] variables manquantes dans .env : ' + manquantes.join(', ')
    + ' — le serveur démarre quand même, mais /api/* répondra une erreur "config" '
    + 'tant qu\'elles ne sont pas renseignées (voir .env.example).'
  );
}

const { pool, binding: DB } = await creerBase({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
});
console.log('[db] connecté et schéma vérifié (kv, ventes).');

/* `env` tel qu'index.js le reçoit : les variables de wrangler.toml devenues
   des variables de process.env, plus le binding ci-dessus. STORAGE_BASE et
   STORAGE_TOKEN arrivent déjà avec le spread de process.env — pas besoin
   d'un binding séparé, handleUpload (index.js) appelle le service de
   stockage directement en HTTP. */
const env = { ...process.env, DB };

/* --------------------------------------------------------------------------
   2. Pont HTTP Node ⇄ Request/Response du Web
   --------------------------------------------------------------------------
   index.js est écrit avec les API standard du Web (Request, Response,
   Headers, URL, fetch, crypto.subtle…), disponibles nativement dans Node
   depuis longtemps. Il suffit de construire un Request à partir de la
   requête Node, puis de renvoyer la Response obtenue.

   Le corps est entièrement mis en mémoire avant traitement (pas de flux) :
   c'est plus simple, et les tailles ici restent modestes — 12 Mo au grand
   maximum pour un PDF (voir PDF_MAX dans index.js). */
/* Plus gros que le plus gros plafond applicatif (12 Mo, un PDF de catalogue),
   avec une marge confortable — rien de légitime ne dépasse. Sans ce plafond,
   un corps de plusieurs Go serait entièrement mis en mémoire AVANT que
   handleUpload/handleData ne regardent sa taille : un seul envoi
   surdimensionné pouvait épuiser la mémoire du processus qui sert aussi
   tout le site public. On coupe donc la lecture dès que ça dépasse, au lieu
   d'attendre la fin du flux pour s'en apercevoir. */
const CORPS_MAX = 16 * 1024 * 1024;

async function litCorps(requete) {
  const morceaux = [];
  let taille = 0;
  for await (const m of requete) {
    taille += m.length;
    if (taille > CORPS_MAX) {
      requete.destroy();
      const erreur = new Error('corps de requête trop volumineux');
      erreur.corpsTropGros = true;
      throw erreur;
    }
    morceaux.push(m);
  }
  return morceaux.length ? Buffer.concat(morceaux) : undefined;
}

/* Origine de l'URL : on fait confiance à X-Forwarded-Proto/Host quand ils
   sont présents (serveur derrière nginx/Caddy en TLS), sinon on retombe sur
   l'en-tête Host brut. C'est cette origine qui sert à construire l'adresse
   de retour Discord (redirect_uri) — une origine fausse casse la connexion. */
function construireURL(requeteNode) {
  const proto = requeteNode.headers['x-forwarded-proto'] || 'http';
  const hote = requeteNode.headers['x-forwarded-host'] || requeteNode.headers.host || 'localhost';
  return new URL(requeteNode.url, `${proto}://${hote}`);
}

async function versRequest(requeteNode) {
  const url = construireURL(requeteNode);

  const headers = new Headers();
  for (const [cle, valeur] of Object.entries(requeteNode.headers)) {
    if (valeur === undefined) continue;
    headers.set(cle, Array.isArray(valeur) ? valeur.join(', ') : valeur);
  }

  const init = { method: requeteNode.method, headers };
  if (requeteNode.method !== 'GET' && requeteNode.method !== 'HEAD') {
    init.body = await litCorps(requeteNode);
  }
  return new Request(url, init);
}

async function envoyerResponse(reponse, resNode) {
  resNode.statusCode = reponse.status;
  for (const [cle, valeur] of reponse.headers) {
    resNode.setHeader(cle, valeur);
  }
  poserEntetesCadre(resNode);
  const buf = Buffer.from(await reponse.arrayBuffer());
  resNode.end(buf);
}

/* ctx.waitUntil chez Cloudflare retient l'isolat le temps qu'une promesse
   finisse même après la réponse envoyée. Un processus Node ordinaire ne
   disparaît pas entre deux requêtes : on peut donc simplement lancer la
   promesse et logguer si elle échoue, sans rien "attendre" de spécial. */
function creerCtx() {
  return {
    waitUntil(p) {
      Promise.resolve(p).catch(e => console.error('[waitUntil]', e));
    },
  };
}

const PORT = Number(process.env.PORT || 8787);

const serveur = http.createServer(async (requeteNode, resNode) => {
  try {
    const pathname = (requeteNode.url || '/').split('?')[0];
    if ((requeteNode.method === 'GET' || requeteNode.method === 'HEAD')
        && !pathname.startsWith('/api/')
        && await servirStatique(pathname, resNode)) return;

    const requete = await versRequest(requeteNode);
    const reponse = await handler.fetch(requete, env, creerCtx());
    await envoyerResponse(reponse, resNode);
  } catch (e) {
    console.error('[http]', e);
    resNode.statusCode = (e && e.corpsTropGros) ? 413 : 500;
    resNode.setHeader('Content-Type', 'application/json; charset=utf-8');
    resNode.end(JSON.stringify({
      error: (e && e.corpsTropGros) ? 'too_large' : 'server_error',
      detail: String((e && e.message) || e),
    }));
  }
});

serveur.listen(PORT, () => {
  console.log(`Marlowe API en écoute sur http://localhost:${PORT}`);
});

/* --------------------------------------------------------------------------
   3. La tâche périodique (remplace [triggers] crons dans wrangler.toml)
   -------------------------------------------------------------------------- */
cron.schedule('*/2 * * * *', () => {
  handler.scheduled(null, env, creerCtx());
});

/* Arrêt propre : on referme le pool MariaDB/MySQL, pour ne pas laisser de
   connexions ouvertes quand le service est stoppé (systemd, pm2, docker…). */
async function arreter() {
  serveur.close();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
