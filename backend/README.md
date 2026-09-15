# Backend Marlowe Vineyard — connexion Discord

Petit serveur qui gère la connexion Discord du panel et les accès par rôle.

**Depuis la version 2.0, il tourne en Node.js sur votre propre serveur (VPS,
machine perso, conteneur…), avec MariaDB ou MySQL comme base de données.**
Il ne dépend plus de Cloudflare Workers/D1/KV : les données du panel vivent
dans une seule base MariaDB ou MySQL, configurée via un fichier `.env`. Les
images et PDF déposés depuis le panel, eux, partent sur le service de
stockage de l'opérateur FlashbackFA (`STORAGE_BASE`/`STORAGE_TOKEN`) —
voir `.env.example`.

**Aucun secret n'est dans le dépôt.** Le code peut rester public sans risque :
les clés vivent dans `.env`, qui n'est jamais commité (voir `.gitignore`).

Comptez une vingtaine de minutes pour la première mise en route.

---

## 1. Créer l'application Discord

Sur https://discord.com/developers/applications

1. **New Application** → nom : `Marlowe Vineyard`.
2. Onglet **OAuth2** → notez le **Client ID**, puis **Reset Secret** et notez le **Client Secret**.
   Ce secret ne s'affiche qu'une fois.
3. Toujours dans **OAuth2** → **Redirects** → **Add Redirect** :
   ```
   https://<adresse du site>/api/callback      par exemple https://panel.mon-domaine.fr/api/callback
   ```
   *C'est **l'adresse du site lui-même**, suivie de `/api/callback` — celle qui
   est dans `SITE_URL`, quelle qu'elle soit : l'hébergeur ou vous la
   choisissez, rien dans le code ne la suppose. Depuis la version 2.0, le site et l'API vivent sur le
   même domaine : `src/server.js` sert les deux, il n'y a plus de sous-domaine
   `api.` séparé (cette page indiquait auparavant
   un sous-domaine `api.` séparé, hérité du montage
   Cloudflare — une adresse que rien ne sert plus aujourd'hui, et Discord
   refuse la connexion tant que la bonne n'est pas déclarée).*

   *La règle, si le domaine change : le serveur construit lui-même l'adresse de
   retour à partir du domaine par lequel le navigateur est arrivé. Ce qui doit
   figurer ici, c'est donc exactement l'adresse que les gens tapent, suivie de
   `/api/callback` — et il faut la corriger ici EN MÊME TEMPS que `SITE_URL`.
   C'est l'oubli le plus fréquent.*
4. Onglet **Bot** → **Add Bot** → **Reset Token** et notez le **token du bot**.
5. Toujours onglet **Bot** → activez **Message Content Intent**. Sans elle,
   la lecture des logs de vente reçoit des embeds vides, sans erreur visible.

### Inviter le bot sur le serveur

Le bot n'a besoin d'aucune permission particulière : il doit simplement être
présent sur le serveur pour pouvoir lire la liste des rôles et vérifier qui en
est membre (et, s'il a le droit d'écrire dans les salons concernés, poster les
rappels d'agenda).

Ouvrez cette adresse en remplaçant `VOTRE_CLIENT_ID` :

```
https://discord.com/oauth2/authorize?client_id=VOTRE_CLIENT_ID&scope=bot&permissions=0
```

### Récupérer les identifiants

Dans Discord : **Paramètres ▸ Avancés ▸ Mode développeur** (à activer).
Ensuite, clic droit ▸ **Copier l'identifiant** :

- sur le **nom du serveur** → `DISCORD_GUILD_ID`
- sur **votre pseudo** → votre identifiant, pour `OWNER_IDS`

---

## 2. Préparer le serveur

Il faut deux choses sur la machine qui hébergera le backend : **Node.js** et
**MariaDB ou MySQL**.

### Node.js

Version 18.17 ou plus récente (`node -v` pour vérifier). À défaut :
https://nodejs.org, ou via le gestionnaire de paquets de votre distribution.

### MariaDB ou MySQL

N'importe lequel des deux convient, y compris une instance déjà existante sur
le serveur (mutualisée avec d'autres projets). Sur Debian/Ubuntu, par exemple :

```bash
sudo apt install mariadb-server
sudo mysql_secure_installation
```

Créez ensuite la base et un utilisateur dédié :

```sql
CREATE DATABASE marlowe CHARACTER SET utf8mb4;
CREATE USER 'marlowe'@'localhost' IDENTIFIED BY 'un-mot-de-passe-solide';
GRANT ALL PRIVILEGES ON marlowe.* TO 'marlowe'@'localhost';
FLUSH PRIVILEGES;
```

**Les tables se créent toutes seules** au premier démarrage du serveur (voir
`schema.sql` et `src/db.js`) : il n'y a rien d'autre à jouer à la main.

C'est pour ça que le compte a besoin du droit `CREATE` (d'où `GRANT ALL`
ci-dessus) : le serveur rejoue `CREATE TABLE IF NOT EXISTS` à **chaque**
démarrage, et MariaDB vérifie le droit avant de regarder si la table existe.
Un compte limité à `SELECT, INSERT, UPDATE, DELETE` fait échouer le
démarrage, même sur une base déjà remplie.

> **Un PDF de catalogue pèse jusqu'à 12 Mo.** Si un dépôt échoue avec une
> erreur du type « packet too large », augmentez `max_allowed_packet` dans la
> configuration MariaDB/MySQL (32M met une marge confortable).

---

## 3. Installer et configurer le backend

Depuis ce dossier `backend/` :

```bash
npm install
cp .env.example .env
```

Ouvrez `.env` et remplissez au minimum :

| Variable | Valeur |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | les identifiants de la base créée à l'étape 2 |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` | récupérés à l'étape 1 |
| `DISCORD_GUILD_ID` | l'identifiant du serveur Discord |
| `SITE_URL` | l'adresse du site, sans slash final |
| `PATRON_ROLES` | les rôles ayant tous les droits, séparés par des virgules |
| `OWNER_IDS` | les identifiants Discord ayant un accès permanent |

Toutes les autres variables (rôles, salons, FolkOS…) sont commentées dans
`.env.example` — reprenez les valeurs déjà en place si vous migrez depuis la
version Cloudflare, elles n'ont pas changé.

### Le webhook du salon des runners

`DISCORD_WEBHOOK` est l'adresse qui permet au panel de poster les demandes de
retrait dans le salon Discord. Pour l'obtenir :

1. dans Discord, ouvrez le salon des runners ;
2. **Modifier le salon ▸ Intégrations ▸ Webhooks ▸ Nouveau webhook** ;
3. **Copier l'URL du webhook**.

Un webhook plutôt que le bot : il ne dépend d'aucune permission accordée au bot
du serveur. Cette adresse est une **autorisation d'écrire dans le salon** :
n'importe qui la possédant peut y publier, c'est pour ça qu'elle est un secret
et qu'elle n'est jamais envoyée au navigateur. Sans elle, le bouton continue
de fonctionner : la demande s'inscrit dans le fil du panel, et l'envoi Discord
signale simplement qu'il n'est pas configuré.

---

## 4. Lancer le serveur

**Le port est libre.** C'est `PORT` dans `.env` — celui que vous choisissez,
ou celui que l'hébergeur vous impose — et aucun autre fichier ne le suppose :
8787 n'est que la valeur par défaut des exemples ci-dessous. La seule chose
qui doit le connaître, c'est l'entrée de votre reverse proxy. La base a son
propre port, `DB_PORT`, et en Docker elle n'est pas publiée du tout.

> **Avec Docker ?** `backend/deploy/docker-compose.yml` fait tourner l'app et
> MariaDB dans deux conteneurs, chacun dans sa propre boîte, et publie l'API
> sur `127.0.0.1` de la machine, au port `PORT` de votre `.env` (lancez
> compose avec `--env-file backend/.env`, comme dans les commandes plus bas)
> — il ne reste qu'à mettre votre reverse proxy devant (point 1 ci-dessous,
> `deploy/Caddyfile.snippet` en donne un exemple). La suite de cette section
> décrit le montage sans Docker ; les deux fonctionnent sur n'importe quel
> hébergeur.

Pour tester en local :

```bash
npm start
```

La console affiche `Marlowe API en écoute sur http://127.0.0.1:8787` (ou le
port choisi dans `.env`) une fois la base vérifiée.

**Le serveur n'écoute que sur 127.0.0.1** : il n'est joignable que depuis la
machine elle-même, donc par le reverse proxy décrit ci-dessous, jamais
directement depuis Internet. `HOST=0.0.0.0` dans `.env` l'ouvre à toutes
les interfaces — à ne faire que si le proxy tourne sur une autre machine, et
alors c'est au pare-feu de fermer le port. (Dans Docker, le
`docker-compose.yml` règle `HOST` tout seul et publie le port `PORT` sur
`127.0.0.1` de la machine, jamais sur les autres interfaces.)

Pour un déploiement réel, il faut :

1. **Un reverse proxy en HTTPS** devant le serveur Node (nginx, Caddy…), qui
   transmette les en-têtes `X-Forwarded-Proto` et `X-Forwarded-Host` (ou
   `Host`). C'est indispensable : c'est à partir de ces en-têtes que le
   serveur reconstruit l'adresse de retour Discord (`redirect_uri`) — sans
   eux, ou en HTTP nu, la connexion Discord échoue ou redirige vers la
   mauvaise adresse. Exemple minimal avec Caddy :

   ```
   votre-domaine.fr {
     reverse_proxy localhost:8787      # 8787 → la valeur de PORT dans .env
   }
   ```

   (Caddy gère le HTTPS et pose les en-têtes `X-Forwarded-*` tout seul. Il
   faut au préalable qu'un enregistrement DNS de type A — ou CNAME — pour ce
   domaine pointe vers l'adresse IP du serveur.)

   ⚠️ **Un seul domaine, pas deux.** Cet exemple faisait servir
   un sous-domaine `api.` distinct, hérité du
   montage Cloudflare d'avant la version 2.0. Il n'existe plus : depuis que
   `src/server.js` sert le site ET l'API, c'est le MÊME domaine qui répond aux
   deux, celui de `SITE_URL`. Un sous-domaine `api.` séparé ferait échouer la
   connexion de deux façons à la fois : l'adresse de retour déclarée à Discord
   ne correspondrait plus (§1.3), et le cookie de session — posé sur l'hôte
   d'arrivée — resterait sur le mauvais domaine.

2. **Un superviseur** qui relance le processus s'il plante ou au redémarrage
   du serveur — [pm2](https://pm2.keymetrics.io/) est le plus simple.

   **Une instance suffit, plusieurs sont possibles.** Jusqu'à la 1.47.0, il
   fallait un seul processus, sans exception : ce qui empêchait deux
   enregistrements simultanés de s'écraser était une file d'attente **en
   mémoire**, propre à chaque processus, et deux instances perdaient des
   données en silence. Depuis la 1.48.0, l'arbitrage est tenu par la **base**
   (un verrou nommé `GET_LOCK`, voir `src/db.js`) : il vaut pour toutes les
   instances branchées sur la même base MariaDB/MySQL. Voir « Plusieurs
   instances » plus bas avant d'en lancer une deuxième.

   ```bash
   npm install -g pm2
   pm2 start src/server.js --name marlowe-api
   pm2 save
   pm2 startup   # affiche la commande à lancer une fois pour le démarrage automatique
   ```

   Ou un service systemd, si vous préférez :

   ```ini
   # /etc/systemd/system/marlowe-api.service
   [Unit]
   Description=Marlowe Vineyard API
   After=network.target mariadb.service

   [Service]
   Type=simple
   WorkingDirectory=/chemin/vers/backend
   ExecStart=/usr/bin/node src/server.js
   Restart=on-failure
   User=marlowe
   EnvironmentFile=/chemin/vers/backend/.env

   [Install]
   WantedBy=multi-user.target
   ```

   ```bash
   sudo systemctl enable --now marlowe-api
   ```

**Retournez ensuite sur le portail Discord** (étape 1.3) et vérifiez que
l'adresse collée dans les **Redirects** correspond bien à votre domaine réel
suivi de `/api/callback`.

### Plusieurs instances

Une seule instance suffit largement au domaine, et c'est le montage le plus
simple à tenir. Si vous en voulez plusieurs — `pm2 start -i 2`, un
`--scale`, deux machines derrière un répartiteur — voici ce qui tient et ce
qu'il faut savoir :

- **Toutes les instances doivent parler à la même base.** C'est elle qui
  arbitre : chaque section qui lit, modifie et réécrit un document (`data`,
  `journal`, `settings`, `invites`, `alias`, la matrice des accès) le fait
  sous un verrou nommé que MariaDB/MySQL n'accorde qu'à une connexion à la
  fois. Une instance tuée en pleine écriture rend son verrou d'elle-même.
- **La tâche périodique tourne sur une seule instance à la fois.** Chaque
  processus a son propre déclencheur toutes les deux minutes ; celui qui
  trouve la place prise passe son tour. Et la marque « déjà annoncé » d'un
  rappel d'agenda est posée en une seule instruction : un événement n'est
  jamais annoncé deux fois.
- **Ce qu'une instance garde en mémoire ne vaut que pour elle** : le cache
  des rôles Discord (quelques minutes), le cache de présence. Ce sont des
  caches, pas des données ; rien ne se perd, une instance peut simplement
  voir un rôle changé un peu plus tard qu'une autre.
- **Les sessions sont en base**, pas en mémoire : le répartiteur n'a pas
  besoin de coller une personne à une instance.
- **Une écriture qui attend son tour plus de 15 secondes est refusée**, en
  `503 { error: "occupe" }`, sans rien écrire. En temps normal une section
  dure quelques dizaines de millisecondes ; ce refus signale une instance
  bloquée, pas une charge normale.

`test-mariadb.mjs` éprouve tout ça contre une vraie base, avec deux copies
du serveur qui n'ont en commun que la base (voir « Lancer les bancs
d'essai »).

---

## 5. Brancher le site

Rien à modifier dans `marlowe-auth.js` : `MODE` est déjà réglé sur
`'discord'`, et `API_BASE` vaut `''` (voir `marlowe-config.js` à la racine du
dépôt) — une chaîne vide veut dire « la même origine que la page », ce qui
est le cas ici puisque `src/server.js` sert le site ET l'API depuis le même
processus. Aucun CORS à régler, aucune adresse à recopier.

S'il fallait un jour séparer le site de l'API sur deux domaines, la seule
ligne à changer serait `window.MARLOWE_API_BASE` dans `marlowe-config.js`.

C'est fini — `gestion.html` demande une vraie connexion Discord.

### Changer l'adresse du site

Le serveur ne suppose aucune adresse : il reconstruit l'adresse de retour
Discord et contrôle l'origine des écritures à partir de l'hôte **réel** par
lequel la requête est arrivée. Changer de domaine demande donc trois choses,
toutes hors du code :

1. `SITE_URL` (et `SITE_URLS` le temps d'une bascule) dans `.env` ;
2. le **Redirect** OAuth2 sur le portail développeur Discord (§1.3) ;
3. l'entrée du reverse proxy.

Rien dans les fichiers du dépôt : le serveur communique `SITE_URL` au panel
en servant les pages (liste des adresses acceptées de la page de
diagnostic, balises `og:url` / `og:image` des aperçus de liens). Le port
est libre de la même façon : `PORT` dans `.env`, et l'entrée du proxy qui
pointe dessus.

Deux autres adresses se règlent au même endroit, avec une valeur par défaut
qui convient à l'opérateur FlashbackFA : `FRAME_ANCESTORS` (qui a le droit
d'afficher le site dans un cadre, l'ordinateur en jeu) et
`FOLKOS_SCRIPTS_BASE` (l'hôte des scripts clavier et barre d'adresse de ce
cadre). Voir `.env.example`.

Aucun domaine ni port n'est écrit dans les fichiers du dépôt : les pages
portent un repère (`https://adresse-du-site`) que le serveur remplace par
`SITE_URL` en les servant, et le panel prend pour repli l'adresse par laquelle
il a été ouvert.

---

## Mettre à jour une installation qui tourne déjà

⚠️ **`git pull` ne met RIEN à jour à lui seul.** C'est le piège de ce montage,
et il ne se voit pas : le site continue de répondre, avec l'ancien code.

Pourquoi : `backend/Dockerfile` fait `COPY . /app`. **Tout** part dans l'image
— le backend comme les fichiers du site (`gestion.html`, `marlowe-*.js`,
`index.html`…), puisque c'est le même processus Node qui les sert. Le
conteneur qui tourne porte donc une *copie* du code, figée au moment de la
construction. Les fichiers que `git pull` change sur le disque de la machine
ne sont pas ceux que le conteneur lit.

**Et `docker compose restart` ne suffit pas non plus** : il redémarre le
conteneur existant, avec son image existante et sa photo d'environnement
existante. Il ne relit ni le code, ni le `.env`. (Vécu : un jeton Discord
ajouté au `.env` puis un `restart` — l'API a continué pendant un moment à se
plaindre d'une configuration manquante qui était pourtant bien sur le disque.)

### La séquence, depuis le dossier du dépôt sur le serveur

```bash
git pull origin main

# RECONSTRUIT l'image avec le nouveau code, puis remplace le conteneur.
# C'est « up -d --build », jamais « restart ».
sudo docker compose --env-file backend/.env -f backend/deploy/docker-compose.yml up -d --build marlowe-app

sudo docker compose --env-file backend/.env -f backend/deploy/docker-compose.yml logs --tail=30 marlowe-app
```

**Le même `up -d` est nécessaire après toute modification du `.env`** — même
sans changement de code. Le `--build` est inutile dans ce cas, mais inoffensif.

### Vérifier que la mise à jour a bien pris

```bash
curl -s <adresse du site>/api/version
```

Le numéro doit être celui que vous venez de déployer. **Un correctif non
redéployé se comporte exactement comme un correctif qui ne marche pas** —
c'est la première chose à vérifier avant de chercher ailleurs.

**D'où vient ce numéro.** C'est le champ `version` de `backend/package.json`,
et rien d'autre : `/api/version` le lit à chaque démarrage. Pour livrer une
version du backend, on change ce champ. Le `version.json` à la racine du
dépôt numérote le **site** (le panel, servi au navigateur) — c'est un autre
compteur, avec son propre rythme, et les deux n'ont pas à être égaux. Le
mot « version 2.0 » employé plus haut désigne la génération Node.js du
backend (par opposition à l'ancienne version Cloudflare), pas un numéro.

---

## Vérifier que ça marche

Ouvrez `<adresse du site>/api/me` dans un navigateur (l'adresse est celle
de SITE_URL dans `.env`).
La réponse attendue est `{"error":"unauthorized"}` — c'est **normal et bon signe** :
le serveur répond, et il refuse une requête sans session.

Si vous obtenez `{"error":"config","missing":"..."}`, c'est qu'une variable
n'a pas été renseignée dans `.env` : le nom manquant est indiqué dans la
réponse (et un avertissement s'affiche déjà au démarrage, dans la console).

`<adresse du site>/api/version` répond sans authentification
et donne le numéro de version en cours ainsi que ce que le serveur sait
détecter comme configuré (salon de logs, rôle dispo, agenda…). Avant de
conclure qu'une correction n'a rien changé, on la relit — un correctif qui
n'a pas été redéployé se comporte exactement comme un correctif qui ne marche
pas.

---

## Les routes

| Route | Rôle |
|---|---|
| `GET /api/login` | redirige vers Discord |
| `GET /api/callback` | vérifie l'appartenance au serveur et ouvre la session |
| `GET /api/me` | qui est connecté, avec ses rôles à jour |
| `GET /api/roles` | tous les rôles du serveur (pour la page Paramètres) |
| `GET /api/permissions` | la matrice des accès |
| `PUT /api/permissions` | l'enregistre — refusé si l'appelant n'est pas patron |
| `POST /api/logout` | ferme la session (POST, et non GET : en GET, n'importe quel site tiers déconnectait la personne avec une simple balise `<img>`) |

(la liste complète, à jour, est toujours celle renvoyée par `/api/version`)

---

## Ce qu'il faut retenir

**Les rôles sont revérifiés à chaque appel**, pas seulement à la connexion.
Quelqu'un qui quitte le Discord ou perd un rôle perd l'accès dans la seconde,
sans avoir à se déconnecter.

**`OWNER_IDS` est un trousseau de secours.** Les identifiants qui y figurent
gardent tous les accès quoi qu'il arrive, et personne ne peut les retirer
depuis la page Paramètres. À garder court.

**Ce trousseau se règle ici, et nulle part ailleurs.** Il a longtemps existé
en double : dans ce `.env` *et* écrit en dur dans `marlowe-auth.js`, un
fichier que le site envoie à chaque visiteur — les identifiants s'y lisaient
donc en clair, et modifier le `.env` seul faisait diverger l'écran des droits
réellement accordés. Le panel ne reçoit plus la liste mais la réponse :
`/api/me` lui dit si **la personne connectée** fait partie du trousseau, et
rien sur les autres. N'en remettez pas de copie dans un fichier du site ;
`test-acces.mjs` échoue si quelqu'un le fait.

**Le filtrage des pages côté navigateur est du confort, pas une sécurité.**
`gestion.html` est un fichier public, téléchargeable par n'importe qui. Toute
donnée réelle transite par ce serveur, qui revalide les rôles à chaque
requête. Ne mettez jamais de données sensibles en dur dans le HTML.

**Sauvegardez la base régulièrement** (`mysqldump`/`mariadb-dump`) : tout ce
que le panel enregistre — fiches RH, réglages, sessions, présence — vit dans
cette base. Les images et PDF n'y sont plus : ils vivent sur le service de
stockage de l'opérateur (voir plus bas), qui a sa propre politique de
sauvegarde — hors de la portée de ce backend.

---

## Ce qui a changé depuis la version Cloudflare

- Le serveur tourne désormais en Node.js (`src/server.js`), sur votre propre
  machine, au lieu d'un Worker Cloudflare.
- La base D1 (SQLite) est remplacée par une base MariaDB/MySQL (`src/db.js`,
  `schema.sql`).
- Le namespace KV (`env.IMAGES`) qui portait les images et PDF n'existe plus
  du tout : ces fichiers partent directement sur le service de stockage de
  l'opérateur FlashbackFA (`STORAGE_BASE`/`STORAGE_TOKEN`, voir
  `handleUpload` dans `src/index.js`), pas dans la base.

  ⚠️ **Sur une installation qui avait déjà des visuels déposés via l'ancienne
  table `images`** (avant ce changement) : leurs adresses `/api/img/{id}`,
  encore enregistrées dans le document `data` (nouveautés de la vitrine,
  pages de catalogue, justificatifs de factures…), cesseront de répondre —
  cette route n'existe plus. Il n'y a pas de migration automatique. Avant de
  déployer cette version sur une base qui contient déjà des données, exportez
  la table `images` et redéposez chaque fichier via `/api/upload`, puis
  corrigez les adresses dans `data` en conséquence.
- La configuration vient d'un fichier `.env` (voir `.env.example`) plutôt que
  de `wrangler.toml` et des secrets Cloudflare.
- La tâche périodique (lecture des logs de vente + rappels d'agenda, toutes
  les deux minutes) tourne via `node-cron` dans `src/server.js`, à la place du
  déclencheur cron de Cloudflare.
- La logique métier elle-même (`src/index.js` : routes, OAuth Discord, calcul
  des quotas, permissions…) n'a **pas changé** : seule la façon dont elle
  parle à la base de données et reçoit les requêtes HTTP a été adaptée.

---

## Reprendre les données d'une installation qui tourne déjà

Ce backend démarre avec une base **vide** : il ne va chercher aucune donnée
ailleurs. Tout ce que le panel a enregistré — registre RH, clients,
facturation, réglages, matrice des accès, journal, ventes lues dans les logs —
vit dans les deux tables `kv` et `ventes` de la base MariaDB de
l'installation actuelle. Pour reprendre l'existant, il faut **un dump de
cette base**.

**Le dump est dans le dépôt : `backend/marlowe.sql`**, passé par
`backend/scripts/dump-nettoyer.mjs` (les sessions en cours et les clés
temporaires en sont retirées ; le registre, les clients, la facturation, les
réglages, la matrice, le journal et les ventes y sont). Pour le charger dans
une base fraîchement créée (§2) :

```bash
mariadb -u marlowe -p marlowe < backend/marlowe.sql
```

Pour refaire un dump plus récent depuis la machine actuelle (montage Docker
de `deploy/docker-compose.yml`, depuis le dossier du dépôt) :

```bash
MDP=$(grep '^DB_PASSWORD=' backend/.env | cut -d= -f2-)
sudo docker exec -e MYSQL_PWD="$MDP" marlowe-db-1 \
  mariadb-dump -u marlowe --single-transaction marlowe > marlowe-$(date +%F).sql
tail -1 marlowe-*.sql                  # doit contenir « Dump completed »
grep -c "CREATE TABLE" marlowe-*.sql   # 2 (kv et ventes)
```

(Sans Docker : `mariadb-dump -u marlowe -p --single-transaction marlowe`.)

Sur la nouvelle machine, une fois la base et le compte créés (§2), avant ou
après le premier démarrage du serveur — les deux marchent, `CREATE TABLE IF
NOT EXISTS` ne se plaint pas d'une table déjà là :

```bash
mariadb -u marlowe -p marlowe < marlowe-AAAA-MM-JJ.sql
```

À savoir :

- **Les images et PDF ne sont pas dans le dump.** Ils vivent sur le service
  de stockage de l'opérateur (`STORAGE_BASE`), et le document `data` ne
  contient que leurs adresses. Il faut donc reprendre le même
  `STORAGE_TOKEN` — ou, en changeant de stockage, redéposer chaque fichier
  et réécrire ses adresses dans `data`.
- **Tout le monde se reconnecte une fois** : les sessions (`sess:…` dans
  `kv`) sont liées au cookie posé sur l'ancien domaine.
- **Le fichier du dump contient tout le registre du personnel** (identités,
  téléphones, RIB). Il ne doit jamais approcher ce dépôt — `.gitignore`
  refuse `*.sql` sous plusieurs noms, mais un `git add -f` passe outre.

---

## Lancer les bancs d'essai

```bash
cd backend
npm test
```

Lance les 18 fichiers `test-*.mjs` du dépôt (six à la racine, qui rejouent
des fonctions du panel extraites de `marlowe-actions.js` ; douze ici, qui
appellent les routes du serveur avec un Discord et une base simulés), et
résume à la fin. Aucune installation n'est nécessaire : ni `node_modules`,
ni base, ni réseau.

Un seul fichier fait exception : `test-mariadb.mjs` éprouve le serveur
contre une **vraie** base. Sans variables `DB_*`, il le dit et sort sans
échouer. Pour le lancer, donnez-lui une base de test **dédiée** — il efface
les tables :

```bash
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=marlowe DB_PASSWORD=… DB_NAME=marlowe_test node test-mariadb.mjs
```

Pas de base sous la main ? Une MariaDB jetable en Docker suffit, sans rien
installer d'autre (il faut `npm install` dans `backend/` pour `mysql2`) :

```bash
docker run -d --name marlowe-essai -e MARIADB_ROOT_PASSWORD=jetable \
  -e MARIADB_DATABASE=marlowe_test -e MARIADB_USER=marlowe -e MARIADB_PASSWORD=jetable \
  -p 127.0.0.1:13306:3306 mariadb:10.11
# quelques secondes plus tard :
DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=marlowe DB_PASSWORD=jetable DB_NAME=marlowe_test node test-mariadb.mjs
docker rm -f marlowe-essai
```

C'est ce banc-là qui prouve que deux instances du backend ne perdent rien :
il fait tourner deux copies du serveur qui n'ont en commun que la base, et
les fait écrire en rafale sur le même document. Sans le verrou en base, il
échoue (vérifié en le désactivant) ; avec, il passe.

Chaque fichier explique en tête ce qu'il vérifie et pourquoi il existe.
Tous font foi : ils sont relancés à chaque livraison.
