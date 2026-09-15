# Marlowe Vineyard

Le site du domaine viticole Marlowe Vineyard (FlashbackFA, San Andreas) : la
vitrine publique et l'espace membre (RH, quotas, facturation, agenda…) du
domaine.

## Pour la personne qui déploie

**Tout est ici, et seulement ici.** Le site, l'API, le schéma de la base,
la base elle-même (`backend/marlowe.sql`), les tests et la marche à suivre.
Commencez par **[backend/README.md](backend/README.md)** : il se lit de haut
en bas, comptez une heure la première fois. Il ne vous manquera que ce qui
ne peut pas être dans un dépôt public — les identifiants de l'application
Discord et le jeton du stockage —, que le responsable du domaine vous
transmet en privé (backend/README.md, §3, dit qui fournit quoi).

### Démarrer, en résumé

Il faut **Node.js 20 ou plus** et **MariaDB ou MySQL** (ou Docker, qui
fournit la base). Pas de compilation : un seul processus Node sert le site
et l'API.

```bash
git clone https://github.com/poulpizar01/Marlowe-Vineyard.git
cd Marlowe-Vineyard/backend
cp .env.example .env            # puis remplir : base, port, adresse, Discord, stockage
npm install
npm start                       # crée les tables, écoute sur 127.0.0.1:<PORT>
```

Charger les données existantes : `mariadb -u marlowe -p marlowe < marlowe.sql`.

Pour la mise en service, un service qui redémarre tout seul et une
vérification que l'API répond :

```bash
./deploy.sh --first             # ensuite : ./deploy.sh update après chaque git pull
```

Il reste alors l'entrée du reverse proxy vers `127.0.0.1:<PORT>`, et le
Redirect OAuth2 chez Discord (`https://<adresse du site>/api/callback`),
déclaré par le responsable du domaine. Le montage Docker équivalent est dans
`backend/deploy/docker-compose.yml`.

## Quel dépôt fait foi

**Celui-ci — `poulpizar01/Marlowe-Vineyard`.** C'est le code que ces
README décrivent et que les bancs d'essai éprouvent.

Deux autres copies existent encore et prêtent à confusion :

- **`Poloveni/Marlow-Vineyard`**, l'ancien dépôt de travail, sur lequel les
  deux rapports d'audit à la racine (`AUDIT.md`, `AUDIT-PASSAGE-2.md`) ont
  été écrits. Il n'est plus suivi. L'installation qui en était issue
  (`marlowvineyard.duckdns.org`) est arrêtée et son adresse supprimée ; sa
  base est le dump `backend/marlowe.sql` de ce dépôt.
- **L'ancien GitHub Pages** (`poulpizar01.github.io/Marlowe-Vineyard`), qui
  sert encore une copie statique du site d'avant la version Node.js. Il ne
  parle à aucune API et n'est plus mis à jour ; à désactiver dans les
  réglages du dépôt une fois le nouveau site en ligne.

## Structure du dépôt

- **`index.html`** — la porte d'entrée du site : logo, accroche, bouton
  « Entrer » sur fond de vallée nocturne (shader Three.js). Mène à
  `accueil.html`.
- **`accueil.html`** — la vitrine complète (catalogue, organigramme, grades,
  recrutement, devenir client).
- **`gestion.html`** — l'espace membre, protégé par connexion Discord.
- **`marlowe-*.js`** — le code du panel (`auth`, `data`, `actions`, `liste`,
  `folkos`), chargés par `gestion.html`.
- **`marlowe-config.js`** — l'adresse de l'API, en un seul endroit (voir
  commentaire dans le fichier).
- **`planche-soleil.html`** — outil interne, sans rapport avec le panel.
- **`version.json`** — le numéro de version du site (le panel le relit pour
  proposer un rechargement). Le backend a le sien dans `backend/package.json`.
- **`backend/`** — l'API Node.js (connexion Discord, quotas, facturation…)
  et sa base MariaDB/MySQL. **Voir [backend/README.md](backend/README.md)
  pour tout ce qui concerne le déploiement.**
  - `backend/marlowe.sql` — le dump de la base à charger pour reprendre les
    données existantes (sessions et clés temporaires retirées).
  - `backend/scripts/` — `tests.mjs` (lance les 18 bancs d'essai) et
    `dump-nettoyer.mjs` (nettoie un dump avant de l'ajouter ici).
  - `backend/deploy.sh` — déploiement sans Docker : `--first` crée le service
    systemd et vérifie que l'API répond, `update` met à jour.
  - `backend/deploy/` — `docker-compose.yml` et un exemple de reverse proxy.
  - `backend/migrations/` — les changements de structure de la base,
    appliqués une fois chacun au démarrage.
- **`test-*.mjs`** (à la racine et dans `backend/`) — les bancs d'essai,
  lancés d'un coup par `cd backend && npm test`.
- **`AUDIT.md`, `AUDIT-PASSAGE-2.md`** — deux rapports d'audit datés, écrits
  sur le dépôt de l'équipe d'origine, conservés comme trace.
- **`LICENSE`** — code propriétaire : l'accès est réservé aux collaborateurs
  autorisés, pour ce projet seulement. Aucune réutilisation ailleurs.

## Déployer ce projet

Toute la marche à suivre — préparer le serveur et la base, configurer
`.env` avec les valeurs reçues du responsable du domaine, lancer l'API (avec
ou sans Docker), charger les données, mettre à jour — est dans
**[backend/README.md](backend/README.md)**. L'application Discord existe
déjà : la personne qui déploie n'a rien à y créer.

Pour vérifier le code sans rien installer : `cd backend && npm test` lance
les 18 bancs d'essai du dépôt (voir backend/README.md, « Lancer les bancs
d'essai »).

Aucun secret n'est dans ce dépôt : il peut rester public sans risque. Les
clés (Discord, base de données) vivent uniquement dans `backend/.env`, créé
à partir de `backend/.env.example` et jamais commité.
