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
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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

/* Tous les rôles du serveur : {id -> name}, plus la liste ordonnée. */
async function guildRoles(env) {
  const cached = await env.MARLOWE.get('cache:roles', 'json');
  if (cached) return cached;

  const res = await botFetch(env, `/guilds/${env.DISCORD_GUILD_ID}/roles`);
  if (!res.ok) throw new Error('roles ' + res.status);
  const raw = await res.json();

  const list = raw
    .filter(r => r.name !== '@everyone')
    .sort((a, b) => b.position - a.position)
    .map(r => ({ id: r.id, name: r.name }));

  const out = { list, byId: Object.fromEntries(list.map(r => [r.id, r.name])) };
  await env.MARLOWE.put('cache:roles', JSON.stringify(out), { expirationTtl: 300 });
  return out;
}

/* Rôles d'un membre. Renvoie null s'il n'est pas sur le serveur. */
async function memberRoles(env, userId) {
  const res = await botFetch(env, `/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('member ' + res.status);

  const member = await res.json();
  const { byId } = await guildRoles(env);
  return {
    roles: (member.roles || []).map(id => byId[id]).filter(Boolean),
    nick: member.nick || null,
  };
}

/* ---------------------------------------------------------------------------
   Routes
   --------------------------------------------------------------------------- */

/* GET /api/login → redirige vers Discord */
async function handleLogin(request, env, url) {
  const state = crypto.randomUUID();
  await env.MARLOWE.put('state:' + state, '1', { expirationTtl: STATE_TTL });

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

  const known = await env.MARLOWE.get('state:' + state);
  if (!known) {
    return errorPage('Lien expiré', "Cette demande de connexion a expiré ou a déjà été utilisée. Relancez la connexion depuis le site.", env);
  }
  await env.MARLOWE.delete('state:' + state);

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

  if (!member) {
    return errorPage(
      'Accès réservé aux membres',
      "Votre compte Discord n'est pas membre du serveur du domaine. Rejoignez-le, puis reconnectez-vous.",
      env
    );
  }

  /* 4. session */
  const sid = crypto.randomUUID();
  await env.MARLOWE.put('sess:' + sid, JSON.stringify({
    id:     me.id,
    name:   member.nick || me.global_name || me.username,
    avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null,
  }), { expirationTtl: SESSION_TTL });

  const dest = env.SITE_URL.replace(/\/+$/, '') + '/gestion.html#token=' + sid;
  return Response.redirect(dest, 302);
}

/* Lit la session depuis le header Authorization, rôles rafraîchis à chaque appel */
async function currentSession(request, env) {
  const sid = bearer(request);
  if (!sid) return null;

  const stored = await env.MARLOWE.get('sess:' + sid, 'json');
  if (!stored) return null;

  /* On revérifie l'appartenance : si le membre a quitté le Discord ou
     a changé de rôle, ça se voit immédiatement. */
  const member = await memberRoles(env, stored.id);
  if (!member) {
    await env.MARLOWE.delete('sess:' + sid);
    return null;
  }

  const roles = member.roles;
  const isOwner = ownerIds(env).includes(String(stored.id));
  return {
    user:  { id: stored.id, name: member.nick || stored.name, avatar: stored.avatar },
    roles,
    isOwner,
    isPatron: isOwner || roles.some(r => patronRoles(env).includes(r)),
  };
}

/* GET /api/me */
async function handleMe(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);
  return json(env, { user: s.user, roles: s.roles });
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
    const perms = await env.MARLOWE.get('permissions', 'json');
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

    await env.MARLOWE.put('permissions', JSON.stringify(clean));
    return json(env, clean);
  }

  return json(env, { error: 'method_not_allowed' }, 405);
}

/* GET /api/logout */
async function handleLogout(request, env) {
  const sid = bearer(request);
  if (sid) await env.MARLOWE.delete('sess:' + sid);
  return json(env, { ok: true });
}

/* ---------------------------------------------------------------------------
   Point d'entrée
   --------------------------------------------------------------------------- */

export default {
  async fetch(request, env) {
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

    try {
      switch (url.pathname) {
        case '/api/login':       return handleLogin(request, env, url);
        case '/api/callback':    return handleCallback(request, env, url);
        case '/api/me':          return handleMe(request, env);
        case '/api/roles':       return handleRoles(request, env);
        case '/api/permissions': return handlePermissions(request, env);
        case '/api/logout':      return handleLogout(request, env);
        default:                 return json(env, { error: 'not_found' }, 404);
      }
    } catch (e) {
      return json(env, { error: 'server_error', detail: String(e.message || e) }, 500);
    }
  },
};
