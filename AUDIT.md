# Audit du dépôt Marlowe Vineyard

**Dépôt** : https://github.com/Poloveni/Marlow-Vineyard
**Commit de départ** : `a8fd22335feca4ba46db8a3f1ad5152256ba2b20` — « Ajouter un README à la racine » (10 septembre 2026)
**Branche de travail** : `audit-2026-09`, créée depuis `main` sans rien y modifier
**Date de l'audit** : 9–10 septembre 2026
**État initial** : aucune modification locale en attente. Rien du travail existant n'a été écrasé.

Aucun `push`, aucun `merge`, aucun déploiement n'a été effectué. Aucune base de
production n'a été touchée : tout a été éprouvé sur une MariaDB 10.11 installée
pour l'occasion, isolée, effacée à la fin.

---

## 1. Ce que le projet est réellement

Le README décrit une structure ; elle a été vérifiée fichier par fichier, et
elle est **exacte**. Pour mémoire :

| Élément | Réalité constatée |
|---|---|
| `index.html` | vitrine publique, 1 778 lignes, ne charge que `marlowe-config.js` et `marlowe-folkos.js` |
| `gestion.html` | espace membre, 3 723 lignes, 35 écrans |
| `marlowe-*.js` | `config`, `auth` (1 818 l.), `data` (518 l.), `actions` (10 363 l.), `liste`, `folkos` |
| `backend/` | API Node.js 18+ sans framework (`src/index.js`, 2 902 l.), base MariaDB/MySQL via `mysql2` |
| Fonctions RH, quotas, facturation, agenda | présentes et fonctionnelles |

**Il n'y a pas d'`AGENTS.md`** dans ce dépôt, ni de fichier d'instructions
équivalent, ni de configuration de lint, de types ou de CI. Les seuls outils
réellement disponibles sont `node` et les 14 bancs d'essai maison (`test-*.mjs`).

**Stack réelle** : Node.js ≥ 18.17, trois dépendances (`dotenv`, `mysql2`,
`node-cron`), pas d'étape de build. Point d'entrée `backend/src/server.js`, qui
sert **à la fois le site statique et l'API** sur la même origine. Déploiement
prévu par Docker Compose derrière un Caddy partagé, ou par pm2/systemd.

Une précision qui compte pour la suite : **le code de `src/index.js` a été écrit
pour Cloudflare Workers + D1 (SQLite) puis porté sur Node + MariaDB en gardant
la logique métier intacte.** C'est un choix défendable, mais c'est là que se
concentrent les défauts trouvés : le portage a laissé passer des différences de
comportement entre SQLite et MariaDB que rien ne pouvait signaler.

---

## 2. Couverture de la revue

### Lu intégralement, ligne à ligne

- `backend/src/index.js` (2 902 lignes) — routes, OAuth, quotas, permissions, agenda
- `backend/src/server.js`, `backend/src/db.js`, `backend/src/images.js`
- `backend/schema.sql`
- `backend/package.json`, `backend/Dockerfile`, `backend/deploy/docker-compose.yml`, `backend/deploy/Caddyfile.snippet`, `backend/.env.example`
- `README.md`, `backend/README.md`, `.gitignore`, `backend/.gitignore`, `.gitattributes`
- `marlowe-config.js`, `version.json`
- l'historique Git complet (6 commits)

### Lu par extraits ciblés **et** éprouvé par exécution réelle

- `marlowe-actions.js` (10 363 lignes), `gestion.html` (3 723 l.), `marlowe-auth.js`
  (1 818 l.), `marlowe-data.js`, `marlowe-liste.js`, `marlowe-folkos.js`, `index.html`

> **Limite à connaître.** `marlowe-actions.js` fait plus de dix mille lignes ; il
> n'a **pas** été relu ligne à ligne. Il a été vérifié autrement : chargement
> dans un vrai navigateur, parcours des **35 écrans du panel**, relevé de toutes
> les erreurs JavaScript et de toutes les réponses HTTP ≥ 400, plus une lecture
> ciblée des zones sensibles (calcul de quota, bornes de semaine, échappement
> HTML, appels réseau). Un défaut purement logique dans une branche de code que
> ce parcours n'a pas empruntée peut donc rester non détecté.

### Exclus, et pourquoi

| Exclu | Raison |
|---|---|
| `backend/node_modules/` | dépendances téléchargées, pas du code du projet — traitées via `npm audit` |
| `fonts/*.woff2` (24 fichiers) | polices binaires, aucun code exécutable |
| `img/*`, `logo*.png`, `favicon.png` | images binaires |
| `Claude outputs/*.png` (13 fichiers) | captures d'écran de documentation, aucun code |
| `.git/` | mécanique interne de Git ; l'historique, lui, a bien été examiné |
| `docs/*.md`, `img/README-banniere.md` | documentation de travail, lue en diagonale, sans effet sur le fonctionnement |

### Bloqué — ce qui n'a **pas** pu être vérifié

| Non vérifiable | Pourquoi |
|---|---|
| Connexion Discord réelle (OAuth de bout en bout) | pas d'identifiants d'application Discord. Discord a été **simulé** : rôles, membres, salons, envois. Le parcours de session complet est donc éprouvé, mais pas l'échange de jetons avec le vrai Discord |
| SSO FolkOS | ni adresse ni secrets ; seules les branches de refus et de configuration manquante ont été éprouvées |
| Envoi réel dans les salons et webhooks Discord | aurait écrit dans des salons que l'équipe lit |
| Déploiement de production : DNS, Caddy, HTTPS, certificats, reverse proxy | hors de portée depuis un environnement de test |
| Volumétrie réelle (taille du document `data`, nombre de ventes) | base de production non utilisée, à dessein |
| `planche-soleil.html` | outil interne sans rapport avec le panel ; chargé sans erreur, non audité en profondeur |

---

## 3. Méthode : revue par agent

La consigne demandait une revue par agent indépendante. Trois agents dédiés
(backend, frontend, sécurité) ont été lancés en parallèle : **les trois ont été
interrompus par une erreur serveur (HTTP 500) avant d'avoir rendu leurs
conclusions.** La revue principale a donc été menée directement, puis un
quatrième agent a relu **le diff des corrections**, indépendamment, avec succès.

Cette relecture indépendante a été utile : elle a trouvé **trois défauts réels
dans mes propres corrections**, tous traités avant la remise (voir §6). C'est
signalé ici parce que ça mesure la fiabilité du reste : une seconde paire d'yeux
a bel et bien trouvé quelque chose.

---

## 4. Problèmes détectés

Chaque « bug confirmé » ci-dessous a été **reproduit** avant correction, et la
correction **revérifiée** après. Les numéros de ligne sont ceux du commit de
départ.

### 🔴 Critique

#### C1 — `/api/presence` renvoyait 500 à chaque changement de page

- **Fichier** : `backend/src/index.js:232`
- **Cause** : `ESCAPE '\'` est de la syntaxe SQLite. En MariaDB, le backslash
  échappe le caractère suivant dans une chaîne : `'\'` se lit « une apostrophe
  échappée », la chaîne ne se referme jamais.
- **Déclencheur** : n'importe quel appel à `base(env).list()`, c'est-à-dire
  **chaque** requête `/api/presence` — donc chaque changement de page du panel.
- **Preuve** :
  ```
  {"error":"server_error","detail":"You have an error in your SQL syntax; […]
   near ''\\' AND (exp IS NULL OR exp > ?) ORDER BY cle' at line 1"}
  ```
  Parcours navigateur avant correction : **35 pages sur 35** en erreur.
- **Conséquence** : la fonction « qui d'autre travaille sur le panel » était
  **totalement hors service depuis la migration MariaDB**, et chaque navigation
  produisait une erreur 500 dans la console et les journaux du serveur.
- **Correction appliquée** : backslash doublé dans le SQL envoyé.
  L'échappement des `%` et `_` a été revérifié : un préfixe `a_b` ne remonte
  plus `axb`.
- **Réserve honnête** : ce correctif suppose la configuration MariaDB par
  défaut. Sur un serveur réglé en `sql_mode=NO_BACKSLASH_ESCAPES` (rare, non
  utilisé ici), il faudrait un autre caractère d'échappement.

### 🟠 Élevée

#### E1 — La page Quota affichait des totaux absurdes

- **Fichier** : `backend/src/index.js:2237-2241` (`handleQuota`)
- **Cause** : MySQL/MariaDB rendent `SUM()` d'un entier en `DECIMAL`, que le
  pilote `mysql2` livre **en texte** pour ne pas perdre de précision. D1 (SQLite)
  rendait un nombre. Rien dans le code ne convertissait.
- **Déclencheur** : ouvrir la page « Quota en direct ».
- **Preuve** — tuiles relevées dans un vrai navigateur, avant correction :
  ```
  {"total":"0100010", "part":"0500 $", "sub":"dont 010 non rattachés"}
  ```
  au lieu de `110`, `500 $`, `dont 10 non rattachés`. Le panel calcule
  `s + r.vins` (`marlowe-actions.js:10204`) : `0 + "100" + "10"` concatène.
- **Conséquence** : le total de production, la part de la société et le nombre
  de vins non rattachés étaient **faux et illisibles**, sans aucun message
  d'erreur. Les comparaisons et le tri, eux, fonctionnaient par coercition —
  ce qui rendait le défaut d'autant plus déroutant.
- **Correction appliquée** : conversion en nombres à la sortie de la requête,
  ce qui rétablit le contrat que le panel attendait déjà.
- **Après correction** : `{"total":"110","part":"500 $","sub":"dont 10 non rattachés"}`

#### E2 — Le filtre des fichiers statiques était contournable

- **Fichier** : `backend/src/server.js:76-86`
- **Cause** : les filtres (`PREFIXES_INTERDITS`, segments commençant par un
  point) étaient appliqués à l'adresse **encore encodée**, alors que le chemin
  du fichier était construit sur l'adresse **décodée**.
- **Déclencheur** : écrire `/` sous sa forme `%2f`.
- **Preuve** :
  ```
  /backend/src/index.js        → 404
  /backend%2fsrc%2findex.js    → 200, 132 014 octets de code source
  /backend%2fpackage.json      → 200
  ```
- **Conséquence** : tout fichier `.js`, `.json`, `.html` ou `.pdf` rangé sous
  `backend/`, `docs/` ou `.git/` était servi publiquement. Le fichier `.env`
  échappait au filtre **uniquement** parce que son extension n'était pas dans la
  liste blanche — un seul rempart, et pas celui prévu pour ça. La sortie de la
  racine du site, elle, restait bloquée (vérifié : `/%2e%2e%2f…` → 404).
- **Correction appliquée** : décodage **avant** filtrage, et refus propre d'une
  adresse indécodable.
- **Après correction** : toutes les variantes ci-dessus → 404, et le site normal
  (`/`, `gestion.html`, `marlowe-actions.js`, polices, images) → 200.

#### E3 — Un accès extérieur recevait tout le registre RH

- **Fichier** : `backend/src/index.js:2351-2355` (`handleData`, méthode GET)
- **Cause** : le contrôle d'écriture existait (`canWrite`), la lecture non.
  `/api/data` rendait le document **entier** à toute session valable.
- **Déclencheur** : créer un accès extérieur (comptable, partenaire) avec la
  seule page « Facturation » cochée, et ouvrir le panel.
- **Preuve** : la réponse contenait `rhRoster` avec numéros civils, téléphones,
  RIB et identifiants Discord. Le navigateur n'en affichait rien, mais les
  données étaient lisibles dans l'onglet Réseau. Le README du backend dit
  lui-même : « le filtrage des pages côté navigateur est du confort, pas une
  sécurité ».
- **Conséquence** : divulgation de données personnelles à un tiers, sans que
  personne ne puisse s'en apercevoir.
- **Correction appliquée** : un accès extérieur ne reçoit plus les collections
  qui portent l'identité des gens (`rhRoster`, `rhDeparts`, `rhAbsences`,
  `rhRecruiters`, `avertissements`, `blacklist`) sauf si la page correspondante
  lui a été explicitement cochée. **Un membre du Discord garde tout** : c'est un
  outil d'équipe, et cette règle métier n'a pas été touchée.
- **Point resté ouvert, à trancher par vous** : voir R3 au §7.

#### E4 — Deux enregistrements simultanés s'effaçaient l'un l'autre

- **Fichiers** : `handleData` (`index.js:2389-2408`), `handleAbsence`
  (`2504-2540`), `handleLinterna` (`2604-2625`), `appendJournal` (`903-914`),
  `handleSettings` (`1609-1622`), `handleAlias` (`2297-2300`)
- **Cause** : toutes ces routes lisent un document entier, le modifient, puis le
  réécrivent — sans rien pour empêcher deux requêtes de se chevaucher.
- **Déclencheur** : deux personnes qui enregistrent en même temps, même sur des
  **pages différentes**. Ou un simple double-clic.
- **Preuve** (essai reproductible) : enregistrement simultané du registre RH et
  de la liste des clients →
  ```
  ✗ l'enregistrement du registre a survécu → {"rhRoster":[]}
  ✓ l'enregistrement des clients a survécu
  ✗ la révision a été incrémentée deux fois → {"rev":1}
  ```
  Le registre a disparu, et le numéro de révision n'a monté que d'un cran —
  donc **les autres navigateurs ne voyaient même pas qu'il s'était passé quelque
  chose**. Les deux personnes avaient pourtant lu « Enregistré ✓ ».
  Sur `/api/linterna`, un double-clic perdait l'un des deux ajouts.
- **Conséquence** : perte silencieuse de travail. C'est le défaut le plus
  insidieux du lot : rien ne le signale, ni à l'écran ni dans les journaux.
- **Correction appliquée** : une file d'attente par document (`verrou()`), qui
  fait passer ces sections l'une après l'autre.
- **Après correction** : les deux enregistrements survivent, la révision monte
  bien de deux crans, et les deux ajouts d'un double-clic sont comptés.
- **Portée du correctif, dite clairement** : la file vaut **pour un seul
  processus**. Le montage prévu (`docker-compose.yml`) n'en fait tourner qu'un,
  donc elle suffit aujourd'hui. Si l'API tournait un jour en plusieurs
  exemplaires derrière un répartiteur, il faudrait un verrou porté par la base
  (`SELECT … FOR UPDATE`). Voir R1 au §7.

#### E5 — Le Kit d'entretien ne pouvait être enregistré que par le patron

- **Fichier** : `backend/src/index.js`, table `COLLECTION_PAGES` (812-858)
- **Cause** : la collection `entretien` **manquait à la table**. Or `canWrite()`
  refuse par défaut toute collection qu'elle ne connaît pas.
- **Déclencheur** : un RH à qui la page « Kit d'entretien » est pourtant cochée
  dans la matrice clique sur Enregistrer.
- **Preuve** :
  ```
  RH avec la page cochée   → {"error":"forbidden","collections":["entretien"]}
  le même, sur le registre → {"ok":true,"saved":["rhRoster"],"rev":6}
  ```
- **Conséquence** : la page s'affichait, le bouton existait, et l'enregistrement
  échouait — sans que rien n'explique pourquoi. Seul le patron y arrivait.
  C'est exactement le piège que le code décrit ailleurs : « une clé oubliée
  disparaît en silence ».
- **Correction appliquée** : `entretien: ['entretien']` ajouté à la table. La
  page « Documents » n'y figure **pas** volontairement : c'est l'écran de
  consultation du kit, il ne doit pas donner le droit d'écrire.

#### E6 — Le README fait déclarer à Discord une adresse qui n'existe plus

- **Fichier** : `backend/README.md:25-33`
- **Cause** : héritage du montage Cloudflare, où l'API vivait sur un
  sous-domaine `api.` distinct. Depuis la version 2.0, `src/server.js` sert le
  site **et** l'API sur le même domaine.
- **Preuve** : le README fait enregistrer
  `https://api.marlowe-vineyard.fbfa.fr/api/callback`, alors que
  `SITE_URL` vaut `https://marlowvineyard.duckdns.org`, que le `Caddyfile.snippet`
  ne sert **aucun** sous-domaine `api.`, et que `handleLogin` construit
  `redirect_uri` à partir du domaine par lequel le navigateur est arrivé —
  donc `https://marlowvineyard.duckdns.org/api/callback`.
- **Conséquence** : quelqu'un qui suit le README à la lettre enregistre une
  adresse qui ne sera jamais utilisée, et n'enregistre pas la bonne. **Discord
  refuse alors la connexion**, avec le message « Invalid OAuth2 redirect_uri ».
  Le README qualifie lui-même ce point d'« oubli le plus fréquent ».
- **Correction appliquée** : section réécrite avec l'adresse réelle et la règle
  générale (l'adresse du site + `/api/callback`, à corriger en même temps que
  `SITE_URL`).

### 🟡 Moyenne

| # | Problème | Fichier | Statut |
|---|---|---|---|
| M1 | `GET /api/permissions` et `GET /api/settings` répondaient **sans authentification** : la carte des accès du panel (quel rôle ouvre quel écran) était lisible par n'importe qui | `index.js:760-763`, `1536-1540` | **corrigé** — 401 exigé ; vérifié que le panel connecté les lit toujours |
| M2 | Un corps de requête `null` (JSON valable) faisait répondre **500**, en recopiant un message d'erreur interne à l'appelant | `handleInvites`, `handleSettings` | **corrigé** — 400 `bad_shape` |
| M3 | Une adresse indécodable (`/%ZZ.js`) ou contenant un octet nul faisait répondre **500**, avec le chemin absolu du serveur dans le message | `server.js:80` | **corrigé** — 404 |
| M4 | Messages d'erreur périmés renvoyant vers **Cloudflare, wrangler et un quota KV** qui n'existent plus. Pire : le motif reconnaissait le mot `limit` n'importe où, si bien qu'une erreur MariaDB anodine se déguisait en panne de quota et conseillait d'attendre minuit | `index.js:1169`, `2824`, `2893-2897` | **corrigé** — messages MariaDB réels |

### 🔵 Faible

| # | Problème | Statut |
|---|---|---|
| F1 | `DELETE /api/me` répondait **200**, `POST /api/quota` aussi : une route de lecture laissait croire qu'on venait de supprimer quelque chose | **corrigé** — 405 |
| F2 | Le contrat documenté en tête de `marlowe-auth.js` présentait `GET /api/permissions` comme public | **corrigé** |

---

## 5. Risques et améliorations **non corrigés** — points à trancher

Ces points sont réels mais n'ont **pas** été modifiés : soit ils engagent une
règle métier qui vous appartient, soit le correctif serait disproportionné par
rapport au risque. Ils sont documentés pour que la décision soit la vôtre.

| # | Point | Gravité | Pourquoi laissé en l'état |
|---|---|---|---|
| R1 | La file d'attente anti-écrasement (E4) protège **un seul processus** | moyenne | Suffisant pour le montage actuel. À revoir si l'API est un jour dupliquée : il faudrait un verrou en base |
| R2 | `handleInvites` fait toujours une lecture-modification-écriture non protégée de la liste des accès extérieurs | moyenne | Même classe de défaut que E4, mais rare en pratique (un seul patron, modifications occasionnelles). La corriger imposait de restructurer toute la route — disproportionné sans nécessité démontrée |
| R3 | Le filtre de lecture d'E3 ferme les **collections personnelles**, pas tout le document | moyenne | Un filtre complet demanderait la carte « page → collections lues », qui **n'existe pas** : 9 écrans de consultation (Documents, Historique, Vue d'ensemble, Grades & quotas, Quota en direct…) lisent des collections rangées sous une autre page. S'en servir comme liste blanche **viderait ces pages** chez un partenaire pourtant autorisé. Établir cette carte est un vrai chantier, à faire en connaissant les écrans |
| R4 | `errorPage()` insère `titre` et `message` dans du HTML **sans échappement** | moyenne | Aucun appelant actuel ne passe de donnée utilisateur — vérifié un par un. Ce n'est donc pas une faille aujourd'hui, mais un seul appel dynamique suffirait à la créer. Échapper ces deux valeurs serait prudent |
| R5 | Le gestionnaire d'erreurs renvoie le message technique brut au client (`detail: msg`), erreurs SQL comprises | moyenne | C'est ce qui a rendu C1 diagnosticable, et le projet mise clairement sur des messages parlants. Arbitrage à faire : diagnostic contre discrétion. A minima, ne renvoyer le détail qu'aux sessions authentifiées |
| R6 | Si Discord est injoignable, **toute** requête authentifiée répond 500 — y compris pour les comptes `OWNER_IDS`, dont le README promet qu'ils gardent l'accès « quoi qu'il arrive » | moyenne | Se fermer en cas de doute est défendable. Mais soit le code doit tenir la promesse, soit le README doit la retirer. À trancher |
| R7 | `/api/absence` et `/api/linterna` rattachent les gens par **nom** (en minuscules) | moyenne | **Règle métier ambiguë** : deux employés homonymes partageraient la même ligne d'absence et la même récolte. Rien n'a été inventé ; il faut décider si le nom suffit ou s'il faut passer par le numéro civil |
| R8 | Pas de limitation de débit générale sur l'API | moyenne | Seul `/api/invite-login` freine (8 essais / 15 min par code) ; retrait et disponibilité ont leur propre délai. Le reste est ouvert à un membre authentifié |
| R9 | Pas d'en-tête `X-Content-Type-Options: nosniff` ; les fichiers déposés sont resservis avec leur type d'origine | faible | Les types acceptés sont limités à 4 (JPEG, PNG, WebP, PDF) — vérifié. Le risque est théorique, l'en-tête reste souhaitable |
| R10 | `DATA_MAX` compare une longueur de chaîne JavaScript, pas des octets | faible | Un texte accentué peut peser jusqu'à deux fois la valeur contrôlée. Sans conséquence (la colonne est un `LONGTEXT` de 4 Go), mais le garde-fou est plus lâche qu'il n'en a l'air |
| R11 | `X-Forwarded-Host` est cru sans réserve pour construire l'adresse de retour Discord | faible | Sans danger derrière le Caddy documenté (le port 8787 n'est pas publié). Le deviendrait si le conteneur était un jour exposé directement |
| R12 | Plusieurs en-têtes `Set-Cookie` seraient écrasés par `envoyerResponse` | faible | Sans effet : l'application n'utilise aucun cookie, seulement des jetons `Bearer`. À savoir si des cookies sont ajoutés un jour |
| R13 | `/api/version` annonce une liste de routes incomplète (`folkos`, `img`, `discord` manquent) | faible | Cosmétique, mais cette route sert justement à vérifier ce qui est déployé |
| R14 | `.env.example` contient de **vrais identifiants Discord** (serveur, salons, rôles, propriétaires) | faible | Ce ne sont **pas des secrets** — n'importe quel membre du serveur les voit. Ils décrivent en revanche la structure du Discord dans un dépôt public. Des valeurs d'exemple seraient plus neutres |

---

## 6. Ce que la relecture indépendante a trouvé dans mes corrections

Le quatrième agent a relu le diff sans connaître mon raisonnement. Il a relevé
trois défauts réels, **tous corrigés avant remise** :

1. **Ma première version du filtre E3 aurait vidé des pages.** J'avais utilisé
   `COLLECTION_PAGES` comme liste blanche de lecture — or cette table décrit qui
   a le droit d'**écrire**. Neuf écrans de consultation n'y figurent pas et
   seraient devenus vides pour un accès extérieur pourtant autorisé. Vérifié,
   confirmé, et le filtre a été resserré sur les seules collections personnelles.
2. **`handleSettings` avait le même défaut d'écrasement qu'E4** et n'était pas
   protégé. Corrigé (et `handleAlias` avec).
3. **Un chemin contenant un octet nul remontait en 500** malgré ma correction
   M3. Corrigé.

C'est aussi en creusant le premier point que **E5** (le Kit d'entretien) a été
découvert — un bug préexistant, sans rapport avec mes corrections.

---

## 7. Corrections réalisées et fichiers modifiés

```
 backend/README.md     |  20 ++-
 backend/src/index.js  | 432 ++++++++++++++++++++++++++++++++++++-------
 backend/src/server.js |  31 +++-
 marlowe-auth.js       |   4 +-
 4 fichiers modifiés, 374 insertions(+), 113 suppressions(-)

 backend/test-acces.mjs    (nouveau — 28 vérifications)
 backend/test-mariadb.mjs  (nouveau — 20 vérifications)
```

L'essentiel des 374 lignes ajoutées sont des **commentaires explicatifs**, dans
le style du dépôt : chaque correction dit ce qui n'allait pas et pourquoi, pour
que le défaut ne revienne pas à la faveur d'une réécriture.

**Aucun test, aucune validation, aucune protection n'a été désactivé.** Le design,
les fonctionnalités et les règles métier sont inchangés. Aucune dépendance n'a
été mise à jour.

### Tests de régression ajoutés

- **`backend/test-acces.mjs`** — les garde-fous d'accès : un accès extérieur ne
  reçoit pas l'identité des gens, le Kit d'entretien s'enregistre sans être
  patron, un corps `null` ne fait pas tomber le serveur, une route de lecture
  refuse d'être écrite, la carte des accès n'est pas publique.
- **`backend/test-mariadb.mjs`** — **contre une vraie MariaDB**. C'est le banc
  d'essai qui manquait : tous les autres remplacent la base par une fausse, en
  JavaScript, qui rend des nombres et accepte la syntaxe SQLite. Ni C1 ni E1 ni
  E4 ne pouvaient être vus autrement. Sans base configurée, il **s'ignore
  proprement** au lieu de faire échouer la série ; il refuse de s'exécuter sur
  une base dont le nom contient « prod ».

---

## 8. Commandes exécutées et résultats

| Commande | Résultat |
|---|---|
| `git clone` + `git checkout -b audit-2026-09` | commit `a8fd223`, aucune modification locale préexistante |
| `node --check` sur les 23 fichiers `.js`/`.mjs` suivis | **tous valides**, avant et après corrections |
| Les 14 bancs d'essai du dépôt, **avant** corrections | **524 vérifications, 0 échec** (référence) |
| Les 16 bancs d'essai, **après** corrections | **572 vérifications, 0 échec** — aucune régression |
| `npm install` (3 dépendances) | `dotenv@16.6.1`, `mysql2@3.24.4`, `node-cron@3.0.3` |
| `npm audit --omit=dev` | 2 alertes modérées — voir §9 |
| Installation MariaDB 10.11.14, base `marlowe_test` isolée | schéma appliqué automatiquement par `db.js` : tables `kv`, `ventes`, `images` créées |
| Démarrage réel de l'API (`node src/server.js`) | `[db] connecté et schéma vérifié` puis écoute — **le projet démarre** |
| Sonde de la couche base (types réellement renvoyés) | a révélé E1 (`SUM` en texte) et confirmé : idempotence des ventes, utf8mb4 intact, document de 1,4 Mo intact, `undefined` refusé par `mysql2` |
| Banc d'intégration maison (vraie base + Discord simulé) | **11 échecs avant** corrections → **26 vérifications, 0 échec après** |
| Parcours navigateur (Chromium réel), site public, bureau **et** mobile 390 px | 0 erreur JS, 0 requête en échec, **aucun débordement horizontal** |
| Parcours navigateur des 35 écrans du panel, **avant** corrections | **35 pages sur 35** en erreur (C1) ; tuiles de quota : `0100010` |
| Parcours navigateur des 35 écrans, **après** corrections | **35 pages sur 35 sans erreur** ; tuiles de quota : `110`, `500 $`, `dont 10 non rattachés` |
| Même parcours avec un accès extérieur | **29 pages sur 29 sans erreur**, et le registre RH ne part plus |
| Contournement `%2f` du filtre statique | **200 + 132 Ko de code source avant** → **404 après** |
| Traversée de répertoire (`%2e%2e`, `..%2f`) | **bloquée**, avant comme après |
| Routes sans authentification | `version`, `orga`, `vitrine` ouvertes (voulu) ; `permissions` et `settings` désormais 401 ; toutes les autres 401 |
| Dépôt et restitution de fichiers | aller-retour **à l'octet près** ; type interdit → 415, sans session → 401, 2 Mo → 413, identifiant inventé → 404 |
| Accès non autorisés (membre simple, collection inconnue, matrice) | **tous refusés en 403** |
| Recherche de secrets dans les 6 commits de l'historique | **aucun jeton, mot de passe ou webhook trouvé** ; aucun `.env` n'a jamais été commité |

---

## 9. Dépendances

`npm audit` signale **2 alertes modérées**, toutes deux sur le même paquet :

> `uuid < 11.1.1` — « Missing buffer bounds check in v3/v5/v6 when buf is
> provided », atteint via `node-cron@3.0.3`.

**Cette alerte n'est pas pertinente pour ce projet.** Vérification faite dans le
code de `node-cron` : il n'appelle `uuid` que sous la forme `uuid.v4()`, **sans
argument**, pour nommer ses tâches planifiées. L'alerte concerne les versions
v3/v5/v6 appelées avec un tampon fourni par l'appelant — cas qui ne se produit
jamais ici, et où aucune donnée utilisateur n'intervient.

**Recommandation : ne pas corriger.** `npm audit fix --force` installerait
`node-cron@4.x`, un changement de version majeure, pour un risque nul. À revoir
lors d'une mise à jour volontaire de `node-cron`.

---

## 10. Étapes concrètes avant de déployer

Dans cet ordre.

1. **Relire le diff** : `git diff main..audit-2026-09`. Les corrections sont
   ciblées et commentées ; rien ne doit vous surprendre.
2. **Corriger l'adresse de retour Discord.** C'est le point bloquant. Sur
   https://discord.com/developers/applications → votre application → **OAuth2**
   → **Redirects**, l'adresse doit être **exactement** votre `SITE_URL` suivie
   de `/api/callback` — aujourd'hui `https://marlowvineyard.duckdns.org/api/callback`.
   Si l'ancienne adresse `api.marlowe-vineyard.fbfa.fr` y figure encore, elle ne
   sert à rien.
3. **Lancer les bancs d'essai** depuis `backend/` :
   ```bash
   for t in test-*.mjs; do node "$t"; done
   ```
   Attendu : 16 fichiers, aucun échec. `test-mariadb.mjs` s'ignorera faute de base.
4. **Lancer le nouveau banc d'essai MariaDB contre une base de TEST** — jamais
   celle de production, il efface les tables :
   ```bash
   DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=marlowe \
   DB_PASSWORD=<le mot de passe> DB_NAME=marlowe_test node test-mariadb.mjs
   ```
   Attendu : 20 vérifications, 0 échec.
5. **Sauvegarder la base de production** avant tout déploiement :
   ```bash
   mariadb-dump -u marlowe -p marlowe > sauvegarde-avant-audit.sql
   ```
6. **Déployer**, puis **vérifier immédiatement trois choses** :
   - `https://marlowvineyard.duckdns.org/api/version` → doit répondre, et le
     numéro doit être celui que vous venez de déployer. Un correctif non
     redéployé se comporte exactement comme un correctif qui ne marche pas ;
   - `https://marlowvineyard.duckdns.org/api/me` → doit répondre
     `{"error":"unauthorized"}`. C'est le bon signe : le serveur répond et refuse
     une requête sans session ;
   - `https://marlowvineyard.duckdns.org/backend%2fsrc%2findex.js` → doit
     répondre **404**. S'il renvoie du code, le correctif E2 n'est pas en ligne.
7. **Se connecter au panel et changer de page deux ou trois fois.** La console du
   navigateur (touche F12) ne doit plus montrer d'erreur 500 sur `/api/presence`.
8. **Ouvrir la page « Quota en direct »** et vérifier que les totaux sont des
   nombres normaux, pas des suites de chiffres collés.
9. **Mettre `version.json` à jour** (il est resté à `1.88.0` et annonce
   « 1.81.0 → 1.88.0 attendent » ainsi qu'un backend à passer en `1.47.0`).
10. **Décider des points du §5**, en particulier R3 (le filtre de lecture
    complet), R6 (l'accès de secours quand Discord est injoignable) et R7 (les
    homonymes).

---

## 11. Bilan, en clair

Vous avez un projet **sérieusement construit**. Le code est abondamment commenté,
expliqué, et accompagné de 14 bancs d'essai maison — c'est rare, et c'est ce qui
a rendu cet audit rapide. Les protections importantes étaient déjà là : les rôles
sont revérifiés à chaque requête, les mots de passe des accès extérieurs sont
correctement hachés, les requêtes SQL passent toutes par des paramètres liés
(**aucune injection SQL n'a été trouvée**), l'anti-doublon des ventes est solide,
et les calculs de dates et de semaines — souvent une source d'ennuis — sont
justes, changements d'heure compris.

**Ce qui n'allait pas vient presque entièrement d'un seul événement : le
déménagement de Cloudflare vers votre propre serveur.** La logique métier a été
préservée, comme prévu, mais la nouvelle base de données ne se comporte pas comme
l'ancienne sur trois points, et rien ne pouvait le signaler :

- une requête écrite en langage SQLite que MariaDB refuse — la fonction
  « qui travaille en ce moment » était cassée **à chaque changement de page** ;
- des additions que la nouvelle base rend sous forme de texte, ce qui faisait
  afficher `0100010` au lieu de `110` sur la page Quota ;
- et un défaut plus ancien, indépendant de la migration : quand deux personnes
  enregistraient en même temps, **le travail de l'une disparaissait sans un mot**,
  les deux voyant « Enregistré ✓ ».

Ces trois-là sont corrigés et vérifiés. S'y ajoutent une porte laissée ouverte
sur le code source du serveur, un registre RH qui partait en entier chez les
partenaires extérieurs, un Kit d'entretien que seul le patron pouvait
enregistrer, et une page du README qui, suivie à la lettre, **empêchait la
connexion Discord de fonctionner**.

Pourquoi personne ne les avait vus : les bancs d'essai existants remplacent la
base de données par une imitation écrite en JavaScript. Elle est pratique, elle
n'a besoin de rien, et elle a bien vérifié toute la logique du panel — mais elle
rend des nombres là où MariaDB rend du texte, et elle accepte une syntaxe que
MariaDB refuse. C'est pour ça que le nouveau banc d'essai `test-mariadb.mjs`
travaille sur une **vraie** base : c'est le seul moyen de revoir ces défauts
venir.

Deux choses à garder en tête, sans dramatiser. D'abord, `marlowe-actions.js`
fait plus de dix mille lignes : il a été éprouvé en parcourant ses 35 écrans dans
un vrai navigateur, pas relu ligne à ligne — un défaut logique dans un chemin non
emprunté peut donc subsister. Ensuite, la vraie connexion Discord n'a pas pu être
essayée faute d'identifiants ; elle a été simulée, ce qui valide tout le parcours
sauf l'échange final avec Discord lui-même.

Enfin, le §5 liste quatorze points laissés en l'état **volontairement** : soit ils
engagent une décision qui vous appartient (que faire des homonymes ? faut-il que
les comptes de secours gardent l'accès quand Discord ne répond pas ?), soit le
remède aurait été plus risqué que le mal. Rien n'y a été inventé à votre place.

**Aucune anomalie supplémentaire n'a été détectée dans le périmètre effectivement
vérifié** — ce qui n'est pas la même chose que « il n'y en a plus », et ne dit
rien de ce qui n'a pas pu être testé : la connexion Discord réelle, le SSO
FolkOS, et le déploiement de production.
