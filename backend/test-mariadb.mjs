/* Banc d'essai contre une VRAIE base MariaDB/MySQL.
   ---------------------------------------------------------------------------
   Tous les autres bancs d'essai de ce dossier remplacent la base par une
   fausse, écrite en JavaScript. C'est rapide, ça ne demande rien à installer,
   et ça a permis de vérifier toute la logique métier. Mais une fausse base ne
   se comporte pas comme MariaDB, et c'est précisément là que la migration
   depuis Cloudflare D1 (SQLite) a laissé des pièges :

   · ESCAPE '\' est du SQLite. En MariaDB, le backslash échappe le caractère
     suivant dans une chaîne : « '\' » se lit « une apostrophe échappée », la
     chaîne ne se referme jamais, et le serveur répond « You have an error in
     your SQL syntax ». La requête de listing échouait donc À TOUS LES COUPS,
     et /api/presence renvoyait 500 à chaque changement de page ;

   · SUM() rend un DECIMAL, que le pilote mysql2 livre en TEXTE pour ne pas
     perdre de précision. D1 rendait un nombre. Le panel additionnait ces
     valeurs, et « 0 + "100" + "10" » donne la chaîne « 0100010 » : la page
     Quota affichait des totaux absurdes, sans la moindre erreur ;

   · deux enregistrements simultanés relisaient la même version du document et
     l'un écrasait l'autre, en annonçant « Enregistré ✓ » aux deux personnes ;

   · et, depuis la 1.48.0, la même chose entre DEUX INSTANCES du backend :
     la file d'attente en mémoire ne vaut que pour un processus, et c'est un
     verrou GET_LOCK tenu par MariaDB qui arbitre entre plusieurs. Une
     fausse base n'a pas de GET_LOCK.

   Aucune fausse base ne pouvait montrer ça. Celui-ci le peut.

   ---------------------------------------------------------------------------
   Lancement — il faut une base de test, JAMAIS celle de production :

       DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=marlowe \
       DB_PASSWORD=... DB_NAME=marlowe_test node test-mariadb.mjs

   Sans ces variables, le fichier se contente de le dire et sort sans échouer :
   il ne doit pas faire échouer une série de tests là où il n'y a pas de base.

   ⚠️ Ce banc d'essai EFFACE les tables de la base qu'on lui donne. Vérifiez
      deux fois DB_NAME avant de le lancer.
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const CFG = {
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
};

if (!CFG.host || !CFG.user || !CFG.database) {
  console.log('\nAucune base de test indiquée — ce banc d\'essai est ignoré.');
  console.log('Pour le lancer :');
  console.log('  DB_HOST=127.0.0.1 DB_USER=marlowe DB_PASSWORD=... DB_NAME=marlowe_test \\');
  console.log('    node test-mariadb.mjs');
  console.log('\n(Les autres bancs d\'essai, eux, n\'ont besoin d\'aucune base.)\n');
  process.exit(0);
}

if (/prod/i.test(CFG.database)) {
  console.error(`\nRefus : « ${CFG.database} » ressemble à une base de production, et ce banc`);
  console.error("d'essai efface les tables. Donnez-lui une base de test dédiée.\n");
  process.exit(1);
}

const { creerBase } = await import('./src/db.js');

const SRC = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const TMP = new URL('./.essai-mariadb.mjs', import.meta.url);
writeFileSync(TMP, SRC + '\nexport { base };\n');
const MOD = await import(TMP.href);
const W = MOD.default;

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};

const { pool, binding: DB } = await creerBase(CFG);
await DB.prepare('DELETE FROM kv').bind().run();
await DB.prepare('DELETE FROM ventes').bind().run();

/* ---------- Discord simulé ---------- */
const R_PATRON = '111111111111111111';
const R_RH     = '222222222222222222';
const STORAGE_TOKEN_ESSAI = 'FAUX-TOKEN-STORAGE';
let ANNONCES = 0;   /* messages postés dans le salon d'agenda simulé */
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const J = (o, s = 200) => new Response(JSON.stringify(o),
    { status: s, headers: { 'Content-Type': 'application/json' } });
  if (/\/channels\/\d+\/messages$/.test(u) && (opts.method || '').toUpperCase() === 'POST') {
    ANNONCES++;
    return J({ id: String(ANNONCES) });
  }
  if (/\/guilds\/\d+\/roles$/.test(u)) return J([
    { id: R_PATRON, name: 'Patron', position: 10, managed: false },
    { id: R_RH,     name: 'RH',     position: 5,  managed: false },
  ]);
  const m = u.match(/\/guilds\/\d+\/members\/(\d+)$/);
  if (m) {
    const parId = { '900000000000000001': [R_PATRON], '900000000000000002': [R_RH] };
    return parId[m[1]] ? J({ roles: parId[m[1]], nick: null }) : J({ message: 'Unknown Member' }, 404);
  }
  /* Service de stockage simulé (voir STORAGE_BASE dans env, plus bas) :
     seule route utilisée par handleUpload, PUT /api/object/{clé}. */
  const s = u.match(/^https:\/\/storage\.test\/api\/object\/(.+)$/);
  if (s && (opts.method || '').toUpperCase() === 'PUT') {
    if ((opts.headers || {}).Authorization !== 'Bearer ' + STORAGE_TOKEN_ESSAI) return J({ error: 'unauthorized' }, 401);
    const id = 'obj_' + s[1].replace(/[^a-z0-9]/gi, '').slice(0, 16);
    return J({ id, url: 'https://storage.test/view/' + id,
      size: (opts.body && opts.body.byteLength) || 0, mimeType: (opts.headers || {})['Content-Type'] });
  }
  return J({ message: 'non simulé' }, 404);
};

const env = {
  DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'y', DISCORD_BOT_TOKEN: 'z',
  DISCORD_GUILD_ID: '999', SITE_URL: 'https://exemple.test',
  PATRON_ROLES: 'Patron,Co-Patron', OWNER_IDS: '',
  STORAGE_BASE: 'https://storage.test', STORAGE_TOKEN: STORAGE_TOKEN_ESSAI,
  DB,
};
const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); } };

async function poserSession(sid, id, nom) {
  await DB.prepare(
    'INSERT INTO kv (cle, val, exp) VALUES (?, ?, ?) '
    + 'ON DUPLICATE KEY UPDATE val = VALUES(val), exp = VALUES(exp)'
  ).bind('sess:' + sid, JSON.stringify({ id, name: nom, avatar: null }), Date.now() + 3600e3).run();
}
const appel = (chemin, opts = {}) =>
  W.fetch(new Request('https://exemple.test' + chemin, opts), env, ctx);
const avec = (sid, opts = {}) => Object.assign({}, opts, {
  headers: Object.assign({ Authorization: 'Bearer ' + sid, 'Content-Type': 'application/json' },
                         opts.headers || {}),
});
const lireData = async () => JSON.parse(
  (await DB.prepare('SELECT val FROM kv WHERE cle = ?').bind('data').first()).val);

await poserSession('S-PATRON', '900000000000000001', 'Le Patron');
await poserSession('S-RH', '900000000000000002', 'Rachel RH');

/* ======================================================================== */
console.log('\n— Le listing par préfixe (ESCAPE) —');
{
  /* C'est la requête qui échouait : une syntaxe SQLite envoyée à MariaDB. */
  const r = await appel('/api/presence', avec('S-PATRON', {
    method: 'POST', body: JSON.stringify({ page: 'rhemployes' }),
  }));
  const d = await r.json().catch(() => null);
  dit('POST /api/presence répond 200 et non 500', r.status === 200, { statut: r.status, corps: d });
  dit('… et rend la liste des personnes présentes', !!d && Array.isArray(d.membres), d);

  /* L'échappement doit continuer de faire son travail : un préfixe qui
     contient « _ » ne doit pas se comporter comme un joker SQL. */
  const put = (cle) => DB.prepare(
    'INSERT INTO kv (cle, val, exp) VALUES (?, ?, NULL) ON DUPLICATE KEY UPDATE val = VALUES(val)'
  ).bind(cle, '{}').run();
  await put('a_b:1');
  await put('axb:1');
  const listeSql = await DB.prepare(
    "SELECT cle FROM kv WHERE cle LIKE ? ESCAPE '\\\\' ORDER BY cle"
  ).bind('a\\_b%').all();
  dit('« _ » est bien échappé et ne joue pas le joker',
      listeSql.results.length === 1 && listeSql.results[0].cle === 'a_b:1',
      listeSql.results);
}

/* ======================================================================== */
console.log('\n— Le calcul de quota (SUM rendu en texte par mysql2) —');
{
  const t = Date.now();
  const req = DB.prepare(
    'INSERT IGNORE INTO ventes (msg, ts, nom, cle, qte, brut, part, item, job) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  await DB.batch([
    req.bind('t1', t - 5000, 'Rémi Castel', 'remi castel', 54, 540, 270, 'wine', 'Vigneron'),
    req.bind('t2', t - 4000, 'Rémi Castel', 'remi castel', 46, 460, 230, 'wine', 'Vigneron'),
    req.bind('t3', t - 3000, 'Krimo G',     'krimo g',     10, 100,  50, 'wine', 'Vigneron'),
  ]);
  await DB.prepare(
    'INSERT INTO kv (cle, val, exp) VALUES (?, ?, NULL) ON DUPLICATE KEY UPDATE val = VALUES(val)'
  ).bind('data', JSON.stringify({
    rhRoster: [{ id: 'C1', name: 'Rémi Castel', poste: 'Vendeur' }],
  })).run();

  const q = await (await appel('/api/quota?du=0&au=' + (t + 10000), avec('S-PATRON'))).json();
  const R = q.rattachees[0], O = q.orphelines[0];

  dit('les vins d\'une ligne rattachée sont un NOMBRE', typeof R.vins === 'number', { recu: typeof R.vins, valeur: R.vins });
  dit('la part de la société est un NOMBRE', typeof R.part === 'number', { recu: typeof R.part });
  dit('le brut est un NOMBRE', typeof R.brut === 'number', { recu: typeof R.brut });
  dit('le nombre de ventes est un NOMBRE', typeof R.ventes === 'number', { recu: typeof R.ventes });
  dit('une ligne orpheline aussi', typeof O.vins === 'number', { recu: typeof O.vins });
  dit('les valeurs elles-mêmes sont justes', R.vins === 100 && R.part === 500 && O.vins === 10,
      { vins: R.vins, part: R.part, orpheline: O.vins });

  /* Le calcul que le panel fait vraiment (marlowe-actions.js, qdDessiner). */
  const totalPanel = q.rattachees.reduce((s, x) => s + x.vins, 0)
                   + q.orphelines.reduce((s, x) => s + x.vins, 0);
  dit('le total qu\'affichera le panel vaut 110, et non « 0100010 »',
      totalPanel === 110, { affiche: totalPanel });

  /* L'idempotence : relire le même message ne compte pas deux fois. */
  await DB.batch([req.bind('t1', t, 'Rémi Castel', 'remi castel', 999, 1, 1, 'wine', 'Vigneron')]);
  const q2 = await (await appel('/api/quota?du=0&au=' + (t + 10000), avec('S-PATRON'))).json();
  dit('un message relu ne compte pas deux fois', q2.rattachees[0].vins === 100,
      { vins: q2.rattachees[0].vins });
}

/* ======================================================================== */
console.log('\n— Deux enregistrements en même temps —');
{
  await DB.prepare('UPDATE kv SET val = ? WHERE cle = ?')
    .bind(JSON.stringify({ rhRoster: [], clients: [] }), 'data').run();
  await DB.prepare(
    'INSERT INTO kv (cle, val, exp) VALUES (?, ?, NULL) ON DUPLICATE KEY UPDATE val = VALUES(val)'
  ).bind('permissions', JSON.stringify({ rhemployes: ['RH'], facturation: ['RH'] })).run();
  await DB.prepare('DELETE FROM kv WHERE cle = ?').bind('datameta').run();

  const put = (sid, corps) => appel('/api/data', avec(sid, {
    method: 'PUT', body: JSON.stringify(corps),
  }));

  /* Deux personnes, deux pages différentes, au même instant. Le code promet
     qu'elles ne s'écrasent pas — c'est ici qu'on le vérifie. */
  await Promise.all([
    put('S-PATRON', { rhRoster: [{ id: 'A', name: 'Alice' }] }),
    put('S-RH',     { clients:  [{ id: 'B', nom: 'Bob' }] }),
  ]);

  const apres = await lireData();
  dit("l'enregistrement du registre a survécu",
      Array.isArray(apres.rhRoster) && apres.rhRoster.length === 1, { rhRoster: apres.rhRoster });
  dit("l'enregistrement des clients a survécu",
      Array.isArray(apres.clients) && apres.clients.length === 1, { clients: apres.clients });

  const meta = JSON.parse((await DB.prepare('SELECT val FROM kv WHERE cle = ?')
    .bind('datameta').first()).val);
  dit('la révision a monté de deux crans, pas d\'un seul', meta.rev === 2, { rev: meta.rev });
}

/* ======================================================================== */
console.log('\n— Un double-clic sur la déclaration de récolte —');
{
  await DB.prepare('UPDATE kv SET val = ? WHERE cle = ?')
    .bind(JSON.stringify({ linterna: [] }), 'data').run();
  await DB.prepare('DELETE FROM kv WHERE cle LIKE ?').bind('journal').run();

  const declarer = () => appel('/api/linterna', avec('S-RH', {
    method: 'POST', body: JSON.stringify({ raisins: 50, mode: 'ajout' }),
  }));
  await Promise.all([declarer(), declarer()]);

  const d = await lireData();
  const total = (d.linterna[0] || {}).raisins;
  /* Les deux ajouts partent, donc les deux comptent : 100. Avant la file
     d'attente, les deux lisaient le même total d'avant et l'un des deux se
     perdait — le compte tombait à 50 en annonçant « ok » deux fois. */
  dit('les deux ajouts sont comptés, aucun ne se perd', total === 100, { total });
  dit("une seule ligne au nom de la personne", d.linterna.length === 1, d.linterna);
}

/* ======================================================================== */
console.log('\n— Le document de travail supporte sa taille réelle —');
{
  /* LONGTEXT, et non TEXT : un registre RH dépasse vite 64 Ko. */
  const gros = JSON.stringify({ bloc: 'a'.repeat(300 * 1024) });
  await DB.prepare(
    'INSERT INTO kv (cle, val, exp) VALUES (?, ?, NULL) ON DUPLICATE KEY UPDATE val = VALUES(val)'
  ).bind('essai:gros', gros).run();
  const relu = (await DB.prepare('SELECT val FROM kv WHERE cle = ?').bind('essai:gros').first()).val;
  dit('un document de 300 Ko revient intact', relu.length === gros.length,
      { ecrit: gros.length, relu: relu.length });

  /* utf8mb4 : les accents et les emoji des noms de rôles. */
  await DB.prepare(
    'INSERT INTO kv (cle, val, exp) VALUES (?, ?, NULL) ON DUPLICATE KEY UPDATE val = VALUES(val)'
  ).bind('essai:emoji', '👑 · Patron — Rémi Castel').run();
  const em = (await DB.prepare('SELECT val FROM kv WHERE cle = ?').bind('essai:emoji').first()).val;
  dit('les accents et les emoji traversent la base intacts',
      em === '👑 · Patron — Rémi Castel', { relu: em });
}

/* ======================================================================== */
console.log('\n— Le dépôt de fichiers (service de stockage externe) —');
{
  const contenu = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

  const depot = await appel('/api/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer S-PATRON', 'Content-Type': 'image/png' },
    body: contenu,
  });
  const d = await depot.json().catch(() => null);
  dit('le patron peut déposer un visuel', depot.status === 200, { statut: depot.status, corps: d });
  dit('la réponse porte l\'adresse publique renvoyée par le service de stockage',
      !!d && typeof d.url === 'string' && d.url.startsWith('https://storage.test/view/'), d);

  const sansSession = await appel('/api/upload', {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: contenu,
  });
  dit('sans session, le dépôt est refusé (401)', sansSession.status === 401, { statut: sansSession.status });

  const mauvaisType = await appel('/api/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer S-PATRON', 'Content-Type': 'text/plain' },
    body: contenu,
  });
  dit('un type non prévu est refusé (415)', mauvaisType.status === 415, { statut: mauvaisType.status });
}

console.log('\n— Le contenu du fichier doit être ce qu\'il prétend —');
{
  /* Un « PNG » qui commence par les octets d'un JPEG, et un « PDF » qui
     n'est pas un PDF : le type annoncé est celui de l'appelant, seul le
     contenu fait foi (typeReel dans src/index.js). */
  const fauxPng = await appel('/api/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer S-PATRON', 'Content-Type': 'image/png' },
    body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
  });
  const d1 = await fauxPng.json().catch(() => null);
  dit('un JPEG annoncé comme PNG est refusé (415)', fauxPng.status === 415 && d1 && d1.error === 'bad_content', { statut: fauxPng.status, corps: d1 });
  const fauxPdf = await appel('/api/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer S-PATRON', 'Content-Type': 'application/pdf' },
    body: Buffer.from('bonjour, je ne suis pas un PDF'),
  });
  dit('un texte annoncé comme PDF est refusé (415)', fauxPdf.status === 415, { statut: fauxPdf.status });
  const vraiPdf = await appel('/api/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer S-PATRON', 'Content-Type': 'application/pdf' },
    body: Buffer.from('%PDF-1.4\n%fin'),
  });
  dit('un vrai PDF passe', vraiPdf.status === 200, { statut: vraiPdf.status });
}

console.log('\n— Les migrations sont tracées —');
{
  const t = await DB.prepare("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'migrations'").bind().first();
  dit('la table migrations existe', Number(t && t.n) === 1, t);
  const { readdirSync } = await import('node:fs');
  const fichiers = readdirSync(new URL('./migrations/', import.meta.url)).filter(f => /^\d{4}_.+\.sql$/.test(f));
  const faites = await DB.prepare('SELECT COUNT(*) AS n FROM migrations').bind().first();
  dit('chaque fichier de migration est inscrit comme appliqué', Number(faites && faites.n) === fichiers.length,
      { fichiers: fichiers.length, inscrites: Number(faites && faites.n) });
}

console.log("\n— L'échange atomique du contrôle de version —");
{
  /* casValeur() est ce qui arbitre deux enregistrements simultanés de la
     matrice des accès, y compris entre PLUSIEURS instances du backend — là où
     verrou(), simple Map JavaScript, ne vaut que pour un processus. Tout
     repose sur `affectedRows` : c'est une valeur rendue par le PILOTE, qu'une
     fausse base ne peut qu'imiter. D'où cette vérification contre le vrai
     moteur — c'était le dernier point du deuxième audit qui n'avait été
     éprouvé que sur une imitation. */
  const b = MOD.base(env);
  await DB.prepare('DELETE FROM kv WHERE cle = ?').bind('essai:cas').run();

  dit('créer une clé encore absente réussit',
      (await b.casValeur('essai:cas', null, 'A')) === true);
  dit('… et une seconde création est refusée',
      (await b.casValeur('essai:cas', null, 'B')) === false);
  dit("… c'est la valeur du premier qui tient", (await b.get('essai:cas')) === 'A');

  dit('échanger depuis la valeur courante réussit',
      (await b.casValeur('essai:cas', 'A', 'B')) === true);
  dit('échanger depuis une valeur PÉRIMÉE échoue',
      (await b.casValeur('essai:cas', 'A', 'C')) === false);
  dit("… et la valeur n'a pas bougé", (await b.get('essai:cas')) === 'B');

  /* Piège de moteur, relevé et non supposé : réécrire une valeur IDENTIQUE
     laisse `changedRows` à 0 alors que `affectedRows` vaut 1. casValeur()
     s'appuie sur affectedRows — le bon des deux : ce qui compte est que la
     ligne ait été TROUVÉE dans l'état attendu, pas qu'elle ait changé.
     Avec changedRows, un échange légitime aurait été rendu comme perdu. */
  dit('réécrire une valeur identique compte comme un échange réussi',
      (await b.casValeur('essai:cas', 'B', 'B')) === true);

  /* Deux échanges lancés ensemble depuis le MÊME état : c'est le cas que
     verrou() ne saurait pas arbitrer entre deux instances. Un seul doit
     gagner, et la base seule en décide. */
  await b.put('essai:cas', 'DEPART');
  const [x, y] = await Promise.all([
    b.casValeur('essai:cas', 'DEPART', 'X'),
    b.casValeur('essai:cas', 'DEPART', 'Y'),
  ]);
  dit('deux échanges simultanés : un seul gagne', (x ? 1 : 0) + (y ? 1 : 0) === 1, { x, y });
  const gagnant = x ? 'X' : 'Y';
  dit("… et la base porte la valeur du gagnant, pas un mélange",
      (await b.get('essai:cas')) === gagnant);
}

/* ======================================================================== */
console.log('\n— Deux INSTANCES du backend sur la même base —');
{
  /* Une seconde copie du module, c'est un second processus : sa file
     d'attente en mémoire (la Map `verrous`) lui est propre, exactement comme
     celle d'un deuxième conteneur. Seule la base est commune. Tout ce qui
     suit ne peut donc tenir que si l'arbitrage est porté par la base. */
  const TMP2 = new URL('./.essai-mariadb-2.mjs', import.meta.url);
  writeFileSync(TMP2, SRC + '\nexport { base };\n');
  const W2 = (await import(TMP2.href)).default;
  const appel2 = (chemin, opts = {}) =>
    W2.fetch(new Request('https://exemple.test' + chemin, opts), env, ctx);
  const dormir = ms => new Promise(r => setTimeout(r, ms));

  /* 1. Le verrou lui-même. */
  const ordre = [];
  await Promise.all([
    DB.verrou('essai', async () => { ordre.push('A entre'); await dormir(400); ordre.push('A sort'); }),
    (async () => { await dormir(60); await DB.verrou('essai', async () => { ordre.push('B entre'); }); })(),
  ]);
  dit('le second entrant attend que le premier soit sorti',
      ordre.join(' → ') === 'A entre → A sort → B entre', ordre);

  let refus = null;
  await Promise.all([
    DB.verrou('essai', async () => { await dormir(1500); }),
    (async () => {
      await dormir(60);
      try { await DB.verrou('essai', async () => {}, { attente: 1 }); } catch (e) { refus = e; }
    })(),
  ]);
  dit("passé le délai d'attente, l'appel est refusé et le dit",
      !!refus && refus.verrouOccupe === true && refus.document === 'essai', refus && refus.message);

  let saute = false;
  await Promise.all([
    DB.verrou('essai', async () => { await dormir(400); }),
    (async () => {
      await dormir(60);
      try { await DB.verrou('essai', async () => {}, { attente: 0 }); } catch (e) { saute = !!e.verrouOccupe; }
    })(),
  ]);
  dit('sans attente, un appel trouve la place prise et passe son tour', saute);

  const relache = await DB.verrou('essai', async () => 'rendu');
  dit('une fois rendu, le verrou se reprend aussitôt et rend le résultat', relache === 'rendu');

  /* 2. Deux enregistrements, un par instance, sur deux pages différentes. */
  await DB.prepare('UPDATE kv SET val = ? WHERE cle = ?')
    .bind(JSON.stringify({ rhRoster: [], clients: [] }), 'data').run();
  await DB.prepare(
    'INSERT INTO kv (cle, val, exp) VALUES (?, ?, NULL) ON DUPLICATE KEY UPDATE val = VALUES(val)'
  ).bind('permissions', JSON.stringify({ rhemployes: ['RH'], facturation: ['RH'] })).run();
  await DB.prepare('DELETE FROM kv WHERE cle = ?').bind('datameta').run();

  await Promise.all([
    appel('/api/data',  avec('S-PATRON', { method: 'PUT', body: JSON.stringify({ rhRoster: [{ id: 'A', name: 'Alice' }] }) })),
    appel2('/api/data', avec('S-RH',     { method: 'PUT', body: JSON.stringify({ clients:  [{ id: 'B', nom: 'Bob' }] }) })),
  ]);
  const d2 = await lireData();
  dit("instance 1 : l'enregistrement du registre a survécu",
      Array.isArray(d2.rhRoster) && d2.rhRoster.length === 1, { rhRoster: d2.rhRoster });
  dit("instance 2 : l'enregistrement des clients a survécu",
      Array.isArray(d2.clients) && d2.clients.length === 1, { clients: d2.clients });
  const meta2 = JSON.parse((await DB.prepare('SELECT val FROM kv WHERE cle = ?').bind('datameta').first()).val);
  dit('la révision a monté de deux crans', meta2.rev === 2, { rev: meta2.rev });

  /* 3. Une rafale de déclarations de récolte, réparties sur les deux
        instances. Huit et non deux : deux écritures peuvent ne pas se
        chevaucher par simple chance de calendrier, et le test passerait
        alors même sans verrou — constaté par mutation. Huit à la fois, le
        chevauchement est certain. */
  await DB.prepare('UPDATE kv SET val = ? WHERE cle = ?')
    .bind(JSON.stringify({ linterna: [] }), 'data').run();
  await DB.prepare('DELETE FROM kv WHERE cle = ?').bind('journal').run();
  const corpsRecolte = JSON.stringify({ raisins: 50, mode: 'ajout' });
  const rafale = [];
  for (let i = 0; i < 4; i++) {
    rafale.push(appel('/api/linterna',  avec('S-RH', { method: 'POST', body: corpsRecolte })));
    rafale.push(appel2('/api/linterna', avec('S-RH', { method: 'POST', body: corpsRecolte })));
  }
  const reponses = await Promise.all(rafale);
  dit('les huit appels répondent 200', reponses.every(r => r.status === 200), reponses.map(r => r.status));
  const d3 = await lireData();
  dit('les huit ajouts, venus de deux instances, sont tous comptés (400)',
      (d3.linterna[0] || {}).raisins === 400, d3.linterna);

  /* 4. Le journal : huit actions, deux instances, huit traces. */
  const journal = JSON.parse((await DB.prepare('SELECT val FROM kv WHERE cle = ?').bind('journal').first()).val);
  dit('le journal garde les huit traces, aucune ne recouvre l\'autre',
      Array.isArray(journal) && journal.length === 8, { traces: journal.length });

  /* 5. Un rappel d'agenda, deux instances, une seule annonce. */
  const dansTroisHeures = (() => {
    const t = Date.now() + 3 * 3600 * 1000;
    const p = new Date(t).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' });
    const [d, h] = p.split(' ');
    const [aa, mm, jj] = d.split('-');
    return { date: `${jj}/${mm}/${aa}`, heure: h.slice(0, 5) };
  })();
  await DB.prepare('UPDATE kv SET val = ? WHERE cle = ?').bind(JSON.stringify({
    agenda: [{ title: 'Dégustation', vis: 'commercial', desc: 'client', heure_fin: '23:00', ...dansTroisHeures }],
  }), 'data').run();
  await DB.prepare('DELETE FROM kv WHERE cle LIKE ?').bind('agenda:rappel:%').run();
  const envAgenda = { ...env, DISCORD_AGENDA_CHANNEL: '123456789012345678' };
  ANNONCES = 0;
  const attentes = [];
  const ctxTache = { waitUntil(p) { attentes.push(Promise.resolve(p).catch(() => {})); } };
  await Promise.all([W.scheduled(null, envAgenda, ctxTache), W2.scheduled(null, envAgenda, ctxTache)]);
  await Promise.all(attentes);
  dit("un événement à annoncer, deux instances : UNE annonce", ANNONCES === 1, { annonces: ANNONCES });

  /* Et la marque est prise en une instruction : même sans le verrou de la
     tâche, deux passages vraiment simultanés n'annoncent qu'une fois. */
  await DB.prepare('DELETE FROM kv WHERE cle LIKE ?').bind('agenda:rappel:%').run();
  ANNONCES = 0;
  const b1 = MOD.base(envAgenda);
  const [p1, p2] = await Promise.all([
    b1.casValeur('agenda:rappel:essai', null, '1', { expirationTtl: 60 }),
    b1.casValeur('agenda:rappel:essai', null, '1', { expirationTtl: 60 }),
  ]);
  dit('la marque de rappel ne se prend qu\'une fois, même à deux en même temps',
      (p1 ? 1 : 0) + (p2 ? 1 : 0) === 1, { p1, p2 });
  const ligneMarque = await DB.prepare('SELECT exp FROM kv WHERE cle = ?').bind('agenda:rappel:essai').first();
  dit('… et elle porte bien une date de péremption', !!ligneMarque && Number(ligneMarque.exp) > Date.now());

  unlinkSync(TMP2);
}

await DB.prepare('DELETE FROM kv').bind().run();
await DB.prepare('DELETE FROM ventes').bind().run();
await DB.fermer();
unlinkSync(TMP);

console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.`);
process.exit(ko ? 1 : 0);
