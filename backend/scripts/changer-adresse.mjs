/* ============================================================================
   Change l'adresse du site dans les fichiers du dépôt qui la portent.
   ----------------------------------------------------------------------------
   Le serveur, lui, ne suppose aucune adresse : il travaille avec l'hôte réel
   par lequel la requête arrive (voir backend/README.md, « Changer l'adresse
   du site »). Ce qui est écrit en dur dans le dépôt ne sert qu'à deux choses,
   et c'est ce que ce script met à jour :

     · la liste SITE_ATTENDUES de marlowe-actions.js — elle n'alimente que la
       page de diagnostic du panel et un message d'erreur ; désaccordée, elle
       dit à tort « le navigateur bloquera tout » ;
     · les balises og:url / og:image d'index.html, accueil.html et
       gestion.html — les aperçus de liens (Discord, réseaux) ;
     · et, pour que l'exemple reste juste, SITE_URL / SITE_URLS de
       backend/.env.example.

   Ce script NE TOUCHE JAMAIS à backend/.env : c'est un fichier de secrets,
   propre à chaque machine, qu'on modifie à la main.

   Lancement, depuis n'importe quel dossier du dépôt :

     node backend/scripts/changer-adresse.mjs https://nouvelle.adresse.fr
     node backend/scripts/changer-adresse.mjs https://nouvelle.adresse.fr --essai

   --essai montre ce qui changerait sans rien écrire. On peut donner
   plusieurs adresses (la première est la principale, les autres restent
   acceptées le temps d'une bascule) :

     node backend/scripts/changer-adresse.mjs https://nouvelle.fr https://ancienne.fr
   ============================================================================ */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RACINE = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const args = process.argv.slice(2);
const essai = args.includes('--essai');
const adresses = args.filter(a => !a.startsWith('--'));

if (!adresses.length) {
  console.error('Usage : node backend/scripts/changer-adresse.mjs https://nouvelle.adresse.fr [autres…] [--essai]');
  process.exit(2);
}
const origines = adresses.map(a => {
  let u;
  try { u = new URL(a); } catch (e) { console.error(`Adresse illisible : ${a}`); process.exit(2); }
  if (u.protocol !== 'https:') {
    console.error(`${a} : il faut une adresse en https:// — Discord refuse un Redirect en http, et le cookie de session est marqué Secure.`);
    process.exit(2);
  }
  if (u.pathname !== '/' || u.search || u.hash) {
    console.error(`${a} : donnez seulement l'origine (protocole + hôte), sans chemin.`);
    process.exit(2);
  }
  return u.origin;
});
const principale = origines[0];

const lire = f => readFileSync(path.join(RACINE, f), 'utf8');
const modifs = [];
function ecrire(f, contenu, avant) {
  if (contenu === avant) { console.log(`  = ${f} : rien à changer`); return; }
  modifs.push(f);
  if (!essai) writeFileSync(path.join(RACINE, f), contenu);
  console.log(`  ${essai ? '~' : '✓'} ${f}`);
}

/* 1. marlowe-actions.js — la liste SITE_ATTENDUES, et l'adresse actuelle
      qu'on en déduit pour les autres fichiers. */
const ACTIONS = 'marlowe-actions.js';
const src = lire(ACTIONS);
const m = src.match(/const SITE_ATTENDUES_DEFAUT = \[\n([\s\S]*?)\n  \];/);
if (!m) { console.error(`${ACTIONS} : liste SITE_ATTENDUES introuvable.`); process.exit(1); }
const actuelles = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
const actuelle = actuelles[0];
if (!actuelle) { console.error(`${ACTIONS} : SITE_ATTENDUES est vide.`); process.exit(1); }

console.log(`Adresse actuelle  : ${actuelle}`);
console.log(`Nouvelle adresse  : ${principale}${origines.length > 1 ? '  (+ ' + origines.slice(1).join(', ') + ')' : ''}`);
console.log(essai ? '\nMode essai — rien ne sera écrit.\n' : '');

const bloc = `const SITE_ATTENDUES_DEFAUT = [\n${origines.map(o => `    '${o}',`).join('\n')}\n  ];`;
ecrire(ACTIONS, src.replace(m[0], bloc), src);

/* 2. Les trois pages : uniquement les lignes marquées <!-- ADRESSE -->, et
      uniquement l'origine actuelle sur ces lignes. Le reste du HTML (liens
      vers d'autres sites, textes) n'est pas touché. */
for (const f of ['index.html', 'accueil.html', 'gestion.html']) {
  const avant = lire(f);
  const apres = avant.split('\n').map(l =>
    l.includes('<!-- ADRESSE -->') ? l.split(actuelle).join(principale) : l).join('\n');
  ecrire(f, apres, avant);
}

/* 3. L'exemple de configuration. SITE_URL = la principale ; SITE_URLS = toute
      la liste, c'est son rôle (plusieurs adresses le temps d'une bascule). */
{
  const f = 'backend/.env.example';
  const avant = lire(f);
  const apres = avant
    .replace(/^SITE_URL=.*$/m, `SITE_URL=${principale}`)
    .replace(/^SITE_URLS=.*$/m, `SITE_URLS=${origines.join(',')}`);
  ecrire(f, apres, avant);
}

console.log(`
${essai ? 'Fichiers qui changeraient' : 'Fichiers modifiés'} : ${modifs.length ? modifs.join(', ') : 'aucun'}.

Reste à faire, hors du dépôt — sans ça la connexion échoue :
  1. backend/.env sur le serveur :  SITE_URL=${principale}
     ${origines.length > 1 ? `SITE_URLS=${origines.join(',')}` : '(SITE_URLS peut garder l\'ancienne adresse le temps que tout le monde bascule)'}
  2. Portail développeur Discord ▸ OAuth2 ▸ Redirects :  ${principale}/api/callback
  3. L'entrée du reverse proxy (et le DNS) pour ${new URL(principale).host}.
  4. Redéployer, puis vérifier ${principale}/api/version.
Tout le monde devra se reconnecter une fois : le cookie de session est lié à l'ancien hôte.`);
