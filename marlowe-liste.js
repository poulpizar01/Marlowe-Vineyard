/* ============================================================================
   Les listes déroulantes du panel
   ----------------------------------------------------------------------------
   Un <select> fermé est dessiné par la page ; un <select> OUVERT ne l'est pas.
   La liste qui se déplie est peinte par le système d'exploitation, aucune règle
   CSS ne l'atteint — d'où le menu gris de Windows au milieu d'un panneau sombre
   et doré. C'est le seul défaut à corriger, et il n'y en a qu'un.

   Donc on ne remplace pas le champ : on l'empêche d'ouvrir SA liste, et on
   déplie la nôtre à la place.

   · Le <select> reste le champ visible, avec ses classes et ses styles
     existants. Aucune largeur, aucune couleur n'est recopiée ici : les règles
     de gestion.html continuent de s'appliquer, y compris aux points de rupture.
     Il garde son libellé, son focus, son état désactivé, sa valeur.
   · Tout le code du panel lit « el.value » : rien à changer nulle part. On
     écrit dans le <select> et on émet « change », comme une liste native.
   · Le panneau est posé sur <body>, en position fixe : une liste rendue dans
     une cellule de tableau serait coupée par le débordement de la cellule.
   · Les options sont relues à CHAQUE ouverture : les filtres remplis en
     JavaScript et les lignes de facture nées après coup sont donc justes sans
     qu'on ait à les surveiller.

   Pour laisser une liste au style du système : <select data-natif>.
   ========================================================================== */
(function () {
  'use strict';

  /* Au-delà de ce nombre d'options, une liste ne se parcourt plus à l'œil :
     on ajoute un champ de recherche. En dessous, il encombrerait. */
  const SEUIL_RECHERCHE = 9;

  /* Le chevron doré, en remplacement de la flèche du système. */
  const CHEVRON = 'data:image/svg+xml;charset=utf-8,'
    + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="11" height="7" '
      + 'viewBox="0 0 11 7"><path d="M1 1l4.5 4.5L10 1" fill="none" stroke="#8E7C4E" '
      + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>');

  const style = document.createElement('style');
  style.textContent = `
    /* Deux attributs, pas un : la feuille de style des fenêtres de saisie
       est ajoutée APRÈS celle-ci et pose « background: » en raccourci, ce qui
       efface toute image de fond de même poids. Sans ce poids supplémentaire,
       le chevron disparaît et le champ ne se distingue plus d'une zone de
       texte — vu à l'écran, pas déduit. */
    select[data-mvl="ok"][aria-haspopup="listbox"]{
      -webkit-appearance:none;-moz-appearance:none;appearance:none;
      background-image:url("${CHEVRON}");background-repeat:no-repeat;
      background-position:right 11px center;padding-right:30px;cursor:pointer;}
    select[data-mvl="ok"]::-ms-expand{display:none;}
    select[data-mvl="ok"][aria-expanded="true"]{border-color:var(--or,#C9A961);}

    .mvl-pan{position:fixed;z-index:10050;background:#26231E;
      border:1px solid var(--or-soft,#8E7C4E);border-radius:12px;
      box-shadow:0 22px 60px rgba(0,0,0,.62);padding:6px;
      font-family:'Inter',sans-serif;color:var(--parchment,#EDE3CF);
      display:flex;flex-direction:column;overflow:hidden;}
    .mvl-rech{flex:0 0 auto;width:calc(100% - 4px);margin:2px 2px 6px;background:rgba(0,0,0,.3);
      border:1px solid var(--band,#3D372C);border-radius:8px;padding:8px 10px;
      color:var(--parchment,#EDE3CF);font-family:inherit;font-size:13px;outline:none;}
    .mvl-rech:focus{border-color:var(--or,#C9A961);}
    .mvl-liste{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;}
    .mvl-liste::-webkit-scrollbar{width:9px;}
    .mvl-liste::-webkit-scrollbar-thumb{background:var(--band,#3D372C);border-radius:9px;}
    .mvl-grp{padding:9px 12px 4px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;
      color:var(--or-soft,#8E7C4E);}
    .mvl-opt{padding:9px 12px;border-radius:8px;font-size:13.5px;line-height:1.35;cursor:pointer;
      border-left:2px solid transparent;}
    .mvl-opt.actif{background:rgba(201,169,97,.14);}
    .mvl-opt.choisi{color:var(--or,#C9A961);border-left-color:var(--or,#C9A961);}
    .mvl-opt.eteint{opacity:.45;cursor:not-allowed;}
    .mvl-rien{padding:12px;font-size:13px;color:var(--muted,#9C9384);}`;
  (document.head || document.documentElement).appendChild(style);

  /* ------------------------------------------------------------------------
     Un seul panneau pour toute la page : deux listes ne peuvent pas être
     ouvertes en même temps, et on ne laisse jamais traîner de DOM derrière.
     ------------------------------------------------------------------------ */
  let pan = null, rech = null, liste = null;
  let ouvert = null;      /* { sel, options[], choisi, visibles[], actif } */
  let veille = 0;

  function panneau() {
    if (pan) return pan;
    pan = document.createElement('div');
    pan.className = 'mvl-pan';
    pan.setAttribute('role', 'listbox');
    pan.style.display = 'none';
    pan.innerHTML = '<input class="mvl-rech" type="text" placeholder="Rechercher…" '
                  + 'autocomplete="off" spellcheck="false"><div class="mvl-liste"></div>';
    document.body.appendChild(pan);
    rech = pan.querySelector('.mvl-rech');
    liste = pan.querySelector('.mvl-liste');

    rech.addEventListener('input', () => dessiner(rech.value));
    liste.addEventListener('mousedown', e => e.preventDefault());  /* garde le focus */
    liste.addEventListener('click', e => {
      const o = e.target.closest('.mvl-opt');
      if (o && !o.classList.contains('eteint')) choisir(Number(o.dataset.i));
    });
    liste.addEventListener('mousemove', e => {
      const o = e.target.closest('.mvl-opt');
      if (o && !o.classList.contains('eteint')) marquer(Number(o.dataset.i), false);
    });
    return pan;
  }

  /* « Émilio » doit se trouver en tapant « emilio ». */
  const norme = s => String(s == null ? '' : s)
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const echap = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------------------ */
  function dessiner(filtre) {
    if (!ouvert) return;
    const f = norme(filtre).trim();
    const vus = [];
    let html = '', groupe = null;

    ouvert.options.forEach((o, i) => {
      if (f && !norme(o.texte).includes(f)) return;
      if (o.groupe && o.groupe !== groupe) {
        groupe = o.groupe;
        html += `<div class="mvl-grp">${echap(groupe)}</div>`;
      }
      const cl = 'mvl-opt' + (o.eteint ? ' eteint' : '') + (i === ouvert.choisi ? ' choisi' : '');
      html += `<div class="${cl}" role="option" id="mvl-o${i}" data-i="${i}" `
            + `aria-selected="${i === ouvert.choisi}">${echap(o.texte) || '&nbsp;'}</div>`;
      if (!o.eteint) vus.push(i);
    });

    liste.innerHTML = html || '<div class="mvl-rien">Aucun résultat.</div>';
    ouvert.visibles = vus;
    marquer(vus.includes(ouvert.choisi) ? ouvert.choisi : (vus.length ? vus[0] : -1), true);
  }

  function marquer(i, defiler) {
    if (!ouvert) return;
    ouvert.actif = i;
    liste.querySelectorAll('.mvl-opt.actif').forEach(n => n.classList.remove('actif'));
    if (i < 0) { pan.removeAttribute('aria-activedescendant'); return; }
    const n = liste.querySelector(`.mvl-opt[data-i="${i}"]`);
    if (!n) return;
    n.classList.add('actif');
    pan.setAttribute('aria-activedescendant', 'mvl-o' + i);
    if (defiler !== false) {
      const hb = liste.getBoundingClientRect(), nb = n.getBoundingClientRect();
      if (nb.top < hb.top) liste.scrollTop -= (hb.top - nb.top) + 4;
      else if (nb.bottom > hb.bottom) liste.scrollTop += (nb.bottom - hb.bottom) + 4;
    }
  }

  function bouger(pas) {
    if (!ouvert || !ouvert.visibles.length) return;
    const v = ouvert.visibles;
    let k = v.indexOf(ouvert.actif);
    k = k < 0 ? (pas > 0 ? 0 : v.length - 1) : Math.min(v.length - 1, Math.max(0, k + pas));
    marquer(v[k], true);
  }

  function choisir(i) {
    if (!ouvert) return;
    const sel = ouvert.sel;
    const o = ouvert.options[i];
    if (!o || o.eteint) return;
    /* On écrit dans le <select>, jamais ailleurs : le champ reste la source
       de vérité, et « change » part comme pour une liste native — tous les
       gestionnaires déjà en place se déclenchent sans qu'on les connaisse. */
    if (sel.selectedIndex !== o.index) {
      sel.selectedIndex = o.index;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    fermer();
    if (sel.isConnected) sel.focus();
  }

  /* ------------------------------------------------------------------------ */
  function placer() {
    if (!ouvert) return;
    const r = ouvert.sel.getBoundingClientRect();
    const marge = 10;
    const dessous = window.innerHeight - r.bottom - marge;
    const dessus = r.top - marge;
    const versLeHaut = dessous < 190 && dessus > dessous;
    const larg = Math.max(r.width, 210);

    pan.style.minWidth = larg + 'px';
    pan.style.maxWidth = Math.max(larg, Math.min(380, window.innerWidth - 20)) + 'px';
    pan.style.maxHeight = Math.min(versLeHaut ? dessus : dessous, 320) + 'px';
    pan.style.left = Math.max(8, Math.min(r.left, window.innerWidth - larg - 8)) + 'px';

    if (versLeHaut) {
      pan.style.top = 'auto';
      pan.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    } else {
      pan.style.bottom = 'auto';
      pan.style.top = (r.bottom + 6) + 'px';
    }
  }

  function ouvrir(sel) {
    if (ouvert && ouvert.sel === sel) return;
    fermer();
    panneau();

    const options = [];
    Array.prototype.forEach.call(sel.options, (o, i) => options.push({
      index: i,
      texte: o.label || o.textContent || '',
      eteint: o.disabled,
      groupe: o.parentElement && o.parentElement.tagName === 'OPTGROUP'
        ? o.parentElement.label : null,
    }));

    ouvert = { sel, options, choisi: sel.selectedIndex, visibles: [], actif: -1 };

    const grande = options.length >= SEUIL_RECHERCHE;
    rech.style.display = grande ? '' : 'none';
    rech.value = '';
    pan.style.display = 'flex';
    sel.setAttribute('aria-expanded', 'true');
    dessiner('');
    placer();
    if (grande) rech.focus();

    /* Le panneau vit sur <body> : si sa liste disparaît sous lui — fenêtre
       refermée, ligne de facture supprimée — il resterait seul à l'écran. */
    veille = requestAnimationFrame(function boucle() {
      if (!ouvert) return;
      if (!ouvert.sel.isConnected || !ouvert.sel.getClientRects().length) { fermer(); return; }
      veille = requestAnimationFrame(boucle);
    });
  }

  function fermer() {
    if (!ouvert) return;
    cancelAnimationFrame(veille);
    ouvert.sel.setAttribute('aria-expanded', 'false');
    ouvert = null;
    if (pan) pan.style.display = 'none';
  }

  /* ------------------------------------------------------------------------
     Prendre la main sur un <select> — sans rien lui retirer.
     ------------------------------------------------------------------------ */
  function habiller(sel) {
    if (!sel || sel.dataset.mvl === 'ok') return;
    if (sel.multiple || sel.size > 1 || sel.hasAttribute('data-natif')) return;
    sel.dataset.mvl = 'ok';
    sel.setAttribute('aria-haspopup', 'listbox');
    sel.setAttribute('aria-expanded', 'false');

    /* Empêcher la liste du système de s'ouvrir : sous Chrome et Edge elle
       part au mousedown, et refuser ce mousedown suffit à la retenir. Le
       champ garde le focus, donc le clavier continue de fonctionner. */
    sel.addEventListener('mousedown', e => {
      if (sel.disabled) return;
      e.preventDefault();
      sel.focus();
      if (ouvert && ouvert.sel === sel) fermer(); else ouvrir(sel);
    });
    sel.addEventListener('keydown', e => {
      if (sel.disabled) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter'
          || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        ouvrir(sel);
      }
    });
  }

  /* ------------------------------------------------------------------------ */
  document.addEventListener('keydown', e => {
    if (!ouvert) return;
    if (e.key === 'Escape') { e.preventDefault(); const s = ouvert.sel; fermer(); s.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); bouger(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); bouger(-1); }
    else if (e.key === 'Home') { e.preventDefault(); bouger(-1e6); }
    else if (e.key === 'End') { e.preventDefault(); bouger(1e6); }
    else if (e.key === 'Enter') { e.preventDefault(); if (ouvert.actif >= 0) choisir(ouvert.actif); else fermer(); }
    else if (e.key === 'Tab') { if (ouvert.actif >= 0) choisir(ouvert.actif); else fermer(); }
  }, true);

  document.addEventListener('mousedown', e => {
    if (!ouvert) return;
    /* Le champ lui-même a son propre gestionnaire : il referme tout seul. */
    if (pan.contains(e.target) || ouvert.sel === e.target || ouvert.sel.contains(e.target)) return;
    fermer();
  }, true);

  window.addEventListener('resize', fermer);
  window.addEventListener('scroll', () => { if (ouvert) placer(); }, true);

  /* ------------------------------------------------------------------------ */
  const balayer = racine => {
    if (!racine || racine.nodeType !== 1) return;
    if (racine.tagName === 'SELECT') habiller(racine);
    if (racine.querySelectorAll) racine.querySelectorAll('select').forEach(habiller);
  };

  function demarrer() {
    balayer(document.body);
    /* Les fenêtres de saisie et les lignes de facture naissent après coup. */
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(balayer)))
      .observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();

  window.MarloweListe = { habiller, fermer };
})();
