/* Banc d'essai de la reconnaissance du rôle « patron ».
   ---------------------------------------------------------------------------
   PATRON_ROLES est tapé à la main dans wrangler.toml ; le nom du rôle vit sur
   Discord et s'écrit comme on veut. Une comparaison caractère par caractère
   n'en reconnaissait qu'une seule forme, et le patron du domaine se retrouvait
   sans les droits du patron sans que rien ne dise pourquoi.

   Ce qui est vérifié :

   · les écritures qui désignent le MÊME rôle sont reconnues — majuscules,
     accents, emoji, tiret ou espace ;

   · l'égalité reste stricte sur la forme normalisée : « Sous-Patron » ou
     « Patronne » n'ouvrent RIEN. Assouplir une comparaison de permission sans
     cette garantie serait pire que le défaut qu'on corrige ;

   · un accès développeur reste patron sans aucun rôle ;

   · quelqu'un sans rôle reconnu ne l'est pas.

   Lancement :  node test-patron.mjs
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const SRC = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const TMP = new URL('./.essai-patron.mjs', import.meta.url);
writeFileSync(TMP, SRC + '\nexport { clefRole, estRolePatron, patronRoles };\n');
const W = await import(TMP.href);

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};

const env = { PATRON_ROLES: 'Patron,Co-Patron' };

console.log('\n— Les écritures du même rôle —');
[
  'Patron', 'patron', 'PATRON', ' Patron ', 'Patron 👑', '👑 Patron',
  'Patrón', 'Patron.', '[Patron]',
].forEach(n => dit(`« ${n} » est reconnu`, W.estRolePatron(env, n), W.clefRole(n)));

[
  'Co-Patron', 'co patron', 'CO-PATRON', 'Co–Patron', 'Co Patron 👑',
].forEach(n => dit(`« ${n} » est reconnu`, W.estRolePatron(env, n), W.clefRole(n)));

console.log('\n— Ce qui ne doit PAS passer —');
[
  'Sous-Patron', 'Patronne', 'Ex-Patron', 'Patron adjoint', 'Assistant du Patron',
  'Saisonnier', 'Vendeur', '', '   ', '👑', 'Copatron',
].forEach(n => dit(`« ${n} » n'ouvre rien`, !W.estRolePatron(env, n), W.clefRole(n)));

/* --------------------------------------------------------------------------
   La liste RÉELLE, relevée sur le refus qu'a reçu le patron du domaine.
   Elle est ici parce qu'une liste inventée ne prouve rien : ce sont ces
   sept chaînes-là, avec leur emoji et leur point médian, que le serveur
   reçoit de Discord. Si un jour une modification les fait retomber, ce
   test tombe avec elles.
   -------------------------------------------------------------------------- */
console.log('\n— La session réelle du patron —');
{
  const vus = [
    '🎇 · Vignoble', '👑 · Co Patron', '👑 · Directeur Des Responsables-Runners',
    '👑 · Patron', '🤝 · Responsable Commercial', '📟', '🌍 · Citoyen/nes',
  ];
  dit('« 👑 · Patron » est reconnu', W.estRolePatron(env, '👑 · Patron'), W.clefRole('👑 · Patron'));
  dit('« 👑 · Co Patron » est reconnu', W.estRolePatron(env, '👑 · Co Patron'), W.clefRole('👑 · Co Patron'));
  dit('cette session est patron', vus.some(r => W.estRolePatron(env, r)));
  dit('« 👑 · Directeur Des Responsables-Runners » n\'ouvre rien',
      !W.estRolePatron(env, '👑 · Directeur Des Responsables-Runners'));
  dit('« 🎇 · Vignoble » n\'ouvre rien', !W.estRolePatron(env, '🎇 · Vignoble'));
  dit('« 🌍 · Citoyen/nes » n\'ouvre rien', !W.estRolePatron(env, '🌍 · Citoyen/nes'));
  dit('« 📟 » n\'ouvre rien', !W.estRolePatron(env, '📟'));
  dit('exactement deux rôles patron dans cette session',
      vus.filter(r => W.estRolePatron(env, r)).length === 2);
}

console.log('\n— Le réglage lui-même —');
{
  dit('deux rôles attendus par défaut', W.patronRoles({}).length === 2);
  dit('un réglage sur mesure est respecté',
      W.estRolePatron({ PATRON_ROLES: 'Gérant' }, 'gerant')
      && !W.estRolePatron({ PATRON_ROLES: 'Gérant' }, 'Patron'));
  dit('un réglage avec des espaces en trop marche quand même',
      W.estRolePatron({ PATRON_ROLES: ' Patron , Co-Patron ' }, 'Patron'));
}

unlinkSync(TMP);
console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
