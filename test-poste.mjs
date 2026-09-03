/* Le renommage du poste ne doit RIEN casser pour les fiches déjà saisies.
   On extrait clefPoste et POSTE_SYNONYMES du fichier livré et on rejoue les
   écritures qui circulent réellement : celle du registre, celle du Discord,
   et l'ancienne. */
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('./marlowe-actions.js', import.meta.url), 'utf8');

function bloc(depart, fin) {
  const i = SRC.indexOf(depart); if (i < 0) throw new Error('introuvable : ' + depart);
  const j = SRC.indexOf(fin, i);  return SRC.slice(i, j + fin.length);
}
const code = bloc('const POSTE_SYNONYMES = {', '};')
  + '\n' + bloc('const clefPoste =', ".trim();")
  + '\nreturn { POSTE_SYNONYMES, clefPoste };';
const { POSTE_SYNONYMES, clefPoste } = new Function(code)();

const CANON = 'Resp. des Responsables Runner';
let ok = 0, ko = 0;
const T = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); }
  else { ko++; console.log('  ✗ ' + t + (d === undefined ? '' : ' → ' + JSON.stringify(d))); } };

console.log('\n— Les écritures qui doivent retomber sur le nouveau poste —');
for (const n of [
  'Responsable Général', 'responsable general', 'Resp. Général', 'RESP GENERAL',
  'Resp. des Responsables Runner', 'Responsable des Responsables Runner',
  'Directeur Des Responsables-Runners', 'directeur des responsables runner',
]) {
  const k = clefPoste(n);
  T(`« ${n} » → ${CANON}`, POSTE_SYNONYMES[k] === CANON, { clef: k, obtenu: POSTE_SYNONYMES[k] });
}

console.log('\n— Ce qui ne doit PAS changer —');
T('« Resp. Runner » reste Resp. Runner', POSTE_SYNONYMES[clefPoste('Resp. Runner')] === 'Resp. Runner');
T('« Responsable Runner » reste Resp. Runner', POSTE_SYNONYMES[clefPoste('Responsable Runner')] === 'Resp. Runner');
T('« Runner » n\'est pas confondu avec un responsable',
  POSTE_SYNONYMES[clefPoste('Runner')] !== CANON, POSTE_SYNONYMES[clefPoste('Runner')]);
T('« Patron » reste Patron', POSTE_SYNONYMES[clefPoste('Patron')] === 'Patron');

console.log('\n— Le poste figure bien dans les listes du panel —');
for (const [nom, motif] of [
  ['la liste canonique', "'Resp. des Responsables Runner', 'DRH'"],
  ['les départements',   "'Resp. des Responsables Runner': 'direction'"],
  ['les sceaux',         "'Resp. des Responsables Runner': 'gold'"],
]) T(nom, SRC.includes(motif), motif);

const nDroits = (SRC.match(/'Resp\. des Responsables Runner', 'Responsable Général'/g) || []).length;
T('les trois listes de droits le connaissent', nDroits === 3, nDroits);
T('l\'ancien libellé est conservé partout où une fiche peut encore le porter',
  SRC.includes("'Responsable Général': 'direction'") && SRC.includes("'Responsable Général': 'gold'"));

console.log(`\n  ${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
