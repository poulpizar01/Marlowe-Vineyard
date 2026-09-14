/* ============================================================================
   MARLOWE VINEYARD — adresse de l'API, en un seul endroit
   ----------------------------------------------------------------------------
   index.html (vitrine + organigramme) et marlowe-auth.js (panneau de gestion,
   dont dépendent marlowe-data.js / marlowe-actions.js) lisaient chacun leur
   propre copie de cette adresse : la changer dans un fichier sans penser à
   l'autre laissait le second pointer vers un serveur qui n'existe plus.

   Une chaîne VIDE veut dire « la même origine que la page » : c'est le bon
   réglage depuis que backend/src/server.js sert le site ET l'API sur le même
   conteneur, le même domaine (voir docs/A-TRANSMETTRE-AU-RESPONSABLE.md,
   « montage B »). CORS disparaît entièrement, et l'adresse reste correcte
   quelle que soit l'adresse du jour — celle du domaine, ou
   marlowe-vineyard.fbfa.fr le jour où l'opérateur FlashbackFA y pointera le
   DNS — rien à changer ici pour cette bascule-là.

   Ce fichier est la seule source. S'il fallait un jour séparer à nouveau le
   site et l'API sur deux domaines, c'est la seule ligne à modifier — et il
   faut la charger AVANT tout script qui s'en sert (voir index.html et
   gestion.html).
   ============================================================================ */
window.MARLOWE_API_BASE = '';
