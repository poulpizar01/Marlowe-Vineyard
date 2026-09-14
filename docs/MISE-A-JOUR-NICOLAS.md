# Mise à jour du serveur — déroulé d'intervention

**Pour** : Nicolas
**Objet** : passer la production de `92a7fc0` à `06f7001` (8 commits)
**Durée** : ~45 min, dont l'essai en jeu
**Où** : `/opt/marlowe` sur le VPS

---

## ⚠️ À faire tout de suite si l'intervention ne peut pas avoir lieu aujourd'hui

**Le serveur sert publiquement son propre code source, en ce moment.** Vérifié
le 11/09/2026 :

```
GET https://<adresse-du-site>//backend/src/index.js
→ 200, 150 444 octets
```

Deux barres obliques au lieu d'une suffisent à traverser le filtre. Le code
livré corrige ça, mais **tant qu'il n'est pas déployé, bloquez l'accès au
niveau de Caddy** — c'est cinq minutes et ça ne demande aucune reconstruction.

Dans `/opt/vps-proxy/sites.d/marlowe.caddy`, à l'intérieur du bloc du
domaine, **remplacer** le `reverse_proxy` par ceci :

```caddy
	@dossiers_de_service path_regexp "^/+(?i)(backend|docs|node_modules|\.git|Claude outputs)(/|$)"
	handle @dossiers_de_service {
		respond 404
	}

	handle {
		reverse_proxy marlowe-app-1:8787 {
			header_up X-Real-IP {remote_host}
		}
	}
```

Les blocs `handle` sont exclusifs et évalués dans l'ordre : ce qui tombe dans
le premier n'atteint jamais le second. Le `^/+` couvre les barres multiples,
le `(?i)` couvre les majuscules.

Recharger Caddy (le conteneur du proxy partagé — `docker ps | grep caddy`
pour son nom) :

```bash
sudo docker exec <conteneur-caddy> caddy reload --config /etc/caddy/Caddyfile
```

**Puis vérifier — ne pas se fier au fait que la commande n'a rien dit :**

```bash
H=https://marlowe-vineyard.fbfa.fr   # l'adresse réelle du déploiement
for u in "//backend/src/index.js" "/backend%2fsrc%2findex.js" "/.git/config" "/docs/reponse-folkos.md"; do
  printf "%-34s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' "$H$u")"
done
curl -s -o /dev/null -w 'accueil : %{http_code}\n' "$H/"
curl -s -o /dev/null -w 'panel   : %{http_code}\n' "$H/gestion.html"
```

Attendu : **404** sur les quatre premières, **200** sur les deux dernières. Si
le site normal tombe en 404, le bloc `handle` est mal placé — retirez-le et
prévenez avant d'aller plus loin.

> Je n'ai pas pu essayer cette configuration Caddy moi-même. Les commandes de
> vérification ci-dessus sont donc à exécuter, pas à supposer.

---

## L'intervention, dans l'ordre

### 1. Compléter les identifiants Discord — **avant** de déployer

Le nouveau code rattache une personne à sa fiche par son **identifiant
Discord**, et non plus par son pseudo (qui se change en deux clics, ce qui permettait
d'écrire à la place d'un collègue). Conséquence : **une fiche sans identifiant
n'est plus rattachée à personne.** La personne peut toujours déclarer une
absence ou une récolte, mais **sa fiche ne bascule plus en « absent »**, et
rien ne le lui dit à l'écran.

Dans le panel, **RH ▸ Employés**, renseigner le champ **Discord** de chaque
fiche : l'identifiant **numérique** (clic droit sur la personne dans Discord ▸
« Copier l'identifiant », mode développeur activé), **pas le pseudo**.

- Ça se fait sur la version actuelle, sans rien déployer.
- Commencer par celles et ceux qui déclarent le plus souvent.
- **Homonymes** : ne pas deviner. Le serveur signalera les fiches candidates
  sans jamais choisir ; c'est un arbitrage humain.
- Vérifier qu'aucune fiche ne porte l'identifiant de quelqu'un d'autre —
  c'est la seule erreur de saisie qui aurait des conséquences réelles.

**Si ça prend plus d'une journée** : appliquer le blocage Caddy ci-dessus
immédiatement, sans attendre le reste.

### 2. Sauvegarder la base — et **prouver** que la sauvegarde est exploitable

Un fichier non vide ne prouve rien : un export interrompu produit un fichier
volumineux et inutilisable.

```bash
cd /opt/marlowe
MDP=$(grep '^DB_PASSWORD=' backend/.env | cut -d= -f2-)

sudo docker exec -e MYSQL_PWD="$MDP" marlowe-db-1 \
  mariadb-dump -u marlowe --single-transaction --routines --events marlowe \
  > ~/sauvegarde-marlowe-$(date +%F).sql
echo "code de sortie : $?"
```

**Trois contrôles, tous obligatoires :**

```bash
F=~/sauvegarde-marlowe-$(date +%F).sql

# 1. l'export s'est terminé proprement (mariadb-dump écrit cette ligne en fin
#    de fichier UNIQUEMENT s'il est allé au bout)
tail -1 "$F"                      # doit contenir « Dump completed »

# 2. les deux tables sont là
grep -c "CREATE TABLE" "$F"       # doit valoir 2 (kv et ventes)

# 3. le document de travail est dedans (registre RH, clients, facturation…)
grep -c "INSERT INTO \`kv\`" "$F" # doit valoir au moins 1
```

Le code de sortie **et** « Dump completed » : le premier sans le second ne
suffit pas, la redirection `>` peut masquer une interruption.

**Preuve complète (recommandée) — restaurer ailleurs, sans toucher à la
production :**

```bash
sudo docker run -d --rm --name essai-restauration \
  -e MARIADB_ROOT_PASSWORD=jetable -e MARIADB_DATABASE=marlowe mariadb:10.11
sleep 20
sudo docker exec -i essai-restauration mariadb -u root -pjetable marlowe < "$F"
sudo docker exec essai-restauration mariadb -u root -pjetable \
  -e "SELECT COUNT(*) AS cles FROM marlowe.kv; SELECT COUNT(*) AS ventes FROM marlowe.ventes;"
sudo docker stop essai-restauration
```

Les deux comptes doivent être plausibles (des clés, et des ventes si la
période en compte). **C'est la seule vérification qui prouve vraiment qu'on
pourrait revenir en arrière.**

### 3. Reconstruire — `up -d --build`, **jamais** `restart`

Le code part dans l'image Docker (`COPY . /app` dans `backend/Dockerfile`) :
le conteneur lit une copie figée. `git pull` ne change rien pour lui, et
`docker compose restart` ne relit ni le code ni le `.env`.

```bash
cd /opt/marlowe
git pull origin main
sudo docker compose -f backend/deploy/docker-compose.yml up -d --build marlowe-app
sudo docker compose -f backend/deploy/docker-compose.yml logs --tail=40 marlowe-app
```

> **Une seule instance, un seul processus.** Pas de `--scale`, pas de
> `replicas`, pas de second `node src/server.js` sur la même base. Ce qui
> empêche deux enregistrements simultanés de s'écraser est une file **en
> mémoire** : deux processus ne la partagent pas, et la protection disparaît
> sans aucun message. Détail dans `backend/README.md`.

### 4. Vérifier — quatre commandes

```bash
H=https://marlowe-vineyard.fbfa.fr   # l'adresse réelle du déploiement
curl -s "$H/api/version" | grep -o '"routes":\[[^]]*\]' | tr ',' '\n' | wc -l   # 27
curl -s -o /dev/null -w '%{http_code}\n' "$H//backend/src/index.js"             # 404
curl -sI "$H/gestion.html" | grep -i "nosniff\|referrer-policy"                 # les deux
curl -s "$H/api/me"                                                             # {"error":"unauthorized"}
```

Puis **se connecter au panel, changer de page, enregistrer une modification**.

### 5. Essai en jeu — l'étape qu'on ne peut pas sauter

Depuis l'ordinateur en jeu (FiveM) :

1. ouvrir le panel → la page s'affiche ;
2. se connecter avec Discord → on revient **dans le jeu**, connecté ;
3. changer de page deux ou trois fois ;
4. **modifier quelque chose d'anodin et enregistrer** → « Enregistré ».

Le point 4 est le seul qui compte : c'est l'écriture qui est contrôlée, pas la
lecture. Une nouvelle protection anti-CSRF refuse les requêtes venues d'un
autre site, et **personne n'a pu vérifier comment l'iframe du jeu se présente**.

**Si le message « adresse du site non reconnue par le serveur » apparaît** :
relever le domaine affiché, la ligne de console, et l'en-tête `Origin` de la
requête refusée (onglet Réseau → `PUT /api/data` → en-têtes de requête).
**Ne désactiver aucune protection.** Une origine observée n'est pas une
origine légitime : il faut d'abord établir qu'elle correspond au déploiement
attendu. `Origin: null` en particulier ne doit jamais être autorisé — il
n'identifie personne.

---

## Si quelque chose se passe mal

**Ne pas revenir à `92a7fc0`.** Cette version contient les failles qu'on est
justement en train de fermer — dont la fuite de code source, active en ce
moment. Un retour arrière échangerait un problème de fonctionnement contre un
problème de sécurité.

**À la place, restreindre l'accès le temps de résoudre.** Dans le fichier
Caddy, à l'intérieur du bloc du domaine, **avant** le `handle` du
`reverse_proxy` :

```caddy
	@panel path /gestion.html /api/*
	handle @panel {
		respond "Espace membre en maintenance, de retour dans quelques minutes." 503
	}
```

La vitrine publique reste en ligne, l'espace membre est fermé, les données ne
bougent plus — et les correctifs de sécurité restent en place. Recharger Caddy,
vérifier que `/` répond 200 et `/gestion.html` 503, puis prévenir.

---

## Deux changements d'affichage attendus

Ce ne sont **pas** des anomalies :

- **La première clôture** après mise à jour se lira « jusqu'au … », sans date
  de début : les compteurs tournent depuis une date qu'on ne connaît pas, et
  on ne l'invente pas. À partir de la deuxième, les périodes s'enchaînent.
- **La tuile « X / Y ont atteint leur quota »** va bouger si des employés sont
  exemptés : ils sortent désormais des deux côtés de la fraction, qui ne parle
  plus que des personnes réellement soumises à un quota.

---

## Contexte

Détail complet des correctifs, de ce qui a été vérifié et de ce qui ne l'a pas
été : `AUDIT-PASSAGE-2.md` à la racine du dépôt. La procédure de mise à jour
générale est dans `backend/README.md`, section « Mettre à jour une installation
qui tourne déjà ».
