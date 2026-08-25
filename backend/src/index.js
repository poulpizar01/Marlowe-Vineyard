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
    /* `managed` = rôle créé et tenu par une intégration : bots (carl-bot,
       Xenon, Ticket Tool…), Server Booster, abonnements. Jamais un rôle
       métier, donc on les écarte d'office. */
    .filter(r => !r.managed)
    .sort((a, b) => b.position - a.position)
    .map(r => ({ id: r.id, name: r.name }));

  const out = { list, byId: Object.fromEntries(list.map(r => [r.id, r.name])) };
  await env.MARLOWE.put('cache:roles', JSON.stringify(out), { expirationTtl: 300 });
  return out;
}

/* Rôles d'un membre. Renvoie null s'il n'est pas sur le serveur.

   Résultat gardé 60 secondes : le panel enregistre souvent, et interroger
   Discord à chaque requête finirait par heurter ses limites de débit — ce
   qui déconnecterait tout le monde. Un membre exclu du serveur ou dont les
   rôles changent perd donc ses accès dans la minute, pas dans la seconde. */
const MEMBER_TTL = 60;

async function memberRoles(env, userId) {
  const cacheKey = 'mcache:' + userId;
  const cached = await env.MARLOWE.get(cacheKey, 'json');
  if (cached) return cached.gone ? null : cached;

  const res = await botFetch(env, `/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`);

  if (res.status === 404) {
    await env.MARLOWE.put(cacheKey, JSON.stringify({ gone: true }), { expirationTtl: MEMBER_TTL });
    return null;
  }
  if (!res.ok) throw new Error('member ' + res.status);

  const member = await res.json();
  const { byId } = await guildRoles(env);
  const out = {
    roles: (member.roles || []).map(id => byId[id]).filter(Boolean),
    nick: member.nick || null,
  };

  await env.MARLOWE.put(cacheKey, JSON.stringify(out), { expirationTtl: MEMBER_TTL });
  return out;
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
  /* La vitrine ne se règle que depuis Paramètres, donc réservée au patron. */
  vitrine:         [],
};

function canWrite(session, collection, perms, ro) {
  if (session.isPatron) return true;

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
  const list = await env.MARLOWE.get('journal', 'json') || [];
  list.unshift({
    at: new Date().toISOString(),
    by: session.user.name,
    id: session.user.id,
    texte,
    keys,
  });
  if (list.length > JOURNAL_MAX) list.length = JOURNAL_MAX;
  await env.MARLOWE.put('journal', JSON.stringify(list));
}

/* GET /api/journal */
async function handleJournal(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);
  const list = await env.MARLOWE.get('journal', 'json') || [];
  return json(env, list);
}

/* GET | POST /api/presence
   Qui d'autre est en train de travailler sur le panel. Chaque navigateur
   signale sa présence toutes les 45 secondes ; une entrée non renouvelée
   disparaît d'elle-même au bout de 100 secondes. */
const PRESENCE_TTL = 100;

async function handlePresence(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);

  if (request.method === 'POST') {
    let page = '';
    try { page = String((await request.json()).page || '').slice(0, 40); } catch (e) {}
    await env.MARLOWE.put('pres:' + s.user.id, JSON.stringify({
      id: s.user.id, name: s.user.name, avatar: s.user.avatar,
      page, at: Date.now(),
    }), { expirationTtl: PRESENCE_TTL });
  }

  const list = await env.MARLOWE.list({ prefix: 'pres:' });
  const membres = [];
  for (const k of list.keys) {
    const v = await env.MARLOWE.get(k.name, 'json');
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

  const d = await env.MARLOWE.get('data', 'json') || {};
  const roster = Array.isArray(d.rhRoster) ? d.rhRoster : [];

  const membres = roster.slice(0, 400).map(e => ({
    nom:    String(e && e.name || '').slice(0, 60),
    poste:  String(e && e.poste || '').slice(0, 60),
    absent: (e && e.status) ? e.status !== 'actif' : false,
  })).filter(m => m.nom && m.poste);

  const m = await env.MARLOWE.get('datameta', 'json');
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

  const bin = await env.MARLOWE.getWithMetadata('img:' + id, { type: 'arrayBuffer' });
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
  if (!s.isPatron) return json(env, { error: 'forbidden' }, 403);

  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  if (!IMG_TYPES.includes(type)) return json(env, { error: 'bad_type', accepte: IMG_TYPES }, 415);

  const plafond = type === 'application/pdf' ? PDF_MAX : IMG_MAX;
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json(env, { error: 'empty' }, 400);
  if (buf.byteLength > plafond) return json(env, { error: 'too_large', max: plafond }, 413);

  const id = [...crypto.getRandomValues(new Uint8Array(10))]
    .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);

  await env.MARLOWE.put('img:' + id, buf, { metadata: { type, taille: buf.byteLength } });
  return json(env, { id, url: '/api/img/' + id, type, taille: buf.byteLength });
}

/* GET /api/vitrine  —  PUBLIC
   Ce que la page d'accueil a le droit de savoir : les nouveautés et les pages
   du catalogue. Rien d'autre du panel ne transite par ici. */
async function handleVitrine(request, env) {
  if (request.method !== 'GET') return json(env, { error: 'method' }, 405);

  const d = await env.MARLOWE.get('data', 'json') || {};
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

  const m = await env.MARLOWE.get('datameta', 'json');
  return json(env, { nouveautes, catalogue, rev: (m && m.rev) || 0 });
}

/* Un lien Canva collé depuis le bouton « Partager » ne s'affiche PAS dans une
   page : Canva l'interdit, et le navigateur montre « refuse de se connecter ».
   Seule la forme « …/view?embed » est intégrable. Plutôt que d'exiger du
   patron qu'il trouve le bon bouton, on remet nous-mêmes le lien en forme :
   on garde l'identifiant du design et on rebâtit l'adresse d'intégration.

   Le domaine est vérifié — sinon ce champ deviendrait un moyen d'afficher
   n'importe quelle page dans le site du domaine. */
function lienCanva(brut) {
  if (!brut) return '';
  let u;
  try { u = new URL(brut.trim()); } catch (e) { return ''; }
  if (u.hostname !== 'www.canva.com' && u.hostname !== 'canva.com') return '';

  const m = u.pathname.match(/^\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/);
  if (!m) return '';
  return `https://www.canva.com/design/${m[1]}/${m[2]}/view?embed`;
}

/* GET | PUT /api/settings
   Réglages du panel. Aujourd'hui : la liste des rôles retenus comme rôles
   du domaine (les autres — partenaires, décoratifs — sont écartés). */
async function handleSettings(request, env) {
  if (request.method === 'GET') {
    const s = await env.MARLOWE.get('settings', 'json');
    return json(env, s || {});
  }

  if (request.method === 'PUT') {
    const s = await currentSession(request, env);
    if (!s) return json(env, { error: 'unauthorized' }, 401);
    if (!s.isPatron) return json(env, { error: 'forbidden' }, 403);

    let body;
    try { body = await request.json(); }
    catch (e) { return json(env, { error: 'bad_json' }, 400); }

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

    await env.MARLOWE.put('settings', JSON.stringify(clean));
    return json(env, clean);
  }

  return json(env, { error: 'method_not_allowed' }, 405);
}

/* GET | PUT /api/data
   Les données de travail du panel (employés, factures, blacklist…).
   Tout est rangé sous une seule clé : c'est peu volumineux, et ça évite
   qu'une sauvegarde partielle laisse le panel dans un état incohérent.

   Lecture et écriture sont ouvertes à tout membre connecté : c'est un outil
   d'équipe. L'appartenance au serveur Discord est revérifiée à chaque appel.  */
const DATA_MAX = 2 * 1024 * 1024;   // 2 Mo, large devant l'usage réel

async function handleData(request, env) {
  const s = await currentSession(request, env);
  if (!s) return json(env, { error: 'unauthorized' }, 401);

  /* ?meta=1 → juste le numéro de révision. C'est ce que les navigateurs
     interrogent en boucle : quelques octets au lieu de tout le contenu. */
  const url = new URL(request.url);
  if (request.method === 'GET' && url.searchParams.get('meta') === '1') {
    const m = await env.MARLOWE.get('datameta', 'json');
    return json(env, m || { rev: 0 });
  }

  if (request.method === 'GET') {
    const d = await env.MARLOWE.get('data', 'json');
    const m = await env.MARLOWE.get('datameta', 'json');
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
    const perms = await env.MARLOWE.get('permissions', 'json') || {};
    const settings = await env.MARLOWE.get('settings', 'json') || {};
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
    const current = await env.MARLOWE.get('data', 'json') || {};
    for (const [k, v] of Object.entries(body)) {
      current[String(k).slice(0, 64)] = v;
    }

    delete current._meta;
    const out = JSON.stringify(current);
    if (out.length > DATA_MAX) return json(env, { error: 'too_large' }, 413);
    await env.MARLOWE.put('data', out);

    /* La révision s'incrémente à chaque écriture : c'est elle qui prévient
       les autres navigateurs qu'ils travaillent sur une version périmée. */
    const prev = await env.MARLOWE.get('datameta', 'json');
    const meta = {
      rev: ((prev && prev.rev) || 0) + 1,
      by: s.user.name,
      at: new Date().toISOString(),
      keys: Object.keys(body),
    };
    await env.MARLOWE.put('datameta', JSON.stringify(meta));
    if (note) await appendJournal(env, s, note, Object.keys(body));

    return json(env, { ok: true, saved: Object.keys(body), rev: meta.rev });
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
      /* /api/img/{id} porte l'identifiant dans le chemin : le switch ne sait
         pas filtrer là-dessus, on l'attrape avant. */
      if (url.pathname.startsWith('/api/img/')) {
        return handleImage(request, env, url.pathname.slice('/api/img/'.length));
      }

      switch (url.pathname) {
        case '/api/login':       return handleLogin(request, env, url);
        case '/api/callback':    return handleCallback(request, env, url);
        case '/api/me':          return handleMe(request, env);
        case '/api/roles':       return handleRoles(request, env);
        case '/api/permissions': return handlePermissions(request, env);
        case '/api/settings':    return handleSettings(request, env);
        case '/api/orga':        return handleOrga(request, env);
        case '/api/vitrine':     return handleVitrine(request, env);
        case '/api/upload':      return handleUpload(request, env);
        case '/api/data':        return handleData(request, env);
        case '/api/presence':    return handlePresence(request, env);
        case '/api/journal':     return handleJournal(request, env);
        case '/api/logout':      return handleLogout(request, env);
        default:                 return json(env, { error: 'not_found' }, 404);
      }
    } catch (e) {
      return json(env, { error: 'server_error', detail: String(e.message || e) }, 500);
    }
  },
};
