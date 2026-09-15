/* ============================================================================
   MARLOWE VINEYARD — l'API du panel (connexion Discord, RH, quotas, agenda…)
   ----------------------------------------------------------------------------
   Ce fichier contient toute la logique métier : les routes, l'OAuth Discord,
   la matrice des accès, les quotas, les rappels. Il est servi par
   src/server.js (Node.js) et parle à MariaDB/MySQL par src/db.js.

   Il est né Worker Cloudflare, et en garde la forme : un objet exporté avec
   fetch() et scheduled(), un `env` reçu en paramètre, une façade base(env)
   qui imite l'API D1. Quelques commentaires plus bas racontent encore des
   décisions prises pour Cloudflare (quotas KV, isolats) : elles expliquent
   POURQUOI le code est fait ainsi, elles ne décrivent plus où il tourne.

   Les secrets ne sont JAMAIS dans ce fichier : ils vivent dans backend/.env,
   jamais commité. Ce code peut donc rester public sans risque.

   Voir backend/README.md pour le déploiement.
   ============================================================================ */

import { readFileSync } from 'node:fs';

const DISCORD = 'https://discord.com/api/v10';

/* La version du serveur EN LIGNE.
   ---------------------------------------------------------------------------
   Elle existe pour une seule raison, apprise à la dure : un correctif serveur
   qui n'a pas été redéployé se comporte exactement comme un correctif qui ne
   marche pas. On a cherché un bogue dans du code juste, pendant que l'ancien
   tournait toujours.

   /api/version répond sans authentification et ne divulgue rien : un numéro,
   et la liste des routes que CETTE version connaît. Avant de conclure qu'une
   correction serveur n'a rien changé, on la lit.

   Le numéro vient de package.json — UNE seule source. Il fut un temps où
   package.json disait 2.0.0 pendant que cette route répondait 1.47.0 : deux
   compteurs, dont un que personne ne lisait. Pour livrer une version, on
   change le champ « version » de backend/package.json, et rien d'autre.

   version.json, à la racine du dépôt, numérote le SITE (le panel servi au
   navigateur) : c'est un autre objet, avec son propre rythme, et il n'a pas
   à être égal à celui-ci.

   Les bancs d'essai recopient ce fichier dans backend/, à côté de
   package.json — d'où le second chemin essayé. */
function lireVersionPaquet() {
  for (const rel of ['../package.json', './package.json']) {
    try {
      const v = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')).version;
      if (v) return String(v);
    } catch (e) { /* on essaie l'autre chemin */ }
  }
  return '0.0.0-inconnue';
}
const VERSION = lireVersionPaquet();
const SESSION_TTL = 60 * 60 * 24 * 7;   // 7 jours
const STATE_TTL   = 600;                // 10 minutes

/* ---------------------------------------------------------------------------
   Utilitaires
   --------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   LES ORIGINES AUTORISÉES — plusieurs, le temps d'un déménagement
   --------------------------------------------------------------------------
   Une seule origine était déduite de SITE_URL. Ça marche tant que le panel ne
   bouge pas, mais ça pose un piège au moment d'un changement d'adresse : à la
   seconde où SITE_URL change, l'ANCIENNE adresse cesse d'être autorisée et
   tout le monde qui l'a encore ouverte se retrouve devant un panel qui ne
   charge plus rien — sans message clair, parce qu'un refus CORS ne dit jamais
   pourquoi. Et l'inverse est vrai si on déploie avant que le DNS ne réponde.

   SITE_URLS lève ce piège : on autorise l'ancienne ET la nouvelle pendant la
   migration, on retire l'ancienne quand tout le monde est passé. SITE_URL
   reste l'adresse PRINCIPALE — celle vers laquelle on renvoie après une
   connexion —, les autres ne servent qu'à autoriser l'appel.
   -------------------------------------------------------------------------- */
function originesAutorisees(env) {
  const brut = [env.SITE_URL, ...String(env.SITE_URLS || '').split(',')];
  const out = [];
  for (const u of brut) {
    const t = String(u || '').trim();
    if (!t) continue;
    try { out.push(new URL(t).origin); } catch (e) { /* entrée illisible : ignorée */ }
  }
  return [...new Set(out)];
}

/* On renvoie l'origine DEMANDÉE quand elle est dans la liste, pas la liste
   entière : l'en-tête CORS n'accepte qu'une seule valeur, et renvoyer autre
   chose que l'origine de l'appelant revient à ne rien autoriser du tout. */
function allowedOrigin(env, request) {
  const liste = originesAutorisees(env);
  const demandee = request && request.headers ? request.headers.get('Origin') : null;
  if (demandee && liste.includes(demandee)) return demandee;
  return liste[0] || '*';
}

/* --------------------------------------------------------------------------
   Poser la bonne origine sur la réponse, au tout dernier moment
   --------------------------------------------------------------------------
   json() est appelé à plus de cent endroits, sans la requête sous la main.
   Plutôt que de la faire passer partout — cent occasions de se tromper — on
   corrige l'en-tête UNE fois, à la sortie, là où la requête est forcément
   connue.

   Une variable de module qui retiendrait « l'origine en cours » serait plus
   courte et FAUSSE : le serveur traite plusieurs requêtes en parallèle dans
   le même processus, et deux appels qui s'entrelacent sur un await se voleraient
   leur origine. Le bug ne se verrait qu'en charge, donc jamais en test.
   -------------------------------------------------------------------------- */
function ajusterCors(reponse, request, env) {
  const bonne = allowedOrigin(env, request);
  const actuelle = reponse.headers.get('Access-Control-Allow-Origin');
  if (!actuelle || actuelle === bonne) return reponse;
  /* Les en-têtes d'une Response sont figés : on en refait une. Le corps est
     transmis tel quel, sans être relu — pas de copie en mémoire. */
  const h = new Headers(reponse.headers);
  h.set('Access-Control-Allow-Origin', bonne);
  h.set('Vary', 'Origin');
  return new Response(reponse.body, { status: reponse.status, headers: h });
}

function corsHeaders(env, request) {
  const origine = allowedOrigin(env, request);
  const h = {
    'Access-Control-Allow-Origin': origine,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Max-Age': '86400',
    /* Vary: Origin est OBLIGATOIRE dès qu'on répond selon l'appelant. Sans
       lui, un cache placé devant servirait à l'un la réponse taillée pour
       l'autre, et l'accès casserait de façon parfaitement aléatoire. */
    'Vary': 'Origin',
  };
  /* Nécessaire pour que le navigateur accepte d'envoyer/lire le cookie de
     session sur un appel credentials:'include' — seulement si le site est
     un jour servi depuis une origine différente de l'API. Jamais avec '*' :
     la combinaison est invalide et le navigateur rejette purement et
     simplement la réponse d'un appel avec identifiants. */
  if (origine !== '*') h['Access-Control-Allow-Credentials'] = 'true';
  return h;
}

function json(env, data, status = 200, entetesSupp) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env), ...(entetesSupp || {}) },
  });
}

/* Page d'erreur lisible (le membre arrive ici depuis Discord, pas en fetch) */
/* `statut` par défaut à 403 : c'était la seule valeur possible avant, et
   toutes les pages d'erreur existantes doivent continuer de la rendre.
   Il devient réglable pour une raison précise : « FolkOS ne répond pas »
   n'est PAS un refus. Un 403 dit « vos identifiants sont mauvais, cessez
   d'insister », là où il faudrait dire « réessayez plus tard ». La nuance
   compte le jour où quelqu'un surveille ces codes. */
function errorPage(title, message, env, statut = 403) {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    background:linear-gradient(165deg,#12110E,#1C1B18 55%,#242019);
    font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#EDE3CF;}
  .box{max-width:440px;background:rgba(46,42,35,.92);border:1px solid #3D372C;border-radius:18px;
    padding:38px 34px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.55);}
  .crest{width:56px;height:56px;border-radius:14px;border:1px solid #C9A961;margin:0 auto 22px;
    display:flex;align-items:center;justify-content:center;color:#C9A961;font-weight:600;font-size:19px;}
  h1{font-size:21px;margin:0 0 12px;}
  p{font-size:14px;line-height:1.7;color:#9C9384;margin:0 0 26px;}
  a{display:inline-block;background:#C9A961;color:#1C1B18;text-decoration:none;padding:12px 24px;
    border-radius:999px;font-size:14px;font-weight:600;}
</style></head><body><div class="box">
  <div class="crest">MV</div><h1>${title}</h1><p>${message}</p>
  <a href="${env.SITE_URL}">Retour au site</a>
</div></body></html>`;
  return new Response(html, { status: statut, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* ---------------------------------------------------------------------------
   Cache en mémoire vive — et pas en base
   ---------------------------------------------------------------------------
   Un cache de quelques dizaines de secondes (les rôles d'un membre, la liste
   des rôles du serveur) n'a aucun besoin d'être durable : il vit dans la
   mémoire du processus et ne coûte rien. Il disparaît au redémarrage, et
   chaque instance a le sien : au pire on réinterroge Discord, ce qui est
   précisément ce que le cache évitait — jamais une erreur.

   (Historique : à l'époque Cloudflare, ces caches écrivaient dans KV, dont le
   plan gratuit plafonnait à 1 000 écritures par jour — le quota partait en
   fumée avant midi et bloquait toute écriture. C'est de là que vient ce
   choix.) */
const memoire = new Map();

function memGet(cle) {
  const e = memoire.get(cle);
  if (!e) return undefined;
  if (Date.now() > e.exp) { memoire.delete(cle); return undefined; }
  return e.val;
}

function memSet(cle, val, ttlSecondes) {
  /* Un isolat ne doit pas enfler indéfiniment : au-delà de 500 entrées on
     repart de zéro plutôt que de gérer une éviction fine. */
  if (memoire.size > 500) memoire.clear();
  memoire.set(cle, { val, exp: Date.now() + ttlSecondes * 1000 });
}

/* ---------------------------------------------------------------------------
   Une file d'attente par document — contre les enregistrements qui s'effacent
   ---------------------------------------------------------------------------
   Le document « data » se réécrit toujours de la même façon : on le LIT en
   entier, on remplace les collections envoyées, on le RÉÉCRIT en entier. Trois
   routes font ça (/api/data, /api/absence, /api/linterna) et rien ne les
   empêchait de se chevaucher.

   Le défaut, reproduit en essai : deux enregistrements lancés en même temps sur
   des pages DIFFÉRENTES — le registre RH d'un côté, les clients de l'autre.
   Les deux lisent la même version d'avant, chacun y pose sa collection, et le
   second écrase le premier. Le panel affiche « Enregistré ✓ » aux deux
   personnes, et le travail de l'une a disparu. Le numéro de révision, lui, ne
   montait que d'un cran au lieu de deux : même les autres navigateurs ne
   voyaient pas qu'il s'était passé quelque chose.

   La file ci-dessous fait passer ces sections l'une après l'autre — dans CE
   processus. Longtemps, c'était toute la protection : deux conteneurs, ou
   deux `node src/server.js` sur la même base, avaient chacun leur file et
   ne se voyaient pas ; la garantie tombait sans qu'aucun message ne le dise.

   Depuis la 1.48.0, la garantie est portée par la BASE : quand env.DB expose
   verrou() (src/db.js), la section s'exécute sous un verrou nommé GET_LOCK,
   que MariaDB n'accorde qu'à une connexion à la fois quel que soit le
   processus. Plusieurs instances derrière un répartiteur sont donc
   possibles — voir backend/README.md, « Plusieurs instances ».

   La file en mémoire reste devant, et ce n'est pas une survivance : chaque
   attente sur GET_LOCK immobilise une connexion. Sans la file, dix requêtes
   d'un même processus sur le même document en occuperaient dix, pour rien.
   Avec elle, un processus n'en attend jamais qu'une par document.

   Les bancs d'essai, dont la fausse base n'a pas de verrou(), retombent sur
   la file seule — c'est le comportement d'avant, à l'identique.
   --------------------------------------------------------------------------- */
const verrous = new Map();

function verrou(env, nom, action, opts) {
  const precedent = verrous.get(nom) || Promise.resolve();
  let liberer;
  const mien = new Promise(r => { liberer = r; });
  /* La file suivante attend MON tour, qu'il se termine bien ou mal. */
  verrous.set(nom, precedent.then(() => mien, () => mien));
  const enBase = !!(env && env.DB && typeof env.DB.verrou === 'function');
  return precedent
    .catch(() => {})
    .then(() => (enBase ? env.DB.verrou(nom, action, opts) : action()))
    .finally(() => liberer());
}

/* ---------------------------------------------------------------------------
   La base — D1 (SQLite) derrière la façade de toujours
   ---------------------------------------------------------------------------
   Tout le fichier continue d'écrire base(env).get / .put / .delete / .list,
   mot pour mot comme avant. Seules ces quelques lignes savent qu'il y a du SQL
   derrière : si le stockage change encore un jour, il n'y aura qu'ici à
   toucher, et pas dans les vingt routes du dessus.

   Pourquoi ce déménagement : KV comptait 1 000 écritures par jour sur le plan
   gratuit — de quoi tenir une demi-journée de travail à une personne. D1 en
   compte 100 000, gratuitement lui aussi, et lit tout aussi vite.

   Les images et PDF déposés depuis le panel ne transitent plus par ici du
   tout : voir handleUpload plus bas, qui les envoie directement au service
   de stockage de l'opérateur FlashbackFA. */

/* Le préfixe d'un listing est comparé avec LIKE, où % et _ sont des
   caractères spéciaux. Aucune de nos clés n'en contient, mais une échappe
   coûte trois lignes et évite une surprise le jour où l'une en contiendra. */
function echapperLike(x) {
  return String(x).replace(/[\\%_]/g, c => '\\' + c);
}

/* SUM()/AVG() rendent un DECIMAL, que le pilote mysql2 livre en TEXTE pour ne
   pas perdre de précision — D1 (SQLite) rendait un nombre, et c'est cette
   différence qui a produit une fois « 0 + "100" + "10" = 0100010 » sur la
   page Quota (voir handleQuota plus bas). Posée ici, au niveau du fichier,
   plutôt que réécrite dans chaque route qui agrège : ce fichier n'a qu'une
   seule dépendance (aucune, justement — voir l'en-tête), donc pas question
   d'aller la chercher dans db.js ; mais rien n'empêche de la partager ENTRE
   les routes d'ici. Le prochain SUM()/AVG() ajouté ailleurs doit s'en servir
   plutôt que de retomber dans le même piège. */
function nombreSQL(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function base(env) {
  if (!env.DB) throw new Error('La base de données n\'est pas reliée (vérifiez DB_HOST/DB_USER/DB_PASSWORD/DB_NAME dans .env).');

  return {
    async get(cle, type) {
      const r = await env.DB
        .prepare('SELECT val FROM kv WHERE cle = ? AND (exp IS NULL OR exp > ?)')
        .bind(cle, Date.now()).first();
      if (!r) return null;
      if (type !== 'json') return r.val;
      try { return JSON.parse(r.val); } catch (e) { return null; }
    },

    async put(cle, val, opts) {
      const exp = (opts && opts.expirationTtl)
        ? Date.now() + opts.expirationTtl * 1000
        : null;
      const texte = typeof val === 'string' ? val : JSON.stringify(val);
      await env.DB.prepare(
        'INSERT INTO kv (cle, val, exp) VALUES (?, ?, ?) ' +
        'ON DUPLICATE KEY UPDATE val = VALUES(val), exp = VALUES(exp)'
      ).bind(cle, texte, exp).run();
    },

    async delete(cle) {
      await env.DB.prepare('DELETE FROM kv WHERE cle = ?').bind(cle).run();
    },

    /* Écrire SEULEMENT si la valeur est restée celle qu'on a lue.
       -----------------------------------------------------------------------
       C'est le « compare-and-swap » : la comparaison et l'écriture se font
       dans UNE SEULE instruction SQL, donc la base les rend indivisibles. Deux
       requêtes qui partent du même état ne peuvent pas gagner toutes les deux
       — la seconde voit `affectedRows = 0` et sait qu'elle a perdu.

       Pourquoi il fallait ça, alors que verrou() existe déjà : verrou() est
       une Map JavaScript. Elle ne vaut que pour LE processus qui l'exécute.
       Deux conteneurs derrière un répartiteur, ou simplement deux `node
       src/server.js` sur la même base, ont chacun leur Map et ne se voient
       pas — le verrou donne alors une impression de protection qu'il n'offre
       pas. La base, elle, est commune à tous : c'est le seul endroit où un
       arbitrage tient quel que soit le nombre d'instances.

       Rend true si on a gagné, false sinon. `attendu` à null veut dire « la
       clé ne doit pas encore exister » : INSERT IGNORE ne crée la ligne que
       si personne ne l'a devancée. */
    async casValeur(cle, attendu, nouveau, opts) {
      const texte = typeof nouveau === 'string' ? nouveau : JSON.stringify(nouveau);

      if (attendu === null || attendu === undefined) {
        /* Une durée de vie, comme put() : la marque d'un rappel d'agenda se
           pose ainsi, et n'a pas à rester pour toujours. */
        const exp = (opts && opts.expirationTtl) ? Date.now() + opts.expirationTtl * 1000 : null;
        const r = await env.DB.prepare(
          'INSERT IGNORE INTO kv (cle, val, exp) VALUES (?, ?, ?)'
        ).bind(cle, texte, exp).run();
        return ((r && r.meta && r.meta.affectedRows) || 0) === 1;
      }

      /* Comparaison sur la valeur EXACTE relue juste avant — pas sur un champ
         extrait. Toute modification concurrente, quelle qu'elle soit, change
         la chaîne et fait échouer l'échange. */
      const r = await env.DB.prepare(
        'UPDATE kv SET val = ?, exp = NULL WHERE cle = ? AND val = ?'
      ).bind(texte, cle, attendu).run();
      return ((r && r.meta && r.meta.affectedRows) || 0) === 1;
    },

    async list(opts) {
      const prefixe = (opts && opts.prefix) || '';
      /* ⚠️ Le backslash est DOUBLÉ dans le SQL envoyé — « ESCAPE '\\' » et non
         « ESCAPE '\' ».
         ---------------------------------------------------------------------
         SQLite (l'ancienne base D1) prenait « '\' » pour un backslash tout
         simple. MariaDB/MySQL, non : dans une chaîne SQL, le backslash
         échappe le caractère suivant, donc « '\' » se lit « une apostrophe
         échappée » — la chaîne ne se referme jamais et le serveur répond
         « You have an error in your SQL syntax ». Résultat après la
         migration : cette requête échouait à TOUS les coups, et /api/presence
         — le seul appelant — renvoyait 500 à chaque changement de page.
         Le paramètre lié, lui, n'est pas concerné : echapperLike() y pose un
         vrai backslash, que ESCAPE reconnaît bien. */
      const r = await env.DB.prepare(
        "SELECT cle FROM kv WHERE cle LIKE ? ESCAPE '\\\\' AND (exp IS NULL OR exp > ?) ORDER BY cle"
      ).bind(echapperLike(prefixe) + '%', Date.now()).all();
      return { keys: (r.results || []).map(x => ({ name: x.cle })) };
    },

    /* Comme list(), mais ramène aussi la valeur de chaque clé en UNE seule
       requête — pour handlePresence, qui listait puis relisait chaque
       personne une par une (1+N requêtes à chaque battement de présence,
       toutes les 45 s pour chaque onglet ouvert). Les valeurs invalides en
       JSON sont écartées plutôt que de faire échouer tout l'appel. */
    async listValeurs(opts) {
      const prefixe = (opts && opts.prefix) || '';
      const r = await env.DB.prepare(
        "SELECT val FROM kv WHERE cle LIKE ? ESCAPE '\\\\' AND (exp IS NULL OR exp > ?) ORDER BY cle"
      ).bind(echapperLike(prefixe) + '%', Date.now()).all();
      return (r.results || []).reduce((acc, x) => {
        try { acc.push(JSON.parse(x.val)); } catch (e) { /* ligne écartée */ }
        return acc;
      }, []);
    },
  };
}

/* KV effaçait tout seul les clés périmées ; SQLite non. Les lectures les
   ignorent déjà (la condition sur exp), mais il faut bien qu'elles finissent
   par quitter la table. Un passage toutes les dix minutes par isolat suffit,
   et quand il n'y a rien à effacer la requête n'écrit aucune ligne — donc ne
   coûte rien au quota. */
async function menage(env) {
  if (memGet('menage')) return;
  memSet('menage', 1, 600);
  try {
    await env.DB.prepare('DELETE FROM kv WHERE exp IS NOT NULL AND exp <= ?')
      .bind(Date.now()).run();
  } catch (e) { /* le ménage n'est jamais urgent */ }
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

/* --------------------------------------------------------------------------
   Le jeton de session vit maintenant dans un cookie httpOnly, plus dans
   localStorage.
   ---------------------------------------------------------------------------
   Avant : le panel recevait le jeton en clair (URL, réponse JSON), le
   rangeait dans localStorage, et le recopiait dans l'en-tête Authorization
   à chaque appel. N'importe quel script tournant sur la page — une faille
   XSS oubliée n'importe où dans les 10 000 lignes de marlowe-actions.js —
   pouvait donc lire ce jeton et l'emporter. Un cookie posé avec HttpOnly
   n'est, lui, jamais lisible par JavaScript : seul le navigateur le voit,
   et il ne fait que le rejoindre automatiquement à chaque requête vers ce
   domaine.

   bearer()/jetonExplicite restent acceptés par currentSession() en plus du
   cookie — sans risque : le panel ne les alimente plus lui-même, ce sont
   des voies de secours pour un appelant qui ne serait pas un navigateur
   (script, test), pas des retours en arrière possibles pour une XSS. */
const COOKIE_SESSION = 'mv_session';

function cookieSid(request) {
  const brut = request.headers.get('Cookie') || '';
  for (const morceau of brut.split(';')) {
    const i = morceau.indexOf('=');
    if (i < 0) continue;
    if (morceau.slice(0, i).trim() === COOKIE_SESSION) {
      try { return decodeURIComponent(morceau.slice(i + 1).trim()) || null; }
      catch (e) { return null; }
    }
  }
  return null;
}

/* Secure est toujours posé : le site ne tourne qu'en HTTPS (voir Caddy dans
   backend/deploy/), et un cookie de session sans Secure survivrait à un
   détour accidentel par du HTTP en clair.

   SameSite=None, et pas Lax — c'est le point qui mérite d'être expliqué.
   Lax aurait été le choix par défaut, plus protecteur contre le CSRF : il
   retient le cookie sur une requête venue d'un autre site. Mais le panel
   est aussi affiché DANS une iframe tierce, l'ordinateur en jeu (voir la
   CSP frame-ancestors dans server.js — cfx-nui-external-iframe, nui://game).
   Pour le navigateur, ce contexte-là EST un site différent du nôtre, même
   si l'iframe pointe vers notre propre domaine : avec SameSite=Lax ou
   Strict, le cookie ne serait tout simplement jamais renvoyé une fois posé,
   et la connexion depuis le jeu échouerait en silence, sans le moindre
   message d'erreur pour le dire.

   Ce que ça coûte : un cookie SameSite=None est aussi renvoyé sur une
   requête déclenchée par un site tiers (CSRF). C'est exigerOrigine(), plus
   bas, qui ferme ce trou — et il le fallait : la version précédente de ce
   commentaire affirmait que « la plupart des routes attendent un corps JSON
   qu'un simple formulaire HTML ne sait pas produire ». C'EST FAUX, et c'est
   le genre d'erreur qui laisse une porte ouverte pendant des années :
     — request.json() ne REGARDE PAS le Content-Type. Un corps envoyé en
       text/plain est parsé comme du JSON sans broncher (vérifié sur Node) ;
     — un formulaire <form enctype="text/plain"> encode « nom=valeur ». En
       coupant un JSON en deux à l'endroit du « = » — nom de champ
       {"action":"creer","nom":"x","mdp":"secret12 et valeur "} — le corps
       reçu est un JSON parfaitement valide.
   Un formulaire hébergé n'importe où pouvait donc déclencher n'importe
   quelle route POST au nom de la victime connectée, sans préflight CORS
   (un formulaire n'en déclenche jamais) et sans avoir besoin de LIRE la
   réponse : la liste blanche CORS empêche de lire, pas d'agir. */
function entetesCookieSession(sid) {
  return { 'Set-Cookie':
    `${COOKIE_SESSION}=${encodeURIComponent(sid)}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=None` };
}

function entetesEffacerCookie() {
  return { 'Set-Cookie': `${COOKIE_SESSION}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None` };
}

/* --------------------------------------------------------------------------
   Le rempart anti-CSRF : d'où vient cette requête ?
   ---------------------------------------------------------------------------
   Depuis que la session vit dans un cookie SameSite=None (voir juste au-dessus
   pourquoi elle le doit — l'ordinateur en jeu), le navigateur joint ce cookie
   à TOUTE requête vers notre domaine, y compris celles déclenchées par un
   autre site. Sans le contrôle ci-dessous, une page piégée ouverte par un
   patron connecté pouvait créer un accès extérieur, déclarer une absence au
   nom de quelqu'un ou poster dans un salon Discord — en aveugle, mais avec
   tous ses droits.

   On s'appuie sur l'en-tête Origin, que le navigateur pose lui-même sur toute
   requête qui change quelque chose et qu'une page ne peut PAS falsifier
   (contrairement au Referer, qu'on peut faire disparaître).

   Trois cas, dans cet ordre :
   1. Pas d'Origin du tout → ce n'est pas un navigateur. Un banc d'essai, un
      script, le serveur de jeu : on laisse passer, sinon on casse tout ce qui
      appelle l'API sans navigateur. Ces appelants-là ne portent pas de cookie
      de session ambiant : il n'y a rien à détourner chez eux.
   2. Origin === l'adresse par laquelle la requête est arrivée → c'est notre
      propre panel. On compare à l'adresse RÉELLE plutôt qu'à SITE_URL : le
      site répond sur deux domaines (voir deploy/Caddyfile.snippet), et un
      SITE_URL réglé sur l'autre aurait bloqué le panel légitime — une panne
      totale et incompréhensible à la première requête d'enregistrement.
   3. Origin dans SITE_URLS → autorisé explicitement (le temps d'un
      déménagement de domaine, voir originesAutorisees plus haut).
   Tout le reste est refusé, « null » compris : une iframe en bac à sable
   envoie exactement ça, et c'est précisément un vecteur d'attaque.

   Les lectures (GET/HEAD) ne passent pas par ici : elles ne changent rien, et
   la liste blanche CORS empêche déjà un site tiers d'en LIRE la réponse. */
/* Où renvoyer le navigateur après une connexion réussie.
   ---------------------------------------------------------------------------
   Le cookie de session est posé par la réponse de /api/callback, donc sur
   l'hôte par lequel le navigateur est ARRIVÉ — un cookie est toujours rattaché
   à un hôte précis. Renvoyer ensuite vers SITE_URL en dur casse la connexion
   dès que les deux diffèrent : le cookie reste sur l'hôte A, la page s'ouvre
   sur l'hôte B, et l'utilisateur revient à l'écran de connexion sans le
   moindre message. Ce n'est pas théorique — deploy/Caddyfile.snippet sert
   DEUX domaines vers la même application (l'actuel et le futur), et
   .env.example pointe déjà sur le futur.
   On renvoie donc vers l'hôte réellement utilisé QUAND il est explicitement
   autorisé (SITE_URL/SITE_URLS) ; sinon on retombe sur SITE_URL. La condition
   n'est pas une formalité : url.origin se déduit de X-Forwarded-Host, qu'un
   proxy mal réglé laisserait choisir à l'appelant — sans cette liste blanche,
   on aurait fabriqué une redirection ouverte. */
function racineRetour(env, url) {
  const propre = String(env.SITE_URL || '').replace(/\/+$/, '');
  try {
    if (url && originesAutorisees(env).includes(url.origin)) return url.origin;
  } catch (e) { /* on retombe sur SITE_URL */ }
  return propre;
}

function exigerOrigine(request, url, env) {
  const methode = request.method;
  if (methode === 'GET' || methode === 'HEAD' || methode === 'OPTIONS') return true;

  const origine = request.headers.get('Origin');
  if (!origine) return true;                          /* appelant sans navigateur */

  /* On compare l'HÔTE, pas l'origine entière — et c'est délibéré.
     url.origin est reconstruit à partir de X-Forwarded-Proto (voir
     construireURL dans server.js), qui retombe sur « http » quand le proxy ne
     le transmet pas. Un panel servi en HTTPS enverrait alors « Origin:
     https://… » face à un url.origin en « http://… » : comparer les origines
     entières aurait refusé TOUTE écriture, sur toute l'application, pour un
     en-tête manquant dans une configuration de proxy. Panne totale et
     parfaitement incompréhensible.
     L'hôte suffit à prouver qu'on est chez nous, et un site tiers ne peut pas
     le falsifier : c'est le navigateur qui pose Origin, hors de portée d'une
     page. Une origine illisible — « null », qu'envoie une iframe en bac à
     sable — ne donne aucun hôte : refusée. */
  let hote = null;
  try { hote = new URL(origine).host; } catch (e) { return false; }
  if (hote && hote === url.host) return true;         /* notre propre panel */

  return originesAutorisees(env).includes(origine);
}

/* Le nom d'un rôle, ramené à sa forme comparable.
   ---------------------------------------------------------------------------
   PATRON_ROLES est tapé à la main dans backend/.env ; le nom du rôle, lui,
   vit sur Discord et s'écrit comme on veut. « Patron », « PATRON », « Patron
   👑 », « Co-Patron » contre « Co Patron » : quatre façons de désigner le même
   rôle, et une comparaison caractère par caractère n'en reconnaissait qu'une.
   Le patron du domaine se retrouvait alors sans les droits du patron, sans que
   rien ne dise pourquoi.

   On compare donc des formes normalisées — minuscules, sans accents, sans
   emoji ni ponctuation — mais toujours en ÉGALITÉ, jamais en « contient » :
   un rôle « Sous-Patron » ne doit pas ouvrir les portes du patron. */
function clefRole(nom) {
  /* \u26a0\ufe0f NFKD, pas NFD \u2014 voir clefNom() plus bas. Doit rester identique, au
     caract\u00e8re pr\u00e8s, \u00e0 clefRole() du panel : sinon le panel afficherait une
     chose et le serveur en d\u00e9ciderait une autre. */
  const base = String(nom || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const k = base.replace(/[^a-z0-9]+/g, ' ').trim();
  return k || base.replace(/\s+/g, ' ').trim();
}

function patronRoles(env) {
  return (env.PATRON_ROLES || 'Patron,Co-Patron').split(',').map(s => s.trim()).filter(Boolean);
}

function estRolePatron(env, nom) {
  const k = clefRole(nom);
  return !!k && patronRoles(env).some(r => clefRole(r) === k);
}

function ownerIds(env) {
  return (env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

/* ---------------------------------------------------------------------------
   Appels Discord côté bot
   --------------------------------------------------------------------------- */

async function botFetch(env, path) {
  const res = await fetch(DISCORD + path, {
    headers: { Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN },
  });
  return res;
}

/* Même chose en écriture. botFetch lit ; celle-ci poste, et rend le corps
   déjà décodé — les erreurs de Discord sont parlantes et on veut les garder
   pour les remonter au panel plutôt que d'afficher « échec » tout court. */
async function botPost(env, path, corps) {
  const res = await fetch(DISCORD + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bot ' + env.DISCORD_BOT_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(corps),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* 204, ou corps vide */ }
  return { ok: res.ok, status: res.status, data };
}

/* Tous les rôles du serveur : {id -> name}, plus la liste ordonnée. */
async function guildRoles(env) {
  const cached = memGet('roles');
  if (cached) return cached;

  const res = await botFetch(env, `/guilds/${env.DISCORD_GUILD_ID}/roles`);
  if (!res.ok) throw new Error('roles ' + res.status);
  const raw = await res.json();

  const list = raw
    .filter(r => r.name !== '@everyone')
    /* `managed` = rôle créé et tenu par une intégration : bots (carl-bot,
       Xenon, Ticket Tool…), Server Booster, abonnements. Jamais un rôle
       métier, donc on les écarte d'office. */
    .filter(r => !r.managed)
    .sort((a, b) => b.position - a.position)
    .map(r => ({ id: r.id, name: r.name }));

  const out = { list, byId: Object.fromEntries(list.map(r => [r.id, r.name])) };
  memSet('roles', out, 300);
  return out;
}

/* Rôles d'un membre. Renvoie null s'il n'est pas sur le serveur.

   Résultat gardé 60 secondes : le panel enregistre souvent, et interroger
   Discord à chaque requête finirait par heurter ses limites de débit — ce
   qui déconnecterait tout le monde. Un membre exclu du serveur ou dont les
   rôles changent perd donc ses accès dans la minute, pas dans la seconde. */
const MEMBER_TTL = 60;

async function memberRoles(env, userId) {
  const cacheKey = 'membre:' + userId;
  const cached = memGet(cacheKey);
  if (cached) return cached.gone ? null : cached;

  const res = await botFetch(env, `/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`);

  if (res.status === 404) {
    memSet(cacheKey, { gone: true }, MEMBER_TTL);
    return null;
  }
  if (!res.ok) throw new Error('member ' + res.status);

  const member = await res.json();
  const { byId } = await guildRoles(env);
  const out = {
    roles: (member.roles || []).map(id => byId[id]).filter(Boolean),
    nick: member.nick || null,
  };

  memSet(cacheKey, out, MEMBER_TTL);
  return out;
}

/* ---------------------------------------------------------------------------
   Routes
   --------------------------------------------------------------------------- */

/* L'état anti-CSRF de la connexion Discord
   ---------------------------------------------------------------------------
   Il servait à ça : on tirait un identifiant au hasard, on l'écrivait dans KV,
   et on vérifiait au retour qu'il s'y trouvait. Correct, mais une écriture KV
   à CHAQUE clic sur « se connecter » — et le quota gratuit est vite atteint.

   Même garantie sans rien écrire : l'état porte sa propre preuve. C'est un
   horodatage accompagné d'une signature HMAC calculée avec un secret que seul
   le serveur connaît. Personne ne peut en fabriquer un, et il périme tout
   seul au bout de dix minutes.

   Différence assumée : un état signé reste valable jusqu'à sa péremption, là
   où la version KV était à usage unique. Sur une fenêtre de dix minutes, pour
   une redirection que l'attaquant ne peut de toute façon pas fabriquer, c'est
   un échange raisonnable. */
async function cleEtat(env) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode('etat:' + env.DISCORD_CLIENT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

function b64url(x) {
  return b64(x).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signerEtat(env) {
  const corps = String(Date.now());
  const sig = await crypto.subtle.sign('HMAC', await cleEtat(env), new TextEncoder().encode(corps));
  return corps + '.' + b64url(sig);
}

async function verifierEtat(env, etat) {
  const pt = String(etat || '').indexOf('.');
  if (pt < 1) return false;
  const corps = etat.slice(0, pt);
  const donne = etat.slice(pt + 1);

  const age = Date.now() - Number(corps);
  if (!Number.isFinite(age) || age < -60000 || age > STATE_TTL * 1000) return false;

  const sig = await crypto.subtle.sign('HMAC', await cleEtat(env), new TextEncoder().encode(corps));
  const attendu = b64url(sig);

  /* Comparaison à temps constant : une comparaison ordinaire s'arrête au
     premier caractère qui diffère, et cette durée renseigne l'attaquant. */
  if (attendu.length !== donne.length) return false;
  let diff = 0;
  for (let i = 0; i < attendu.length; i++) diff |= attendu.charCodeAt(i) ^ donne.charCodeAt(i);
  return diff === 0;
}

/* GET /api/login → redirige vers Discord */
async function handleLogin(request, env, url) {
  const state = await signerEtat(env);

  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: url.origin + '/api/callback',
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return Response.redirect(`${DISCORD}/oauth2/authorize?${params}`, 302);
}

/* GET /api/callback → échange le code, vérifie l'appartenance, ouvre la session */
async function handleCallback(request, env, url) {
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return errorPage('Connexion incomplète', "Discord n'a pas renvoyé les informations attendues. Réessayez depuis le site.", env);
  }

  if (!(await verifierEtat(env, state))) {
    return errorPage('Lien expiré', "Cette demande de connexion a expiré. Relancez la connexion depuis le site.", env);
  }

  /* 1. le code contre un token */
  const tokenRes = await fetch(`${DISCORD}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type:    'authorization_code',
      code,
      redirect_uri:  url.origin + '/api/callback',
    }),
  });
  if (!tokenRes.ok) {
    return errorPage('Connexion refusée', "L'échange avec Discord a échoué. Réessayez dans un instant.", env);
  }
  const tok = await tokenRes.json();

  /* 2. qui est-ce */
  const meRes = await fetch(`${DISCORD}/users/@me`, {
    headers: { Authorization: 'Bearer ' + tok.access_token },
  });
  if (!meRes.ok) {
    return errorPage('Connexion refusée', "Impossible de lire votre profil Discord.", env);
  }
  const me = await meRes.json();

  /* 3. est-il sur le serveur du domaine */
  let member;
  try { member = await memberRoles(env, me.id); }
  catch (e) {
    return errorPage('Serveur injoignable', "Le domaine n'arrive pas à interroger Discord pour le moment. Réessayez plus tard.", env);
  }

  /* Les comptes listés dans OWNER_IDS gardent l'accès même hors du serveur :
     ce sont les développeurs du site, et ils doivent pouvoir intervenir sans
     dépendre de leur présence sur le Discord du domaine. La liste vit dans
     backend/.env, sur le serveur : personne ne peut s'y ajouter depuis le panel. */
  const proprietaire = ownerIds(env).includes(String(me.id));

  if (!member && !proprietaire) {
    return errorPage(
      'Accès réservé aux membres',
      "Votre compte Discord n'est pas membre du serveur du domaine. Rejoignez-le, puis reconnectez-vous.",
      env
    );
  }

  /* 4. session */
  const sid = crypto.randomUUID();
  await base(env).put('sess:' + sid, JSON.stringify({
    id:     me.id,
    name:   (member && member.nick) || me.global_name || me.username,
    avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null,
  }), { expirationTtl: SESSION_TTL });

  /* Le jeton ne part plus dans l'URL (#token=…) : il ne quitte jamais le
     serveur autrement que dans ce cookie httpOnly — ni dans l'historique du
     navigateur, ni visible par un script de la page. */
  const dest = racineRetour(env, url) + '/gestion.html';
  return new Response(null, { status: 302,
    headers: { Location: dest, ...entetesCookieSession(sid) } });
}

/* ==========================================================================
   GET /api/folkos?folkos_ticket=…  —  connexion par le SSO du serveur de jeu
   --------------------------------------------------------------------------
   Le joueur clique « Se connecter avec FolkOS » depuis le jeu. FolkOS le
   renvoie ici avec un TICKET à usage unique, valable environ 90 secondes.

   La règle absolue, et elle vient de leur documentation autant que du bon
   sens : ON NE FAIT JAMAIS CONFIANCE AU TICKET. Il arrive par l'URL, donc par
   le navigateur, donc de n'importe qui. On l'échange contre une identité
   auprès de FolkOS, serveur à serveur, avec notre secret — et c'est la
   RÉPONSE de FolkOS, elle seule, qui dit qui est là.

   Ce que cette route ne fait PAS, volontairement :

     · elle ne crée aucun compte. Un SSO dit « cette personne est bien
       untel » ; il ne dit pas « untel a le droit d'entrer au domaine ». Un
       joueur inconnu du registre est refusé, poliment. Sans cette règle,
       n'importe quel joueur du serveur entrerait dans le panel RH ;

     · elle ne décide d'aucun droit. Les permissions restent adossées aux
       RÔLES DISCORD, relus à chaque appel comme pour une connexion normale.
       C'est possible parce que la fiche du registre porte l'identifiant
       Discord de l'employé : le SSO nous donne QUI, le Discord donne QUOI.

   La session délivrée est exactement la même que par la voie Discord — même
   forme, même durée, même cookie httpOnly posé sur la redirection de retour.
   Une seule sorte de session à comprendre, et donc à sécuriser.
   ========================================================================== */

/* En mode tablette, le shell FolkOS repasse la dernière sous-page visitée
   dans `?next=`. On ne le suit QUE si c'est un chemin relatif : accepter une
   adresse absolue ouvrirait un open-redirect (n'importe qui pourrait forger
   un lien de connexion qui renvoie, une fois authentifié, vers un site tiers
   qui usurpe l'apparence du panel). On refuse aussi tout fragment : le nôtre
   (#token=...) est le seul que la page attend, un second l'écraserait. */
function cheminRelatifSur(valeur) {
  const s = String(valeur || '').trim();
  if (!s) return null;
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) return null;
  if (s.includes('://') || s.includes('#')) return null;
  return s;
}

async function handleFolkos(request, env, url) {
  for (const cle of ['FOLKOS_ID_BASE', 'FOLKOS_CLIENT_ID', 'FOLKOS_CLIENT_SECRET']) {
    if (!env[cle]) {
      return errorPage('Connexion FolkOS indisponible',
        `Le domaine n'a pas encore été configuré pour FolkOS (${cle} manquant). `
        + 'Prévenez le développeur du site.', env);
    }
  }

  const ticket = url.searchParams.get('folkos_ticket');
  if (!ticket) {
    return errorPage('Connexion refusée',
      "Aucun ticket n'a été transmis. Relancez la connexion depuis le jeu.", env);
  }

  /* L'échange. On borne le temps d'attente : un SSO qui ne répond pas doit
     donner une page lisible en quelques secondes, pas une roue qui tourne. */
  let data;
  try {
    const r = await fetch(String(env.FOLKOS_ID_BASE).replace(/\/+$/, '') + '/sso/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     env.FOLKOS_CLIENT_ID,
        client_secret: env.FOLKOS_CLIENT_SECRET,
        token:         ticket,
      }),
      signal: AbortSignal.timeout(8000),
    });
    data = await r.json().catch(() => null);
    if (!r.ok || !data || data.valid !== true || !data.identity) {
      return errorPage('Connexion refusée',
        "FolkOS n'a pas reconnu ce ticket. Ils ne sont valables qu'une minute et demie, "
        + 'et une seule fois : relancez la connexion depuis le jeu.', env);
    }
  } catch (e) {
    return errorPage('FolkOS injoignable',
      "Le service de connexion du serveur n'a pas répondu. Réessayez dans un instant, "
      + 'ou passez par la connexion Discord habituelle.', env, 502);
  }

  const identite = data.identity || {};
  /* unique_id est un ENTIER côté FolkOS. Notre registre ne manipule que du
     texte : on convertit ici, une fois, plutôt que de comparer un nombre à
     une chaîne quelque part plus bas — comparaison qui échoue en silence. */
  const discordId = identite.discord_id ? String(identite.discord_id) : '';
  const uniqueId  = (identite.unique_id === 0 || identite.unique_id)
    ? String(identite.unique_id) : '';

  /* On cherche la fiche. L'identifiant Discord d'abord : c'est le seul lien
     que le registre porte déjà, et c'est lui qui fera fonctionner les droits
     ensuite. `unique_id` sert de second recours pour le jour où le registre
     le stockera — la fiche peut le ranger dans son champ `uid`. */
  const donnees = await base(env).get('data', 'json') || {};
  const roster = Array.isArray(donnees.rhRoster) ? donnees.rhRoster : [];
  const fiche = roster.find(f => f && discordId && String(f.discord || '') === discordId)
    || (uniqueId ? roster.find(f => f && String(f.uid || '') === uniqueId) : null);

  const proprietaire = discordId && ownerIds(env).includes(discordId);

  if (!fiche && !proprietaire) {
    return errorPage('Accès réservé au personnel',
      "Votre compte est bien reconnu par le serveur, mais aucune fiche du domaine ne lui "
      + "correspond. Si vous venez d'être recruté, demandez aux ressources humaines "
      + "d'inscrire votre identifiant Discord sur votre fiche — c'est lui qui fait le lien.",
      env);
  }

  /* Sans identifiant Discord, on ne pourra relire aucun rôle : la personne
     entrerait sans aucun droit et ne comprendrait pas pourquoi. Mieux vaut le
     dire tout de suite, et nommer le remède. */
  if (!discordId) {
    return errorPage('Identifiant Discord manquant',
      "FolkOS ne nous transmet pas votre identifiant Discord, et c'est lui qui porte vos "
      + 'droits dans le panel. Passez par la connexion Discord habituelle.', env);
  }

  /* Le nom affiché : celui du registre s'il existe — c'est le nom RP que tout
     le panel utilise —, sinon celui que donne FolkOS. */
  const nom = (fiche && fiche.name)
    || [identite.given_name, identite.family_name].filter(Boolean).join(' ').trim()
    || identite.name || 'Employé';

  const sid = crypto.randomUUID();
  await base(env).put('sess:' + sid, JSON.stringify({
    id: discordId, name: nom, avatar: null, via: 'folkos',
  }), { expirationTtl: SESSION_TTL });

  const suite = cheminRelatifSur(url.searchParams.get('next')) || '/gestion.html';
  const dest = racineRetour(env, url) + suite;
  return new Response(null, { status: 302,
    headers: { Location: dest, ...entetesCookieSession(sid) } });
}

/* Lit la session — cookie httpOnly d'abord (voir entetesCookieSession plus
   haut), c'est la voie que prend le panel depuis un navigateur. bearer()
   et jetonExplicite (jeton dans le corps de la requête) restent acceptés
   en repli, pour un appelant qui ne serait pas un navigateur ; rôles
   rafraîchis à chaque appel dans tous les cas. */
async function currentSession(request, env, jetonExplicite) {
  const sid = cookieSid(request) || bearer(request) || jetonExplicite || null;
  if (!sid) return null;

  const stored = await base(env).get('sess:' + sid, 'json');
  if (!stored) return null;

  /* Session d'un accès extérieur : pas de Discord, donc pas de rôles. Les
     droits sont relus dans la fiche de l'accès à CHAQUE appel — révoquer un
     accès le coupe donc immédiatement, sans attendre l'expiration. */
  if (stored.invite) {
    const invites = await lireInvites(env);
    const inv = invites.find(x => x.code === stored.code);
    if (!inv || inv.actif === false) {
      await base(env).delete('sess:' + sid);
      return null;
    }
    return {
      user: { id: stored.id, name: inv.nom, avatar: null },
      roles: [],
      isOwner: false,
      isPatron: false,
      invite: { code: inv.code, pages: inv.pages || [], ro: inv.ro || [] },
    };
  }

  /* On revérifie l'appartenance : si le membre a quitté le Discord ou
     a changé de rôle, ça se voit immédiatement. */
  const member = await memberRoles(env, stored.id);
  const isOwner = ownerIds(env).includes(String(stored.id));

  /* Un membre parti du Discord perd sa session sur-le-champ. Un propriétaire
     n'a jamais eu besoin d'y être : il n'a simplement aucun rôle du domaine,
     et c'est isPatron qui lui ouvre tout. */
  if (!member && !isOwner) {
    await base(env).delete('sess:' + sid);
    return null;
  }

  const roles = member ? member.roles : [];

  /* D'OÙ VIENNENT LES DROITS — les quatre sources, et ce que chacune décide.
     -------------------------------------------------------------------------
     1. L'IDENTITÉ vient du cookie de session, et d'elle seule : `stored.id`
        est l'identifiant Discord posé à la connexion. Rien de ce que le
        navigateur envoie ensuite ne peut le changer.
     2. Les RÔLES sont relus chez Discord à CHAQUE requête (cache de
        MEMBER_TTL secondes, voir memberRoles). Ils ne sont jamais pris dans
        la session : un rôle retiré cesse donc de compter au plus tard une
        minute après, sans déconnexion ni action de personne. Un membre sorti
        du Discord perd sa session sur-le-champ, quelques lignes plus haut.
     3. `isPatron` se RECALCULE ici, à chaque appel, à partir de ces rôles et
        de OWNER_IDS (fichier .env). Il n'est PAS rangé dans la session : le
        poser dans le document de session ne servirait à rien, puisque cette
        ligne l'écrase. C'est ce qui rend impossible de se déclarer patron —
        ni par le corps d'une requête, ni en trafiquant une session.
     4. La MATRICE (canWrite) décide de tout le reste, page par page. Elle est
        relue en base à chaque requête, donc un droit retiré s'applique
        immédiatement, sans attendre le cache Discord.

     Conséquence à connaître : on ne peut pas se donner de droits, mais on
     peut s'en retirer. C'est pour ça que handlePermissions refuse un
     enregistrement qui priverait son auteur de la page « Accès & rôles »
     (voir le garde-fou « enfermement »). */
  return {
    user:  { id: stored.id, name: (member && member.nick) || stored.name, avatar: stored.avatar },
    roles,
    isOwner,
    isPatron: isOwner || roles.some(r => estRolePatron(env, r)),
  };
}

/* GET /api/me */
async function handleMe(request, env) {
  /* Une route de lecture ne doit pas répondre 200 à un DELETE : ça laisse
     croire à l'appelant qu'il vient de supprimer quelque chose. */
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json(env, { error: 'method_not_allowed' }, 405);
  }
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);
  /* Le panel a besoin de savoir s'il a affaire à un accès extérieur : il n'a
     ni rôles ni matrice, ses pages lui sont dictées ici.

     `isOwner` et `isPatron` sont RENVOYÉS, pas laissés à recalculer.
     -------------------------------------------------------------------------
     Le panel affichait « Accès permanent » et ouvrait son menu à partir d'une
     copie de OWNER_IDS écrite en dur dans marlowe-auth.js — un fichier que
     sert le site, donc lisible par n'importe quel visiteur. Deux défauts :
     le trousseau du développeur s'affichait en clair, et surtout le réglage
     vivait en DOUBLE. Changer OWNER_IDS dans le .env sans toucher au panel, et
     l'écran se mettait à contredire le serveur : menu fermé alors que les
     routes répondaient, ou l'inverse.

     Il n'y a plus qu'une source, ce .env, et le serveur publie sa conclusion
     plutôt que la liste qui y mène. L'identifiant du développeur ne quitte
     jamais la machine : la réponse ne contient qu'un booléen, et seulement
     pour la personne connectée.

     Ce n'est pas un droit d'accès pour autant — c'est de l'affichage. Les
     deux valeurs sont recalculées à chaque appel dans currentSession() et
     revérifiées à chaque route ; un panel qui mentirait n'ouvrirait que des
     écrans dont le contenu répondrait 403. */
  return json(env, {
    user: s.user, roles: s.roles, invite: s.invite || null,
    isOwner: !!s.isOwner, isPatron: !!s.isPatron,
  });
}

/* GET /api/roles */
async function handleRoles(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);
  const { list } = await guildRoles(env);
  return json(env, list.map(r => r.name));
}

/* La version courante de la matrice des droits.
   ---------------------------------------------------------------------------
   Rangée à part (`permsmeta`) et non dans la matrice elle-même : la matrice
   est recopiée telle quelle dans la réponse et relue page par page par le
   panel ; y glisser un numéro en ferait une pseudo-page à filtrer partout.

   Une installation qui tourne déjà n'a pas cette clé : elle vaut donc zéro, et
   le panel qui vient de lire la matrice renvoie zéro — le premier
   enregistrement après mise à jour passe sans rien demander à personne. Seul
   un onglet resté ouvert AVANT la mise à jour se fera refuser, ce qui est
   exactement le comportement voulu. */
/* Nettoyage d'une carte « page → rôles en lecture seule ». Même filtre que
   celui de handleSettings pour `permsRO` : des tableaux de chaînes, rien
   d'autre n'entre en base. Posé ici parce que les deux routes l'utilisent
   maintenant — la matrice écrit sa lecture seule avec elle. */
function pagesLectureSeule(brut) {
  const ro = {};
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return ro;
  for (const [page, roles] of Object.entries(brut)) {
    if (!Array.isArray(roles)) continue;
    ro[String(page).slice(0, 64)] = roles
      .filter(r => typeof r === 'string').map(r => r.slice(0, 100)).slice(0, 200);
  }
  return ro;
}

function analyserMetaPermissions(brut) {
  try {
    const m = JSON.parse(brut);
    if (m && typeof m.rev === 'number') return m;
  } catch (e) { /* valeur illisible : on repart de zéro */ }
  return { rev: 0, by: null, at: null };
}

async function metaPermissions(env) {
  return analyserMetaPermissions(await base(env).get('permsmeta'));
}

/* GET | PUT /api/permissions */
async function handlePermissions(request, env) {
  if (request.method === 'GET') {
    /* La lecture était ouverte à tout le monde : n'importe qui pouvait
       relever, sans compte, la liste des rôles du domaine et l'écran auquel
       chacun donne accès. Ce n'est pas un secret d'État, mais c'est la carte
       des portes du panel, et elle n'a rien à faire sur la voie publique.
       Le panel, lui, appelle toujours cette route avec son jeton. */
    const s = await currentSession(request, env);
    if (!s) return json(env, { error: 'unauthorized' }, 401);
    const perms = await base(env).get('permissions', 'json');
    /* `_meta` accompagne la matrice comme il accompagne déjà /api/data : c'est
       le numéro de version que le panel devra RENVOYER pour enregistrer (voir
       le PUT plus bas). Même convention de nom, pour qu'il n'y ait qu'une
       habitude à retenir dans ce fichier. */
    return json(env, Object.assign({}, perms || {}, { _meta: await metaPermissions(env) }));
  }

  if (request.method === 'PUT') {
    const s = await currentSession(request, env);
    if (!s) return json(env, { error: 'unauthorized' }, 401);

    /* Écrire la matrice, c'est décider de tous les droits — y compris les
       siens. Le droit de le faire se coche dans la matrice elle-même, page
       « Accès & rôles ». Le patron l'a toujours. */
    const reg0 = await base(env).get('settings', 'json') || {};
    const perms0 = await base(env).get('permissions', 'json') || {};
    if (!canWrite(s, 'acces', perms0, reg0.permsRO || {})) {
      return json(env, { error: 'forbidden' }, 403);
    }

    let body;
    try { body = await request.json(); }
    catch (e) { return json(env, { error: 'bad_json' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(env, { error: 'bad_shape' }, 400);
    }

    /* La version sur laquelle l'appelant a travaillé. Rangée dans le corps
       plutôt que dans un en-tête, comme `_log` l'est déjà pour /api/data :
       un en-tête personnalisé imposerait une requête préparatoire (OPTIONS)
       de plus, que ce fichier évite partout ailleurs. */
    const revEnvoyee = body._rev;
    delete body._rev;

    /* Les pages en lecture seule voyagent avec la matrice, et non plus par un
       second appel à /api/settings. Voir plus bas : séparées, un échec de la
       seconde écriture laissait des rôles en accès COMPLET alors qu'on venait
       de les passer en lecture seule. */
    const roEnvoye = (body._ro && typeof body._ro === 'object' && !Array.isArray(body._ro))
      ? body._ro : null;
    delete body._ro;

    /* On ne garde que des tableaux de chaînes — rien d'autre n'entre en base. */
    const clean = {};
    for (const [page, roles] of Object.entries(body)) {
      if (!Array.isArray(roles)) continue;
      clean[String(page).slice(0, 64)] = roles
        .filter(r => typeof r === 'string')
        .map(r => r.slice(0, 100))
        .slice(0, 200);
    }

    /* Contrôle de version, dans la file — et c'est la file qui le rend fiable.
       -------------------------------------------------------------------------
       Cette route REMPLACE la matrice entière : sans rien pour l'arbitrer, deux
       personnes qui ouvrent « Accès & rôles » en même temps s'écrasent l'une
       l'autre, la seconde enregistrée effaçant en silence le travail de la
       première. Les deux voient « enregistré ». C'est le même défaut qu'E4 sur
       le document `data`, mais un verrou seul n'y aurait rien changé : deux
       remplacements complets sérialisés donnent le même résultat qu'en
       parallèle. Il fallait comparer les VERSIONS, pas sérialiser les écritures.

       La comparaison et l'écriture doivent être indivisibles, sinon deux
       requêtes peuvent lire le même numéro avant que l'une n'écrive : d'où le
       verrou AUTOUR des deux. Comme pour E4, la garantie vaut pour ce
       processus — le montage prévu n'en fait tourner qu'un (voir verrou()).

       Aucune fusion automatique, aucun écrasement forcé : en cas de conflit on
       ne touche à rien et on rend 409 avec le numéro courant, qui a enregistré
       et quand. C'est au panel de proposer à la personne de recharger — ses
       modifications non enregistrées lui appartiennent. */
    /* Garde-fou : ne pas se retirer soi-même la clé de la pièce.
       -----------------------------------------------------------------------
       Cette route remplace la matrice ENTIÈRE. Rien n'empêchait donc quelqu'un
       de s'enlever, d'un enregistrement, le droit d'y revenir — en décochant
       son propre rôle sur « Paramètres », ou en le passant en lecture seule.
       Ce n'est pas une élévation de privilège : c'est l'inverse, et c'est
       précisément ce qui le rend dangereux. Personne ne s'en aperçoit avant
       d'essayer de rouvrir la page, et il est alors trop tard.

       Qui garde la main quoi qu'il arrive : un PATRON (rôle Discord listé dans
       PATRON_ROLES) et un propriétaire (OWNER_IDS). Ni l'un ni l'autre ne se
       décide dans la matrice — ils viennent du .env et de Discord —, donc eux
       ne peuvent pas s'enfermer et n'ont pas besoin de ce contrôle. Pour tous
       les autres, on refuse l'enregistrement qui les mettrait dehors, en
       disant comment faire s'ils le voulaient vraiment. */
    if (!s.isPatron) {
      const roApres = roEnvoye ? pagesLectureSeule(roEnvoye) : (reg0.permsRO || {});
      const gardeLaMain = (COLLECTION_PAGES.acces || []).some(page =>
        (clean[page] || []).some(r => s.roles.includes(r))
        && !(roApres[page] || []).some(r => s.roles.includes(r)));

      if (!gardeLaMain) {
        return json(env, { error: 'enfermement', detail:
          "Cet enregistrement vous retirerait l'accès à la page « Accès & rôles » — vous ne "
          + "pourriez plus y revenir, ni défaire ce que vous venez de faire. Gardez au moins "
          + "un de vos rôles coché en accès complet sur cette page. Si vous voulez vraiment "
          + "passer la main, demandez à un patron de le faire : lui garde l'accès quoi qu'il "
          + "arrive." }, 400);
      }
    }

    const conflit = (meta) => json(env, {
      error: 'conflit',
      detail: revEnvoyee === undefined
        ? "Cet onglet a été ouvert avant la dernière mise à jour de la matrice."
        : "La matrice a été modifiée depuis l'ouverture de cet onglet.",
      rev: meta.rev, by: meta.by || null, at: meta.at || null,
    }, 409);

    /* verrou() reste, mais il ne PROUVE rien : il évite seulement que deux
       requêtes du même processus se marchent dessus pour rien. La garantie,
       c'est casValeur() — une seule instruction SQL qui compare et écrit, donc
       arbitrée par la BASE, commune à toutes les instances. */
    return verrou(env, 'permissions', async () => {
      const brut = await base(env).get('permsmeta');
      const meta = analyserMetaPermissions(brut);

      if (typeof revEnvoyee !== 'number' || revEnvoyee !== meta.rev) return conflit(meta);

      /* On prend le tour d'écriture AVANT de toucher quoi que ce soit : si un
         autre processus a avancé entre la lecture et ici, l'échange échoue et
         personne n'a rien écrasé. */
      const suivante = { rev: meta.rev + 1, by: s.user.name, at: new Date().toISOString() };
      const gagne = await base(env).casValeur('permsmeta', brut, JSON.stringify(suivante));
      if (!gagne) return conflit(await metaPermissions(env));

      /* ORDRE DÉLIBÉRÉ : les pages en lecture seule d'abord, la matrice
         ensuite.
         ---------------------------------------------------------------------
         Les deux écritures ne peuvent pas être une seule transaction : elles
         portent sur deux documents distincts, dont l'un (`settings`) contient
         bien d'autres réglages qu'il faut relire et préserver. On choisit donc
         l'ordre dont la MOITIÉ est inoffensive. Si la seconde échoue, il reste
         des pages marquées « lecture seule » pour une matrice inchangée :
         c'est plus restrictif que prévu, donc sans danger. Dans l'autre sens,
         une matrice élargie sans ses restrictions donnerait l'accès COMPLET à
         des rôles qu'on venait de passer en lecture seule.
         Et dans tous les cas, la réponse dit exactement ce qui est passé et ce
         qui ne l'est pas : personne ne doit croire « enregistré » à moitié. */
      const enregistre = [], echoue = [];
      let detailEchec = null;

      if (roEnvoye) {
        try {
          await verrou(env, 'settings', async () => {
            const reg = await base(env).get('settings', 'json') || {};
            reg.permsRO = pagesLectureSeule(roEnvoye);
            await base(env).put('settings', JSON.stringify(reg));
          });
          enregistre.push('permsRO');
        } catch (e) {
          echoue.push('permsRO');
          detailEchec = String((e && e.message) || e);
        }
      }

      /* La lecture seule a échoué : on n'élargit pas la matrice par-dessus. */
      if (echoue.length) {
        echoue.push('permissions');
        return json(env, {
          ok: false, enregistre, echoue, detail:
            "Les pages en lecture seule n'ont pas pu être enregistrées ; la matrice n'a donc "
            + "pas été modifiée non plus, pour ne pas ouvrir des accès qu'on venait de "
            + "restreindre. Rechargez la page et recommencez. Détail : " + detailEchec,
          _meta: suivante,
        }, 200);
      }

      try {
        await base(env).put('permissions', JSON.stringify(clean));
        enregistre.push('permissions');
      } catch (e) {
        echoue.push('permissions');
        return json(env, {
          ok: false, enregistre, echoue, detail:
            "La matrice n'a pas pu être enregistrée. Les pages en lecture seule, elles, "
            + "l'ont été : l'accès est donc plus restreint que prévu, jamais plus large. "
            + "Rechargez la page pour voir l'état réel. Détail : " + String((e && e.message) || e),
          _meta: suivante,
        }, 200);
      }

      return json(env, Object.assign({}, clean, { _meta: suivante, ok: true, enregistre }));
    });
  }

  return json(env, { error: 'method_not_allowed' }, 405);
}

/* ---------------------------------------------------------------------------
   Droits d'écriture
   ---------------------------------------------------------------------------
   Chaque collection appartient à une ou plusieurs pages. Écrire dedans exige
   d'avoir accès à l'une d'elles ET de ne pas y être en lecture seule.

   Sans ce contrôle, n'importe quel membre du Discord pourrait modifier
   n'importe quoi en appelant l'API directement — le menu masqué dans le
   navigateur n'arrête personne.
   --------------------------------------------------------------------------- */
const COLLECTION_PAGES = {
  rhRoster:        ['rhemployes'],
  rhDeparts:       ['rhemployes', 'rhrecrutement'],
  rhRecruiters:    ['rhrecrutement'],
  rhAbsences:      ['rhrecrutement'],
  avertissements:  ['rhemployes'],
  blacklist:       ['blacklist'],
  historique:      ['facturation'],
  clients:         ['facturation'],
  articles:        ['facturation'],
  catalogueSlides: ['catalogue'],
  facturesRecues:  ['facturesrecues'],
  depenses:        ['bilan'],
  retraits:        ['bilan'],
  bilanConfig:     ['bilan'],
  bcManuels:       ['bilan'],
  effectif:        ['eligibilite', 'statseffectif'],
  dash:            ['statsdash'],
  clotures:        ['statsprimes', 'cloture'],
  clotureSteps:    ['cloture'],
  primesExc:       ['statsprimes'],
  /* Les deux pages écrivent dans la même collection : l'agenda commercial
     n'est pas une autre donnée, c'est le même agenda trié autrement. */
  agenda:          ['agenda', 'agendacom'],
  /* La récolte se déclare par /api/linterna, jamais depuis le navigateur : la
     seule écriture directe est la remise à zéro de la clôture du lundi. Ouvrir
     cette collection à la page Linterna reviendrait à laisser chacun réécrire
     la récolte de toute l'équipe. */
  linterna:        ['cloture'],
  /* Le kit d'entretien MANQUAIT à cette table. Conséquence, vérifiée en
     essai : canWrite() refuse toute collection qu'elle ne connaît pas, donc
     un RH à qui la page « Kit d'entretien » était pourtant cochée recevait
     403 en enregistrant — seul le patron y arrivait, sans que rien n'explique
     pourquoi. La page « Documents » n'est pas listée ici volontairement :
     c'est l'écran de CONSULTATION du kit (voir marlowe-data.js), il ne doit
     pas donner le droit d'écrire. */
  entretien:       ['entretien'],
  serviceHistory:  ['masemaine'],
  tombola:         ['tombola'],
  commandes:       ['magcommandes', 'magrecap'],
  comRunner:       ['comrunner'],
  stock:           ['magstock', 'magcommandes'],
  /* Les écrans d'Administration. Ils étaient fermés en dur (liste vide =
     patron seulement) ; ils sont maintenant délégables comme le reste, et
     c'est la matrice qui décide. Rien n'y est ouvert par défaut : une page
     absente de la matrice reste fermée à tous sauf au patron. */
  vitrine:         ['paramvitrine'],
  reglages:        ['paramregles'],
  /* Collections sans données propres : elles nomment un droit, pour que
     canWrite() puisse répondre sur ces routes-là aussi. */
  acces:           ['parametres'],
  invitesGestion:  ['paraminvites'],
  agendaVis:       ['paramagenda'],
  dispoRoles:      ['paramdispo'],
};

/* Les écrans d'Administration. Ils se délèguent à des RÔLES DISCORD, jamais à
   un accès extérieur : un code d'accès donné à un comptable ne doit pas
   pouvoir devenir, d'une case mal cochée, le droit de réécrire la matrice et
   de s'ouvrir le panel entier. La liste est en dur ici pour que la règle ne
   dépende d'aucun réglage. */
const PAGES_ADMIN = new Set([
  'parametres', 'paramagenda', 'paramdispo', 'paramvitrine',
  'paramregles', 'paraminvites', 'paramdonnees',
]);

/* Les collections qui portent des données PERSONNELLES.
   ---------------------------------------------------------------------------
   Ce sont celles que handleOrga énumère déjà comme ne devant jamais sortir du
   panel : « numéro civil, téléphone, RIB, Discord, recruteur, dates, motifs
   d'absence » — plus les sanctions et la blacklist, qui nomment des gens.
   Toute nouvelle collection contenant l'identité de quelqu'un a sa place ici. */
const COLLECTIONS_PERSONNELLES = new Set([
  'rhRoster', 'rhDeparts', 'rhAbsences', 'rhRecruiters', 'avertissements', 'blacklist',
]);

/* Ce qu'un ACCÈS EXTÉRIEUR a le droit de LIRE dans /api/data.
   ---------------------------------------------------------------------------
   Le contrôle d'écriture existait déjà (canWrite) ; la lecture, non : /api/data
   rendait le document ENTIER à toute session valable, accès extérieur compris.
   Un comptable à qui on n'avait coché que « Facturation » recevait donc aussi
   le registre RH complet — numéros civils, téléphones, RIB, identifiants
   Discord — dès qu'il ouvrait le panel. Le navigateur n'en affichait rien,
   mais la réponse du serveur les contenait, lisibles dans l'onglet Réseau.

   Un membre du Discord, lui, garde tout : c'est un outil d'équipe, et c'est la
   règle métier existante (voir le commentaire de handleData). On ne restreint
   QUE les accès extérieurs, qui sont par définition des tiers.

   Pourquoi ne filtrer QUE les collections personnelles, et pas tout le
   document : COLLECTION_PAGES dit qui a le droit d'ÉCRIRE une collection, pas
   qui a le droit de la LIRE. Neuf pages du panel sont des écrans de
   consultation qui n'y figurent pas — Documents, Historique, Vue d'ensemble,
   Grades & quotas… — et qui lisent des collections rangées sous une autre
   page. S'en servir comme liste blanche de lecture viderait ces pages-là chez
   un partenaire pourtant autorisé à les voir. On ferme donc précisément ce qui
   fuit — l'identité des gens — sans casser le reste.
   (Une liste blanche de lecture complète serait plus stricte : elle demande
   d'établir la carte page → collections en lecture, qui n'existe pas encore.
   C'est noté dans AUDIT.md comme suite à donner.) */
function collectionsLisibles(session) {
  if (!session.invite) return null;   /* null = aucune restriction */

  const pages = session.invite.pages || [];
  const refusees = new Set();
  for (const collection of COLLECTIONS_PERSONNELLES) {
    const sesPages = COLLECTION_PAGES[collection] || [];
    const autorise = sesPages.some(p => !PAGES_ADMIN.has(p) && pages.includes(p));
    if (!autorise) refusees.add(collection);
  }
  return refusees;
}

function canWrite(session, collection, perms, ro) {
  if (session.isPatron) return true;

  /* Un accès extérieur ne passe pas par les rôles Discord : ses droits sont
     la liste de pages que le patron lui a cochée. */
  if (session.invite) {
    const pages = COLLECTION_PAGES[collection];
    if (!pages) return false;
    return pages.some(page => !PAGES_ADMIN.has(page)
                           && session.invite.pages.includes(page)
                           && !session.invite.ro.includes(page));
  }

  const pages = COLLECTION_PAGES[collection];
  if (!pages) return false;            /* collection inconnue : on refuse */

  return pages.some(page => {
    const autorise = (perms[page] || []).some(r => session.roles.includes(r));
    if (!autorise) return false;
    const lectureSeule = (ro[page] || []).some(r => session.roles.includes(r));
    return !lectureSeule;
  });
}

/* ---------------------------------------------------------------------------
   Journal des actions
   ---------------------------------------------------------------------------
   Qui a fait quoi, et quand. Sur un outil où chacun peut supprimer une ligne,
   c'est la seule façon de savoir ce qui s'est passé. Gardé en une seule liste
   plafonnée : au-delà, les plus anciennes entrées tombent.
   --------------------------------------------------------------------------- */
const JOURNAL_MAX = 500;

async function appendJournal(env, session, texte, keys) {
  /* Même lecture-modification-écriture que le document « data », donc même
     file d'attente : sans elle, deux actions simultanées se recouvraient et
     l'une des deux ne laissait aucune trace au journal. */
  return verrou(env, 'journal', async () => {
    const list = await base(env).get('journal', 'json') || [];
    list.unshift({
      at: new Date().toISOString(),
      by: session.user.name,
      id: session.user.id,
      texte,
      keys,
    });
    if (list.length > JOURNAL_MAX) list.length = JOURNAL_MAX;
    await base(env).put('journal', JSON.stringify(list));
  });
}

/* GET /api/journal */
async function handleJournal(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);

  /* Deuxième porte de service laissée ouverte par le filtre de /api/data : le
     journal nomme les gens dans presque chaque ligne (« X a rétrogradé Y »,
     « X a rappelé son permis à Y »), et n'importe quelle session valable le
     lisait en entier — 500 entrées d'activité RH nominative chez un accès
     extérieur qui n'avait qu'« Facturation ».
     Le journal n'est pas une collection de `data` : COLLECTION_PAGES ne peut
     pas l'arbitrer. Mais il a bien une page à lui dans le panel (« Journal »,
     id `journal`, voir PAGES dans marlowe-auth.js), et c'est elle qui fait
     foi — un accès extérieur à qui le patron l'a cochée continue de l'avoir,
     les autres ne l'ont plus. Un membre du Discord, lui, garde tout : c'est
     la même règle métier que partout ailleurs. */
  if (s.invite && !(s.invite.pages || []).includes('journal')) {
    return json(env, { error: 'forbidden' }, 403);
  }

  const list = await base(env).get('journal', 'json') || [];
  return json(env, list);
}

/* GET | POST /api/presence
   Qui d'autre est en train de travailler sur le panel. Chaque navigateur
   signale sa présence toutes les 45 secondes ; une entrée non renouvelée
   disparaît d'elle-même au bout de 100 secondes. */
const PRESENCE_TTL     = 720;   // 12 min : au-delà, le membre disparaît du listing
const PRESENCE_REAFFIRME = 300; // on ne réécrit la fiche qu'une fois toutes les 5 min

async function handlePresence(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);

  if (request.method === 'POST') {
    let page = '';
    try { page = String((await request.json()).page || '').slice(0, 40); } catch (e) {}

    /* Le battement arrive toutes les deux minutes, mais on n'écrit pas à
       chaque fois : une écriture KV est une ressource comptée, une lecture
       ne l'est presque pas. On ne réécrit que si la personne a changé de page
       ou si sa fiche approche de la péremption. Une personne qui reste sur le
       tableau de bord toute la journée coûte donc 288 écritures, pas 1 920. */
    const cle = 'pres:' + s.user.id;
    const avant = await base(env).get(cle, 'json');
    const vieille = !avant || (Date.now() - (avant.at || 0)) > PRESENCE_REAFFIRME * 1000;

    if (vieille || avant.page !== page || avant.name !== s.user.name) {
      await base(env).put(cle, JSON.stringify({
        id: s.user.id, name: s.user.name, avatar: s.user.avatar,
        page, at: Date.now(),
      }), { expirationTtl: PRESENCE_TTL });
    }
  }

  /* Troisième porte de service de la même famille que /api/data et
     /api/journal : « qui travaille en ce moment » livre l'identifiant Discord,
     le nom et la page ouverte de tout le personnel connecté. C'est une
     fonction d'ÉQUIPE ; un accès extérieur — comptable, partenaire — n'a pas
     à savoir qui est devant son écran ni ce qu'il consulte.
     On lui rend une liste vide plutôt qu'un 403 : son battement de présence
     continue d'être enregistré (le patron doit pouvoir voir qu'il est
     connecté), et son panel n'affiche simplement personne d'autre, sans
     tomber en erreur. */
  if (s.invite) return json(env, { membres: [], moi: s.user.id });

  const membres = await base(env).listValeurs({ prefix: 'pres:' });
  membres.sort((a, b) => a.name.localeCompare(b.name));
  return json(env, { membres, moi: s.user.id });
}

/* GET /api/orga  —  ROUTE PUBLIQUE
   La vitrine est un site public : elle ne peut pas se connecter avec un compte.
   Cette route lui donne donc le strict minimum pour dessiner l'organigramme —
   un prénom-nom et un poste, rien d'autre.

   Ce qui reste DANS le panel et ne sort jamais d'ici : numéro civil, téléphone,
   RIB, Discord, recruteur, dates, motifs d'absence. Une fiche RH complète ne
   doit jamais se retrouver sur une page ouverte à tout San Andreas. */
async function handleOrga(request, env) {
  if (request.method !== 'GET') return json(env, { error: 'method' }, 405);

  const d = await base(env).get('data', 'json') || {};
  const roster = Array.isArray(d.rhRoster) ? d.rhRoster : [];

  const membres = roster.slice(0, 400).map(e => ({
    nom:    String(e && e.name || '').slice(0, 60),
    poste:  String(e && e.poste || '').slice(0, 60),
    absent: (e && e.status) ? e.status !== 'actif' : false,
  })).filter(m => m.nom && m.poste);

  const m = await base(env).get('datameta', 'json');
  return json(env, { membres, rev: (m && m.rev) || 0 });
}

/* ---------------------------------------------------------------------------
   Images de la vitrine
   ---------------------------------------------------------------------------
   Le patron dépose ses visuels depuis le panel ; ils sont stockés ici et servis
   publiquement à la page d'accueil. Les fichiers sont déjà réduits par le
   navigateur avant l'envoi — ce plafond n'est qu'un garde-fou contre un envoi
   accidentel de 12 Mo.                                                       */

/* Deux plafonds distincts. Les images sont réduites par le navigateur avant
   l'envoi, donc 1,2 Mo est déjà large. Un PDF, lui, part tel quel : un
   catalogue de vingt pages fait couramment plusieurs mégaoctets, et le
   refuser à 1,2 Mo n'aurait aucun sens. */
const IMG_MAX   = 1200 * 1024;        // 1,2 Mo par image
const PDF_MAX   = 12 * 1024 * 1024;   // 12 Mo pour un catalogue complet
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EXT_PAR_TYPE = { 'image/jpeg':'.jpg', 'image/png':'.png', 'image/webp':'.webp', 'application/pdf':'.pdf' };

/* POST /api/upload  —  patron uniquement (ou facturesRecues, voir plus bas)
   ---------------------------------------------------------------------------
   Le fichier part sur le service de stockage de l'opérateur FlashbackFA
   (STORAGE_BASE, ex. https://storage.fbfa.fr) au lieu de vivre dans notre
   propre base : plus de plafond « packet too large » à surveiller côté
   MariaDB pour un PDF de catalogue, et le fichier est servi directement par
   ce service (son champ `url`), sans repasser par nous. « marlowe/ » préfixe
   toutes nos clés : le service est partagé entre plusieurs projets FlashbackFA,
   et rien n'empêcherait deux clés identiques de se marcher dessus sinon.

   Le corps est le fichier brut ; le type arrive dans Content-Type. On répond
   avec l'adresse publique, que le panel range dans ses données. */
async function handleUpload(request, env) {
  if (request.method !== 'POST') return json(env, { error: 'method' }, 405);

  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);

  /* Le dépôt était réservé au patron, parce qu'il ne servait qu'à la vitrine.
     Il sert maintenant aussi à joindre le justificatif d'une facture reçue :
     qui a le droit d'archiver la facture a le droit d'en joindre la preuve.
     Une ligne de dépense sans pièce jointe ne vaut pas grand-chose, et
     obliger à passer par le patron revient à ce que personne ne la joigne. */
  if (!s.isPatron) {
    const perms = await base(env).get('permissions', 'json') || {};
    const reg = await base(env).get('settings', 'json') || {};
    if (!canWrite(s, 'facturesRecues', perms, reg.permsRO || {})) {
      return json(env, { error: 'forbidden' }, 403);
    }
  }

  /* STORAGE_TOKEN ET STORAGE_BASE doivent tous les deux être explicitement
     réglés — laisser STORAGE_BASE vide retomber en silence sur l'adresse de
     production enverrait les fichiers (justificatifs de factures compris)
     vers le service de l'opérateur FlashbackFA sans que personne ne l'ait
     décidé, sur une installation qui aurait simplement oublié la variable. */
  if (!env.STORAGE_TOKEN) {
    return json(env, { error: 'config', missing: 'STORAGE_TOKEN' }, 500);
  }
  if (!env.STORAGE_BASE) {
    return json(env, { error: 'config', missing: 'STORAGE_BASE' }, 500);
  }

  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  if (!IMG_TYPES.includes(type)) return json(env, { error: 'bad_type', accepte: IMG_TYPES }, 415);

  const plafond = type === 'application/pdf' ? PDF_MAX : IMG_MAX;
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json(env, { error: 'empty' }, 400);
  if (buf.byteLength > plafond) return json(env, { error: 'too_large', max: plafond }, 413);

  const id = [...crypto.getRandomValues(new Uint8Array(10))]
    .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
  const cle = 'marlowe/' + id + (EXT_PAR_TYPE[type] || '');
  const base_ = String(env.STORAGE_BASE).replace(/\/+$/, '');

  let reponse;
  try {
    reponse = await fetch(base_ + '/api/object/' + cle, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + env.STORAGE_TOKEN, 'Content-Type': type },
      body: buf,
      /* Sans ça, un service qui accepte la connexion mais ne répond jamais
         bloque cette requête indéfiniment — sur le même processus qui sert
         tout le site. 20 s : plus généreux que les 8 s de FolkOS, parce
         qu'un PDF de 12 Mo met plus longtemps à partir qu'un ticket SSO. */
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    return json(env, { error: 'storage_unreachable', detail: String((e && e.message) || e) }, 502);
  }
  if (!reponse.ok) {
    const detail = await reponse.text().catch(() => '');
    return json(env, { error: 'storage_error', status: reponse.status, detail: detail.slice(0, 300) }, 502);
  }
  const donnees = await reponse.json().catch(() => ({}));

  /* L'adresse renvoyée par le service est reprise telle quelle dans la
     vitrine PUBLIQUE (nouveautés, catalogue) : comme pour lienCanva()
     un peu plus haut, on vérifie que c'est bien une adresse https avant
     de lui faire confiance, plutôt que de l'afficher sans regarder. */
  let urlValide = null;
  try {
    const u = new URL(String(donnees.url || ''));
    if (u.protocol === 'https:') urlValide = u.href;
  } catch (e) { /* urlValide reste null */ }
  if (!urlValide) return json(env, { error: 'storage_bad_response' }, 502);

  return json(env, { id: donnees.id || id, url: urlValide, type, taille: buf.byteLength });
}

/* GET /api/vitrine  —  PUBLIC
   Ce que la page d'accueil a le droit de savoir : les nouveautés et les pages
   du catalogue. Rien d'autre du panel ne transite par ici. */
async function handleVitrine(request, env) {
  if (request.method !== 'GET') return json(env, { error: 'method' }, 405);

  const d = await base(env).get('data', 'json') || {};
  const v = (d.vitrine && typeof d.vitrine === 'object') ? d.vitrine : {};

  const texte = (x, n) => String(x == null ? '' : x).slice(0, n);
  const nouveautes = (Array.isArray(v.nouveautes) ? v.nouveautes : [])
    .slice(0, 5)
    .map(n => ({ img: texte(n && n.img, 400), titre: texte(n && n.titre, 120), texte: texte(n && n.texte, 300) }))
    .filter(n => n.img);

  const catalogue = {
    titre: texte(v.catTitre, 120) || 'Catalogue du domaine',
    desc:  texte(v.catDesc, 300),
    pdf:   texte(v.catPdf, 400),
    embed: lienCanva(texte(v.catEmbed, 400)),
    pages: (Array.isArray(v.catPages) ? v.catPages : []).slice(0, 40).map(x => texte(x, 400)).filter(Boolean),
  };

  const m = await base(env).get('datameta', 'json');
  return json(env, { nouveautes, catalogue, rev: (m && m.rev) || 0 });
}

/* Un lien Canva collé depuis le bouton « Partager » ne s'affiche PAS dans une
   page : Canva l'interdit, et le navigateur montre « refuse de se connecter ».
   Seule la forme « …/view?embed » est intégrable. Plutôt que d'exiger du
   patron qu'il trouve le bon bouton, on remet nous-mêmes le lien en forme :
   on garde l'identifiant du design et on rebâtit l'adresse d'intégration.

   Le domaine est vérifié — sinon ce champ deviendrait un moyen d'afficher
   n'importe quelle page dans le site du domaine. */
/* Reconstruit l'adresse INTÉGRABLE d'un document à partir du lien de partage.

   Un lien de partage ordinaire refuse de s'afficher dans un cadre — Canva
   comme Google le bloquent, et la page reste blanche sans message. Chaque
   service a une adresse de consultation distincte, celle-là intégrable ; on
   la recompose à partir de l'identifiant, sans jamais faire confiance au
   reste de ce qui a été collé.

   Renvoie '' pour un champ vide ou un lien non reconnu : cette valeur part
   sur le site public, il n'y a donc rien à y publier qu'on n'ait pas
   entièrement fabriqué ici. */
function lienCanva(brut) {
  if (!brut) return '';
  let u;
  try { u = new URL(String(brut).trim()); } catch (e) { return ''; }
  if (u.protocol !== 'https:') return '';

  const hote = u.hostname.replace(/^www\./, '');
  const p = u.pathname;
  let m;

  if (hote === 'canva.com') {
    m = p.match(/^\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/);
    return m ? `https://www.canva.com/design/${m[1]}/${m[2]}/view?embed` : '';
  }

  if (hote === 'docs.google.com') {
    m = p.match(/^\/(presentation|document|spreadsheets)\/d\/(?:e\/)?([A-Za-z0-9_-]{10,})/);
    if (!m) return '';
    const fin = m[1] === 'presentation'
      ? 'embed?start=false&loop=false&delayms=60000'
      : 'preview';
    return `https://docs.google.com/${m[1]}/d/${m[2]}/${fin}`;
  }

  if (hote === 'drive.google.com') {
    m = p.match(/^\/file\/d\/([A-Za-z0-9_-]{10,})/);
    return m ? `https://drive.google.com/file/d/${m[1]}/preview` : '';
  }

  return '';
}

/* POST /api/discord  —  relais vers le salon des runners
   ---------------------------------------------------------------------------
   L'adresse du webhook est un secret du .env, jamais envoyé au navigateur :
   une URL de webhook est une autorisation d'écriture, et n'importe qui pourrait
   poster dans le salon en la lisant dans le code de la page.

   Le message est composé ICI à partir de l'identité de la session : un membre
   ne peut donc pas demander un retrait au nom de quelqu'un d'autre. */
const RETRAIT_MIN_MS = 30 * 1000;   // un envoi toutes les 30 s par personne

/* L'adresse du salon, et ce qu'il faut dire quand elle manque.
   ---------------------------------------------------------------------------
   Le secret peut exister sans être une adresse valable : une commande mal
   tapée y met vite autre chose. Sans ce contrôle, fetch() lèverait une
   exception et l'erreur remonterait en « le serveur a planté », ce qui
   n'aide personne. Deux boutons s'en servent — le retrait et la
   disponibilité — donc la vérification vit ici, une seule fois. */
function webhookDuSalon(env) {
  if (!env.DISCORD_WEBHOOK) {
    return { erreur: { error: 'webhook_absent',
      detail: "Le salon Discord n'est pas encore relié. Le patron doit créer un webhook et l'enregistrer." } };
  }
  const url = String(env.DISCORD_WEBHOOK).trim();
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(url)) {
    return { erreur: { error: 'webhook_invalide', detail:
      "La variable DISCORD_WEBHOOK ne contient pas une adresse de webhook Discord valable. "
      + "Elle doit ressembler à https://discord.com/api/webhooks/<nombres>/<jeton>. "
      + "Corrigez la ligne DISCORD_WEBHOOK= dans backend/.env (l'adresse collée telle "
      + "quelle, sans guillemets ni espace), puis redémarrez le serveur." } };
  }
  return { url };
}

async function handleDiscord(request, env) {
  if (request.method !== 'POST') return json(env, { error: 'method' }, 405);

  /* Le corps est lu AVANT la session : il peut porter le jeton quand l'appel
     arrive par la voie de repli (sans en-tête Authorization). */
  let body;
  try { body = await request.json(); }
  catch (e) { return json(env, { error: 'bad_json' }, 400); }
  if (!body || typeof body !== 'object') return json(env, { error: 'bad_json' }, 400);

  const s = await currentSession(request, env, typeof body.token === 'string' ? body.token : null);
  if (!s) return json(env, { error: 'unauthorized' }, 401);

  const w = webhookDuSalon(env);
  if (w.erreur) return json(env, w.erreur, 503);
  const cible = w.url;

  const texte = (x, n) => String(x == null ? '' : x).slice(0, n).replace(/[`@]/g, '');
  const produit = texte(body.produit, 120);
  const quantite = Math.max(1, Math.min(99999, Math.round(Number(body.quantite) || 0)));
  const heure = texte(body.heure, 12);
  if (!produit || !heure) return json(env, { error: 'incomplet' }, 400);

  /* Garde-fou anti-spam : sans lui, un clic répété inonderait le salon. */
  const cle = 'retrait:' + s.user.id;
  const dernier = await base(env).get(cle);
  if (dernier) {
    return json(env, { error: 'trop_vite',
      detail: 'Patientez une trentaine de secondes entre deux demandes.' }, 429);
  }
  /* Le garde-fou est un confort, pas une sécurité : s'il ne peut pas
     s'inscrire, la demande part quand même. Mieux vaut un doublon possible
     qu'un retrait bloqué. */
  try {
    await base(env).put(cle, '1', { expirationTtl: Math.ceil(RETRAIT_MIN_MS / 1000) });
  } catch (e) { /* sans effet */ }

  const role = (env.DISCORD_RUNNER_ROLE || '').trim();
  const mention = role ? `<@&${role}> ` : '';

  const contenu = `${mention}**Demande de retrait**\n`
    + `> Runner : **${s.user.name}**\n`
    + `> Produit : **${produit}**\n`
    + `> Quantité : **${quantite}**\n`
    + `> Départ souhaité : **${heure}**`;

  const res = await fetch(cible, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: contenu,
      username: 'Marlowe Vineyard',
      /* Sans cette liste, Discord refuse de notifier le rôle depuis un
         webhook — et le message partirait sans réveiller personne. */
      allowed_mentions: role ? { parse: [], roles: [role] } : { parse: [] },
    }),
  });

  if (!res.ok) {
    return json(env, { error: 'discord', status: res.status,
      detail: "Discord a refusé le message. Le webhook a peut-être été supprimé." }, 502);
  }
  return json(env, { ok: true, envoyePar: s.user.name });
}

/* POST /api/dispo  —  l'inverse du retrait
   ---------------------------------------------------------------------------
   Le retrait part d'un runner qui a besoin de vin. Celui-ci part d'un
   responsable qui annonce qu'il est là : même salon, même webhook, message
   inverse. Les responsables l'écrivaient à la main jusqu'ici.

   Deux différences avec le retrait, et elles comptent.

   · Le droit n'est pas le même. Demander un retrait est un geste de service ;
     annoncer une disponibilité engage le domaine devant tout le serveur. Les
     rôles autorisés se cochent dans Paramètres ▸ Com Runner. Tant que rien
     n'est coché, seul le patron peut appuyer — un réglage vide ne doit jamais
     ouvrir une porte, il doit la laisser fermée.

   · Le délai d'attente est plus long. Une demande de retrait se répète dans la
     journée ; une annonce de présence répétée toutes les trente secondes est
     du bruit dans un salon que tout le monde lit.

   Le message est composé ICI, à partir du nom de la session : personne ne peut
   se déclarer disponible au nom de quelqu'un d'autre. */
const DISPO_MIN_MS = 10 * 60 * 1000;   // une annonce toutes les 10 min par personne

/* Qui a le droit d'annoncer. Le patron toujours ; les autres seulement si
   l'un de leurs rôles figure dans la liste cochée en Paramètres. */
function peutAnnoncerDispo(session, reglages) {
  if (session.isPatron) return true;
  /* Un accès extérieur n'a pas de rôle Discord : il ne parle pas au salon. */
  if (session.invite) return false;
  const liste = Array.isArray(reglages && reglages.dispoRoles) ? reglages.dispoRoles : [];
  if (!liste.length) return false;
  return liste.some(r => (session.roles || []).includes(r));
}

async function handleDispo(request, env) {
  if (request.method !== 'POST') return json(env, { error: 'method' }, 405);

  /* Comme pour le retrait, le corps est lu AVANT la session : il peut porter
     le jeton quand l'appel arrive par la voie de repli. */
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  if (!body || typeof body !== 'object') body = {};

  const s = await currentSession(request, env, typeof body.token === 'string' ? body.token : null);
  if (!s) return json(env, { error: 'unauthorized' }, 401);

  const reglages = await base(env).get('settings', 'json') || {};
  if (!peutAnnoncerDispo(s, reglages)) {
    return json(env, { error: 'forbidden', detail:
      "Votre rôle n'est pas autorisé à annoncer une disponibilité. "
      + "Le patron coche les rôles dans Paramètres ▸ Com Runner." }, 403);
  }

  const w = webhookDuSalon(env);
  if (w.erreur) return json(env, w.erreur, 503);

  const cle = 'dispo:' + s.user.id;
  if (await base(env).get(cle)) {
    return json(env, { error: 'trop_vite', detail:
      'Vous venez d\'annoncer votre disponibilité. Attendez une dizaine de minutes.' }, 429);
  }
  /* Le garde-fou est un confort, pas une sécurité : s'il ne peut pas
     s'inscrire, l'annonce part quand même. */
  try {
    await base(env).put(cle, '1', { expirationTtl: Math.ceil(DISPO_MIN_MS / 1000) });
  } catch (e) { /* sans effet */ }

  /* Le rôle à réveiller est celui des membres du domaine, pas celui des
     runners. Et ce ne sont pas des clients : ce qu'ils viennent chercher
     leur appartient déjà, c'est le fruit de leur travail. Le message ne
     doit donc rien avoir d'une invitation à commander. */
  const role = String(env.DISCORD_DISPO_ROLE || '').trim();
  const roleOk = /^\d{17,20}$/.test(role);
  const mention = roleOk ? `<@&${role}> ` : '';

  const nom = String(s.user.name || '').slice(0, 60).replace(/[`@]/g, '');
  const contenu = `${mention}**Disponibilité**\n`
    + `> **${nom}** est là pour vos bouteilles et vos avantages 🍇\n`
    + `> Passez récupérer ce qui vous revient.`;

  const res = await fetch(w.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: contenu,
      username: 'Marlowe Vineyard',
      /* Sans cette liste, Discord refuse de notifier un rôle depuis un
         webhook — et le message partirait sans réveiller personne. */
      allowed_mentions: roleOk ? { parse: [], roles: [role] } : { parse: [] },
    }),
  });

  if (!res.ok) {
    return json(env, { error: 'discord', status: res.status,
      detail: "Discord a refusé le message. Le webhook a peut-être été supprimé." }, 502);
  }
  /* « mention: false » n'est pas une erreur : l'annonce est partie, mais sans
     réveiller personne. Le panel le dit plutôt que de laisser croire au
     succès complet — c'est exactement le défaut qu'on avait déjà eu avec le
     rappel de permis parti sans son texte. */
  return json(env, { ok: true, envoyePar: s.user.name, mention: roleOk });
}

/* ===========================================================================
   ACCÈS EXTÉRIEURS — code + mot de passe, sans Discord
   ---------------------------------------------------------------------------
   Pour un comptable, un partenaire, quelqu'un qui n'est pas sur le serveur.
   Le patron crée l'accès, choisit les pages, et peut le révoquer.

   Les mots de passe ne sont jamais stockés en clair : on garde une empreinte
   PBKDF2 avec un sel propre à chaque accès. Même en lisant la base, on ne
   peut pas remonter au mot de passe.
   =========================================================================== */

const PBKDF2_TOURS = 120000;

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function empreinte(motDePasse, sel) {
  const cle = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(motDePasse), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(sel), iterations: PBKDF2_TOURS, hash: 'SHA-256' },
    cle, 256);
  return b64(bits);
}

/* Comparaison à temps constant : une comparaison normale s'arrête au premier
   caractère différent, ce qui laisse deviner l'empreinte par chronométrage. */
function memeSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function lireInvites(env) {
  return await base(env).get('invites', 'json') || [];
}

/* GET | PUT /api/invites  —  patron uniquement
   La liste renvoyée ne contient JAMAIS les empreintes ni les sels. */
/* Les pages qu'un accès extérieur peut recevoir : jamais celles
   d'Administration, quelle que soit la case cochée dans le navigateur. Le
   filtre est ici, à l'écriture, pour qu'une liste fautive ne soit même pas
   stockée — et canWrite refuse de toute façon à la lecture. Deux verrous. */
function pagesInvite(x) {
  return (Array.isArray(x) ? x : [])
    .filter(p => typeof p === 'string' && !PAGES_ADMIN.has(p))
    .slice(0, 60);
}

async function handleInvites(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);
  {
    /* Créer un accès extérieur, c'est ouvrir une porte d'entrée au panel :
       le droit se coche dans la matrice, page « Accès extérieurs ». */
    const reg = await base(env).get('settings', 'json') || {};
    const perms = await base(env).get('permissions', 'json') || {};
    if (!canWrite(s, 'invitesGestion', perms, reg.permsRO || {})) {
      return json(env, { error: 'forbidden' }, 403);
    }
  }

  if (request.method === 'GET') {
    const invites = await lireInvites(env);
    return json(env, { invites: invites.map(i => ({
      code: i.code, nom: i.nom, pages: i.pages, ro: i.ro || [],
      cree: i.cree, dernier: i.dernier || null, actif: i.actif !== false,
    })) });
  }

  if (request.method !== 'PUT' && request.method !== 'POST') {
    return json(env, { error: 'method' }, 405);
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return json(env, { error: 'bad_json' }, 400); }
  /* « null » est du JSON parfaitement valable : sans ce contrôle, body.action
     lève « Cannot read properties of null » et la route répond 500 au lieu de
     400 — en recopiant au passage un message d'erreur interne à l'appelant. */
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(env, { error: 'bad_shape' }, 400);
  }

  const texte = (x, n) => String(x == null ? '' : x).slice(0, n);
  const action = texte(body.action, 20);

  /* Même file d'attente que pour « data », et pour une raison plus grave qu'une
     simple perte de travail : la liste est lue, modifiée, puis RÉÉCRITE EN
     ENTIER. Sans file, une suppression d'accès (« supprimer ») partie pendant
     qu'une autre requête tenait déjà la liste en mémoire était purement et
     simplement annulée par la réécriture de celle-ci — l'accès révoqué
     revenait, actif, avec son mot de passe. Une révocation qui ne révoque pas
     ne se voit nulle part : ni à l'écran, ni dans les journaux.
     handleInviteLogin, juste en dessous, partage la même file : c'est lui le
     plus dangereux des deux, parce qu'il réécrit la liste (pour noter la date
     de dernière connexion) et qu'il est PUBLIC — donc déclenchable à volonté
     par le porteur de l'accès qu'on est justement en train de retirer. */
  return verrou(env, 'invites', async () => {
    const invites = await lireInvites(env);

    if (action === 'creer') {
      const nom = texte(body.nom, 60).trim();
      const mdp = String(body.mdp || '');
      if (!nom) return json(env, { error: 'nom_manquant' }, 400);
      if (mdp.length < 8) return json(env, { error: 'mdp_court', detail: '8 caractères minimum.' }, 400);
      if (invites.length >= 50) return json(env, { error: 'trop', detail: '50 accès au maximum.' }, 400);

      /* Le code est tiré au sort ici, pas côté navigateur : c'est la moitié du
         secret, il doit venir d'une source sûre. */
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const brut = crypto.getRandomValues(new Uint8Array(8));
      const code = 'MV-' + [...brut].map(b => alphabet[b % alphabet.length]).join('');

      const sel = b64(crypto.getRandomValues(new Uint8Array(16)));
      invites.push({
        code, nom, sel, hash: await empreinte(mdp, sel),
        pages: pagesInvite(body.pages),
        ro: pagesInvite(body.ro),
        cree: new Date().toISOString().slice(0, 10),
        actif: true,
      });
      await base(env).put('invites', JSON.stringify(invites));
      return json(env, { ok: true, code });
    }

    const code = texte(body.code, 30);
    const i = invites.findIndex(x => x.code === code);
    if (i < 0) return json(env, { error: 'introuvable' }, 404);

    if (action === 'supprimer') {
      invites.splice(i, 1);
      await base(env).put('invites', JSON.stringify(invites));
      return json(env, { ok: true });
    }

    if (action === 'basculer') {
      invites[i].actif = invites[i].actif === false;
      await base(env).put('invites', JSON.stringify(invites));
      return json(env, { ok: true, actif: invites[i].actif });
    }

    if (action === 'pages') {
      invites[i].pages = pagesInvite(body.pages);
      invites[i].ro    = pagesInvite(body.ro);
      await base(env).put('invites', JSON.stringify(invites));
      return json(env, { ok: true });
    }

    if (action === 'mdp') {
      const mdp = String(body.mdp || '');
      if (mdp.length < 8) return json(env, { error: 'mdp_court', detail: '8 caractères minimum.' }, 400);
      invites[i].sel = b64(crypto.getRandomValues(new Uint8Array(16)));
      invites[i].hash = await empreinte(mdp, invites[i].sel);
      await base(env).put('invites', JSON.stringify(invites));
      return json(env, { ok: true });
    }

    return json(env, { error: 'action_inconnue' }, 400);
  });
}

/* POST /api/invite-login  —  PUBLIC (c'est la porte d'entrée) */
async function handleInviteLogin(request, env) {
  if (request.method !== 'POST') return json(env, { error: 'method' }, 405);

  let body;
  try { body = await request.json(); }
  catch (e) { return json(env, { error: 'bad_json' }, 400); }

  const code = String(body.code || '').trim().toUpperCase().slice(0, 30);
  const mdp = String(body.mdp || '');

  /* Freinage par code : sans lui, on pourrait essayer les mots de passe en
     boucle jusqu'à tomber juste. */
  const cleEssais = 'essais:' + code;
  const essais = Number(await base(env).get(cleEssais) || 0);
  if (essais >= 8) {
    return json(env, { error: 'bloque',
      detail: 'Trop de tentatives. Réessayez dans un quart d\'heure.' }, 429);
  }

  const invites = await lireInvites(env);
  const inv = invites.find(x => x.code === code);

  if (!inv || inv.actif === false) {
    await base(env).put(cleEssais, String(essais + 1), { expirationTtl: 900 });
    return json(env, { error: 'refuse' }, 401);
  }

  const test = await empreinte(mdp, inv.sel);
  if (!memeSecret(test, inv.hash)) {
    await base(env).put(cleEssais, String(essais + 1), { expirationTtl: 900 });
    return json(env, { error: 'refuse' }, 401);
  }

  await base(env).delete(cleEssais);

  /* La note de dernière connexion réécrit TOUTE la liste — et la liste lue
     plus haut date d'avant la vérification du mot de passe, qui prend une
     bonne centaine de millisecondes (PBKDF2, 120 000 tours). Réécrire telle
     quelle une liste vieille de 100 ms annulait toute modification faite
     entre-temps : le patron révoquait un accès pendant que son porteur se
     connectait, et la connexion le ressuscitait, actif, avec son mot de passe.
     On relit donc la liste DANS la file — la même que handleInvites, pour que
     les deux ne se chevauchent jamais — et on revérifie au passage que l'accès
     est toujours là et toujours actif. Une révocation partie pendant la
     vérification du mot de passe gagne désormais la course.

     Et c'est la version FRAÎCHE qui sert ensuite à bâtir la session : se
     contenter de relire pour dire oui ou non n'aurait réglé que la
     suppression. Deux autres actions se jouent dans la même fenêtre de
     100 ms — « pages » (réduction des droits) et « mdp » (rotation du mot de
     passe). Bâtir la session sur la liste d'avant aurait délivré les ANCIENS
     droits, et validé un mot de passe qu'on venait de changer. On refuse donc
     aussi si l'empreinte a bougé depuis qu'on l'a vérifiée. */
  const frais = await verrou(env, 'invites', async () => {
    const liste = await lireInvites(env);
    const cible = liste.find(x => x.code === code);
    if (!cible || cible.actif === false) return null;
    /* Le mot de passe a été vérifié contre l'empreinte d'AVANT : si elle a
       changé entre-temps, ce qu'on vient de valider n'ouvre plus rien. */
    if (cible.hash !== inv.hash || cible.sel !== inv.sel) return null;

    cible.dernier = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await base(env).put('invites', JSON.stringify(liste));
    return cible;
  });

  if (!frais) return json(env, { error: 'refuse' }, 401);

  const sid = crypto.randomUUID();
  await base(env).put('sess:' + sid, JSON.stringify({
    invite: true, code: frais.code, id: 'inv:' + frais.code, name: frais.nom, avatar: null,
  }), { expirationTtl: SESSION_TTL });

  /* Plus de `token` dans la réponse : le cookie httpOnly suffit, et ne
     jamais le poser dans une valeur que le JS du panel lit lui-même est
     tout l'intérêt du changement (voir entetesCookieSession). */
  return json(env, { nom: frais.nom, pages: frais.pages, ro: frais.ro || [] }, 200, entetesCookieSession(sid));
}

/* GET | PUT /api/settings
   Réglages du panel. Aujourd'hui : la liste des rôles retenus comme rôles
   du domaine (les autres — partenaires, décoratifs — sont écartés). */
async function handleSettings(request, env) {
  if (request.method === 'GET') {
    /* Même raison que /api/permissions : ces réglages nomment les rôles
       autorisés à annoncer, ceux en lecture seule, la visibilité de
       l'agenda. Rien qui doive se lire sans être connecté. */
    const session = await currentSession(request, env);
    if (!session) return json(env, { error: 'unauthorized' }, 401);
    const s = await base(env).get('settings', 'json');
    return json(env, s || {});
  }

  if (request.method === 'PUT') {
    const s = await currentSession(request, env);
    if (!s) return json(env, { error: 'unauthorized' }, 401);

    let body;
    try { body = await request.json(); }
    catch (e) { return json(env, { error: 'bad_json' }, 400); }
    /* Même remarque que sur /api/invites : « null » passe le JSON.parse et
       faisait répondre 500 à la première lecture de propriété. */
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(env, { error: 'bad_shape' }, 400);
    }

    /* Un filtre en liste blanche : ce qui n'est pas nommé ici est JETÉ.
       ------------------------------------------------------------------------
       C'est volontaire — le navigateur ne doit pas pouvoir écrire n'importe
       quoi dans les réglages du domaine. Mais la conséquence est brutale :
       une clé oubliée disparaît en silence, la page affiche « Enregistré ✓ »,
       et le réglage repart à zéro au rechargement suivant. C'est exactement ce
       qui arrivait à « agendaVis » : les listes de visibilité de l'agenda
       étaient enregistrées côté panel, jamais côté serveur. Toute nouvelle
       clé de réglage DOIT être ajoutée ici. */
    const listeDeRoles = x => (Array.isArray(x) ? x : [])
      .filter(r => typeof r === 'string').map(r => r.slice(0, 100)).slice(0, 300);

    const clean = {};
    if (Array.isArray(body.visibleRoles)) {
      clean.visibleRoles = body.visibleRoles
        .filter(r => typeof r === 'string')
        .map(r => r.slice(0, 100))
        .slice(0, 300);
    }

    /* Lecture seule : rôles qui voient une page sans pouvoir la modifier. */
    if (body.permsRO && typeof body.permsRO === 'object' && !Array.isArray(body.permsRO)) {
      const ro = {};
      for (const [page, roles] of Object.entries(body.permsRO)) {
        if (!Array.isArray(roles)) continue;
        ro[String(page).slice(0, 64)] = roles
          .filter(r => typeof r === 'string').map(r => r.slice(0, 100)).slice(0, 200);
      }
      clean.permsRO = ro;
    }

    /* Visibilité de l'agenda : un objet { direction: [rôles], commercial: [] }. */
    if (body.agendaVis && typeof body.agendaVis === 'object' && !Array.isArray(body.agendaVis)) {
      const vis = {};
      for (const [niveau, roles] of Object.entries(body.agendaVis)) {
        vis[String(niveau).slice(0, 32)] = listeDeRoles(roles);
      }
      clean.agendaVis = vis;
    }

    /* Rôles autorisés à annoncer une disponibilité dans le salon des runners.
       Une liste absente et une liste vide veulent dire la même chose : personne
       en dehors du patron. */
    if (Array.isArray(body.dispoRoles)) clean.dispoRoles = listeDeRoles(body.dispoRoles);

    /* Chaque réglage appartient à un écran d'Administration, et chaque écran
       se délègue séparément.
       ------------------------------------------------------------------------
       Sans ce contrôle clé par clé, confier « Disponibilités » à un
       responsable lui donnerait aussi la matrice des accès : les deux vivent
       dans le même objet, et une seule autorisation aurait tout ouvert. C'est
       la porte dérobée qu'il fallait fermer en même temps qu'on ouvrait la
       porte principale. */
    const APPARTENANCE = {
      visibleRoles: 'acces',
      permsRO:      'acces',
      agendaVis:    'agendaVis',
      dispoRoles:   'dispoRoles',
    };
    const perms = await base(env).get('permissions', 'json') || {};
    const avantControle = await base(env).get('settings', 'json') || {};
    const refuses = Object.keys(clean)
      .filter(k => !canWrite(s, APPARTENANCE[k], perms, avantControle.permsRO || {}));
    if (refuses.length) return json(env, { error: 'forbidden', reglages: refuses }, 403);

    /* Fusion, et non remplacement.
       ------------------------------------------------------------------------
       L'ancienne version réécrivait TOUT l'objet à partir du seul envoi reçu :
       un écran qui n'envoyait que sa clé effaçait celles des autres. Maintenant
       que chaque écran n'envoie que la sienne, remplacer serait catastrophique
       — enregistrer les disponibilités viderait la matrice des accès.

       La fusion se fait sous file d'attente, et l'objet d'avant est RELU
       dedans : c'est exactement le même piège que sur le document « data ».
       Deux écrans d'Administration enregistrés en même temps — les
       disponibilités d'un côté, la visibilité de l'agenda de l'autre — lisaient
       la même version et le second effaçait le réglage du premier. */
    const sortie = await verrou(env, 'settings', async () => {
      const avant = await base(env).get('settings', 'json') || {};
      const fusion = Object.assign({}, avant, clean);
      await base(env).put('settings', JSON.stringify(fusion));
      return fusion;
    });
    return json(env, sortie);
  }

  return json(env, { error: 'method_not_allowed' }, 405);
}


/* ---------------------------------------------------------------------------
   Le rappel de permis
   ---------------------------------------------------------------------------
   Un RH clique dans le registre ; le message part dans le ticket de la
   personne. Trois choses se décident ICI et nulle part ailleurs :

   1. L'identifiant Discord est relu dans le registre rangé en base. Le
      navigateur n'envoie que le n° civil. Sans ça, n'importe quel membre
      connecté pourrait faire écrire le domaine à n'importe qui sur Discord,
      en appelant l'API directement avec l'identifiant de son choix.

   2. La signature est recomposée depuis la session. Le texte du message est
      modifiable, la signature non : personne ne rappelle au nom d'un autre.

   3. Le salon est retrouvé par les PERMISSIONS, pas par le nom. Un salon de
      ticket se renomme ; une permission nominative, non. On garde, dans les
      catégories déclarées, le salon où l'identifiant de la personne a une
      permission posée à son nom.

   Aucun bot à faire tourner à côté : le serveur détient le token et parle à
   Discord directement, comme il le fait déjà pour lire les rôles.
   --------------------------------------------------------------------------- */

/* Une relance par personne toutes les 24 h. Le bouton n'est pas une arme. */
const RAPPEL_TTL = 24 * 3600;

const RAPPEL_DEFAUT =
  "Bonjour, ton permis n'est toujours pas enregistré au domaine. "
  + "Merci de le passer et de prévenir un RH pour qu'on mette ta fiche à jour.";

function categoriesTickets(env) {
  return String(env.DISCORD_TICKET_CATEGORIES || '')
    .split(',').map(x => x.trim()).filter(x => /^\d{17,20}$/.test(x));
}

/* Les salons du serveur, gardés une minute : chercher un ticket ne doit pas
   redemander la liste complète à chaque clic. */
async function guildChannels(env) {
  const cached = memGet('salons');
  if (cached) return cached;
  const res = await botFetch(env, `/guilds/${env.DISCORD_GUILD_ID}/channels`);
  if (!res.ok) throw new Error('channels ' + res.status);
  const list = await res.json();
  memSet('salons', list, 60);
  return list;
}

/* Le salon de ticket d'une personne, ou null.

   type 0 = salon textuel. type 1 dans une permission = un membre (type 0
   serait un rôle) : c'est cette distinction qui fait tout le repérage, car
   les rôles du staff sont posés sur TOUS les tickets, et le demandeur sur
   un seul. Si la personne en a plusieurs ouverts, on prend le plus récent —
   l'identifiant d'un salon Discord croît avec le temps. */
async function ticketDe(env, discordId) {
  const cats = categoriesTickets(env);
  if (!cats.length) return null;

  const salons = await guildChannels(env);
  const candidats = salons.filter(c =>
    c.type === 0
    && c.parent_id && cats.includes(String(c.parent_id))
    && Array.isArray(c.permission_overwrites)
    && c.permission_overwrites.some(o => String(o.id) === String(discordId) && Number(o.type) === 1));

  if (!candidats.length) return null;
  candidats.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1));
  return candidats[0];
}

/* Le corps du message.
   ---------------------------------------------------------------------------
   TOUT tient dans le texte, et rien dans un embed. Ce n'est pas un choix
   esthétique, c'est une leçon apprise en production : le premier rappel est
   arrivé avec la seule mention, l'encadré ayant disparu en route. Discord
   retire les embeds d'un message quand l'application n'a pas la permission
   « Intégrer des liens » sur le salon — sans erreur, sans prévenir. Le
   destinataire recevait donc une notification vide de sens.

   Un message dont le contenu dépend d'une permission facultative est un
   message qui finira par ne rien dire. « Envoyer des messages » suffit ici,
   et c'est la seule permission dont ce rappel a besoin.

   allowed_mentions verrouille les mentions sur la seule personne visée : même
   si quelqu'un glisse « @everyone » dans le texte modifiable, Discord ne
   notifiera personne d'autre. */
function corpsRappel(discordId, texte, parQui) {
  const corps = String(texte).slice(0, 1500).trim();
  const signature = `Demandé par ${String(parQui).slice(0, 80)} · Marlowe Vineyard`;
  const message = `<@${discordId}>\n\n`
    + `**Rappel — permis de conduire**\n`
    + `${corps}\n\n`
    + `*${signature}*`;
  return {
    content: message.slice(0, 2000),
    allowed_mentions: { parse: [], users: [String(discordId)] },
  };
}

/* La fiche visée, relue en base. Renvoie {fiche} ou {erreur, code}. */
async function ficheParCivil(env, civil) {
  const data = await base(env).get('data', 'json') || {};
  const roster = Array.isArray(data.rhRoster) ? data.rhRoster : [];
  const fiche = roster.find(f => String(f && f.id) === String(civil));
  if (!fiche) return { erreur: 'inconnu', code: 404 };

  const discord = String(fiche.discord || '').trim();
  if (!/^\d{17,20}$/.test(discord)) return { erreur: 'sans_identifiant', code: 400, fiche };
  return { fiche, discord };
}


/* ---------------------------------------------------------------------------
   Écrire dans le ticket de quelqu'un — le mécanisme commun
   ---------------------------------------------------------------------------
   Le rappel de permis a ouvert la voie ; l'avertissement RH emprunte la même.
   Tout ce qui suit vaut pour les deux, et vaudra pour le prochain :

     · le ticket est retrouvé par la permission NOMINATIVE, pas par le nom du
       salon — un salon se renomme, une permission posée sur quelqu'un non ;
     · à défaut de ticket, le message part en privé ;
     · si le privé est fermé, on le DIT, on ne fait pas semblant d'avoir
       envoyé. Une notification qu'on croit partie est pire que pas de
       notification du tout ;
     · le message tient entièrement dans le texte, jamais dans un embed :
       Discord retire les embeds quand « Intégrer des liens » manque, sans
       erreur, et le destinataire reçoit alors une mention vide de sens. On l'a
       appris en production.
   --------------------------------------------------------------------------- */

/* Le corps d'un message au domaine : titre en gras, corps, signature. */
function corpsMessage(discordId, titre, texte, parQui) {
  const corps = String(texte).slice(0, 1400).trim();
  const message = `<@${discordId}>\n\n`
    + `**${String(titre).slice(0, 120)}**\n`
    + `${corps}\n\n`
    + `*${String(parQui).slice(0, 80)} · Marlowe Vineyard*`;
  return {
    content: message.slice(0, 2000),
    allowed_mentions: { parse: [], users: [String(discordId)] },
  };
}

/* Envoie, et rend {ok, ou, salon} ou {erreur, detail, status}. */
async function ecrireDansTicket(env, discord, corps) {
  const salon = await ticketDe(env, discord);
  if (salon) {
    const r = await botPost(env, `/channels/${salon.id}/messages`, corps);
    if (r.ok) return { ok: true, ou: 'ticket', salon: salon.name };
    /* Le salon existe mais Discord refuse : c'est une permission manquante,
       pas un ticket introuvable. On le dit tel quel plutôt que de basculer en
       privé — sinon l'erreur de configuration ne se voit jamais. */
    return { erreur: 'refus_salon', salon: salon.name, status: 502,
             detail: (r.data && r.data.message) || ('HTTP ' + r.status) };
  }

  const canal = await botPost(env, '/users/@me/channels', { recipient_id: discord });
  if (!canal.ok || !canal.data || !canal.data.id) {
    return { erreur: 'aucun_canal', status: 502,
             detail: (canal.data && canal.data.message) || ('HTTP ' + canal.status) };
  }
  const r2 = await botPost(env, `/channels/${canal.data.id}/messages`, corps);
  if (!r2.ok) {
    return { erreur: 'prive_ferme', status: 502,
             detail: (r2.data && r2.data.message) || ('HTTP ' + r2.status) };
  }
  return { ok: true, ou: 'prive' };
}

/* POST /api/avertissement  {civil, niveau, motif}
   ---------------------------------------------------------------------------
   PAS de limite de 24 h ici, contrairement au rappel de permis : un
   avertissement est un acte RH délibéré, et si deux sont donnés le même jour,
   les deux doivent arriver. Seul un envoi strictement identique dans les deux
   minutes est écarté — c'est un double-clic, pas une deuxième sanction. */
const AVERT_DOUBLON = 120;   /* secondes */

async function handleAvertissement(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);
  if (request.method !== 'POST') return json(env, { error: 'method_not_allowed' }, 405);

  const perms = await base(env).get('permissions', 'json') || {};
  const reg = await base(env).get('settings', 'json') || {};
  if (!canWrite(s, 'avertissements', perms, reg.permsRO || {})) {
    return json(env, { error: 'forbidden' }, 403);
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return json(env, { error: 'bad_json' }, 400); }

  const r = await ficheParCivil(env, body && body.civil);
  if (r.erreur === 'inconnu') return json(env, { error: 'inconnu' }, 404);
  if (r.erreur === 'sans_identifiant') {
    return json(env, { error: 'sans_identifiant', nom: r.fiche.name || '' }, 400);
  }

  const niveau = String((body && body.niveau) || 'Avertissement').slice(0, 60);
  const motif = String((body && body.motif) || '').trim().slice(0, 1200);
  if (!motif) return json(env, { error: 'sans_motif' }, 400);

  /* L'empreinte du double-clic : même personne, même niveau, même motif.
     Une empreinte courte suffit — on ne cherche pas à résister à une attaque,
     seulement à reconnaître deux clics sur le même bouton. */
  let h = 2166136261;
  for (const c of (niveau + '|' + motif)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const empreinte = 'avert:' + r.discord + ':' + (h >>> 0).toString(36);
  if (await base(env).get(empreinte)) {
    return json(env, { error: 'doublon' }, 429);
  }

  const corps = corpsMessage(r.discord, `Avertissement — ${niveau}`,
    `Motif : ${motif}`, `Donné par ${s.user.name}`);
  const envoi = await ecrireDansTicket(env, r.discord, corps);

  await base(env).put(empreinte, '1', { expirationTtl: AVERT_DOUBLON });

  if (!envoi.ok) {
    /* L'avertissement lui-même est enregistré par le panel, indépendamment :
       ce n'est pas parce que Discord refuse que la sanction n'a pas eu lieu.
       On renvoie l'échec pour que le panel le DISE, sans rien annuler. */
    return json(env, { error: envoi.erreur, detail: envoi.detail, salon: envoi.salon }, envoi.status || 502);
  }

  await appendJournal(env, s,
    `a notifié un avertissement (${niveau}) à ${r.fiche.name}`
    + (envoi.ou === 'ticket' ? ` dans #${envoi.salon}` : ' en message privé'),
    ['avertissements']);
  return json(env, { ok: true, ou: envoi.ou, salon: envoi.salon });
}

/* GET | POST /api/rappel

   GET  ?civil=…  → ce que la fenêtre affiche avant l'envoi : le salon trouvé
                    et la date du dernier rappel. N'envoie rien.
   POST {civil, texte?} → envoie. */
async function handleRappel(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);

  /* Le droit d'écrire le registre RH, et rien de moins : c'est le même
     verrou que pour modifier une fiche. */
  const perms = await base(env).get('permissions', 'json') || {};
  const reglagesSrv = await base(env).get('settings', 'json') || {};
  if (!canWrite(s, 'rhRoster', perms, reglagesSrv.permsRO || {})) {
    return json(env, { error: 'forbidden' }, 403);
  }

  if (!categoriesTickets(env).length) {
    return json(env, { error: 'config', detail:
      'Aucune catégorie de tickets déclarée. Renseignez DISCORD_TICKET_CATEGORIES '
      + 'dans backend/.env, puis redémarrez le conteneur (voir backend/README.md).' }, 500);
  }

  const url = new URL(request.url);

  if (request.method === 'GET') {
    const civil = url.searchParams.get('civil') || '';
    const r = await ficheParCivil(env, civil);
    if (r.erreur === 'inconnu') return json(env, { error: 'inconnu' }, 404);
    if (r.erreur === 'sans_identifiant') {
      return json(env, { error: 'sans_identifiant', nom: r.fiche.name || '' }, 400);
    }
    const salon = await ticketDe(env, r.discord);
    const dernier = await base(env).get('rappel:' + r.discord, 'json');
    return json(env, {
      nom: r.fiche.name || '',
      salon: salon ? { id: salon.id, nom: salon.name } : null,
      dernier: dernier || null,
      defaut: (await base(env).get('data', 'json') || {}).reglages?.rappelPermis || RAPPEL_DEFAUT,
    });
  }

  if (request.method !== 'POST') return json(env, { error: 'method_not_allowed' }, 405);

  let body;
  try { body = await request.json(); }
  catch (e) { return json(env, { error: 'bad_json' }, 400); }

  const r = await ficheParCivil(env, body && body.civil);
  if (r.erreur === 'inconnu') return json(env, { error: 'inconnu' }, 404);
  if (r.erreur === 'sans_identifiant') {
    return json(env, { error: 'sans_identifiant', nom: r.fiche.name || '' }, 400);
  }

  /* La relance déjà partie. On refuse AVANT d'écrire quoi que ce soit à
     Discord, et on dit quand le bouton se rouvre. */
  const dernier = await base(env).get('rappel:' + r.discord, 'json');
  if (dernier) {
    return json(env, { error: 'trop_tot', dernier }, 429);
  }

  const texte = (typeof body.texte === 'string' && body.texte.trim())
    ? body.texte.trim().slice(0, 1500)
    : ((await base(env).get('data', 'json') || {}).reglages?.rappelPermis || RAPPEL_DEFAUT);

  const corps = corpsRappel(r.discord, texte, s.user.name);

  /* 1. le ticket */
  const salon = await ticketDe(env, r.discord);
  if (salon) {
    const env1 = await botPost(env, `/channels/${salon.id}/messages`, corps);
    if (env1.ok) {
      const trace = { at: new Date().toISOString(), par: s.user.name, ou: 'ticket', salon: salon.name };
      await base(env).put('rappel:' + r.discord, JSON.stringify(trace), { expirationTtl: RAPPEL_TTL });
      await appendJournal(env, s, `a rappelé son permis à ${r.fiche.name} (#${salon.name})`, ['rhRoster']);
      return json(env, { ok: true, ou: 'ticket', salon: salon.name });
    }
    /* Le salon existe mais Discord refuse d'y écrire : c'est une permission
       manquante, pas un ticket introuvable. On le dit tel quel plutôt que de
       basculer en privé, sinon l'erreur de configuration ne se voit jamais. */
    return json(env, { error: 'refus_salon', salon: salon.name,
      detail: (env1.data && env1.data.message) || ('HTTP ' + env1.status) }, 502);
  }

  /* 2. à défaut, le message privé */
  const canal = await botPost(env, '/users/@me/channels', { recipient_id: r.discord });
  if (!canal.ok || !canal.data || !canal.data.id) {
    return json(env, { error: 'aucun_canal',
      detail: (canal.data && canal.data.message) || ('HTTP ' + canal.status) }, 502);
  }
  const env2 = await botPost(env, `/channels/${canal.data.id}/messages`, corps);
  if (!env2.ok) {
    return json(env, { error: 'prive_ferme',
      detail: (env2.data && env2.data.message) || ('HTTP ' + env2.status) }, 502);
  }

  const trace = { at: new Date().toISOString(), par: s.user.name, ou: 'prive' };
  await base(env).put('rappel:' + r.discord, JSON.stringify(trace), { expirationTtl: RAPPEL_TTL });
  await appendJournal(env, s, `a rappelé son permis à ${r.fiche.name} (message privé)`, ['rhRoster']);
  return json(env, { ok: true, ou: 'prive' });
}


/* ---------------------------------------------------------------------------
   Les logs de vente
   ---------------------------------------------------------------------------
   Un webhook du serveur de jeu écrit dans un salon Discord, une ligne par
   vente, sous forme d'embed :

       Vente de 54x Vin pour 540$ par Krimo Guendouzi. 270$ pour la société
       itemId: wine · jobId: 13 · jobName: Vigneron

   C'est la QUANTITÉ qui fait le quota — 54 ici. Ni l'argent brut, ni la part
   de la société.

   Deux choses à savoir avant de lire ce code.

   1. Aucun bot à faire tourner à côté. Le serveur lit le salon lui-même, en
      REST, avec le token du bot. En revanche l'intention
      « Contenu des messages » doit être activée dans le portail développeur :
      elle vaut aussi pour les réponses REST, et sans elle Discord renvoie des
      embeds vides — silencieusement.

   2. Le log ne porte AUCUN identifiant Discord, seulement le nom RP. Le
      rattachement à une fiche se fait donc par le nom, normalisé, avec une
      table d'alias pour les cas que la normalisation ne rattrape pas. Une
      vente qu'on n'arrive pas à rattacher n'est ni devinée ni jetée : elle
      est comptée à part.
   --------------------------------------------------------------------------- */

/* « Vente de 54x Vin pour 540$ par Krimo Guendouzi. 270$ pour la société »
   Le nom est pris jusqu'au point, non gourmand : un nom composé passe, et la
   phrase qui suit n'est pas avalée. */
const RE_VENTE = /Vente de\s+(\d[\d\s.,]*)\s*x\s+(.+?)\s+pour\s+(\d[\d\s.,]*)\s*\$\s+par\s+(.+?)\.\s+(\d[\d\s.,]*)\s*\$/i;

function nombreFr(x) {
  return parseInt(String(x).replace(/[^\d]/g, ''), 10) || 0;
}

/* La clé de rattachement. « Rémi  CASTEL » et « remi castel » sont la même
   personne ; c'est tout ce que cette fonction promet. Le reste — les surnoms,
   les noms changés en cours de route — passe par les alias. */
function clefNom(x) {
  /* \u26a0\ufe0f NFKD, pas NFD : un pseudo en police fantaisie (\u00ab \ud835\udd77\ud835\udd8e\ud835\udd9b\ud835\udd8e\ud835\udd86 \ud835\udd6e\ud835\udd94\ud835\udd91\ud835\udd8a \u00bb) est
     fait d'autres caract\u00e8res Unicode, que NFD ne touche pas. Le filtre les
     effa\u00e7ait tous et la cl\u00e9 devenait vide. Repli si elle l'est quand m\u00eame \u2014
     deux cl\u00e9s vides sont \u00e9gales, et deux personnes ne doivent jamais l'\u00eatre.
     Doit rester identique \u00e0 clefNom() du panel. */
  const base = String(x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const k = base.replace(/[^a-z0-9]+/g, ' ').trim();
  return k || base.replace(/\s+/g, ' ').trim();
}

/* Un message Discord → une vente, ou null.
   On lit l'embed et non le texte : le webhook n'écrit rien dans `content`. */
function lireVente(m, jobAttendu) {
  const e = (m.embeds && m.embeds[0]) || null;
  if (!e) return null;

  const desc = String(e.description || '');
  const g = desc.match(RE_VENTE);
  if (!g) return null;

  const champ = nom => {
    const f = (e.fields || []).find(x => String(x.name || '').toLowerCase() === nom);
    return f ? String(f.value || '').trim() : '';
  };
  const job = champ('jobname');

  /* D'autres entreprises peuvent écrire dans le même salon. On ne compte que
     la nôtre — et si le champ manque, on ne devine pas : on écarte. */
  if (jobAttendu && job.toLowerCase() !== String(jobAttendu).toLowerCase()) return null;

  const nom = g[4].trim();
  return {
    msg: String(m.id),
    ts: Date.parse(m.timestamp) || Date.now(),
    nom,
    cle: clefNom(nom),
    qte: nombreFr(g[1]),
    brut: nombreFr(g[3]),
    part: nombreFr(g[5]),
    item: champ('itemid') || String(g[2] || '').trim(),
    job,
  };
}

/* Pourquoi Discord refuse-t-il ce salon ?
   ---------------------------------------------------------------------------
   Le code 50001 « Missing Access » recouvre deux situations très différentes,
   et la deuxième ne se corrige pas en cochant des permissions :

     a) le salon est sur le serveur du panel, mais l'application n'y a pas
        accès — là, il faut lui donner « Voir les salons » et « Voir
        l'historique des messages » ;

     b) le salon est sur un AUTRE serveur Discord que celui du panel. Le
        token du bot ne vaut que là où le bot a été invité : aucune
        permission cochée ailleurs n'y changera quoi que ce soit.

   Le cas (b) est loin d'être théorique quand les logs du jeu arrivent par un
   webhook : un webhook écrit sans que le bot soit là, donc un salon peut très
   bien recevoir les ventes tout en étant hors de portée du panel.

   On distingue les deux en demandant le salon en direct : la réponse porte
   son guild_id. C'est la seule question qui départage. */
async function diagnosticSalon(env, salon) {
  const guilde = String(env.DISCORD_GUILD_ID || '');
  const res = await botFetch(env, `/channels/${salon}`);

  if (res.ok) {
    const c = await res.json().catch(() => null);
    const sien = c && String(c.guild_id || '');
    if (sien && sien !== guilde) {
      return `Ce salon appartient à un AUTRE serveur Discord (${sien}) que celui du panel `
           + `(${guilde}). Le bot n'y est pas invité, et aucune permission cochée ne peut y `
           + `remédier : il faut soit inviter l'application sur ce serveur, soit faire écrire `
           + `le webhook des logs dans un salon du serveur du domaine.`;
    }
    return `Le salon est bien sur le serveur du domaine et l'application le voit`
         + (c && c.name ? ` (#${c.name})` : '')
         + `, mais elle n'a pas pu en lire l'historique. Donnez-lui « Voir l'historique des `
         + `messages » sur ce salon.`;
  }

  if (res.status === 404) {
    return `Aucun salon ne porte cet identifiant (${salon}). Vérifiez-le : clic droit sur le `
         + `salon ▸ « Copier l'identifiant », avec le mode développeur activé.`;
  }
  return `L'application ne voit pas du tout ce salon (${salon}). Deux causes possibles : soit `
       + `il est sur un autre serveur Discord que celui du panel — le bot n'y est alors pas `
       + `invité — soit « Voir les salons » lui manque dessus. Le premier cas est fréquent `
       + `quand les logs arrivent par un webhook : un webhook écrit sans que le bot soit là.`;
}

/* Un passage de lecture. Renvoie ce qui s'est passé, pour l'afficher au panel.

   Le curseur est l'identifiant du dernier message lu : Discord rend les
   messages postérieurs avec ?after=, du plus ancien au plus récent. Au tout
   premier passage il n'y a pas de curseur — on prend le dernier lot et on
   pose le curseur dessus, sans remonter tout l'historique.

   Même si le curseur se perd ou recule, rien ne double : la clé primaire est
   l'identifiant du message. C'est le point qui décide de tout. */
const LOGS_MAX_LOTS = 5;          /* 500 messages par passage, large */

async function lireLogs(env) {
  /* Un échec doit s'ÉCRIRE, pas seulement se renvoyer.
     -------------------------------------------------------------------------
     Défaut vu en production : le passage automatique échouait toutes les deux
     minutes, sortait sans rien enregistrer, et le panel affichait « le flux
     n'a jamais été lu » — un message qui envoyait chercher au mauvais endroit
     pendant que Discord répondait, lui, très précisément. Une panne qui se
     répète en silence est une panne qu'on ne corrige jamais. */
  const echec = async (erreur) => {
    const avant = await base(env).get('logs:etat', 'json');
    const etat = {
      at: new Date().toISOString(),
      lus: 0, gardees: 0, ecartees: 0,
      dernier: (avant && avant.dernier) || null,
      dernierSucces: (avant && !avant.erreur && avant.at) || (avant && avant.dernierSucces) || null,
      erreur,
    };
    try { await base(env).put('logs:etat', JSON.stringify(etat)); } catch (e) { /* tant pis */ }
    return Object.assign({ ok: false }, etat);
  };

  const salon = String(env.DISCORD_LOGS_CHANNEL || '').trim();
  if (!/^\d{17,20}$/.test(salon)) {
    return echec('Aucun salon de logs déclaré (DISCORD_LOGS_CHANNEL).');
  }

  const job = (env.DISCORD_LOGS_JOB || 'Vigneron').trim();
  let curseur = await base(env).get('logs:apres');
  let lus = 0, gardees = 0, ecartees = 0, dernier = curseur || null;

  for (let lot = 0; lot < LOGS_MAX_LOTS; lot++) {
    const q = curseur ? `?after=${curseur}&limit=100` : '?limit=100';
    const res = await botFetch(env, `/channels/${salon}/messages${q}`);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      /* 50001 « Missing Access » ne veut PAS dire « intention manquante » : le
         bot ne voit tout simplement pas le salon. On traduit, parce que le
         code brut de Discord envoie chercher au mauvais endroit. */
      /* On ne se contente pas de recopier le code de Discord : on lui repose
         la question qui départage vraiment les causes possibles. */
      let detail;
      if (/50001/.test(t) || res.status === 403 || res.status === 404) {
        detail = await diagnosticSalon(env, salon).catch(() => t.slice(0, 200));
      } else if (/50013/.test(t)) {
        detail = "L'application voit le salon mais n'a pas le droit d'y lire l'historique "
               + '(« Voir l\'historique des messages »).';
      } else {
        detail = t.slice(0, 200);
      }
      return echec(`Lecture du salon refusée (HTTP ${res.status}). ${detail}`);
    }
    let msgs = await res.json();
    if (!Array.isArray(msgs) || !msgs.length) break;

    /* Sans ?after, Discord rend du plus récent au plus ancien. On remet dans
       l'ordre du temps pour que le curseur finisse sur le dernier. */
    msgs = msgs.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    lus += msgs.length;

    const lignes = [];
    for (const m of msgs) {
      const v = lireVente(m, job);
      if (v) lignes.push(v); else ecartees++;
    }

    if (lignes.length) {
      /* INSERT OR IGNORE : un message déjà en base ne compte pas deux fois.
         C'est ce qui autorise à relire sans réfléchir. */
      const req = env.DB.prepare(
        'INSERT IGNORE INTO ventes (msg, ts, nom, cle, qte, brut, part, item, job) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      await env.DB.batch(lignes.map(v =>
        req.bind(v.msg, v.ts, v.nom, v.cle, v.qte, v.brut, v.part, v.item, v.job)));
      gardees += lignes.length;
    }

    dernier = msgs[msgs.length - 1].id;
    curseur = dernier;
    if (msgs.length < 100) break;
  }

  const etat = {
    at: new Date().toISOString(),
    lus, gardees, ecartees,
    dernier,
    erreur: null,
  };
  if (dernier) await base(env).put('logs:apres', String(dernier));
  await base(env).put('logs:etat', JSON.stringify(etat));
  return Object.assign({ ok: true }, etat);
}

/* Les alias de rattachement : { "clé du log" : "n° civil" }. */
async function lireAlias(env) {
  return (await base(env).get('alias', 'json')) || {};
}

/* GET /api/quota?du=<ms>&au=<ms>
   Les ventes agrégées par personne sur une période, rattachées au registre.

   Rien n'est deviné : une clé qui ne tombe sur aucune fiche et sur aucun
   alias ressort dans `orphelines`, avec son nom et son total, et le panel
   propose de la rattacher. Une vente jetée en silence, personne ne la
   retrouve ensuite. */
async function handleQuota(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json(env, { error: 'method_not_allowed' }, 405);
  }
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);

  /* Un paramètre ABSENT et un paramètre à zéro ne sont pas la même chose.
     Avec un simple « || », ?du=0 — « depuis toujours » — se serait fait
     remplacer par « il y a sept jours », et le tableau aurait paru vide. */
  const url = new URL(request.url);
  const nombre = (nom, defaut) => {
    const v = url.searchParams.get(nom);
    if (v === null || v === '') return defaut;
    const n = Number(v);
    return Number.isFinite(n) ? n : defaut;
  };
  const au = nombre('au', Date.now());
  const du = nombre('du', au - 7 * 24 * 3600 * 1000);

  /* MAX(nom) et non un simple « nom » : MySQL refuse par défaut (mode
     ONLY_FULL_GROUP_BY) une colonne non agrégée dans un GROUP BY, sauf
     dépendance fonctionnelle prouvée. ANY_VALUE() lèverait ce refus, mais
     n'existe que côté MySQL — MariaDB ne la connaît pas. MAX(), lui, est du
     SQL standard qui marche à l'identique sur les deux moteurs. Toutes les
     ventes d'une même `cle` normalisée portent en pratique le même `nom`
     (ou des variantes d'accentuation triviales) : quel que soit celui que
     MAX() retient, l'affichage reste correct. */
  const r = await env.DB.prepare(
    'SELECT cle, MAX(nom) AS nom, SUM(qte) AS qte, SUM(brut) AS brut, SUM(part) AS part, '
    + 'COUNT(*) AS n, MAX(ts) AS dernier FROM ventes '
    + 'WHERE ts >= ? AND ts < ? GROUP BY cle ORDER BY qte DESC'
  ).bind(du, au).all();

  /* SUM()/COUNT() reviennent en texte côté MariaDB (voir nombreSQL plus haut
     dans le fichier) — c'est le bug qui affichait « 0100010 » à la place de
     110 sur cette page. */
  const nb = nombreSQL;
  const lignes = (r.results || []).map(l => ({
    cle: l.cle,
    nom: l.nom,
    qte: nb(l.qte),
    brut: nb(l.brut),
    part: nb(l.part),
    n: nb(l.n),
    dernier: nb(l.dernier),
  }));

  const data = await base(env).get('data', 'json') || {};
  const roster = Array.isArray(data.rhRoster) ? data.rhRoster : [];
  const alias = await lireAlias(env);

  /* Le filtre posé sur /api/data (voir collectionsLisibles) ne servait à rien
     tant que cette route-ci restait ouverte : elle lit le même rhRoster et en
     ressortait le NUMÉRO CIVIL de tout le personnel ayant vendu, à n'importe
     quelle session valable — accès extérieur compris. Un comptable à qui on
     n'avait coché que « Facturation » n'avait qu'à appeler /api/quota.
     Le nom et le poste, eux, restent : ils sont déjà publics par conception
     (voir handleOrga, qui les sert sans aucune authentification). Ce qui ne
     doit jamais sortir, et que le commentaire de handleOrga énumère lui-même,
     c'est le numéro civil — on le retire donc précisément à qui n'a pas le
     droit de lire le registre, sans casser la page pour autant : un accès
     extérieur à qui « Quota en direct » a été légitimement coché continue de
     voir les chiffres de production. */
  const refusees = collectionsLisibles(s);
  const civilVisible = !refusees || !refusees.has('rhRoster');

  /* Deux chemins vers une fiche : le nom normalisé, ou un alias posé à la
     main. L'alias gagne — c'est une décision humaine. */
  const parClef = new Map();
  roster.forEach(f => parClef.set(clefNom(f.name), f));

  const rattachees = [], orphelines = [];
  for (const l of lignes) {
    const civil = alias[l.cle];
    const fiche = civil
      ? roster.find(f => String(f.id) === String(civil))
      : parClef.get(l.cle);
    if (fiche) {
      rattachees.push({
        civil: civilVisible ? String(fiche.id) : '', nom: fiche.name, poste: fiche.poste || '',
        vins: l.qte, brut: l.brut, part: l.part, ventes: l.n, dernier: l.dernier,
        via: civil ? 'alias' : 'nom',
      });
    } else {
      orphelines.push({ cle: l.cle, nom: l.nom, vins: l.qte, ventes: l.n, dernier: l.dernier });
    }
  }

  const etat = await base(env).get('logs:etat', 'json');
  return json(env, { du, au, rattachees, orphelines, etat: etat || null });
}

/* POST /api/alias  {cle, civil}  — rattacher une ligne orpheline, ou la
   détacher en envoyant un civil vide. Réservé à qui peut écrire le registre. */
async function handleAlias(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);
  const perms = await base(env).get('permissions', 'json') || {};
  const reg = await base(env).get('settings', 'json') || {};
  if (!canWrite(s, 'rhRoster', perms, reg.permsRO || {})) {
    return json(env, { error: 'forbidden', detail:
      'Rattacher une vente à une fiche demande le droit d\'écrire sur la page '
      + 'Employés. Votre session est vue par le serveur comme : '
      + `${s.roles.length ? s.roles.join(', ') : 'aucun rôle'}.` }, 403);
  }
  if (request.method === 'GET') return json(env, await lireAlias(env));
  if (request.method !== 'POST') return json(env, { error: 'method_not_allowed' }, 405);

  let body;
  try { body = await request.json(); }
  catch (e) { return json(env, { error: 'bad_json' }, 400); }

  const cle = clefNom(body && body.cle);
  if (!cle) return json(env, { error: 'bad_shape' }, 400);

  const civil = String((body && body.civil) || '').trim();
  /* Même lecture-modification-écriture que partout ailleurs : deux
     rattachements faits en même temps s'écrasaient. */
  const alias = await verrou(env, 'alias', async () => {
    const table = await lireAlias(env);
    if (civil) table[cle] = civil; else delete table[cle];
    await base(env).put('alias', JSON.stringify(table));
    return table;
  });
  await appendJournal(env, s,
    civil ? `a rattaché les ventes de « ${body.cle} » à la fiche ${civil}`
          : `a détaché les ventes de « ${body.cle} »`, ['rhRoster']);
  return json(env, { ok: true, alias });
}

/* GET | POST /api/logs — l'état du flux, et une relecture à la demande. */
async function handleLogs(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);

  if (request.method === 'POST') {
    /* Le panel affichait « vous n'avez pas le droit d'envoyer un rappel » sur
       ce refus-ci, faute de savoir ce qui avait été refusé. Le serveur le dit
       désormais lui-même, et nomme la condition exacte. */
    if (!s.isPatron) return json(env, { error: 'forbidden', detail:
      'Relancer la lecture du salon est réservé au patron. Le serveur attend '
      + `l'un de ces rôles : ${patronRoles(env).join(', ')}. `
      + `Il vous en voit ${s.roles.length ? s.roles.length + ' : ' + s.roles.join(', ') : 'aucun'}. `
      + `Un rôle absent de cette liste alors que vous l'avez sur Discord est un rôle « géré » `
      + `par une intégration — le panel les écarte — ou un rôle que l'application ne voit pas.` }, 403);
    return json(env, await lireLogs(env));
  }
  const etat = await base(env).get('logs:etat', 'json');
  return json(env, etat || { at: null, lus: 0, gardees: 0, erreur: 'jamais lu' });
}

/* GET | PUT /api/data
   Les données de travail du panel (employés, factures, blacklist…).
   Tout est rangé sous une seule clé : c'est peu volumineux, et ça évite
   qu'une sauvegarde partielle laisse le panel dans un état incohérent.

   Lecture et écriture sont ouvertes à tout membre connecté : c'est un outil
   d'équipe. L'appartenance au serveur Discord est revérifiée à chaque appel.  */
/* D1 refuse une ligne de plus de 2 Mo. On s'arrête bien avant, pour que la
   limite se manifeste par un message clair et pas par une erreur SQL. */
const DATA_MAX = 1500 * 1024;   // 1,5 Mo, très large devant l'usage réel

async function handleData(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);

  /* ?meta=1 → juste le numéro de révision. C'est ce que les navigateurs
     interrogent en boucle : quelques octets au lieu de tout le contenu. */
  const url = new URL(request.url);
  if (request.method === 'GET' && url.searchParams.get('meta') === '1') {
    const m = await base(env).get('datameta', 'json');
    return json(env, m || { rev: 0 });
  }

  if (request.method === 'GET') {
    const d = await base(env).get('data', 'json');
    const m = await base(env).get('datameta', 'json');

    /* Un accès extérieur ne reçoit pas l'identité des gens du domaine. */
    const refusees = collectionsLisibles(s);
    const sortie = {};
    for (const [k, v] of Object.entries(d || {})) {
      if (!refusees || !refusees.has(k)) sortie[k] = v;
    }
    return json(env, Object.assign(sortie, { _meta: m || { rev: 0 } }));
  }

  if (request.method === 'PUT') {
    const raw = await request.text();
    if (raw.length > DATA_MAX) return json(env, { error: 'too_large' }, 413);

    let body;
    try { body = JSON.parse(raw); }
    catch (e) { return json(env, { error: 'bad_json' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(env, { error: 'bad_shape' }, 400);
    }

    /* Description de l'action, pour le journal. Ce n'est pas une donnée. */
    const note = typeof body._log === 'string' ? body._log.slice(0, 300) : '';
    delete body._log;

    /* Contrôle d'écriture collection par collection. Le filtrage fait dans
       le navigateur n'est qu'un confort : c'est ICI que ça se décide. */
    const perms = await base(env).get('permissions', 'json') || {};
    const settings = await base(env).get('settings', 'json') || {};
    const ro = settings.permsRO || {};
    const refuses = [];

    for (const k of Object.keys(body)) {
      if (!canWrite(s, k, perms, ro)) refuses.push(k);
    }
    if (refuses.length) {
      return json(env, { error: 'forbidden', collections: refuses }, 403);
    }

    /* Fusion : on ne remplace que les collections envoyées, les autres
       restent intactes. Deux personnes qui travaillent sur des pages
       différentes ne s'écrasent donc pas mutuellement — à condition que la
       relecture et la réécriture ne se chevauchent pas, d'où la file. */
    const resultat = await verrou(env, 'data', async () => {
      const current = await base(env).get('data', 'json') || {};
      for (const [k, v] of Object.entries(body)) {
        current[String(k).slice(0, 64)] = v;
      }

      delete current._meta;
      const out = JSON.stringify(current);
      if (out.length > DATA_MAX) return { tropGros: true };
      await base(env).put('data', out);

      /* La révision s'incrémente à chaque écriture : c'est elle qui prévient
         les autres navigateurs qu'ils travaillent sur une version périmée. */
      const prev = await base(env).get('datameta', 'json');
      const meta = {
        rev: ((prev && prev.rev) || 0) + 1,
        by: s.user.name,
        at: new Date().toISOString(),
        keys: Object.keys(body),
      };
      await base(env).put('datameta', JSON.stringify(meta));
      return { meta };
    });

    if (resultat.tropGros) return json(env, { error: 'too_large' }, 413);
    /* Le journal a sa propre file : on l'écrit APRÈS avoir rendu celle du
       document, pour qu'aucune section n'en attende deux à la fois. */
    if (note) await appendJournal(env, s, note, Object.keys(body));

    return json(env, { ok: true, saved: Object.keys(body), rev: resultat.meta.rev });
  }

  return json(env, { error: 'method_not_allowed' }, 405);
}

/* ==========================================================================
   DÉCLARER SON ABSENCE — depuis l'espace personnel
   --------------------------------------------------------------------------
   Jusqu'ici une absence ne s'inscrivait que depuis la page Recrutement, par
   quelqu'un des RH. L'intéressé, lui, prévenait sur Discord et espérait que
   ça soit reporté. Deux endroits pour une même information, donc un des deux
   finit par mentir.

   Trois décisions structurent cette route :

   · le nom vient de la SESSION, jamais du corps de la requête. On ne déclare
     que sa propre absence — sinon n'importe qui mettrait le voisin en congé ;

   · c'est le SERVEUR qui écrit dans le registre, pas le navigateur. Écrire
     rhAbsences depuis le panel exige le droit sur la page Recrutement : le
     donner à toute l'équipe pour cette seule fonction ouvrirait aussi la
     suppression des absences des autres. Ici, la seule ligne qu'une personne
     peut toucher est la sienne, et le serveur s'en assure ;

   · le message Discord part APRÈS l'écriture. Si Discord refuse, l'absence
     est quand même enregistrée et la réponse le dit — l'inverse perdrait une
     information RH pour une histoire de permission de salon.
   ========================================================================== */

const ABSENCE_MIN_MS = 5 * 60 * 1000;   /* deux déclarations d'affilée = maladresse */

function absenceSalon(env) {
  const salon = String(env.DISCORD_ABSENCE_CHANNEL || '').trim();
  return /^\d{17,20}$/.test(salon) ? salon : '';
}

/* jj/mm/aaaa, et rien d'autre. Une date libre finirait par arriver dans le
   registre sous quinze formes différentes. */
function dateFRValide(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || '').trim());
  if (!m) return null;
  const j = +m[1], mo = +m[2], a = +m[3];
  if (mo < 1 || mo > 12 || j < 1 || j > 31 || a < 2020 || a > 2100) return null;
  const d = new Date(Date.UTC(a, mo - 1, j));
  if (d.getUTCDate() !== j || d.getUTCMonth() !== mo - 1) return null;   /* 31/02 */
  return `${m[1]}/${m[2]}/${m[3]}`;
}

function messageAbsence(nom, ligne, motif) {
  const propre = v => String(v == null ? '' : v).replace(/[`@]/g, '');
  return `**Absence déclarée**\n`
       + `> **${propre(nom).slice(0, 60)}** — ${propre(ligne)}\n`
       + `> Motif : ${propre(motif || 'non précisé').slice(0, 200)}`;
}

/* ---------------------------------------------------------------------------
   QUI est en train d'écrire — et pourquoi ce n'est pas son pseudo
   ---------------------------------------------------------------------------
   /api/absence et /api/linterna laissent chacun écrire SA propre ligne. Il
   fallait donc savoir de qui il s'agit. Elles se fiaient au nom affiché —
   c'est-à-dire au surnom Discord, que la personne choisit elle-même. Prendre
   le surnom d'un collègue suffisait alors à écrire à sa place : déclarer une
   absence sur sa ligne, passer sa fiche en « absent », ou remettre sa récolte
   Linterna à zéro — donc lui coûter sa prime. Rien ne le signalait, et le
   journal accusait la victime, puisqu'il n'enregistre qu'un nom.

   L'identité, ici, c'est l'IDENTIFIANT DISCORD. Il est attribué par Discord,
   il ne se change pas, et le registre le porte déjà (champ `discord` d'une
   fiche — c'est le lien qu'utilise déjà handleFolkos pour ouvrir le panel).
   Le pseudo ne sert plus qu'à l'affichage.

   Ce qu'on ne fait PAS : rattacher automatiquement un compte à une fiche
   parce que les noms se ressemblent. Ce serait refaire le trou par la fenêtre
   — il suffirait de prendre le surnom de quelqu'un pour hériter de sa fiche.
   Une fiche qui ne porte pas l'identifiant n'est pas la sienne, point. On
   signale le rapprochement possible (voir `candidats`), c'est aux RH de le
   confirmer en inscrivant l'identifiant sur la fiche.
   --------------------------------------------------------------------------- */
function ficheParDiscord(roster, idDiscord) {
  const cible = String(idDiscord || '').trim();
  if (!cible) return null;
  return roster.find(f => f && String(f.discord || '').trim() === cible) || null;
}

function liaisonFiche(roster, session) {
  const fiche = ficheParDiscord(roster, session.user.id);
  if (fiche) return { etat: 'liee', fiche, nom: String(fiche.name || '').trim() };

  /* Aucune fiche ne porte cet identifiant. On regarde si le pseudo ressemble
     à une ou plusieurs fiches — UNIQUEMENT pour le dire. Deux fiches
     homonymes, ou une fiche déjà rattachée à quelqu'un d'autre, sont des cas
     que seule une personne peut trancher. */
  const clef = clefNom(session.user.name);
  const candidats = clef ? roster.filter(f => f && clefNom(f.name) === clef) : [];

  return {
    etat: candidats.length === 0 ? 'absente'
        : candidats.length > 1  ? 'ambigue'
        : 'a_confirmer',
    fiche: null,
    nom: String(session.user.name || '').trim(),
    candidats: candidats.slice(0, 5).map(f => ({
      civil: String(f.id || ''),
      nom: String(f.name || ''),
      dejaLie: !!String(f.discord || '').trim(),
    })),
  };
}

/* Retrouve MA ligne dans une liste (absences, récoltes).
   L'identifiant d'abord. À défaut — les lignes d'avant ce correctif n'en
   portent pas —, on adopte une ligne au nom de la FICHE, et seulement quand
   la fiche est rattachée : ce nom-là vient du registre, tenu par les RH, pas
   du surnom que la personne se donne. C'est ce qui rend la reprise des
   anciennes lignes sûre au lieu de rouvrir la porte. */
function indexDeMaLigne(liste, session, liaison) {
  const moi = String(session.user.id);
  let i = liste.findIndex(x => x && String(x.discord || '').trim() === moi);
  if (i >= 0) return i;

  if (liaison.fiche) {
    const clef = clefNom(liaison.fiche.name);
    i = liste.findIndex(x => x && !String(x.discord || '').trim()
                          && clefNom(x.name) === clef);
    if (i >= 0) return i;
  }
  return -1;
}

async function handleAbsence(request, env) {
  if (request.method !== 'POST') return json(env, { error: 'method' }, 405);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  if (!body || typeof body !== 'object') body = {};

  const s = await currentSession(request, env, typeof body.token === 'string' ? body.token : null);
  if (!s) return json(env, { error: 'unauthorized' }, 401);

  /* Un accès extérieur — comptable, partenaire — n'est pas un employé du
     domaine : il n'a pas d'absence à déclarer. */
  if (s.invite) return json(env, { error: 'forbidden', detail:
    "Un accès extérieur ne peut pas déclarer d'absence." }, 403);

  const du = dateFRValide(body.du);
  if (!du) return json(env, { error: 'date', detail:
    'La date de départ doit être au format jj/mm/aaaa.' }, 400);

  const indef = body.indef === true;
  const au = indef ? null : dateFRValide(body.au);
  if (!indef && !au) return json(env, { error: 'date', detail:
    'Indiquez une date de retour au format jj/mm/aaaa, ou cochez « retour indéfini ».' }, 400);

  const motif = String(body.motif || '').trim().slice(0, 200);

  const cle = 'absence:' + s.user.id;
  if (await base(env).get(cle)) {
    return json(env, { error: 'trop_vite', detail:
      'Vous venez de déclarer une absence. Attendez quelques minutes.' }, 429);
  }

  const court = d => String(d).slice(0, 5);
  const ligne = indef ? `${court(du)} → indéfini` : `${court(du)} → ${court(au)}`;

  /* Même file d'attente que /api/data : la déclaration relit et réécrit le
     document entier, et ne doit pas se croiser avec un enregistrement du
     panel — sinon l'un des deux disparaît sans un mot. */
  const resultat = await verrou(env, 'data', async () => {
    const data = await base(env).get('data', 'json') || {};
    const roster = Array.isArray(data.rhRoster) ? data.rhRoster : [];

    /* QUI écrit : l'identifiant Discord, jamais le pseudo (voir liaisonFiche).
       Le nom retenu vient de la FICHE quand elle est rattachée — le registre
       fait foi —, du pseudo seulement à défaut, et pour l'affichage seul. */
    const liaison = liaisonFiche(roster, s);
    const nom = liaison.nom;
    const row = { name: nom, discord: String(s.user.id), range: ligne,
                  indef, motif: motif || 'Congé', parSoi: true };

    const abs = Array.isArray(data.rhAbsences) ? data.rhAbsences : [];

    /* Une deuxième déclaration remplace la première : quelqu'un qui corrige
       ses dates ne doit pas se retrouver avec deux absences à son nom. */
    const i = indexDeMaLigne(abs, s, liaison);
    if (i >= 0) abs[i] = row; else abs.unshift(row);
    data.rhAbsences = abs;

    /* Le registre RH suit, mais UNIQUEMENT sur la fiche qui porte notre
       identifiant Discord. C'est ici que se jouait l'usurpation : chercher la
       fiche par le nom affiché laissait passer sa fiche en « absent » à qui
       prenait son surnom. Une personne sans fiche rattachée déclare quand
       même son absence — elle ne va pas attendre les RH —, mais sa
       déclaration ne touche alors AUCUNE fiche. */
    let ficheTrouvee = false;
    if (liaison.fiche) {
      liaison.fiche.status = 'absent';
      liaison.fiche.absence = ligne;
      liaison.fiche.motif = row.motif;
      ficheTrouvee = true;
    }

    delete data._meta;
    const out = JSON.stringify(data);
    if (out.length > DATA_MAX) return { tropGros: true };
    await base(env).put('data', out);

    const prev = await base(env).get('datameta', 'json');
    const meta = {
      rev: ((prev && prev.rev) || 0) + 1,
      by: nom,
      at: new Date().toISOString(),
      keys: ficheTrouvee ? ['rhAbsences', 'rhRoster'] : ['rhAbsences'],
    };
    await base(env).put('datameta', JSON.stringify(meta));
    return { meta, liaison, nom };
  });

  if (resultat.tropGros) return json(env, { error: 'too_large' }, 413);
  const meta = resultat.meta;
  const liaison = resultat.liaison;
  const nom = resultat.nom;
  await appendJournal(env, s, `a déclaré son absence (${ligne})`, meta.keys);

  try { await base(env).put(cle, '1', { expirationTtl: Math.ceil(ABSENCE_MIN_MS / 1000) }); }
  catch (e) { /* le garde-fou est un confort, pas une sécurité */ }

  /* Le salon, ensuite. Un refus de Discord ne remet pas en cause l'absence. */
  const salon = absenceSalon(env);
  if (!salon) return json(env, { ok: true, rev: meta.rev, annonce: false, raison: 'pas_de_salon', liaison });

  let annonce = false, detail = null;
  try {
    const r = await botPost(env, `/channels/${salon}/messages`, {
      content: messageAbsence(nom, ligne, motif || 'Congé'),
      /* Personne n'est mentionné : c'est une information, pas une alerte. */
      allowed_mentions: { parse: [] },
    });
    annonce = !!(r && r.ok);
    if (!annonce) detail = 'discord ' + (r && r.status);
  } catch (e) { detail = String((e && e.message) || e); }

  /* `liaison` accompagne la réponse pour que le panel puisse dire à la
     personne que sa déclaration n'est rattachée à aucune fiche — et aux RH
     quelle fiche il faudrait compléter. Voir liaisonFiche : `ambigue` veut
     dire que plusieurs fiches portent ce nom, cas que personne d'autre qu'un
     humain ne peut trancher. */
  return json(env, { ok: true, rev: meta.rev, annonce, detail, liaison });
}

/* ==========================================================================
   LINTERNA — la récolte de raisins, déclarée par l'intéressé
   --------------------------------------------------------------------------
   Même principe que l'absence, et pour la même raison : le nom vient de la
   SESSION, et c'est le serveur qui écrit. Un employé n'a pas le droit
   d'écrire la collection depuis son navigateur — le lui donner pour cette
   seule fonction lui ouvrirait la récolte de toute l'équipe, alors que ce
   nombre vaut de l'argent sur la prime.

   Deux modes, et le second existe pour une raison précise : « ajout » pour
   la marche normale, « total » pour corriger. Sans lui, un 500 tapé à la
   place de 50 resterait au dossier jusqu'à la clôture.
   ========================================================================== */

const RAISINS_MAX = 100000;   /* garde-fou : au-delà c'est une faute de frappe */

async function handleLinterna(request, env) {
  if (request.method !== 'POST') return json(env, { error: 'method' }, 405);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  if (!body || typeof body !== 'object') body = {};

  const s = await currentSession(request, env, typeof body.token === 'string' ? body.token : null);
  if (!s) return json(env, { error: 'unauthorized' }, 401);
  if (s.invite) return json(env, { error: 'forbidden', detail:
    "Un accès extérieur ne récolte pas : il n'a pas de récolte à déclarer." }, 403);

  const n = Math.round(Number(body.raisins));
  if (!Number.isFinite(n)) return json(env, { error: 'nombre', detail:
    'Indiquez un nombre de raisins.' }, 400);

  const mode = body.mode === 'total' ? 'total' : 'ajout';
  if (mode === 'ajout' && n <= 0) return json(env, { error: 'nombre', detail:
    'Le nombre à ajouter doit être positif. Pour corriger à la baisse, passez par « Corriger mon total ».' }, 400);
  if (n < 0) return json(env, { error: 'nombre', detail: 'Un total ne peut pas être négatif.' }, 400);
  if (n > RAISINS_MAX) return json(env, { error: 'nombre', detail:
    `${n.toLocaleString('fr-FR')} raisins, c'est plus que tout ce que le domaine récolte en une saison — vérifiez le chiffre.` }, 400);

  /* Même file d'attente que /api/data. Elle compte doublement ici : un
     double-clic envoie deux ajouts, et sans file les deux lisaient le même
     total d'avant — l'un des deux ajouts se perdait, alors que la réponse
     annonçait « ok » aux deux. */
  const resultat = await verrou(env, 'data', async () => {
    const data = await base(env).get('data', 'json') || {};
    const roster = Array.isArray(data.rhRoster) ? data.rhRoster : [];

    /* Même identité que pour l'absence, et l'enjeu est ici plus direct : la
       récolte vaut de l'argent sur la prime, et le mode « total » REMPLACE la
       valeur. Se fier au pseudo permettait de remettre la récolte d'un
       collègue à zéro en prenant son surnom une minute. */
    const liaison = liaisonFiche(roster, s);
    const nom = liaison.nom;

    const liste = Array.isArray(data.linterna) ? data.linterna : [];

    const i = indexDeMaLigne(liste, s, liaison);
    const avant = i >= 0 ? (Number(liste[i].raisins) || 0) : 0;
    const apres = mode === 'total' ? n : avant + n;
    if (apres > RAISINS_MAX) return { plafond: true };

    const ligne = { name: nom, discord: String(s.user.id), raisins: apres,
                    at: new Date().toISOString() };
    if (i >= 0) liste[i] = ligne; else liste.unshift(ligne);
    data.linterna = liste;

    delete data._meta;
    const out = JSON.stringify(data);
    if (out.length > DATA_MAX) return { tropGros: true };
    await base(env).put('data', out);

    const prev = await base(env).get('datameta', 'json');
    const meta = { rev: ((prev && prev.rev) || 0) + 1, by: nom,
                   at: new Date().toISOString(), keys: ['linterna'] };
    await base(env).put('datameta', JSON.stringify(meta));
    return { meta, avant, apres };
  });

  if (resultat.plafond) return json(env, { error: 'nombre', detail:
    'Ce total dépasse le garde-fou du domaine — corrigez plutôt votre total.' }, 400);
  if (resultat.tropGros) return json(env, { error: 'too_large' }, 413);

  const { meta, avant, apres, liaison } = resultat;
  await appendJournal(env, s,
    mode === 'total' ? `a corrigé sa récolte Linterna à ${apres}`
                     : `a déclaré ${n} raisin(s) à la Linterna`, ['linterna']);

  return json(env, { ok: true, rev: meta.rev, avant, total: apres, liaison });
}

/* POST /api/logout */
async function handleLogout(request, env) {
  /* En GET, cette route se déclenchait depuis n'importe quel site tiers par
     une simple balise <img src="https://…/api/logout">, cookie de session
     joint automatiquement (SameSite=None) : de quoi déconnecter quelqu'un en
     boucle sans qu'il comprenne pourquoi. En POST, elle passe par le contrôle
     d'origine (voir exigerOrigine). */
  if (request.method !== 'POST') return json(env, { error: 'method' }, 405);

  const sid = cookieSid(request) || bearer(request);
  if (sid) await base(env).delete('sess:' + sid);
  /* Le cookie est effacé dans tous les cas, même sans jeton reconnu :
     un navigateur qui porterait un cookie déjà périmé ou invalide doit
     quand même repartir sans lui. */
  return json(env, { ok: true }, 200, entetesEffacerCookie());
}

/* ---------------------------------------------------------------------------
   Point d'entrée
   --------------------------------------------------------------------------- */

/* ==========================================================================
   RAPPEL D'AGENDA — trois heures avant l'événement
   --------------------------------------------------------------------------
   Le passage périodique qui lit déjà les ventes sert aussi à ça : il regarde
   l'agenda et prévient le salon quand un événement commercial approche.

   Quatre décisions qui méritent d'être écrites :

   · l'heure de l'agenda est celle de PARIS, pas celle du serveur. Un événement
     saisi « 18:00 » se joue à 18 h au domaine, quel que soit le fuseau de la
     machine qui lit. Le décalage se relit à l'instant visé et non à l'instant
     courant : une semaine qui enjambe le changement d'heure décalerait le
     rappel d'une heure entière ;

   · la fenêtre fait dix minutes, alors que le passage revient toutes les deux.
     Un passage qui saute un tour — redémarrage, machine chargée — ne doit pas
     faire perdre le rappel ;

   · la clé anti-doublon est posée AVANT l'envoi. Un salon qui reçoit le même
     rappel toutes les deux minutes est pire qu'un rappel manqué. Si l'envoi
     échoue, la clé est retirée pour que le passage suivant réessaie — dans la
     limite de la fenêtre ;

   · un événement créé moins de trois heures avant son début ne déclenche
     rien. Il est déjà passé sous la fenêtre au moment où on l'écrit, et
     inventer un rappel « tout de suite » n'aiderait personne.

   Le message part par le BOT, pas par un webhook. Le bot sait déjà écrire
   dans un salon — c'est ainsi que partent les rappels de permis — et un
   identifiant de salon n'est pas un secret : il se lit dans backend/.env,
   au vu de tous, là où une adresse de webhook aurait dû être posée à part et
   protégée. Une autorisation de moins à faire circuler.
   ========================================================================== */

const RAPPEL_AVANT_MS = 3 * 3600 * 1000;
const RAPPEL_FENETRE_MS = 10 * 60 * 1000;

/* Le décalage de Paris à un instant donné : on lit l'heure murale parisienne
   dans un format ISO, on la relit comme si elle était en UTC, et l'écart avec
   l'instant réel EST le décalage. Vaut +1 h l'hiver, +2 h l'été. */
function decalageParis(t) {
  const sec = Math.floor(t / 1000) * 1000;
  const mur = new Date(sec).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' });
  return Date.parse(mur.replace(' ', 'T') + 'Z') - sec;
}

/* « 03/09/2026 » + « 18:00 », lus comme heure de Paris → instant epoch. */
function instantParis(dateFR, heure) {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(dateFR || '').trim());
  const h = /^(\d{1,2}):(\d{2})$/.exec(String(heure || '').trim());
  if (!d || !h) return null;
  const mur = Date.UTC(+d[3], +d[2] - 1, +d[1], +h[1], +h[2], 0, 0);
  if (!Number.isFinite(mur)) return null;
  /* Deux passes : la première donne un instant approché, la seconde relit le
     décalage À CET INSTANT-LÀ. */
  const approx = mur - decalageParis(mur);
  return mur - decalageParis(approx);
}

/* Les rôles à réveiller, séparés par des virgules dans backend/.env. On ne
   garde que ce qui ressemble à un identifiant Discord : une virgule en trop
   ou un nom de rôle glissé par erreur ne doit pas partir dans le message. */
function rolesAgenda(env) {
  return String(env.DISCORD_AGENDA_ROLES || '')
    .split(',').map(r => r.trim()).filter(r => /^\d{17,20}$/.test(r));
}

function messageRappel(e, mention) {
  const propre = v => String(v == null ? '' : v).replace(/[`@]/g, '');
  const titre = propre(e.title || 'Événement').slice(0, 120);
  const desc = propre(e.desc || '').slice(0, 300);
  const fin = e.heure_fin ? ` – ${propre(e.heure_fin)}` : '';
  return `${mention}**Dans 3 heures — ${titre}**\n`
       + `> ${propre(e.date)} · ${propre(e.heure)}${fin}\n`
       + (desc ? `> ${desc}` : '> _pas de description_');
}

/* Les événements de l'agenda qui doivent être annoncés maintenant. */
function evenementsARappeler(agenda, maintenant) {
  return (Array.isArray(agenda) ? agenda : []).filter(e => {
    if (!e || e.vis !== 'commercial') return false;
    const debut = instantParis(e.date, e.heure);
    if (debut === null) return false;
    const reste = debut - maintenant;
    return reste <= RAPPEL_AVANT_MS && reste > RAPPEL_AVANT_MS - RAPPEL_FENETRE_MS;
  });
}

function cleRappel(e) {
  return 'agenda:rappel:' + [e.date, e.heure, String(e.title || '')].join('|').slice(0, 200);
}

async function rappelsAgenda(env) {
  const salon = String(env.DISCORD_AGENDA_CHANNEL || '').trim();
  /* Pas de salon déclaré, pas de rappel — et surtout pas d'erreur : le domaine
     peut très bien ne pas vouloir de cette annonce. */
  if (!/^\d{17,20}$/.test(salon)) return { envoyes: 0, raison: 'pas_de_salon' };

  const d = await base(env).get('data', 'json');
  const cibles = evenementsARappeler(d && d.agenda, Date.now());
  if (!cibles.length) return { envoyes: 0 };

  const roles = rolesAgenda(env);
  const mention = roles.length ? roles.map(r => `<@&${r}>`).join(' ') + ' ' : '';

  let envoyes = 0;
  for (const e of cibles) {
    const cle = cleRappel(e);
    /* La marque « déjà annoncé » est posée ET vérifiée en une seule
       instruction (INSERT IGNORE, voir casValeur) : lire puis écrire en deux
       temps laissait deux instances passer toutes les deux entre les deux, et
       l'événement était annoncé deux fois dans le salon. Celle qui perd
       l'échange passe son chemin. */
    if (!(await base(env).casValeur(cle, null, '1', { expirationTtl: 7 * 24 * 3600 }))) continue;

    let ok = false;
    try {
      const r = await botPost(env, `/channels/${salon}/messages`, {
        content: messageRappel(e, mention),
        /* Sans cette liste, Discord accepte le message et ne réveille
           personne — en silence, avec un code 200. Et « parse: [] » interdit
           @everyone : un rappel d'agenda n'a pas à sonner chez tout le
           serveur, même si quelqu'un écrit « @everyone » dans un titre. */
        allowed_mentions: { parse: [], roles },
      });
      ok = !!(r && r.ok);
    } catch (err) { ok = false; }

    /* Envoi manqué : on retire la marque pour que le passage suivant retente,
       tant que la fenêtre de dix minutes n'est pas refermée. */
    if (ok) envoyes++;
    else { try { await base(env).delete(cle); } catch (err2) { /* sans effet */ } }
  }
  return { envoyes };
}

export default {
  /* Le passage périodique (toutes les deux minutes, voir server.js) : le
     serveur va lire le salon des logs tout seul, aucun bot à faire tourner à
     côté. Une erreur ici ne doit jamais faire tomber le serveur : elle est
     rangée dans logs:etat, et le panel l'affiche à la place des chiffres. */
  async scheduled(evenement, env, ctx) {
    /* Une instance à la fois. Chaque processus a son propre node-cron, donc
       avec plusieurs instances la tâche se déclencherait partout à la même
       minute : autant de lectures du salon Discord, et des rappels en
       concurrence. Le verrou est pris SANS attente : si une autre instance
       est déjà dessus, celle-ci passe son tour — le prochain passage est dans
       deux minutes, et la lecture des logs comme les rappels rattrapent
       d'eux-mêmes ce qu'ils auraient manqué. */
    ctx.waitUntil(verrou(env, 'tache', async () => {
      try {
        await lireLogs(env);
      } catch (e) {
        try {
          await base(env).put('logs:etat', JSON.stringify({
            at: new Date().toISOString(), lus: 0, gardees: 0,
            erreur: String((e && e.message) || e),
          }));
        } catch (e2) { /* si même ça échoue, le prochain passage réessaiera */ }
      }

      /* Les rappels d'agenda vivent dans LEUR propre try : une lecture de logs
         qui échoue ne doit pas emporter l'annonce d'un événement, et
         réciproquement. */
      try {
        await rappelsAgenda(env);
      } catch (e) { /* le passage suivant réessaiera, la fenêtre le permet */ }
    }, { attente: 0 }).catch(e => {
      /* Place prise par une autre instance : rien à faire. Le corps ci-dessus
         attrape déjà tout le reste, donc autre chose ici serait une surprise
         — on la note, sans faire tomber le serveur. */
      if (!(e && e.verrouOccupe)) console.error('[tache]', e);
    }));
  },

  async fetch(request, env, ctx) {
    return ajusterCors(await this.repondre(request, env, ctx), request, env);
  },

  async repondre(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    /* Rien d'autre ne se décide avant d'avoir écarté une requête déclenchée
       par un site tiers (voir exigerOrigine) : pas de lecture en base, pas de
       session relue, pas d'effet de bord. */
    if (!exigerOrigine(request, url, env)) {
      return json(env, { error: 'origine_refusee', detail:
        "Cette requête vient d'un autre site que le panel. Si vous voyez ce "
        + "message depuis le panel lui-même, c'est que SITE_URL/SITE_URLS ne "
        + "correspond pas à l'adresse réellement utilisée (backend/.env)." }, 403);
    }

    /* Garde-fou : une variable oubliée donne un message clair
       plutôt qu'une erreur incompréhensible. */
    for (const key of ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET',
                       'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'SITE_URL']) {
      if (!env[key]) {
        return json(env, { error: 'config', missing: key }, 500);
      }
    }
    if (!env.DB) {
      return json(env, { error: 'config', missing: 'DB', detail:
        "La base MariaDB/MySQL n'est pas reliée. Vérifiez DB_HOST, DB_PORT, DB_USER, "
        + "DB_PASSWORD et DB_NAME dans backend/.env, et que le serveur de base de données "
        + "est bien démarré, puis relancez l'API (voir backend/README.md, §2 et §3)." }, 500);
    }

    /* Les lignes périmées ne s'effacent pas toutes seules dans SQLite. */
    ctx.waitUntil(menage(env));

    try {
      switch (url.pathname) {
        case '/api/version':     return json(env, {
          version: VERSION,
          /* Cette liste sert à vérifier d'un coup d'œil CE QUI EST DÉPLOYÉ :
             elle doit donc correspondre exactement au switch ci-dessous.
             Il en manquait trois — 'version' (celle-ci même), 'folkos' et
             'discord' (le second nom de 'relais') : 24 annoncées pour 27
             branchées. Une route absente d'ici passe pour non déployée, et
             c'est précisément le genre de doute que cette route existe pour
             lever. En ajouter une plus bas sans l'ajouter ici, c'est
             recommencer. */
          routes: ['version', 'login', 'callback', 'folkos', 'me', 'roles', 'permissions',
                   'settings', 'orga', 'vitrine', 'upload', 'relais', 'discord',
                   'invites', 'invite-login', 'data', 'presence', 'journal', 'logout',
                   'rappel', 'avertissement', 'dispo', 'absence', 'linterna',
                   'quota', 'alias', 'journaux'],
          rappelDansLeTexte: true,   /* faux = ancienne version, le rappel partait en embed */
          categoriesTickets: categoriesTickets(env).length,
          salonLogs: /^\d{17,20}$/.test(String(env.DISCORD_LOGS_CHANNEL || '')),
          roleDispo: /^\d{17,20}$/.test(String(env.DISCORD_DISPO_ROLE || '')),
          /* De quoi vérifier d'un coup d'œil que le rappel d'agenda est en
             place : le salon déclaré, et le nombre de rôles réveillés. */
          salonAgenda: /^\d{17,20}$/.test(String(env.DISCORD_AGENDA_CHANNEL || '').trim()),
          rolesAgenda: rolesAgenda(env).length,
          salonAbsence: !!absenceSalon(env),
        });
        case '/api/login':       return await handleLogin(request, env, url);
        case '/api/callback':    return await handleCallback(request, env, url);
        case '/api/folkos':      return await handleFolkos(request, env, url);
        case '/api/me':          return await handleMe(request, env);
        case '/api/roles':       return await handleRoles(request, env);
        case '/api/permissions': return await handlePermissions(request, env);
        case '/api/settings':    return await handleSettings(request, env);
        case '/api/orga':        return await handleOrga(request, env);
        case '/api/vitrine':     return await handleVitrine(request, env);
        case '/api/upload':      return await handleUpload(request, env);
        /* Deux noms pour la même route. Les bloqueurs de publicité et les
           filtres d'entreprise coupent volontiers tout ce qui contient le mot
           « discord » dans une adresse ; /api/relais passe partout. L'ancien
           nom reste en place pour ne rien casser. */
        case '/api/relais':       return await handleDiscord(request, env);
        case '/api/discord':      return await handleDiscord(request, env);
        case '/api/dispo':        return await handleDispo(request, env);
        case '/api/absence':      return await handleAbsence(request, env);
        case '/api/linterna':     return await handleLinterna(request, env);
        case '/api/invites':      return await handleInvites(request, env);
        case '/api/invite-login': return await handleInviteLogin(request, env);
        case '/api/data':        return await handleData(request, env);
        case '/api/presence':    return await handlePresence(request, env);
        case '/api/journal':     return await handleJournal(request, env);
        case '/api/rappel':      return await handleRappel(request, env);
        case '/api/avertissement': return await handleAvertissement(request, env);
        case '/api/quota':       return await handleQuota(request, env);
        case '/api/alias':       return await handleAlias(request, env);
        case '/api/journaux':    return await handleLogs(request, env);
        case '/api/logout':      return await handleLogout(request, env);
        default:                 return json(env, { error: 'not_found' }, 404);
      }
    } catch (e) {
      const msg = String((e && e.message) || e);

      /* ⚠️ Ce bloc traduisait une erreur de QUOTA CLOUDFLARE KV — « 1 000
         écritures par jour, remises à zéro à minuit UTC ». Ce quota n'existe
         plus depuis la version 2.0 : la base est un MariaDB/MySQL sur le
         serveur du domaine, sans plafond d'écritures. Pire, le motif
         reconnaissait le mot « limit » n'importe où dans le message : une
         erreur MariaDB anodine se déguisait en panne de quota, et le panel
         conseillait d'attendre minuit pour un problème qui n'attend rien.
         On garde le principe — traduire une erreur illisible — mais pour les
         causes que CETTE base peut réellement avoir, et que le README nomme
         déjà (backend/README.md, §2). */
      if (/max_allowed_packet|ER_NET_PACKET_TOO_LARGE|Row size too large|ER_TOO_BIG_ROWSIZE/i.test(msg)) {
        return json(env, { error: 'trop_gros', detail:
          "Le fichier ou le document dépasse ce que la base accepte en une fois. "
          + "Augmentez max_allowed_packet dans la configuration MariaDB/MySQL "
          + "(32M met une marge confortable), puis redémarrez la base. "
          + "Message technique : " + msg }, 503);
      }
      if (/ECONNREFUSED|ETIMEDOUT|ER_ACCESS_DENIED|ENOTFOUND|PROTOCOL_CONNECTION_LOST/i.test(msg)) {
        return json(env, { error: 'base_injoignable', detail:
          "L'API n'arrive pas à joindre la base de données. Vérifiez qu'elle est démarrée "
          + "et que DB_HOST, DB_PORT, DB_USER, DB_PASSWORD et DB_NAME sont corrects dans "
          + "backend/.env. Message technique : " + msg }, 503);
      }
      /* Le verrou d'un document (voir verrou() et db.js) n'a pas été obtenu
         dans le délai : une autre instance écrit dessus depuis trop longtemps.
         Rien n'a été écrit ici — le panel peut réessayer tel quel. */
      if (e && e.verrouOccupe) {
        return json(env, { error: 'occupe', document: e.document || null, detail:
          msg + " Rien n'a été enregistré : réessayez dans quelques secondes. Si cela se "
          + "répète, une instance du backend est peut-être bloquée — voir ses journaux." }, 503);
      }
      return json(env, { error: 'server_error', detail: msg }, 500);
    }
  },
};
