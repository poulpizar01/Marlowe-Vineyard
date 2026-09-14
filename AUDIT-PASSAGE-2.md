# Audit du dépôt Marlowe Vineyard — DEUXIÈME PASSAGE

**Dépôt** : https://github.com/Poloveni/Marlow-Vineyard
**Commit examiné** : `92a7fc0` — « Corriger le fond photo invisible dans l'espace membre »
**Branche de travail** : `audit-passage-2`, créée depuis `main`
**État initial** : copie de travail propre, aucune modification en attente, aucun `stash`. Rien du travail existant n'a été écrasé.
**Date** : 11 septembre 2026

Aucun `push`, aucun `merge`, aucun déploiement. Aucune donnée de production
touchée, aucun message ni webhook Discord réel envoyé.

Ce rapport **ne remplace pas** `AUDIT.md` : il le contrôle.

---

## 1. Ce qui avait déjà été fait — et ce que ça change pour ce passage

`AUDIT.md` documente un premier audit arrêté au commit `a8fd223`. Mais **trois
vagues de corrections** se sont succédé depuis, et les deux dernières ne sont
documentées nulle part ailleurs que dans leurs messages de commit :

| Commit | Contenu | Documenté dans AUDIT.md ? |
|---|---|---|
| `2413f0f` (+ merge `50bd062`) | Premier audit : 12 bugs, 2 bancs d'essai | oui |
| `94d5483` | 11 correctifs supplémentaires (quota, clôture, upload, plafond de corps, replis d'authentification) | **non** |
| `432b0c1` | **Changement d'architecture** : le jeton de session passe de `localStorage` à un cookie httpOnly | **non** |
| `88b2583`, `396ceff` | `.env.example` pointé sur le domaine définitif | non |
| `92a7fc0` | Fond photo de `gestion.html` | non |

C'est `432b0c1` qui concentre le risque : il change la façon dont TOUTE
l'application s'authentifie, son propre message de commit reconnaît qu'il n'a
**jamais été essayé dans un vrai navigateur**, et il invalide au passage des
conclusions du premier audit qui reposaient sur l'absence de cookies.

**Périmètre parfaitement déterminé.** Aucune zone d'ombre à signaler : les
trois vagues sont identifiables commit par commit.

---

## 2. Couverture de cette revue

### Lu intégralement
- `backend/src/index.js` (3 000+ lignes), `backend/src/server.js`, `backend/src/db.js`
- `backend/schema.sql`, `backend/package.json`, `backend/Dockerfile`,
  `backend/deploy/docker-compose.yml`, `backend/deploy/Caddyfile.snippet`,
  `backend/.env.example`, `.gitignore`, `.gitattributes`
- `marlowe-auth.js`, `marlowe-data.js`, `marlowe-config.js`
- `AUDIT.md`, `README.md`, `backend/README.md`
- Les 11 bancs d'essai de `backend/`, les 5 de la racine
- Les diffs complets de `2413f0f`, `94d5483`, `432b0c1`

### Lu par extraits ciblés
- `marlowe-actions.js` (491 Ko) et `gestion.html` (594 Ko). **Limite à
  connaître** : ces deux fichiers dépassent la capacité de lecture d'un seul
  tenant ; ils ont été fouillés par recherche de motifs et lecture de zones
  (appels réseau, calculs de quota, bornes de semaine, échappement). Un défaut
  purement logique dans une branche non visitée peut subsister.

### Exclus, et pourquoi
| Exclu | Raison |
|---|---|
| `backend/node_modules/` | dépendances installées, pas du code du projet |
| `fonts/`, `img/`, `*.png`, `three.min.js` | binaires et bibliothèque tierce non modifiée |
| `Claude outputs/` | captures d'écran de documentation |
| `planche-soleil.html` | outil interne sans lien avec le panel (déjà écarté au 1er audit) |

### Méthode : six revues indépendantes **plus** une relecture de mes correctifs
Six agents ont travaillé en parallèle sur des périmètres disjoints (session et
cookie, couche réseau du panel, contrôle d'accès, logique métier/quotas,
concurrence et base, configuration et déploiement), puis un septième a relu
mes propres corrections sans connaître mon raisonnement.

Cette dernière relecture a été la plus utile de toutes : elle a trouvé
**quatre défauts réels dans mes propres correctifs**, dont un qui aurait pu
bloquer toutes les écritures du panel en production. Voir §6 bis — c'est aussi
la raison pour laquelle ce rapport ne demande à personne de croire un audit
sur parole, y compris celui-ci.

**Aucune alerte d'agent n'a été reprise sans vérification personnelle dans le
code.** Plusieurs l'ont été par reproduction exécutable (voir §7). Les points
que je n'ai pas pu confirmer sont marqués HYPOTHÈSE.

---

## 3. Statut des corrections du premier audit

### Validées — 10 sur 13

| # | Correction | Vérification faite |
|---|---|---|
| C1 | `ESCAPE '\\'` doublé pour MariaDB | balayage de **toutes** les requêtes SQL du dépôt : aucun résidu SQLite (`ON CONFLICT`, `AUTOINCREMENT`, `strftime`, `RETURNING`, `PRAGMA`, `\|\|`). `ESCAPE` correctement doublé aux deux endroits |
| E1 | `SUM()` rendu en texte | une seule requête d'agrégat existe ; ses cinq champs passent tous par `nombreSQL`. Vérifié par test : `vins === 100` (nombre), pas `"100"` |
| E4 | File d'attente anti-écrasement | les **trois** écrivains de `data` passent par `verrou('data')` ; `journal`, `settings`, `alias` aussi. `verrou()` libère bien sur exception (`.finally`) et n'est pas global. **Sauf `invites`** → voir §3 « incomplètes » |
| E5 | `entretien` manquant | `COLLECTION_PAGES` recoupée avec les 30 collections réellement écrites par le panel : exhaustive, aucun autre oubli |
| M1 | `permissions`/`settings` en 401 | couvert par `test-acces.mjs`, passe toujours |
| M2 | corps `null` → 400 | idem |
| M3 | adresse indécodable → 404 | idem, et étendu par ce passage |
| M4 | messages d'erreur Cloudflare périmés | bloc réécrit, motifs MariaDB réels |
| F1 | route de lecture → 405 | couvert |
| F2 | contrat documenté | corrigé |

### Incomplètes — 3 sur 13 (corrigées dans ce passage)

| # | Ce qui restait ouvert |
|---|---|
| **E2** | **Le filtre de fichiers statiques se contournait toujours.** Le correctif décodait bien avant de filtrer, mais comparait l'adresse **brute** : `//backend/src/index.js` ne commence pas par `/backend/`, et `path.resolve` réduit ensuite les barres doubles. Le code source du serveur repartait en clair. *(Et ma propre correction s'est révélée incomplète à son tour — voir §6 bis.)* |
| **E3** | **Le filtre de lecture ne couvrait que `/api/data`.** **Trois** autres routes lisent les mêmes données nominatives et les rendaient à toute session valable : `/api/quota` (numéro civil de tout le personnel), `/api/journal` (activité RH nominative), `/api/presence` (identifiant Discord, nom et page ouverte de chaque personne connectée). |
| **E6** | **Le README n'était réparé qu'à moitié.** Le §1.3 était corrigé, mais le §4 faisait toujours configurer le sous-domaine mort `api.marlowe-vineyard.fbfa.fr`. |

### Statut des correctifs de `94d5483`

Validés : `handleUpload` (délai de 20 s, `STORAGE_BASE` requis, URL vérifiée
en `https`), `CORPS_MAX` dans `server.js`, replis fermés de
`getPermissions`/`getRoles`, `handlePresence` (1+N supprimé), `nombreSQL`
centralisée, retrait de `repriseKV()`, `escUrlCss` (défini et utilisé aux 3
endroits), `id="weekRange"` dédoublé (les deux identifiants sont uniques et
`peindreGrille` vise bien `agendaWeekRange`).

**Incomplets** : `quotaDeLaFiche()` et `closeWeek()` → voir §5.

---

## 4. Régressions introduites par la migration vers le cookie (`432b0c1`)

C'est le cœur de ce deuxième passage.

### 4.1 🔴 CSRF ouvert sur toutes les routes qui modifient quelque chose — CONFIRMÉ

**Fichier** : `backend/src/index.js`, commentaire de `entetesCookieSession`.

Le commit pose `SameSite=None` — c'est **justifié** : le panel s'affiche dans
l'iframe de l'ordinateur en jeu, et `Lax` empêcherait le cookie de repartir.
Mais il s'en remet ensuite à une affirmation **fausse**, écrite dans le code :

> « la plupart des routes attendent un corps JSON qu'un simple formulaire HTML
> ne sait pas produire »

Deux raisons pour lesquelles c'est faux, l'une et l'autre vérifiées en
exécutant Node :

1. `request.json()` **ne regarde pas** le `Content-Type`. Un corps envoyé en
   `text/plain` est parsé comme du JSON sans broncher.
2. Un `<form enctype="text/plain">` encode `nom=valeur`. En coupant le JSON à
   l'endroit du `=` — nom de champ `{"action":"creer","nom":"x","mdp":"secret12`
   et valeur `"}` — le corps reçu est du JSON parfaitement valide.

Un formulaire hébergé n'importe où pouvait donc déclencher n'importe quelle
route POST au nom de la victime connectée. Pas de requête préparatoire (un
formulaire n'en déclenche jamais), et aucun besoin de LIRE la réponse : la
liste blanche CORS empêche de lire, **pas d'agir**.

**Reproduction** : un patron connecté ouvre une page piégée →
`POST /api/invites {"action":"creer",…}` → un accès extérieur est créé. Les
actions `supprimer`, `basculer`, `pages` fonctionnent aussi en aveugle, de
même que `/api/absence`, `/api/linterna`, `/api/relais`, `/api/alias`.

### 4.2 🔴 Une session expirée fait perdre le travail en silence — CONFIRMÉ

**Fichier** : `marlowe-data.js:288-300`.

`flush()` n'arrêtait les réessais que sur `403`. Un `401` tombait dans le cas
général : les clés repartaient en file et `finally` relançait `schedule()` →
**un `PUT /api/data` toutes les 1,5 seconde, indéfiniment**.

Ce défaut est une conséquence directe de la migration : le cookie étant
httpOnly, le panel ne **peut plus** vérifier lui-même s'il est encore
connecté ; le 401 est devenu son seul signal, et personne ne l'écoutait. La
personne voyait une pastille rouge sans explication, continuait de saisir, et
perdait tout au rechargement.

### 4.3 🟠 Le cookie posé sur un hôte, la redirection vers un autre — CONFIRMÉ

**Fichier** : `backend/src/index.js`, `handleCallback` / `handleFolkos`.

Le cookie est posé par la réponse de `/api/callback`, donc sur l'hôte
d'**arrivée** ; la redirection partait en dur vers `SITE_URL`. Quand les deux
diffèrent, le cookie reste derrière et l'utilisateur revient à l'écran de
connexion sans le moindre message.

Ce n'est pas théorique : `backend/deploy/Caddyfile.snippet` sert **deux**
domaines vers la même application (l'actuel et le futur), et `.env.example`
pointe déjà sur le futur.

### 4.4 🟡 Deux affirmations de la documentation sont devenues fausses

- `AUDIT.md` R12 : « sans effet : l'application n'utilise aucun cookie ». La
  prémisse ne tient plus. *(Le comportement, lui, reste sain aujourd'hui :
  vérifié qu'un seul `Set-Cookie` est posé par réponse et qu'il traverse bien
  `envoyerResponse`. Le piège reste latent si un deuxième cookie apparaît.)*
- `docs/reponse-folkos.md:48` : « Cookies SameSite=None : sans objet chez
  nous ». Faux depuis `432b0c1`.

---

## 5. Nouveaux défauts trouvés (indépendants des correctifs précédents)

### Corrigés dans ce passage

| Gravité | Défaut | Fichier |
|---|---|---|
| 🔴 | **Les secrets partent dans l'image Docker.** Aucun `.dockerignore` n'existait ; `COPY . /app` depuis la racine embarquait `backend/.env` (mot de passe de base, secret et jeton Discord, jeton de stockage) et tout `.git`. `.gitignore` **ne sert à rien ici** : Docker ne le lit pas. Une image se pousse, se partage et s'inspecte — un secret figé dans une couche en ressort intact | racine du dépôt |
| 🟠 | **Une révocation d'accès pouvait s'annuler toute seule.** `/api/invite-login` relisait la liste, vérifiait le mot de passe (PBKDF2, ~100 ms), puis réécrivait **la liste lue avant**. Le patron supprimait un accès pendant que son porteur se connectait → l'accès revenait, actif, avec son mot de passe. La route est publique, donc déclenchable à volonté par la personne qu'on cherche justement à retirer. C'était le point R2, classé « rare en pratique » : c'est en réalité un défaut de sécurité | `index.js` |
| 🟡 | **Déconnexion déclenchable depuis un autre site** par `<img src="…/api/logout">` : aucun contrôle de méthode | `index.js` |

### Confirmés mais **non corrigés** — décision métier ou remède disproportionné

| # | Défaut | Pourquoi laissé en l'état |
|---|---|---|
| ~~**N1**~~ | ~~La clôture archivait des compteurs non bornés sous une étiquette « lundi → dimanche »~~ | **TRANCHÉ ET CORRIGÉ** — la période affichée est désormais la période réelle, de la clôture précédente à maintenant ; les compteurs et les montants archivés n'ont pas été touchés (§6-17) |
| ~~**N1 bis**~~ | ~~L'exemption de quota n'était respectée que sur une partie des écrans~~ | **TRANCHÉ ET CORRIGÉ** — « Quota en direct » applique la même règle que Primes, compteurs agrégés compris (§6-18) |
| ~~**N2**~~ | ~~**Usurpation par pseudo Discord.** Un membre qui prenait le surnom d'un collègue écrivait son absence, passait sa fiche en « absent » et remettait sa récolte Linterna à zéro — sans aucun droit sur la page Employés. C'était le point **R7**, laissé ouvert par le premier audit comme « règle métier ambiguë » ; ce passage l'a montré **exploitable en écriture**.~~ | **CORRIGÉ** — l'identité est désormais l'identifiant Discord, le pseudo ne servant plus qu'à l'affichage (§6-13). Ce n'était donc pas une décision métier : c'était un défaut de sécurité |
| **N3** | Panne de base **au démarrage** = site entier indisponible (`await creerBase` en tête de module, le processus sort avant d'écouter). Le statique tombe avec l'API | Atténué par `restart: unless-stopped` et `depends_on: service_healthy`. Servir le site pendant que l'API répond 503 serait mieux, mais c'est un changement de structure du démarrage |
| ~~**N4**~~ | ~~Deux onglets « Accès & rôles » s'écrasaient en silence~~ | **CORRIGÉ** — contrôle de version atomique, 409 en cas de conflit, sans rien écraser (§6-12) |
| **N5** | `/api/relais` ne filtre pas les accès extérieurs : un comptable peut poster dans le salon des runners | Nuisance et ingénierie sociale, aucune donnée en jeu |
| **N6** | Les rôles ne sont pas « revérifiés à chaque requête » : cache de 60 s (membre) et 300 s (rôles du serveur). Un membre déchu garde ses accès jusqu'à une minute | Compromis assumé et raisonnable. À savoir, simplement : le README promet plus que le code ne tient |
| **N7** | Le gestionnaire d'erreurs renvoie le message technique brut (`detail`), erreurs SQL comprises | Point **R5**, arbitrage diagnostic/discrétion déjà posé au 1er audit. Inchangé |
| ~~**N8**~~ | ~~En-têtes absents~~ | **CORRIGÉ** — `nosniff` et `Referrer-Policy` posés (§6-10). `Strict-Transport-Security` volontairement laissé au Caddyfile : c'est un engagement mis en cache par le navigateur pour des mois, qui n'a pas sa place dans un code tournant aussi en local |
| ~~**N9**~~ | ~~`/api/version` annonce 24 routes sur 27~~ | **CORRIGÉ** — les 27 routes sont annoncées, et un banc d'essai compare désormais la liste au routeur lui-même (§6-11) |
| **N10** | Total des primes ≠ somme des lignes affichées : trois termes hors tableau s'ajoutent au KPI sans figurer au détail ni à l'export | À confirmer côté métier : est-ce voulu ? |
| **N11** | Un champ quota **vidé** vaut exemption définitive (`parseInt("",10)\|\|0` → 0). Aucune valeur distincte pour « non réglé » | Conséquence directe du correctif « quota 0 = exemption ». Demande de décider comment on revient au quota du grade |
| **N12** | `mondayOf()` travaille en heure **locale du navigateur**, `qdLundi()` en heure de Paris. Un utilisateur à UTC-5 clôture la semaine d'avant | Écart assumé en commentaire, mais réel |

### Hypothèses — signalées, non prouvées

- **H1** : `effectif: ['eligibilite', …]` dans `COLLECTION_PAGES`. La page
  « Éligibilité » est accordée par défaut à presque tous les rôles ; elle
  donnerait donc le droit de réécrire la table d'effectif (noms, grades,
  quotas). À trancher : si « Éligibilité » est un écran de consultation, le
  rattachement est une sur-attribution.
- **H2** : `SameSite=None; Secure` en développement local. Les navigateurs
  acceptent un cookie `Secure` sur `http://localhost` (origine réputée sûre),
  mais pas sur `http://<IP-du-réseau>`. Non documenté.
- **H3** : `recruesEligibles` compare les noms en strict là où tout le reste
  passe par `clefNom` — une casse différente ferait perdre une prime.

---

## 6. Corrections appliquées dans ce passage

Neuf correctifs, tous ciblés, aucune règle métier modifiée.

| # | Fichier | Correction |
|---|---|---|
| 1 | `backend/src/index.js` | `exigerOrigine()` + appel en tête du routeur. Refuse toute méthode modifiante dont l'`Origin` ne correspond ni à l'**hôte** d'arrivée ni à une adresse de `SITE_URL`/`SITE_URLS`. Une requête **sans** `Origin` reste acceptée (script, serveur de jeu, banc d'essai : pas de cookie ambiant à détourner). `Origin: null` est refusé — c'est exactement ce qu'envoie une iframe en bac à sable. La comparaison porte sur l'hôte et non sur l'origine entière : voir §6 bis. Le commentaire mensonger est remplacé par la démonstration du contraire |
| 2 | `backend/src/chemins.js` *(nouveau)* + `server.js` | Adresse **normalisée** avant filtrage — antislashs convertis, barres multiples réduites, `.`/`..` résolus — et comparée **sans tenir compte de la casse**, des deux côtés. Sorti dans un module à part **pour pouvoir l'éprouver** : `server.js` ouvre la base au chargement, donc aucun banc d'essai ne peut l'importer. Cette porte s'est ouverte **trois fois** faute d'un test capable de la surveiller |
| 3 | `backend/src/index.js` | `/api/quota` ne livre plus le **numéro civil** à un accès extérieur qui n'a pas le droit de lire le registre. Le nom et le poste restent : ils sont déjà publics par conception (`/api/orga` les sert sans authentification). Les chiffres de production restent visibles — la page continue de fonctionner |
| 4 | `backend/src/index.js` | `/api/journal` refusé (403) à un accès extérieur qui n'a pas la page `journal`. Un membre du Discord garde tout |
| 4 bis | `backend/src/index.js` | `/api/presence` rend une liste **vide** à un accès extérieur — et non un 403 : son battement continue d'être enregistré (le patron doit voir qu'il est connecté), son panel n'affiche simplement personne d'autre, sans tomber en erreur |
| 5 | `backend/src/index.js` | `handleInvites` **et** `handleInviteLogin` sous `verrou('invites')`, avec **relecture** de la liste dans le verrou. Une révocation partie pendant la vérification du mot de passe gagne désormais la course. La session délivrée est bâtie sur la version **fraîche** : une réduction de droits faite pendant ces ~100 ms s'applique, et un mot de passe changé entre-temps n'ouvre plus rien |
| 6 | `backend/src/index.js` + `marlowe-auth.js` | `/api/logout` en POST uniquement (donc soumis au contrôle d'origine), appel du panel mis à jour |
| 7 | `backend/src/index.js` | `racineRetour()` : retour vers l'hôte réellement utilisé quand il est autorisé, `SITE_URL` sinon. La liste blanche évite d'en faire une redirection ouverte, `url.origin` venant de `X-Forwarded-Host` |
| 8 | `marlowe-data.js` | Un `401` arrête la boucle d'enregistrement et affiche « session expirée — rechargez la page » |
| 9 | `.dockerignore` *(nouveau)*, `backend/README.md`, `backend/.env.example` | Secrets, `.git` et notes hors de l'image. README §4 corrigé (le sous-domaine `api.` mort) et `GET /api/logout` mis à jour en POST. `.env.example` : les **deux** domaines réellement servis sont listés dans `SITE_URLS` (sans quoi le correctif 7 reste inopérant pendant la bascule), et il est documenté que `SITE_URL`/`SITE_URLS` décident désormais aussi **qui a le droit de modifier** |

| 10 | `backend/src/server.js` | `X-Content-Type-Options: nosniff` et `Referrer-Policy: strict-origin-when-cross-origin`, posés dans `poserEntetesCadre()` — seul passage obligé des **deux** sorties, les fichiers du site et les réponses de l'API, pour qu'un oubli d'un côté soit impossible. `Strict-Transport-Security` volontairement écarté : il se met en cache pour des mois et sa place est dans le Caddyfile, une fois le domaine définitif en service |
| 11 | `backend/src/index.js` | `/api/version` annonce les **27** routes réellement branchées, contre 24 auparavant (`version`, `folkos` et `discord` manquaient). Un banc d'essai compare désormais la liste au routeur : ajouter une route sans l'annoncer fait échouer la série |

| 12 | `backend/src/index.js` + `marlowe-auth.js` | **Contrôle de version sur la matrice des accès.** `GET /api/permissions` rend désormais un `_meta.rev` ; `PUT` exige de renvoyer cette version dans `_rev`. Comparaison et écriture sont **dans le même verrou** — sinon deux requêtes peuvent lire le même numéro avant que l'une n'écrive. Version périmée ou absente → **409**, rien n'est écrit, et la réponse dit qui a enregistré et quand. Côté panel : **aucune fusion, aucun écrasement**, les cases restent exactement comme la personne les a laissées, un message nomme l'autrice du conflit, et charger la version actuelle est proposé — jamais imposé. L'ordre des deux appels a été inversé (matrice puis réglages) : dans l'autre sens, un conflit laissait les réglages déjà écrits |

| 13 | `backend/src/index.js` | **L'identité devient l'identifiant Discord.** `/api/absence` et `/api/linterna` rattachaient par le nom affiché — donc par le pseudo, que chacun choisit. `ficheParDiscord()`/`liaisonFiche()`/`indexDeMaLigne()` s'appuient désormais sur `s.user.id` ; le pseudo ne sert plus qu'à l'affichage, et le nom retenu vient de la **fiche** quand elle est rattachée. **Migration** : une ligne d'avant ce correctif (sans identifiant) n'est reprise que si son nom est celui de la FICHE, et seulement quand la fiche porte l'identifiant — jamais sur la foi d'un pseudo. **Aucun rattachement automatique** : une fiche homonyme est *signalée* (`liaison.candidats`, avec `etat` = `absente`/`a_confirmer`/`ambigue`), à charge des RH d'inscrire l'identifiant |
| 14 | `backend/src/index.js` | **Le contrôle de version de la matrice devient atomique EN BASE.** `casValeur()` fait la comparaison et l'écriture dans une seule instruction SQL (`UPDATE … WHERE val = ?`, `INSERT IGNORE`), donc arbitrée par MariaDB et non par une Map JavaScript. Voir §8 bis pour ce que chaque garantie couvre réellement |
| 15 | `backend/src/index.js` + `marlowe-auth.js` | **La matrice et ses pages en lecture seule voyagent dans le MÊME appel** (`_ro`), écrites dans l'ordre qui échoue du bon côté, et la réponse dit explicitement ce qui est passé (`enregistre`) et ce qui ne l'est pas (`echoue`). Le panel ne dit plus « Enregistré » sur une réponse qui liste un échec |
| 16 | `backend/src/index.js` | **Garde-fou anti-enfermement** : un enregistrement qui retirerait à son auteur l'accès à « Accès & rôles » est refusé (400 `enfermement`), sauf s'il est patron ou propriétaire — eux tiennent leurs droits de Discord et du `.env`, que la matrice ne peut pas leur ôter |

| 17 | `marlowe-actions.js` | **La clôture affiche la période réelle** (décision A). `closingPeriod()` rend « de la clôture précédente à maintenant » au lieu d'une semaine théorique ; l'étiquette devient « Clôture du JJ/MM/AAAA ». **Aucun compteur recalculé, aucun montant archivé modifié**, et un début inconnu reste vide plutôt qu'inventé (« jusqu'au … ») |
| 18 | `marlowe-actions.js` | **« Quota en direct » respecte les exemptions** (décision B). `qdQuotaDe()` passe par `quotaDeLaFiche()` ; les deux compteurs agrégés suivent, un exempté sortant des **deux** côtés de la fraction |
| 19 | `backend/deploy/docker-compose.yml` + `backend/README.md` | **La contrainte « une seule instance, un seul processus » est écrite là où on risque de la violer** : en tête du compose (pas de `--scale`, pas de `replicas`) et dans la procédure de déploiement (pas de `pm2 -i`), avec le tableau de ce qui est protégé entre processus et ce qui ne l'est pas |

**Aucun test, aucune validation, aucune protection n'a été désactivé.** Aucune
dépendance modifiée. Le design et les écrans sont inchangés.

> **Changement de contrat à connaître.** `PUT /api/permissions` **exige**
> maintenant `_rev`. Tout client qui écrivait la matrice sans ce champ reçoit
> 409 sans que rien ne soit écrit — c'est voulu, c'est ce qui protège le
> travail de l'autre. Le panel est mis à jour dans le même déploiement ; seul
> un onglet resté ouvert **avant** la mise à jour se fera refuser, et il lui
> suffit de recharger. `backend/test-admin.mjs` a dû être mis en conformité :
> il écrivait sans version, et c'est bien lui qui a signalé le changement.

---

## 6 bis. Ce que la relecture indépendante a trouvé dans MES corrections

Un septième agent a relu mes correctifs sans connaître mon raisonnement. Il a
trouvé **quatre défauts réels dans mon propre travail**, tous corrigés avant
remise. C'est signalé ici parce que ça mesure la fiabilité du reste — et parce
que le premier audit avait vécu exactement la même chose.

1. **Mon correctif du filtre de fichiers était sensible à la casse — pas le
   système de fichiers.** `/BACKEND/src/index.js` traversait `cheminStatique`
   et, sous Windows ou macOS, ouvrait le vrai fichier. Vérifié : la porte
   était rouverte pour la **troisième** fois. Corrigé en minusculant les deux
   côtés de la comparaison — *les deux*, car `/Claude outputs` porte lui-même
   une majuscule : ne minusculer que le chemin aurait désactivé ce préfixe en
   croyant renforcer le filtre.
2. **Mon verrou sur `invite-login` ne réglait que la suppression.** Je relisais
   bien la liste dans le verrou, mais je bâtissais ensuite la session sur la
   version **lue avant** PBKDF2. Deux autres actions se jouent dans cette
   fenêtre de 100 ms : `pages` (réduction des droits) et `mdp` (rotation du mot
   de passe). Une réduction de droits était donc ignorée, et un mot de passe
   qu'on venait de changer ouvrait encore. Corrigé : la session vient de la
   version fraîche, et la connexion est refusée si l'empreinte a bougé depuis
   qu'on l'a vérifiée.
3. **J'avais manqué la troisième porte de service.** `/api/presence` livre
   l'identifiant Discord, le nom et la page ouverte de tout le personnel
   connecté, à toute session valable. Exactement la même classe que
   `/api/journal`, que je venais pourtant de fermer.
4. **Mon contrôle d'origine pouvait bloquer TOUTES les écritures** derrière un
   proxy qui ne transmet pas `X-Forwarded-Proto` : `server.js` retombe alors
   sur `http://`, le navigateur annonce `https://`, et la comparaison des
   origines entières refusait tout. Panne totale, pour un en-tête manquant
   dans une configuration de proxy — et le document remis au responsable
   mentionne justement un montage nginx. Corrigé : la comparaison porte sur
   l'**hôte**, qu'une page tierce ne peut pas davantage falsifier.

Deux points mineurs signalés et corrigés aussi : un 403 `origine_refusee`
s'affichait « vous êtes en lecture seule sur cette page » (message trompeur
pour un défaut que je venais d'introduire), et `backend/README.md` documentait
encore `GET /api/logout`.

**Et mes propres bancs d'essai étaient en défaut** : la campagne de mutation
(ci-dessous) a montré que deux vérifications étaient **creuses** — celle sur
`/api/presence` passait même filtre retiré, parce que la fausse base rendait
une liste vide de toute façon ; celle sur le proxy en `http` passait même en
comparant les origines entières, parce que la liste blanche rattrapait le cas.
Les deux ont été réparées.

---

## 7. Commandes exécutées et résultats réels

| Commande | Résultat |
|---|---|
| `git status`, `git log`, `git diff` des 3 vagues | copie de travail propre au départ, périmètre établi |
| `node --check` sur les 25 fichiers `.js`/`.mjs` suivis | **tous valides**, avant et après |
| Les 11 bancs d'essai de `backend/`, **avant** corrections | **348 vérifications, 0 échec** (référence) |
| Les 5 bancs de la racine | **205 vérifications, 0 échec** |
| Les 12 bancs de `backend/`, **après** corrections | **489 vérifications, 0 échec** sans base ; **520 avec une vraie MariaDB** (§7 quater). Avec la racine (234, dont le nouveau `test-cloture-quota.mjs`) : **754 vérifications** |
| `npm install --omit=dev` | 15 paquets, sans erreur |
| Import réel de `backend/src/server.js` | s'arrête **uniquement** sur l'absence de base — le nouvel import `chemins.js` se résout bien, et cela confirme au passage le défaut N3 |
| Reproduction isolée : `request.json()` sur un corps `text/plain` | **parsé comme du JSON** → la prémisse du code est fausse (§4.1) |
| Reproduction isolée du filtre statique, 14 adresses tordues | **5 fuites avant** (`//backend/src/index.js`, `/%2Fbackend%2Fsrc%2Findex.js`, `///backend/package.json`, et 2 variantes antislash) → **0 après**, 11 adresses légitimes toujours servies |
| **Campagne de mutation** : 23 défauts corrigés réintroduits un par un dans le code, bancs d'essai relancés à chaque fois, fichiers restaurés à l'octet près | **22 détectés sur 23** (voir ci-dessous et §7 bis) |
| `docker run mariadb:10.11` puis `test-mariadb.mjs` | **31 vérifications, 0 échec** contre une vraie MariaDB jetable (§7 quater) |

### Banc d'essai ajouté — `backend/test-passage2.mjs`, 141 vérifications

Il couvre les correctifs de code : filtre de fichiers statiques (23 adresses
refusées dont les variantes de casse, 10 servies dont un nom accentué),
contrôle d'origine (11 cas, dont le refus réel par le routeur avec le corps
qu'un formulaire sait produire et le cas du proxy sans `X-Forwarded-Proto`),
`/api/quota`, `/api/journal`, `/api/presence`, la course entre révocation et
connexion, la fraîcheur des droits délivrés, la rotation du mot de passe
pendant la vérification, le double-clic sur « créer », la déconnexion et
l'adresse de retour.

**Ce banc d'essai a été éprouvé sur lui-même**, et c'est ce qui a révélé que
deux de ses vérifications étaient creuses (voir §6 bis). Résultat final :

```
✓ filtre statique : on retire la normalisation         → 6 en échec
✓ filtre statique : on redevient sensible à la casse   → 7 en échec
✓ contrôle d'origine : on laisse tout passer           → 6 en échec
✓ contrôle d'origine : on recompare les origines       → 1 en échec
✓ /api/quota : on redonne le numéro civil              → 1 en échec
✓ /api/journal : on retire le filtre                   → 2 en échec
✓ /api/presence : on redonne la liste aux tiers        → 2 en échec
✓ invite-login : on réécrit la liste lue AVANT         → 2 en échec
✓ invite-login : on ne revérifie plus les droits       → 1 en échec
✓ invite-login : mot de passe tourné non détecté       → 1 en échec
✓ logout : on réaccepte le GET                         → 2 en échec
✓ retour de connexion : SITE_URL en dur                → 1 en échec
✓ permissions : on retire le contrôle de version       → 8 en échec
✓ permissions : échange atomique → écriture simple     → 2 en échec
✓ permissions : on retire le garde-fou anti-enfermement→ 5 en échec
✓ permissions : on élargit malgré l'échec du RO        → 3 en échec
✓ identité : retour au rattachement par PSEUDO         → 6 en échec
✓ identité : on retrouve sa ligne par le NOM           → 2 en échec
✗ invite-login : session bâtie sur la liste périmée    → non détectée
18 mutation(s) détectée(s), 1 passée(s) inaperçue(s).
```

Et sur les deux décisions métier (`test-cloture-quota.mjs`, 29 vérifications) :

```
✓ quota : on ignore de nouveau la fiche (grade seul)   → 7 en échec
✓ clôture : retour à la semaine théorique lundi→dimanche → échoue
✓ clôture : on invente une date quand le début manque  → 1 en échec
✓ affichage : un début inconnu redevient « undefined » → 3 en échec
4 détectée(s), 0 inaperçue(s).
```

```
```

---

## 7 bis. La mutation qui n'a pas été détectée

Une mutation sur quinze survit au banc d'essai. Elle mérite une explication
complète, parce qu'une mutation qui survit veut dire l'une de deux choses : ou
bien il manque un test, ou bien le code muté fait rigoureusement la même chose.
Ici, c'est la seconde — et la démonstration compte plus que la conclusion.

**Ce que la mutation change.** Dans `handleInviteLogin`, l'objet de session est
bâti à partir de `frais` — la version de l'accès **relue dans le verrou**,
après la vérification du mot de passe. La mutation le rebâtit à partir de
`inv`, la version lue **avant** cette vérification, donc vieille d'une centaine
de millisecondes :

```js
invite: true, code: frais.code, id: 'inv:' + frais.code, name: frais.nom
                ↓ muté en ↓
invite: true, code: inv.code,   id: 'inv:' + inv.code,   name: inv.nom
```

**Ce que ça pourrait coûter.** Si le code ou le nom d'un accès pouvaient
changer pendant ces 100 ms, la session délivrée porterait une valeur périmée :
un nom d'affichage dépassé dans le journal des actions, et — bien plus grave —
un `id` de session (`'inv:' + code`) pointant vers un accès qui n'est plus
celui qu'on vient d'authentifier.

**Pourquoi elle survit.** Parce que ces deux champs ne changent **jamais**.
`/api/invites` n'expose que cinq actions — `creer`, `supprimer`, `basculer`,
`pages`, `mdp` — et aucune ne touche au nom ni au code : `creer` ajoute une
entrée, `supprimer` la retire, `basculer` bascule `actif`, `pages` réécrit
`pages`/`ro`, `mdp` réécrit `sel`/`hash`. Le code et le nom sont fixés à la
création et immuables ensuite. Les deux versions du code sont donc
**observationnellement équivalentes** : aucun test ne peut les distinguer, et
en écrire un qui « échoue » demanderait de simuler une action qui n'existe pas.

**Ce n'est donc pas un manque de couverture — mais c'est une hypothèse tacite,
et j'ai ajouté un test pour la garder.** Les champs qui *peuvent* changer dans
cette fenêtre (`pages`, `ro`, `sel`, `hash`) sont, eux, bien couverts : deux
vérifications échouent si on les lit sur la version périmée. Restait
l'immuabilité du code et du nom, sur laquelle repose toute l'équivalence. Le
banc d'essai la vérifie désormais explicitement : après `pages`, `mdp` et
`basculer`, le code et le nom doivent être inchangés, et la liste des actions
de la route est comparée à celle attendue. **Le jour où quelqu'un ajoute une
action « renommer », ce test échoue** et renvoie le lecteur à
`handleInviteLogin` — au lieu de laisser apparaître en silence un bug que la
campagne de mutation d'aujourd'hui ne saurait déjà plus voir.

Le code garde `frais` : c'est la version juste, même quand les deux se valent.

C'est ce qui manquait aux bancs d'essai existants, et c'est **la raison pour
laquelle E2 a pu se rouvrir sans que rien ne le signale**.

### Une remarque qui compte sur les bancs d'essai existants

Les 348 vérifications passaient **avant comme après** la migration vers le
cookie. Ce n'est pas une bonne nouvelle : elles s'authentifient presque toutes
par `Authorization: Bearer`, la **voie de repli**. Seul `test-folkos.mjs`
exerce le cookie. Autrement dit, l'architecture réellement déployée depuis
`432b0c1` n'était quasiment pas couverte — ce qui explique qu'aucune des trois
régressions du §4 n'ait été vue.

---

## 7 ter. Ce que chaque protection garantit exactement

Trois mécanismes se superposent maintenant sur les écritures concurrentes, et
il est important de ne pas leur prêter plus qu'ils ne tiennent.

| Mécanisme | Portée réelle | Ce qu'il NE couvre pas |
|---|---|---|
| **`verrou(nom)`** — file d'attente en mémoire | **Un seul processus.** C'est une `Map` JavaScript : deux conteneurs, ou deux `node src/server.js` sur la même base, ont chacun la leur et s'ignorent | Toute duplication de l'API. Il donne alors une impression de protection **sans en offrir** — c'est le piège que ce passage a levé |
| **`casValeur()`** — échange atomique en base | **Toutes les instances.** Comparaison et écriture dans une seule instruction SQL, arbitrée par MariaDB. Deux requêtes parties du même état ne peuvent pas gagner toutes les deux | Ne protège que la clé sur laquelle elle porte (`permsmeta`). Elle n'étend rien aux autres documents |
| **`batch()`** — transaction | **Tout ou rien**, sur les instructions qu'on lui donne (`beginTransaction`/`commit`/`rollback`, vérifié dans `db.js`) | N'est pas utilisée par la matrice : celle-ci écrit **deux documents** distincts, dont `settings`, qui porte bien d'autres réglages à relire et préserver |

**Ce qui est donc garanti aujourd'hui pour la matrice des accès**, quel que
soit le nombre d'instances : deux enregistrements partis de la même version ne
peuvent pas se recouvrir — le second est refusé en 409 sans rien écraser.

**Ce qui ne l'est pas, et qu'il faut savoir** : entre la prise du tour
d'écriture (`casValeur` sur `permsmeta`) et l'écriture des deux documents, il
reste une fenêtre. Un arrêt brutal du processus pile dans cet intervalle
laisserait le numéro de version en avance d'un cran sur la matrice. Conséquence
concrète : le prochain enregistrement de chacun est refusé **une fois**, le
panel propose de recharger, et tout repart. **Aucune donnée n'est perdue ni
écrasée** — c'est l'état « en avance », pas l'état « à moitié écrasé », et
c'est le bon côté sur lequel se tromper. Fermer complètement cette fenêtre
demanderait de ranger la matrice, sa lecture seule et son numéro de version
dans **un seul document** : un changement de forme de stockage, à faire
posément, pas dans un correctif d'audit.

Les autres documents (`data`, `journal`, `settings`, `invites`, `alias`) restent
protégés par `verrou()` **seul** — donc par processus. C'est suffisant pour le
montage prévu, qui n'en lance qu'un (`docker-compose.yml`), et c'était déjà le
constat R1 du premier audit. **Si l'API venait à tourner en plusieurs
exemplaires, ces documents-là redeviendraient vulnérables au défaut E4** ; il
faudrait leur appliquer le même traitement qu'à la matrice. C'est le point le
plus important à retenir de cette section.

---

## 7 quater. Vérification contre une vraie MariaDB

C'était le dernier blocage technique du rapport. Il est levé.

**Comment** : Docker Desktop démarré (avec votre accord), MariaDB 10.11 dans un
conteneur jetable — port 13306 pour ne rien croiser, base `marlowe_test`,
`--rm` pour qu'il disparaisse de lui-même. Aucun contact avec la base du VPS.
Conteneur arrêté et supprimé après coup, aucun volume laissé derrière.

```bash
docker run -d --rm --name mv-audit-db \
  -e MARIADB_ROOT_PASSWORD=<jetable> -e MARIADB_DATABASE=marlowe_test \
  -e MARIADB_USER=marlowe -e MARIADB_PASSWORD=<jetable> \
  -p 13306:3306 mariadb:10.11

cd backend && DB_HOST=127.0.0.1 DB_PORT=13306 DB_USER=marlowe \
  DB_PASSWORD=<jetable> DB_NAME=marlowe_test node test-mariadb.mjs
```

**Résultat : 31 vérifications, 0 échec.** Toute la suite backend lancée avec la
vraie base derrière : **520 vérifications, 0 échec** (489 sans base, le banc
MariaDB s'ignorant alors proprement — vérifié aussi, code de sortie 0).

### Ce que cette exécution a réellement apporté

Le banc existant (22 vérifications) ne couvrait pas `casValeur()`, écrit dans ce
passage : c'est exactement le point que je signalais comme **non prouvé**,
puisque `affectedRows` est une valeur rendue par le pilote, qu'une fausse base
ne peut qu'imiter. J'ai donc ajouté 9 vérifications, et elles ont trouvé
quelque chose qui méritait d'être su :

| Cas | MariaDB réelle |
|---|---|
| `INSERT IGNORE`, clé absente | `affectedRows = 1` → l'échange réussit |
| `INSERT IGNORE`, clé déjà là | `affectedRows = 0` → refusé, comme voulu |
| `UPDATE … WHERE val = <courante>` | `affectedRows = 1` |
| `UPDATE … WHERE val = <périmée>` | `affectedRows = 0` → refusé |
| **`UPDATE` vers une valeur IDENTIQUE** | **`affectedRows = 1`, mais `changedRows = 0`** |

La dernière ligne est le piège. `casValeur()` s'appuie sur `affectedRows` — le
bon des deux compteurs : ce qui compte est que la ligne ait été **trouvée dans
l'état attendu**, pas qu'elle ait changé de contenu. Avec `changedRows`, un
échange parfaitement légitime aurait été rendu comme perdu, et la matrice aurait
répondu 409 sans raison. Le code était juste ; il l'est maintenant **pour une
raison vérifiée**, et le banc d'essai fige ce comportement.

Deux échanges lancés en parallèle depuis le même état ont également été
éprouvés contre le vrai moteur : **un seul gagne**, et la base porte la valeur
du gagnant, pas un mélange. C'est la garantie qui survit à plusieurs instances
du backend — celle que `verrou()` ne pouvait pas donner.

**Aucun échec, donc aucune correction à apporter** au titre de cette étape.

---

## 8. Ce qui n'a **pas** pu être vérifié

| Non vérifié | Pourquoi | Risque résiduel |
|---|---|---|
| ~~`test-mariadb.mjs` contre une vraie base~~ | **LEVÉ** — Docker démarré avec votre accord, MariaDB 10.11 jetable sur le port 13306, base `marlowe_test`, conteneur supprimé après coup. **31 vérifications, 0 échec** (voir §7 quater) | — |
| Le tour complet dans un vrai navigateur (Discord → cookie → appels suivants) | Demande les identifiants Discord et un domaine servi en HTTPS | **C'est le point à vérifier en premier après déploiement** |
| **Le panel dans l'iframe de l'ordinateur en jeu** | Demande un serveur FiveM | **Le plus important.** Voir l'avertissement ci-dessous |
| Le SSO FolkOS de bout en bout | Ni adresse ni secrets | Inchangé par ce passage |
| `marlowe-actions.js` ligne à ligne (10 000+ lignes) | Trop volumineux | Un défaut logique dans une branche non visitée peut subsister |
| Volumétrie réelle | Base de production non touchée, à dessein | — |

> ### ⚠️ À vérifier absolument avant de considérer le déploiement comme réussi
>
> Le contrôle d'origine (§6-1) refuse une requête modifiante dont l'`Origin`
> est inconnu, **`null` compris**. C'est voulu : une iframe en bac à sable
> envoie exactement `Origin: null`, et c'est un vecteur d'attaque réel.
>
> Le panel affiché dans l'ordinateur en jeu est servi **depuis notre propre
> domaine**, donc ses requêtes portent normalement notre origine et passent.
> La relecture indépendante a confirmé le raisonnement : `marlowe-folkos.js`
> décrit la chaîne `nui://game → cfx-nui-external-iframe → hôte FolkOS → nous`,
> et **encadrer une page https ne change pas son origine**. Aucune trace de
> `sandbox` nulle part dans le dépôt.
>
> Le seul montage qui casserait est que FolkOS encadre le panel avec
> `sandbox` **sans** `allow-same-origin` : l'origine deviendrait alors `null`.
> C'est une question à poser à l'opérateur, pas une régression démontrée — mais
> je n'ai **pas pu l'essayer**.
>
> **Essai à faire en jeu : se connecter, puis enregistrer une modification.**
> Ne pas se contenter d'ouvrir la page : c'est l'écriture qui est contrôlée,
> pas la lecture. La procédure complète, avec les résultats attendus et les
> messages à relever, est en **Annexe B** à la fin de ce rapport.
> Si un 403 `origine_refusee` apparaît, la correction tient en une ligne —
> autoriser explicitement cette origine-là dans `exigerOrigine`, et elle seule.
> **En aucun cas désactiver le contrôle.**

---

## 9. Étapes concrètes avant de déployer

Dans cet ordre.

1. **Relire le diff** : `git diff main..audit-passage-2`. Neuf corrections
   ciblées, chacune commentée avec ce qui n'allait pas.
2. **Lancer les bancs d'essai** depuis `backend/` :
   `for t in test-*.mjs; do node "$t"; done` — attendu : 489 vérifications,
   aucun échec.
3. **Lancer `test-mariadb.mjs` contre une base de TEST** (jamais la
   production, il efface les tables) — la commande exacte est au §7 quater.
   Attendu : 31 vérifications, 0 échec.
4. **Sauvegarder la base de production.**
5. **Reconstruire l'image Docker** — et non la redémarrer :
   `docker compose up -d --build`. `docker compose restart` **ne relit pas**
   le `.env` ni le code.
6. **Mettre `SITE_URLS` à jour dans le `.env` du serveur** avec les **deux**
   domaines servis par Caddy, tant que la bascule n'est pas faite. Sans cela,
   une connexion arrivée par l'autre domaine laisse son cookie derrière elle.
7. **Vérifier immédiatement six choses** :
   - `…/api/version` répond ;
   - `…/api/me` répond `{"error":"unauthorized"}` ;
   - `…/backend%2fsrc%2findex.js` → **404** ;
   - `…//backend/src/index.js` → **404** ← *celle que ce passage a trouvée* ;
   - `…/BACKEND/src/index.js` → **404** ← *celle que la relecture a trouvée* ;
   - `curl -sI …/gestion.html | grep -i "nosniff\|referrer"` → les deux
     en-têtes doivent apparaître (ils ne sont pas couverts par un banc
     d'essai : ils vivent dans `server.js`, qui ouvre la base au chargement
     et ne peut donc pas être importé) ;
8. **Se connecter au panel, changer de page, enregistrer une modification.**
9. **Faire l'essai depuis l'ordinateur en jeu** — procédure complète en
   **Annexe B**. C'est le seul point que je n'ai pas pu vérifier.
10. **Ouvrir « Accès & rôles » et enregistrer une fois.** Le contrôle de
    version est neuf (§6-12) : un onglet resté ouvert **avant** le déploiement
    recevra un message « la matrice a été enregistrée par … » et proposera de
    recharger — c'est le comportement attendu, pas une panne.
11. **Compléter le champ « Discord » des fiches du registre.** C'est lui, et
    lui seul, qui rattache désormais une personne à sa fiche (§6-13). Une fiche
    sans identifiant continue de fonctionner — la personne déclare son absence
    et sa récolte normalement —, mais **sa fiche n'est plus mise à jour**, et
    le serveur le signale dans sa réponse. Le panel affiche déjà ce champ sur
    la fiche employé, et c'est la même information que réclame la connexion
    FolkOS. Commencez par les personnes qui déclarent le plus souvent.
12. **Vérifier les deux écrans qui changent d'affichage** (décisions tranchées,
    voir « Les deux décisions métier — tranchées ») : la première clôture se
    lira « jusqu'au … » faute de début connu, et la tuile « X / Y ont atteint
    leur quota » va bouger si des employés sont exemptés. **C'est attendu.**
12. **Changer les secrets qui ont pu partir dans une image Docker** construite
    avant ce correctif (`.dockerignore`). Si une image a été poussée dans un
    registre ou partagée, considérer `DISCORD_CLIENT_SECRET`,
    `DISCORD_BOT_TOKEN`, `STORAGE_TOKEN` et `DB_PASSWORD` comme exposés.

---

## 10. Bilan

Le premier audit avait bien travaillé : sur ses treize corrections, **dix
tiennent** et résistent à un examen adverse. Les trois autres n'étaient pas
fausses — elles étaient **incomplètes**, et chacune pour la même raison : elles
ont fermé le chemin par lequel le défaut avait été trouvé, sans chercher les
autres. Le filtre de fichiers a été réparé pour `%2f` mais pas pour `//` ; le
filtre de lecture pour `/api/data` mais pas pour `/api/quota` ni
`/api/journal` ; le README au §1.3 mais pas au §4.

Le vrai sujet de ce passage est ailleurs : **la migration vers le cookie
httpOnly**. L'intention est bonne et le raisonnement sur `SameSite=None` est
juste — le panel vit dans une iframe, `Lax` l'aurait cassé en silence. Mais le
commit s'est arrêté à mi-chemin : en retirant le jeton de `localStorage`, il a
supprimé le seul rempart qui restait contre le CSRF, en s'appuyant sur une
affirmation fausse écrite dans le code lui-même. Et en rendant la session
invisible au JavaScript, il a laissé le panel sans moyen de savoir qu'il était
déconnecté — d'où une boucle d'enregistrement qui tournait indéfiniment en
faisant perdre le travail.

Ces deux-là sont corrigés et surveillés par des tests dont j'ai vérifié qu'ils
échouent quand le bug revient.

Trois choses à retenir pour la suite.

D'abord, **les bancs d'essai s'authentifient par la voie de repli** : ils
passaient à l'identique avant et après un changement complet d'architecture
d'authentification. Un test qui ne peut pas échouer ne protège rien — c'est
précisément ce qui a permis à E2 de se rouvrir, deux fois.

Ensuite, et c'est le plus inconfortable à écrire : **mes propres corrections
comportaient quatre défauts**, trouvés par une relecture indépendante (§6 bis),
dont un qui aurait bloqué toutes les écritures du panel derrière un proxy mal
réglé. Et la campagne de mutation a montré que **deux de mes tests étaient
creux** — ils passaient même une fois le correctif retiré. Un audit qui ne se
vérifie pas lui-même produit exactement le genre de correctif incomplet qu'il
est censé traquer : c'est ce qui est arrivé au premier passage, et ça a failli
arriver à celui-ci.

Enfin, le point qui reste ouvert n'est pas un bug mais une **absence de
preuve** : le panel en jeu n'a pas pu être essayé, et c'est justement lui que
le contrôle d'origine pourrait gêner. L'analyse dit qu'il passera ; l'essai est
court et décrit au §8 ; il doit quand même être fait.

Enfin, `.dockerignore`. Le dépôt tient ses secrets hors de Git avec soin — et
les recopiait dans chaque image Docker construite. C'est le genre de fuite qui
ne se voit jamais depuis le dépôt, parce qu'elle n'y est pas.

**Aucune anomalie supplémentaire n'a été détectée dans le périmètre
effectivement vérifié** — ce qui ne veut pas dire qu'il n'y en a plus, et ne
dit rien des trois zones listées au §8.

---

# Annexe A — Les trois points qui demandent votre décision

Rien de ce qui suit n'a été modifié. Deux de ces points sont des **choix de
règle métier** : il n'y a pas de « bonne » réponse technique, seulement la
vôtre. Le troisième est un **défaut de sécurité**, et il se distingue des deux
autres sur un point : il n'attend pas votre accord pour être exploitable.

---

## A.1 — ~~La clôture compte une période qui n'est pas celle annoncée~~
### 🔧 Décision métier — **TRANCHÉE le 11/09/2026, corrigée**

> Voir « Les deux décisions métier — tranchées », décision A, pour ce qui a
> été fait et ce qui a délibérément été laissé intact. Le constat ci-dessous
> décrit l'état d'avant.

**Ce qui se passe, en clair.** Chaque semaine, la clôture met de côté la
production de tout le monde, la range dans l'historique sous une étiquette
(« Semaine 37, du 08/09 au 14/09 »), puis remet les compteurs à zéro. Le
problème : l'étiquette dit une chose, les chiffres en disent une autre. Les
compteurs ne connaissent pas les dates — ils comptent simplement **depuis la
dernière remise à zéro**. Si la clôture n'est pas lancée pile le lundi, les
deux ne coïncident plus.

**Un scénario concret.** La clôture de la semaine dernière a été faite le lundi,
tout va bien. Cette semaine, personne n'y pense le lundi ; elle est lancée le
**mercredi soir**. Marie a produit 100 vins du lundi au dimanche de la semaine
passée, puis 20 de plus lundi et mardi. La clôture archive **120 vins** sous
l'étiquette « semaine dernière, du lundi au dimanche » — alors que 20 de ces
vins ont été produits cette semaine-ci. Et comme les compteurs repartent de
zéro, Marie commence la semaine en cours avec **0 vin** au lieu de 20.

**Impact.** Marie est créditée d'une semaine passée trop généreuse (elle peut y
décrocher une éligibilité à la prime qu'elle n'avait pas méritée) et démarre la
semaine en cours avec un retard qu'elle n'a pas. Les chiffres de l'historique
ne sont pas faux au hasard : ils sont décalés d'autant de jours que la clôture
a de retard. **Rien à l'écran ne le signale.**

**Ce que le correctif précédent a fait — et n'a pas fait.** Le commit `94d5483`
a corrigé le calcul de l'**étiquette** pour qu'elle tombe sur un vrai lundi.
Les chiffres, eux, n'ont jamais été bornés par des dates.

**Ma recommandation.** Deux voies, et il faut choisir :

- **La voie simple, que je recommande** : assumer que la période est « depuis
  la dernière clôture » et le **dire** — l'étiquette afficherait les vraies
  dates (« du 08/09 au 10/09 ») au lieu d'une semaine théorique. Aucun risque,
  aucune donnée à reconstruire, et l'historique devient honnête. Le vrai remède
  au décalage reste de clôturer le lundi.
- **La voie exacte** : borner réellement chaque compteur entre lundi et
  dimanche. C'est le comportement que l'étiquette promet aujourd'hui, mais
  cela demande de conserver la production **jour par jour**, ce que
  l'application ne fait pas : aujourd'hui `barils` est un simple total qui
  monte. C'est un vrai chantier, pas un correctif.

---

## A.2 — ~~Un employé exempté apparaît quand même avec un quota~~
### 🔧 Décision métier — **TRANCHÉE le 11/09/2026, corrigée**

> Voir « Les deux décisions métier — tranchées », décision B, pour l'effet
> précis sur les deux compteurs agrégés. Le constat ci-dessous décrit l'état
> d'avant.

**Ce qui se passe, en clair.** Vous pouvez exempter quelqu'un de quota en
mettant sa valeur individuelle à 0 — un saisonnier, une personne en reprise,
un poste sans production. Deux écrans lisent cette information de deux façons
différentes : la page **Primes** respecte l'exemption, la page **Quota en
direct** l'ignore et affiche le quota de son grade.

**Un scénario concret.** Vous exemptez Paul (fiche : quota 0). Sur la page
Primes, Paul est « à jour », sa prime est versée. Sur Quota en direct, la même
personne affiche « 110 · 56 restants » — comme si elle était en retard. Deux
écrans, deux vérités, aucune indication de laquelle croire.

**Impact.** De la confusion, et un risque de décision injuste : un responsable
qui pilote depuis Quota en direct peut relancer, sanctionner ou écarter d'une
prime quelqu'un que vous aviez explicitement exempté. Aucune donnée n'est
corrompue — c'est un affichage —, mais c'est un affichage sur lequel on prend
des décisions concernant des gens.

**Ma recommandation.** **Corriger, et je pense que c'est sans ambiguïté** : le
commit `94d5483` a déjà tranché dans ce sens (« un quota individuel
explicitement mis à 0 n'est plus ignoré au profit du quota du grade »), il
n'est simplement pas allé jusqu'à cet écran. Le correctif tient en une ligne.

**Pourquoi je ne l'ai pas fait sans vous demander** : Quota en direct ne sert
pas qu'à afficher des lignes, il calcule aussi deux statistiques agrégées
(« combien ont atteint leur quota », « combien en ont un »). Les corriger
**change des chiffres de pilotage** — en mieux, à mon sens, puisque les
exemptés cesseraient d'être comptés comme en retard. Mais ce sont vos chiffres.

---

## A.3 — ~~On peut écrire à la place d'un collègue en changeant son pseudo~~
### 🔒 Défaut de sécurité — **CORRIGÉ**, plus en attente de décision

> **Ce point est réglé** (§6-13). Il figurait ici comme « décision métier
> en attente » ; à l'examen, ce n'en était pas une — c'était un défaut de
> sécurité exploitable, et un défaut de sécurité ne s'arbitre pas, il se
> corrige. L'explication ci-dessous est conservée parce qu'elle décrit ce qui
> était possible, et parce que la mesure Discord recommandée au point 1 reste
> une bonne hygiène.
>
> **Ce qui a changé** : l'identité est l'identifiant Discord, immuable et
> attribué par Discord ; le pseudo ne sert plus qu'à l'affichage. Prendre le
> surnom de quelqu'un n'a plus aucun effet — vérifié par des tests qui font
> exactement ça (deux comptes au même pseudo, puis un changement de pseudo).
>
> **Ce qui reste à faire de votre côté** : le rattachement repose sur le champ
> `discord` des fiches du registre. Une fiche qui ne le porte pas n'est
> rattachée à personne — la personne peut toujours déclarer son absence ou sa
> récolte, mais **sa fiche n'est plus mise à jour**. Le serveur le signale
> dans sa réponse (`liaison`), en nommant la ou les fiches qui *pourraient*
> correspondre, sans jamais choisir à votre place. **À faire : compléter le
> champ Discord des fiches existantes.** C'est la même information que
> réclame déjà la connexion FolkOS.

**Ce qui se passe, en clair.** L'application reconnaît les gens par leur **nom
affiché sur Discord**, pas par un identifiant stable. Deux routes écrivent des
données en se fiant à ce nom : la déclaration d'absence et la déclaration de
récolte (Linterna). Elles ne vérifient aucun droit particulier — l'idée étant
que chacun déclare pour soi.

**Un scénario concret.** Thomas change son surnom sur le Discord du domaine
pour « Marie Lambert », le nom d'une collègue. Il attend moins d'une minute
(le temps que le serveur rafraîchisse sa fiche), puis déclare une absence. Le
serveur écrit l'absence **sur la ligne de Marie**, et passe sa fiche du
registre en « absent » avec le motif que Thomas a choisi. Sur `/api/linterna`,
le même tour avec le mode « total » **remet la récolte de Marie à zéro**.

**Impact.** C'est le point le plus sérieux de cette annexe. La récolte
détermine une prime : la remettre à zéro coûte de l'argent à quelqu'un. Une
absence déclarée à tort peut avoir des conséquences disciplinaires. Et rien
n'est tracé du côté de l'auteur réel : le journal enregistre le **nom**, donc
il accusera Marie. Cela dit, l'attaque demande de pouvoir changer son surnom
sur votre Discord, elle est visible de qui regarde la liste des membres, et
elle laisse une trace dans les journaux d'audit de Discord lui-même.

**Ma recommandation.** **Deux mesures, dans cet ordre.**

1. **Tout de suite, sans toucher au code** : vérifiez qui a le droit de changer
   son propre pseudo sur le serveur Discord. Si la permission « Changer de
   pseudo » est retirée aux rôles employés, l'attaque devient impossible sans
   passer par un modérateur. C'est gratuit et immédiat.
2. **Ensuite, la vraie correction** : rattacher les gens par leur **numéro
   civil** plutôt que par leur nom. C'est un changement qui traverse toute
   l'application (absences, récolte, quotas, alias), et qui ne s'improvise pas
   — d'où le fait que je ne l'aie pas fait. Le premier audit avait déjà soulevé
   la question (point R7) en la classant « règle métier ambiguë » ; ce
   deuxième passage montre qu'elle est **exploitable en écriture**, ce qui la
   fait changer de catégorie.

Tant que ni l'un ni l'autre n'est fait, le risque reste réel — c'est la
différence avec les deux points précédents, qui, eux, attendent sagement votre
décision.

---

# Annexe B — Procédure d'essai en jeu

À faire **après déploiement**, depuis l'ordinateur en jeu (FiveM), par une
personne qui a un compte du domaine. Compter dix minutes.

Ce que cette procédure cherche à savoir : la connexion fonctionne-t-elle dans
l'iframe du jeu, la session y survit-elle, et le nouveau contrôle anti-CSRF
laisse-t-il passer les écritures légitimes ? C'est le seul point que je n'ai
**pas pu vérifier** (§8).

> ⚠️ **Si un essai échoue, ne désactivez pas la protection pour continuer.**
> Ni `exigerOrigine`, ni le cookie, ni la CSP. Un échec ici est une
> information : notez-la (voir « Ce qu'il faut relever ») et arrêtez-vous là.
> Contourner la protection remettrait en place exactement la faille que ce
> passage a fermée — et le panel resterait utilisable depuis un navigateur
> ordinaire pendant ce temps.

### Avant de commencer
Ouvrez la console de l'ordinateur en jeu si votre installation le permet
(F8 / F12 selon la configuration FiveM). Sans console, la procédure reste
valable : ce sont les messages à l'écran qui comptent.

| # | Ce que vous faites | Résultat attendu | Si ça ne marche pas |
|---|---|---|---|
| **1** | Ouvrir l'ordinateur en jeu, aller sur le panel du domaine | La page s'affiche (fond, logo, écran de connexion). **Pas une iframe blanche** | Une iframe blanche = la CSP `frame-ancestors`. Relevez l'adresse exacte affichée |
| **2** | Cliquer « Se connecter avec Discord », aller au bout | Retour **dans le jeu**, sur le panel, connecté, votre nom affiché | Si vous revenez à l'écran de connexion : c'est le cookie. Notez le **domaine** affiché dans la barre d'adresse — s'il diffère de celui par lequel vous êtes entré, c'est `SITE_URLS` (§9-6) |
| **3** | Changer de page deux ou trois fois (Employés, Facturation, Tableau de bord) | Les pages s'affichent avec leurs données | Des pages vides = la session n'est pas transmise. C'est le même diagnostic qu'au point 2 |
| **4** | **L'essai décisif** : modifier quelque chose d'anodin et enregistrer — par exemple cocher puis décocher une case, ou corriger un mot dans un champ libre | La pastille en bas à droite passe à **« Enregistré »** | **C'est ici que le contrôle anti-CSRF se joue.** Voir ci-dessous |
| **5** | Recharger le panel depuis le jeu | Toujours connecté, la modification du point 4 est là | Si vous êtes déconnecté : le cookie ne survit pas au rechargement dans ce contexte |
| **6** | Se déconnecter par le bouton du panel | Retour à l'écran de connexion | La déconnexion est passée en POST ; un échec ici serait nouveau |
| **7** | Laisser le panel ouvert, revenir 15 minutes plus tard, enregistrer à nouveau | « Enregistré » | Un message « session expirée — rechargez la page » est un **comportement correct**, pas une panne |

### Ce qu'il faut relever, et pourquoi

**Le message qui compte par-dessus tout**, au point 4 :

> **« adresse du site non reconnue par le serveur — prévenez l'administrateur »**

Ce message signifie que le contrôle d'origine a refusé l'écriture (HTTP 403,
`origine_refusee`). C'est précisément le scénario que je n'ai pas pu écarter :
l'iframe du jeu enverrait une origine que le serveur ne reconnaît pas.

Si vous le voyez, **notez ces trois choses** :

1. **Le domaine affiché** dans la barre d'adresse du navigateur en jeu ;
2. **Ce que dit la console**, s'il y en a une : cherchez une ligne contenant
   `403` et `origine_refusee` ;
3. **L'en-tête `Origin` de la requête refusée**, si la console le montre
   (onglet Réseau → la requête `PUT /api/data` → en-têtes de la requête).

> ### ⚠️ Une origine observée n'est PAS une origine légitime
>
> C'est le point sur lequel il ne faut pas aller vite. L'`Origin` que vous
> relevez est simplement **ce que le navigateur a envoyé** — et le contrôle
> existe précisément parce qu'un site tiers peut, lui aussi, faire partir une
> requête vers notre domaine. Recopier la valeur observée dans la liste
> autorisée « parce que c'est celle qu'on voit » reviendrait à autoriser
> l'attaquant qui aurait provoqué l'essai.
>
> **Avant de proposer d'autoriser quoi que ce soit, il faut établir que cette
> origine est bien celle du déploiement attendu.** Trois vérifications, toutes
> nécessaires :
>
> 1. **L'origine correspond-elle à un composant que VOUS avez déployé ?**
>    Une origine en `https://…` doit être un domaine que vous contrôlez —
>    celui du site (`SITE_URL`), ou celui de l'hôte FolkOS de l'opérateur.
>    Si c'est un domaine que vous ne
>    reconnaissez pas, **c'est un signalement d'attaque, pas un réglage** :
>    n'autorisez rien et gardez la trace.
> 2. **L'essai a-t-il été reproduit dans des conditions propres ?** Refaites-le
>    depuis une session de jeu fraîche, sans autre onglet ni page ouverte, et
>    vérifiez que la même valeur revient. Une origine qui n'apparaît qu'une
>    fois n'est pas la vôtre.
> 3. **L'opérateur confirme-t-il ?** Pour `null` ou une origine en `nui://` /
>    `cfx-nui-…`, seule une réponse de l'opérateur FlashbackFA établit que
>    c'est bien ainsi que le panel est encadré en jeu. Demandez-lui comment
>    l'iframe est construite (attribut `sandbox` ? quelle adresse ?) plutôt
>    que de déduire la réponse d'un en-tête.
>
> **Cas particulier de `Origin: null`.** Ne l'autorisez pas, même confirmé :
> `null` n'identifie personne — toute page en bac à sable, d'où qu'elle
> vienne, envoie exactement la même valeur. L'autoriser rouvrirait le CSRF en
> grand pour tout le monde. Si l'iframe du jeu envoie `null`, la solution est
> de changer la façon dont elle est encadrée (obtenir `allow-same-origin`
> auprès de l'opérateur), pas d'ouvrir le contrôle.
>
> Une fois — et seulement une fois — ces trois points établis, l'ajout tient
> en une ligne dans `exigerOrigine` (`backend/src/index.js`) : autoriser cette
> origine précise, et elle seule. **Jamais de désactivation générale, jamais
> de joker.**

### Les autres erreurs à relever

| Ce que vous voyez | Ce que ça veut dire |
|---|---|
| « session expirée — rechargez la page » **au premier enregistrement** | Le cookie n'est pas reparti. Contexte iframe, pas anti-CSRF |
| « écriture refusée — vous êtes en lecture seule sur cette page » | Droits normaux, sans rapport avec ce passage |
| « La matrice des accès a été enregistrée par … » | Le nouveau contrôle de version fait son travail (§6-12). Ce n'est pas une erreur |
| Iframe blanche, sans message | CSP `frame-ancestors`. Relevez l'adresse depuis laquelle FolkOS encadre le panel |
| Le panel marche en jeu **mais pas** dans un navigateur ordinaire, ou l'inverse | Notez lequel des deux : la différence désigne le contexte fautif |

### Un contre-essai utile, à faire depuis un navigateur ordinaire
Ouvrez le panel **hors du jeu**, connectez-vous et enregistrez une
modification. Si cela fonctionne alors que l'essai en jeu échoue au point 4,
le diagnostic est établi sans ambiguïté : c'est bien le contexte iframe qui
pose problème, et rien d'autre.

---

# Annexe C — Votre checklist

Deux choses à faire avant la mise en production. Les décisions, elles, sont
prises.

## ☐ 1. Compléter les identifiants Discord des fiches

**Pourquoi** : c'est ce champ, et lui seul, qui rattache une personne à sa
fiche depuis le correctif §6-13. Sans lui, la personne déclare toujours son
absence et sa récolte — mais **sa fiche n'est plus mise à jour**, et elle ne
le voit pas forcément.

- ☐ Ouvrir **RH ▸ Employés**, et pour chaque fiche, renseigner le champ
  **Discord** (l'identifiant numérique, pas le pseudo : clic droit sur la
  personne dans Discord ▸ « Copier l'identifiant », mode développeur activé).
- ☐ Commencer par **les personnes qui déclarent le plus souvent** — celles qui
  posent des absences et déclarent la Linterna.
- ☐ Cas des **homonymes** : ne pas deviner. Le serveur signale les fiches
  candidates mais ne choisit jamais ; c'est à vous de trancher, fiche par
  fiche.
- ☐ Vérifier au passage qu'**une même fiche ne porte pas l'identifiant de
  quelqu'un d'autre** : c'est la seule erreur de saisie qui aurait des
  conséquences réelles.

*C'est la même information que réclame déjà la connexion FolkOS — les fiches
qui l'ont déjà n'ont rien à faire.*

## ☐ 2. Faire l'essai en jeu

La procédure détaillée est en **Annexe B**. En résumé :

- ☐ Ouvrir le panel dans l'ordinateur en jeu → la page s'affiche.
- ☐ Se connecter avec Discord → on revient **dans le jeu**, connecté.
- ☐ Changer de page deux ou trois fois → les données s'affichent.
- ☐ **Modifier quelque chose d'anodin et enregistrer** → « Enregistré ».
  ← *C'est l'étape qui compte : c'est l'écriture qui est contrôlée.*
- ☐ Se déconnecter par le bouton → retour à l'écran de connexion.

**Si le message « adresse du site non reconnue par le serveur » apparaît** :
relever le domaine, la ligne de console et l'en-tête `Origin`, puis lire
l'encadré de l'Annexe B — **une origine observée n'est pas une origine
légitime**, et `Origin: null` ne doit pas être autorisé. Ne rien désactiver.

## ☑ 3. Trancher les deux décisions métier

**Fait le 11/09/2026.** Les deux sont tranchées et appliquées — voir « Les
deux décisions métier — tranchées ». Il reste seulement à constater, au
premier affichage, que la clôture se lit « jusqu'au … » et que la tuile des
quotas a bougé : c'est attendu.

---

# Les deux décisions métier — tranchées

Vous avez tranché le 11 septembre 2026. Voici ce qui a été fait, et **ce qui
n'a délibérément pas été fait**.

## Décision A — la clôture affiche la période réelle

**Votre consigne** : afficher les dates réelles entre les clôtures, sans
recalculer les compteurs ni modifier les montants archivés ; ne pas inventer
de dates pour les anciennes archives si elles sont inconnues.

**Ce qui change.** `closingPeriod()` ne rend plus « lundi dernier → dimanche
dernier » mais la période réellement couverte : **de la clôture précédente à
maintenant**. L'étiquette d'une clôture devient « Clôture du 10/09/2026 » au
lieu de « Semaine 37 » — ce numéro de semaine était précisément la fiction que
les chiffres ne respectaient pas. La période exacte s'affiche à côté.

**Ce qui NE change pas — et c'est le cœur de votre consigne.** Aucun compteur
n'est recalculé : `eligibles`, `heures`, `production` et le bilan lisent
exactement les mêmes valeurs qu'avant. Aucun montant archivé n'est modifié.
Les archives déjà enregistrées gardent les dates qu'elles portent — les
réécrire aurait inventé un passé. Un banc d'essai surveille cette
promesse : il échoue si une borne de date entre un jour dans le calcul des
compteurs.

**Quand le début est inconnu** — première clôture, ou historique purgé — le
champ reste **vide** et l'affichage dit « jusqu'au 10/09/2026 ». Jamais de
date inventée, jamais de « undefined → … ». Le compte des recrues n'est alors
borné que par la fin, ce qui est exact.

**Ce que vous verrez.** La première clôture après déploiement n'aura pas de
début connu (aucune archive ne porte encore de date d'exécution exploitable
pour cette période) et se lira « jusqu'au … ». **À partir de la deuxième, les
périodes s'enchaînent sans trou.**

**Ce qui reste vrai** : le décalage entre étiquette et chiffres venait d'une
clôture faite en retard. L'affichage est maintenant honnête, mais **clôturer
le lundi reste le bon réflexe** — c'est ce qui garde les périodes régulières.

## Décision B — « Quota en direct » respecte les exemptions

**Votre consigne** : appliquer la même règle d'exemption que sur Primes, y
compris aux deux statistiques agrégées, et préciser l'effet sur leur calcul.

**Ce qui change.** `qdQuotaDe()` passe par `quotaDeLaFiche()` — la fiche fait
foi, y compris quand elle dit **zéro**, qui veut dire « exempté » et non « rien
de réglé ». On ne retombe sur le quota du grade que pour quelqu'un qui n'a pas
de fiche à l'effectif. Primes et Quota en direct donnent donc désormais le même
chiffre pour la même personne.

**Effet sur les deux compteurs agrégés**, tuile « X / Y ont atteint leur
quota » :

| | Avant | Après |
|---|---|---|
| **Y — « avecQuota »** (dénominateur) | comptait tout le monde, exemptés inclus, sur la foi du quota de grade | **ne compte plus les exemptés** : sans quota, rien à atteindre — les y laisser revenait à les compter comme en retard |
| **X — « atteints »** (numérateur) | un exempté pouvait y figurer dès que sa production dépassait le quota de son grade | **ne les compte plus non plus** : on n'« atteint » pas un quota qu'on n'a pas |

Un exempté sort donc des **deux côtés** de la fraction, qui ne parle plus que
des personnes réellement soumises à un quota. Exemple vérifié par test : trois
personnes dont une exemptée à 300 vins, une à 60/50 et une à 10/50 →
la tuile affiche **« 1 / 2 »** et non « 2 / 3 ».

**Cas limite** : si *tout le monde* est exempté, le dénominateur vaut zéro et
la tuile affiche **« — »** plutôt qu'une fraction trompeuse. C'était déjà le
comportement prévu pour un dénominateur nul ; il devient simplement
atteignable.

**Conséquence à connaître** : ces chiffres de pilotage **vont bouger** au
premier affichage après déploiement, dans le sens d'une lecture plus juste.
Si le nombre d'exemptés est important, l'écart sera visible — c'est attendu,
pas une anomalie.

---

# Clôture du deuxième passage

**Ce qui est fait.** 19 correctifs, tous vérifiés par des tests dont j'ai
montré qu'ils **échouent** quand le défaut revient (23 mutations, 22
détectées ; la seule survivante est équivalente en comportement et expliquée
au §7 bis). Sur les 13 corrections du premier audit, 10 tiennent, 3 étaient
incomplètes et sont reprises. Les trois régressions de la migration vers le
cookie sont fermées. Quatre défauts trouvés dans mes propres correctifs par
une relecture indépendante, corrigés avant remise (§6 bis). Les deux décisions
métier sont tranchées et appliquées.

**Ce qui est vérifié, et comment** : **754 vérifications, 0 échec** — dont 31
contre une **vraie MariaDB** jetable, qui ont levé le dernier blocage technique
du rapport et confirmé le comportement de `affectedRows` sur lequel repose le
contrôle de version (§7 quater).

---

## ⚠️ La contrainte de déploiement, en une phrase

> **Une seule instance, un seul processus applicatif** — tant que `data`,
> `journal`, `settings`, `invites` et `alias` ne sont pas protégés contre les
> écritures concurrentes **entre processus**.

Ce n'est pas une préférence de performance. Ce qui empêche deux
enregistrements simultanés de s'écraser est une file d'attente **en mémoire**
(`verrou()`) : deux processus ont chacun la leur et ne se voient pas. La
protection disparaît alors **sans qu'aucun message ne le signale**, et les deux
personnes lisent « Enregistré ✓ » pendant que le travail de l'une disparaît.

| | Protégé entre plusieurs processus ? |
|---|---|
| La matrice des accès (`/api/permissions`) | **Oui** — arbitrée par la base elle-même (`casValeur`, une seule instruction SQL, éprouvée contre une vraie MariaDB) |
| `data` (registre RH, clients, facturation…), `journal`, `settings`, `invites`, `alias` | **Non** — file en mémoire uniquement |

Concrètement, à ne pas faire : `docker compose up --scale marlowe-app=2`,
`replicas:`, `pm2 start -i 2` (ou `-i max`), un second `node src/server.js`
sur la même base « juste pour dépanner », deux machines derrière un
répartiteur. La contrainte est écrite en tête de
`backend/deploy/docker-compose.yml` et dans `backend/README.md`, là où
quelqu'un risque de la violer sans avoir lu ce rapport.

**Pour lever cette contrainte un jour** : donner à ces documents-là le même
traitement qu'à la matrice — comparaison et écriture dans une seule
instruction SQL. Le chemin est tracé (`casValeur`), il reste à l'appliquer.
Raisonnement complet au §7 ter.

---

## Ce qui reste ouvert

| Point | Nature | Qui agit |
|---|---|---|
| **L'essai en jeu** | Aucune preuve, ni dans un sens ni dans l'autre. L'analyse dit que ça passera ; je ne peux pas l'établir sans un serveur FiveM | Vous — Annexe B, dix minutes |
| **Les identifiants Discord des fiches** | Tant qu'ils manquent, les déclarations ne mettent plus les fiches à jour | Vous — Annexe C |
| **Le tour Discord complet en navigateur** | Demande les identifiants réels et un domaine en HTTPS | À la première ouverture après déploiement |
| **Duplication de l'API** | Voir l'encadré ci-dessus | À traiter **avant** de lancer un second exemplaire |
| **`marlowe-actions.js` ligne à ligne** | 10 000+ lignes, lues par extraits ciblés | Limite assumée, signalée au §2 |

**Deux changements d'affichage à constater** au premier lancement, et qui ne
sont pas des anomalies : la première clôture se lira « jusqu'au … » faute de
début connu, et la tuile « X / Y ont atteint leur quota » va bouger si des
employés sont exemptés.

**Aucun `push`, aucun `merge`, aucun déploiement n'a été effectué.** Le travail
est sur `audit-passage-2` ; `main` est intact. Aucune donnée de production n'a
été touchée : la seule base utilisée était un conteneur jetable, supprimé.

**Ce rapport ne dit pas que le dépôt est sans défaut.** Il dit ce qui a été
vérifié, comment, et ce qui ne l'a pas été — c'est une distinction que le
premier audit avait déjà prise au sérieux, et que ce passage a confirmée en
trouvant trois de ses corrections incomplètes, puis quatre défauts dans les
miennes. Un troisième passage en trouverait probablement d'autres.
