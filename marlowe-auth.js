/* ============================================================================
   MARLOWE VINEYARD — Connexion Discord & gestion des accès
   ----------------------------------------------------------------------------
   Ce fichier ajoute à gestion.html :
     · un écran de connexion,
     · le filtrage des pages du panel selon les rôles Discord du membre,
     · une page « Paramètres » réservée au patron (matrice pages × rôles).

   Il est volontairement ISOLÉ du reste du panel. Tout le panel ne connaît
   que deux fonctions : Auth.getSession() et Store.getPermissions().
   Le jour du branchement du backend, seul l'intérieur de ces fonctions
   change — aucune autre ligne du panel n'est touchée.

   ----------------------------------------------------------------------------
   CONTRAT ATTENDU DU BACKEND (à implémenter côté Cloudflare Worker)
   ----------------------------------------------------------------------------
   GET  {API_BASE}/api/login
        → redirige vers Discord (OAuth2, scopes: identify guilds.members.read)

   GET  {API_BASE}/api/callback?code=...
        → échange le code, vérifie l'appartenance au serveur Discord,
          récupère les rôles, puis renvoie le membre sur gestion.html
          avec un token (#token=... dans l'URL)

   GET  {API_BASE}/api/me            [Authorization: Bearer <token>]
        → 200 {"user":{"id","name","avatar"},"roles":["Patron","RH",...]}
          401 si non connecté / plus membre du serveur

   GET  {API_BASE}/api/roles         [Authorization: Bearer <token>]
        → 200 ["Patron","Co-Patron","DRH",...]   (rôles réels du serveur)

   GET  {API_BASE}/api/permissions
        → 200 {"rhemployes":["Patron","DRH"], ...}

   PUT  {API_BASE}/api/permissions   [Authorization: Bearer <token>]
        → enregistre la matrice. DOIT refuser si le membre n'est pas patron.

   IMPORTANT : le backend revalide les rôles à CHAQUE appel de données.
   Le filtrage fait ici est du confort d'interface, pas une sécurité.
   ============================================================================ */

(function () {
  'use strict';

  /* Ce script est chargé dans <head>, donc AVANT que le panel soit dessiné.
     On masque le panel tout de suite : sans ça il apparaîtrait une fraction
     de seconde avant l'écran de connexion. */
  (function () {
    const s = document.createElement('style');
    s.textContent = 'html:not(.mv-ready) .app-shell{visibility:hidden !important;}';
    document.head.appendChild(s);
  })();

  /* ==========================================================================
     1. CONFIGURATION
     ========================================================================== */
  const CONFIG = {
    /* 'demo'    : aucun backend, session simulée (sélecteur de rôles)
       'discord' : vraie connexion Discord via le backend

       ⚠️ Ne jamais laisser 'demo' en ligne : n'importe qui pourrait alors
       choisir « Patron » et entrer dans le panel.                            */
    MODE: 'discord',

    /* Adresse du backend Cloudflare Worker. */
    API_BASE: 'https://marlowe-api.marlowe-vineyard.workers.dev',

    /* Rôles Discord qui donnent les pleins pouvoirs (accès à tout +
       accès à la page Paramètres). Doivent correspondre EXACTEMENT au nom
       des rôles sur le serveur Discord.                                      */
    PATRON_ROLES: ['Patron', 'Co-Patron'],

    /* ---------------------------------------------------------------------
       ACCÈS PERMANENT — identifiants Discord qui ont TOUJOURS tous les accès,
       quels que soient leurs rôles, et que personne ne peut retirer depuis
       la page Paramètres.

       C'est le trousseau du développeur : même si le patron se trompe dans
       les réglages, même si on te retire un rôle, tu gardes la main.

       Pour trouver ton identifiant : Discord ▸ Paramètres ▸ Avancés ▸
       activer « Mode développeur », puis clic droit sur ton pseudo ▸
       « Copier l'identifiant ». C'est une suite de 18-19 chiffres.

       --------------------------------------------------------------------- */
    OWNER_IDS: [
      '826526979204841482',   // Thomas — développeur du site
    ],
  };

  /* ==========================================================================
     2. LES PAGES DU PANEL
     ========================================================================== */
  const PAGES = [
    { id: 'rhemployes',     label: 'Employés',        group: 'RH' },
    { id: 'rhrecrutement',  label: 'Recrutement',     group: 'RH' },
    { id: 'blacklist',      label: 'Blacklist',       group: 'RH' },

    { id: 'facturation',    label: 'Facturation',     group: 'Commerce' },
    { id: 'catalogue',      label: 'Catalogue',       group: 'Commerce' },
    { id: 'bilan',          label: 'Bilan comptable', group: 'Commerce' },
    { id: 'facturesrecues', label: 'Factures reçues', group: 'Commerce' },

    { id: 'eligibilite',    label: 'Éligibilité',     group: 'Stats & Quotas' },
    { id: 'statsvue',       label: "Vue d'ensemble",  group: 'Stats & Quotas' },
    { id: 'statsdash',      label: 'Tableau de bord', group: 'Stats & Quotas' },
    { id: 'statsgrades',    label: 'Grades & quotas', group: 'Stats & Quotas' },
    { id: 'statseffectif',  label: 'Effectif',        group: 'Stats & Quotas' },
    { id: 'statsprimes',    label: 'Primes',          group: 'Stats & Quotas' },

    { id: 'masemaine',      label: 'Ma semaine',      group: 'Personnel' },
    { id: 'agenda',         label: 'Agenda',          group: 'Personnel' },
    { id: 'tombola',        label: 'Tombola',         group: 'Personnel' },
  ];

  /* Rôles utilisés en mode démo. En mode 'discord', la vraie liste est
     récupérée depuis le serveur via /api/roles.                              */
  const DEMO_ROLES = [
    'Patron', 'Co-Patron',
    'DRH', 'Responsable Commercial', 'Responsable Magasin', 'Responsable Runner',
    'RH', 'Commercial', 'Assistant(e) magasin', 'Vendeur', 'Runner',
    'Saisonnier', 'Ouvrier Viticole', 'Chef de Culture',
  ];

  /* Répartition de départ — modifiable ensuite dans Paramètres.
     Le patron a tout, il n'a pas besoin d'être listé.                        */
  const PERSONNEL = ['masemaine', 'agenda', 'tombola'];
  const RH_PAGES  = ['rhemployes', 'rhrecrutement', 'blacklist'];
  const COMMERCE  = ['facturation', 'catalogue', 'bilan', 'facturesrecues'];
  const STATS     = ['eligibilite', 'statsvue', 'statsdash', 'statsgrades', 'statseffectif', 'statsprimes'];

  function defaultPermissions() {
    const perms = {};
    PAGES.forEach(p => { perms[p.id] = []; });

    const give = (role, ids) => ids.forEach(id => {
      if (perms[id] && !perms[id].includes(role)) perms[id].push(role);
    });

    /* Tout le monde accède à son espace personnel */
    DEMO_ROLES.forEach(r => give(r, PERSONNEL));

    /* Responsables */
    give('DRH',                    [...RH_PAGES, ...STATS]);
    give('Responsable Commercial', [...COMMERCE, ...STATS]);
    give('Responsable Magasin',    ['facturation', 'catalogue', ...STATS]);
    give('Responsable Runner',     ['catalogue', ...STATS]);

    /* Employés */
    give('RH',                     [...RH_PAGES, 'eligibilite']);
    give('Commercial',             ['facturation', 'catalogue', 'eligibilite']);
    give('Assistant(e) magasin',   ['catalogue', 'eligibilite']);
    give('Vendeur',                ['catalogue', 'eligibilite']);
    give('Runner',                 ['catalogue', 'eligibilite']);

    /* Grades de production */
    ['Saisonnier', 'Ouvrier Viticole', 'Chef de Culture']
      .forEach(r => give(r, ['eligibilite', 'statsgrades']));

    return perms;
  }

  /* ==========================================================================
     3. STOCKAGE  —  localStorage en démo, API en production
     ========================================================================== */
  const LS_SESSION = 'mv.session';
  const LS_PERMS   = 'mv.permissions';
  const LS_TOKEN   = 'mv.token';
  const LS_SETTINGS = 'mv.settings';

  /* ------------------------------------------------------------------------
     Tri des rôles Discord.
     Un serveur RP a facilement 80 rôles : bots, partenaires, événements,
     décorations… Une poignée seulement concerne le domaine. Les rôles de
     bots sont déjà écartés par le backend ; ici on devine les rôles métier
     pour proposer une présélection au patron, qui ajuste ensuite.
     ------------------------------------------------------------------------ */
  const ROLE_KEYWORDS = [
    'patron', 'direction', 'drh', 'responsable', 'resp',
    'rh', 'commercial', 'magasin', 'vendeur', 'runner', 'assistant',
    'saisonnier', 'ouvrier', 'chef de culture', 'viticole', 'caviste',
  ];

  /* Enlève emojis, séparateurs et accents pour comparer sur le fond. */
  function normalizeRole(name) {
    return String(name)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function looksLikeDomainRole(name) {
    const n = normalizeRole(name);
    if (!n) return false;
    return ROLE_KEYWORDS.some(k => n === k || n.startsWith(k + ' ') || n.includes(' ' + k));
  }

  const ls = {
    get(k, fallback) {
      try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k)    { try { localStorage.removeItem(k); } catch (e) {} },
  };

  function token() { return ls.get(LS_TOKEN, null); }

  async function api(path, options) {
    const opts = Object.assign({ headers: {} }, options || {});
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers);
    const t = token();
    if (t) opts.headers['Authorization'] = 'Bearer ' + t;
    const res = await fetch(CONFIG.API_BASE + path, opts);
    if (!res.ok) throw new Error('API ' + res.status);
    return res.json();
  }

  const Store = {
    async getPermissions() {
      if (CONFIG.MODE === 'discord') {
        try { return await api('/api/permissions'); }
        catch (e) { return defaultPermissions(); }
      }
      return ls.get(LS_PERMS, null) || defaultPermissions();
    },

    async setPermissions(perms) {
      if (CONFIG.MODE === 'discord') {
        return api('/api/permissions', { method: 'PUT', body: JSON.stringify(perms) });
      }
      ls.set(LS_PERMS, perms);
      return perms;
    },

    async getRoles() {
      if (CONFIG.MODE === 'discord') {
        try { return await api('/api/roles'); }
        catch (e) { return DEMO_ROLES.slice(); }
      }
      return DEMO_ROLES.slice();
    },

    async getSettings() {
      if (CONFIG.MODE === 'discord') {
        try { return await api('/api/settings'); }
        catch (e) { return {}; }
      }
      return ls.get(LS_SETTINGS, {}) || {};
    },

    async setSettings(s) {
      if (CONFIG.MODE === 'discord') {
        return api('/api/settings', { method: 'PUT', body: JSON.stringify(s) });
      }
      ls.set(LS_SETTINGS, s);
      return s;
    },

    resetPermissions() {
      if (CONFIG.MODE !== 'discord') ls.del(LS_PERMS);
    },
  };

  /* ==========================================================================
     4. AUTHENTIFICATION  —  le seul point de contact avec Discord
     ========================================================================== */
  const Auth = {
    /* Renvoie {user:{id,name,avatar}, roles:[], isPatron:bool} ou null */
    async getSession() {
      let s = null;

      if (CONFIG.MODE === 'discord') {
        /* Le backend renvoie le membre sur gestion.html#token=xxx */
        if (location.hash.startsWith('#token=')) {
          ls.set(LS_TOKEN, decodeURIComponent(location.hash.slice(7)));
          history.replaceState(null, '', location.pathname + location.search);
        }
        if (!token()) return null;
        try { s = await api('/api/me'); }
        catch (e) { ls.del(LS_TOKEN); return null; }
      } else {
        s = ls.get(LS_SESSION, null);
      }

      if (!s || !s.user) return null;
      s.roles = Array.isArray(s.roles) ? s.roles : [];

      /* Accès permanent par identifiant Discord, puis par rôle. */
      s.isOwner  = CONFIG.OWNER_IDS.includes(String(s.user.id));
      s.isPatron = s.isOwner || s.roles.some(r => CONFIG.PATRON_ROLES.includes(r));
      return s;
    },

    login() {
      if (CONFIG.MODE === 'discord') {
        location.href = CONFIG.API_BASE + '/api/login';
      }
    },

    /* Mode démo uniquement */
    setDemoSession(name, roles) {
      ls.set(LS_SESSION, { user: { id: 'demo', name: name, avatar: null }, roles: roles });
    },

    logout() {
      /* On prévient le backend pour qu'il efface la session de son côté,
         sans attendre la réponse — le rechargement suffit à l'utilisateur. */
      if (CONFIG.MODE === 'discord' && token()) {
        try { api('/api/logout').catch(() => {}); } catch (e) {}
      }
      ls.del(LS_SESSION);
      ls.del(LS_TOKEN);
      location.reload();
    },
  };

  /* ==========================================================================
     5. PERMISSIONS
     ========================================================================== */
  function allowedPages(session, perms) {
    if (!session) return [];
    if (session.isPatron) return PAGES.map(p => p.id);
    return PAGES
      .filter(p => (perms[p.id] || []).some(r => session.roles.includes(r)))
      .map(p => p.id);
  }

  /* ==========================================================================
     6. STYLES
     ========================================================================== */
  const CSS = `
  .mv-hidden{display:none !important;}

  /* ---------- écran de connexion ---------- */
  .mv-gate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
    padding:24px;overflow-y:auto;
    background:linear-gradient(165deg,#12110E 0%,#1C1B18 55%,#242019 100%);}
  .mv-gate-box{width:100%;max-width:480px;background:var(--oak-2,rgba(46,42,35,.92));
    border:1px solid var(--band,#3D372C);border-radius:18px;padding:38px 34px;
    box-shadow:0 30px 80px rgba(0,0,0,.55);}
  .mv-gate-crest{width:56px;height:56px;border-radius:14px;border:1px solid var(--or,#C9A961);
    display:flex;align-items:center;justify-content:center;margin:0 auto 22px;
    font-family:'Fraunces',serif;font-weight:600;font-size:19px;color:var(--or,#C9A961);
    letter-spacing:.04em;}
  .mv-gate h1{font-family:'Fraunces',serif;font-weight:600;font-size:24px;text-align:center;
    color:var(--parchment,#EDE3CF);margin:0 0 8px;}
  .mv-gate .mv-sub{text-align:center;font-size:13px;line-height:1.65;color:var(--muted,#9C9384);margin-bottom:28px;}

  .mv-discord-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:11px;
    background:#5865F2;color:#fff;border:none;border-radius:11px;padding:15px;font-size:14.5px;
    font-weight:600;cursor:pointer;font-family:inherit;transition:.15s;}
  .mv-discord-btn:hover{background:#4854E0;}
  .mv-discord-btn svg{width:21px;height:auto;}

  .mv-note{margin-top:22px;padding-top:20px;border-top:1px solid var(--band,#3D372C);
    font-size:11.5px;line-height:1.6;color:var(--muted,#9C9384);text-align:center;}

  .mv-demo-banner{background:rgba(214,167,92,.10);border:1px solid rgba(214,167,92,.35);
    border-radius:10px;padding:12px 14px;font-size:11.5px;line-height:1.6;
    color:var(--amber,#D6A75C);margin-bottom:24px;}
  .mv-demo-banner b{display:block;margin-bottom:3px;}

  .mv-field{margin-bottom:18px;}
  .mv-field label{display:block;font-size:10px;letter-spacing:.16em;text-transform:uppercase;
    color:var(--or-soft,#8E7C4E);margin-bottom:8px;}
  .mv-field input[type=text]{width:100%;background:rgba(0,0,0,.25);border:1px solid var(--band,#3D372C);
    border-radius:9px;padding:11px 13px;color:var(--parchment,#EDE3CF);font-size:14px;font-family:inherit;}
  .mv-field input[type=text]:focus{outline:none;border-color:var(--or,#C9A961);}

  .mv-role-list{display:flex;flex-wrap:wrap;gap:7px;max-height:210px;overflow-y:auto;padding:2px;}
  .mv-role-chip{border:1px solid var(--band,#3D372C);border-radius:999px;padding:7px 13px;font-size:12px;
    color:var(--parchment,#EDE3CF);cursor:pointer;user-select:none;transition:.15s;background:rgba(0,0,0,.18);}
  .mv-role-chip:hover{border-color:var(--or-soft,#8E7C4E);}
  .mv-role-chip.on{background:rgba(201,169,97,.18);border-color:var(--or,#C9A961);color:var(--or,#C9A961);font-weight:600;}

  .mv-gate-error{color:#E08A7A;font-size:12.5px;margin-top:14px;text-align:center;min-height:16px;}

  /* ---------- badge utilisateur dans la sidebar ---------- */
  /* La barre latérale ne défile pas elle-même : c'est le menu qui défile,
     pour que le badge reste visible en bas sans jamais recouvrir la dernière
     entrée du menu (sinon « Paramètres » devient incliquable). */
  .mv-sidebar-flex{display:flex;flex-direction:column;overflow:hidden;}
  .mv-sidebar-flex nav{flex:1 1 auto;overflow-y:auto;min-height:0;}
  .mv-user{flex-shrink:0;margin:0 -16px -24px;padding:14px 16px 18px;
    border-top:1px solid var(--band,#3D372C);background:#2B2820;}
  .mv-user-top{display:flex;align-items:center;gap:10px;}
  .mv-avatar{width:34px;height:34px;border-radius:50%;flex-shrink:0;background:rgba(201,169,97,.15);
    border:1px solid var(--or-soft,#8E7C4E);display:flex;align-items:center;justify-content:center;
    font-size:13px;font-weight:600;color:var(--or,#C9A961);overflow:hidden;}
  .mv-avatar img{width:100%;height:100%;object-fit:cover;}
  .mv-user-name{font-size:13px;font-weight:600;color:var(--parchment,#EDE3CF);line-height:1.3;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .mv-user-role{font-size:10.5px;color:var(--muted,#9C9384);margin-top:2px;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .mv-owner-tag{color:var(--or,#C9A961);font-weight:600;}
  .mv-logout{margin-top:10px;width:100%;background:transparent;border:1px solid var(--band,#3D372C);
    border-radius:8px;padding:7px;font-size:11.5px;color:var(--muted,#9C9384);cursor:pointer;
    font-family:inherit;transition:.15s;}
  .mv-logout:hover{border-color:var(--bordeaux-soft,#8A3540);color:#E08A7A;}

  /* ---------- page Paramètres ---------- */
  /* Pas de hauteur limitée : c'est la page qui défile, pas un cadre interne. */
  .mv-matrix-wrap{overflow-x:auto;border:1px solid var(--band,#3D372C);
    border-radius:12px;background:#221F1A;}

  .mv-rolepick{border:1px solid var(--band,#3D372C);border-radius:12px;background:#221F1A;
    padding:14px 18px;margin-bottom:20px;}
  .mv-rolepick summary{cursor:pointer;font-weight:600;font-size:13.5px;color:var(--parchment,#EDE3CF);
    list-style:none;}
  .mv-rolepick summary::-webkit-details-marker{display:none;}
  .mv-rolepick summary::before{content:'▸ ';color:var(--or,#C9A961);}
  .mv-rolepick[open] summary::before{content:'▾ ';}
  .mv-rolepick summary b{color:var(--or,#C9A961);}
  .mv-rolepick-help{font-size:12px;line-height:1.65;color:var(--muted,#9C9384);margin:12px 0 14px;max-width:720px;}
  .mv-rolepick-help b{color:var(--amber,#D6A75C);}
  .mv-pick{max-height:none;}
  table.mv-matrix{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:12.5px;}
  table.mv-matrix th,table.mv-matrix td{padding:9px 12px;border-bottom:1px solid rgba(61,55,44,.6);}
  table.mv-matrix thead th{position:sticky;top:0;z-index:3;background:#26231E;
    font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--or-soft,#8E7C4E);
    font-weight:600;text-align:center;white-space:nowrap;vertical-align:bottom;}
  table.mv-matrix thead th:first-child{left:0;z-index:4;text-align:left;}
  table.mv-matrix tbody th{position:sticky;left:0;z-index:2;background:#221F1A;
    text-align:left;font-weight:500;color:var(--parchment,#EDE3CF);white-space:nowrap;}
  table.mv-matrix tr.mv-group-row th{background:#2C2822;color:var(--or,#C9A961);
    font-family:'Fraunces',serif;font-size:12.5px;font-weight:600;z-index:2;}
  table.mv-matrix td{text-align:center;}
  table.mv-matrix tbody td{background:#221F1A;}
  table.mv-matrix tbody tr:hover td{background:#2B2721;}
  table.mv-matrix tbody tr:hover th{background:#2F2A23;}
  table.mv-matrix tr.mv-group-row:hover th{background:#2C2822;}
  table.mv-matrix input[type=checkbox]{width:16px;height:16px;accent-color:var(--or,#C9A961);cursor:pointer;}
  .mv-rowbtn{background:none;border:1px solid var(--band,#3D372C);border-radius:6px;color:var(--muted,#9C9384);
    font-size:10px;padding:3px 7px;cursor:pointer;margin-left:8px;font-family:inherit;}
  .mv-rowbtn:hover{color:var(--or,#C9A961);border-color:var(--or-soft,#8E7C4E);}
  .mv-patron-col{color:var(--or,#C9A961) !important;}
  .mv-always{color:var(--or,#C9A961);font-size:13px;}
  .mv-saved{color:var(--vine,#6E8B5D);font-size:12.5px;margin-left:14px;opacity:0;transition:.2s;}
  .mv-saved.on{opacity:1;}

  .mv-noaccess{max-width:520px;margin:80px auto;text-align:center;}
  .mv-noaccess h2{font-family:'Fraunces',serif;font-size:22px;color:var(--parchment,#EDE3CF);margin-bottom:12px;}
  .mv-noaccess p{font-size:13.5px;line-height:1.7;color:var(--muted,#9C9384);}
  `;

  const DISCORD_SVG = '<svg viewBox="0 0 127.14 96.36" fill="currentColor" aria-hidden="true"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21H0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ==========================================================================
     7. ÉCRAN DE CONNEXION
     ========================================================================== */
  function showGate(roles) {
    const gate = document.createElement('div');
    gate.className = 'mv-gate';

    const demo = CONFIG.MODE !== 'discord';

    gate.innerHTML = `
      <div class="mv-gate-box">
        <div class="mv-gate-crest">MV</div>
        <h1>Espace membre</h1>
        <div class="mv-sub">
          L'accès au panel est réservé aux membres du Discord du domaine.
          Vos accès dépendent de vos rôles sur le serveur.
        </div>

        ${demo ? `
          <div class="mv-demo-banner">
            <b>Mode test — aucun backend connecté</b>
            Choisissez un nom et des rôles pour simuler une connexion et vérifier
            les accès. En production, tout viendra de Discord.
          </div>

          <div class="mv-field">
            <label for="mvName">Nom affiché</label>
            <input type="text" id="mvName" value="Thomas" autocomplete="off">
          </div>

          <div class="mv-field">
            <label>Rôles Discord simulés</label>
            <div class="mv-role-list" id="mvRoles">
              ${roles.map(r => `<div class="mv-role-chip${
                r === CONFIG.PATRON_ROLES[0] ? ' on' : ''
              }" data-role="${esc(r)}">${esc(r)}</div>`).join('')}
            </div>
          </div>

          <button class="mv-discord-btn" id="mvEnter">Entrer dans le panel</button>
          <div class="mv-gate-error" id="mvErr"></div>
        ` : `
          <button class="mv-discord-btn" id="mvLogin">
            ${DISCORD_SVG} Se connecter avec Discord
          </button>
          <div class="mv-note">
            Vous serez redirigé vers Discord. Le domaine ne voit que votre pseudo,
            votre avatar et vos rôles sur le serveur.
          </div>
        `}
      </div>`;

    document.body.appendChild(gate);

    if (demo) {
      /* Le rôle patron est pré-coché : on entre avec tous les accès en un clic,
         et il suffit de le décocher pour tester un autre profil. */
      const picked = new Set(CONFIG.PATRON_ROLES[0] ? [CONFIG.PATRON_ROLES[0]] : []);
      gate.querySelector('#mvRoles').addEventListener('click', e => {
        const chip = e.target.closest('[data-role]');
        if (!chip) return;
        const r = chip.dataset.role;
        if (picked.has(r)) { picked.delete(r); chip.classList.remove('on'); }
        else { picked.add(r); chip.classList.add('on'); }
      });

      gate.querySelector('#mvEnter').addEventListener('click', () => {
        const name = gate.querySelector('#mvName').value.trim() || 'Membre';
        if (!picked.size) {
          gate.querySelector('#mvErr').textContent = 'Sélectionnez au moins un rôle.';
          return;
        }
        Auth.setDemoSession(name, [...picked]);
        location.reload();
      });
    } else {
      gate.querySelector('#mvLogin').addEventListener('click', () => Auth.login());
    }
  }

  /* ==========================================================================
     8. BADGE UTILISATEUR
     ========================================================================== */
  function addUserBadge(session) {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    sidebar.classList.add('mv-sidebar-flex');

    const initials = session.user.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const box = document.createElement('div');
    box.className = 'mv-user';
    box.innerHTML = `
      <div class="mv-user-top">
        <div class="mv-avatar">${session.user.avatar
          ? `<img src="${esc(session.user.avatar)}" alt="">` : esc(initials)}</div>
        <div style="min-width:0;flex:1;">
          <div class="mv-user-name" title="${esc(session.user.name)}">${esc(session.user.name)}</div>
          <div class="mv-user-role" title="${esc(session.roles.join(', '))}">${
            session.isOwner ? '<span class="mv-owner-tag">Accès permanent</span> · ' : ''
          }${esc(session.roles.join(' · '))}</div>
        </div>
      </div>
      <button class="mv-logout" type="button">Se déconnecter</button>`;
    box.querySelector('.mv-logout').addEventListener('click', () => Auth.logout());
    sidebar.appendChild(box);
  }

  /* ==========================================================================
     9. FILTRAGE DE LA NAVIGATION
     ========================================================================== */
  function applyNavFilter(allowed) {
    const set = new Set(allowed);

    document.querySelectorAll('.sidebar .nav-item').forEach(item => {
      if (!item.dataset.page) return;
      item.classList.toggle('mv-hidden', !set.has(item.dataset.page));
    });

    /* Masque un intitulé de section dont plus aucune page n'est visible */
    document.querySelectorAll('.sidebar .nav-section').forEach(sec => {
      let n = sec.nextElementSibling, visible = false;
      while (n && !n.classList.contains('nav-section')) {
        if (n.classList.contains('nav-item') && !n.classList.contains('mv-hidden')) visible = true;
        n = n.nextElementSibling;
      }
      sec.classList.toggle('mv-hidden', !visible);
    });

    /* Si la page ouverte par défaut n'est pas autorisée, on bascule
       sur la première page permise. */
    const active = document.querySelector('.page-content.active');
    const activeId = active ? active.id.replace(/^page-/, '') : null;
    if (!activeId || !set.has(activeId)) {
      const first = document.querySelector('.sidebar .nav-item:not(.mv-hidden)[data-page]');
      document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      if (first) {
        first.classList.add('active');
        const target = document.getElementById('page-' + first.dataset.page);
        if (target) target.classList.add('active');
      } else {
        showNoAccess();
      }
    }
  }

  function showNoAccess() {
    const main = document.querySelector('.content');
    if (!main) return;
    const div = document.createElement('div');
    div.className = 'page-content active mv-noaccess';
    div.innerHTML = `
      <h2>Aucun accès pour le moment</h2>
      <p>Vous êtes bien membre du Discord, mais aucun de vos rôles ne donne accès
         à une page du panel. Rapprochez-vous d'un responsable pour qu'un rôle
         vous soit attribué.</p>`;
    main.appendChild(div);
  }

  /* ==========================================================================
     10. PAGE PARAMÈTRES (patron uniquement)
     ========================================================================== */
  function buildSettings(roles, perms, settings) {
    /* --- entrée de menu --- */
    const nav = document.querySelector('.sidebar nav');
    const sec = document.createElement('div');
    sec.className = 'nav-section';
    sec.textContent = 'Administration';
    const item = document.createElement('div');
    item.className = 'nav-item';
    item.dataset.page = 'parametres';
    item.textContent = 'Paramètres';
    nav.appendChild(sec);
    nav.appendChild(item);

    /* --- la page --- */
    const page = document.createElement('div');
    page.className = 'page-content';
    page.id = 'page-parametres';

    /* Rôles retenus : ceux choisis par le patron, sinon une présélection
       automatique des rôles qui ressemblent à des rôles du domaine. */
    const configured = Array.isArray(settings.visibleRoles) ? settings.visibleRoles : null;
    let visible = configured && configured.length
      ? roles.filter(r => configured.includes(r))
      : roles.filter(looksLikeDomainRole);
    if (!visible.length) visible = roles.slice();

    const otherRoles = visible.filter(r => !CONFIG.PATRON_ROLES.includes(r));
    const groups = [...new Set(PAGES.map(p => p.group))];

    let rows = '';
    groups.forEach(g => {
      rows += `<tr class="mv-group-row"><th colspan="${otherRoles.length + 2}">${esc(g)}</th></tr>`;
      PAGES.filter(p => p.group === g).forEach(p => {
        rows += `<tr data-page="${esc(p.id)}">
          <th>${esc(p.label)}<button class="mv-rowbtn" data-toggle-row="${esc(p.id)}">tout</button></th>
          <td class="mv-always" title="Le patron a toujours accès à tout">✓</td>
          ${otherRoles.map(r => `<td>
            <input type="checkbox" data-page="${esc(p.id)}" data-role="${esc(r)}"
              ${(perms[p.id] || []).includes(r) ? 'checked' : ''}>
          </td>`).join('')}
        </tr>`;
      });
    });

    page.innerHTML = `
      <h1 class="page-title">Paramètres</h1>
      <p class="page-sub">Accès aux pages du panel selon les rôles Discord. Cochez une case pour
         autoriser un rôle à voir une page.</p>

      ${CONFIG.MODE !== 'discord' ? `
        <div class="mv-demo-banner" style="max-width:760px;">
          <b>Mode test</b>
          Les rôles affichés sont une liste d'exemple et les réglages sont enregistrés
          dans ce navigateur uniquement. Une fois le backend branché, les rôles seront
          lus directement sur le Discord et les réglages partagés par tout le monde.
        </div>` : ''}

      <details class="mv-rolepick" ${configured && configured.length ? '' : 'open'}>
        <summary>Rôles du domaine — <b>${visible.length}</b> retenus sur ${roles.length}</summary>
        <p class="mv-rolepick-help">
          Votre serveur compte beaucoup de rôles : partenaires, événements, décorations.
          Cochez uniquement ceux qui correspondent à un poste au domaine — les autres
          n'apparaîtront pas dans le tableau des accès.
          ${configured && configured.length ? '' : '<b>Une présélection a été devinée, vérifiez-la.</b>'}
        </p>
        <div class="mv-role-list mv-pick" id="mvPick">
          ${roles.map(r => `<div class="mv-role-chip${visible.includes(r) ? ' on' : ''}"
            data-role="${esc(r)}">${esc(r)}</div>`).join('')}
        </div>
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn primary" id="mvApplyRoles">Appliquer</button>
          <button class="btn" id="mvGuessRoles">Re-deviner</button>
        </div>
      </details>

      <div class="mv-matrix-wrap">
        <table class="mv-matrix">
          <thead>
            <tr>
              <th>Page</th>
              <th class="mv-patron-col">${esc(CONFIG.PATRON_ROLES.join(' / '))}</th>
              ${otherRoles.map(r => `<th>${esc(r)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div class="btn-row" style="margin-top:18px;align-items:center;">
        <button class="btn primary" id="mvSave">Enregistrer</button>
        <button class="btn" id="mvReset">Réinitialiser</button>
        <span class="mv-saved" id="mvSaved">Enregistré ✓</span>
      </div>`;

    document.querySelector('.content').appendChild(page);

    /* --- choix des rôles retenus --- */
    const pick = page.querySelector('#mvPick');
    pick.addEventListener('click', e => {
      const chip = e.target.closest('[data-role]');
      if (chip) chip.classList.toggle('on');
    });

    page.querySelector('#mvGuessRoles').addEventListener('click', () => {
      pick.querySelectorAll('[data-role]').forEach(c =>
        c.classList.toggle('on', looksLikeDomainRole(c.dataset.role)));
    });

    page.querySelector('#mvApplyRoles').addEventListener('click', async () => {
      const chosen = [...pick.querySelectorAll('[data-role].on')].map(c => c.dataset.role);
      if (!chosen.length) {
        alert('Gardez au moins un rôle, sinon le tableau des accès sera vide.');
        return;
      }
      try {
        await Store.setSettings(Object.assign({}, settings, { visibleRoles: chosen }));
        location.reload();
      } catch (e) {
        alert("Impossible d'enregistrer : " + e.message);
      }
    });

    /* --- cocher / décocher une ligne entière --- */
    page.addEventListener('click', e => {
      const btn = e.target.closest('[data-toggle-row]');
      if (!btn) return;
      const boxes = page.querySelectorAll(`input[data-page="${btn.dataset.toggleRow}"]`);
      const allOn = [...boxes].every(b => b.checked);
      boxes.forEach(b => { b.checked = !allOn; });
    });

    /* --- enregistrer --- */
    page.querySelector('#mvSave').addEventListener('click', async () => {
      const next = {};
      PAGES.forEach(p => { next[p.id] = []; });
      page.querySelectorAll('input[type=checkbox]:checked').forEach(b => {
        next[b.dataset.page].push(b.dataset.role);
      });
      try {
        await Store.setPermissions(next);
        const tag = page.querySelector('#mvSaved');
        tag.classList.add('on');
        setTimeout(() => tag.classList.remove('on'), 1800);
      } catch (e) {
        alert("Impossible d'enregistrer : " + e.message);
      }
    });

    /* --- réinitialiser --- */
    page.querySelector('#mvReset').addEventListener('click', async () => {
      const def = defaultPermissions();
      page.querySelectorAll('input[type=checkbox]').forEach(b => {
        b.checked = (def[b.dataset.page] || []).includes(b.dataset.role);
      });
      await Store.setPermissions(def);
    });

    /* --- ouverture de la page (le handler du panel a déjà été posé) --- */
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      page.classList.add('active');
    });
  }

  /* ==========================================================================
     11. DÉMARRAGE
     ========================================================================== */
  async function start() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const session = await Auth.getSession();

    /* La liste des rôles ne sert qu'à l'écran de test et à la page Paramètres.
       Inutile d'aller la chercher pour un visiteur non connecté. */
    const roles = (session || CONFIG.MODE !== 'discord') ? await Store.getRoles() : [];

    if (!session) {
      document.querySelector('.app-shell').style.display = 'none';
      document.documentElement.classList.add('mv-ready');
      showGate(roles);
      return;
    }

    /* Mis à disposition du panel : sert notamment à signer les saisies
       (« enregistré par … ») sans redemander le nom à chaque fois. */
    window.MarloweSession = {
      id: session.user.id,
      name: session.user.name,
      roles: session.roles.slice(),
      isPatron: session.isPatron,
      isOwner: session.isOwner,
    };

    const perms = await Store.getPermissions();
    applyNavFilter(allowedPages(session, perms));
    addUserBadge(session);
    if (session.isPatron) buildSettings(roles, perms, await Store.getSettings());
    document.documentElement.classList.add('mv-ready');

    /* La session est établie : le panel peut aller chercher ses données. */
    if (window.MarloweData) window.MarloweData.load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* Exposé pour la console / le débogage */
  window.MarloweAuth = { CONFIG, PAGES, Auth, Store, defaultPermissions };
})();
