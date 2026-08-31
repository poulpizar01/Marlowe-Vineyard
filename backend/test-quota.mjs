/* Banc d'essai de la lecture des logs et du calcul de quota.
   ---------------------------------------------------------------------------
   On simule Discord et D1. Ce qui est vérifié :

   · la lecture de tes VRAIES lignes de log, à l'octet près ;
   · que c'est la QUANTITÉ qui compte, jamais l'argent ;
   · qu'un même message relu dix fois ne compte qu'une fois — le point qui
     décide de tout ;
   · qu'une autre entreprise écrivant dans le même salon est ignorée ;
   · que le rattachement par nom passe les accents et la casse ;
   · qu'une vente non rattachée est comptée à part et jamais devinée ;
   · qu'un alias posé à la main l'emporte sur le nom ;
   · qu'une intention Contenu des messages manquante (embeds vides) ne
     ressemble PAS à « personne n'a produit ».

   Lancement :  node test-quota.mjs
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const SRC = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const TMP = new URL('./.essai-quota.mjs', import.meta.url);
writeFileSync(TMP, SRC + '\nexport { lireLogs, lireVente, clefNom, handleQuota, handleAlias };\n');
const W = await import(TMP.href);

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};

/* ---------- les vraies lignes, recopiées de la capture ---------- */
const REELS = [
  ['1479', 'Vin', '14790', 'Ernesto Demendes', '7395'],
  ['1640', 'Vin', '16400', 'Miguel Raconter', '8200'],
  ['332',  'Vin', '3320',  'Vladimir Corvino', '1660'],
  ['1887', 'Vin', '18870', 'Miguel Raconter', '9435'],
  ['54',   'Vin', '540',   'Krimo Guendouzi', '270'],
];

let SEQ = 1000000000000000000n;
const msgVente = (q, item, brut, nom, part, job = 'Vigneron', id) => ({
  id: String(id || (SEQ += 1n)),
  timestamp: '2026-08-30T04:04:06.000Z',
  content: '',
  embeds: [{
    title: 'Vente run',
    description: `Vente de ${q}x ${item} pour ${brut}$ par ${nom}. ${part}$ pour la société`,
    fields: [
      { name: 'itemId', value: 'wine' },
      { name: 'jobId', value: '13' },
      { name: 'jobName', value: job },
    ],
  }],
});

/* ---------- la fausse base ---------- */
const KV = new Map();
let VENTES = new Map();          // msg -> ligne, pour imiter INSERT OR IGNORE

function faireDB() {
  const exec = (sql, a) => ({
    async first() {
      if (/SELECT val/.test(sql)) {
        const v = KV.get(a[0]);
        return v === undefined ? null : { val: v };
      }
      return null;
    },
    async run() {
      if (/^INSERT OR IGNORE INTO ventes/.test(sql)) {
        const [msg, ts, nom, cle, qte, brut, part, item, job] = a;
        if (!VENTES.has(msg)) VENTES.set(msg, { msg, ts, nom, cle, qte, brut, part, item, job });
        return {};
      }
      if (/^INSERT INTO kv/.test(sql)) { KV.set(a[0], a[1]); return {}; }
      if (/^DELETE FROM kv WHERE cle/.test(sql)) { KV.delete(a[0]); return {}; }
      return {};
    },
    async all() {
      if (/FROM ventes/.test(sql)) {
        const [du, au] = a;
        const par = new Map();
        for (const v of VENTES.values()) {
          if (v.ts < du || v.ts >= au) continue;
          const g = par.get(v.cle) || { cle: v.cle, nom: v.nom, qte: 0, brut: 0, part: 0, n: 0, dernier: 0 };
          g.qte += v.qte; g.brut += v.brut; g.part += v.part; g.n++;
          g.dernier = Math.max(g.dernier, v.ts);
          par.set(v.cle, g);
        }
        return { results: [...par.values()].sort((x, y) => y.qte - x.qte) };
      }
      return { results: [] };
    },
  });
  return {
    prepare(sql) { return { bind: (...a) => exec(sql, a) }; },
    async batch(reqs) { for (const r of reqs) await r.run(); return []; },
  };
}

let SALON_MSGS = [];
let REFUS = 0;
let VIDER_EMBEDS = false;
let SALON_AILLEURS = false, SALON_INTROUVABLE = false, SALON_INVISIBLE = false;

globalThis.fetch = async (url) => {
  const u = String(url);
  const rep = (o, s = 200) => ({ ok: s < 300, status: s, json: async () => o, text: async () => JSON.stringify(o) });

  const m = u.match(/\/channels\/(\d+)\/messages(\?(.*))?$/);
  if (m) {
    if (REFUS) return rep({ message: 'Missing Access', code: 50001 }, REFUS);
    const q = new URLSearchParams(m[3] || '');
    const after = q.get('after');
    let out = SALON_MSGS.slice();
    if (after) out = out.filter(x => BigInt(x.id) > BigInt(after));
    else out = out.slice(-100).reverse();          // Discord : du plus récent au plus ancien
    out = out.slice(0, 100);
    if (VIDER_EMBEDS) out = out.map(x => ({ ...x, embeds: [], content: '' }));
    return rep(out);
  }
  const seul = u.match(/\/channels\/(\d+)$/);
  if (seul) {
    if (SALON_AILLEURS) return rep({ id: seul[1], name: 'logs-vente-run', guild_id: '999999999999999999' });
    if (SALON_INTROUVABLE) return rep({ message: 'Unknown Channel', code: 10003 }, 404);
    if (SALON_INVISIBLE) return rep({ message: 'Missing Access', code: 50001 }, 403);
    return rep({ id: seul[1], name: 'logs-vente-run', guild_id: '932301610128912414' });
  }
  if (/\/guilds\/\d+\/roles$/.test(u)) return rep([{ id: '222', name: 'DRH', position: 5, managed: false }]);
  if (/\/guilds\/\d+\/members\/(\d+)$/.test(u)) return rep({ roles: ['222'], nick: null });
  throw new Error('appel non simulé : ' + u);
};

const ENV = {
  DB: faireDB(),
  DISCORD_GUILD_ID: '932301610128912414',
  DISCORD_BOT_TOKEN: 'faux',
  DISCORD_LOGS_CHANNEL: '1245400913473179729',
  DISCORD_LOGS_JOB: 'Vigneron',
  PATRON_ROLES: 'Patron',
  OWNER_IDS: '',
};

KV.set('sess:drh', JSON.stringify({ id: '700000000000000001', name: 'Nella Valmora' }));
KV.set('permissions', JSON.stringify({ rhemployes: ['DRH'] }));
KV.set('settings', JSON.stringify({}));
KV.set('journal', JSON.stringify([]));
KV.set('data', JSON.stringify({
  rhRoster: [
    { id: '1', name: 'Ernesto Demendes', poste: 'Saisonnier' },
    { id: '2', name: 'Miguel Raconter', poste: 'Ouvrier Viticole' },
    { id: '3', name: 'Vladimir Corvino', poste: 'Chef de Culture' },
    { id: '4', name: 'Rémi Castel', poste: 'Vendeur' },
  ],
}));

const req = (methode, chemin, corps) => new Request('https://api.test' + chemin, {
  method: methode,
  headers: { Authorization: 'Bearer drh', 'Content-Type': 'application/json' },
  body: corps ? JSON.stringify(corps) : undefined,
});

console.log('\nLa lecture d\'une ligne');
{
  const v = W.lireVente(msgVente(...REELS[4]), 'Vigneron');
  dit('reconnaît ta ligne telle quelle', !!v, v);
  dit('retient la QUANTITÉ, pas l\'argent', v && v.qte === 54, v && { qte: v.qte, brut: v.brut });
  dit('lit aussi le brut et la part', v && v.brut === 540 && v.part === 270, v);
  dit('lit le nom RP', v && v.nom === 'Krimo Guendouzi', v && v.nom);
  dit('normalise le nom pour le rattachement', v && v.cle === 'krimo guendouzi', v && v.cle);

  const gros = W.lireVente(msgVente('1 887', 'Vin', '18 870', 'Miguel Raconter', '9 435'), 'Vigneron');
  dit('supporte un espace dans les milliers', gros && gros.qte === 1887, gros && gros.qte);

  const compose = W.lireVente(msgVente('12', 'Vin', '120', 'Jean-Luc De La Fontaine', '60'), 'Vigneron');
  dit('ne coupe pas un nom composé', compose && compose.nom === 'Jean-Luc De La Fontaine', compose && compose.nom);

  const autre = W.lireVente(msgVente('900', 'Vin', '9000', 'Quelqu\'un', '4500', 'Mecano'), 'Vigneron');
  dit('écarte une autre entreprise', autre === null, autre);

  dit('écarte un message sans embed', W.lireVente({ id: '1', embeds: [] }, 'Vigneron') === null);
  dit('écarte une phrase qui n\'est pas une vente',
    W.lireVente({ id: '1', timestamp: '2026-08-30T00:00:00Z',
      embeds: [{ description: 'Le service a démarré.' }] }, 'Vigneron') === null);
}

console.log('\nLe passage de lecture');
{
  SALON_MSGS = REELS.map(r => msgVente(...r));
  const r1 = await W.lireLogs(ENV);
  dit('lit les cinq ventes', r1.ok && r1.gardees === 5, r1);
  dit('la table en contient cinq', VENTES.size === 5, VENTES.size);
  const total = [...VENTES.values()].reduce((s, v) => s + v.qte, 0);
  dit('le total est bien 1479+1640+332+1887+54 = 5392', total === 5392, total);
}

console.log('\nL\'idempotence — le point qui décide de tout');
{
  const avant = VENTES.size;
  KV.delete('logs:apres');                 // on simule un curseur perdu
  for (let i = 0; i < 5; i++) await W.lireLogs(ENV);
  dit('cinq relectures complètes n\'ajoutent RIEN', VENTES.size === avant, { avant, apres: VENTES.size });
  const total = [...VENTES.values()].reduce((s, v) => s + v.qte, 0);
  dit('et le total ne bouge pas', total === 5392, total);
}

console.log('\nLa suite du flux');
{
  SALON_MSGS.push(msgVente('200', 'Vin', '2000', 'Ernesto Demendes', '1000'));
  const r = await W.lireLogs(ENV);
  dit('la vente suivante est prise', VENTES.size === 6, VENTES.size);
  dit('et elle seule', r.gardees === 1, r.gardees);
}

console.log('\nLe quota agrégé');
{
  const r = await W.handleQuota(req('GET', '/api/quota?du=0&au=99999999999999'), ENV);
  const b = await r.json();
  const par = Object.fromEntries(b.rattachees.map(x => [x.nom, x.vins]));
  dit('Miguel additionne ses deux ventes', par['Miguel Raconter'] === 1640 + 1887, par);
  dit('Ernesto additionne les siennes', par['Ernesto Demendes'] === 1479 + 200, par);
  dit('Vladimir a bien 332', par['Vladimir Corvino'] === 332, par);
  dit('Krimo n\'est pas au registre : il est ORPHELIN, pas jeté',
    b.orphelines.some(o => o.nom === 'Krimo Guendouzi' && o.vins === 54), b.orphelines);
  dit('et il n\'apparaît pas dans les rattachées', !par['Krimo Guendouzi']);
  dit('l\'état du flux accompagne les chiffres', !!b.etat && !!b.etat.at, b.etat);
}

console.log('\nLe rattachement à la main');
{
  const r = await W.handleAlias(req('POST', '/api/alias', { cle: 'Krimo Guendouzi', civil: '4' }), ENV);
  dit('l\'alias est accepté', r.status === 200, r.status);
  const q = await (await W.handleQuota(req('GET', '/api/quota?du=0&au=99999999999999'), ENV)).json();
  const remi = q.rattachees.find(x => x.nom === 'Rémi Castel');
  dit('les ventes de Krimo tombent sur la fiche de Rémi', remi && remi.vins === 54, remi);
  dit('la ligne quitte les orphelines', !q.orphelines.some(o => o.nom === 'Krimo Guendouzi'), q.orphelines);
  dit('et le panel sait que c\'est un alias', remi && remi.via === 'alias', remi && remi.via);

  await W.handleAlias(req('POST', '/api/alias', { cle: 'Krimo Guendouzi', civil: '' }), ENV);
  const q2 = await (await W.handleQuota(req('GET', '/api/quota?du=0&au=99999999999999'), ENV)).json();
  dit('on peut le détacher', q2.orphelines.some(o => o.nom === 'Krimo Guendouzi'));
}

console.log('\nLes accents et la casse');
{
  SALON_MSGS.push(msgVente('77', 'Vin', '770', 'rémi  CASTEL', '385'));
  await W.lireLogs(ENV);
  const q = await (await W.handleQuota(req('GET', '/api/quota?du=0&au=99999999999999'), ENV)).json();
  const remi = q.rattachees.find(x => x.nom === 'Rémi Castel');
  dit('« rémi  CASTEL » rejoint « Rémi Castel »', remi && remi.vins === 77, remi);
}

console.log('\nQuand quelque chose cloche');
{
  REFUS = 403;
  const r = await W.lireLogs(ENV);
  dit('un refus de Discord est dit, pas avalé', !r.ok && /403/.test(r.erreur), r);
  /* Défaut vu en production : l'échec sortait sans rien écrire, et le panel
     affichait « jamais lu » pendant que le cron échouait toutes les 2 min. */
  const trace = JSON.parse(KV.get('logs:etat'));
  dit('l\'échec LAISSE UNE TRACE que le panel peut lire', !!trace && !!trace.erreur, trace);
  dit('et le code brut de Discord est remplacé par une phrase utile',
    !/50001/.test(trace.erreur) && trace.erreur.length > 60, trace.erreur);
  dit('la trace se souvient de la dernière lecture réussie', trace.dernierSucces !== undefined, trace);

  /* Le vrai cas rencontré : 50001 ne veut pas dire « coche une permission ».
     Le salon peut être sur un AUTRE serveur — fréquent quand les logs
     arrivent par webhook, puisqu'un webhook écrit sans que le bot soit là. */
  SALON_AILLEURS = true;
  const ailleurs = await W.lireLogs(ENV);
  dit('un salon sur un autre serveur est nommé comme tel',
    /AUTRE serveur/.test(ailleurs.erreur) && /999999999999999999/.test(ailleurs.erreur), ailleurs.erreur);
  dit('et le panel dit que cocher une permission n\'y changera rien',
    /aucune permission/.test(ailleurs.erreur), ailleurs.erreur);
  SALON_AILLEURS = false;

  SALON_INTROUVABLE = true;
  const introuvable = await W.lireLogs(ENV);
  dit('un identifiant qui n\'existe pas est nommé comme tel',
    /Aucun salon ne porte cet identifiant/.test(introuvable.erreur), introuvable.erreur);
  SALON_INTROUVABLE = false;

  SALON_INVISIBLE = true;
  const invisible = await W.lireLogs(ENV);
  dit('un salon invisible expose les DEUX causes possibles',
    /autre serveur/.test(invisible.erreur) && /Voir les salons/.test(invisible.erreur), invisible.erreur);
  SALON_INVISIBLE = false;

  const memeServeur = await W.lireLogs(ENV);
  dit('un salon du bon serveur pointe vers l\'historique, pas vers le serveur',
    /bien sur le serveur du domaine/.test(memeServeur.erreur)
      && /historique des messages/.test(memeServeur.erreur), memeServeur.erreur);
  REFUS = 0;

  const sansSalon = await W.lireLogs({ ...ENV, DISCORD_LOGS_CHANNEL: '' });
  dit('un salon non déclaré laisse aussi une trace',
    !sansSalon.ok && JSON.parse(KV.get('logs:etat')).erreur.includes('DISCORD_LOGS_CHANNEL'));

  const avant = VENTES.size;
  VIDER_EMBEDS = true;
  KV.delete('logs:apres');
  const r2 = await W.lireLogs(ENV);
  dit('des embeds vides n\'effacent rien', VENTES.size === avant, { avant, apres: VENTES.size });
  dit('et le panel voit que tout a été écarté',
    r2.ok && r2.gardees === 0 && r2.ecartees > 0, r2);
  VIDER_EMBEDS = false;

}

console.log('\nLes droits');
{
  KV.set('sess:saison', JSON.stringify({ id: '700000000000000009', name: 'Sacha' }));
  KV.set('permissions', JSON.stringify({ rhemployes: ['Patron'] }));
  const r = await W.handleAlias(new Request('https://api.test/api/alias', {
    method: 'POST', headers: { Authorization: 'Bearer drh', 'Content-Type': 'application/json' },
    body: JSON.stringify({ cle: 'x', civil: '1' }),
  }), ENV);
  dit('sans le droit sur le registre, pas de rattachement', r.status === 403, r.status);
}

unlinkSync(TMP);
console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
