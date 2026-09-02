/* Rejoue la logique de la roue telle qu'elle est écrite dans marlowe-actions.js,
   extraite du fichier livré — pas une copie réécrite pour l'occasion. */
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('./marlowe-actions.js', import.meta.url),'utf8');
function ex(nom){
  const i = SRC.indexOf('function '+nom+'(');
  if(i<0) throw new Error('introuvable : '+nom);
  let j=SRC.indexOf('{',i),p=0,k=j;
  for(;k<SRC.length;k++){if(SRC[k]==='{')p++;else if(SRC[k]==='}'&&--p===0)break;}
  return SRC.slice(i,k+1);
}
const bloc = `
  let tombolaMelange = { signature: '', ordre: [] };
  ${ex('melangerFisherYates')}
  ${ex('repartirLesTickets')}
  ${ex('tirerAuSort')}
  function teinte(i,n){return 'c'+i;}
  function ticketsDe(l){return {parGrade:0,parQuota:0,total:l.tickets,quota:0};}
  let dash = [];
  ${ex('participantsTombola')}
  return { participantsTombola, tirerAuSort, set:d=>{dash=d;}, reset:()=>{tombolaMelange={signature:'',ordre:[]};} };
`;
const W = new Function(bloc)();

let ok=0,ko=0;
const T=(t,c,d)=>{ if(c){ok++;console.log('  ✓ '+t);} else {ko++;console.log('  ✗ '+t+(d===undefined?'':' → '+JSON.stringify(d)));} };

const EQUIPE = [
  {name:'Julio', tickets:8}, {name:'Lea', tickets:5}, {name:'Emile', tickets:3},
  {name:'Marc', tickets:2}, {name:'Ana', tickets:1}, {name:'Sol', tickets:1},
];
W.set(EQUIPE);

console.log('\n— Les secteurs —');
{
  const {liste,total,segments} = W.participantsTombola();
  T('20 tickets au total', total===20, total);
  T('un secteur par ticket', segments.length===total, segments.length);
  T('les secteurs couvrent le tour entier',
    Math.abs(segments[segments.length-1].endDeg-360)<1e-9, segments[segments.length-1].endDeg);
  T('aucun trou entre deux secteurs',
    segments.every((s,i)=> i===0 || Math.abs(s.startDeg-segments[i-1].endDeg)<1e-9));
  const parNom = {};
  segments.forEach(s=>{ parNom[s.name]=(parNom[s.name]||0)+1; });
  T('chacun a exactement ses tickets',
    EQUIPE.every(e=>parNom[e.name]===e.tickets), parNom);
}

console.log('\n— Les noms sont-ils VRAIMENT mélangés ? —');
{
  /* Avec 8 tickets sur 20 places, être tous collés est extraordinairement
     improbable. On mesure sur 200 mélanges le nombre de voisins identiques. */
  let collesTotal=0, pire=0;
  for(let n=0;n<200;n++){
    W.reset();
    const {segments}=W.participantsTombola();
    const N=segments.length; let colles=0,max=1,suite=1;
    for(let i=0;i<N;i++){
      if(segments[i].name===segments[(i+1)%N].name){colles++;suite++;max=Math.max(max,suite);}
      else suite=1;
    }
    collesTotal+=colles; pire=Math.max(pire,max);
  }
  const moy = collesTotal/200;
  /* Espérance théorique de voisins identiques ≈ Σ t(t-1)/(N-1) = 96/19 ≈ 5,05 */
  T('aucun voisin identique (8 tickets sur 20, c\'est atteignable)',
    collesTotal===0, 'total sur 200 mélanges : '+collesTotal);
  T('donc aucune suite de deux', pire===1, pire);
}

console.log('\n— Les chances n\'ont pas changé —');
{
  W.reset();
  const {liste,total} = W.participantsTombola();
  const compte = {};
  const N = 200000;
  for(let i=0;i<N;i++){ const g=W.tirerAuSort(liste,total); compte[g.name]=(compte[g.name]||0)+1; }
  for(const e of EQUIPE){
    const attendu = e.tickets/20, obtenu = (compte[e.name]||0)/N;
    T(`${e.name} : ${(attendu*100).toFixed(0)} % attendu, ${(obtenu*100).toFixed(1)} % obtenu`,
      Math.abs(obtenu-attendu)<0.01);
  }
}

console.log('\n— Le mélange tient entre deux redessins —');
{
  W.reset();
  const a = W.participantsTombola().segments.map(s=>s.name).join(',');
  const b = W.participantsTombola().segments.map(s=>s.name).join(',');
  const c = W.participantsTombola().segments.map(s=>s.name).join(',');
  T('trois appels de suite donnent le même ordre', a===b && b===c);

  /* Le cas qui compte : la roue est redessinée pendant l'animation. */
  W.set(EQUIPE.slice());
  const d = W.participantsTombola().segments.map(s=>s.name).join(',');
  T('un rafraîchissement des données ne remélange pas', a===d);

  /* Mais une vraie composition différente, si. */
  W.set([...EQUIPE, {name:'Nouveau', tickets:4}]);
  const e = W.participantsTombola().segments;
  T('un participant en plus remélange', e.length===24);
  W.set(EQUIPE.map(x=> x.name==='Ana' ? {name:'Ana',tickets:6} : x));
  const f = W.participantsTombola().segments.filter(s=>s.name==='Ana').length;
  T('un ticket gagné est pris en compte', f===6, f);
}

console.log('\n— La flèche s\'arrête bien sur le gagnant —');
{
  W.set(EQUIPE); W.reset();
  let faux=0;
  for(let n=0;n<5000;n++){
    const {liste,total,segments}=W.participantsTombola();
    const gagnant = W.tirerAuSort(liste,total);
    const miens = segments.filter(s=>liste[s.idx] && liste[s.idx].name===gagnant.name);
    if(!miens.length){faux++;continue;}
    const vise = miens[Math.floor(Math.random()*miens.length)];
    const marge=(vise.endDeg-vise.startDeg)*0.15;
    const cible=vise.startDeg+marge+Math.random()*((vise.endDeg-vise.startDeg)-2*marge);
    /* Quel secteur cet angle désigne-t-il réellement ? */
    const touche = segments.find(s=>cible>=s.startDeg && cible<s.endDeg);
    if(!touche || touche.name!==gagnant.name) faux++;
  }
  T('sur 5 000 tirages, l\'angle visé désigne toujours le gagnant', faux===0, faux);
}

console.log('\n— Le cas impossible, et la variété —');
{
  /* Majorité absolue : 7 tickets sur 10, aucune disposition ne peut éviter
     tous les voisinages. On vérifie que ça ne plante pas et que le résultat
     reste correct. */
  W.set([{name:'Gros',tickets:7},{name:'A',tickets:1},{name:'B',tickets:1},{name:'C',tickets:1}]);
  W.reset();
  const s2 = W.participantsTombola().segments;
  T('majorité absolue : la roue se dessine quand même', s2.length===10);
  T('les 7 tickets sont tous là', s2.filter(x=>x.name==='Gros').length===7);
  T('les secteurs restent jointifs',
    s2.every((x,i)=> i===0 || Math.abs(x.startDeg-s2[i-1].endDeg)<1e-9));

  /* Deux semaines de suite ne doivent pas donner la même roue. */
  W.set(EQUIPE);
  const vus = new Set();
  for(let i=0;i<40;i++){ W.reset(); vus.add(W.participantsTombola().segments.map(x=>x.name).join(',')); }
  T('40 semaines donnent 40 roues différentes', vus.size>=35, vus.size);
}

console.log('\n— Les cas limites —');
{
  W.set([{name:'Seul',tickets:1}]); W.reset();
  const un = W.participantsTombola();
  T('un seul ticket : un secteur de 360°',
    un.segments.length===1 && Math.abs(un.segments[0].endDeg-360)<1e-9);
  W.set([]); W.reset();
  const vide = W.participantsTombola();
  T('personne : aucun secteur, aucun plantage',
    vide.segments.length===0 && vide.total===0);
  W.set([{name:'A',tickets:0},{name:'B',tickets:0}]); W.reset();
  T('tout le monde à zéro ticket : liste vide', W.participantsTombola().liste.length===0);
}

console.log(`\n  ${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko?1:0);
