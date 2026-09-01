/* Banc d'essai de la délégation des écrans d'Administration.
   ---------------------------------------------------------------------------
   Ces sept écrans étaient fermés en dur au patron. Les ouvrir à des rôles est
   la modification la plus risquée du panel : ce sont les clés, pas les portes.
   Ce fichier existe pour qu'on ne s'en aperçoive pas trop tard.

   Ce qui est vérifié, et pourquoi :

   · rien n'est ouvert par défaut. Une matrice vide ferme tout à tout le monde
     sauf au patron — s'ouvrir toute seule serait le mauvais côté sur lequel
     se tromper ;
   · chaque réglage est contrôlé SÉPARÉMENT. Les réglages du domaine vivent
     dans un seul objet : sans contrôle clé par clé, confier « Disponibilités »
     à quelqu'un lui donnerait aussi la matrice des accès. C'est la porte
     dérobée qu'il fallait fermer en même temps qu'on ouvrait la principale ;
   · enregistrer un réglage n'efface pas les autres. L'ancienne version
     réécrivait tout l'objet à partir du seul envoi reçu ; maintenant que
     chaque écran n'envoie que sa clé, remplacer viderait le reste ;
   · la lecture seule ferme vraiment l'écriture, elle ne fait pas que griser
     des boutons dans le navigateur ;
   · la matrice, les accès extérieurs, la vitrine et les règles du domaine
     exigent chacun leur propre case cochée.

   Lancement :  node test-admin.mjs
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const SRC = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const TMP = new URL('./.essai-admin.mjs', import.meta.url);
writeFileSync(TMP, SRC + '\nexport { handleSettings, handlePermissions, handleInvites, canWrite, COLLECTION_PAGES };\n');
const W = await import(TMP.href);

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};

/* ---------- les rôles ---------- */
const R_RESP = '444444444444444444';   // « Responsable »
const R_DRH  = '555555555555555555';   // « DRH »

globalThis.fetch = async (url) => {
  const u = String(url);
  const rep = (o, s = 200) => ({ ok: s < 300, status: s, json: async () => o });
  if (/\/guilds\/\d+\/roles$/.test(u)) return rep([
    { id: R_RESP, name: 'Responsable', position: 5, managed: false },
    { id: R_DRH,  name: 'DRH',         position: 4, managed: false },
  ]);
  const m = u.match(/\/guilds\/\d+\/members\/(\d+)$/);
  if (m) {
    const parId = {
      '700000000000000001': [R_RESP],
      '700000000000000002': [R_DRH],
      '700000000000000003': [],        // le patron, par OWNER_IDS
    };
    return rep({ roles: parId[m[1]] || [], nick: null });
  }
  throw new Error('appel non simulé : ' + u);
};

/* ---------- la fausse base ---------- */
const TABLE = new Map();
const DB = {
  prepare(sql) {
    return { bind(...a) { return {
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
    }; } };
  },
};

const ENV = {
  DB,
  DISCORD_GUILD_ID: '932301610128912414',
  DISCORD_BOT_TOKEN: 'faux',
  OWNER_IDS: '700000000000000003',
  PATRON_ROLES: 'Patron',
  SITE_URL: 'https://exemple.test',
};

TABLE.set('sess:resp',   JSON.stringify({ id: '700000000000000001', name: 'Robert Morgan' }));
TABLE.set('sess:drh',    JSON.stringify({ id: '700000000000000002', name: 'Nella Valmora' }));
TABLE.set('sess:patron', JSON.stringify({ id: '700000000000000003', name: 'Thomas' }));

const poser = (permissions, settings) => {
  TABLE.set('permissions', JSON.stringify(permissions || {}));
  TABLE.set('settings', JSON.stringify(settings || {}));
  TABLE.set('invites', JSON.stringify([]));
};

const req = (methode, chemin, jeton, corps) => new Request('https://api.test' + chemin, {
  method: methode,
  headers: Object.assign(jeton ? { Authorization: 'Bearer ' + jeton } : {},
    corps ? { 'Content-Type': 'application/json' } : {}),
  body: corps ? JSON.stringify(corps) : undefined,
});

const lus = () => JSON.parse(TABLE.get('settings'));

/* ====================================================================== */
console.log('\nRien n\'est ouvert par défaut');
{
  poser({}, {});
  const a = await W.handleSettings(req('PUT', '/api/settings', 'resp', { dispoRoles: ['Responsable'] }), ENV);
  dit('matrice vide : le responsable ne règle rien', a.status === 403, a.status);
  const b = await W.handlePermissions(req('PUT', '/api/permissions', 'resp', { comrunner: ['Responsable'] }), ENV);
  dit('matrice vide : il ne touche pas la matrice', b.status === 403, b.status);
  const c = await W.handleInvites(req('GET', '/api/invites', 'resp'), ENV);
  dit('matrice vide : pas d\'accès extérieurs', c.status === 403, c.status);

  const d = await W.handleSettings(req('PUT', '/api/settings', 'patron', { dispoRoles: ['Responsable'] }), ENV);
  dit('le patron, lui, passe toujours', d.status === 200, d.status);
}

console.log('\nChaque réglage est contrôlé séparément');
{
  /* Le responsable n'a QUE l'écran des disponibilités. */
  poser({ paramdispo: ['Responsable'] },
        { visibleRoles: ['Patron', 'DRH'], permsRO: { comrunner: ['DRH'] },
          agendaVis: { direction: ['Patron'] }, dispoRoles: [] });

  const a = await W.handleSettings(req('PUT', '/api/settings', 'resp', { dispoRoles: ['Responsable'] }), ENV);
  dit('il règle bien SA page', a.status === 200, a.status);
  dit('et le réglage est écrit', lus().dispoRoles[0] === 'Responsable', lus().dispoRoles);

  /* La porte dérobée : les réglages vivent dans un seul objet. Sans contrôle
     clé par clé, l'écran des disponibilités aurait donné la matrice. */
  const b = await W.handleSettings(req('PUT', '/api/settings', 'resp',
    { permsRO: { rhemployes: [] } }), ENV);
  dit('il ne peut pas toucher la lecture seule des autres pages', b.status === 403, b.status);
  const c = await W.handleSettings(req('PUT', '/api/settings', 'resp',
    { visibleRoles: ['Responsable'] }), ENV);
  dit('ni la liste des rôles retenus', c.status === 403, c.status);
  const d = await W.handleSettings(req('PUT', '/api/settings', 'resp',
    { agendaVis: { direction: ['Responsable'] } }), ENV);
  dit('ni la visibilité de l\'agenda', d.status === 403, d.status);

  const e = await W.handleSettings(req('PUT', '/api/settings', 'resp',
    { dispoRoles: ['Responsable'], permsRO: {} }), ENV);
  dit('un envoi qui mélange une clé permise et une interdite est refusé EN BLOC',
    e.status === 403, e.status);
  const detail = await e.json();
  dit('et le refus nomme le réglage en cause',
    Array.isArray(detail.reglages) && detail.reglages.includes('permsRO'), detail);
  dit('rien n\'a été écrit au passage',
    lus().permsRO && lus().permsRO.comrunner && lus().permsRO.comrunner[0] === 'DRH', lus().permsRO);
}

console.log('\nEnregistrer un réglage n\'efface pas les autres');
{
  poser({ paramdispo: ['Responsable'] },
        { visibleRoles: ['Patron', 'DRH'], permsRO: { comrunner: ['DRH'] },
          agendaVis: { direction: ['Patron'] }, dispoRoles: [] });
  await W.handleSettings(req('PUT', '/api/settings', 'resp', { dispoRoles: ['Responsable'] }), ENV);
  const apres = lus();
  dit('la liste des rôles retenus survit', (apres.visibleRoles || []).length === 2, apres.visibleRoles);
  dit('la lecture seule survit', !!(apres.permsRO || {}).comrunner, apres.permsRO);
  dit('la visibilité de l\'agenda survit', !!(apres.agendaVis || {}).direction, apres.agendaVis);
  dit('et la clé écrite est bien la nouvelle', apres.dispoRoles[0] === 'Responsable', apres.dispoRoles);
}

console.log('\nLa lecture seule ferme vraiment l\'écriture');
{
  poser({ paramdispo: ['Responsable'] },
        { permsRO: { paramdispo: ['Responsable'] }, dispoRoles: [] });
  const a = await W.handleSettings(req('PUT', '/api/settings', 'resp', { dispoRoles: ['Responsable'] }), ENV);
  dit('voir n\'est pas modifier', a.status === 403, a.status);
  dit('et le réglage n\'a pas bougé', (lus().dispoRoles || []).length === 0, lus().dispoRoles);
}

console.log('\nLa matrice ne s\'ouvre qu\'à qui a « Accès & rôles »');
{
  poser({ paramdispo: ['Responsable'], parametres: ['DRH'] }, {});
  const a = await W.handlePermissions(req('PUT', '/api/permissions', 'resp',
    { rhemployes: ['Responsable'] }), ENV);
  dit('le responsable ne se donne pas de droits', a.status === 403, a.status);
  const b = await W.handlePermissions(req('PUT', '/api/permissions', 'drh',
    { rhemployes: ['DRH'] }), ENV);
  dit('le DRH, coché sur « Accès & rôles », y écrit', b.status === 200, b.status);
  const c = JSON.parse(TABLE.get('permissions'));
  dit('et c\'est bien enregistré', c.rhemployes[0] === 'DRH', c);
}

console.log('\nLes accès extérieurs ont leur propre case');
{
  poser({ paraminvites: ['DRH'], paramdispo: ['Responsable'] }, {});
  const a = await W.handleInvites(req('GET', '/api/invites', 'resp'), ENV);
  dit('sans la case, refus', a.status === 403, a.status);
  const b = await W.handleInvites(req('GET', '/api/invites', 'drh'), ENV);
  dit('avec la case, accès', b.status === 200, b.status);
}

console.log('\nVitrine et règles du domaine : une page chacune');
{
  const perms = { paramvitrine: ['Responsable'], paramregles: ['DRH'] };
  const resp = { isPatron: false, roles: ['Responsable'] };
  const drh  = { isPatron: false, roles: ['DRH'] };
  dit('la vitrine suit « Vitrine publique »',
    W.canWrite(resp, 'vitrine', perms, {}) === true && W.canWrite(drh, 'vitrine', perms, {}) === false);
  dit('les règles suivent « Règles du domaine »',
    W.canWrite(drh, 'reglages', perms, {}) === true && W.canWrite(resp, 'reglages', perms, {}) === false);
  dit('sans matrice, ni l\'un ni l\'autre',
    W.canWrite(resp, 'vitrine', {}, {}) === false && W.canWrite(drh, 'reglages', {}, {}) === false);
  dit('les sept écrans sont bien déclarés côté serveur',
    ['parametres', 'paramagenda', 'paramdispo', 'paramvitrine', 'paramregles', 'paraminvites']
      .every(page => Object.values(W.COLLECTION_PAGES).some(l => l.includes(page))),
    W.COLLECTION_PAGES);
}

console.log('\nUn accès extérieur n\'entre jamais dans l\'Administration');
{
  /* Un code d'accès donné à un comptable ne doit pas pouvoir devenir, d'une
     case mal cochée, le droit de réécrire la matrice. Deux verrous : le
     filtre à l'enregistrement, et le refus à la lecture. */
  const invite = { isPatron: false, roles: [],
                   invite: { pages: ['parametres', 'paramvitrine', 'facturation'], ro: [] } };
  dit('même avec « Accès & rôles » dans sa liste, il ne l\'obtient pas',
    W.canWrite(invite, 'acces', {}, {}) === false);
  dit('ni la vitrine', W.canWrite(invite, 'vitrine', {}, {}) === false);
  dit('mais ses pages de travail marchent toujours',
    W.canWrite(invite, 'clients', {}, {}) === true);

  poser({ paraminvites: ['DRH'] }, {});
  const r = await W.handleInvites(req('POST', '/api/invites', 'drh', {
    action: 'creer', nom: 'Comptable', mdp: 'motdepasse1',
    pages: ['parametres', 'paramdonnees', 'facturation'], ro: [],
  }), ENV);
  dit('la création réussit', r.status === 200, r.status);
  const stocke = JSON.parse(TABLE.get('invites'))[0];
  dit('et les pages d\'Administration ne sont même pas enregistrées',
    stocke && stocke.pages.length === 1 && stocke.pages[0] === 'facturation', stocke && stocke.pages);
}

unlinkSync(TMP);
console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
