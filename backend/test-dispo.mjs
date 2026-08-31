/* Banc d'essai du bouton « Je suis disponible ».
   ---------------------------------------------------------------------------
   C'est l'inverse d'une demande de retrait : un responsable annonce sa
   présence dans le salon des runners. Le webhook n'est pas appelé pour de
   vrai — un essai qui poste écrirait dans un salon que tout le monde lit.

   Ce qui est vérifié, et pourquoi chaque point est là :

   · un réglage vide ne laisse passer que le patron. Une liste de rôles qu'on
     n'a jamais touchée ne doit ouvrir aucune porte ;
   · le nom annoncé vient de la SESSION, jamais du corps de la requête —
     sinon n'importe qui se déclarerait disponible au nom d'un autre ;
   · le rôle client est mentionné, et l'autorisation Discord qui va avec est
     bien posée : sans « allowed_mentions », le message part sans réveiller
     personne, en silence, avec un code 200 — le défaut exact qu'on avait
     déjà eu sur le rappel de permis ;
   · quand le rôle n'est pas déclaré côté serveur, l'annonce part quand même
     mais la réponse le dit (« mention: false ») au lieu de laisser croire au
     succès complet ;
   · une deuxième annonce dans les dix minutes est refusée AVANT d'appeler
     Discord ;
   · un webhook absent ou mal collé est nommé, pas confondu avec une panne ;
   · les réglages enregistrés ne perdent plus « agendaVis » ni « dispoRoles »
     au passage — c'est le filtre en liste blanche de /api/settings.

   Lancement :  node test-dispo.mjs
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const SRC = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const TMP = new URL('./.essai-dispo.mjs', import.meta.url);
writeFileSync(TMP, SRC + '\nexport { handleDispo, handleSettings, peutAnnoncerDispo, webhookDuSalon };\n');
const W = await import(TMP.href);

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};

const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/jeton-de-test_-abc';
const ROLE_CLIENT = '1112658686431723520';
const ROLE_RESP = '444444444444444444';
const ROLE_SAISO = '333333333333333333';

/* ---------- le faux Discord ---------- */
let ENVOIS = [];
let WEBHOOK_REFUSE = false;

globalThis.fetch = async (url, init) => {
  const u = String(url);
  const rep = (o, s = 200) => ({ ok: s < 300, status: s, json: async () => o });

  if (/\/guilds\/\d+\/roles$/.test(u)) return rep([
    { id: ROLE_RESP, name: 'Responsable', position: 5, managed: false },
    { id: ROLE_SAISO, name: 'Saisonnier', position: 1, managed: false },
  ]);
  const m = u.match(/\/guilds\/\d+\/members\/(\d+)$/);
  if (m) {
    const roles = m[1] === '700000000000000001' ? [ROLE_RESP] : [ROLE_SAISO];
    return rep({ roles, nick: null });
  }
  if (u.startsWith('https://discord.com/api/webhooks/')) {
    if (WEBHOOK_REFUSE) return rep({ message: 'Unknown Webhook' }, 404);
    ENVOIS.push(JSON.parse(init.body));
    return rep({ id: 'msg-1' });
  }
  throw new Error('appel Discord non simulé : ' + u);
};

/* ---------- la fausse base ---------- */
const TABLE = new Map();
TABLE.set('data', JSON.stringify({ rhRoster: [] }));
TABLE.set('permissions', JSON.stringify({}));
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
  DISCORD_WEBHOOK: WEBHOOK,
  DISCORD_DISPO_ROLE: ROLE_CLIENT,
  OWNER_IDS: '',
  PATRON_ROLES: 'Patron',
  SITE_URL: 'https://exemple.test',
};

/* Deux sessions : un responsable (rôle « Responsable ») et un saisonnier. */
TABLE.set('sess:jeton-resp', JSON.stringify({ id: '700000000000000001', name: 'Robert Morgan' }));
TABLE.set('sess:jeton-saiso', JSON.stringify({ id: '700000000000000002', name: 'Sacha Bellini' }));

const req = (methode, chemin, jeton, corps) => new Request('https://api.test' + chemin, {
  method: methode,
  headers: Object.assign(jeton ? { Authorization: 'Bearer ' + jeton } : {},
    corps ? { 'Content-Type': 'application/json' } : {}),
  body: corps ? JSON.stringify(corps) : undefined,
});

const reglages = o => TABLE.set('settings', JSON.stringify(o));
const oublier = () => TABLE.delete('dispo:700000000000000001');

/* ====================================================================== */
console.log('\nQui a le droit d\'annoncer');
{
  const patron = { isPatron: true, roles: [] };
  const resp = { isPatron: false, roles: ['Responsable'] };
  const saiso = { isPatron: false, roles: ['Saisonnier'] };
  const invite = { isPatron: false, roles: [], invite: { pages: ['comrunner'], ro: [] } };

  dit('liste vide : le patron seul', W.peutAnnoncerDispo(patron, {}) === true
    && W.peutAnnoncerDispo(resp, {}) === false);
  dit('liste absente : idem, aucune porte ouverte par défaut',
    W.peutAnnoncerDispo(resp, { dispoRoles: undefined }) === false);
  dit('un rôle coché passe', W.peutAnnoncerDispo(resp, { dispoRoles: ['Responsable'] }) === true);
  dit('un rôle non coché ne passe pas',
    W.peutAnnoncerDispo(saiso, { dispoRoles: ['Responsable'] }) === false);
  dit('le patron passe même sans être coché',
    W.peutAnnoncerDispo(patron, { dispoRoles: ['Responsable'] }) === true);
  dit('un accès extérieur ne parle jamais au salon',
    W.peutAnnoncerDispo(invite, { dispoRoles: ['Responsable'] }) === false);
}

console.log('\nLe refus, avant tout appel à Discord');
{
  ENVOIS = []; reglages({}); oublier();
  const r = await W.handleDispo(req('POST', '/api/dispo', 'jeton-resp', {}), ENV);
  dit('sans rôle coché, refus', r.status === 403, r.status);
  dit('et rien n\'est parti sur Discord', ENVOIS.length === 0, ENVOIS.length);

  const r2 = await W.handleDispo(req('POST', '/api/dispo', 'inexistant', {}), ENV);
  dit('sans session, refus', r2.status === 401, r2.status);

  const r3 = await W.handleDispo(req('GET', '/api/dispo', 'jeton-resp'), ENV);
  dit('une lecture ne déclenche rien', r3.status === 405, r3.status);
}

console.log('\nL\'annonce elle-même');
{
  ENVOIS = []; reglages({ dispoRoles: ['Responsable'] }); oublier();
  const r = await W.handleDispo(req('POST', '/api/dispo', 'jeton-resp', {}), ENV);
  const corps = await r.json();
  dit('un responsable coché passe', r.status === 200 && corps.ok === true, corps);
  dit('un seul message part', ENVOIS.length === 1, ENVOIS.length);

  const m = ENVOIS[0] || {};
  dit('le nom annoncé est celui de la SESSION', /Robert Morgan/.test(m.content || ''), m.content);
  dit('le rôle client est mentionné', (m.content || '').includes(`<@&${ROLE_CLIENT}>`), m.content);
  /* Sans cette liste, Discord accepte le message (200) et ne réveille
     personne. L'erreur ne se verrait qu'en salon. */
  dit('l\'autorisation de mention accompagne le rôle',
    m.allowed_mentions && Array.isArray(m.allowed_mentions.roles)
    && m.allowed_mentions.roles[0] === ROLE_CLIENT
    && Array.isArray(m.allowed_mentions.parse) && m.allowed_mentions.parse.length === 0,
    m.allowed_mentions);
  dit('la réponse confirme que la mention a bien été posée', corps.mention === true, corps);
  dit('le message parle de bouteilles et d\'avantages',
    /bouteilles/.test(m.content || '') && /avantages/.test(m.content || ''), m.content);
}

console.log('\nLe nom ne peut pas être soufflé par le navigateur');
{
  ENVOIS = []; reglages({ dispoRoles: ['Responsable'] }); oublier();
  await W.handleDispo(req('POST', '/api/dispo', 'jeton-resp',
    { nom: 'Le Patron', name: 'Le Patron', user: { name: 'Le Patron' } }), ENV);
  const m = ENVOIS[0] || {};
  dit('un nom envoyé dans le corps est ignoré',
    /Robert Morgan/.test(m.content || '') && !/Le Patron/.test(m.content || ''), m.content);
}

console.log('\nLe garde-fou anti-répétition');
{
  ENVOIS = []; reglages({ dispoRoles: ['Responsable'] }); oublier();
  await W.handleDispo(req('POST', '/api/dispo', 'jeton-resp', {}), ENV);
  const r2 = await W.handleDispo(req('POST', '/api/dispo', 'jeton-resp', {}), ENV);
  dit('la deuxième annonce est refusée', r2.status === 429, r2.status);
  dit('et Discord n\'a été appelé qu\'une fois', ENVOIS.length === 1, ENVOIS.length);
  const d = await r2.json();
  dit('le refus dit combien de temps attendre', /dizaine de minutes/.test(d.detail || ''), d);
}

console.log('\nQuand le rôle client n\'est pas déclaré');
{
  ENVOIS = []; reglages({ dispoRoles: ['Responsable'] }); oublier();
  const r = await W.handleDispo(req('POST', '/api/dispo', 'jeton-resp', {}),
    { ...ENV, DISCORD_DISPO_ROLE: '' });
  const corps = await r.json();
  dit('l\'annonce part quand même', r.status === 200 && ENVOIS.length === 1, r.status);
  dit('mais la réponse prévient qu\'elle n\'a réveillé personne', corps.mention === false, corps);
  dit('et aucune mention n\'est fabriquée',
    !/<@&/.test(ENVOIS[0].content) && ENVOIS[0].allowed_mentions.parse.length === 0, ENVOIS[0]);

  ENVOIS = []; oublier();
  await W.handleDispo(req('POST', '/api/dispo', 'jeton-resp', {}),
    { ...ENV, DISCORD_DISPO_ROLE: 'pas-un-identifiant' });
  dit('une valeur qui n\'est pas un identifiant est traitée comme absente',
    !/<@&/.test(ENVOIS[0].content), ENVOIS[0].content);
}

console.log('\nLe salon mal relié est nommé, pas confondu avec une panne');
{
  dit('webhook absent', W.webhookDuSalon({}).erreur.error === 'webhook_absent');
  dit('webhook mal collé',
    W.webhookDuSalon({ DISCORD_WEBHOOK: 'coucou' }).erreur.error === 'webhook_invalide');
  dit('webhook valable', W.webhookDuSalon({ DISCORD_WEBHOOK: WEBHOOK }).url === WEBHOOK);

  reglages({ dispoRoles: ['Responsable'] }); oublier();
  const r = await W.handleDispo(req('POST', '/api/dispo', 'jeton-resp', {}),
    { ...ENV, DISCORD_WEBHOOK: '' });
  dit('la route rend 503 et non une erreur de serveur', r.status === 503, r.status);
}

console.log('\nQuand Discord refuse');
{
  ENVOIS = []; WEBHOOK_REFUSE = true; reglages({ dispoRoles: ['Responsable'] }); oublier();
  const r = await W.handleDispo(req('POST', '/api/dispo', 'jeton-resp', {}), ENV);
  dit('le refus de Discord remonte tel quel', r.status === 502, r.status);
  WEBHOOK_REFUSE = false;
}

console.log('\nLes réglages ne se perdent plus en route');
{
  /* Le filtre de /api/settings est une liste blanche : ce qui n'y figure pas
     est jeté sans rien dire. « agendaVis » y manquait, et les listes de
     visibilité de l'agenda repartaient à zéro à chaque rechargement. */
  TABLE.set('sess:jeton-patron', JSON.stringify({ id: '700000000000000003', name: 'Thomas' }));
  const ENVP = { ...ENV, OWNER_IDS: '700000000000000003' };

  const envoi = {
    visibleRoles: ['Patron', 'Responsable'],
    permsRO: { comrunner: ['Saisonnier'] },
    agendaVis: { direction: ['Patron'], commercial: ['Responsable'] },
    dispoRoles: ['Responsable'],
    nimporteQuoi: { danger: true },
  };
  const r = await W.handleSettings(req('PUT', '/api/settings', 'jeton-patron', envoi), ENVP);
  const dedans = await r.json();
  dit('la liste des rôles visibles est gardée', dedans.visibleRoles.length === 2, dedans);
  dit('la lecture seule est gardée', !!dedans.permsRO.comrunner, dedans);
  dit('la visibilité de l\'agenda est gardée (elle était perdue avant)',
    dedans.agendaVis && dedans.agendaVis.direction[0] === 'Patron', dedans.agendaVis);
  dit('les rôles autorisés à annoncer sont gardés',
    Array.isArray(dedans.dispoRoles) && dedans.dispoRoles[0] === 'Responsable', dedans.dispoRoles);
  dit('une clé inconnue est toujours jetée', dedans.nimporteQuoi === undefined, dedans);

  const relu = JSON.parse(TABLE.get('settings'));
  dit('et c\'est bien ce qui est écrit en base',
    relu.dispoRoles[0] === 'Responsable' && relu.agendaVis.commercial[0] === 'Responsable', relu);

  const r2 = await W.handleSettings(req('PUT', '/api/settings', 'jeton-resp', envoi), ENV);
  dit('seul le patron peut enregistrer les réglages', r2.status === 403, r2.status);
}

unlinkSync(TMP);
console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
