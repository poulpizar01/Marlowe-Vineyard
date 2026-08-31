/* ============================================================================
   MARLOWE VINEYARD — Backend d'authentification Discord
   Cloudflare Worker · aucune dépendance
   ----------------------------------------------------------------------------
   Ce Worker fait trois choses :
     1. connecter un membre via Discord (OAuth2),
     2. vérifier qu'il est bien sur le serveur du domaine et lire ses rôles,
     3. stocker la matrice des accès réglée par le patron.

   Les secrets ne sont JAMAIS dans ce fichier : ils vivent dans les variables
   d'environnement Cloudflare. Ce code peut donc rester public sans risque.

   Voir README.md pour le déploiement.
   ============================================================================ */

const DISCORD = 'https://discord.com/api/v10';

/* La version du Worker EN LIGNE.
   ---------------------------------------------------------------------------
   Elle existe pour une seule raison, apprise à la dure : un correctif serveur
   qui n'a pas été redéployé se comporte exactement comme un correctif qui ne
   marche pas. On a cherché un bogue dans du code juste, pendant que l'ancien
   tournait toujours.

   /api/version répond sans authentification et ne divulgue rien : un numéro,
   et la liste des routes que CETTE version connaît. Avant de conclure qu'une
   correction serveur n'a rien changé, on la lit.

   À tenir en phase avec version.json à chaque déploiement. */
const VERSION = '1.42.1';
const SESSION_TTL = 60 * 60 * 24 * 7;   // 7 jours
const STATE_TTL   = 600;                // 10 minutes

/* ---------------------------------------------------------------------------
   Utilitaires
   --------------------------------------------------------------------------- */

function allowedOrigin(env) {
  try { return new URL(env.SITE_URL).origin; } catch (e) { return '*'; }
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(env),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env) },
  });
}

/* Page d'erreur lisible (le membre arrive ici depuis Discord, pas en fetch) */
function errorPage(title, message, env) {
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
  return new Response(html, { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* ---------------------------------------------------------------------------
   Cache en mémoire vive — et pas dans KV
   ---------------------------------------------------------------------------
   Le plan gratuit de Cloudflare KV autorise 1 000 ÉCRITURES par jour (les
   lectures, elles, sont 100 fois plus généreuses). Or les caches courts de ce
   Worker écrivaient dans KV : les rôles d'un membre toutes les 60 secondes,
   soit près de 1 500 écritures par jour et par personne connectée. Le quota
   partait en fumée avant midi, et TOUTE écriture suivante levait une erreur —
   connexion impossible, enregistrement impossible.

   Un cache de quelques dizaines de secondes n'a aucun besoin d'être durable.
   Il vit ici, dans la mémoire de l'isolat Cloudflare, et ne coûte rien. Il
   disparaît quand l'isolat est recyclé : au pire on réinterroge Discord, ce
   qui est précisément ce que le cache évitait — jamais une erreur. */
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
   La base — D1 (SQLite) derrière la façade de toujours
   ---------------------------------------------------------------------------
   Tout le fichier continue d'écrire base(env).get / .put / .delete / .list,
   mot pour mot comme avant. Seules ces quelques lignes savent qu'il y a du SQL
   derrière : si le stockage change encore un jour, il n'y aura qu'ici à
   toucher, et pas dans les vingt routes du dessus.

   Pourquoi ce déménagement : KV comptait 1 000 écritures par jour sur le plan
   gratuit — de quoi tenir une demi-journée de travail à une personne. D1 en
   compte 100 000, gratuitement lui aussi, et lit tout aussi vite.

   Les images, elles, restent dans KV (env.IMAGES) : elles s'écrivent trois
   fois par mois et pèsent lourd. C'est exactement ce pour quoi KV est bon, et
   D1 plafonne à 2 Mo par ligne. */

/* Le préfixe d'un listing est comparé avec LIKE, où % et _ sont des
   caractères spéciaux. Aucune de nos clés n'en contient, mais une échappe
   coûte trois lignes et évite une surprise le jour où l'une en contiendra. */
function echapperLike(x) {
  return String(x).replace(/[\\%_]/g, c => '\\' + c);
}

function base(env) {
  if (!env.DB) throw new Error('La base D1 n\'est pas reliée (binding DB manquant dans wrangler.toml).');

  return {
    async get(cle, type) {
      const r = await env.DB
        .prepare('SELECT val FROM kv WHERE cle = ? AND (exp IS NULL OR exp > ?)')
        .bind(cle, Date.now()).first();
      if (!r) return repriseKV(env, cle, type);
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
        'ON CONFLICT(cle) DO UPDATE SET val = excluded.val, exp = excluded.exp'
      ).bind(cle, texte, exp).run();
    },

    async delete(cle) {
      await env.DB.prepare('DELETE FROM kv WHERE cle = ?').bind(cle).run();
    },

    async list(opts) {
      const prefixe = (opts && opts.prefix) || '';
      const r = await env.DB.prepare(
        "SELECT cle FROM kv WHERE cle LIKE ? ESCAPE '\\' AND (exp IS NULL OR exp > ?) ORDER BY cle"
      ).bind(echapperLike(prefixe) + '%', Date.now()).all();
      return { keys: (r.results || []).map(x => ({ name: x.cle })) };
    },
  };
}

/* La reprise de l'ancienne base — sans commande, sans intervention
   ---------------------------------------------------------------------------
   Le jour du déménagement, D1 est vide et KV contient tout : les fiches RH,
   les réglages, la matrice des accès. Plutôt qu'un script de migration à jouer
   au bon moment — avec le risque de l'oublier, ou de le jouer deux fois — le
   premier qui réclame un document absent de D1 le fait remonter de KV, et il y
   est rangé au passage. La migration se fait donc toute seule, à la première
   ouverture du panel, sans que personne ne s'en aperçoive.

   Une fois le document dans D1, KV n'est plus jamais consulté pour lui. Ce
   détour ne concerne que les six documents durables : hors de question d'aller
   fouiller l'ancienne base pour une session ou une présence, qui n'ont aucune
   raison d'y être. */
const CLES_REPRISE = new Set(['data', 'datameta', 'settings', 'permissions', 'journal', 'invites']);

async function repriseKV(env, cle, type) {
  if (!CLES_REPRISE.has(cle) || !env.IMAGES) return null;

  /* Un document absent des deux bases ne doit pas relancer une lecture KV à
     chaque appel : on note l'échec pour une heure. */
  if (memGet('reprise:' + cle)) return null;

  let v = null;
  try { v = await env.IMAGES.get(cle); } catch (e) { return null; }
  if (v === null || v === undefined) { memSet('reprise:' + cle, 1, 3600); return null; }

  try { await base(env).put(cle, v); } catch (e) { /* on rendra la valeur quand même */ }

  if (type !== 'json') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
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

function patronRoles(env) {
  return (env.PATRON_ROLES || 'Patron,Co-Patron').split(',').map(s => s.trim()).filter(Boolean);
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
     dépendre de leur présence sur le Discord du domaine. La liste vit dans les
     variables d'environnement Cloudflare, personne ne peut s'y ajouter. */
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

  const dest = env.SITE_URL.replace(/\/+$/, '') + '/gestion.html#token=' + sid;
  return Response.redirect(dest, 302);
}

/* Lit la session depuis le header Authorization, rôles rafraîchis à chaque appel */
/* Le jeton arrive normalement dans l'en-tête Authorization. Certaines routes
   acceptent en plus de le recevoir dans le corps de la requête : un en-tête
   personnalisé oblige le navigateur à envoyer une requête préparatoire
   (OPTIONS) avant la vraie, et cette requête-là se fait parfois avaler
   silencieusement par une extension ou un réseau filtré. Sans en-tête
   personnalisé, il n'y a pas de requête préparatoire — et donc rien à bloquer.
   Le jeton reste au même endroit, vers le même serveur, en HTTPS. */
async function currentSession(request, env, jetonExplicite) {
  const sid = bearer(request) || jetonExplicite || null;
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
  return {
    user:  { id: stored.id, name: (member && member.nick) || stored.name, avatar: stored.avatar },
    roles,
    isOwner,
    isPatron: isOwner || roles.some(r => patronRoles(env).includes(r)),
  };
}

/* GET /api/me */
async function handleMe(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);
  /* Le panel a besoin de savoir s'il a affaire à un accès extérieur : il n'a
     ni rôles ni matrice, ses pages lui sont dictées ici. */
  return json(env, { user: s.user, roles: s.roles, invite: s.invite || null });
}

/* GET /api/roles */
async function handleRoles(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);
  const { list } = await guildRoles(env);
  return json(env, list.map(r => r.name));
}

/* GET | PUT /api/permissions */
async function handlePermissions(request, env) {
  if (request.method === 'GET') {
    const perms = await base(env).get('permissions', 'json');
    return json(env, perms || {});
  }

  if (request.method === 'PUT') {
    const s = await currentSession(request, env);
    if (!s) return json(env, { error: 'unauthorized' }, 401);
    if (!s.isPatron) return json(env, { error: 'forbidden' }, 403);

    let body;
    try { body = await request.json(); }
    catch (e) { return json(env, { error: 'bad_json' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(env, { error: 'bad_shape' }, 400);
    }

    /* On ne garde que des tableaux de chaînes — rien d'autre n'entre en base. */
    const clean = {};
    for (const [page, roles] of Object.entries(body)) {
      if (!Array.isArray(roles)) continue;
      clean[String(page).slice(0, 64)] = roles
        .filter(r => typeof r === 'string')
        .map(r => r.slice(0, 100))
        .slice(0, 200);
    }

    await base(env).put('permissions', JSON.stringify(clean));
    return json(env, clean);
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
  agenda:          ['agenda'],
  serviceHistory:  ['masemaine'],
  tombola:         ['tombola'],
  commandes:       ['magcommandes', 'magrecap'],
  comRunner:       ['comrunner'],
  stock:           ['magstock', 'magcommandes'],
  /* La vitrine ne se règle que depuis Paramètres, donc réservée au patron. */
  vitrine:         [],
  /* Règles du domaine : réservées au patron, comme la vitrine. */
  reglages:        [],
};

function canWrite(session, collection, perms, ro) {
  if (session.isPatron) return true;

  /* Un accès extérieur ne passe pas par les rôles Discord : ses droits sont
     la liste de pages que le patron lui a cochée. */
  if (session.invite) {
    const pages = COLLECTION_PAGES[collection];
    if (!pages) return false;
    return pages.some(page => session.invite.pages.includes(page)
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
}

/* GET /api/journal */
async function handleJournal(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);
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

  const list = await base(env).list({ prefix: 'pres:' });
  const membres = [];
  for (const k of list.keys) {
    const v = await base(env).get(k.name, 'json');
    if (v) membres.push(v);
  }
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

/* GET /api/img/{id}  —  PUBLIC
   Sert un visuel déposé depuis le panel. Mis en cache un an côté navigateur :
   l'identifiant change à chaque nouveau dépôt, donc une image ne peut jamais
   rester périmée dans le cache de quelqu'un. */
async function handleImage(request, env, id) {
  if (request.method !== 'GET') return json(env, { error: 'method' }, 405);
  if (!/^[a-z0-9]{6,40}$/.test(id)) return json(env, { error: 'not_found' }, 404);

  const bin = await env.IMAGES.getWithMetadata('img:' + id, { type: 'arrayBuffer' });
  if (!bin || !bin.value) return json(env, { error: 'not_found' }, 404);

  const type = (bin.metadata && bin.metadata.type) || 'application/octet-stream';
  return new Response(bin.value, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': allowedOrigin(env),
    },
  });
}

/* POST /api/upload  —  patron uniquement
   Le corps est le fichier brut ; le type arrive dans Content-Type. On répond
   avec l'identifiant, que le panel range dans ses données. */
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

  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  if (!IMG_TYPES.includes(type)) return json(env, { error: 'bad_type', accepte: IMG_TYPES }, 415);

  const plafond = type === 'application/pdf' ? PDF_MAX : IMG_MAX;
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json(env, { error: 'empty' }, 400);
  if (buf.byteLength > plafond) return json(env, { error: 'too_large', max: plafond }, 413);

  const id = [...crypto.getRandomValues(new Uint8Array(10))]
    .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);

  await env.IMAGES.put('img:' + id, buf, { metadata: { type, taille: buf.byteLength } });
  return json(env, { id, url: '/api/img/' + id, type, taille: buf.byteLength });
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
   L'adresse du webhook est un secret Cloudflare, jamais envoyé au navigateur :
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
      "Le secret DISCORD_WEBHOOK ne contient pas une adresse de webhook Discord valable. "
      + "Elle doit ressembler à https://discord.com/api/webhooks/<nombres>/<jeton>. "
      + "Depuis le dossier backend : npx wrangler secret put DISCORD_WEBHOOK, "
      + "puis collez l'adresse au prompt (sans guillemets, sans espace)." } };
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
async function handleInvites(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);
  if (!s.isPatron) return json(env, { error: 'forbidden' }, 403);

  const invites = await lireInvites(env);

  if (request.method === 'GET') {
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

  const texte = (x, n) => String(x == null ? '' : x).slice(0, n);
  const action = texte(body.action, 20);

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
      pages: Array.isArray(body.pages) ? body.pages.filter(p => typeof p === 'string').slice(0, 60) : [],
      ro: Array.isArray(body.ro) ? body.ro.filter(p => typeof p === 'string').slice(0, 60) : [],
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
    invites[i].pages = Array.isArray(body.pages) ? body.pages.filter(p => typeof p === 'string').slice(0, 60) : [];
    invites[i].ro    = Array.isArray(body.ro)    ? body.ro.filter(p => typeof p === 'string').slice(0, 60)    : [];
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

  inv.dernier = new Date().toISOString().slice(0, 16).replace('T', ' ');
  await base(env).put('invites', JSON.stringify(invites));

  const sid = crypto.randomUUID();
  await base(env).put('sess:' + sid, JSON.stringify({
    invite: true, code: inv.code, id: 'inv:' + inv.code, name: inv.nom, avatar: null,
  }), { expirationTtl: SESSION_TTL });

  return json(env, { token: sid, nom: inv.nom, pages: inv.pages, ro: inv.ro || [] });
}

/* GET | PUT /api/settings
   Réglages du panel. Aujourd'hui : la liste des rôles retenus comme rôles
   du domaine (les autres — partenaires, décoratifs — sont écartés). */
async function handleSettings(request, env) {
  if (request.method === 'GET') {
    const s = await base(env).get('settings', 'json');
    return json(env, s || {});
  }

  if (request.method === 'PUT') {
    const s = await currentSession(request, env);
    if (!s) return json(env, { error: 'unauthorized' }, 401);
    if (!s.isPatron) return json(env, { error: 'forbidden' }, 403);

    let body;
    try { body = await request.json(); }
    catch (e) { return json(env, { error: 'bad_json' }, 400); }

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

    await base(env).put('settings', JSON.stringify(clean));
    return json(env, clean);
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

   Le bot du VPS n'intervient à aucun moment : le Worker détient le token et
   parle à Discord directement, comme il le fait déjà pour lire les rôles.
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
      + 'dans wrangler.toml, puis redéployez.' }, 500);
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

   1. Le VPS n'intervient pas. Le Worker lit le salon lui-même, en REST, avec
      le token du bot. Ton bot peut être éteint. En revanche l'intention
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
  return String(x || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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
        'INSERT OR IGNORE INTO ventes (msg, ts, nom, cle, qte, brut, part, item, job) '
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

  const r = await env.DB.prepare(
    'SELECT cle, nom, SUM(qte) AS qte, SUM(brut) AS brut, SUM(part) AS part, '
    + 'COUNT(*) AS n, MAX(ts) AS dernier FROM ventes '
    + 'WHERE ts >= ? AND ts < ? GROUP BY cle ORDER BY qte DESC'
  ).bind(du, au).all();
  const lignes = r.results || [];

  const data = await base(env).get('data', 'json') || {};
  const roster = Array.isArray(data.rhRoster) ? data.rhRoster : [];
  const alias = await lireAlias(env);

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
        civil: String(fiche.id), nom: fiche.name, poste: fiche.poste || '',
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
    return json(env, { error: 'forbidden' }, 403);
  }
  if (request.method === 'GET') return json(env, await lireAlias(env));
  if (request.method !== 'POST') return json(env, { error: 'method_not_allowed' }, 405);

  let body;
  try { body = await request.json(); }
  catch (e) { return json(env, { error: 'bad_json' }, 400); }

  const cle = clefNom(body && body.cle);
  if (!cle) return json(env, { error: 'bad_shape' }, 400);

  const alias = await lireAlias(env);
  const civil = String((body && body.civil) || '').trim();
  if (civil) alias[cle] = civil; else delete alias[cle];
  await base(env).put('alias', JSON.stringify(alias));
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
    if (!s.isPatron) return json(env, { error: 'forbidden' }, 403);
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
    return json(env, Object.assign({}, d || {}, { _meta: m || { rev: 0 } }));
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
       différentes ne s'écrasent donc pas mutuellement. */
    const current = await base(env).get('data', 'json') || {};
    for (const [k, v] of Object.entries(body)) {
      current[String(k).slice(0, 64)] = v;
    }

    delete current._meta;
    const out = JSON.stringify(current);
    if (out.length > DATA_MAX) return json(env, { error: 'too_large' }, 413);
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
    if (note) await appendJournal(env, s, note, Object.keys(body));

    return json(env, { ok: true, saved: Object.keys(body), rev: meta.rev });
  }

  return json(env, { error: 'method_not_allowed' }, 405);
}

/* GET /api/logout */
async function handleLogout(request, env) {
  const sid = bearer(request);
  if (sid) await base(env).delete('sess:' + sid);
  return json(env, { ok: true });
}

/* ---------------------------------------------------------------------------
   Point d'entrée
   --------------------------------------------------------------------------- */

export default {
  /* Le passage périodique : le Worker va lire le salon des logs tout seul.
     Aucune ligne à écrire sur le VPS, et le bot peut être éteint. Une erreur
     ici ne doit jamais faire tomber le Worker : elle est rangée dans
     logs:etat, et le panel l'affiche à la place des chiffres. */
  async scheduled(evenement, env, ctx) {
    ctx.waitUntil((async () => {
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
    })());
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
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
        "La base D1 n'est pas reliée. Créez-la avec « npx wrangler d1 create marlowe », "
        + "recopiez son database_id dans wrangler.toml, appliquez schema.sql, puis redéployez." }, 500);
    }

    /* Les lignes périmées ne s'effacent pas toutes seules dans SQLite. */
    ctx.waitUntil(menage(env));

    try {
      /* /api/img/{id} porte l'identifiant dans le chemin : le switch ne sait
         pas filtrer là-dessus, on l'attrape avant. */
      if (url.pathname.startsWith('/api/img/')) {
        return await handleImage(request, env, url.pathname.slice('/api/img/'.length));
      }

      switch (url.pathname) {
        case '/api/version':     return json(env, {
          version: VERSION,
          routes: ['login', 'callback', 'me', 'roles', 'permissions', 'settings', 'orga',
                   'vitrine', 'upload', 'relais', 'invites', 'invite-login', 'data',
                   'presence', 'journal', 'logout', 'rappel', 'avertissement',
                   'dispo', 'quota', 'alias', 'journaux'],
          rappelDansLeTexte: true,   /* faux = ancienne version, le rappel partait en embed */
          categoriesTickets: categoriesTickets(env).length,
          salonLogs: /^\d{17,20}$/.test(String(env.DISCORD_LOGS_CHANNEL || '')),
          roleDispo: /^\d{17,20}$/.test(String(env.DISCORD_DISPO_ROLE || '')),
        });
        case '/api/login':       return await handleLogin(request, env, url);
        case '/api/callback':    return await handleCallback(request, env, url);
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

      /* Le plan gratuit compte 1 000 écritures KV par jour, remises à zéro à
         minuit UTC. Quand le compte est épuisé, chaque écriture lève une
         erreur peu parlante — autant la traduire. */
      if (/KV (PUT|DELETE)|limit|429|quota/i.test(msg)) {
        return json(env, { error: 'quota_kv', detail:
          "Le quota d'écritures de la base (1 000 par jour sur le plan gratuit) est atteint. "
          + "Il se remet à zéro à minuit UTC (2 h du matin en France). "
          + "Message technique : " + msg }, 503);
      }
      return json(env, { error: 'server_error', detail: msg }, 500);
    }
  },
};
