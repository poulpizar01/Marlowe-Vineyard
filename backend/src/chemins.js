/* ============================================================================
   MARLOWE VINEYARD — à quel fichier une adresse a-t-elle le droit de mener ?
   ----------------------------------------------------------------------------
   Cette décision vivait dans server.js. Elle est sortie ici pour UNE raison
   précise : server.js ouvre la base de données au chargement du module (voir
   son `await creerBase(...)`), donc aucun banc d'essai ne peut l'importer sans
   réclamer une vraie MariaDB. Cette porte-là s'est déjà fait ouvrir DEUX fois
   — une fois par l'encodage (%2f), une fois par la normalisation (//) — et à
   chaque fois faute d'un test capable de la surveiller. Isolée ici, elle est
   une fonction pure : on peut lui envoyer cent adresses tordues sans rien
   démarrer (voir backend/test-passage2.mjs).

   La règle, en une phrase : on refuse tout ce qui, une fois l'adresse ramenée
   à sa forme canonique, sort du site ou vise un dossier de service.
   ============================================================================ */

import path from 'node:path';

/* Chemins jamais servis, même si leur extension est dans la liste blanche —
   deuxième filet en plus de la liste blanche par extension. */
export const PREFIXES_INTERDITS = ['/backend', '/.git', '/docs', '/node_modules', '/Claude outputs'];

/* Rend le chemin relatif au site (« /gestion.html »), ou null si l'adresse est
   refusée. L'appelant garde la charge de la liste blanche d'extensions et du
   contrôle de racine — ce sont ses derniers filets, pas les premiers. */
export function cheminStatique(pathname) {
  /* ⚠️ ON DÉCODE D'ABORD, ON FILTRE ENSUITE — l'ordre inverse ne protège rien.
     -------------------------------------------------------------------------
     Les filtres étaient appliqués à l'adresse ENCORE ENCODÉE, alors que le
     chemin du fichier, lui, était construit sur l'adresse décodée. Il
     suffisait donc d'écrire le « / » sous sa forme %2f pour traverser :
     « /backend%2fsrc%2findex.js » ne commence pas par « /backend/ » aux yeux
     du filtre, mais devient bien ce fichier-là au moment de l'ouvrir. Le
     serveur rendait ainsi le code du backend (132 Ko de source, mesurés) et
     tout .json/.js/.html/.pdf rangé sous backend/, docs/ ou .git/.
     Une adresse indécodable — « /%ZZ.js » — n'est pas une adresse valable :
     on rend « refusé » plutôt que de laisser l'exception remonter en 500. */
  let decode;
  try { decode = pathname === '/' ? '/index.html' : decodeURIComponent(pathname); }
  catch (e) { return null; }

  /* ⚠️ ET ON NORMALISE AVANT DE FILTRER — décoder ne suffisait pas.
     -------------------------------------------------------------------------
     Le correctif précédent décodait bien avant de filtrer, mais comparait
     encore l'adresse BRUTE : « //backend/src/index.js » ne commence pas par
     « /backend/ » (il commence par « //backend/ »), donc le filtre le laissait
     passer — et path.resolve, lui, réduit les barres obliques en double et
     ouvrait le vrai fichier. Le code du serveur repartait donc en clair,
     exactement comme avant le premier correctif, par « //backend/src/index.js »
     ou sa forme encodée « /%2Fbackend%2Fsrc%2Findex.js ».
     Sous Windows (lancement sans Docker, voir README §4), la barre oblique
     INVERSÉE ouvrait la même porte : path.win32 la traite en séparateur, pas
     le filtre.
     On ramène donc l'adresse à sa forme canonique — antislashs convertis,
     barres multiples réduites, « . » et « .. » résolus — AVANT de la comparer
     à quoi que ce soit. */
  const normalise = path.posix.normalize(
    decode.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  );

  /* ⚠️ ET ON COMPARE SANS TENIR COMPTE DE LA CASSE — troisième ouverture de
     la même porte.
     -------------------------------------------------------------------------
     Le filtre comparait « /backend » à la lettre près, alors que le SYSTÈME DE
     FICHIERS, lui, ne fait pas la différence sous Windows ni sous macOS :
     « /BACKEND/src/index.js » était refusé par personne et ouvrait le vrai
     fichier. Sans effet dans le conteneur Alpine (Linux distingue la casse),
     mais le README documente le lancement direct par `npm start`, et c'est
     précisément là que ça compte.
     Le site n'a aucun dossier légitime dont le nom ne diffère de ceux-ci que
     par la casse : comparer en minuscules ne peut donc refuser que des
     tentatives.
     Les DEUX côtés sont minusculés, et ce n'est pas un détail : « /Claude
     outputs » porte lui-même une majuscule. Ne minusculer que le chemin aurait
     empêché ce préfixe-là de matcher quoi que ce soit — le filtre se serait
     désactivé en croyant se renforcer. */
  const minuscule = normalise.toLowerCase();
  if (PREFIXES_INTERDITS.some(p => {
    const q = p.toLowerCase();
    return minuscule === q || minuscule.startsWith(q + '/');
  })) return null;
  if (normalise.split('/').some(segment => segment.startsWith('.'))) return null;

  /* Un octet nul dans un chemin n'est pas une adresse, c'est une tentative :
     decodeURIComponent le laisse passer et c'est readFile qui finit par lever
     — la requête ressortait en 500, avec le chemin absolu du serveur recopié
     dans le message. On répond « refusé ». */
  if (normalise.includes('\0')) return null;

  /* Après normalisation, un chemin qui ne repart pas de la racine ne peut
     mener qu'ailleurs : on ne le laisse pas atteindre path.resolve. */
  if (!normalise.startsWith('/')) return null;

  return normalise;
}
