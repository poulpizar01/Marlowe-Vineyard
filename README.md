# Marlowe Vineyard

Le site du domaine viticole Marlowe Vineyard (FlashbackFA, San Andreas) : la
vitrine publique et l'espace membre (RH, quotas, facturation, agenda…) du
domaine.

## Quel dépôt fait foi

**Celui-ci — `poulpizar01/Marlowe-Vineyard`.** C'est le code que ces
README décrivent et que les bancs d'essai éprouvent.

Deux autres copies existent et prêtent à confusion :

- **`Poloveni/Marlow-Vineyard`**, le dépôt de l'équipe d'origine, d'où vient
  l'installation qui tourne sur `marlowvineyard.duckdns.org`. Les deux
  rapports d'audit à la racine (`AUDIT.md`, `AUDIT-PASSAGE-2.md`) ont été
  écrits sur lui et citent ses commits. Il n'est pas suivi ici : une
  correction faite là-bas n'arrive pas ici toute seule.
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
  - `backend/deploy/` — `docker-compose.yml` et un exemple de reverse proxy.
- **`test-*.mjs`** (à la racine et dans `backend/`) — les bancs d'essai,
  lancés d'un coup par `cd backend && npm test`.
- **`AUDIT.md`, `AUDIT-PASSAGE-2.md`** — deux rapports d'audit datés, écrits
  sur le dépôt de l'équipe d'origine, conservés comme trace.
- **`Claude outputs/`** — captures d'écran des rendus successifs du site.

## Déployer ce projet

Toute la marche à suivre — créer l'application Discord, préparer le
serveur, configurer `.env`, lancer l'API (avec ou sans Docker), brancher le
site — est dans **[backend/README.md](backend/README.md)**.

Pour vérifier le code sans rien installer : `cd backend && npm test` lance
les 18 bancs d'essai du dépôt (voir backend/README.md, « Lancer les bancs
d'essai »).

Aucun secret n'est dans ce dépôt : il peut rester public sans risque. Les
clés (Discord, base de données) vivent uniquement dans `backend/.env`, créé
à partir de `backend/.env.example` et jamais commité.
