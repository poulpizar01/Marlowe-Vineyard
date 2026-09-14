/* Banc d'essai des garde-fous d'accès et de robustesse des routes.
   ---------------------------------------------------------------------------
   Ce fichier est né d'un audit : chaque vérification ci-dessous correspond à
   un défaut qui existait vraiment et qu'on ne veut pas voir revenir.

   Ce qui est vérifié, et pourquoi chaque point est là :

   · UN ACCÈS EXTÉRIEUR NE REÇOIT PAS L'IDENTITÉ DES GENS. /api/data rendait le
     document ENTIER à toute session valable. Un comptable à qui on n'avait
     coché que « Facturation » recevait aussi le registre RH complet — numéros
     civils, téléphones, RIB, identifiants Discord. Le navigateur n'en
     affichait rien, mais la réponse du serveur les contenait, lisibles dans
     l'onglet Réseau. Un membre du Discord, lui, garde tout : c'est un outil
     d'équipe, et c'est la règle métier ;

   · LE KIT D'ENTRETIEN S'ENREGISTRE. La collection « entretien » manquait à
     COLLECTION_PAGES, et canWrite refuse tout ce qu'elle ne connaît pas : un
     RH à qui la page était pourtant cochée recevait 403 en enregistrant, sans
     que rien n'explique pourquoi. Seul le patron y arrivait ;

   · UN CORPS « NULL » NE FAIT PAS TOMBER LE SERVEUR. « null » est du JSON
     parfaitement valable : les routes qui lisaient une propriété dessus
     répondaient 500 en recopiant un message d'erreur interne à l'appelant ;

   · UNE ROUTE DE LECTURE REFUSE D'ÊTRE ÉCRITE. /api/me répondait 200 à un
     DELETE, ce qui laisse croire qu'on vient de supprimer quelque chose ;

   · LA MATRICE DES ACCÈS N'EST PAS PUBLIQUE. GET /api/permissions et
     GET /api/settings répondaient sans demander de compte : la carte des
     portes du panel était lisible depuis la voie publique.

   Lancement :  node test-acces.mjs
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const SRC = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const TMP = new URL('./.essai-acces.mjs', import.meta.url);
writeFileSync(TMP, SRC
  + '\nexport { handleData, handleMe, handlePermissions, handleSettings, handleInvites,'
  + ' canWrite, collectionsLisibles, COLLECTION_PAGES, COLLECTIONS_PERSONNELLES };\n');
const W = await import(TMP.href);

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};

/* ---------- Discord simulé ---------- */
const R_RH = '555555555555555555';
globalThis.fetch = async (url) => {
  const u = String(url);
  const rep = (o, s = 200) => ({ ok: s < 300, status: s, json: async () => o });
  if (/\/guilds\/\d+\/roles$/.test(u)) {
    return rep([{ id: R_RH, name: 'RH', position: 4, managed: false }]);
  }
  const m = u.match(/\/guilds\/\d+\/members\/(\d+)$/);
  if (m) {
    const parId = { '800000000000000001': [R_RH], '800000000000000002': [] };
    return parId[m[1]] ? rep({ roles: parId[m[1]], nick: null }) : rep({ message: 'Unknown Member' }, 404);
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
        if (/^DELETE FROM kv WHERE cle =/.test(sql)) TABLE.delete(a[0]);
        return {};
      },
      async all() { return { results: [] }; },
    }; } };
  },
  async batch() { return []; },
};

const env = {
  DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'y', DISCORD_BOT_TOKEN: 'z',
  DISCORD_GUILD_ID: '999', SITE_URL: 'https://exemple.test',
  PATRON_ROLES: 'Patron,Co-Patron', OWNER_IDS: '', DB,
};

const RH_ID = '800000000000000001';
const SIMPLE_ID = '800000000000000002';

function poserSession(sid, contenu) {
  TABLE.set('sess:' + sid, JSON.stringify(contenu));
}
const requete = (chemin, opts = {}) =>
  new Request('https://exemple.test' + chemin, opts);
const avec = (sid, opts = {}) => Object.assign({}, opts, {
  headers: Object.assign({ Authorization: 'Bearer ' + sid, 'Content-Type': 'application/json' },
                         opts.headers || {}),
});

/* Le registre, avec ce qu'il ne faut pas laisser sortir. */
const RIB_TEMOIN = 'FR76-TEMOIN-DE-FUITE';
function poserDonnees() {
  TABLE.set('data', JSON.stringify({
    rhRoster: [{ id: 'C1', name: 'Rémi Castel', tel: '555-0100', rib: RIB_TEMOIN, discord: '300' }],
    rhAbsences: [{ name: 'Rémi Castel', motif: 'raison privée' }],
    historique: [{ n: 'F-001', total: 1000 }],
    clients: [{ id: 'K1', nom: 'Bar du Coin' }],
    entretien: [{ t: 'Produit A' }],
  }));
}

console.log("\n— Un accès extérieur et l'identité des gens —");
{
  poserDonnees();
  TABLE.set('invites', JSON.stringify([{
    code: 'MV-COMPTA', nom: 'Comptable', sel: 's', hash: 'h',
    pages: ['facturation'], ro: [], actif: true,
  }]));
  poserSession('S-INV', { invite: true, code: 'MV-COMPTA', id: 'inv:MV-COMPTA', name: 'Comptable' });

  const r = await W.handleData(requete('/api/data', avec('S-INV')), env);
  const d = await r.json();
  const texte = JSON.stringify(d);

  dit("le registre RH ne part pas chez un accès « Facturation »", !('rhRoster' in d), Object.keys(d));
  dit("… ni les RIB qu'il contient", !texte.includes(RIB_TEMOIN));
  dit("… ni les motifs d'absence", !('rhAbsences' in d));
  dit("mais sa page de travail lui parvient bien", Array.isArray(d.historique) && d.historique.length === 1);
  dit("… et les collections sans données personnelles aussi",
      Array.isArray(d.clients) && Array.isArray(d.entretien));
  dit("la révision accompagne toujours la réponse", !!d._meta);
}

console.log("\n— Un accès extérieur À QUI la page RH est cochée —");
{
  poserDonnees();
  TABLE.set('invites', JSON.stringify([{
    code: 'MV-RH', nom: 'RH externe', sel: 's', hash: 'h',
    pages: ['rhemployes'], ro: [], actif: true,
  }]));
  poserSession('S-INV2', { invite: true, code: 'MV-RH', id: 'inv:MV-RH', name: 'RH externe' });

  const d = await (await W.handleData(requete('/api/data', avec('S-INV2')), env)).json();
  dit("le registre lui parvient, puisque c'est sa page", Array.isArray(d.rhRoster));
}

console.log('\n— Un membre du Discord garde tout (règle métier inchangée) —');
{
  poserDonnees();
  poserSession('S-RH', { id: RH_ID, name: 'Rachel', avatar: null });
  const d = await (await W.handleData(requete('/api/data', avec('S-RH')), env)).json();
  dit('un membre connecté reçoit bien le registre complet',
      Array.isArray(d.rhRoster) && JSON.stringify(d).includes(RIB_TEMOIN));
}

console.log("\n— Le kit d'entretien s'enregistre sans être patron —");
{
  poserDonnees();
  TABLE.set('permissions', JSON.stringify({ entretien: ['RH'] }));
  poserSession('S-RH', { id: RH_ID, name: 'Rachel', avatar: null });

  const r = await W.handleData(requete('/api/data', avec('S-RH', {
    method: 'PUT', body: JSON.stringify({ entretien: [{ t: 'Produit B' }] }),
  })), env);
  dit("un RH dont la page « Kit d'entretien » est cochée peut enregistrer", r.status === 200,
      { statut: r.status, corps: await r.clone().json() });
  dit('« entretien » est bien déclaré côté serveur',
      Array.isArray(W.COLLECTION_PAGES.entretien));
  dit("la page « Documents » ne donne PAS le droit d'écrire le kit",
      !(W.COLLECTION_PAGES.entretien || []).includes('documents'));
}

console.log('\n— Sans la case cochée, toujours refusé —');
{
  poserDonnees();
  TABLE.set('permissions', JSON.stringify({}));
  poserSession('S-SIMPLE', { id: SIMPLE_ID, name: 'Simon', avatar: null });
  const r = await W.handleData(requete('/api/data', avec('S-SIMPLE', {
    method: 'PUT', body: JSON.stringify({ entretien: [{ t: 'X' }] }),
  })), env);
  dit('un membre sans droit reçoit 403', r.status === 403, { statut: r.status });
  const r2 = await W.handleData(requete('/api/data', avec('S-SIMPLE', {
    method: 'PUT', body: JSON.stringify({ collectionInventee: [1] }),
  })), env);
  dit('une collection inconnue est refusée', r2.status === 403, { statut: r2.status });
}

console.log('\n— Un corps « null » ne fait pas tomber le serveur —');
{
  poserSession('S-RH', { id: RH_ID, name: 'Rachel', avatar: null });
  const cas = [
    ['/api/invites', W.handleInvites],
    ['/api/settings', W.handleSettings],
  ];
  for (const [chemin, fonction] of cas) {
    const r = await fonction(requete(chemin, avec('S-RH', { method: 'PUT', body: 'null' })), env);
    dit(`${chemin} répond ${r.status} et non 500`, r.status !== 500, { statut: r.status });
  }
  const r3 = await W.handleData(requete('/api/data', avec('S-RH', { method: 'PUT', body: '[]' })), env);
  dit('/api/data refuse un tableau', r3.status === 400, { statut: r3.status });
}

console.log("\n— Une route de lecture n'accepte pas d'être écrite —");
{
  poserSession('S-RH', { id: RH_ID, name: 'Rachel', avatar: null });
  const r = await W.handleMe(requete('/api/me', avec('S-RH', { method: 'DELETE' })), env);
  dit('DELETE /api/me répond 405', r.status === 405, { statut: r.status });
  const r2 = await W.handleMe(requete('/api/me', avec('S-RH')), env);
  dit('… et un GET marche toujours', r2.status === 200, { statut: r2.status });
}

/* Le trousseau du développeur (OWNER_IDS) vivait en DOUBLE : dans le .env du
   serveur ET écrit en dur dans marlowe-auth.js, un fichier que le site sert
   à tout visiteur. Deux ennuis : les identifiants s'affichaient en clair, et
   changer le réglage d'un côté seulement faisait diverger l'écran des routes.
   Le serveur publie maintenant sa CONCLUSION (isOwner/isPatron) au lieu de la
   liste, et le panel n'a plus de copie. Les trois vérifications ci-dessous
   tiennent cette promesse par les deux bouts. */
console.log('\n— Le trousseau reste dans le .env, jamais dans le navigateur —');
{
  const lire = async r => JSON.parse(await r.text());

  poserSession('S-SIMPLE', { id: SIMPLE_ID, name: 'Simple', avatar: null });
  const banal = await lire(await W.handleMe(requete('/api/me', avec('S-SIMPLE')), env));
  dit('/api/me annonce isOwner et isPatron', 'isOwner' in banal && 'isPatron' in banal, banal);
  dit('… à faux pour un compte ordinaire',
      banal.isOwner === false && banal.isPatron === false, banal);

  /* Le MÊME compte, cette fois inscrit au trousseau : seul le .env change. */
  const envTrousseau = { ...env, OWNER_IDS: SIMPLE_ID };
  const porteur = await lire(await W.handleMe(requete('/api/me', avec('S-SIMPLE')), envTrousseau));
  dit('un compte du trousseau est reconnu isOwner', porteur.isOwner === true, porteur);
  dit('… et reçoit isPatron avec, sans aucun rôle Discord',
      porteur.isPatron === true && porteur.roles.length === 0, porteur);

  /* Patron par le RÔLE, hors trousseau : les deux chemins restent distincts. */
  poserSession('S-RH', { id: RH_ID, name: 'Rachel', avatar: null });
  const parRole = await lire(await W.handleMe(requete('/api/me', avec('S-RH')),
                                              { ...env, PATRON_ROLES: 'RH' }));
  dit('patron par le rôle : isPatron sans isOwner',
      parRole.isPatron === true && parRole.isOwner === false, parRole);

  /* La réponse répond sur la personne connectée, elle ne livre pas la liste :
     l'identifiant de l'autre porteur du trousseau ne doit apparaître nulle
     part, sous aucune clé. */
  const AUTRE_PORTEUR = '800000000000000009';
  const r = await W.handleMe(requete('/api/me', avec('S-SIMPLE')),
                             { ...env, OWNER_IDS: SIMPLE_ID + ',' + AUTRE_PORTEUR });
  const brut = await r.text();
  dit("… sans jamais recopier la liste des autres porteurs",
      !brut.includes(AUTRE_PORTEUR), brut.slice(0, 200));
}

console.log('\n— Le panel ne garde aucune copie du trousseau —');
{
  const PANEL = readFileSync(new URL('../marlowe-auth.js', import.meta.url), 'utf8');

  /* Une suite de 17 à 20 chiffres dans un fichier servi au navigateur, c'est
     un identifiant Discord en clair. On les cherche tous : la règle ne vaut
     rien si elle ne surveille que les deux identifiants d'aujourd'hui. */
  const enDur = (PANEL.match(/\b\d{17,20}\b/g) || []);
  dit("aucun identifiant Discord n'est écrit en dur dans marlowe-auth.js",
      enDur.length === 0, enDur);

  /* Et la clé elle-même ne doit pas réapparaître : un `OWNER_IDS: []` vide
     rouvrirait la porte à ce qu'on y remette des valeurs « juste une fois ». */
  dit('… et CONFIG ne redéclare pas OWNER_IDS',
      !/OWNER_IDS\s*:/.test(PANEL));

  /* Le panel doit CROIRE le serveur, pas refaire le calcul : s'il rappelait
     CONFIG.OWNER_IDS, la divergence reviendrait sans que rien ne le signale. */
  dit('… ni ne consulte CONFIG.OWNER_IDS', !/CONFIG\.OWNER_IDS/.test(PANEL));
}

console.log("\n— La carte des accès n'est pas publique —");
{
  TABLE.set('permissions', JSON.stringify({ rhemployes: ['DRH'] }));
  TABLE.set('settings', JSON.stringify({ dispoRoles: ['Responsable'] }));

  const sansCompte = new Request('https://exemple.test/api/permissions');
  const p = await W.handlePermissions(sansCompte, env);
  dit('GET /api/permissions sans compte → 401', p.status === 401, { statut: p.status });

  const s = await W.handleSettings(new Request('https://exemple.test/api/settings'), env);
  dit('GET /api/settings sans compte → 401', s.status === 401, { statut: s.status });

  poserSession('S-RH', { id: RH_ID, name: 'Rachel', avatar: null });
  const p2 = await W.handlePermissions(requete('/api/permissions', avec('S-RH')), env);
  dit('… mais le panel connecté la lit toujours', p2.status === 200, { statut: p2.status });
  const s2 = await W.handleSettings(requete('/api/settings', avec('S-RH')), env);
  dit('… et les réglages aussi', s2.status === 200, { statut: s2.status });
}

console.log('\n— La liste des collections personnelles est bien celle attendue —');
{
  for (const c of ['rhRoster', 'rhAbsences', 'rhDeparts', 'rhRecruiters', 'avertissements', 'blacklist']) {
    dit(`« ${c} » est traitée comme personnelle`, W.COLLECTIONS_PERSONNELLES.has(c));
  }
}

unlinkSync(TMP);
console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.`);
process.exit(ko ? 1 : 0);
