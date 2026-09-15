/* ============================================================================
   Nettoie un dump de la base avant de le transmettre.
   ----------------------------------------------------------------------------
   Un dump mariadb-dump de la base Marlowe contient, dans la table kv, à côté
   des données du domaine (registre, clients, facturation, réglages, matrice,
   journal), des lignes qui n'ont rien à y faire une fois hors de la machine :

     · sess:…          les sessions en cours — ce sont des JETONS D'ACCÈS :
                       quiconque lit le fichier entre dans le panel avec le
                       compte de la personne, tant que la session n'a pas
                       expiré (sept jours) ;
     · state:…         les états OAuth en attente ;
     · pres:…          la présence (qui regarde quelle page, en ce moment) ;
     · absence:…       l'anti-rejeu d'une déclaration d'absence ;
     · rappel:…, agenda:rappel:…   les marques « déjà envoyé » ;
     · menage, logs:etat            des compteurs internes.

   Ce script écrit une copie du dump sans ces lignes. Les ventes et toutes
   les autres clés de kv passent telles quelles. Il ne touche pas au fichier
   d'entrée sauf si c'est aussi le fichier de sortie.

   Usage :
     node backend/scripts/dump-nettoyer.mjs marlowe.sql marlowe-propre.sql
     node backend/scripts/dump-nettoyer.mjs marlowe.sql marlowe-propre.sql --lister
   --lister affiche chaque clé de kv, gardée (✓) ou retirée (✗).
   ============================================================================ */
import { readFileSync, writeFileSync } from 'node:fs';

const [entree, sortie, ...opts] = process.argv.slice(2);
if (!entree) {
  console.error('Usage : node backend/scripts/dump-nettoyer.mjs <entrée.sql> [sortie.sql] [--lister]');
  process.exit(2);
}
const lister = opts.includes('--lister');
const sql = readFileSync(entree, 'utf8');

const TEMPORAIRES = [/^sess:/, /^state:/, /^pres:/, /^absence:/, /^rappel:/, /^agenda:rappel:/, /^menage$/, /^logs:etat$/];
const estTemporaire = cle => TEMPORAIRES.some(re => re.test(cle));

/* Découpe « (…),(…),(…) » d'un INSERT étendu en lignes, en respectant les
   chaînes SQL ('…' avec \ d'échappement et '' doublé). */
function lignesDe(valeurs) {
  const out = []; let i = 0;
  while (i < valeurs.length) {
    if (valeurs[i] !== '(') { i++; continue; }
    let j = i + 1, dansChaine = false;
    while (j < valeurs.length) {
      const c = valeurs[j];
      if (dansChaine) {
        if (c === '\\') { j += 2; continue; }
        if (c === "'") { if (valeurs[j + 1] === "'") { j += 2; continue; } dansChaine = false; }
      } else if (c === "'") dansChaine = true;
      else if (c === ')') break;
      j++;
    }
    out.push(valeurs.slice(i, j + 1));
    i = j + 1;
  }
  return out;
}

/* La première valeur d'une ligne « ('cle','val',exp) », décodée. */
function cleDe(ligne) {
  const m = ligne.match(/^\('((?:\\.|''|[^'\\])*)'/);
  return m ? m[1].replace(/\\(.)/g, '$1').replace(/''/g, "'") : null;
}

let gardees = 0;
const retirees = [], toutes = [];
const lignes = sql.split('\n').map(l => {
  const m = l.match(/^INSERT INTO `kv` VALUES (.*);\r?$/);
  if (!m) return l;
  const conservees = [];
  for (const ligne of lignesDe(m[1])) {
    const cle = cleDe(ligne);
    toutes.push({ cle, octets: ligne.length });
    if (cle !== null && estTemporaire(cle)) retirees.push(cle);
    else { conservees.push(ligne); gardees++; }
  }
  return conservees.length ? 'INSERT INTO `kv` VALUES ' + conservees.join(',') + ';' : '-- (lignes temporaires retirées par dump-nettoyer.mjs)';
});

if (lister) {
  console.log('Clés de kv dans le dump :');
  for (const { cle, octets } of toutes) {
    console.log(`  ${estTemporaire(cle) ? '✗' : '✓'} ${String(cle).padEnd(40)} ${octets} octets`);
  }
}
const familles = [...new Set(retirees.map(c => (c.includes(':') ? c.slice(0, c.indexOf(':') + 1) : c)))];
console.log(`\nkv : ${gardees} clé(s) gardée(s), ${retirees.length} retirée(s)${familles.length ? ' — ' + familles.join(', ') : ''}`);
console.log(`ventes : ${(sql.match(/^INSERT INTO `ventes` VALUES/mg) || []).length} instruction(s) INSERT, conservée(s) telle(s) quelle(s)`);
if (sortie) {
  writeFileSync(sortie, lignes.join('\n'));
  console.log(`écrit : ${sortie}`);
}
