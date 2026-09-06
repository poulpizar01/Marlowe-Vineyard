/* ===========================================================================
   marlowe-folkos.js — l'intégration à l'ordinateur en jeu
   ---------------------------------------------------------------------------
   Deux scripts fournis par l'opérateur du serveur rendent le panel utilisable
   dans l'ordinateur in-game :

     · fbfa-game.js    libère le clavier. En jeu, FiveM capte les touches
                       (ZQSD…) : sans lui, AUCUN champ de saisie ne reçoit quoi
                       que ce soit. C'est lui qui rend le panel utilisable.
     · fbfa-bridge.js  signale la sous-page courante au shell, pour que la
                       barre d'adresse suive et que la page soit restaurée
                       après un rechargement.

   ---------------------------------------------------------------------------
   POURQUOI CE FICHIER PLUTÔT QUE DEUX BALISES DANS LE HTML
   ---------------------------------------------------------------------------
   Un <script src> chargé depuis un autre domaine s'exécute avec TOUS les
   droits de la page : il peut lire le jeton de session dans le stockage local,
   donc atteindre les fiches du personnel — identités civiles, téléphones,
   RIB. Ce n'est pas un soupçon sur l'opérateur, c'est ce qu'est un script
   tiers. Deux balises posées en dur dans le HTML feraient courir ce risque à
   TOUS les visiteurs, y compris sur le web public, où ces scripts ne servent
   à rien : leur propre documentation dit qu'ils « ne font rien hors d'une
   iframe ».

   On ne les charge donc QUE lorsque le panel est réellement encadré. Hors du
   jeu, ils ne sont jamais téléchargés — la surface d'exposition n'existe pas
   au lieu d'être seulement inutilisée.

   ⚠️ L'hôte ci-dessous vient de leur documentation. S'il change, c'est ICI et
   nulle part ailleurs.
   =========================================================================== */
(function () {
  'use strict';

  var HOTE = 'https://computer.game.fbfa.fr';

  /* Sommes-nous dans un cadre ? En jeu, la chaîne est
     nui://game → cfx-nui-external-iframe → l'hôte FolkOS → nous.
     L'accès à window.top lève une exception en contexte tiers : cette
     exception est elle-même la réponse, d'où le try. */
  var encadre;
  try { encadre = window.self !== window.top; }
  catch (e) { encadre = true; }
  if (!encadre) return;

  function charger(nom, apres) {
    var s = document.createElement('script');
    s.src = HOTE + '/' + nom;
    /* Un échec ne doit rien casser : hors du jeu, ou si l'hôte change, le
       panel doit continuer de fonctionner exactement comme avant. */
    s.onerror = function () {
      console.warn('[Marlowe] ' + nom + " n'a pas pu être chargé — "
        + 'le panel fonctionne, mais le clavier ou la barre d\'adresse '
        + 'peuvent ne pas suivre en jeu.');
    };
    if (apres) s.onload = apres;
    document.head.appendChild(s);
  }

  charger('fbfa-game.js', function () {
    if (!window.FBFAGame || typeof window.FBFAGame.init !== 'function') return;
    try {
      window.mvFolkOS = window.FBFAGame.init({
        /* 'field' : le clavier est rendu au site quand un champ a le focus, et
           au jeu le reste du temps. C'est le mode recommandé, et le seul qui
           convienne à un panel où l'on saisit par intermittence. 'always'
           priverait le joueur de ses déplacements tant que le panel est
           ouvert. */
        typing: { mode: 'field' },

        /* Échap ferme la fenêtre in-game. On garde le comportement par défaut :
           leur documentation précise qu'il est « intelligent » — si notre code
           a déjà consommé l'Échap (fermer la visionneuse du kit d'entretien,
           par exemple), la fenêtre ne se ferme pas.

           ⚠️ À REVOIR AVEC L'OPÉRATEUR : si le panel est ouvert comme une PAGE
           du navigateur FolkOS et non comme une fenêtre, il faut passer
           escape: false, sinon Échap ferme tout au lieu de revenir en arrière. */
      });
    } catch (e) {
      console.warn('[Marlowe] FBFAGame.init a échoué :', e);
    }
  });

  charger('fbfa-bridge.js');

  /* =========================================================================
     LES LIENS QUI S'OUVRENT « DANS UN NOUVEL ONGLET »
     -------------------------------------------------------------------------
     Dans l'ordinateur en jeu, il n'y a pas d'onglets. window.open() ne fait
     rien, target="_blank" ne fait rien, et le téléchargement d'un fichier ne
     fait rien non plus. Le pire, dans les trois cas, c'est le SILENCE : le
     joueur clique, il ne se passe rien, et il croit que le panel est cassé.

     Quatorze liens du site sont dans ce cas — les invitations Discord, le site
     du réseau, les justificatifs de factures, le PDF du kit d'entretien, le
     catalogue « en grand ».

     On ne les réécrit pas un par un : on intercepte le clic, ici, et
     uniquement quand le panel est encadré. Sur le web, ce fichier est sorti
     depuis longtemps (voir le retour anticipé plus haut) et les liens
     fonctionnent exactement comme avant.

     Deux cas :
       · une image  → on la montre, ici, dans la page. C'est même mieux qu'un
                      onglet : le joueur ne perd pas sa place ;
       · autre chose → on montre l'adresse, en clair et copiable, pour qu'il
                      puisse l'ouvrir sur son vrai navigateur.
     ========================================================================= */

  var EST_IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i;

  var boite = null;

  function fermer() {
    if (!boite) return;
    if (boite.parentNode) boite.parentNode.removeChild(boite);
    boite = null;
  }

  function css(el, regles) {
    for (var k in regles) if (Object.prototype.hasOwnProperty.call(regles, k)) {
      el.style[k] = regles[k];
    }
    return el;
  }

  function bouton(texte, principal) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = texte;
    css(b, {
      font: '600 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif',
      padding: '10px 18px', borderRadius: '999px', cursor: 'pointer',
      border: principal ? '1px solid #D9B872' : '1px solid rgba(255,255,255,.22)',
      background: principal ? '#D9B872' : 'transparent',
      color: principal ? '#0B140F' : '#F3EFE4',
    });
    return b;
  }

  function ouvrirBoite(titre, message, url, image) {
    fermer();

    boite = css(document.createElement('div'), {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px', background: 'rgba(6,9,14,.82)',
    });
    boite.addEventListener('click', function (e) { if (e.target === boite) fermer(); });

    var carte = css(document.createElement('div'), {
      maxWidth: '620px', width: '100%', maxHeight: '86vh', overflow: 'auto',
      background: '#0F141C', border: '1px solid rgba(217,184,114,.35)',
      borderRadius: '14px', padding: '26px 26px 22px',
      boxShadow: '0 24px 70px rgba(0,0,0,.6)',
      font: '14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif',
      color: '#F3EFE4',
    });

    var h = css(document.createElement('div'), {
      font: '500 19px/1.25 Georgia, "Times New Roman", serif',
      marginBottom: '10px', color: '#F3EFE4',
    });
    h.textContent = titre;
    carte.appendChild(h);

    var p = css(document.createElement('p'), {
      margin: '0 0 16px', color: '#A3ADBB', fontSize: '13.5px',
    });
    p.textContent = message;
    carte.appendChild(p);

    if (image) {
      var img = css(document.createElement('img'), {
        display: 'block', maxWidth: '100%', maxHeight: '54vh',
        margin: '0 auto 16px', borderRadius: '10px',
        border: '1px solid rgba(255,255,255,.10)',
      });
      img.alt = '';
      img.src = url;
      img.onerror = function () {
        img.style.display = 'none';
        p.textContent = "L'image n'a pas pu être chargée. Voici son adresse :";
      };
      carte.appendChild(img);
    }

    var champ = css(document.createElement('input'), {
      width: '100%', padding: '10px 12px', borderRadius: '8px',
      border: '1px solid rgba(255,255,255,.16)', background: '#080B0F',
      color: '#F3EFE4', font: '12.5px/1.4 ui-monospace, Consolas, monospace',
      marginBottom: '16px',
    });
    champ.type = 'text';
    champ.readOnly = true;
    champ.value = url;
    champ.addEventListener('focus', function () { champ.select(); });
    carte.appendChild(champ);

    var pied = css(document.createElement('div'), {
      display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap',
    });
    var copier = bouton("Copier l'adresse", true);
    copier.addEventListener('click', function () {
      var fait = false;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url);
          fait = true;
        }
      } catch (e) { fait = false; }
      if (!fait) {
        /* Le presse-papiers moderne exige un contexte sûr et une permission ;
           dans un cadre en jeu, il n'est pas garanti. On retombe sur la
           sélection, qui marche partout, et on le DIT au lieu de laisser
           croire que c'est copié. */
        champ.focus(); champ.select();
        try { fait = document.execCommand('copy'); } catch (e2) { fait = false; }
      }
      copier.textContent = fait ? 'Copié ✓' : 'Sélectionné — Ctrl+C';
    });
    var fermerB = bouton('Fermer', false);
    fermerB.addEventListener('click', fermer);
    pied.appendChild(copier);
    pied.appendChild(fermerB);
    carte.appendChild(pied);

    boite.appendChild(carte);
    document.body.appendChild(boite);
    champ.focus();
  }

  /* Échap ferme NOTRE fenêtre, et s'arrête là : sans ce stopPropagation, le
     même Échap serait vu par fbfa-game.js, qui fermerait l'ordinateur en jeu
     par-dessus le marché. */
  document.addEventListener('keydown', function (e) {
    if (!boite || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    fermer();
  }, true);

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;

    var telecharge = a.hasAttribute('download');
    if (a.target !== '_blank' && !telecharge) return;

    var url = a.href;
    /* Un lien sans adresse, ou une ancre interne : rien à intercepter. */
    if (!url || url.charAt(0) === '#') return;

    e.preventDefault();
    e.stopPropagation();

    if (telecharge) {
      return ouvrirBoite(
        'Téléchargement impossible en jeu',
        "L'ordinateur du jeu n'enregistre pas de fichier. Copiez l'adresse et "
        + 'ouvrez-la depuis votre navigateur habituel pour récupérer le document.',
        url, false);
    }
    if (EST_IMAGE.test(url) || url.indexOf('data:image/') === 0) {
      return ouvrirBoite('Aperçu',
        'Le voici sans quitter le panel — en jeu, il n’y a pas de nouvel onglet.',
        url, true);
    }
    ouvrirBoite('Ce lien s’ouvre hors du jeu',
      "L'ordinateur du jeu n'a pas d'onglets. Copiez l'adresse et ouvrez-la "
      + 'depuis votre navigateur, ou sur votre téléphone.',
      url, false);
  }, true);
})();
