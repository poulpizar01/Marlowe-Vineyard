/* ============================================================================
   Lance tous les bancs d'essai du dépôt, l'un après l'autre.
   ----------------------------------------------------------------------------
   Il y en a dix-huit : six à la racine (ils rejouent des fonctions du panel,
   extraites de marlowe-actions.js) et douze dans backend/ (ils appellent les
   routes du serveur avec un Discord et une base simulés). Chacun est un
   programme autonome, lançable seul avec « node test-xxx.mjs » — ce fichier
   ne fait que les enchaîner et résumer.

   Aucune installation nécessaire : ni node_modules, ni base, ni réseau.
   test-mariadb.mjs, le seul à vouloir une vraie base, se retire tout seul
   quand les variables DB_* manquent (voir son en-tête).

   Lancement :  cd backend && npm test
   Sortie : 0 si tout passe, 1 sinon — utilisable dans une intégration
   continue.
   ============================================================================ */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BACKEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RACINE  = path.dirname(BACKEND);

const fichiers = [];
for (const dossier of [RACINE, BACKEND]) {
  for (const f of readdirSync(dossier).sort()) {
    if (/^test-.*\.mjs$/.test(f)) fichiers.push(path.join(dossier, f));
  }
}

const bilan = [];
for (const f of fichiers) {
  const nom = path.relative(RACINE, f).replace(/\\/g, '/');
  const debut = Date.now();
  const r = spawnSync(process.execPath, [f], { cwd: path.dirname(f), encoding: 'utf8' });
  const sortie = (r.stdout || '') + (r.stderr || '');
  /* Chaque banc termine par une ligne du type « N vérification(s) passée(s),
     M en échec » ; on la reprend telle quelle quand elle existe. */
  const lignes = sortie.split('\n').map(l => l.trim()).filter(Boolean);
  const resume = [...lignes].reverse().find(l => /échec|réussi|passée/.test(l)) || lignes.at(-1) || '';
  const ok = r.status === 0;
  bilan.push({ nom, ok, resume, ms: Date.now() - debut });
  console.log(`${ok ? '✓' : '✗'} ${nom.padEnd(32)} ${resume}`);
  if (!ok) {
    console.log('  ─────────────────────────── sortie complète ───────────────────────────');
    console.log(sortie.split('\n').map(l => '  ' + l).join('\n'));
    console.log('  ────────────────────────────────────────────────────────────────────────');
  }
}

const echecs = bilan.filter(b => !b.ok);
console.log(`\n${bilan.length} fichier(s), ${echecs.length} en échec`
  + (echecs.length ? ' : ' + echecs.map(b => b.nom).join(', ') : '') + '.');
process.exit(echecs.length ? 1 : 0);
