/* ============================================================================
   LES NOMS ÉCRITS EN POLICE FANTAISIE
   ----------------------------------------------------------------------------
   Un pseudo Discord comme « 𝕷𝖎𝖛𝖎𝖆 𝕮𝖔𝖑𝖊 » n'est pas du texte décoré : ce sont
   d'autres caractères Unicode (blocs mathématiques). NFD ne les décompose pas,
   toLowerCase() ne les change pas, et le filtre [^a-z0-9] les efface TOUS — la
   clé sortait vide.

   Conséquence vécue : la personne pouvait prendre son service (la ligne partait
   avec son nom, les autres la voyaient « en service ») mais ne se retrouvait
   jamais elle-même. Le bouton restait sur « Prise de service », chaque clic
   ouvrait une ligne de plus, et elle ne pouvait jamais terminer.

   Ce fichier vérifie la correction (NFKD) sur les CINQ clés qui décident d'une
   identité, dans les quatre fichiers livrés, et rejoue le scénario complet de
   la prise puis de la fin de service.
   ========================================================================== */
import { readFileSync } from 'node:fs';

const lire = f => readFileSync(new URL('./' + f, import.meta.url), 'utf8');
const GESTION  = lire('gestion.html');
const ACTIONS  = lire('marlowe-actions.js');
const AUTH     = lire('marlowe-auth.js');
const BACKEND  = lire('backend/src/index.js');

function bloc(src, depart, fin) {
  const i = src.indexOf(depart); if (i < 0) throw new Error('introuvable : ' + depart);
  const j = src.indexOf(fin, i);  if (j < 0) throw new Error('fin introuvable : ' + fin);
  return src.slice(i, j + fin.length);
}

let ok = 0, ko = 0;
const T = (t, c, d) => { if (c) { ok++; console.log('  ✓ ' + t); }
  else { ko++; console.log('  ✗ ' + t + (d === undefined ? '' : ' → ' + JSON.stringify(d))); } };

/* Les écritures réelles. FRAKTUR est celle du pseudo qui a déclenché le bug ;
   les autres sont les polices que Discord laisse passer tout aussi bien. */

/* On fabrique les variantes plutôt que de les recopier : une lettre recopiée
   de travers ferait échouer le test pour une raison qui n'a rien à voir. */
function stylise(txt, majBase, minBase) {
  return [...txt].map(c => {
    if (c >= 'A' && c <= 'Z') return String.fromCodePoint(majBase + c.charCodeAt(0) - 65);
    if (c >= 'a' && c <= 'z') return String.fromCodePoint(minBase + c.charCodeAt(0) - 97);
    return c;
  }).join('');
}
const fraktur = t => stylise(t, 0x1D56C, 0x1D586); // gras fraktur — celle du pseudo en cause
const gras    = t => stylise(t, 0x1D400, 0x1D41A); // gras mathématique
const italiq  = t => stylise(t, 0x1D608, 0x1D622); // sans-empattement italique
const large   = t => [...t].map(c => (c === ' ' ? '　'
  : (c >= '!' && c <= '~') ? String.fromCodePoint(0xFF01 + c.charCodeAt(0) - 33) : c)).join('');

const FRAKTUR = fraktur('Livia Cole');
const GRAS    = gras('Thomas');
const DOUBLE  = italiq('Livia Cole');
const LARGEUR = large('Livia Cole');

/* ==========================================================================
   1. Les cinq clés d'identité, une par une
   ========================================================================== */
const clefs = {
  'serviceClef (gestion.html)':
    new Function(bloc(GESTION, 'function serviceClef(t){', '\n}') + '\nreturn serviceClef;')(),
  'clefNom (marlowe-actions.js)':
    new Function(bloc(ACTIONS, '  const clefNom = t => {', '\n  };') + '\nreturn clefNom;')(),
  'clefNom (backend)':
    new Function(bloc(BACKEND, 'function clefNom(x) {', '\n}') + '\nreturn clefNom;')(),
  'clefRole (marlowe-auth.js)':
    new Function(bloc(AUTH, '  function clefRole(nom) {', '\n  }') + '\nreturn clefRole;')(),
  'clefRole (backend)':
    new Function(bloc(BACKEND, 'function clefRole(nom) {', '\n}') + '\nreturn clefRole;')(),
};

console.log('\n— Une police fantaisie ne doit plus donner une clé vide —');
for (const [nom, clef] of Object.entries(clefs)) {
  T(`${nom} : « 𝕷𝖎𝖛𝖎𝖆 𝕮𝖔𝖑𝖊 » n'est plus vide`, clef(DOUBLE) !== '', clef(DOUBLE));
  T(`${nom} : ajouré ≡ normal`, clef(DOUBLE) === clef('Livia Cole'), clef(DOUBLE));
  T(`${nom} : pleine largeur ≡ normal`, clef(LARGEUR) === clef('Livia Cole'), clef(LARGEUR));
  T(`${nom} : gras ≡ normal`, clef(GRAS) === clef('Thomas'), clef(GRAS));
  T(`${nom} : fraktur ≡ normal`, clef(FRAKTUR) === clef('Livia Cole'), clef(FRAKTUR));
}

console.log('\n— Ce qui marchait doit continuer de marcher —');
for (const [nom, clef] of Object.entries(clefs)) {
  T(`${nom} : accents ignorés`, clef('Rémi CASTEL') === clef('remi castel'));
  T(`${nom} : espaces multiples ignorés`, clef('Rémi  CASTEL') === clef('remi castel'));
  T(`${nom} : emoji et séparateurs ignorés`, clef('👑 · PATRON') === clef('Patron'));
  T(`${nom} : deux noms différents restent différents`,
    clef('Livia Cole') !== clef('Livio Cole'));
  T(`${nom} : « Sous-Patron » n'est pas « Patron »`,
    clef('Sous-Patron') !== clef('Patron'));
  T(`${nom} : vide reste vide`, clef('') === '' && clef(null) === '');
}

console.log('\n— Un nom hors alphabet latin ne doit pas devenir « tout le monde » —');
for (const [nom, clef] of Object.entries(clefs)) {
  const a = clef('田中太郎'), b = clef('山田花子');
  T(`${nom} : deux noms japonais restent distincts`, a !== b, { a, b });
  T(`${nom} : un nom japonais n'est pas la clé vide`, a !== '', a);
}

/* ==========================================================================
   2. Le scénario complet de la prise de service
   ========================================================================== */
console.log('\n— Prise de service, de bout en bout —');

function panneau(monNom) {
  const src = bloc(GESTION, 'function pad2(n){', 'renderServiceHistory();')
    .replace('renderServiceHistory();', '')      // le rendu touche au DOM
    .replace(/function renderServiceHistory\(\)\{[\s\S]*$/, ''); // et sa définition
  const code = `
    let serviceHistory = [], serviceActive = false;
    const window = { MarloweSession: { name: ${JSON.stringify(monNom)} } };
    ${src}
    /* Le geste du bouton, à l'identique de gestion.html — sans le rendu. */
    function cliquer(){
      const nom = serviceMonNom();
      if(!nom) return 'sans nom';
      const ouvert = serviceOuvert();
      if(!ouvert){ serviceHistory.push({ nom, date: todayFR(), start: nowHM(), end: null }); return 'debut'; }
      ouvert.end = nowHM();
      serviceOuverts().forEach(s => { if(s !== ouvert) s.end = s.start; });
      return 'fin';
    }
    function total(){
      return serviceMiens().filter(s => s.end)
        .reduce((t, s) => t + durationMinutes(s.start, s.end), 0);
    }
    return { serviceHistory, cliquer, serviceOuvert, serviceOuverts, serviceMiens, total, serviceClef };
  `;
  return new Function(code)();
}

/* a) Le cas qui a cassé : un pseudo en police fantaisie */
{
  const p = panneau(DOUBLE);
  T('prise de service avec un pseudo fantaisie', p.cliquer() === 'debut');
  T('la personne se retrouve elle-même', p.serviceMiens().length === 1);
  T('le bouton passe bien sur « Fin de service »', !!p.serviceOuvert());
  T('un deuxième clic TERMINE (il n\'ouvre pas une 2ᵉ ligne)', p.cliquer() === 'fin');
  T('une seule ligne au total', p.serviceHistory.length === 1, p.serviceHistory);
  T('plus rien d\'ouvert', p.serviceOuverts().length === 0);
}

/* b) Le ménage des lignes déjà en double, comme celles de Livia */
{
  const p = panneau(DOUBLE);
  ['16:24', '16:34', '16:34', '16:35'].forEach(h =>
    p.serviceHistory.push({ nom: DOUBLE, date: '06/09/2026', start: h, end: null }));
  T('les 4 lignes ouvertes sont bien reconnues comme siennes', p.serviceOuverts().length === 4);
  T('le service ouvert retenu est le PLUS ANCIEN', p.serviceOuvert().start === '16:24',
    p.serviceOuvert());
  p.cliquer();
  T('après la fin de service, plus aucune ligne ouverte', p.serviceOuverts().length === 0);
  T('les 4 lignes sont conservées, pas supprimées', p.serviceHistory.length === 4);
  const doublons = p.serviceHistory.filter(s => s.start !== '16:24');
  T('les doublons sont soldés à 0h00', doublons.every(s => s.end === s.start), doublons);
  T('seule la vraie ligne compte des heures', p.total() > 0);
}

/* c) Deux personnes différentes ne se marchent pas dessus */
{
  const a = panneau('Livia Cole');
  a.serviceHistory.push({ nom: 'Thomas Ryspert', date: '06/09/2026', start: '10:00', end: null });
  T('le service d\'un autre n\'est pas le mien', a.serviceOuvert() === null);
  a.cliquer();
  T('mon clic ouvre MA ligne', a.serviceMiens().length === 1);
  T('la ligne de l\'autre reste ouverte', a.serviceHistory.filter(s => !s.end).length === 2);
}

/* d) Le pseudo fantaisie et le nom du registre sont la même personne */
{
  const p = panneau(DOUBLE);
  p.serviceHistory.push({ nom: 'Livia Cole', date: '06/09/2026', start: '09:00', end: null });
  T('une ligne écrite sous le nom du registre est retrouvée par le pseudo fantaisie',
    p.serviceOuvert() !== null);
}

/* e) Une ligne d'avant la mise à jour (sans nom) n'appartient à personne */
{
  const p = panneau('Livia Cole');
  p.serviceHistory.push({ date: '06/09/2026', start: '09:00', end: null });
  T('une ligne sans nom n\'est comptée pour personne', p.serviceMiens().length === 0);
}

/* ==========================================================================
   3. « En service maintenant » compte des PERSONNES, pas des lignes
   ========================================================================== */
console.log('\n— Le panneau « En service maintenant » —');
{
  const code = `
    const clefNom = ${bloc(ACTIONS, '  const clefNom = t => {', '\n  };').replace('  const clefNom = t => ', '')}
    const parseFR = d => { const [j,m,a] = String(d).split('/'); return new Date(+a, +m - 1, +j); };
    const clefNomFn = clefNom;
    ${bloc(ACTIONS, '  const SERVICE_OUBLI_MIN', '\n  }').replace(/^\s*const SERVICE_OUBLI_MIN[^\n]*\n/, 'const SERVICE_OUBLI_MIN = 12 * 60;\n')}
    return { servicesEnCours, set: (h, r) => { serviceHistory = h; rhRosterData = r; } };
  `;
  let mod = null;
  try {
    mod = new Function('serviceHistory', 'rhRosterData', `
      ${bloc(ACTIONS, '  const clefNom = t => {', '\n  };')}
      const parseFR = d => { const [j,m,a] = String(d).split('/'); return new Date(+a, +m - 1, +j); };
      const SERVICE_OUBLI_MIN = 12 * 60;
      ${bloc(ACTIONS, '  function servicesEnCours() {', '\n  }')}
      return servicesEnCours();
    `);
  } catch (e) { T('extraction de servicesEnCours', false, String(e)); }

  if (mod) {
    const auj = new Date();
    const dateAuj = String(auj.getDate()).padStart(2, '0') + '/'
      + String(auj.getMonth() + 1).padStart(2, '0') + '/' + auj.getFullYear();
    const h = n => { const d = new Date(auj.getTime() - n * 60000);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

    const quatre = ['12', '2', '2', '1'].map((m, i) =>
      ({ nom: DOUBLE, date: dateAuj, start: h([12, 2, 2, 1][i]), end: null }));
    const r1 = mod(quatre, []);
    T('4 lignes de la même personne = 1 personne en service', r1.ouverts.length === 1,
      r1.ouverts.map(o => o.nom + ' ' + o.depuis));
    T('c\'est la plus ancienne qui est montrée', r1.ouverts[0].depuis === h(12), r1.ouverts[0]);

    const deux = [
      { nom: DOUBLE, date: dateAuj, start: h(30), end: null },
      { nom: 'Thomas Ryspert', date: dateAuj, start: h(10), end: null },
    ];
    const r2 = mod(deux, []);
    T('deux personnes différentes = 2 en service', r2.ouverts.length === 2);

    const r3 = mod([{ nom: DOUBLE, date: dateAuj, start: h(30), end: null }],
      [{ name: 'Livia Cole', poste: 'Runner' }]);
    T('la fiche est retrouvée malgré la police fantaisie',
      r3.ouverts[0] && r3.ouverts[0].poste === 'Runner', r3.ouverts[0]);
  }
}

/* ==========================================================================
   4. Panel et serveur doivent normaliser à l'identique
   ========================================================================== */
console.log('\n— Panel et serveur, même normalisation —');
{
  const cp = clefs['clefNom (marlowe-actions.js)'], cs = clefs['clefNom (backend)'];
  const rp = clefs['clefRole (marlowe-auth.js)'], rs = clefs['clefRole (backend)'];
  for (const n of [DOUBLE, FRAKTUR, LARGEUR, GRAS, 'Rémi CASTEL', '👑 · PATRON',
                   'Sous-Patron', '田中太郎', '', 'Co-Patron']) {
    T(`clefNom identique des deux côtés : ${JSON.stringify(n).slice(0, 24)}`,
      cp(n) === cs(n), { panel: cp(n), serveur: cs(n) });
    T(`clefRole identique des deux côtés : ${JSON.stringify(n).slice(0, 24)}`,
      rp(n) === rs(n), { panel: rp(n), serveur: rs(n) });
  }
}

console.log(`\n${ok} réussis, ${ko} en échec\n`);
process.exit(ko ? 1 : 0);
