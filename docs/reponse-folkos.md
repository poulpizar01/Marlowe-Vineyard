# Réponse à l'opérateur FolkOS

*(à copier tel quel — les points sont dans l'ordre où ils vous seront utiles)*

---

Bonjour,

Merci pour la documentation. **Nous sommes exactement dans le cas que vous
demandez de signaler avant d'écrire du code**, alors je vous le dis tout de
suite.

## Notre backend est aujourd'hui un Worker Cloudflare

Il ne peut donc pas joindre `id` sur `127.0.0.1`. L'endpoint est écrit et
testé, mais il ne peut pas fonctionner là où il tourne actuellement.

## Ce que nous proposons

**Héberger notre backend sur le même VPS que `id`.** C'était déjà notre
direction — la migration vers un serveur privé était engagée avant votre
documentation, et le pack est prêt : une API Node.js et une base MariaDB.
Nous n'avons pas besoin que vous exposiez `/sso/verify` publiquement, et
nous préférons que vous ne le fassiez pas pour nous.

Nos questions, donc :

1. **Pouvez-vous nous héberger sur le VPS où tourne `id` ?** Notre besoin est
   modeste : Node 20+, MariaDB, un port local derrière votre nginx.
2. Si oui, **quel domaine** servira le panel ? Aujourd'hui il répond sur
   `marlowe-vineyard.fbfa.fr` (fichiers statiques, GitHub Pages). Nous
   souhaitons à terme servir le site ET l'API depuis la même origine.
3. **Quels scopes** avez-vous accordés à notre client ? Nous avons besoin au
   minimum de `discord` — c'est `discord_id` qui fait le lien avec nos fiches
   employés et qui porte nos droits d'accès. Sans lui, nous ne pouvons
   reconnaître personne.
4. Le scope **`job`** nous intéresserait (`job_id`, `rank`) : il nous
   permettrait de vérifier que le joueur est bien employé du domaine côté jeu,
   en plus de notre registre. Pas bloquant.
5. Merci d'activer le **mode démo** quand nous serons hébergés.

## Deux points que votre documentation soulève et qui nous concernent

- **`frame-ancestors`** : notre site est servi par GitHub Pages, qui ne permet
  pas de poser d'en-tête HTTP. La directive ne peut donc pas être envoyée
  aujourd'hui, et une balise `<meta>` est ignorée pour cette directive. C'est
  une raison de plus de passer sur votre VPS, où nginx s'en charge.
- **Cookies `SameSite=None`** : sans objet chez nous. Notre session ne repose
  pas sur un cookie mais sur un jeton porté par le fragment de l'URL de retour,
  puis par l'en-tête `Authorization`. Le point 3 de votre guide ne nous
  concerne donc pas — c'est le repli « Bearer + stockage local » que vous
  mentionnez.

## Ce qui est déjà fait de notre côté

L'endpoint `/api/folkos` est écrit et couvert par 39 vérifications
automatiques : échange du ticket en POST avec le secret dans le corps, aucune
confiance au ticket brut, `unique_id` converti en texte (nous avons vu qu'il
change de type selon le point d'entrée), clé sur `discord_id` et jamais sur
`sub`, et **aucune création de compte** — un joueur inconnu de notre registre
est refusé avec la marche à suivre.

Il nous reste à honorer `?next=` avec validation stricte du chemin relatif, ce
que nous ferons une fois l'hébergement décidé.

**L'URL publique de l'endpoint vous sera donnée dès que nous serons hébergés
chez vous** — la donner maintenant ne servirait à rien puisqu'elle ne pourrait
pas joindre `id`.

Merci,
Thomas — Marlowe Vineyard
