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
})();
