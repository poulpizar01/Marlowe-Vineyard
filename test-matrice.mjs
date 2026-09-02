/* ===========================================================================
   test-matrice.mjs — la colonne « patron » du tableau des accès
   ---------------------------------------------------------------------------
   Ce que ce fichier vérifie, et pourquoi il existe.

   Les rôles du Discord ne s'appellent pas « Patron » et « Co-Patron » mais
   « 👑 · PATRON » et « 👑 · CO PATRON ». Le tableau des accès triait ses
   colonnes par comparaison lettre pour lettre, alors les vrais rôles ne
   tombaient pas dans la colonne figée du patron : ils s'affichaient EN PLUS,
   avec des cases à cocher, et on voyait donc « PATRON / CO-PATRON » (le
   réglage, une colonne pour personne) suivi des deux vrais rôles.

   Le tri se fait maintenant sur la forme normalisée. Ce test lit le fichier
   livré — pas une copie — en extrait les deux fonctions concernées, et
   rejoue le tri. Si quelqu'un touche à la normalisation, ce test tombe.

   Lancer :  node test-matrice.mjs
   =========================================================================== */

import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./marlowe-auth.js', import.meta.url), 'utf8');

/* --- extraction des deux fonctions réellement livrées --------------------- */
function extraire(nom) {
  const i = SRC.indexOf('function ' + nom + '(');
  if (i < 0) throw new Error('introuvable dans marlowe-auth.js : ' + nom);
  let j = SRC.indexOf('{', i), p = 0, k = j;
  for (; k < SRC.length; k++) {
    if (SRC[k] === '{') p++;
    else if (SRC[k] === '}' && --p === 0) break;
  }
  return SRC.slice(i, k + 1);
}

const CONFIG = { PATRON_ROLES: ['Patron', 'Co-Patron'] };
const fabrique = new Function('CONFIG',
  extraire('clefRole') + '\n' + extraire('estRolePatronNom') +
  '\nreturn { clefRole, estRolePatronNom };');
const { estRolePatronNom } = fabrique(CONFIG);

/* --- le tri de colonnes, tel qu'il est écrit dans buildSettings ----------- */
function colonnes(visible) {
  const rolesPatronVus = visible.filter(estRolePatronNom);
  const otherRoles     = visible.filter(r => !estRolePatronNom(r));
  const titrePatron    = rolesPatronVus.length
    ? rolesPatronVus.join(' / ')
    : CONFIG.PATRON_ROLES.join(' / ');
  return { rolesPatronVus, otherRoles, titrePatron };
}

let ok = 0, ko = 0;
const T = (titre, cond) => {
  if (cond) { ok++; console.log('  ✓ ' + titre); }
  else { ko++; console.log('  ✗ ' + titre); }
};

/* ========================================================================== */
console.log('\n— Le Discord réel de Thomas —');

const REEL = [
  '👑 · PATRON', '👑 · CO PATRON', '📋 · DRH', 'RH',
  'Responsable Runner', 'Vendeur', 'Saisonnier',
];
{
  const c = colonnes(REEL);
  T('les deux vrais rôles sont reconnus comme patron',
    c.rolesPatronVus.length === 2);
  T('ils ne sont plus des colonnes à cocher',
    !c.otherRoles.includes('👑 · PATRON') && !c.otherRoles.includes('👑 · CO PATRON'));
  T('l\'en-tête nomme les vrais rôles, pas le réglage',
    c.titrePatron === '👑 · PATRON / 👑 · CO PATRON');
  T('les cinq autres rôles gardent leur colonne',
    c.otherRoles.length === 5);
  T('aucun rôle n\'est perdu en route',
    c.rolesPatronVus.length + c.otherRoles.length === REEL.length);
}

console.log('\n— Les écritures qui doivent être reconnues —');
[
  'Patron', 'PATRON', 'patron', 'Patron 👑', '👑 · PATRON', '  Patron  ',
  'Co-Patron', 'CO PATRON', 'co_patron', '👑 · CO PATRON', 'Co  Patron',
].forEach(r => T(`« ${r} » ouvre la colonne patron`, estRolePatronNom(r)));

console.log('\n— Les écritures qui ne doivent PAS l\'être —');
[
  'Sous-Patron', 'Patronne', 'Ex-Patron', 'Patron adjoint',
  'Assistant du Patron', 'Copatron', 'Patrons', 'Vendeur', '👑', '', '   ',
].forEach(r => T(`« ${r} » reste une colonne ordinaire`, !estRolePatronNom(r)));

console.log('\n— Quand aucun rôle ne correspond —');
{
  const c = colonnes(['RH', 'Vendeur', 'Saisonnier']);
  T('aucun rôle patron vu', c.rolesPatronVus.length === 0);
  T('l\'en-tête retombe sur le réglage', c.titrePatron === 'Patron / Co-Patron');
  T('les colonnes ordinaires sont intactes', c.otherRoles.length === 3);
}

console.log('\n— L\'enregistrement ne doit rien effacer d\'invisible —');
{
  /* Reproduit la règle du bouton « Enregistrer » : on ne réécrit que les
     rôles montrés, on recopie les autres. Sans ça, enregistrer après cette
     correction retirerait aux vrais rôles patron les droits qu'ils avaient
     dans l'ancien tableau — et tant que le serveur n'est pas déployé, c'est
     lui qui décide. */
  const c = colonnes(REEL);
  const montres = new Set(c.otherRoles);
  const avant = { employes: ['👑 · PATRON', 'RH', 'Vendeur'] };
  const apres = { employes: (avant.employes || []).filter(r => !montres.has(r)) };
  apres.employes.push('RH');                 /* seule case restée cochée */
  T('le rôle patron garde son droit', apres.employes.includes('👑 · PATRON'));
  T('la case décochée est bien retirée', !apres.employes.includes('Vendeur'));
  T('la case cochée est bien gardée', apres.employes.includes('RH'));
}

console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
