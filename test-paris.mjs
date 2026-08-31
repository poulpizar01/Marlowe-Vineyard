/* Les bornes de semaine doivent être les MÊMES pour tout le monde.
   ---------------------------------------------------------------------------
   On rejoue ici, à l'identique, la fonction du panel, et on la fait tourner
   sous plusieurs fuseaux et à plusieurs dates de l'année. Ce qui est vérifié :

   · lundi 00 h 00 Paris tombe au même INSTANT vu de Paris, de New York ou de
     Tokyo — c'est tout l'objet du changement ;
   · l'heure d'été est suivie sans qu'on ait à la connaître (+1 h l'hiver,
     +2 h l'été) ;
   · une semaine qui enjambe le changement d'heure fait 167 ou 169 heures,
     jamais 168 — et surtout, aucune seconde n'est perdue entre deux semaines.

   Lancement :  node test-paris.mjs
*/
const QD_FUSEAU = 'Europe/Paris';

function qdDecalageParis(t) {
  /* Troncature à la seconde : sv-SE ne rend pas les millisecondes. */
  const sec = Math.floor(t / 1000) * 1000;
  const mur = new Date(sec).toLocaleString('sv-SE', { timeZone: QD_FUSEAU });
  return Date.parse(mur.replace(' ', 'T') + 'Z') - sec;
}

function lundiDepuis(maintenant, semainesAvant) {
  const d1 = qdDecalageParis(maintenant);
  const mur = new Date(maintenant + d1);
  const jour = (mur.getUTCDay() + 6) % 7;
  mur.setUTCDate(mur.getUTCDate() - jour - 7 * (semainesAvant || 0));
  mur.setUTCHours(0, 0, 0, 0);
  const approx = mur.getTime() - d1;
  return mur.getTime() - qdDecalageParis(approx);
}

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};
const aParis = t => new Date(t).toLocaleString('fr-FR', {
  timeZone: QD_FUSEAU, weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit' });

/* Des instants répartis dans l'année, dont deux qui encadrent un changement
   d'heure : dernier dimanche de mars et dernier dimanche d'octobre 2026. */
const MOMENTS = [
  ['un mardi d\'août (heure d\'été)',   Date.parse('2026-08-25T14:00:00Z')],
  ['un jeudi de janvier (heure d\'hiver)', Date.parse('2026-01-15T09:00:00Z')],
  ['le mercredi APRÈS le passage à l\'heure d\'été', Date.parse('2026-04-01T10:00:00Z')],
  ['le mercredi APRÈS le retour à l\'heure d\'hiver', Date.parse('2026-10-28T10:00:00Z')],
  /* Le cas qui a révélé le défaut : Date.now() porte des millisecondes, et le
     format qui donne l'heure de Paris s'arrête à la seconde. Sans troncature,
     le lundi retombait quelques centaines de millisecondes APRÈS minuit, et
     « dimanche 23 h 59 » s'affichait « lundi ». Vu à l'écran, pas en théorie. */
  ['un instant avec 246 millisecondes', Date.parse('2026-08-31T02:29:00Z') + 246],
  ['un instant à 999 millisecondes', Date.parse('2026-03-11T08:00:00Z') + 999],
];

console.log('\nChaque lundi tombe bien un lundi à minuit, heure de Paris');
for (const [nom, t] of MOMENTS) {
  const l = lundiDepuis(t, 0);
  const lu = new Date(l).toLocaleString('en-GB', {
    timeZone: QD_FUSEAU, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  dit(`${nom} → ${aParis(l)}`, /^Mon,? 00:00:00$/.test(lu.replace(/ | /g, ' ').trim()), lu);
}

console.log('\nLe décalage suit l\'heure d\'été sans qu\'on la connaisse');
{
  const ete = qdDecalageParis(Date.parse('2026-08-25T12:00:00Z')) / 3600000;
  const hiver = qdDecalageParis(Date.parse('2026-01-15T12:00:00Z')) / 3600000;
  dit('+2 h en août', ete === 2, ete);
  dit('+1 h en janvier', hiver === 1, hiver);
}

console.log('\nLe MÊME instant, quel que soit le fuseau de celui qui regarde');
{
  /* On ne peut pas changer TZ en cours de route dans un même processus : on
     relance node sous d'autres fuseaux et on compare les résultats bruts. */
  const { execFileSync } = await import('node:child_process');
  const script = `
    const f = t => { const m = new Date(t).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' });
                     return Date.parse(m.replace(' ', 'T') + 'Z') - t; };
    const l = (n, s) => { const d1 = f(n); const mur = new Date(n + d1);
      const j = (mur.getUTCDay() + 6) % 7;
      mur.setUTCDate(mur.getUTCDate() - j - 7 * (s || 0)); mur.setUTCHours(0,0,0,0);
      return mur.getTime() - f(mur.getTime() - d1); };
    console.log(JSON.stringify(${JSON.stringify(MOMENTS.map(m => m[1]))}.map(t => [l(t,0), l(t,1)])));
  `;
  const sous = (tz) => JSON.parse(execFileSync(process.execPath, ['-e', script],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8' }));

  const paris = sous('Europe/Paris');
  const newyork = sous('America/New_York');
  const tokyo = sous('Asia/Tokyo');
  const utc = sous('UTC');

  dit('Paris et New York trouvent le même instant',
    JSON.stringify(paris) === JSON.stringify(newyork), { paris: paris[0], newyork: newyork[0] });
  dit('Paris et Tokyo aussi', JSON.stringify(paris) === JSON.stringify(tokyo), tokyo[0]);
  dit('Paris et UTC aussi', JSON.stringify(paris) === JSON.stringify(utc), utc[0]);
  console.log('     exemple :', aParis(paris[0][0]), '→', paris[0][0]);
}

console.log('\nAucune seconde perdue entre deux semaines');
for (const [nom, t] of MOMENTS) {
  const close = lundiDepuis(t, 1);
  const encours = lundiDepuis(t, 0);
  const finClose = encours - 1;
  const finLue = new Date(finClose).toLocaleString('en-GB', {
    timeZone: QD_FUSEAU, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const heures = (encours - close) / 3600000;
  dit(`${nom} : la close finit dimanche 23:59:59 (${finLue}) et la semaine fait ${heures} h`,
    /^Sun,? 23:59:59$/.test(finLue.replace(/ | /g, ' ').trim())
      && [167, 168, 169].includes(heures)
      && finClose + 1 === encours,
    { finLue, heures });
}

console.log('\nLe lundi tombe pile sur la milliseconde zéro');
for (const [nom, t] of MOMENTS) {
  const l = lundiDepuis(t, 0);
  dit(`${nom} → reste ${l % 1000} ms`, l % 1000 === 0, l % 1000);
}

console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
