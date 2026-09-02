/* ============================================================================
   MARLOWE VINEYARD — Mémoire du panel
   ----------------------------------------------------------------------------
   gestion.html a été écrit avec ses données en dur dans le JavaScript :
   elles repartent à zéro à chaque rafraîchissement. Ce fichier leur donne
   une mémoire, sans réécrire le panel.

   Le principe : les tableaux d'origine ne sont jamais remplacés, ils sont
   REMPLIS SUR PLACE avec ce qui vient du serveur. Tout le code existant
   continue donc de fonctionner tel quel — il travaille sur les mêmes
   tableaux, simplement avec le bon contenu dedans.

   Utilisation depuis le panel, après avoir modifié une collection :

       MarloweData.save('blacklist');       // enregistre et redessine
       MarloweData.save('rhRoster', false); // enregistre sans redessiner

   En mode démo (sans backend), tout est gardé dans le navigateur.
   ============================================================================ */

window.MarloweData = (function () {
  'use strict';

  /* ------------------------------------------------------------------------
     1. LES COLLECTIONS
     Chaque entrée relie un nom de rangement au tableau vivant du panel,
     et aux fonctions qui doivent redessiner l'écran quand il change.

     Attention : plusieurs fonctions du panel attendent un argument
     (renderRhRoster(liste), renderArticles(recherche, catégorie)…). Les
     appeler à vide lèverait une erreur et l'écran ne serait pas redessiné.
     Chaque entrée décrit donc l'appel complet, pas seulement un nom.
     ------------------------------------------------------------------------ */
  const call = (name, ...args) => () => {
    const fn = window[name];
    if (typeof fn === 'function') fn(...args);
  };

  const COLLECTIONS = {
    effectif: {
      ref: () => effectifData,
      render: [() => renderEffectif(window.mvEffectifFiltre ? window.mvEffectifFiltre() : effectifData),
               call('renderEligibilite'), call('updateGradeCounts'), call('populateOverview'),
               call('renderPrimes'), call('renderMaSemaine'),
               () => { const a = window.MarloweActions; if (a) a.refreshEffectifFilters(); }],
    },
    dash: {
      ref: () => dash,
      render: [() => renderDash(dash), call('updateGradeCounts'), call('populateOverview'),
               () => { const a = window.MarloweActions;
                       /* Les tickets de tombola se déduisent des runs : le
                          tableau de bord change, la roue doit suivre. */
                       if (a) { a.renderBilan(); a.renderTombola(); } }],
    },
    rhRoster:        { ref: () => rhRosterData,
                       render: [() => renderRhRoster(rhRosterData),
                                () => { const a = window.MarloweActions;
                                        if (a) { a.appliquerAccesService(); a.renderAvertissements();
                                                 a.renderPrimeRecrutement();
                                                 /* L'équipe de vente et la fiche de la
                                                    personne connectée se lisent dans le
                                                    registre : il change, le magasin suit. */
                                                 a.renderCommandes(); a.renderMagRecap(); } }] },
    avertissements:  { ref: () => window.MarloweAvertissements,
                       render: [() => { const a = window.MarloweActions; if (a) a.renderAvertissements(); }] },
    rhRecruiters:    { ref: () => rhRecruiters,        render: [call('renderRecruiters')] },
    rhDeparts:       { ref: () => rhDeparts,           render: [call('renderDeparts')] },
    rhAbsences:      { ref: () => rhAbsences,          render: [call('renderAbsences')] },
    blacklist:       { ref: () => blacklistData,       render: [call('renderBlacklist')] },
    clients:         { ref: () => clientsData,         render: [() => renderClients(clientsData)] },
    /* On garde articlesData, pas rawArticles : c'est la liste réellement
       affichée et modifiée (elle porte les références et les poids calculés). */
    articles:        { ref: () => articlesData,        render: [() => renderArticles('', 'all')] },
    historique:      { ref: () => historiqueData,      render: [call('renderHistorique')] },
    facturesRecues:  { ref: () => facturesRecuesData,
                       render: [call('renderFacturesRecues'),
                                () => { const a = window.MarloweActions; if (a) a.renderBilan(); }] },
    catalogueSlides: { ref: () => catalogueSlides,     render: [] },
    depenses:        { ref: () => depensesData,        render: [call('bcRenderDetail')] },
    retraits:        { ref: () => retraitsData,        render: [call('bcRenderDetail')] },
    agenda:          { ref: () => agendaData,          render: [call('renderAgendaList'), call('renderWeekGrid')] },
    entretien:       { ref: () => entretienKit,
                       render: [() => { const a = window.MarloweActions;
                                        /* la page RH où l'on range, et la page
                                           Personnel où l'on consulte */
                                        if (a) { a.renderEntretien(); a.renderDocuments(); } }] },
    tombola:         { ref: () => tombolaParticipants,
                       render: [() => { const a = window.MarloweActions;
                                        if (a) a.renderTombola(); }] },
    serviceHistory:  { ref: () => serviceHistory,
                       render: [call('renderServiceHistory'),
                                () => { const a = window.MarloweActions; if (a) a.renderQuotaService(); }] },

    /* Primes exceptionnelles de la semaine et réglage du palier :
       vivent dans marlowe-actions.js, d'où le passage par window. */
    linterna: {
      ref: () => window.MarloweLinterna,
      render: [() => { const a = window.MarloweActions;
                       if (a) { a.renderLinterna(); a.renderBilan(); } }],
    },
    primesExc: {
      ref: () => window.MarlowePrimesExc,
      render: [() => { const a = window.MarloweActions; if (a) { a.renderPrimesExc(); a.renderBilan(); } }],
    },
    bilanConfig: {
      ref: () => window.MarloweBilanConfig,
      render: [() => { const a = window.MarloweActions; if (a) a.renderBilan(); }],
    },
    bcManuels: {
      ref: () => window.MarloweBcManuels,
      render: [() => { const a = window.MarloweActions; if (a) a.renderBilan(); }],
    },

    /* Magasin : bons de commande et état des rayons. */
    commandes: {
      ref: () => window.MarloweCommandes,
      render: [() => { const a = window.MarloweActions;
                       if (a) { a.renderCommandes(); a.renderMagRecap(); } }],
    },
    stock: {
      ref: () => window.MarloweStock,
      render: [() => { const a = window.MarloweActions; if (a) a.renderStock(); }],
    },
    comRunner: {
      ref: () => window.MarloweComRunner,
      render: [() => { const a = window.MarloweActions; if (a) a.renderComRunner(); }],
    },

    /* Règles du domaine : quota de service et prime de recrutement.
       Ce sont des réglages, pas des données de semaine — la clôture n'y touche pas. */
    reglages: {
      ref: () => window.MarloweReglages,
      render: [() => { const a = window.MarloweActions;
                       if (a) { a.renderRegles(); a.renderBilan(); } }],
    },
    clotureSteps: {
      ref: () => window.MarloweClotureSteps,
      render: [() => { const a = window.MarloweActions; if (a) a.renderCloture(); }],
    },

    /* Ce que le patron publie sur la page d'accueil : les nouveautés et les
       pages du catalogue. Objet et non tableau — l'hydratation sur place sait
       traiter les deux. */
    vitrine: {
      ref: () => window.MarloweVitrine,
      render: [() => { const a = window.MarloweActions;
                       if (a) { a.renderVitrine(); a.renderCatalogues(); } }],
    },

    /* Semaines clôturées + photo permettant d'annuler la dernière clôture.
       Vit dans marlowe-actions.js, d'où le passage par window. */
    clotures: {
      ref: () => window.MarloweClotures,
      render: [() => { const a = window.MarloweActions;
                       if (a) { a.renderEligibilite(); a.refreshWeekHeaders();
                                a.renderWeekHistory(); a.renderHistorique();
                                a.renderQuotas3(); a.renderMaSemaine(); } }],
    },
  };

  const LS_KEY = 'mv.data';
  let loaded = false;

  /* ------------------------------------------------------------------------
     2. OUTILS
     ------------------------------------------------------------------------ */

  /* Récupère le tableau vivant, ou null s'il n'existe pas dans cette page. */
  function ref(key) {
    const c = COLLECTIONS[key];
    if (!c) return null;
    try { return c.ref(); } catch (e) { return null; }
  }

  /* Remplit une structure SUR PLACE, sans la remplacer :
     c'est ce qui permet à tout le code existant de continuer à marcher. */
  function fillInPlace(target, source) {
    if (Array.isArray(target) && Array.isArray(source)) {
      target.length = 0;
      source.forEach(v => target.push(v));
      return true;
    }
    if (target && typeof target === 'object' && source && typeof source === 'object') {
      Object.keys(target).forEach(k => { delete target[k]; });
      Object.assign(target, source);
      return true;
    }
    return false;
  }

  /* Rejoue les fonctions d'affichage d'une collection. Une page absente ou
     une fonction manquante ne doit jamais interrompre le reste. */
  function redraw(key) {
    const c = COLLECTIONS[key];
    if (!c) return;
    c.render.forEach((fn, i) => {
      try { fn(); }
      catch (e) {
        console.warn('[Marlowe] affichage de « ' + key + ' » (étape ' + (i + 1) + ') : ' + e.message);
      }
    });
    /* Un tableau redevenu vide reçoit son message plutôt que rien du tout. */
    const a = window.MarloweActions;
    if (a && a.remplirVides) { try { a.remplirVides(); } catch (e) {} }
  }

  function redrawAll() {
    Object.keys(COLLECTIONS).forEach(redraw);
  }

  /* ------------------------------------------------------------------------
     3. TRANSPORT — serveur en production, navigateur en mode démo
     ------------------------------------------------------------------------ */
  const cfg = () => (window.MarloweAuth && window.MarloweAuth.CONFIG) || { MODE: 'demo', API_BASE: '' };

  function localRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function localWrite(obj) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch (e) {}
  }

  async function fetchAll() {
    const c = cfg();
    if (c.MODE !== 'discord') return localRead();

    let tok = null;
    try { tok = JSON.parse(localStorage.getItem('mv.token') || 'null'); } catch (e) {}
    if (!tok) return {};

    const res = await fetch(c.API_BASE + '/api/data', {
      headers: { 'Authorization': 'Bearer ' + tok },
    });
    if (!res.ok) throw new Error('lecture ' + res.status);
    return res.json();
  }

  async function pushKeys(payload) {
    const c = cfg();
    if (c.MODE !== 'discord') {
      const all = localRead();
      Object.assign(all, payload);
      localWrite(all);
      return;
    }

    let tok = null;
    try { tok = JSON.parse(localStorage.getItem('mv.token') || 'null'); } catch (e) {}
    if (!tok) throw new Error('non connecté');

    const res = await fetch(c.API_BASE + '/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('écriture ' + res.status);
    /* On retient notre propre révision : inutile de se resynchroniser
       sur une modification que l'on vient de faire soi-même. */
    try { const j = await res.json(); if (j && j.rev) myRev = j.rev; } catch (e) {}
  }

  /* ------------------------------------------------------------------------
     4. ENREGISTREMENT — groupé, pour ne pas envoyer dix requêtes d'affilée
     ------------------------------------------------------------------------ */
  const pending = new Set();
  let timer = null;
  let inFlight = false;
  let noteEnAttente = '';        /* description de l'action, pour le journal */

  function flush() {
    if (inFlight || !pending.size) return;
    const keys = [...pending];
    pending.clear();

    const payload = {};
    keys.forEach(k => { const r = ref(k); if (r) payload[k] = r; });
    if (!Object.keys(payload).length) return;

    if (noteEnAttente) { payload._log = noteEnAttente; noteEnAttente = ''; }

    inFlight = true;
    setStatus('saving');
    pushKeys(payload)
      .then(() => setStatus('saved'))
      .catch(err => {
        /* Un refus de droits ne se répare pas en réessayant : on arrête. */
        if (String(err.message).includes('403')) {
          setStatus('error', 'écriture refusée — vous êtes en lecture seule sur cette page');
          return;
        }
        setStatus('error', err.message);
        /* On remet les clés en file : la prochaine tentative les reprendra. */
        keys.forEach(k => pending.add(k));
      })
      .finally(() => {
        inFlight = false;
        if (pending.size) schedule();
      });
  }

  /* Chaque enregistrement coûte trois écritures dans la base (les données,
     leur numéro de révision, le journal), et le plan gratuit en compte 1 000
     par jour. Une seconde et demie d'attente regroupe une rafale d'actions —
     remplir un formulaire, cocher plusieurs cases — en un seul envoi, sans
     que personne ne s'en aperçoive : l'indicateur en bas à droite montre
     l'état réel. */
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, 1500);
  }

  /* ------------------------------------------------------------------------
     5. INDICATEUR D'ÉTAT — l'utilisateur doit voir que c'est enregistré
     ------------------------------------------------------------------------ */
  let statusEl = null;

  function ensureStatus() {
    if (statusEl) return statusEl;
    const style = document.createElement('style');
    style.textContent = `
      .mv-save{position:fixed;right:18px;bottom:18px;z-index:9998;
        padding:9px 16px;border-radius:999px;font-size:12.5px;font-family:'Inter',sans-serif;
        border:1px solid var(--band,#3D372C);background:#26231E;color:var(--muted,#9C9384);
        box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:0;transform:translateY(6px);
        transition:opacity .2s,transform .2s;pointer-events:none;}
      .mv-save.show{opacity:1;transform:translateY(0);}
      .mv-save.ok{color:var(--vine,#6E8B5D);border-color:rgba(110,139,93,.5);}
      .mv-save.ko{color:#E08A7A;border-color:rgba(224,138,122,.5);pointer-events:auto;}`;
    document.head.appendChild(style);

    statusEl = document.createElement('div');
    statusEl.className = 'mv-save';
    document.body.appendChild(statusEl);
    return statusEl;
  }

  let hideTimer = null;
  function setStatus(state, detail) {
    const el = ensureStatus();
    clearTimeout(hideTimer);
    el.classList.remove('ok', 'ko');

    if (state === 'saving') {
      el.textContent = 'Enregistrement…';
      el.classList.add('show');
    } else if (state === 'saved') {
      el.textContent = 'Enregistré ✓';
      el.classList.add('show', 'ok');
      hideTimer = setTimeout(() => el.classList.remove('show'), 1600);
    } else {
      el.textContent = 'Échec de l\'enregistrement — ' + (detail || 'réessai en cours');
      el.classList.add('show', 'ko');
    }
  }

  /* ------------------------------------------------------------------------
     6. SYNCHRONISATION ENTRE MEMBRES
     ------------------------------------------------------------------------
     Le panel est un outil d'équipe : ce que le DRH saisit doit apparaître
     chez le patron sans qu'il ait à recharger.

     Le serveur ne sait pas nous appeler, alors c'est nous qui demandons —
     mais seulement le NUMÉRO DE RÉVISION, quelques octets. Le contenu
     complet n'est retéléchargé que lorsque ce numéro a bougé.

     Deux garde-fous : on ne récupère rien tant qu'une sauvegarde locale
     est en attente (elle serait écrasée), et on ignore la révision que
     l'on vient soi-même de produire.
     ------------------------------------------------------------------------ */
  const SYNC_MS = 25000;
  let myRev = 0;
  let syncTimer = null;
  let onRemote = null;      /* prévenu quand des données arrivent d'ailleurs */

  async function fetchMeta() {
    const c = cfg();
    if (c.MODE !== 'discord') return null;
    let tok = null;
    try { tok = JSON.parse(localStorage.getItem('mv.token') || 'null'); } catch (e) {}
    if (!tok) return null;
    const res = await fetch(c.API_BASE + '/api/data?meta=1', {
      headers: { 'Authorization': 'Bearer ' + tok },
    });
    if (!res.ok) return null;
    return res.json();
  }

  async function syncTick() {
    if (pending.size || inFlight) return;        /* on a du travail non enregistré */
    if (document.hidden) return;                 /* onglet en arrière-plan */

    let meta;
    try { meta = await fetchMeta(); } catch (e) { return; }
    if (!meta || !meta.rev || meta.rev === myRev) return;

    /* Quelqu'un d'autre a écrit : on recharge et on redessine. */
    const before = myRev;
    myRev = meta.rev;
    const ok = await api.load();
    if (ok && before) {
      const qui = meta.by && meta.by !== (window.MarloweSession || {}).name ? meta.by : null;
      if (onRemote) onRemote(qui, meta.keys || []);
    }
  }

  function startSync() {
    if (syncTimer || cfg().MODE !== 'discord') return;
    syncTimer = setInterval(syncTick, SYNC_MS);
    /* Au retour sur l'onglet, on vérifie tout de suite plutôt que d'attendre. */
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncTick(); });
    window.addEventListener('focus', syncTick);
  }

  /* ------------------------------------------------------------------------
     7. API PUBLIQUE
     ------------------------------------------------------------------------ */
  const api = {
    /* Charge tout depuis le serveur et redessine. Appelé au démarrage. */
    async load() {
      let stored = {};
      try { stored = await fetchAll(); }
      catch (e) {
        console.warn('[Marlowe] données non chargées : ' + e.message);
        loaded = true;
        return false;
      }

      if (stored && stored._meta && stored._meta.rev) myRev = stored._meta.rev;

      let n = 0;
      Object.keys(COLLECTIONS).forEach(key => {
        if (!(key in stored)) return;      // jamais enregistré : on garde le contenu d'origine
        const target = ref(key);
        if (target && fillInPlace(target, stored[key])) n++;
      });

      loaded = true;
      if (n) redrawAll();
      return true;
    },

    /* Enregistre une collection. Le redessin est fait par défaut. */
    save(key, doRedraw) {
      if (!COLLECTIONS[key]) {
        console.warn('[Marlowe] collection inconnue : ' + key);
        return;
      }
      if (doRedraw !== false) redraw(key);
      pending.add(key);
      schedule();
    },

    /* Enregistre plusieurs collections d'un coup. */
    saveMany(keys, doRedraw) {
      keys.forEach(k => api.save(k, doRedraw));
    },

    redraw,
    redrawAll,
    ref,
    /* Décrit l'action en cours ; le texte accompagne la prochaine écriture
       et alimente le journal. À appeler AVANT save(). */
    note(texte) { noteEnAttente = String(texte || '').slice(0, 300); },

    async journal() {
      const c = cfg();
      if (c.MODE !== 'discord') return [];
      let tok = null;
      try { tok = JSON.parse(localStorage.getItem('mv.token') || 'null'); } catch (e) {}
      if (!tok) return [];
      const res = await fetch(c.API_BASE + '/api/journal', {
        headers: { 'Authorization': 'Bearer ' + tok },
      });
      if (!res.ok) return [];
      return res.json();
    },

    startSync,
    syncNow: syncTick,
    onRemoteChange(fn) { onRemote = fn; },
    rev: () => myRev,
    isLoaded: () => loaded,
    collections: () => Object.keys(COLLECTIONS),

    /* Repart des données d'origine du fichier (efface ce qui est enregistré). */
    async reset() {
      const c = cfg();
      if (c.MODE !== 'discord') { localWrite({}); }
      else { await pushKeys(Object.fromEntries(Object.keys(COLLECTIONS).map(k => [k, null]))); }
      location.reload();
    },
  };

  /* ------------------------------------------------------------------------
     7. DÉMARRAGE
     On attend que le panel ait fini de se dessiner avec ses valeurs d'origine,
     puis on remplace le contenu par les données enregistrées.

     C'est marlowe-auth.js qui déclenche le chargement, une fois la session
     établie — inutile d'appeler le serveur pour un visiteur non connecté,
     il refuserait. Le démarrage automatique ci-dessous n'est là que si le
     panel est ouvert sans module de connexion.
     ------------------------------------------------------------------------ */
  if (!window.MarloweAuth) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(api.load, 0));
    } else {
      setTimeout(api.load, 0);
    }
  }

  return api;
})();
