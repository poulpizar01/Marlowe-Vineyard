# Marlowe Vineyard — ce qu'il faut prévoir sur le VPS

Document court, à l'intention de la personne qui administre la machine.
Le détail complet est dans le `README.md` à la racine du pack.

---

## En une phrase

Un panel web interne (RH, quotas, comptabilité d'un domaine viticole RP) qui
tourne aujourd'hui sur Cloudflare Workers + D1, et qui **vient s'installer sur
votre VPS** : une API Node.js et une base MariaDB. Le pack contient le schéma,
l'API, les scripts d'export/import/vérification et la procédure.

**Nous sommes invités chez vous, pas administrateurs de la machine.** Ce
document est écrit dans ce sens : il dit ce dont l'application a besoin, pas
comment vous devez tenir votre serveur. Tout ce qui suit tient dans un
utilisateur système sans shell, un port en écoute locale, une base, et une
entrée dans votre nginx.

Ce qu'il nous faut, en une liste :

- un dossier applicatif et un utilisateur système dédié (`marlowe`) ;
- **Node.js 20+** et une base **MariaDB** avec un compte restreint ;
- un port local libre (8787 par défaut, ajustable) ;
- une entrée nginx qui serve le site et renvoie `/api/…` vers ce port ;
- une sortie HTTPS vers `discord.com` ;
- et, pour le SSO, la possibilité de joindre `id` sur `127.0.0.1`.

Nous n'avons besoin d'aucun accès root, d'aucun autre port ouvert, et d'aucune
modification de vos services existants.

---

## Ce qu'il faut provisionner

| | Besoin | Commentaire |
|---|---|---|
| **Machine** | 1 vCPU, 2 Go RAM, 20 Go SSD | Largement suffisant. Quelques dizaines d'utilisateurs, une base de quelques dizaines de Mo au bout d'un an. Inutile de surdimensionner. |
| **OS** | Debian 12 ou Ubuntu 22.04/24.04 | Le pack est écrit pour l'un ou l'autre. |
| **Base** | **MariaDB 10.6+** (10.11 LTS conseillé) | Le schéma a été appliqué et vérifié sur 10.11. Voir la note PostgreSQL plus bas. |
| **Runtime** | **Node.js 20+** | Une seule dépendance : `mysql2`. |
| **Front** | nginx (ou Apache) + certbot | L'API écoute sur `127.0.0.1:8787` et n'est **jamais** exposée directement. |
| **DNS** | un enregistrement pour le panel, un pour l'API | Ou un seul si le site est servi par la même machine — voir « Deux montages » ci-dessous. |
| **Sortie réseau** | HTTPS vers `discord.com` | L'API lit les rôles, poste dans des salons et gère la connexion OAuth. Sans cette sortie, rien ne fonctionne. |

### Le compte MariaDB

Volontairement minimal. Le schéma s'applique **une fois, à la main**, avec un
compte administrateur — pas par l'API.

```sql
CREATE DATABASE marlowe CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'marlowe_app'@'127.0.0.1' IDENTIFIED BY '<mot de passe long>';
GRANT SELECT, INSERT, UPDATE, DELETE ON marlowe.* TO 'marlowe_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Ni `DROP`, ni `ALTER`, ni `CREATE`, ni `GRANT`, ni `FILE` : une faille dans
l'API ne peut ni supprimer une table, ni s'octroyer des droits, ni lire un
fichier du serveur.

---

## Contrainte nouvelle : le SSO FolkOS impose la co-localisation

Le validateur de tickets `id` **écoute sur `127.0.0.1`** et n'est pas exposé sur
Internet. Notre backend doit donc tourner **sur la machine où tourne `id`** —
c'est écrit deux fois dans leur documentation d'intégration, et c'est ce qui a
rendu impossible l'ancien montage sur Cloudflare Workers.

Concrètement : la question « où héberge-t-on l'API » n'est plus ouverte. Elle a
une seule réponse si l'on veut la connexion depuis le jeu.

S'ajoute une exigence d'affichage : le panel est encadré par l'ordinateur en
jeu, et il faut poser l'en-tête `Content-Security-Policy: frame-ancestors …`
avec la chaîne complète (`nui://game`, `cfx-nui-external-iframe`, `*.fbfa.fr`).
Un hébergement statique qui ne permet pas de poser d'en-tête — GitHub Pages,
par exemple — ne peut pas satisfaire cette exigence : l'iframe reste blanche,
sans erreur. `docs/nginx-tout-en-un.conf` s'en charge, et a été **vérifié sur
un vrai nginx** : l'en-tête est présent sur les pages, sur les polices, et
jusque sur les réponses 404.

⚠️ Deux pièges dans ce fichier, tous deux silencieux :
`add_header` **ne s'hérite pas** dans un bloc `location` qui pose son propre
en-tête — la directive est donc répétée à chaque endroit ; et **aucun
`X-Frame-Options`** ne doit être posé, il contredit `frame-ancestors` et fait
bloquer CEF même quand la CSP est correcte.

---

## Quatre décisions à prendre — elles conditionnent le reste

### 1. MariaDB ou PostgreSQL ?

Le pack est écrit pour **MariaDB**, et vérifié dessus. Si la machine peut
faire tourner MariaDB, c'est la voie sans travail supplémentaire.

Un portage PostgreSQL est possible mais ce n'est pas un réglage : séquences au
lieu d'`AUTO_INCREMENT`, `ON CONFLICT` au lieu d'`ON DUPLICATE KEY UPDATE`,
`RETURNING` au lieu de `LAST_INSERT_ID()`, types `ENUM` à revoir, changement
de pilote. C'est une journée de travail et une nouvelle campagne de tests.
**À ne demander que si PostgreSQL est imposé**, pas par préférence.

### 2. ~~Le site reste-t-il sur GitHub Pages ?~~ — tranché

Le site vient sur le VPS avec l'API, sous la **même origine** (montage B
ci-dessous). Deux raisons, et aucune n'est une préférence :

- l'affichage dans l'ordinateur en jeu exige l'en-tête `frame-ancestors`, que
  GitHub Pages ne peut pas poser ;
- le SSO exige que le backend joigne `id` en `127.0.0.1`.

Bénéfice au passage : le panel et l'API partageant l'origine, **CORS disparaît
entièrement**. Le panel est déjà prêt pour ce montage — son adresse d'API
accepte une valeur vide, qui signifie « la même origine », et c'est la seule
ligne à changer côté site.

### 3. Les adresses définitives

L'adresse du panel et celle de l'API doivent être connues **avant** la mise en
service : elles sont inscrites dans la configuration de l'API, dans le portail
développeur Discord, et dans un fichier du site. Les changer après demande de
repasser aux trois endroits.

### 4. Qui détient les secrets

Trois valeurs sensibles : le *client secret* Discord, le jeton du bot, le mot
de passe MariaDB. Elles vivent dans `api/.env`, en `chmod 600`, sur la machine
et nulle part ailleurs. **Le dépôt du panel est public** : rien de tout ça ne
doit s'en approcher.

---

## Deux montages possibles

### A. Le site reste sur GitHub Pages, l'API sur le VPS

```
navigateur ──► GitHub Pages (le panel, fichiers statiques)
     │
     └───────► https://api.domaine.fr ──► nginx ──► Node:8787 ──► MariaDB
```

C'est le montage décrit par défaut dans le README. Il demande une liste
blanche CORS côté API (`CORS_ORIGINS`), déjà en place.

### B. Tout sur le VPS — recommandé si le domaine change de toute façon

```
navigateur ──► https://marlowe.domaine.fr ──► nginx ─┬─► fichiers statiques
                                                      └─► /api/… ► Node:8787 ► MariaDB
```

Le panel et l'API partagent la même origine. Conséquence concrète : **CORS
disparaît complètement** — plus de liste blanche à tenir, plus de requête
préalable, plus de panne du type « ça marche en curl mais pas dans le
navigateur ». Un certificat au lieu de deux, un enregistrement DNS au lieu de
deux.

Le fichier `docs/nginx-tout-en-un.conf` couvre ce montage.

Dans ce cas, le dépôt GitHub reste le dépôt de travail ; c'est un `git pull`
sur la machine (ou un déploiement automatique) qui met le site à jour.

---

## Mise en service — l'ordre

1. Provisionner la machine, installer MariaDB, Node, nginx.
2. Créer la base et le compte restreint (ci-dessus).
3. Appliquer `schema-mariadb.sql` avec un compte administrateur.
4. Remplir `api/.env` à partir de `.env.example` (chaque variable est commentée).
5. `npm install` à la racine du pack, puis `node scripts/test-pack.mjs` — 60 essais, hors base.
6. Exporter les données depuis l'installation Cloudflare actuelle (`scripts/1-exporter.mjs`).
7. Importer à blanc (`scripts/2-importer.mjs --essai`), puis pour de bon.
8. **Vérifier** (`scripts/4-verifier.mjs`) — attendre `0 en échec`.
9. Démarrer l'API en service systemd, la publier derrière nginx.
10. Basculer l'adresse dans le site (`site/basculer.mjs`), pousser.

**L'installation Cloudflare n'est jamais touchée.** Elle tourne pendant toute
l'opération, et le retour arrière est une ligne (voir README § 9).

### À prévoir dans la fenêtre de bascule

- Tout le monde devra **se reconnecter une fois** : le jeton de session est lié
  à l'origine du site, qui change.
- Ne pas basculer un **dimanche soir ni un lundi** : la clôture hebdomadaire du
  domaine a lieu le lundi, c'est l'opération qui touche le plus de données.
- Ce qui est saisi après la bascule vit dans MariaDB et n'est pas recopié vers
  Cloudflare si l'on revient en arrière.

---

## Deux pièges qui ne produisent aucune erreur

Ils méritent d'être lus avant, parce qu'aucun des deux ne se signale.

1. **Portail développeur Discord ▸ Bot ▸ « Message Content Intent ».** Cette
   case vaut aussi pour les lectures REST. Sans elle, Discord renvoie des
   messages aux contenus vides, **sans erreur** : le panel afficherait zéro
   vente en laissant croire que personne n'a produit.

2. **Aucun en-tête CORS dans nginx.** C'est l'API qui les pose, à partir de sa
   liste blanche. Si nginx en ajoute aussi, le navigateur voit deux en-têtes
   `Access-Control-Allow-Origin` et refuse la réponse — alors que la même
   requête en `curl` fonctionne parfaitement.

---

## Sauvegardes

`scripts/sauvegarde.sh` fait un `mariadb-dump --single-transaction`, compresse,
vérifie que l'archive se décompresse, refuse une archive anormalement petite et
applique une rétention. Deux passages conseillés en cron, dont un le lundi
avant la clôture.

`scripts/restaurer.sh` sauvegarde l'état courant avant d'écraser quoi que ce
soit, et demande de taper le nom de la base pour confirmer.

⚠️ `mariadb-dump` ne couvre **pas** le dossier `IMAGES_DIR` (visuels de la
vitrine, justificatifs de factures). À ajouter aux sauvegardes de fichiers.
