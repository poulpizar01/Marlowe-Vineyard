# Marlowe Vineyard

Le site du domaine viticole Marlowe Vineyard (FlashbackFA, San Andreas) : la
vitrine publique et l'espace membre (RH, quotas, facturation, agenda…) du
domaine.

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
- **`backend/`** — l'API Node.js (connexion Discord, quotas, facturation…)
  et sa base MariaDB/MySQL. **Voir [backend/README.md](backend/README.md)
  pour tout ce qui concerne le déploiement.**

## Déployer ce projet

Toute la marche à suivre — créer l'application Discord, préparer le
serveur, configurer `.env`, lancer l'API (avec ou sans Docker), brancher le
site — est dans **[backend/README.md](backend/README.md)**.

Aucun secret n'est dans ce dépôt : il peut rester public sans risque. Les
clés (Discord, base de données) vivent uniquement dans `backend/.env`, créé
à partir de `backend/.env.example` et jamais commité.
