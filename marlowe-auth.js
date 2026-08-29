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
      '186397473374208000',   // accès développeur permanent
    ],
  };

  /* ==========================================================================
     2. LES PAGES DU PANEL
     ========================================================================== */
  const PAGES = [
    { id: 'rhemployes',     label: 'Employés',        group: 'RH' },
    { id: 'rhrecrutement',  label: 'Recrutement',     group: 'RH' },
    { id: 'entretien',      label: "Kit d'entretien", group: 'RH' },
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

    { id: 'magcommandes',   label: 'Bons de commande', group: 'Magasin' },
    { id: 'magstock',       label: 'Stock',           group: 'Magasin' },
    { id: 'magrecap',       label: 'Récap magasin',   group: 'Magasin' },

    { id: 'cloture',        label: 'Clôture du lundi', group: 'Gestion' },
    { id: 'quotas3',        label: 'Quotas 3 semaines', group: 'Gestion' },
    { id: 'journal',        label: 'Journal',         group: 'Gestion' },
    { id: 'histo',          label: 'Historique',      group: 'Gestion' },

    { id: 'documents',      label: 'Documents',       group: 'Personnel' },
    { id: 'comrunner',      label: 'Com Runner',      group: 'Personnel' },
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
  /* « documents » est la vue en lecture seule du kit d'entretien : tout le
     monde la voit, personne n'y modifie quoi que ce soit. La page « entretien »
     du groupe RH reste, elle, celle où l'on range les documents. */
  const PERSONNEL = ['masemaine', 'agenda', 'tombola', 'documents'];
  const GESTION   = ['histo', 'cloture', 'quotas3'];   /* le journal reste à la direction */
  const RH_PAGES  = ['rhemployes', 'rhrecrutement', 'entretien', 'blacklist'];
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

    /* Responsables — l'historique du domaine leur est ouvert */
    give('DRH',                    [...RH_PAGES, ...STATS, ...GESTION]);
    give('Responsable Commercial', [...COMMERCE, ...STATS, ...GESTION]);
    give('Responsable Magasin',    ['facturation', 'catalogue', ...STATS, ...GESTION]);
    give('Responsable Runner',     ['catalogue', ...STATS, ...GESTION]);

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

  /* ==========================================================================
     VISIBILITÉ DE L'AGENDA
     --------------------------------------------------------------------------
     Deux listes de rôles, réglées dans Administration ▸ Agenda : qui voit les
     événements « direction », et qui voit les événements « commercial ». Elles
     sont indépendantes l'une de l'autre — c'est volontaire, le patron décide si
     la direction figure aussi dans la liste commerciale.

     Tant qu'elles n'ont jamais été réglées, une présélection est devinée sur le
     nom des rôles : mieux vaut une proposition à corriger qu'un agenda muet.
     ========================================================================== */
  const AGENDA_NIVEAUX = [
    { id: 'direction',  label: 'Direction',
      aide: 'Réunions de responsables, sujets internes. Le niveau le plus fermé.',
      mots: ['patron', 'direction', 'drh', 'responsable', 'resp'] },
    { id: 'commercial', label: 'Commercial',
      aide: 'Locations, livraisons, événements clients — ce que l\'équipe de vente doit voir.',
      mots: ['patron', 'direction', 'drh', 'responsable', 'resp', 'commercial', 'magasin', 'vendeur', 'caviste'] },
  ];

  function devinerAgendaRoles(niveau, roles) {
    return roles.filter(r => {
      const n = normalizeRole(r);
      return niveau.mots.some(k => n === k || n.startsWith(k + ' ') || n.includes(' ' + k));
    });
  }

  /* Les listes retenues, ou la présélection si rien n'a jamais été enregistré. */
  function agendaRoles(settings, roles) {
    const stored = (settings && settings.agendaVis) || {};
    const liste = Array.isArray(roles) ? roles : [];
    const out = {};
    AGENDA_NIVEAUX.forEach(niv => {
      /* Une liste enregistrée est reprise telle quelle : la filtrer contre la
         liste des rôles du serveur la viderait si celle-ci n'a pas pu être
         chargée, et plus personne ne verrait rien. */
      out[niv.id] = Array.isArray(stored[niv.id]) ? stored[niv.id].slice()
                                                  : devinerAgendaRoles(niv, liste);
    });
    return out;
  }

  /* Recalcule ce que la session a le droit de voir. Appelé au démarrage, et à
     nouveau quand le patron enregistre de nouvelles listes — sans rechargement. */
  function appliquerAgendaVis(session, settings, roles) {
    const listes = agendaRoles(settings, roles);
    const a = niveau => session.isPatron || session.isOwner
      || (listes[niveau] || []).some(r => session.roles.includes(r));
    if (window.MarloweSession) {
      window.MarloweSession.voitDirection  = a('direction');
      window.MarloweSession.voitCommercial = a('commercial');
    }
    return listes;
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

      /* Accès extérieur : ni rôles ni matrice, ses pages viennent du serveur. */
      if (s.invite) {
        s.isOwner = false;
        s.isPatron = false;
        return s;
      }

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
    /* Un accès extérieur ne connaît pas les rôles : sa liste vient du serveur,
       et Paramètres n'en fait jamais partie. */
    if (session.invite) {
      const ok = new Set(session.invite.pages || []);
      return PAGES.filter(p => ok.has(p.id)).map(p => p.id);
    }
    /* Une page ajoutée après le dernier réglage de la matrice n'y figure pas :
       la traiter comme « interdite à tous » la rendrait invisible jusqu'à ce
       que quelqu'un pense à rouvrir Paramètres. Les pages du groupe Personnel
       sont ouvertes à tous par nature — on retombe donc sur cette règle plutôt
       que sur le silence. Toutes les autres restent fermées par défaut :
       s'ouvrir toute seule serait le mauvais côté sur lequel se tromper. */
    const ouverteParDefaut = id => PERSONNEL.includes(id);

    return PAGES
      .filter(p => (p.id in perms)
        ? (perms[p.id] || []).some(r => session.roles.includes(r))
        : ouverteParDefaut(p.id))
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
  .mv-discord-btn:disabled{opacity:.55;cursor:default;}
  .mv-ou{display:flex;align-items:center;gap:12px;margin:22px 0 6px;
    font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:#6C6A5F;}
  .mv-ou::before,.mv-ou::after{content:'';height:1px;flex:1;background:#3D372C;}
  .mv-invite summary{cursor:pointer;font-size:13px;color:#9C9384;padding:8px 0;
    list-style:none;text-align:center;}
  .mv-invite summary::-webkit-details-marker{display:none;}
  .mv-invite summary:hover{color:#EDE3CF;}
  .mv-invite[open] summary{color:#EDE3CF;margin-bottom:4px;}

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
  .mv-cell{width:26px;height:26px;border-radius:7px;cursor:pointer;font-size:12px;line-height:1;
    border:1px solid var(--band,#3D372C);background:transparent;font-family:inherit;padding:0;
    display:inline-flex;align-items:center;justify-content:center;transition:.12s;}
  .mv-cell.mv-non{color:rgba(156,147,132,.5);}
  .mv-cell.mv-oui{color:#1C1B18;background:var(--or,#C9A961);border-color:var(--or,#C9A961);font-weight:700;}
  .mv-cell.mv-ro{color:var(--amber,#D6A75C);border-color:rgba(214,167,92,.6);background:rgba(214,167,92,.12);}
  .mv-cell:hover{transform:scale(1.12);}
  /* --- panneau Vitrine --- */
  #mvVitrine{margin-top:24px;}
  #mvVitrine .mv-sub{font-size:12.5px;color:var(--muted,#9C9384);margin:6px 0 20px;}
  .mv-vit-sec{border-top:1px solid var(--band,#3D372C);padding-top:18px;margin-bottom:22px;}
  .mv-vit-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px;}
  .mv-vit-head h4{margin:0;font-size:14px;font-weight:600;}
  .mv-cpt{font-size:11px;color:var(--muted,#9C9384);font-weight:400;margin-left:8px;}
  .mv-nouv-list,.mv-page-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px;}
  .mv-vide-note{font-size:12.5px;color:var(--muted,#9C9384);font-style:italic;
    border:1px dashed var(--band,#3D372C);border-radius:10px;padding:16px;text-align:center;}
  .mv-nouv{display:flex;align-items:center;gap:14px;border:1px solid var(--band,#3D372C);
    border-radius:12px;padding:10px 12px;background:rgba(255,255,255,.02);}
  .mv-nouv-vis{width:104px;height:64px;flex-shrink:0;border-radius:8px;background-size:cover;
    background-position:center;background-color:#1a1814;border:1px solid var(--band,#3D372C);}
  .mv-nouv-champs{flex:1;display:flex;flex-direction:column;gap:7px;min-width:0;}
  .mv-nouv-champs input,.mv-vit-champs input{width:100%;background:rgba(0,0,0,.22);color:inherit;
    border:1px solid var(--band,#3D372C);border-radius:8px;padding:8px 11px;font:inherit;font-size:12.5px;}
  .mv-nouv-actions{display:flex;gap:6px;flex-shrink:0;}
  .mv-nouv-actions .btn{padding:6px 10px;}
  .mv-vit-champs{display:grid;grid-template-columns:1fr 1.6fr;gap:10px;margin-bottom:12px;}
  #mvVitrine .mv-large{width:100%;background:rgba(0,0,0,.22);color:inherit;
    border:1px solid var(--band,#3D372C);border-radius:8px;padding:9px 12px;font:inherit;font-size:12.5px;}
  @media(max-width:760px){.mv-vit-champs{grid-template-columns:1fr;}
    .mv-nouv{flex-wrap:wrap;} .mv-nouv-champs{flex-basis:100%;}}
  .mv-page{display:flex;align-items:center;gap:10px;border:1px solid var(--band,#3D372C);
    border-radius:10px;padding:8px 10px;}
  .mv-page-n{width:22px;text-align:center;font-size:11px;color:var(--muted,#9C9384);flex-shrink:0;}
  .mv-page-vis{flex:1;height:52px;border-radius:6px;background-size:contain;background-repeat:no-repeat;
    background-position:left center;background-color:#141210;}
  .mv-page .btn{padding:5px 9px;}
  .mv-pdf-ok{font-size:12.5px;color:var(--muted,#9C9384);margin:0 0 12px;display:flex;align-items:center;gap:12px;}
  .mv-hint{font-size:11.5px;color:var(--muted,#9C9384);margin:12px 0 0;line-height:1.65;}

  /* --- Accès extérieurs --- */
  #mvInvites{margin-top:24px;}
  #mvInvites .mv-sub{font-size:12.5px;color:var(--muted,#9C9384);margin:6px 0 18px;line-height:1.7;}
  .mv-inv-list{display:flex;flex-direction:column;gap:10px;}
  .mv-inv{border:1px solid var(--band,#3D372C);border-radius:12px;padding:13px 15px;
    background:rgba(255,255,255,.02);}
  .mv-inv.off{opacity:.6;}
  .mv-inv-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;}
  .mv-inv-nom{font-size:14px;font-weight:600;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .mv-inv-code{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--or,#C9A961);
    letter-spacing:.06em;margin-top:3px;}
  .mv-inv-actions{display:flex;gap:6px;flex-wrap:wrap;}
  .mv-inv-actions .btn{padding:6px 12px;font-size:12px;}
  .mv-inv-meta{font-size:11.5px;color:var(--muted,#9C9384);margin-top:9px;}
  .mv-inv-rien{color:#E08A7A;}
  .mv-invp-wrap{max-height:46vh;overflow-y:auto;display:flex;flex-direction:column;gap:14px;margin:6px 0 4px;}
  .mv-invp-groupe{display:flex;flex-wrap:wrap;gap:6px;}
  .mv-invp-titre{width:100%;font-size:10px;letter-spacing:.18em;text-transform:uppercase;
    color:var(--or-soft,#8E7C4E);margin-bottom:2px;}
  .mv-invp{display:inline-flex;align-items:center;gap:8px;font:inherit;font-size:12.5px;cursor:pointer;
    border:1px solid var(--band,#3D372C);background:transparent;color:var(--muted,#9C9384);
    border-radius:999px;padding:6px 13px;transition:.15s;}
  .mv-invp-e{width:8px;height:8px;border-radius:50%;background:var(--band,#3D372C);flex-shrink:0;}
  .mv-invp[data-etat="oui"]{color:var(--parchment,#EDE3CF);border-color:var(--vine,#6E8B5D);}
  .mv-invp[data-etat="oui"] .mv-invp-e{background:var(--vine,#6E8B5D);}
  .mv-invp[data-etat="ro"]{color:var(--amber,#D6A75C);border-color:rgba(214,167,92,.5);}
  .mv-invp[data-etat="ro"] .mv-invp-e{background:var(--amber,#D6A75C);}

  /* --- Com Runner --- */
  .cr-saisie{display:flex;gap:12px;align-items:flex-end;}
  .cr-saisie textarea{flex:1;background:rgba(0,0,0,.22);color:var(--parchment,#EDE3CF);
    border:1px solid var(--band,#3D372C);border-radius:10px;padding:11px 14px;
    font:inherit;font-size:13.5px;resize:vertical;min-height:52px;}
  .cr-fil{display:flex;flex-direction:column;gap:12px;max-height:60vh;overflow-y:auto;}
  .cr-msg{border:1px solid var(--band,#3D372C);border-radius:12px;padding:12px 14px;
    background:rgba(255,255,255,.02);}
  .cr-msg.cr-moi{background:rgba(201,169,97,.06);border-color:rgba(201,169,97,.28);}
  .cr-msg.cr-retrait{border-color:rgba(214,167,92,.45);background:rgba(214,167,92,.09);}
  .cr-tete{display:flex;align-items:center;gap:10px;margin-bottom:7px;}
  .cr-av{width:24px;height:24px;border-radius:50%;flex-shrink:0;
    background:rgba(201,169,97,.15);border:1px solid var(--or-soft,#8E7C4E);color:var(--or,#C9A961);
    display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:600;}
  .cr-nom{font-size:13px;font-weight:600;color:var(--parchment,#EDE3CF);}
  .cr-quand{font-size:10.5px;color:var(--muted,#9C9384);font-family:'IBM Plex Mono',monospace;}
  .cr-x{margin-left:auto;}
  .cr-texte{font-size:13.5px;line-height:1.6;color:var(--parchment,#EDE3CF);opacity:.92;padding-left:34px;}
  .cr-retrait .cr-texte{color:var(--amber,#D6A75C);font-weight:500;}

  /* --- Magasin --- */
  .mag-bon{margin-bottom:14px;}
  .mag-bon-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;
    flex-wrap:wrap;margin-bottom:12px;}
  .mag-bon-qui{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:14px;}
  .mag-bon-meta{font-size:11px;color:var(--muted,#9C9384);font-family:'IBM Plex Mono',monospace;margin-top:4px;}
  .mag-bon-droite{display:flex;align-items:center;gap:14px;}
  .mag-total{font-family:'IBM Plex Mono',monospace;font-size:16px;color:var(--prime,#D4763D);font-weight:600;}
  .mag-statut{font-size:11px;font-weight:600;padding:4px 11px;border-radius:999px;border:1px solid;white-space:nowrap;}
  .mag-s-attente{color:var(--amber,#D6A75C);border-color:rgba(214,167,92,.42);background:rgba(214,167,92,.10);}
  .mag-s-validee{color:var(--vine,#6E8B5D);border-color:rgba(110,139,93,.45);background:rgba(110,139,93,.12);}
  .mag-s-annulee{color:#E08A7A;border-color:rgba(190,80,90,.5);background:rgba(150,52,60,.14);}
  .mag-lignes{margin-top:4px;}
  .mag-annulee{opacity:.62;}
  .mag-alertes{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}
  .mag-alerte{font-size:12px;padding:6px 12px;border-radius:999px;
    color:var(--amber,#D6A75C);border:1px solid rgba(214,167,92,.42);background:rgba(214,167,92,.10);}
  .mag-alerte b{margin-right:6px;color:var(--parchment,#EDE3CF);}
  .mag-inp{width:96px;background:rgba(0,0,0,.22);color:var(--parchment,#EDE3CF);
    border:1px solid var(--band,#3D372C);border-radius:7px;padding:6px 9px;
    font:inherit;font-size:12.5px;text-align:right;font-family:'IBM Plex Mono',monospace;}
  tr.mag-bas .mag-inp{border-color:rgba(214,167,92,.45);}

  /* --- Vue des catalogues dans le panel --- */
  .mv-cat-vue{position:relative;border:1px solid var(--band,#3D372C);border-radius:10px;
    background:rgba(0,0,0,.22);aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;
    overflow:hidden;margin-top:14px;}
  .mv-cat-vue img{max-width:100%;max-height:100%;width:auto;height:auto;display:block;}
  .mv-cat-vue img[hidden]{display:none;}
  .mv-cat-vue.is-embed{display:block;}
  .mv-cat-vue iframe{position:absolute;inset:0;width:100%;height:100%;border:none;}
  .mv-cat-bar{display:flex;align-items:center;gap:12px;margin-top:12px;}
  .mv-cat-n{font-size:12.5px;color:var(--muted,#9C9384);font-variant-numeric:tabular-nums;min-width:60px;text-align:center;}
  .mv-temoin{margin:7px 0 0;font-size:11.5px;line-height:1.6;color:var(--stone,#9C9384);}
  .mv-temoin.est-ok{color:#7FA97F;}
  .mv-temoin code{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--or-soft,#B8A47C);
    word-break:break-all;}

  /* --- Import d'une liste d'employés --- */
  .mv-imp-txt{width:100%;height:190px;resize:vertical;background:rgba(0,0,0,.28);
    border:1px solid var(--band,#3D372C);border-radius:9px;padding:11px 12px;
    color:var(--parchment,#EDE3CF);font-family:'IBM Plex Mono',monospace;font-size:11.5px;
    line-height:1.7;white-space:pre;overflow:auto;}
  .mv-imp-txt:focus{outline:none;border-color:var(--or,#C9A961);}
  .mv-imp-c{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--or-soft,#B8A47C);}
  .mv-imp-rap{display:flex;flex-direction:column;gap:7px;margin:0 0 16px;font-size:12.5px;
    color:var(--parchment,#EDE3CF);}
  .mv-imp-rap b{color:var(--or,#C9A961);}
  .mv-imp-warn{color:var(--muted,#9C9384);border-left:2px solid #8A3540;padding-left:10px;
    line-height:1.6;}
  .mv-imp-apercu{border:1px solid var(--band,#3D372C);border-radius:9px;overflow:hidden;margin-bottom:16px;}
  .mv-imp-apercu table{width:100%;border-collapse:collapse;font-size:11.5px;}
  .mv-imp-apercu th{text-align:left;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;
    color:var(--muted,#9C9384);padding:8px 10px;border-bottom:1px solid var(--band,#3D372C);}
  .mv-imp-apercu td{padding:7px 10px;border-bottom:1px solid rgba(61,55,44,.5);
    color:var(--parchment,#EDE3CF);}
  .mv-imp-apercu tr:last-child td{border-bottom:none;}
  .mv-imp-reste{padding:8px 10px;font-size:11.5px;color:var(--muted,#9C9384);
    background:rgba(0,0,0,.18);}

  /* --- Kit d'entretien --- */
  .ent-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;}
  .ent-head h3{margin:0;}
  .ent-note{margin:5px 0 0;font-size:12.5px;color:var(--stone,#9C9384);line-height:1.6;}
  .ent-rub + .ent-rub{margin-top:18px;}

  .ent-grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:12px;margin-top:16px;}
  .ent-vig{position:relative;border:1px solid var(--band,#3D372C);border-radius:11px;overflow:hidden;
    background:var(--ink,#1C1B18);cursor:pointer;aspect-ratio:4/3;display:flex;flex-direction:column;
    transition:border-color .18s ease, transform .18s ease;}
  .ent-vig:hover{border-color:var(--or,#C9A961);transform:translateY(-2px);}
  .ent-vig img{width:100%;height:100%;object-fit:cover;display:block;}
  .ent-vig-nom{position:absolute;left:0;right:0;bottom:0;padding:16px 9px 7px;font-size:11px;
    color:#EDE3CF;background:linear-gradient(180deg,transparent,rgba(0,0,0,.82));
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .ent-vig-x{position:absolute;top:6px;right:6px;width:23px;height:23px;border-radius:50%;
    border:none;background:rgba(12,11,9,.72);color:#EDE3CF;font-size:12px;line-height:1;cursor:pointer;
    opacity:0;transition:opacity .15s ease, background .15s ease;}
  .ent-vig:hover .ent-vig-x{opacity:1;}
  .ent-vig-x:hover{background:#C4674F;}

  .ent-vig.est-lien{aspect-ratio:auto;min-height:74px;align-items:center;justify-content:center;gap:7px;
    text-decoration:none;padding:14px 10px;text-align:center;}
  .ent-vig.est-lien .ent-vig-nom{position:static;padding:0;background:none;white-space:normal;
    color:var(--or-soft,#B8A47C);}
  .ent-vig.est-lien:hover .ent-vig-x{opacity:1;}
  .ent-lien-ic{font-size:19px;opacity:.75;}

  /* La scène de présentation : nue, pour que le document occupe tout. */
  .ent-scene{position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;
    background:rgba(8,7,6,.96);padding:34px;}
  .ent-scene.on{display:flex;}
  .ent-grand{max-width:96vw;max-height:92vh;object-fit:contain;border-radius:6px;
    box-shadow:0 30px 90px rgba(0,0,0,.6);}
  .ent-fermer{position:absolute;top:18px;right:22px;width:40px;height:40px;border-radius:50%;
    border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:#EDE3CF;
    font-size:16px;cursor:pointer;transition:.15s;}
  .ent-fermer:hover{background:rgba(255,255,255,.14);}
  .ent-fleche{position:absolute;top:50%;transform:translateY(-50%);width:52px;height:52px;border-radius:50%;
    border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#EDE3CF;
    font-size:27px;line-height:1;cursor:pointer;transition:.15s;}
  .ent-fleche:hover{background:rgba(255,255,255,.14);}
  .ent-fleche.est-gauche{left:20px;}
  .ent-fleche.est-droite{right:20px;}
  .ent-fleche[hidden]{display:none;}
  .ent-legende{position:absolute;left:0;right:0;bottom:16px;text-align:center;font-size:12px;
    letter-spacing:.05em;color:rgba(237,227,207,.6);pointer-events:none;}
  @media(max-width:700px){
    .ent-scene{padding:14px;}
    .ent-fleche{width:42px;height:42px;font-size:22px;}
    .ent-fleche.est-gauche{left:6px;} .ent-fleche.est-droite{right:6px;}
  }

  /* --- Bon de commande à plusieurs lignes --- */
  .mv-bon-form select,.mv-bon-form input[type=text],.mv-bon-form input[type=number]{
    width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--band,#3D372C);
    background:var(--ink,#1C1B18);color:var(--parchment,#EDE3CF);font-size:13px;font-family:inherit;}
  .mv-bon-lab{display:block;font-size:11px;letter-spacing:.12em;text-transform:uppercase;
    color:var(--stone,#9C9384);margin:0 0 7px;}
  .mv-bon-table{width:100%;margin-top:4px;table-layout:auto;}
  .mv-bon-table td:first-child{min-width:250px;}
  .mv-bon-table th{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--stone,#9C9384);
    padding:0 6px 6px;text-align:left;}
  .mv-bon-table th.num,.mv-bon-table td.num{text-align:right;}
  .mv-bon-table td{padding:4px 6px;vertical-align:middle;border:none;
    font-family:'IBM Plex Mono',monospace;font-size:12.5px;color:var(--parchment,#EDE3CF);}
  .mv-bon-table td:first-child{padding-left:0;}
  .mv-bon-total{font-size:13px;color:var(--stone,#9C9384);}
  .mv-bon-total b{font-family:'IBM Plex Mono',monospace;color:var(--or,#C9A961);font-size:15px;}
  .mv-bl-del{opacity:.6;}
  .mv-bl-del:hover{opacity:1;color:#C4674F;}

  #catCitoyens .mv-sub,#catEntreprise .mv-sub{font-size:12.5px;color:var(--muted,#9C9384);margin:6px 0 0;line-height:1.65;}

  /* --- Règles du domaine --- */
  #mvReglages{margin-top:24px;}
  #mvReglages .mv-sub{font-size:12.5px;color:var(--muted,#9C9384);margin:6px 0 20px;}
  #mvReglages h4{margin:0 0 4px;font-size:14px;font-weight:600;}
  .mv-lab{display:flex;flex-direction:column;gap:6px;font-size:11px;letter-spacing:.1em;
    text-transform:uppercase;color:var(--muted,#9C9384);}
  .mv-lab input{background:rgba(0,0,0,.22);color:var(--parchment,#EDE3CF);
    border:1px solid var(--band,#3D372C);border-radius:8px;padding:9px 12px;
    font:inherit;font-size:13px;letter-spacing:0;text-transform:none;}

  /* --- Quota de prise de service, dans Ma semaine --- */
  .mv-qs{margin-top:18px;padding-top:16px;border-top:1px solid var(--band,#3D372C);}
  .mv-qs-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px;}
  .mv-qs-l{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted,#9C9384);}
  .mv-qs-v{font-family:'IBM Plex Mono',monospace;font-size:14px;color:var(--parchment,#EDE3CF);}
  .mv-qs-v.ok{color:var(--vine,#6E8B5D);}
  .mv-qs-bar{height:7px;border-radius:99px;background:rgba(0,0,0,.3);overflow:hidden;}
  .mv-qs-bar i{display:block;height:100%;border-radius:99px;background:var(--or,#C9A961);
    transition:width .4s ease;}
  .mv-qs-bar i.ok{background:var(--vine,#6E8B5D);}
  .mv-qs-note{font-size:11.5px;color:var(--muted,#9C9384);margin:8px 0 0;}

  .mv-danger{margin-top:24px;border-color:rgba(138,53,64,.45);background:rgba(138,53,64,.07);}
  .mv-danger h3{color:#E08A7A;}
  .mv-danger p,
  .mv-admin-note{font-size:12.5px;line-height:1.7;color:var(--muted,#9C9384);margin:8px 0 16px;max-width:760px;}
  .mv-legende{font-size:11.5px;color:var(--muted,#9C9384);line-height:2.1;margin-top:14px;max-width:820px;}
  .mv-legende .mv-cell{vertical-align:middle;margin:0 2px;cursor:default;}
  .mv-legende .mv-cell:hover{transform:none;}
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

          <div class="mv-ou"><span>ou</span></div>

          <details class="mv-invite">
            <summary>J'ai un code d'accès</summary>
            <p class="mv-note" style="margin:10px 0 14px;">Réservé aux intervenants extérieurs,
              à qui le patron a remis un code et un mot de passe.</p>
            <div class="mv-field">
              <label for="mvCode">Code d'accès</label>
              <input type="text" id="mvCode" placeholder="MV-XXXXXXXX" autocomplete="off" spellcheck="false">
            </div>
            <div class="mv-field">
              <label for="mvMdp">Mot de passe</label>
              <input type="password" id="mvMdp" autocomplete="current-password">
            </div>
            <button class="mv-discord-btn" id="mvInviteGo" style="background:#3D372C;">Entrer</button>
            <div class="mv-gate-error" id="mvInviteErr"></div>
          </details>
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

      const go = gate.querySelector('#mvInviteGo');
      const err = gate.querySelector('#mvInviteErr');
      const tenter = async () => {
        const code = gate.querySelector('#mvCode').value.trim();
        const mdp  = gate.querySelector('#mvMdp').value;
        if (!code || !mdp) { err.textContent = 'Code et mot de passe sont requis.'; return; }

        go.disabled = true; err.textContent = '';
        try {
          const res = await fetch(CONFIG.API_BASE + '/api/invite-login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, mdp }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            /* Message volontairement identique pour un code inconnu et un
               mauvais mot de passe : distinguer les deux dirait à un curieux
               quels codes existent. */
            err.textContent = res.status === 429
              ? (data.detail || 'Trop de tentatives.')
              : 'Code ou mot de passe incorrect.';
            go.disabled = false;
            return;
          }
          ls.set(LS_TOKEN, data.token);
          location.reload();
        } catch (e) {
          err.textContent = 'Serveur injoignable. Réessayez dans un instant.';
          go.disabled = false;
        }
      };
      go.addEventListener('click', tenter);
      gate.querySelector('#mvMdp').addEventListener('keydown', e => { if (e.key === 'Enter') tenter(); });
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
          <div class="mv-user-role" title="${esc(session.invite ? 'Accès extérieur' : session.roles.join(', '))}">${
            session.invite ? '<span class="mv-owner-tag">Accès extérieur</span>'
            : (session.isOwner ? '<span class="mv-owner-tag">Accès permanent</span> · ' : '')
              + esc(session.roles.join(' · '))
          }</div>
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

    /* Le rail est bâti sur ces mêmes sections : une section dont toutes les
       pages viennent d'être masquées doit disparaître avec elles. */
    if (window.mvRail) window.mvRail.sync();

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
    /* réassigné après un enregistrement des listes d'agenda */
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
          ${otherRoles.map(r => {
            const vu = (perms[p.id] || []).includes(r);
            const ro = ((settings.permsRO || {})[p.id] || []).includes(r);
            const etat = !vu ? 'non' : (ro ? 'ro' : 'oui');
            return `<td><button type="button" class="mv-cell mv-${etat}"
              data-cell="${esc(p.id)}|${esc(r)}" data-etat="${etat}"
              title="${etat === 'non' ? 'Aucun accès' : etat === 'ro' ? 'Lecture seule' : 'Accès complet'} — cliquez pour changer"
              >${etat === 'non' ? '·' : etat === 'ro' ? '👁' : '✓'}</button></td>`;
          }).join('')}
        </tr>`;
      });
    });

    /* Rôles proposés pour l'agenda : les mêmes que dans la matrice des accès,
       patron compris — il figure dans les listes même s'il voit tout de toute
       façon, pour que ce qui est coché reflète la règle écrite. */
    const rolesAgenda = visible.slice();
    const agendaListes = agendaRoles(settings, roles);

    const banniereTest = CONFIG.MODE !== 'discord' ? `
      <div class="mv-demo-banner" style="max-width:760px;">
        <b>Mode test</b>
        Les rôles affichés sont une liste d'exemple et les réglages sont enregistrés
        dans ce navigateur uniquement. Une fois le backend branché, les rôles seront
        lus directement sur le Discord et les réglages partagés par tout le monde.
      </div>` : '';

    /* ----------------------------------------------------------------------
       Une seule page « Paramètres » empilait cinq sujets sans rapport : les
       droits d'accès, la vitrine publique, les règles de prime, les accès
       extérieurs et le vidage des données. On y descendait à l'aveugle et le
       bouton « Vider les données » se retrouvait à deux écrans du haut.
       Chaque sujet a maintenant son entrée dans la colonne Administration.
       L'identifiant « parametres » reste celui de la première page : c'est
       lui que connaissent les droits, le rail et les anciens liens.
       ---------------------------------------------------------------------- */
    const RUBRIQUES = [
      {
        id: 'parametres',
        menu: 'Accès & rôles',
        titre: 'Accès & rôles',
        sub: `Qui voit quoi dans le panel. Chaque case fait tourner trois états :
              aucun accès, accès complet, lecture seule.`,
        html: `
          ${banniereTest}

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

          <p class="mv-legende">
            <span class="mv-cell mv-non">·</span> aucun accès ·
            <span class="mv-cell mv-oui">✓</span> accès complet ·
            <span class="mv-cell mv-ro">👁</span> lecture seule — la page est visible mais rien n'y est modifiable.
            Cliquez sur une case pour faire tourner les trois états.
          </p>

          <div class="btn-row" style="margin-top:18px;align-items:center;">
            <button class="btn primary" id="mvSave">Enregistrer</button>
            <button class="btn" id="mvReset">Réinitialiser les accès</button>
            <span class="mv-saved" id="mvSaved">Enregistré ✓</span>
          </div>`,
      },
      {
        id: 'paramagenda',
        menu: 'Agenda',
        titre: 'Visibilité de l\'agenda',
        sub: `Un événement publié en « direction » ou en « commercial » n'apparaît que
              pour les rôles cochés ici — ni dans la liste, ni dans la grille de la semaine
              pour les autres. Le patron voit tous les événements « direction » et
              « commercial », qu'il soit coché ou non — il ne peut pas se verrouiller
              hors de son propre agenda. Un événement <b>privé</b> échappe à la règle :
              seul son auteur le voit, patron compris.`,
        html: `
          <div class="panel">
            ${AGENDA_NIVEAUX.map(niv => `
              <div class="mv-vit-sec"${niv.id === AGENDA_NIVEAUX[0].id
                ? ' style="border-top:none;padding-top:0;"' : ''}>
                <h4>Événements « ${esc(niv.label)} » <span class="mv-cpt"
                  id="mvAgCpt-${niv.id}">${(agendaListes[niv.id] || []).length} rôle(s)</span></h4>
                <p class="mv-hint" style="margin:0 0 12px;">${niv.aide}</p>
                <div class="mv-role-list mv-pick" id="mvAg-${niv.id}">
                  ${rolesAgenda.map(r => `<div class="mv-role-chip${
                    (agendaListes[niv.id] || []).includes(r) ? ' on' : ''
                  }" data-role="${esc(r)}">${esc(r)}</div>`).join('')}
                </div>
              </div>`).join('')}

            <p class="mv-hint" style="max-width:760px;">Les deux listes sont indépendantes :
              si vous voulez que la direction voie aussi les événements commerciaux,
              cochez-la dans les deux. Le niveau <b>privé</b>, lui, ne se règle pas —
              un événement privé n'est visible que par celui qui l'a créé.</p>

            <div class="btn-row" style="margin-top:6px;align-items:center;">
              <button class="btn primary" id="mvAgSave">Enregistrer</button>
              <button class="btn" id="mvAgGuess">Re-deviner</button>
              <span class="mv-saved" id="mvAgSaved">Enregistré ✓</span>
            </div>
          </div>`,
      },
      {
        id: 'paramvitrine',
        menu: 'Vitrine publique',
        titre: 'Vitrine publique',
        sub: `Ce que voient les visiteurs du site : les nouveautés mises en avant et
              les deux catalogues, citoyens et entreprises.`,
        html: `<div class="panel" id="mvVitrine"></div>`,
      },
      {
        id: 'paramregles',
        menu: 'Règles du domaine',
        titre: 'Règles du domaine',
        sub: `Deux règles que vous fixez une fois : le quota de prise de service et
              la prime de recrutement. Elles s'appliquent ensuite toutes seules,
              semaine après semaine.`,
        html: `<div class="panel" id="mvReglages"></div>`,
      },
      {
        id: 'paraminvites',
        menu: 'Accès extérieurs',
        titre: 'Accès extérieurs',
        sub: `Des codes d'accès pour ceux qui ne sont pas sur le Discord — un comptable,
              un partenaire. Vous choisissez les pages qu'ils voient, et la coupure est
              immédiate.`,
        html: `<div class="panel" id="mvInvites"></div>`,
      },
      {
        id: 'paramdonnees',
        menu: 'Données du panel',
        titre: 'Données du panel',
        sub: `Remplir le panel pour l'essayer, ou le vider pour démarrer proprement.
              Ces deux boutons touchent les données de tout le monde.`,
        html: `
          <div class="panel">
            <h3>Jeu de démonstration</h3>
            <p class="mv-admin-note">Remplit RH, Commerce et Quotas de données inventées mais cohérentes —
               les mêmes personnes d'un tableau à l'autre, des chiffres qui s'additionnent
               juste. De quoi juger les écrans pleins plutôt que vides.
               <b>Ces données partent sur le serveur comme les vraies : toute l'équipe les verra.</b>
               Le bouton juste en dessous les retire.</p>
            <button class="btn" id="mvDemo">Charger un jeu de démonstration…</button>
          </div>

          <div class="panel mv-danger">
            <h3>Repartir de zéro</h3>
            <p>Vide les données du panel pour démarrer proprement — employés, factures, production,
               semaines clôturées. Vous choisissez ce qui part. Contrairement à une clôture,
               <b>rien n'est archivé et l'opération ne s'annule pas</b>.</p>
            <button class="btn" id="mvWipe">🗑 Vider les données…</button>
          </div>`,
      },
    ];

    /* --- entrées de menu + pages --- */
    const nav = document.querySelector('.sidebar nav');
    const sec = document.createElement('div');
    sec.className = 'nav-section';
    sec.textContent = 'Administration';
    nav.appendChild(sec);

    const contenu = document.querySelector('.content');
    /* Le pied de page fait partie de .content : une page simplement ajoutée à
       la fin se retrouverait SOUS la citation du domaine. On insère avant. */
    const pied = contenu.querySelector('.domain-footer');
    const pages = {};

    RUBRIQUES.forEach(r => {
      const item = document.createElement('div');
      item.className = 'nav-item';
      item.dataset.page = r.id;
      item.textContent = r.menu;
      nav.appendChild(item);

      const page = document.createElement('div');
      page.className = 'page-content';
      page.id = 'page-' + r.id;
      page.innerHTML = `
        <h1 class="page-title">${esc(r.titre)}</h1>
        <p class="page-sub">${r.sub}</p>
        ${r.html}`;
      if (pied) contenu.insertBefore(page, pied); else contenu.appendChild(page);
      pages[r.id] = page;

      /* Le gestionnaire de pages du panel a été posé avant que ces entrées
         n'existent : chacune ouvre donc la sienne elle-même. */
      item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        page.classList.add('active');
      });
    });

    /* La section vient d'apparaître après la construction du rail : on le
       refait, il est idempotent. */
    if (window.mvRail) window.mvRail.construire();

    const acces = pages.parametres;

    /* Les panneaux « Vitrine », « Règles » et « Accès extérieurs » sont montés
       par marlowe-actions.js : c'est lui qui tient les données et sait parler
       au serveur d'images. On le prévient que ses points d'accroche existent. */
    document.dispatchEvent(new CustomEvent('mv:parametres-pret', { detail: { page: acces, pages } }));

    /* --- choix des rôles retenus --- */
    const pick = acces.querySelector('#mvPick');
    pick.addEventListener('click', e => {
      const chip = e.target.closest('[data-role]');
      if (chip) chip.classList.toggle('on');
    });

    acces.querySelector('#mvGuessRoles').addEventListener('click', () => {
      pick.querySelectorAll('[data-role]').forEach(c =>
        c.classList.toggle('on', looksLikeDomainRole(c.dataset.role)));
    });

    acces.querySelector('#mvApplyRoles').addEventListener('click', async () => {
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
    /* Un clic sur une cellule fait tourner les trois états. */
    acces.addEventListener('click', e => {
      const cell = e.target.closest('[data-cell]');
      if (cell) {
        const suite = { non: 'oui', oui: 'ro', ro: 'non' };
        const etat = suite[cell.dataset.etat] || 'oui';
        cell.dataset.etat = etat;
        cell.className = 'mv-cell mv-' + etat;
        cell.textContent = etat === 'non' ? '·' : etat === 'ro' ? '👁' : '✓';
        cell.title = (etat === 'non' ? 'Aucun accès' : etat === 'ro' ? 'Lecture seule' : 'Accès complet')
                   + ' — cliquez pour changer';
        return;
      }

      const btn = e.target.closest('[data-toggle-row]');
      if (!btn) return;
      const cells = acces.querySelectorAll(`[data-cell^="${btn.dataset.toggleRow}|"]`);
      const tout = [...cells].every(c => c.dataset.etat !== 'non');
      cells.forEach(c => {
        c.dataset.etat = tout ? 'non' : 'oui';
        c.className = 'mv-cell mv-' + c.dataset.etat;
        c.textContent = tout ? '·' : '✓';
      });
    });

    /* --- visibilité de l'agenda --- */
    const pageAg = pages.paramagenda;
    AGENDA_NIVEAUX.forEach(niv => {
      const box = pageAg.querySelector('#mvAg-' + niv.id);
      const cpt = pageAg.querySelector('#mvAgCpt-' + niv.id);
      const recompter = () =>
        { cpt.textContent = box.querySelectorAll('[data-role].on').length + ' rôle(s)'; };
      box.addEventListener('click', e => {
        const chip = e.target.closest('[data-role]');
        if (!chip) return;
        chip.classList.toggle('on');
        recompter();
      });
    });

    pageAg.querySelector('#mvAgGuess').addEventListener('click', () => {
      AGENDA_NIVEAUX.forEach(niv => {
        const devine = devinerAgendaRoles(niv, rolesAgenda);
        const box = pageAg.querySelector('#mvAg-' + niv.id);
        box.querySelectorAll('[data-role]').forEach(c =>
          c.classList.toggle('on', devine.includes(c.dataset.role)));
        pageAg.querySelector('#mvAgCpt-' + niv.id).textContent =
          box.querySelectorAll('[data-role].on').length + ' rôle(s)';
      });
    });

    pageAg.querySelector('#mvAgSave').addEventListener('click', async () => {
      const agendaVis = {};
      AGENDA_NIVEAUX.forEach(niv => {
        agendaVis[niv.id] = [...pageAg.querySelectorAll('#mvAg-' + niv.id + ' [data-role].on')]
          .map(c => c.dataset.role);
      });
      try {
        const next = Object.assign({}, settings, { agendaVis });
        await Store.setSettings(next);
        settings = next;
        /* Appliqué tout de suite, sans rechargement : l'agenda de cet écran
           doit refléter la règle que l'on vient d'écrire. */
        const S = window.MarloweSession;
        if (S) appliquerAgendaVis(S, next, rolesAgenda);
        const a = window.MarloweActions;
        if (a && a.rafraichirAgenda) a.rafraichirAgenda();
        const tag = pageAg.querySelector('#mvAgSaved');
        tag.classList.add('on');
        setTimeout(() => tag.classList.remove('on'), 1800);
      } catch (e) {
        alert("Impossible d'enregistrer : " + e.message);
      }
    });

    const demo = pages.paramdonnees.querySelector('#mvDemo');
    if (demo) demo.addEventListener('click', () => {
      const a = window.MarloweActions;
      if (a && a.chargerDemo) a.chargerDemo();
    });

    const wipe = pages.paramdonnees.querySelector('#mvWipe');
    if (wipe) wipe.addEventListener('click', () => {
      const a = window.MarloweActions;
      if (a && a.repartirDeZero) a.repartirDeZero();
    });

    /* --- enregistrer --- */
    acces.querySelector('#mvSave').addEventListener('click', async () => {
      const next = {}, nextRO = {};
      PAGES.forEach(p => { next[p.id] = []; nextRO[p.id] = []; });

      acces.querySelectorAll('[data-cell]').forEach(c => {
        const [pid, role] = c.dataset.cell.split('|');
        if (c.dataset.etat === 'non') return;
        next[pid].push(role);
        if (c.dataset.etat === 'ro') nextRO[pid].push(role);
      });

      try {
        await Store.setSettings(Object.assign({}, settings, { permsRO: nextRO }));
        await Store.setPermissions(next);
        const tag = acces.querySelector('#mvSaved');
        tag.classList.add('on');
        setTimeout(() => tag.classList.remove('on'), 1800);
      } catch (e) {
        alert("Impossible d'enregistrer : " + e.message);
      }
    });

    /* --- réinitialiser --- */
    acces.querySelector('#mvReset').addEventListener('click', async () => {
      const def = defaultPermissions();
      acces.querySelectorAll('[data-cell]').forEach(c => {
        const [pid, role] = c.dataset.cell.split('|');
        const on = (def[pid] || []).includes(role);
        c.dataset.etat = on ? 'oui' : 'non';
        c.className = 'mv-cell mv-' + c.dataset.etat;
        c.textContent = on ? '✓' : '·';
      });
      await Store.setSettings(Object.assign({}, settings, { permsRO: {} }));
      await Store.setPermissions(def);
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
    const perms = await Store.getPermissions();
    const settings0 = await Store.getSettings();

    /* Pages que ce membre peut voir sans pouvoir les modifier. Le patron
       n'est jamais en lecture seule. */
    const ro = settings0.permsRO || {};
    const readOnly = session.isPatron ? []
      : session.invite ? (session.invite.ro || [])
      : PAGES.map(p => p.id)
             .filter(id => (ro[id] || []).some(r => session.roles.includes(r)));

    window.MarloweSession = {
      id: session.user.id,
      name: session.user.name,
      roles: session.roles.slice(),
      isPatron: session.isPatron,
      isOwner: session.isOwner,
      invite: session.invite || null,
      readOnly,
    };

    /* Ce que cette session a le droit de voir dans l'agenda. Calculé une fois,
       avant le premier rendu : le tri des événements le lit à chaque affichage. */
    appliquerAgendaVis(session, settings0, roles);

    applyNavFilter(allowedPages(session, perms));
    addUserBadge(session);
    if (session.isPatron) buildSettings(roles, perms, settings0);
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
