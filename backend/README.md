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
   https://marlowe-vineyard.fbfa.fr/api/callback
   ```
   *C'est **l'adresse du site lui-même**, suivie de `/api/callback` — celle qui
   est dans `SITE_URL`. Depuis la version 2.0, le site et l'API vivent sur le
   même domaine : `src/server.js` sert les deux, il n'y a plus de sous-domaine
   `api.` séparé (cette page indiquait auparavant
   `https://api.marlowe-vineyard.fbfa.fr/api/callback`, hérité du montage
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

> **Avec Docker ?** `backend/deploy/docker-compose.yml` fait tourner l'app et
> MariaDB dans deux conteneurs, chacun dans sa propre boîte. Attention : ce
> fichier suppose un Caddy déjà partagé entre plusieurs projets sur le VPS
> (voir l'avertissement en tête du fichier) — sur un VPS neuf ou différent,
> il faut d'abord en retirer le réseau `caddy` externe. La suite de cette
> section (sans Docker) fonctionne elle sur n'importe quel hébergeur.

Pour tester en local :

```bash
npm start
```

La console affiche `Marlowe API en écoute sur http://localhost:8787` (ou le
port choisi dans `.env`) une fois la base vérifiée.

Pour un déploiement réel, il faut :

1. **Un reverse proxy en HTTPS** devant le serveur Node (nginx, Caddy…), qui
   transmette les en-têtes `X-Forwarded-Proto` et `X-Forwarded-Host` (ou
   `Host`). C'est indispensable : c'est à partir de ces en-têtes que le
   serveur reconstruit l'adresse de retour Discord (`redirect_uri`) — sans
   eux, ou en HTTP nu, la connexion Discord échoue ou redirige vers la
   mauvaise adresse. Exemple minimal avec Caddy :

   ```
   marlowe-vineyard.fbfa.fr {
     reverse_proxy localhost:8787
   }
   ```

   (Caddy gère le HTTPS et pose les en-têtes `X-Forwarded-*` tout seul. Il
   faut au préalable qu'un enregistrement DNS de type A — ou CNAME — pour ce
   domaine pointe vers l'adresse IP du serveur.)

   ⚠️ **Un seul domaine, pas deux.** Cet exemple faisait servir
   `api.marlowe-vineyard.fbfa.fr` — un sous-domaine `api.` distinct, hérité du
   montage Cloudflare d'avant la version 2.0. Il n'existe plus : depuis que
   `src/server.js` sert le site ET l'API, c'est le MÊME domaine qui répond aux
   deux, celui de `SITE_URL`. Un sous-domaine `api.` séparé ferait échouer la
   connexion de deux façons à la fois : l'adresse de retour déclarée à Discord
   ne correspondrait plus (§1.3), et le cookie de session — posé sur l'hôte
   d'arrivée — resterait sur le mauvais domaine.

2. **Un superviseur** qui relance le processus s'il plante ou au redémarrage
   du serveur — [pm2](https://pm2.keymetrics.io/) est le plus simple.

   ⚠️ **UN SEUL PROCESSUS, UNE SEULE INSTANCE.** C'est une contrainte de
   fonctionnement, pas un conseil de performance. Concrètement, il ne faut
   **pas** :
   - `pm2 start … -i 2` ou `-i max` (mode grappe) — **utilisez `pm2 start`
     sans `-i`**, comme dans l'exemple ci-dessous ;
   - `docker compose up --scale marlowe-app=2`, ni `replicas:` ;
   - un second `node src/server.js` branché sur la même base, même
     « juste pour dépanner » ;
   - deux machines derrière un répartiteur.

   **Pourquoi.** Plusieurs routes lisent un document entier, le modifient et
   le réécrivent. Ce qui les empêche de s'écraser entre elles est une file
   d'attente **en mémoire** (`verrou()` dans `src/index.js`). Deux processus
   ont chacun la leur et ne se voient pas : la protection disparaît **sans
   qu'aucun message ne le signale**, et deux enregistrements simultanés se
   perdent en silence — les deux personnes lisant pourtant « Enregistré ✓ ».

   | | Protégé entre plusieurs processus ? |
   |---|---|
   | La matrice des accès (`/api/permissions`) | **Oui** — arbitrée par la base (`casValeur`, une seule instruction SQL) |
   | `data` (registre RH, clients, facturation…), `journal`, `settings`, `invites`, `alias` | **Non** — file en mémoire uniquement |

   Pour passer à plusieurs instances un jour, il faut d'abord donner à ces
   documents-là le même traitement qu'à la matrice. Détail et raisonnement :
   `AUDIT-PASSAGE-2.md`, §7 ter.

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

---

## 5. Brancher le site

Rien à modifier dans `marlowe-auth.js` : `MODE` est déjà réglé sur
`'discord'`, et `API_BASE` vaut `''` (voir `marlowe-config.js` à la racine du
dépôt) — une chaîne vide veut dire « la même origine que la page », ce qui
est le cas ici puisque `src/server.js` sert le site ET l'API depuis le même
processus (voir `backend/deploy/docker-compose.yml` et
`docs/A-TRANSMETTRE-AU-RESPONSABLE.md`, « montage B »). Aucun CORS à régler,
aucune adresse à recopier.

S'il fallait un jour séparer le site de l'API sur deux domaines, la seule
ligne à changer serait `window.MARLOWE_API_BASE` dans `marlowe-config.js`.

C'est fini — `gestion.html` demande une vraie connexion Discord.

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

### La séquence, depuis `/opt/marlowe` sur le serveur

```bash
git pull origin main

# RECONSTRUIT l'image avec le nouveau code, puis remplace le conteneur.
# C'est « up -d --build », jamais « restart ».
sudo docker compose -f backend/deploy/docker-compose.yml up -d --build marlowe-app

sudo docker compose -f backend/deploy/docker-compose.yml logs --tail=30 marlowe-app
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

---

## Vérifier que ça marche

Ouvrez `<adresse du site>/api/me` dans un navigateur — aujourd'hui
`https://marlowe-vineyard.fbfa.fr/api/me` (voir SITE_URL dans `.env`).
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

Si vous avez des données existantes sur l'ancienne base D1/KV à reprendre,
elles peuvent être exportées avec `wrangler d1 export` / `wrangler kv key get`
puis réimportées à la main dans MariaDB/MySQL — ce n'est pas fait
automatiquement par ce backend, qui démarre avec une base vide.
