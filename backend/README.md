# Backend Marlowe Vineyard — connexion Discord

Petit serveur qui gère la connexion Discord du panel et les accès par rôle.
Il tourne sur Cloudflare Workers, gratuitement.

**Aucun secret n'est dans ce dossier.** Le code peut rester public sans risque :
les clés vivent dans les variables d'environnement Cloudflare.

Comptez une vingtaine de minutes pour la première mise en route.

---

## 1. Créer l'application Discord

Sur https://discord.com/developers/applications

1. **New Application** → nom : `Marlowe Vineyard`.
2. Onglet **OAuth2** → notez le **Client ID**, puis **Reset Secret** et notez le **Client Secret**.
   Ce secret ne s'affiche qu'une fois.
3. Toujours dans **OAuth2** → **Redirects** → **Add Redirect** :
   ```
   https://marlowe-api.VOTRE-SOUS-DOMAINE.workers.dev/api/callback
   ```
   *(Vous aurez l'adresse exacte après l'étape 3. Revenez la coller ici — c'est
   l'oubli le plus fréquent, et Discord refuse la connexion sans elle.)*
4. Onglet **Bot** → **Add Bot** → **Reset Token** et notez le **token du bot**.

### Inviter le bot sur le serveur

Le bot n'a besoin d'aucune permission particulière : il doit simplement être
présent sur le serveur pour pouvoir lire la liste des rôles et vérifier qui en
est membre.

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

## 2. Préparer Cloudflare

Créez un compte gratuit sur https://dash.cloudflare.com (aucune carte demandée).

Dans un terminal, à la racine de ce dossier `backend/` :

```bash
npm install -g wrangler
npx wrangler login
```

Créez le stockage :

```bash
npx wrangler kv namespace create MARLOWE
```

La commande affiche un `id`. **Recopiez-le dans `wrangler.toml`**, à la place de
`METTRE_ICI_ID_DU_NAMESPACE_KV`.

---

## 3. Remplir la configuration

Ouvrez `wrangler.toml` et complétez :

| Variable | Valeur |
|---|---|
| `DISCORD_GUILD_ID` | l'identifiant du serveur Discord |
| `SITE_URL` | l'adresse du site, sans slash final |
| `PATRON_ROLES` | les rôles ayant tous les droits, séparés par des virgules |
| `OWNER_IDS` | les identifiants Discord ayant un accès permanent |

Puis posez les secrets — ils sont chiffrés chez Cloudflare et n'apparaissent
jamais dans le dépôt :

```bash
npx wrangler secret put DISCORD_CLIENT_ID
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_WEBHOOK
```

Chaque commande demande la valeur, collez-la et validez.

### Le webhook du salon des runners

`DISCORD_WEBHOOK` est l'adresse qui permet au panel de poster les demandes de
retrait dans le salon Discord. Pour l'obtenir :

1. dans Discord, ouvrez le salon des runners ;
2. **Modifier le salon ▸ Intégrations ▸ Webhooks ▸ Nouveau webhook** ;
3. **Copier l'URL du webhook**.

Un webhook plutôt que le bot : il ne dépend d'aucune permission accordée au bot
du serveur, que vous ne contrôlez pas.

Cette adresse est une **autorisation d'écrire dans le salon** : n'importe qui
la possédant peut y publier. C'est pour ça qu'elle est un secret et qu'elle
n'est jamais envoyée au navigateur — le message est composé par le Worker, à
partir de l'identité de la personne connectée. Sans elle, le bouton continue
de fonctionner : la demande s'inscrit dans le fil du panel, et l'envoi Discord
signale simplement qu'il n'est pas configuré.

Le rôle mentionné se règle dans `wrangler.toml`, variable `DISCORD_RUNNER_ROLE`.

---

## 4. Déployer

```bash
npx wrangler deploy
```

La commande affiche l'adresse du Worker, du type :

```
https://marlowe-api.votre-sous-domaine.workers.dev
```

**Retournez maintenant sur le portail Discord** (étape 1.3) et collez cette
adresse suivie de `/api/callback` dans les **Redirects**.

---

## 5. Brancher le site

Dans `marlowe-auth.js`, tout en haut, modifiez `CONFIG` :

```js
const CONFIG = {
  MODE: 'discord',                                              // au lieu de 'demo'
  API_BASE: 'https://marlowe-api.votre-sous-domaine.workers.dev',
  PATRON_ROLES: ['Patron', 'Co-Patron'],
  OWNER_IDS: ['votre identifiant Discord'],
};
```

Poussez sur GitHub. C'est fini — `gestion.html` demande maintenant une vraie
connexion Discord.

---

## Vérifier que ça marche

Ouvrez `https://marlowe-api.…workers.dev/api/me` dans un navigateur.
La réponse attendue est `{"error":"unauthorized"}` — c'est **normal et bon signe** :
le Worker répond, et il refuse une requête sans session.

Si vous obtenez `{"error":"config","missing":"..."}`, c'est qu'une variable
n'a pas été renseignée : le nom manquant est indiqué dans la réponse.

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
| `GET /api/logout` | ferme la session |

---

## Ce qu'il faut retenir

**Les rôles sont revérifiés à chaque appel**, pas seulement à la connexion.
Quelqu'un qui quitte le Discord ou perd un rôle perd l'accès dans la seconde,
sans avoir à se déconnecter.

**`OWNER_IDS` est un trousseau de secours.** Les identifiants qui y figurent
gardent tous les accès quoi qu'il arrive, et personne ne peut les retirer
depuis la page Paramètres. À garder court.

**Le filtrage des pages côté navigateur est du confort, pas une sécurité.**
`gestion.html` est un fichier public, téléchargeable par n'importe qui. Toute
donnée réelle devra transiter par ce Worker, qui revalide les rôles à chaque
requête. Ne mettez jamais de données sensibles en dur dans le HTML.

---

## Coût

Le palier gratuit couvre 100 000 requêtes par jour et 1 Go de stockage.
Un domaine RP en consomme quelques centaines. Aucune carte bancaire n'est
demandée, et le service ne bascule pas en payant tout seul.
