/* Les deux décisions métier tranchées à la clôture du deuxième audit.
   ---------------------------------------------------------------------------
   1. LA CLÔTURE DIT LA VÉRITÉ SUR SA PÉRIODE. Elle rangeait la production sous
      une étiquette « lundi → dimanche » alors que les compteurs, eux, courent
      depuis la clôture PRÉCÉDENTE : lancée un mercredi, elle archivait deux
      jours de trop. On n'a RIEN recalculé — les compteurs et les montants
      archivés sont intacts — on affiche désormais les dates réelles. Et quand
      le début est inconnu (première clôture, historique purgé), on ne l'invente
      pas : la période se lit « jusqu'au … ».

   2. « QUOTA EN DIRECT » RESPECTE LES EXEMPTIONS, comme la page Primes. Un
      employé dont la fiche porte un quota à 0 est exempté ; cet écran lisait
      seulement le quota de son GRADE et l'affichait en retard. Les deux
      compteurs agrégés du haut de page suivent la même règle.

   Les fonctions sont EXTRAITES du fichier livré (comme test-poste.mjs), pas
   recopiées : un test qui recopie ne teste que sa copie.

   Lancement :  node test-cloture-quota.mjs
*/
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('./marlowe-actions.js', import.meta.url), 'utf8');

function bloc(depart, fin) {
  const i = SRC.indexOf(depart);
  if (i < 0) throw new Error('introuvable : ' + depart);
  const j = SRC.indexOf(fin, i + depart.length);
  if (j < 0) throw new Error('fin introuvable pour : ' + depart);
  return SRC.slice(i, j + fin.length);
}

/* Les dépendances que ces fonctions attendent de leur module, remplacées par
   des valeurs d'essai que chaque section règle à sa guise. */
const code = `
  const window = {};
  let clotures = { weeks: [] };
  let reglages = {};
  let effectifData = [];
` + [
  bloc('  const pad =', ';'),
  bloc('  function parseFR(s) {', '\n  }'),
  bloc('  const frDate =', ';'),
  bloc('  const clefNom =', '\n  };'),
  bloc('  const lastClosedWeek =', ';'),
  bloc('  function libellePeriode(start, end) {', '\n  }'),
  bloc('  function periodeLisible(w) {', '\n  }'),
  bloc('  function closingPeriod() {', '\n  }'),
  bloc('  const QUOTA_DEFAUT_GRADE =', ';'),
  bloc('  function quotaDuGrade(grade) {', '\n  }'),
  bloc('  function quotaDeLaFiche(nom, grade) {', '\n  }'),
  bloc('  function qdQuotaDe(poste, nom) {', '\n  }'),
].join('\n') + `
  return {
    periodeLisible, libellePeriode, closingPeriod, qdQuotaDe, quotaDeLaFiche, frDate,
    poserClotures: v => { clotures = v; },
    poserReglages: v => { reglages = v; },
    poserEffectif: v => { effectifData = v; },
  };
`;
const M = new Function(code)();

let ok = 0, ko = 0;
const T = (t, c, d) => {
  if (c) { ok++; console.log('  ✓ ' + t); }
  else { ko++; console.log('  ✗ ' + t + (d === undefined ? '' : ' → ' + JSON.stringify(d))); }
};
const aujourdhui = M.frDate(new Date());

/* ==========================================================================
   1. La clôture affiche la période réelle
   ========================================================================== */
console.log('\n— La période court de la clôture précédente à maintenant —');
{
  M.poserClotures({ weeks: [{ id: 'x', label: 'Clôture du 08/09/2026', closedAt: '08/09/2026' }] });
  const p = M.closingPeriod();
  T('le début est la date de la clôture précédente',
    p.start instanceof Date && M.frDate(p.start) === '08/09/2026', p.start && M.frDate(p.start));
  T("la fin est aujourd'hui", M.frDate(p.end) === aujourdhui, M.frDate(p.end));
}

console.log("\n— Sans clôture précédente, on n'invente pas de date —");
{
  M.poserClotures({ weeks: [] });
  const p = M.closingPeriod();
  T('le début est explicitement inconnu (null)', p.start === null, p.start);
  T("la fin reste aujourd'hui", M.frDate(p.end) === aujourdhui);

  /* Une clôture précédente sans date d'exécution : même traitement. */
  M.poserClotures({ weeks: [{ id: 'y', label: 'vieille archive' }] });
  T('une archive sans date de clôture ne fournit pas de début',
    M.closingPeriod().start === null);
}

console.log('\n— Ce que la période donne à lire —');
{
  T('les deux dates connues se lisent « du … au … »',
    M.periodeLisible({ du: '08/09/2026', au: '10/09/2026' }) === 'du 08/09/2026 au 10/09/2026',
    M.periodeLisible({ du: '08/09/2026', au: '10/09/2026' }));
  T("un début inconnu se lit « jusqu'au … », jamais « undefined »",
    M.periodeLisible({ du: '', au: '10/09/2026' }) === "jusqu'au 10/09/2026",
    M.periodeLisible({ du: '', au: '10/09/2026' }));
  T('… y compris quand le champ est absent',
    M.periodeLisible({ au: '10/09/2026' }) === "jusqu'au 10/09/2026");
  T('une archive sans aucune date le dit au lieu de mentir',
    M.periodeLisible({}) === 'période inconnue', M.periodeLisible({}));

  /* Les archives d'AVANT ce changement portent des dates de semaine théorique.
     On les affiche telles qu'elles ont été enregistrées : les réécrire après
     coup inventerait un passé. */
  const ancienne = { du: '31/08/2026', au: '06/09/2026' };
  T("une ancienne archive est affichée telle quelle, sans réécriture",
    M.periodeLisible(ancienne) === 'du 31/08/2026 au 06/09/2026');
}

console.log("\n— Sans clôture précédente, les écrans ne PLANTENT pas —");
{
  /* Régression vécue : closingPeriod() peut rendre start = null, et trois
     écrans appelaient frDate(start) / isoWeek(start) sans protection. Sur une
     installation neuve — aucune clôture enregistrée — la page Primes et la
     page Clôture levaient « Cannot read properties of null (reading
     'getDate') », et s'arrêtaient de s'afficher. */
  const fin = new Date(2026, 8, 12);
  T('une période sans début se lit « jusqu\'au … »',
    M.libellePeriode(null, fin) === 'jusqu\'au 12/09/2026', M.libellePeriode(null, fin));
  T('avec un début, elle se lit « du … au … »',
    M.libellePeriode(new Date(2026, 8, 8), fin) === 'du 08/09/2026 au 12/09/2026');
  T('aucune exception quand le début est inconnu',
    (() => { try { M.libellePeriode(null, fin); return true; } catch (e) { return false; } })());

  /* Et le garde sur le source : plus aucun appel non protégé. */
  const nus = (SRC.match(/[^?]\s\$\{frDate\(start\)\}/g) || [])
    .concat(SRC.match(/\$\{isoWeek\(start\)\}/g) || []);
  const gardes = /start \? 'Semaine ' \+ isoWeek\(start\)/.test(SRC);
  T('plus aucun isoWeek(start) sans garde', gardes && !/`Semaine \$\{isoWeek\(start\)\}/.test(SRC));
  T('les trois écrans passent par libellePeriode',
    (SRC.match(/libellePeriode\(start, end\)/g) || []).length >= 2,
    (SRC.match(/libellePeriode\(start, end\)/g) || []).length);
}

console.log('\n— Les compteurs ne sont PAS recalculés (garde sur le source) —');
{
  /* Vérification sur le texte du fichier, et assumée comme telle : closeWeek()
     ouvre une boîte de dialogue et touche au DOM, on ne peut pas l'exécuter
     ici. Ce qu'on garde, c'est l'absence de tout bornage par date sur les
     compteurs — c'est la promesse faite en tranchant cette décision. */
  const i = SRC.indexOf('async function closeWeek()');
  const corps = SRC.slice(i, SRC.indexOf('\n  }', i));

  T("l'éligibilité lit les compteurs vivants, sans borne de date",
    corps.includes('.filter(e => e.active && e.barils >= e.quota)'));
  T('les heures somment tout le service, sans borne de date',
    corps.includes("serviceHistory.filter(s => s.end)"));
  T('la production archivée reste celle des compteurs',
    corps.includes('production: effectifData.map'));
  /* La vraie promesse : les bornes de période n'entrent PAS dans le calcul des
     compteurs. On regarde donc les expressions elles-mêmes, plutôt que de
     compter des occurrences — `serviceHistory` a un champ `start` qui n'a rien
     à voir, et le compte s'y trompait. */
  const entre = (a, b) => corps.slice(corps.indexOf(a), corps.indexOf(b));
  const calculs = entre('const eligibles', 'const bil');
  T('ni eligibles ni heures ne sont bornés par la période',
    !/(?<![.\w])(start|end)\b/.test(calculs), calculs.match(/(?<![.\w])(start|end)\b/g));
  T("l'étiquette ne prétend plus être un numéro de semaine",
    !corps.includes('isoWeek(start)') && corps.includes('Clôture du '));
  T("le début inconnu n'est pas remplacé par une date inventée",
    corps.includes("du: start ? frDate(start) : ''"));
}

/* ==========================================================================
   2. « Quota en direct » respecte les exemptions
   ========================================================================== */
console.log("\n— Un employé exempté n'a pas le quota de son grade —");
{
  M.poserReglages({ quotas: { 'Ouvrier Viticole': 110 } });
  M.poserEffectif([
    { name: 'Paul Exempté', grade: 'Ouvrier Viticole', quota: 0 },
    { name: 'Marie Normale', grade: 'Ouvrier Viticole', quota: 50 },
  ]);

  T('un exempté (fiche à 0) rend bien 0, et non le quota du grade',
    M.qdQuotaDe('Ouvrier Viticole', 'Paul Exempté') === 0,
    M.qdQuotaDe('Ouvrier Viticole', 'Paul Exempté'));
  T('une fiche avec un quota sur mesure rend ce quota',
    M.qdQuotaDe('Ouvrier Viticole', 'Marie Normale') === 50);
  T("quelqu'un sans fiche à l'effectif retombe sur le quota du grade",
    M.qdQuotaDe('Ouvrier Viticole', 'Inconnu au bataillon') === 110,
    M.qdQuotaDe('Ouvrier Viticole', 'Inconnu au bataillon'));
  T('la casse et les accents du nom ne changent rien',
    M.qdQuotaDe('Ouvrier Viticole', 'PAUL EXEMPTÉ') === 0);
  T('Primes et Quota en direct donnent désormais le MÊME chiffre',
    M.qdQuotaDe('Ouvrier Viticole', 'Paul Exempté')
      === M.quotaDeLaFiche('Paul Exempté', 'Ouvrier Viticole'));
}

console.log('\n— Effet sur les deux compteurs agrégés —');
{
  M.poserReglages({ quotas: { 'Ouvrier Viticole': 110 } });
  M.poserEffectif([
    { name: 'Paul Exempté', grade: 'Ouvrier Viticole', quota: 0 },
    { name: 'Marie Normale', grade: 'Ouvrier Viticole', quota: 50 },
    { name: 'Luc Normal', grade: 'Ouvrier Viticole', quota: 50 },
  ]);

  /* Les deux compteurs du haut de page, tels qu'ils sont écrits dans
     renderQuotaDirect — rejoués ici avec la VRAIE fonction de quota. */
  const rattachees = [
    { nom: 'Paul Exempté', poste: 'Ouvrier Viticole', vins: 300 },  /* exempté, gros producteur */
    { nom: 'Marie Normale', poste: 'Ouvrier Viticole', vins: 60 },  /* atteint */
    { nom: 'Luc Normal', poste: 'Ouvrier Viticole', vins: 10 },     /* en retard */
  ];
  const atteints = rattachees.filter(r => {
    const q = M.qdQuotaDe(r.poste, r.nom); return q > 0 && r.vins >= q;
  }).length;
  const avecQuota = rattachees.filter(r => M.qdQuotaDe(r.poste, r.nom) > 0).length;

  T("l'exempté sort du DÉNOMINATEUR : 2 personnes ont un quota, pas 3",
    avecQuota === 2, avecQuota);
  T("il sort aussi du NUMÉRATEUR, malgré ses 300 vins", atteints === 1, atteints);
  T('la tuile affiche donc « 1 / 2 »', `${atteints} / ${avecQuota}` === '1 / 2');

  /* Tout le monde exempté : la fraction n'a plus de sens, la tuile le dit. */
  M.poserEffectif([
    { name: 'Paul Exempté', grade: 'Ouvrier Viticole', quota: 0 },
    { name: 'Marie Normale', grade: 'Ouvrier Viticole', quota: 0 },
    { name: 'Luc Normal', grade: 'Ouvrier Viticole', quota: 0 },
  ]);
  const avecQuota2 = rattachees.filter(r => M.qdQuotaDe(r.poste, r.nom) > 0).length;
  T("tous exemptés → aucun dénominateur, la tuile affichera « — »", avecQuota2 === 0);
}

console.log("\n— Les appels de la page passent bien le nom (garde sur le source) —");
{
  for (const motif of [
    'const quota = qdQuotaDe(r.poste, r.nom);',
    'const q2 = qdQuotaDe(r.poste, r.nom); return q2 > 0 && r.vins >= q2;',
    'rattachees.filter(r => qdQuotaDe(r.poste, r.nom) > 0).length',
  ]) {
    T('« ' + motif.slice(0, 46) + '… » est bien câblé', SRC.includes(motif), motif);
  }
  T('plus aucun appel ne se contente du poste',
    !/qdQuotaDe\(\s*r\.poste\s*\)/.test(SRC));
}

console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
