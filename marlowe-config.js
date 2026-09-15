/* ============================================================================
   MARLOWE VINEYARD — adresse de l'API, en un seul endroit
   ----------------------------------------------------------------------------
   index.html (vitrine + organigramme) et marlowe-auth.js (panneau de gestion,
   dont dépendent marlowe-data.js / marlowe-actions.js) lisaient chacun leur
   propre copie de cette adresse : la changer dans un fichier sans penser à
   l'autre laissait le second pointer vers un serveur qui n'existe plus.

   Une chaîne VIDE veut dire « la même origine que la page » : c'est le bon
   réglage depuis que backend/src/server.js sert le site ET l'API sur le même
   conteneur, le même domaine. CORS disparaît entièrement, et l'adresse reste
   correcte
   quelle que soit l'adresse du jour — celle du domaine, ou
   marlowe-vineyard.fbfa.fr le jour où l'opérateur FlashbackFA y pointera le
   DNS — rien à changer ici pour cette bascule-là.

   Ce fichier est la seule source. S'il fallait un jour séparer à nouveau le
   site et l'API sur deux domaines, c'est la seule ligne à modifier — et il
   faut la charger AVANT tout script qui s'en sert (voir index.html,
   accueil.html et gestion.html).

   Quand c'est backend/src/server.js qui sert ce fichier, il y ajoute à la
   volée ce qu'il tient de .env — window.MARLOWE_SITES (SITE_URL + SITE_URLS)
   et window.MARLOWE_FOLKOS_HOST (FOLKOS_SCRIPTS_BASE). Les scripts qui s'en
   servent (marlowe-actions.js, marlowe-folkos.js) ont chacun un repli si ces
   lignes manquent, c'est-à-dire si le panel est ouvert sans ce serveur.
   ============================================================================ */
window.MARLOWE_API_BASE = '';
