/* Banc d'essai du rappel de permis.
   ---------------------------------------------------------------------------
   Le Worker ne peut pas être essayé contre le vrai Discord depuis ici — et il
   ne DOIT pas l'être : un test qui poste pour de bon écrit dans les tickets de
   gens réels. On simule donc Discord et la base, et on vérifie ce qui compte :

   · le salon est repéré par la permission nominative, jamais par le nom ;
   · les rôles du staff, posés sur tous les tickets, ne trompent pas la
     recherche ;
   · l'identifiant Discord vient du registre en base, JAMAIS du corps de la
     requête — c'est le verrou qui empêche d'écrire au nom de n'importe qui ;
   · la signature vient de la session, pas du texte envoyé ;
   · une deuxième relance dans les 24 h est refusée AVANT d'appeler Discord ;
   · sans ticket, le message part en privé ; privé fermé, on le dit.

   Lancement :  node test-rappel.mjs
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

/* On réexporte les fonctions internes du Worker sans toucher au fichier. */
const SRC = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const TMP = new URL('./.essai-worker.mjs', import.meta.url);
writeFileSync(TMP, SRC + '\nexport { handleRappel, ticketDe, categoriesTickets, corpsRappel };\n');
const W = await import(TMP.href);

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};

/* ---------- le faux Discord ---------- */
const CAT = '1489223949790216303';
const MOI = '826526979204841482';      // l'employé visé
const AUTRE = '111111111111111111';    // un collègue
const ROLE_STAFF = '222222222222222222';

let SALONS = [
  { id: '900000000000000001', type: 0, name: 'ticket-0001', parent_id: CAT,
    permission_overwrites: [
      { id: ROLE_STAFF, type: 0 },        // un rôle : ne doit RIEN désigner
      { id: AUTRE, type: 1 },
    ] },
  { id: '900000000000000412', type: 0, name: 'ticket-0412', parent_id: CAT,
    permission_overwrites: [
      { id: ROLE_STAFF, type: 0 },
      { id: MOI, type: 1 },               // c'est celui-là
    ] },
  { id: '900000000000000999', type: 0, name: 'ticket-vieux', parent_id: 'AUTRECAT',
    permission_overwrites: [{ id: MOI, type: 1 }] },   // hors catégorie : ignoré
];

let ENVOIS = [];
let REFUSER_SALON = false, REFUSER_PRIVE = false, REFUSER_CANAL = false;

globalThis.fetch = async (url, init) => {
  const u = String(url);
  const rep = (o, s = 200) => ({ ok: s < 300, status: s, json: async () => o });

  if (u.includes('/channels') && u.includes('/guilds/')) return rep(SALONS);
  if (u.endsWith('/users/@me/channels')) {
    if (REFUSER_CANAL) return rep({ message: 'Cannot send messages to this user' }, 403);
    return rep({ id: 'dm-1' });
  }
  if (/\/channels\/dm-1\/messages$/.test(u)) {
    if (REFUSER_PRIVE) return rep({ message: 'Cannot send messages to this user' }, 403);
    ENVOIS.push({ ou: 'prive', corps: JSON.parse(init.body) });
    return rep({ id: 'm1' });
  }
  if (/\/channels\/\d+\/messages$/.test(u)) {
    if (REFUSER_SALON) return rep({ message: 'Missing Permissions' }, 403);
    ENVOIS.push({ ou: 'salon', salon: u.match(/channels\/(\d+)/)[1], corps: JSON.parse(init.body) });
    return rep({ id: 'm1' });
  }
  throw new Error('appel Discord non simulé : ' + u);
};

/* ---------- la fausse base ---------- */
const TABLE = new Map();
const jsonDe = v => (typeof v === 'string' ? JSON.parse(v) : v);
TABLE.set('data', JSON.stringify({
  rhRoster: [
    { id: '550219', name: 'Rémi Castel', discord: MOI, permis: false },
    { id: '550220', name: 'Sacha Bellini', discord: 'carrote_raper', permis: false },
    { id: '550221', name: 'Nina Kovacs', discord: AUTRE, permis: false },
  ],
  reglages: { rappelPermis: 'Texte du domaine.' },
}));
TABLE.set('permissions', JSON.stringify({ rhemployes: ['DRH'] }));
TABLE.set('settings', JSON.stringify({}));
TABLE.set('journal', JSON.stringify([]));

const DB = {
  prepare(sql) {
    return {
      bind(...a) {
        return {
          async first() {
            if (!/SELECT val/.test(sql)) return null;
            const v = TABLE.get(a[0]);
            return v === undefined ? null : { val: v };
          },
          async run() {
            if (/^INSERT INTO kv/.test(sql)) TABLE.set(a[0], a[1]);
            if (/^DELETE FROM kv WHERE cle/.test(sql)) TABLE.delete(a[0]);
            return {};
          },
          async all() { return { results: [] }; },
        };
      },
    };
  },
};

const ENV = {
  DB,
  DISCORD_GUILD_ID: '932301610128912414',
  DISCORD_BOT_TOKEN: 'faux',
  DISCORD_TICKET_CATEGORIES: CAT + ',1489222452495122484',
  OWNER_IDS: '',
  PATRON_ROLES: 'Patron',
  SITE_URL: 'https://exemple.test',
};

/* Une session est une ligne 'sess:…' comme les vraies. On pose un DRH, qui a
   le droit d'écrire rhemployes sans être patron : c'est le cas intéressant. */
TABLE.set('sess:jeton-drh', JSON.stringify({ id: '700000000000000001', name: 'Nella Valmora' }));
TABLE.set('sess:jeton-nul', JSON.stringify({ id: '700000000000000002', name: 'Sacha Bellini' }));

/* memberRoles interroge Discord : on l'intercepte au niveau du fetch guild. */
const fetchDiscord = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (/\/guilds\/\d+\/roles$/.test(u)) {
    return { ok: true, status: 200, json: async () => ([
      { id: ROLE_STAFF, name: 'DRH', position: 5, managed: false },
      { id: '333', name: 'Saisonnier', position: 1, managed: false },
    ]) };
  }
  const m = u.match(/\/guilds\/\d+\/members\/(\d+)$/);
  if (m) {
    const roles = m[1] === '700000000000000001' ? [ROLE_STAFF] : ['333'];
    return { ok: true, status: 200, json: async () => ({ roles, nick: null }) };
  }
  return fetchDiscord(url, init);
};

const req = (methode, chemin, jeton, corps) => new Request('https://api.test' + chemin, {
  method: methode,
  headers: Object.assign({ Authorization: 'Bearer ' + jeton },
    corps ? { 'Content-Type': 'application/json' } : {}),
  body: corps ? JSON.stringify(corps) : undefined,
});

console.log('\nLe repérage du salon');
{
  const t = await W.ticketDe(ENV, MOI);
  dit('retient le ticket où la personne a une permission à son nom', t && t.name === 'ticket-0412', t && t.name);
  const t2 = await W.ticketDe(ENV, AUTRE);
  dit('ne confond pas deux employés', t2 && t2.name === 'ticket-0001', t2 && t2.name);
  const t3 = await W.ticketDe(ENV, '999999999999999999');
  dit('rend null quand personne n\'a de ticket', t3 === null);
  dit('ignore les catégories non déclarées',
    !(await W.ticketDe({ ...ENV, DISCORD_TICKET_CATEGORIES: 'AUTRECAT' }, MOI)));
}

console.log('\nLes droits');
{
  const r = await W.handleRappel(req('POST', '/api/rappel', 'jeton-nul', { civil: '550219' }), ENV);
  dit('un saisonnier ne peut pas envoyer de rappel', r.status === 403, r.status);
  const r2 = await W.handleRappel(req('POST', '/api/rappel', 'inexistant', { civil: '550219' }), ENV);
  dit('sans session, refus', r2.status === 401, r2.status);
}

console.log('\nL\'envoi dans le ticket');
{
  ENVOIS = [];
  const r = await W.handleRappel(req('POST', '/api/rappel', 'jeton-drh',
    { civil: '550219', texte: 'Passe ton permis stp.', discord: '000000000000000000' }), ENV);
  const b = await r.json();
  dit('part dans le bon salon', b.ok && b.ou === 'ticket' && b.salon === 'ticket-0412', b);
  const e = ENVOIS[0];
  dit('mentionne la personne', e && e.corps.content === `<@${MOI}>`, e && e.corps.content);
  dit('IGNORE l\'identifiant envoyé par le navigateur',
    e && e.salon === '900000000000000412' && !JSON.stringify(e.corps).includes('000000000000000000'));
  dit('signe du pseudo de la session, pas du corps de la requête',
    e && e.corps.embeds[0].footer.text.startsWith('Demandé par Nella Valmora'),
    e && e.corps.embeds[0].footer.text);
  dit('reprend le texte modifié', e && e.corps.embeds[0].description === 'Passe ton permis stp.');
  dit('verrouille les mentions sur la seule personne visée',
    e && e.corps.allowed_mentions.parse.length === 0
      && e.corps.allowed_mentions.users.length === 1
      && e.corps.allowed_mentions.users[0] === MOI);
}

console.log('\nLa limite de 24 heures');
{
  ENVOIS = [];
  const r = await W.handleRappel(req('POST', '/api/rappel', 'jeton-drh', { civil: '550219' }), ENV);
  dit('la deuxième relance est refusée', r.status === 429, r.status);
  dit('et rien n\'a été envoyé à Discord', ENVOIS.length === 0, ENVOIS.length);
  const b = await r.json();
  dit('le panel apprend qui a relancé et quand', b.dernier && b.dernier.par === 'Nella Valmora', b.dernier);
}

console.log('\nLa fiche sans identifiant');
{
  const r = await W.handleRappel(req('POST', '/api/rappel', 'jeton-drh', { civil: '550220' }), ENV);
  const b = await r.json();
  dit('un pseudo ne passe pas pour un identifiant', r.status === 400 && b.error === 'sans_identifiant', b);
  const r2 = await W.handleRappel(req('POST', '/api/rappel', 'jeton-drh', { civil: '999999' }), ENV);
  dit('un n° civil inconnu est refusé', r2.status === 404, r2.status);
}

console.log('\nLe repli en message privé');
{
  ENVOIS = [];
  TABLE.set('data', JSON.stringify({
    rhRoster: [{ id: '550222', name: 'Jonas Weiss', discord: '444444444444444444' }],
    reglages: { rappelPermis: 'Texte du domaine.' },
  }));
  const r = await W.handleRappel(req('POST', '/api/rappel', 'jeton-drh', { civil: '550222' }), ENV);
  const b = await r.json();
  dit('sans ticket, le rappel part en privé', b.ok && b.ou === 'prive', b);
  dit('avec le texte par défaut du domaine',
    ENVOIS[0] && ENVOIS[0].corps.embeds[0].description === 'Texte du domaine.',
    ENVOIS[0] && ENVOIS[0].corps.embeds[0].description);
}

console.log('\nQuand Discord refuse');
{
  TABLE.delete('rappel:555555555555555555');
  TABLE.set('data', JSON.stringify({
    rhRoster: [{ id: '550223', name: 'Ugo Pereira', discord: '555555555555555555' }],
  }));
  REFUSER_CANAL = true;
  const r = await W.handleRappel(req('POST', '/api/rappel', 'jeton-drh', { civil: '550223' }), ENV);
  const b = await r.json();
  dit('un privé fermé est dit, pas maquillé en succès', r.status === 502 && !b.ok, b);
  dit('et le message de Discord est remonté tel quel', /Cannot send messages/.test(b.detail || ''), b.detail);
  REFUSER_CANAL = false;

  TABLE.delete('rappel:' + MOI);
  TABLE.set('data', JSON.stringify({ rhRoster: [{ id: '550219', name: 'Rémi Castel', discord: MOI }] }));
  REFUSER_SALON = true;
  const r2 = await W.handleRappel(req('POST', '/api/rappel', 'jeton-drh', { civil: '550219' }), ENV);
  const b2 = await r2.json();
  dit('un salon interdit ne bascule PAS en privé en douce',
    r2.status === 502 && b2.error === 'refus_salon', b2);
  REFUSER_SALON = false;
}

console.log('\nL\'aperçu avant envoi');
{
  TABLE.delete('rappel:' + MOI);
  const r = await W.handleRappel(req('GET', '/api/rappel?civil=550219', 'jeton-drh'), ENV);
  const b = await r.json();
  dit('annonce le salon qui sera utilisé', b.salon && b.salon.nom === 'ticket-0412', b.salon);
  dit('n\'envoie rien', ENVOIS.filter(e => e.corps.embeds[0].description === undefined).length === 0);
}

console.log('\nLa configuration manquante');
{
  const r = await W.handleRappel(req('POST', '/api/rappel', 'jeton-drh', { civil: '550219' }),
    { ...ENV, DISCORD_TICKET_CATEGORIES: '' });
  dit('sans catégories déclarées, le Worker le dit clairement', r.status === 500, r.status);
}

unlinkSync(TMP);
console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
