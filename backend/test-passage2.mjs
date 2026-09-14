/* Banc d'essai du DEUXIÈME passage d'audit.
   ---------------------------------------------------------------------------
   Comme test-acces.mjs, chaque vérification ci-dessous correspond à un défaut
   qui existait vraiment — ici, à des défauts trouvés APRÈS le premier audit,
   dont deux étaient des correctifs incomplets de ce premier audit.

   Ce qui est vérifié, et pourquoi chaque point est là :

   · LE FILTRE DE FICHIERS STATIQUES NE SE CONTOURNE PLUS. Le premier audit
     avait fermé « /backend%2fsrc%2findex.js » (décoder avant de filtrer). Il
     restait « //backend/src/index.js » : deux barres obliques, le filtre ne
     reconnaît plus son préfixe, et path.resolve les réduit ensuite pour ouvrir
     le vrai fichier. Le code source du serveur repartait en clair. C'est la
     DEUXIÈME fois que cette porte s'ouvre : d'où ce banc d'essai ;

   · UNE REQUÊTE VENUE D'UN AUTRE SITE NE PASSE PLUS. Depuis que la session
     vit dans un cookie SameSite=None, le navigateur la joint à toute requête
     vers notre domaine, y compris déclenchée par une page piégée. Le code
     affirmait qu'« un formulaire HTML ne sait pas produire un corps JSON » :
     c'est faux (enctype="text/plain"), et request.json() ne regarde même pas
     le Content-Type ;

   · /api/quota NE LIVRE PLUS LE NUMÉRO CIVIL à un accès extérieur. Le filtre
     du premier audit fermait /api/data ; cette route-ci lit le même registre
     et le ressortait à toute session valable ;

   · /api/journal NON PLUS. Même porte de service : le journal nomme les gens
     à presque chaque ligne ;

   · UNE RÉVOCATION D'ACCÈS NE S'ANNULE PLUS TOUTE SEULE. /api/invite-login
     relisait la liste des accès, vérifiait le mot de passe (PBKDF2, ~100 ms),
     puis réécrivait la liste LUE AVANT — ressuscitant un accès supprimé
     pendant ce délai, actif, avec son mot de passe ;

   · LA DÉCONNEXION N'EST PLUS DÉCLENCHABLE PAR UNE BALISE <img> ;

   · L'ADRESSE DE RETOUR SUIT L'HÔTE RÉELLEMENT UTILISÉ. Le cookie est posé sur
     l'hôte d'arrivée ; renvoyer en dur vers SITE_URL le laissait derrière.

   Lancement :  node test-passage2.mjs
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { cheminStatique } from './src/chemins.js';

const SRC = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const TMP = new URL('./.essai-passage2.mjs', import.meta.url);
writeFileSync(TMP, SRC
  + '\nexport { handleQuota, handleJournal, handleLogout, handleInvites,'
  + ' handleInviteLogin, handlePresence, handlePermissions, handleAbsence, handleLinterna,'
  + ' liaisonFiche, exigerOrigine, racineRetour, base };\n');
const W = await import(TMP.href);

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};

/* ---------- Discord simulé ----------
   MEMBRES est modifiable en cours de route : c'est ce qui permet d'éprouver
   un CHANGEMENT DE PSEUDO, et deux comptes qui portent le même. */
const R_RH = '555555555555555555';
const R_PATRON = '777777777777777777';
const MEMBRES = {
  '800000000000000001': { roles: [R_RH], nick: null },
  '800000000000000002': { roles: [], nick: null },
};
globalThis.fetch = async (url) => {
  const u = String(url);
  const rep = (o, s = 200) => ({ ok: s < 300, status: s, json: async () => o });
  if (/\/guilds\/\d+\/roles$/.test(u)) {
    /* Les deux rôles sont déclarés DÈS LE DÉPART : la liste des rôles du
       serveur est mise en cache sous une clé unique (`roles`, sans
       identifiant de serveur), donc la première réponse vaut pour tout le
       fichier. La déclarer en cours de route n'aurait servi à rien. */
    return rep([
      { id: R_RH, name: 'RH', position: 4, managed: false },
      { id: R_PATRON, name: 'Patron', position: 9, managed: false },
    ]);
  }
  if (/\/channels\/\d+\/messages$/.test(u)) return rep({ id: '1' });
  const m = u.match(/\/guilds\/\d+\/members\/(\d+)$/);
  if (m) {
    const membre = MEMBRES[m[1]];
    return membre ? rep({ roles: membre.roles, nick: membre.nick })
                  : rep({ message: 'Unknown Member' }, 404);
  }
  throw new Error('appel non simulé : ' + u);
};

/* ---------- la fausse base ---------- */
const TABLE = new Map();
let ECHEC_ECRITURE = null;   /* nom d'une clé dont l'écriture doit échouer */
let VENTES = [];
const DB = {
  prepare(sql) {
    return { bind(...a) { return {
      async first() {
        if (!/SELECT val/.test(sql)) return null;
        const v = TABLE.get(a[0]);
        return v === undefined ? null : { val: v };
      },
      async run() {
        /* L'échange atomique (casValeur) : la fausse base doit rendre
           `affectedRows`, sinon le contrôle de version croit toujours perdre.
           INSERT IGNORE ne crée que si la clé est absente ; UPDATE … WHERE val
           n'écrit que si la valeur est restée celle qu'on avait lue. */
        if (/^INSERT IGNORE INTO kv/.test(sql)) {
          if (TABLE.has(a[0])) return { meta: { affectedRows: 0 } };
          TABLE.set(a[0], a[1]);
          return { meta: { affectedRows: 1 } };
        }
        if (/^UPDATE kv SET val/.test(sql)) {
          if (TABLE.get(a[1]) !== a[2]) return { meta: { affectedRows: 0 } };
          TABLE.set(a[1], a[0]);
          return { meta: { affectedRows: 1 } };
        }
        if (/^INSERT INTO kv/.test(sql)) {
          /* Panne d'écriture provoquée, pour éprouver l'enregistrement à
             moitié fait (voir « Une écriture qui échoue à moitié »). */
          if (ECHEC_ECRITURE && a[0] === ECHEC_ECRITURE) throw new Error('panne simulée');
          TABLE.set(a[0], a[1]);
        }
        if (/^DELETE FROM kv WHERE cle =/.test(sql)) TABLE.delete(a[0]);
        return {};
      },
      async all() {
        if (/FROM ventes/.test(sql)) return { results: VENTES };
        /* list()/listValeurs() : sans cette branche, toute lecture par préfixe
           rendait une liste vide — et un test qui vérifie « la liste est vide »
           passait alors même quand le filtre qu'il surveille avait disparu.
           (Constaté par campagne de mutation : la vérification était creuse.) */
        if (/FROM kv WHERE cle LIKE/.test(sql)) {
          const motif = String(a[0]).replace(/\\(.)/g, '$1');
          const prefixe = motif.endsWith('%') ? motif.slice(0, -1) : motif;
          const out = [];
          for (const [cle, val] of [...TABLE].sort((x, y) => x[0].localeCompare(y[0]))) {
            if (cle.startsWith(prefixe)) out.push({ val });
          }
          return { results: out };
        }
        return { results: [] };
      },
    }; } };
  },
  async batch() { return []; },
};

const env = {
  DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'y', DISCORD_BOT_TOKEN: 'z',
  DISCORD_GUILD_ID: '999',
  SITE_URL: 'https://exemple.test',
  SITE_URLS: 'https://exemple.test,https://ancien.test',
  PATRON_ROLES: 'Patron,Co-Patron', OWNER_IDS: '', DB,
};

const RH_ID = '800000000000000001';
const poserSession = (sid, contenu) => TABLE.set('sess:' + sid, JSON.stringify(contenu));
const requete = (chemin, opts = {}) => new Request('https://exemple.test' + chemin, opts);
const avec = (sid, opts = {}) => Object.assign({}, opts, {
  headers: Object.assign({ Authorization: 'Bearer ' + sid, 'Content-Type': 'application/json' },
                         opts.headers || {}),
});

/* ==========================================================================
   1. Le filtre de fichiers statiques (backend/src/chemins.js)
   ========================================================================== */
console.log('\n— Le code du serveur ne se télécharge pas —');
{
  const DOIVENT_ETRE_REFUSES = [
    '/backend/src/index.js',
    '/backend%2fsrc%2findex.js',        /* fermé par le 1er audit */
    '//backend/src/index.js',           /* ROUVERT : deux barres obliques */
    '/%2Fbackend%2Fsrc%2Findex.js',     /* la même, encodée */
    '///backend/package.json',
    '/backend%5Csrc%5Cindex.js',        /* barre oblique INVERSÉE (Windows) */
    '/%5Cbackend%5Csrc%5Cindex.js',
    '/img/../backend/src/db.js',
    '/a/../../backend/src/db.js',
    '/backend/./src/index.js',
    '/.git/config.json',
    '//.git/HEAD.json',
    '/docs/note.html',
    '/node_modules/x/package.json',
    '/%ZZ.js',                          /* adresse indécodable */
    '/fichier\0.js',                    /* octet nul */
  ];
  for (const u of DOIVENT_ETRE_REFUSES) {
    dit(`refusé : ${JSON.stringify(u)}`, cheminStatique(u) === null, cheminStatique(u));
  }

  const DOIVENT_ETRE_SERVIS = [
    ['/', '/index.html'],
    ['/gestion.html', '/gestion.html'],
    ['/accueil.html', '/accueil.html'],
    ['/marlowe-actions.js', '/marlowe-actions.js'],
    ['/three.min.js', '/three.min.js'],
    ['/version.json', '/version.json'],
    ['/img/logo.png', '/img/logo.png'],
    ['/fonts/inter.woff2', '/fonts/inter.woff2'],
  ];
  for (const [u, attendu] of DOIVENT_ETRE_SERVIS) {
    dit(`servi : ${u}`, cheminStatique(u) === attendu, cheminStatique(u));
  }
}

/* ==========================================================================
   2. Le contrôle d'origine (anti-CSRF)
   ========================================================================== */
console.log("\n— Une requête venue d'un autre site est écartée —");
{
  const url = new URL('https://exemple.test/api/data');
  const req = (methode, origine) => new Request('https://exemple.test/api/data', Object.assign(
    { method: methode }, origine === undefined ? {} : { headers: { Origin: origine } }));

  dit('POST depuis un site piégé → refusé',
      W.exigerOrigine(req('POST', 'https://mechant.test'), url, env) === false);
  dit('POST depuis une iframe en bac à sable (Origin: null) → refusé',
      W.exigerOrigine(req('POST', 'null'), url, env) === false);
  dit('POST depuis notre propre panel → accepté',
      W.exigerOrigine(req('POST', 'https://exemple.test'), url, env) === true);
  dit("POST depuis l'ancienne adresse listée dans SITE_URLS → accepté",
      W.exigerOrigine(req('POST', 'https://ancien.test'), url, env) === true);
  dit('POST sans Origin (banc d\'essai, script, serveur de jeu) → accepté',
      W.exigerOrigine(req('POST', undefined), url, env) === true);
  dit('PUT depuis un site piégé → refusé',
      W.exigerOrigine(req('PUT', 'https://mechant.test'), url, env) === false);
  dit('GET depuis un site piégé → laissé passer (ne change rien, CORS bloque la lecture)',
      W.exigerOrigine(req('GET', 'https://mechant.test'), url, env) === true);

  /* L'hôte réellement utilisé prime, même absent de SITE_URLS : sinon un
     SITE_URL réglé sur l'autre domaine bloquerait le panel légitime. */
  dit("POST sur un hôte servi mais non listé, depuis ce même hôte → accepté",
      W.exigerOrigine(
        new Request('https://autre.test/api/data', { method: 'POST', headers: { Origin: 'https://autre.test' } }),
        new URL('https://autre.test/api/data'), env) === true);
}

console.log('\n— … et le routeur la refuse pour de bon —');
{
  poserSession('S-RH', { id: RH_ID, name: 'Rachel', avatar: null });
  const ctx = { waitUntil() {} };

  /* Le corps qu'un formulaire <form enctype="text/plain"> sait produire :
     request.json() ne regarde pas le Content-Type, donc ceci EST du JSON. */
  const corpsFormulaire = '{"action":"creer","nom":"pirate","mdp":"motdepasse12","z":"="}';
  const piege = new Request('https://exemple.test/api/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Origin: 'https://mechant.test',
               Authorization: 'Bearer S-RH' },
    body: corpsFormulaire,
  });
  const r = await W.default.repondre(piege, env, ctx);
  dit('POST /api/invites depuis un site piégé → 403', r.status === 403, { statut: r.status });
  const corps = await r.json();
  dit('… avec un motif explicite', corps.error === 'origine_refusee', corps);

  const propre = new Request('https://exemple.test/api/version', {
    method: 'GET', headers: { Origin: 'https://exemple.test' },
  });
  dit('… et le panel légitime passe toujours',
      (await W.default.repondre(propre, env, ctx)).status === 200);
}

/* ==========================================================================
   3. /api/quota — le numéro civil ne sort pas
   ========================================================================== */
console.log("\n— /api/quota ne livre pas le registre à un accès extérieur —");
{
  VENTES = [{ cle: 'remi castel', nom: 'Rémi Castel', qte: '100', brut: '500', part: '50', n: '3', dernier: '1700000000000' }];
  TABLE.set('data', JSON.stringify({
    rhRoster: [{ id: 'C-42', name: 'Rémi Castel', poste: 'Vigneron', rib: 'FR76-TEMOIN' }],
  }));
  TABLE.set('alias', JSON.stringify({}));

  /* Un membre du Discord : rien ne change pour lui. */
  poserSession('S-RH', { id: RH_ID, name: 'Rachel', avatar: null });
  const membre = await (await W.handleQuota(requete('/api/quota', avec('S-RH')), env)).json();
  dit('un membre voit le numéro civil (règle métier inchangée)',
      membre.rattachees[0].civil === 'C-42', membre.rattachees[0]);
  dit('… et les chiffres sont bien des NOMBRES, pas du texte',
      membre.rattachees[0].vins === 100 && membre.rattachees[0].part === 50, membre.rattachees[0]);

  /* Un comptable extérieur à qui seule « Facturation » est cochée. */
  TABLE.set('invites', JSON.stringify([{
    code: 'MV-COMPTA', nom: 'Comptable', sel: 's', hash: 'h',
    pages: ['facturation'], ro: [], actif: true,
  }]));
  poserSession('S-INV', { invite: true, code: 'MV-COMPTA', id: 'inv:MV-COMPTA', name: 'Comptable' });
  const inv = await (await W.handleQuota(requete('/api/quota', avec('S-INV')), env)).json();
  dit("un accès « Facturation » ne reçoit AUCUN numéro civil",
      inv.rattachees[0].civil === '', inv.rattachees[0]);
  dit('… et aucun RIB ne traîne dans la réponse',
      !JSON.stringify(inv).includes('FR76-TEMOIN'));
  dit('… mais les chiffres de production lui parviennent toujours',
      inv.rattachees[0].vins === 100, inv.rattachees[0]);

  /* Un accès extérieur à QUI la page RH est cochée : il garde tout. */
  TABLE.set('invites', JSON.stringify([{
    code: 'MV-RH', nom: 'RH externe', sel: 's', hash: 'h',
    pages: ['rhemployes'], ro: [], actif: true,
  }]));
  poserSession('S-INV2', { invite: true, code: 'MV-RH', id: 'inv:MV-RH', name: 'RH externe' });
  const inv2 = await (await W.handleQuota(requete('/api/quota', avec('S-INV2')), env)).json();
  dit("un accès à qui « Employés » est cochée garde le numéro civil",
      inv2.rattachees[0].civil === 'C-42', inv2.rattachees[0]);
}

/* ==========================================================================
   4. /api/journal
   ========================================================================== */
console.log('\n— /api/journal ne part pas chez un tiers —');
{
  TABLE.set('journal', JSON.stringify([{ by: 'Rachel', texte: 'a rétrogradé Rémi Castel', at: 'x' }]));

  poserSession('S-RH', { id: RH_ID, name: 'Rachel', avatar: null });
  dit('un membre du Discord lit le journal',
      (await W.handleJournal(requete('/api/journal', avec('S-RH')), env)).status === 200);

  TABLE.set('invites', JSON.stringify([{
    code: 'MV-COMPTA', nom: 'Comptable', sel: 's', hash: 'h',
    pages: ['facturation'], ro: [], actif: true,
  }]));
  poserSession('S-INV', { invite: true, code: 'MV-COMPTA', id: 'inv:MV-COMPTA', name: 'Comptable' });
  const r = await W.handleJournal(requete('/api/journal', avec('S-INV')), env);
  dit("un accès « Facturation » reçoit 403", r.status === 403, { statut: r.status });
  dit('… et aucun nom ne fuit dans le corps de la réponse',
      !JSON.stringify(await r.json()).includes('Rémi Castel'));

  TABLE.set('invites', JSON.stringify([{
    code: 'MV-J', nom: 'Auditeur', sel: 's', hash: 'h',
    pages: ['journal'], ro: [], actif: true,
  }]));
  poserSession('S-INVJ', { invite: true, code: 'MV-J', id: 'inv:MV-J', name: 'Auditeur' });
  dit("un accès à qui « Journal » est cochée le lit toujours",
      (await W.handleJournal(requete('/api/journal', avec('S-INVJ')), env)).status === 200);
}

/* ==========================================================================
   5. Une révocation d'accès ne s'annule plus toute seule
   ========================================================================== */
console.log("\n— Une révocation gagne la course contre une connexion —");
{
  /* On fabrique un vrai accès, avec un vrai mot de passe haché, pour que la
     vérification PBKDF2 coûte le temps qu'elle coûte réellement. */
  const MDP = 'motdepasse12';
  TABLE.set('invites', JSON.stringify([]));
  TABLE.set('permissions', JSON.stringify({ paraminvites: ['RH'] }));
  TABLE.set('settings', JSON.stringify({}));
  poserSession('S-PATRON', { id: RH_ID, name: 'Rachel', avatar: null, isPatron: true });

  const creation = await W.handleInvites(requete('/api/invites', avec('S-PATRON', {
    method: 'POST', body: JSON.stringify({ action: 'creer', nom: 'Comptable', mdp: MDP, pages: ['facturation'] }),
  })), env);
  const { code } = await creation.json();
  dit("l'accès est bien créé", typeof code === 'string' && code.startsWith('MV-'), code);

  /* La connexion part ; la suppression arrive PENDANT la vérification du mot
     de passe (PBKDF2, 120 000 tours). Sans file d'attente, la connexion
     réécrivait ensuite la liste qu'elle avait lue AVANT — et ressuscitait
     l'accès supprimé. */
  const connexion = W.handleInviteLogin(new Request('https://exemple.test/api/invite-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, mdp: MDP }),
  }), env);

  const suppression = await W.handleInvites(requete('/api/invites', avec('S-PATRON', {
    method: 'POST', body: JSON.stringify({ action: 'supprimer', code }),
  })), env);
  dit('la suppression aboutit', suppression.status === 200, { statut: suppression.status });

  const rep = await connexion;
  const restants = JSON.parse(TABLE.get('invites') || '[]');
  dit("l'accès supprimé NE REVIENT PAS dans la liste",
      !restants.some(x => x.code === code), restants.map(x => x.code));
  dit('… et la connexion concurrente ne délivre pas de session valable',
      rep.status === 401, { statut: rep.status });
}

console.log('\n— Un double-clic sur « créer » ne perd pas un accès —');
{
  TABLE.set('invites', JSON.stringify([]));
  poserSession('S-PATRON', { id: RH_ID, name: 'Rachel', avatar: null, isPatron: true });
  const creer = (nom) => W.handleInvites(requete('/api/invites', avec('S-PATRON', {
    method: 'POST', body: JSON.stringify({ action: 'creer', nom, mdp: 'motdepasse12', pages: ['facturation'] }),
  })), env);

  await Promise.all([creer('Premier'), creer('Second')]);
  const liste = JSON.parse(TABLE.get('invites') || '[]');
  dit('les deux créations simultanées survivent', liste.length === 2, liste.map(x => x.nom));
}

/* ==========================================================================
   6. La déconnexion
   ========================================================================== */
console.log('\n— La déconnexion ne se déclenche pas depuis un autre site —');
{
  poserSession('S-OUT', { id: RH_ID, name: 'Rachel', avatar: null });
  const g = await W.handleLogout(requete('/api/logout', avec('S-OUT')), env);
  dit('GET /api/logout → 405 (plus de <img src="…/api/logout">)', g.status === 405, { statut: g.status });
  dit('… et la session est toujours là', TABLE.has('sess:S-OUT'));

  const p = await W.handleLogout(requete('/api/logout', avec('S-OUT', { method: 'POST' })), env);
  dit('POST /api/logout → 200', p.status === 200, { statut: p.status });
  dit('… la session est effacée côté serveur', !TABLE.has('sess:S-OUT'));
  const cookie = p.headers.get('Set-Cookie') || '';
  dit('… et le cookie est effacé côté navigateur',
      cookie.includes('mv_session=') && /Max-Age=0/.test(cookie), cookie);
}

/* ==========================================================================
   7. L'adresse de retour après connexion
   ========================================================================== */
console.log("\n— Le retour de connexion suit l'hôte réellement utilisé —");
{
  dit("arrivé par l'adresse principale → on y reste",
      W.racineRetour(env, new URL('https://exemple.test/api/callback')) === 'https://exemple.test');
  dit("arrivé par l'ancienne adresse (listée) → on y reste, le cookie y est posé",
      W.racineRetour(env, new URL('https://ancien.test/api/callback')) === 'https://ancien.test');
  dit('arrivé par un hôte non autorisé → repli sur SITE_URL, pas de redirection ouverte',
      W.racineRetour(env, new URL('https://mechant.test/api/callback')) === 'https://exemple.test');
  dit('SITE_URL avec une barre finale est nettoyée',
      W.racineRetour(Object.assign({}, env, { SITE_URL: 'https://exemple.test/', SITE_URLS: '' }),
                     new URL('https://mechant.test/api/callback')) === 'https://exemple.test');
}

/* ==========================================================================
   8. Lacunes relevées par la relecture indépendante de ces correctifs
   ========================================================================== */
console.log('\n— La casse ne contourne pas le filtre (Windows, macOS) —');
{
  /* Le filtre comparait « /backend » à la lettre près alors que le système de
     fichiers de Windows et de macOS, lui, ne fait pas la différence. */
  for (const u of ['/BACKEND/src/index.js', '/Backend/src/db.js', '/NODE_MODULES/x/package.json',
                   '/Docs/note.html', '/CLAUDE%20OUTPUTS/x.png', '/Claude outputs/x.png',
                   '//BACKEND/src/index.js']) {
    dit(`refusé quelle que soit la casse : ${u}`, cheminStatique(u) === null, cheminStatique(u));
  }
  dit('un nom de fichier accentué reste servi',
      cheminStatique('/img/Château-Marlowe.png') === '/img/Château-Marlowe.png');
  dit('une majuscule légitime reste servie',
      cheminStatique('/img/Logo.PNG') === '/img/Logo.PNG');
}

console.log("\n— Un proxy sans X-Forwarded-Proto ne bloque pas tout le panel —");
{
  /* Sans cet en-tête, server.js reconstruit l'adresse en http:// alors que le
     navigateur annonce une origine en https:// : comparer les origines
     ENTIÈRES aurait refusé toute écriture, partout, pour un en-tête manquant
     dans une configuration de proxy. On compare donc l'hôte. */
  /* L'hôte choisi ici n'est VOLONTAIREMENT pas dans SITE_URLS : sinon la
     liste blanche rattraperait le cas et la vérification ne prouverait rien
     sur la comparaison elle-même. (Constaté par campagne de mutation.) */
  const cible = new URL('http://pas-liste.test/api/data');
  const req = (origine) => new Request('http://pas-liste.test/api/data', {
    method: 'PUT', headers: { Origin: origine } });
  dit('panel en https, serveur qui se croit en http → accepté',
      W.exigerOrigine(req('https://pas-liste.test'), cible, env) === true);
  dit('… mais un autre hôte reste refusé',
      W.exigerOrigine(req('https://mechant.test'), cible, env) === false);
  dit('… et une origine illisible aussi',
      W.exigerOrigine(req('null'), cible, env) === false);
}

console.log('\n— /api/presence ne dit pas à un tiers qui travaille —');
{
  TABLE.set('pres:800000000000000001', JSON.stringify({
    id: RH_ID, name: 'Rachel', avatar: null, page: 'rhemployes', at: Date.now() }));
  poserSession('S-RH', { id: RH_ID, name: 'Rachel', avatar: null });
  const m = await (await W.handlePresence(requete('/api/presence', avec('S-RH')), env)).json();
  dit('un membre voit bien qui est connecté (règle métier inchangée)',
      Array.isArray(m.membres) && m.membres.some(x => x.name === 'Rachel'), m);

  TABLE.set('invites', JSON.stringify([{
    code: 'MV-COMPTA', nom: 'Comptable', sel: 's', hash: 'h',
    pages: ['facturation'], ro: [], actif: true,
  }]));
  poserSession('S-INV', { invite: true, code: 'MV-COMPTA', id: 'inv:MV-COMPTA', name: 'Comptable' });
  const i = await (await W.handlePresence(requete('/api/presence', avec('S-INV')), env)).json();
  dit("un accès extérieur ne reçoit personne", Array.isArray(i.membres) && i.membres.length === 0, i);
  dit('… et aucun identifiant Discord ne traîne dans la réponse',
      !JSON.stringify(i.membres).includes(RH_ID));
}

console.log("\n— Les droits délivrés à la connexion sont ceux de l'instant —");
{
  /* La vérification du mot de passe dure ~100 ms (PBKDF2). Tout ce que le
     patron change pendant ce temps doit valoir : réduire les droits, ou
     changer le mot de passe. */
  const MDP = 'motdepasse12';
  TABLE.set('invites', JSON.stringify([]));
  TABLE.set('permissions', JSON.stringify({ paraminvites: ['RH'] }));
  TABLE.set('settings', JSON.stringify({}));
  poserSession('S-PATRON', { id: RH_ID, name: 'Rachel', avatar: null, isPatron: true });

  const { code } = await (await W.handleInvites(requete('/api/invites', avec('S-PATRON', {
    method: 'POST',
    body: JSON.stringify({ action: 'creer', nom: 'Comptable', mdp: MDP, pages: ['facturation', 'journal'] }),
  })), env)).json();

  /* (a) Réduction des droits pendant la vérification du mot de passe. */
  const connexion = W.handleInviteLogin(new Request('https://exemple.test/api/invite-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, mdp: MDP }),
  }), env);
  await W.handleInvites(requete('/api/invites', avec('S-PATRON', {
    method: 'POST', body: JSON.stringify({ action: 'pages', code, pages: ['facturation'], ro: [] }),
  })), env);
  const rep = await connexion;
  const corps = await rep.json();
  dit('la connexion aboutit', rep.status === 200, { statut: rep.status });
  dit("… avec les droits RÉDUITS, pas ceux d'avant",
      Array.isArray(corps.pages) && !corps.pages.includes('journal'), corps.pages);

  /* (b) Rotation du mot de passe pendant la vérification de l'ancien. */
  const connexion2 = W.handleInviteLogin(new Request('https://exemple.test/api/invite-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, mdp: MDP }),
  }), env);
  await W.handleInvites(requete('/api/invites', avec('S-PATRON', {
    method: 'POST', body: JSON.stringify({ action: 'mdp', code, mdp: 'toutNouveau99' }),
  })), env);
  const rep2 = await connexion2;
  dit("un mot de passe changé pendant la vérification n'ouvre plus",
      rep2.status === 401, { statut: rep2.status });
}

/* ==========================================================================
   9. L'identité, c'est l'identifiant Discord — pas le pseudo
   ========================================================================== */
const MARIE = '900000000000000001';   // a une fiche, rattachée
const THOMAS = '900000000000000002';  // se donne le pseudo de Marie
const JEAN = '900000000000000003';    // pseudo qui tombe sur deux homonymes

function poserMonde(data, sessions) {
  TABLE.set('data', JSON.stringify(data));
  TABLE.set('journal', JSON.stringify([]));
  TABLE.delete('datameta');
  for (const [sid, contenu] of Object.entries(sessions)) {
    TABLE.delete('absence:' + contenu.id);   /* le garde-fou anti-rafale */
    poserSession(sid, contenu);
  }
}
const declarerAbsence = (sid) => W.handleAbsence(requete('/api/absence', avec(sid, {
  method: 'POST', body: JSON.stringify({ du: '03/09/2026', au: '10/09/2026', motif: 'Congé' }),
})), env);
const declarerRecolte = (sid, corps) => W.handleLinterna(requete('/api/linterna', avec(sid, {
  method: 'POST', body: JSON.stringify(corps),
})), env);

console.log("\n— Deux personnes portant le MÊME pseudo —");
{
  /* Thomas prend le surnom Discord de Marie. Avant ce correctif, il écrivait
     l'absence de Marie, passait sa fiche en « absent », et pouvait remettre sa
     récolte à zéro : le rattachement se faisait sur le nom affiché. */
  MEMBRES[MARIE]  = { roles: [], nick: 'Marie Lambert' };
  MEMBRES[THOMAS] = { roles: [], nick: 'Marie Lambert' };   /* le même, exprès */

  poserMonde({
    rhRoster: [{ id: 'C-1', name: 'Marie Lambert', poste: 'Vigneronne',
                 status: 'actif', discord: MARIE }],
    rhAbsences: [], linterna: [{ name: 'Marie Lambert', discord: MARIE, raisins: 500 }],
  }, {
    'S-MARIE':  { id: MARIE,  name: 'Marie Lambert', avatar: null },
    'S-THOMAS': { id: THOMAS, name: 'Marie Lambert', avatar: null },
  });

  const rep = await (await declarerAbsence('S-THOMAS')).json();
  const d = JSON.parse(TABLE.get('data'));

  dit("l'usurpateur ne touche PAS la fiche de sa victime",
      d.rhRoster[0].status === 'actif', d.rhRoster[0]);
  dit('… sa déclaration est rattachée à SON identifiant',
      d.rhAbsences.length === 1 && d.rhAbsences[0].discord === THOMAS, d.rhAbsences);
  dit('… et le serveur lui dit que son compte n\'est lié à aucune fiche',
      rep.liaison && rep.liaison.etat === 'a_confirmer', rep.liaison);
  /* Accès défensif : si le rattachement repassait au pseudo, `candidats`
     n'existerait plus — le banc doit alors ÉCHOUER, pas planter, sinon les
     vérifications suivantes ne s'exécutent même pas. */
  const cand = (rep.liaison && rep.liaison.candidats) || null;
  dit('… en signalant la fiche homonyme, sans la lui attribuer',
      !!cand && cand.length === 1 && cand[0].civil === 'C-1' && cand[0].dejaLie === true,
      rep.liaison);

  /* Marie déclare à son tour : sa ligne à elle, sa fiche à elle. */
  await declarerAbsence('S-MARIE');
  const d2 = JSON.parse(TABLE.get('data'));
  dit('la vraie titulaire, elle, passe bien en absent',
      d2.rhRoster[0].status === 'absent', d2.rhRoster[0]);
  dit('… et les deux absences coexistent, distinctes',
      d2.rhAbsences.length === 2
      && d2.rhAbsences.filter(a => a.discord === MARIE).length === 1
      && d2.rhAbsences.filter(a => a.discord === THOMAS).length === 1,
      d2.rhAbsences.map(a => a.discord));

  /* Le cas qui coûte de l'argent : remettre la récolte d'un collègue à zéro. */
  await declarerRecolte('S-THOMAS', { raisins: 0, mode: 'total' });
  const d3 = JSON.parse(TABLE.get('data'));
  const ligneMarie = d3.linterna.find(x => x.discord === MARIE);
  dit("la récolte de la victime est intacte (500 raisins)",
      ligneMarie && ligneMarie.raisins === 500, d3.linterna);
  dit("… et l'usurpateur n'a remis à zéro que la sienne",
      d3.linterna.some(x => x.discord === THOMAS && x.raisins === 0), d3.linterna);
}

console.log('\n— Un changement de pseudo ne fait pas perdre sa ligne —');
{
  MEMBRES[MARIE] = { roles: [], nick: 'Marie L.' };
  poserMonde({
    rhRoster: [{ id: 'C-1', name: 'Marie Lambert', discord: MARIE }],
    rhAbsences: [], linterna: [],
  }, { 'S-MARIE': { id: MARIE, name: 'Marie L.', avatar: null } });

  await declarerRecolte('S-MARIE', { raisins: 100 });
  const avant = JSON.parse(TABLE.get('data')).linterna;
  dit('la ligne porte le nom de la FICHE, pas le pseudo',
      avant.length === 1 && avant[0].name === 'Marie Lambert', avant);

  /* Elle se renomme sur Discord. Son identifiant, lui, n'a pas bougé. */
  MEMBRES[MARIE] = { roles: [], nick: 'Marie Lambert-Dupont' };
  poserSession('S-MARIE2', { id: MARIE, name: 'Marie Lambert-Dupont', avatar: null });

  const rep = await (await declarerRecolte('S-MARIE2', { raisins: 50 })).json();
  const apres = JSON.parse(TABLE.get('data')).linterna;
  dit('… elle retrouve SA ligne après changement de pseudo',
      apres.length === 1 && apres[0].raisins === 150, apres);
  dit('… le total repart bien de 100, pas de zéro', rep.avant === 100, rep);
  dit('… et le nom affiché reste celui du registre',
      apres[0].name === 'Marie Lambert', apres[0]);
}

console.log('\n— Les rapprochements douteux sont signalés, jamais appliqués —');
{
  MEMBRES[JEAN] = { roles: [], nick: 'Jean Petit' };
  poserMonde({
    /* Deux homonymes, aucun rattaché : personne ne peut trancher à la place
       des RH — surtout pas sur la foi d'un pseudo. */
    rhRoster: [{ id: 'C-7', name: 'Jean Petit' }, { id: 'C-8', name: 'Jean Petit' }],
    rhAbsences: [], linterna: [],
  }, { 'S-JEAN': { id: JEAN, name: 'Jean Petit', avatar: null } });

  const rep = await (await declarerAbsence('S-JEAN')).json();
  dit('deux homonymes → rattachement déclaré AMBIGU',
      rep.liaison.etat === 'ambigue', rep.liaison);
  dit('… les deux fiches sont nommées comme candidates',
      !!(rep.liaison && rep.liaison.candidats) && rep.liaison.candidats.length === 2,
      rep.liaison);
  const d = JSON.parse(TABLE.get('data'));
  dit('… et AUCUNE des deux fiches n\'a été touchée',
      !d.rhRoster.some(f => f.status === 'absent'), d.rhRoster);
  dit('… la déclaration existe quand même, sous son identifiant',
      d.rhAbsences.length === 1 && d.rhAbsences[0].discord === JEAN, d.rhAbsences);

  /* Personne du tout au registre : on le dit aussi, sans rien inventer. */
  const roster = [];
  dit("aucun homonyme → rattachement « absente »",
      W.liaisonFiche(roster, { user: { id: JEAN, name: 'Jean Petit' } }).etat === 'absente');
}

console.log("\n— Reprise des lignes d'avant le changement —");
{
  MEMBRES[MARIE] = { roles: [], nick: 'Marie L.' };
  poserMonde({
    rhRoster: [{ id: 'C-1', name: 'Marie Lambert', discord: MARIE }],
    rhAbsences: [],
    linterna: [
      { name: 'Marie Lambert', raisins: 80 },        /* ancienne ligne, sans identifiant */
      { name: 'Quelqu\'un d\'autre', raisins: 40 },  /* celle d'un tiers */
    ],
  }, { 'S-MARIE': { id: MARIE, name: 'Marie L.', avatar: null } });

  const rep = await (await declarerRecolte('S-MARIE', { raisins: 20 })).json();
  const l = JSON.parse(TABLE.get('data')).linterna;
  dit("l'ancienne ligne est reprise, pas dupliquée", l.length === 2, l);
  dit('… le total s\'ajoute à l\'existant (80 + 20)', rep.total === 100, rep);
  dit("… et elle porte désormais l'identifiant",
      l.some(x => x.discord === MARIE && x.raisins === 100), l);
  dit("la ligne d'un tiers n'a pas bougé",
      l.some(x => x.name === "Quelqu'un d'autre" && x.raisins === 40 && !x.discord), l);
}

console.log("\n— Le code et le nom d'un accès ne changent jamais —");
{
  /* Ce banc-ci ne garde pas un correctif : il garde une HYPOTHÈSE.
     handleInviteLogin bâtit la session sur la version relue dans le verrou
     (`frais`) plutôt que sur celle lue avant PBKDF2 (`inv`). Aujourd'hui les
     deux donnent le même résultat, parce qu'AUCUNE action ne modifie le code
     ni le nom d'un accès : seule cette immuabilité rend les deux versions
     équivalentes. Le jour où quelqu'un ajoute une action « renommer », elle
     tombe — et la session porterait un nom périmé sans que rien ne le dise.
     Ce test échouera ce jour-là, et renverra le lecteur à handleInviteLogin. */
  TABLE.set('invites', JSON.stringify([]));
  TABLE.set('permissions', JSON.stringify({ paraminvites: ['RH'] }));
  TABLE.set('settings', JSON.stringify({}));
  poserSession('S-PATRON', { id: RH_ID, name: 'Rachel', avatar: null, isPatron: true });

  const agir = (corps) => W.handleInvites(requete('/api/invites', avec('S-PATRON', {
    method: 'POST', body: JSON.stringify(corps),
  })), env);

  const { code } = await (await agir({
    action: 'creer', nom: 'Comptable', mdp: 'motdepasse12', pages: ['facturation'],
  })).json();
  const apresCreation = JSON.parse(TABLE.get('invites'))[0];

  for (const corps of [
    { action: 'pages', code, pages: ['journal'], ro: [] },
    { action: 'mdp', code, mdp: 'toutNouveau99' },
    { action: 'basculer', code },
  ]) {
    await agir(corps);
    const maintenant = JSON.parse(TABLE.get('invites'))[0];
    dit(`« ${corps.action} » ne touche ni au code ni au nom`,
        maintenant.code === apresCreation.code && maintenant.nom === apresCreation.nom,
        { code: maintenant.code, nom: maintenant.nom });
  }

  const actions = [...SRC.matchAll(/action === '([a-z]+)'/g)].map(m => m[1]);
  dit("aucune action de renommage n'a été ajoutée depuis",
      actions.sort().join(',') === 'basculer,creer,mdp,pages,supprimer', actions);
}

console.log("\n— Deux enregistrements de la matrice ne s'écrasent plus —");
{
  /* Cette route REMPLACE la matrice entière. Sans contrôle de version, deux
     personnes sur « Accès & rôles » s'écrasaient l'une l'autre en silence,
     les deux voyant « enregistré ». Un verrou n'y aurait rien changé : deux
     remplacements complets sérialisés donnent le même résultat. */
  /* `parametres` donne le droit d'écrire la matrice (COLLECTION_PAGES.acces).
     Il est reconduit dans CHAQUE écriture : cette route remplaçant tout, une
     matrice qui l'oublierait retirerait à l'autrice son propre droit d'écrire
     — le comportement est voulu et documenté, mais il n'a rien à faire au
     milieu d'un essai sur les conflits. */
  const DROIT = { parametres: ['RH'] };
  TABLE.delete('permsmeta');
  TABLE.set('permissions', JSON.stringify(Object.assign({ rhemployes: ['RH'] }, DROIT)));
  TABLE.set('settings', JSON.stringify({}));
  poserSession('S-PATRON', { id: RH_ID, name: 'Rachel', avatar: null });

  const lire = async () => (await (await W.handlePermissions(
    requete('/api/permissions', avec('S-PATRON')), env)).json());
  const ecrire = (matrice, rev) => W.handlePermissions(requete('/api/permissions', avec('S-PATRON', {
    method: 'PUT', body: JSON.stringify(Object.assign({}, DROIT, matrice, { _rev: rev })),
  })), env);

  const vue = await lire();
  dit('la lecture donne la matrice ET son numéro de version',
      Array.isArray(vue.rhemployes) && vue._meta && vue._meta.rev === 0, vue._meta);

  /* Les deux onglets ont lu la même version. */
  const revCommune = vue._meta.rev;

  const premier = await ecrire({ rhemployes: ['RH', 'DRH'] }, revCommune);
  dit("le premier enregistrement passe", premier.status === 200, { statut: premier.status });
  const apres1 = await premier.json();
  dit('… et la version monte d\'un cran', apres1._meta.rev === revCommune + 1, apres1._meta);
  dit('… en notant qui a enregistré', apres1._meta.by === 'Rachel', apres1._meta);

  const second = await ecrire({ rhemployes: ['Vendeur'] }, revCommune);
  dit('le second, parti de la MÊME version, reçoit 409', second.status === 409, { statut: second.status });
  const conflit = await second.json();
  dit('… avec le numéro courant, qui a enregistré et quand',
      conflit.rev === revCommune + 1 && conflit.by === 'Rachel' && !!conflit.at, conflit);

  const enBase = JSON.parse(TABLE.get('permissions'));
  dit("… et SURTOUT : le travail du premier n'a pas été écrasé",
      JSON.stringify(enBase.rhemployes) === JSON.stringify(['RH', 'DRH']), enBase);

  /* Un onglet ouvert avant la mise à jour n'envoie aucune version. */
  const sansRev = await W.handlePermissions(requete('/api/permissions', avec('S-PATRON', {
    method: 'PUT', body: JSON.stringify(Object.assign({ rhemployes: ['Personne'] }, DROIT)),
  })), env);
  dit('un enregistrement sans numéro de version est refusé', sansRev.status === 409,
      { statut: sansRev.status });
  dit('… sans rien écrire non plus',
      JSON.parse(TABLE.get('permissions')).rhemployes.join() === 'RH,DRH');

  /* Après rechargement, l'onglet reprend la main. */
  const reprise = await ecrire({ rhemployes: ['Vendeur'] }, (await lire())._meta.rev);
  dit("après avoir rechargé, l'enregistrement repasse", reprise.status === 200,
      { statut: reprise.status });
}

console.log('\n— … y compris lancés exactement en même temps —');
{
  const DROIT2 = { parametres: ['RH'] };
  TABLE.delete('permsmeta');
  TABLE.set('permissions', JSON.stringify(Object.assign({ rhemployes: ['Depart'] }, DROIT2)));
  poserSession('S-PATRON', { id: RH_ID, name: 'Rachel', avatar: null });

  const rev = (await (await W.handlePermissions(
    requete('/api/permissions', avec('S-PATRON')), env)).json())._meta.rev;

  const tirer = (role) => W.handlePermissions(requete('/api/permissions', avec('S-PATRON', {
    method: 'PUT', body: JSON.stringify(Object.assign({ rhemployes: [role], _rev: rev }, DROIT2)),
  })), env);

  /* Les deux partent ensemble, sur la même version lue. */
  const [a, b] = await Promise.all([tirer('AAA'), tirer('BBB')]);
  const statuts = [a.status, b.status].sort();
  dit('un seul des deux passe, l\'autre reçoit 409',
      statuts[0] === 200 && statuts[1] === 409, statuts);

  const gagnant = a.status === 200 ? 'AAA' : 'BBB';
  const enBase = JSON.parse(TABLE.get('permissions'));
  dit('la matrice en base est exactement celle du gagnant, pas un mélange',
      JSON.stringify(enBase.rhemployes) === JSON.stringify([gagnant]), enBase);
  dit("la version n'a monté que d'un cran (pas deux écritures)",
      JSON.parse(TABLE.get('permsmeta')).rev === rev + 1, TABLE.get('permsmeta'));
}

console.log("\n— Personne ne se déclare patron, personne ne s'enferme dehors —");
{
  const PATRON = '900000000000000010';
  const DRH    = '900000000000000011';
  MEMBRES[PATRON] = { roles: [R_PATRON], nick: 'La Patronne' };
  MEMBRES[DRH]    = { roles: [R_RH], nick: 'Le DRH' };
  const envP = env;   /* PATRON_ROLES y vaut déjà « Patron,Co-Patron » */

  TABLE.delete('permsmeta');
  TABLE.set('permissions', JSON.stringify({ parametres: ['RH'] }));
  TABLE.set('settings', JSON.stringify({}));

  /* On tente de se hisser patron par la session elle-même. */
  poserSession('S-TRICHE', { id: DRH, name: 'Le DRH', avatar: null,
                             isPatron: true, isOwner: true, roles: [R_PATRON] });
  const moi = await (await W.handlePermissions(requete('/api/permissions', avec('S-TRICHE')), envP)).json();
  dit('un isPatron glissé dans la session ne donne rien — il est recalculé',
      moi._meta !== undefined, moi._meta);

  const ecrire = (sid, matrice, ro) => W.handlePermissions(requete('/api/permissions', avec(sid, {
    method: 'PUT',
    body: JSON.stringify(Object.assign({}, matrice, { _rev: 0, _ro: ro || {} })),
  })), envP);

  /* Le DRH se retire « Paramètres » : refusé, il ne pourrait plus revenir. */
  const enferme = await ecrire('S-TRICHE', { parametres: [] });
  dit("se retirer soi-même l'accès à la matrice est refusé", enferme.status === 400,
      { statut: enferme.status });
  dit('… avec un motif qui dit quoi faire',
      (await enferme.json()).error === 'enfermement');
  dit("… et rien n'a été écrit", JSON.parse(TABLE.get('permissions')).parametres.join() === 'RH');

  /* Se mettre en lecture seule sur cette page revient au même. */
  const ro = await ecrire('S-TRICHE', { parametres: ['RH'] }, { parametres: ['RH'] });
  dit('se passer en lecture seule sur cette page est refusé aussi', ro.status === 400,
      { statut: ro.status });

  /* Garder la main est évidemment permis. */
  const ok = await ecrire('S-TRICHE', { parametres: ['RH'], rhemployes: ['RH'] });
  dit('… mais garder au moins un de ses rôles passe', ok.status === 200, { statut: ok.status });

  /* Un patron, lui, n'est jamais enfermé : ses droits ne viennent pas de la
     matrice mais de son rôle Discord, que la matrice ne peut pas lui ôter. */
  TABLE.delete('permsmeta');
  TABLE.set('permissions', JSON.stringify({ parametres: ['RH'] }));
  poserSession('S-PATRONNE', { id: PATRON, name: 'La Patronne', avatar: null });
  const passeLaMain = await ecrire('S-PATRONNE', { parametres: [] });
  dit('un patron peut vider la page — il garde la main par son rôle Discord',
      passeLaMain.status === 200, { statut: passeLaMain.status });

  /* Un droit retiré dans la matrice s'applique tout de suite. */
  const refus = await ecrire('S-TRICHE', { parametres: ['RH'] });
  dit("le DRH, écarté par la matrice, est refusé dès la requête suivante",
      refus.status === 403, { statut: refus.status });


}

console.log("\n— L'arbitrage tient SANS le verrou de processus —");
{
  /* verrou() est une Map JavaScript : elle ne vaut que pour le processus qui
     l'exécute. Deux conteneurs derrière un répartiteur ne la partagent pas.
     La garantie réelle, c'est cet échange atomique, arbitré par la BASE —
     donc commun à toutes les instances. On l'éprouve directement, sans passer
     par la route, puisque c'est lui et lui seul qu'on veut mettre à l'épreuve. */
  const b = W.base(env);

  TABLE.set('essai:cas', 'A');
  dit('échanger depuis la valeur courante réussit',
      (await b.casValeur('essai:cas', 'A', 'B')) === true);
  dit('… et la valeur a bien changé', TABLE.get('essai:cas') === 'B');

  dit('échanger depuis une valeur PÉRIMÉE échoue',
      (await b.casValeur('essai:cas', 'A', 'C')) === false);
  dit("… et la valeur n'a pas bougé d'un iota", TABLE.get('essai:cas') === 'B');

  TABLE.delete('essai:neuf');
  dit('créer une clé encore absente réussit',
      (await b.casValeur('essai:neuf', null, 'X')) === true);
  dit('… mais une seule fois : le second arrivant perd',
      (await b.casValeur('essai:neuf', null, 'Y')) === false);
  dit('… et c\'est la valeur du gagnant qui tient', TABLE.get('essai:neuf') === 'X');
}

console.log("\n— Une écriture qui échoue à moitié le DIT —");
{
  const DROIT = { parametres: ['RH'] };
  const depart = Object.assign({ rhemployes: ['RH'] }, DROIT);
  poserSession('S-PATRON', { id: RH_ID, name: 'Rachel', avatar: null });

  const preparer = () => {
    TABLE.delete('permsmeta');
    TABLE.set('permissions', JSON.stringify(depart));
    TABLE.set('settings', JSON.stringify({ dispoRoles: ['Responsable'] }));
  };
  const ecrire = (rev) => W.handlePermissions(requete('/api/permissions', avec('S-PATRON', {
    method: 'PUT',
    body: JSON.stringify(Object.assign({ rhemployes: ['RH', 'DRH'] }, DROIT,
      { _rev: rev, _ro: { rhemployes: ['DRH'] } })),
  })), env);

  /* Cas 1 : la lecture seule ne passe pas. On n'élargit alors PAS la matrice
     par-dessus — sinon DRH obtiendrait l'accès complet au lieu de la lecture
     seule qu'on voulait lui donner. */
  preparer();
  ECHEC_ECRITURE = 'settings';
  const r1 = await ecrire(0);
  ECHEC_ECRITURE = null;
  const c1 = await r1.json();
  dit('la lecture seule échoue → rien n\'est annoncé comme enregistré',
      c1.ok === false && (c1.enregistre || []).length === 0, c1);
  dit('… les deux parties sont nommées comme échouées',
      (c1.echoue || []).includes('permsRO') && (c1.echoue || []).includes('permissions'), c1.echoue);
  dit('… et la matrice en base est restée celle d\'avant',
      JSON.parse(TABLE.get('permissions')).rhemployes.join() === 'RH',
      JSON.parse(TABLE.get('permissions')).rhemployes);

  /* Cas 2 : la matrice ne passe pas, la lecture seule si. L'état est alors
     PLUS restrictif que voulu — jamais plus large. */
  preparer();
  ECHEC_ECRITURE = 'permissions';
  const r2 = await ecrire(0);
  ECHEC_ECRITURE = null;
  const c2 = await r2.json();
  dit('la matrice échoue → la réponse dit ce qui est passé',
      c2.ok === false && (c2.enregistre || []).includes('permsRO')
      && (c2.echoue || []).includes('permissions'), c2);
  dit('… et l\'état obtenu est plus restreint, pas plus large',
      JSON.parse(TABLE.get('settings')).permsRO.rhemployes.join() === 'DRH'
      && JSON.parse(TABLE.get('permissions')).rhemployes.join() === 'RH',
      { ro: JSON.parse(TABLE.get('settings')).permsRO, m: JSON.parse(TABLE.get('permissions')) });

  /* Cas 3 : tout passe — la lecture seule voyage bien avec la matrice. */
  preparer();
  const r3 = await ecrire(0);
  const c3 = await r3.json();
  dit('quand tout passe, les deux sont enregistrés en un seul appel',
      c3.ok === true && (c3.enregistre || []).length === 2, c3.enregistre);
  dit('… la matrice est à jour', JSON.parse(TABLE.get('permissions')).rhemployes.join() === 'RH,DRH');
  dit('… la lecture seule aussi',
      JSON.parse(TABLE.get('settings')).permsRO.rhemployes.join() === 'DRH');
  dit('… et les autres réglages n\'ont pas été écrasés au passage',
      JSON.parse(TABLE.get('settings')).dispoRoles.join() === 'Responsable',
      JSON.parse(TABLE.get('settings')));
}

console.log("\n— /api/version dit la vérité sur ce qui est déployé —");
{
  /* Cette route sert à vérifier d'un coup d'œil ce qui tourne réellement.
     Elle annonçait 24 routes pour 27 branchées — une route absente de la
     liste passe pour non déployée, et c'est exactement le doute que la route
     existe pour lever. On compare la liste au routeur lui-même : ajouter une
     route sans l'annoncer fera désormais échouer ce banc d'essai. */
  const branchees = [...SRC.matchAll(/case '\/api\/([a-z-]+)':/g)].map(m => m[1]);
  const bloc = (SRC.match(/routes: \[([\s\S]*?)\],/) || [])[1] || '';
  const annoncees = [...bloc.matchAll(/'([a-z-]+)'/g)].map(m => m[1]);

  const manquantes = branchees.filter(r => !annoncees.includes(r));
  const enTrop = annoncees.filter(r => !branchees.includes(r));

  dit(`les ${branchees.length} routes branchées sont toutes annoncées`,
      manquantes.length === 0, manquantes);
  dit("… et aucune route annoncée n'est absente du routeur",
      enTrop.length === 0, enTrop);
}

unlinkSync(TMP);
console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.`);
process.exit(ko ? 1 : 0);
