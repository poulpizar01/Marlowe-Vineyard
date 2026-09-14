-- ============================================================================
--  MARLOWE VINEYARD — structure de la base (MariaDB / MySQL)
--  ---------------------------------------------------------------------------
--  Appliqué automatiquement au démarrage du serveur (voir src/db.js) : chaque
--  instruction est un CREATE TABLE IF NOT EXISTS, donc rejouer ce fichier ou
--  redémarrer le serveur cent fois ne casse jamais rien.
--
--  Pour l'appliquer à la main (facultatif, seulement en dépannage) :
--      mysql -h <hôte> -u <utilisateur> -p <base> < schema.sql
--  (ou mariadb au lieu de mysql, selon ce qui est installé — les deux
--  commandes sont interchangeables ici)
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Une seule table, volontairement, pour l'essentiel du panel.
--
--  Le serveur n'a jamais eu besoin de requêtes SQL élaborées pour ça : il
--  range et relit des documents JSON entiers — les données du panel, les
--  réglages, la matrice des accès, le journal. Découper tout ça en vingt
--  tables relationnelles serait du travail pour rien, et surtout une
--  migration risquée. On garde donc la même forme qu'avant — une clé, une
--  valeur.
--
--  `cle` est en VARCHAR(191) et non VARCHAR(255) : c'est la plus grande
--  taille qu'InnoDB accepte encore comme clé primaire en utf8mb4 sur une
--  configuration par défaut (191 × 4 octets = 764, sous la limite de 767).
--  Une clé plus longue que ça ferait échouer la création de la table sur un
--  serveur qui n'a pas activé innodb_large_prefix.
--
--  `val` est en LONGTEXT (jusqu'à 4 Go) et non TEXT (limité à 65 Ko) : un
--  registre RH ou un journal qui grossit avec le temps dépasse vite les
--  64 Ko d'un TEXT ordinaire.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kv (
  cle VARCHAR(191) NOT NULL PRIMARY KEY,   -- 'data', 'settings', 'sess:xxxx', 'pres:123'…
  val LONGTEXT NOT NULL,                   -- le document, en JSON ou en texte brut
  exp BIGINT NULL,                         -- péremption en millisecondes epoch, NULL = permanent
  KEY kv_exp (exp)                         -- sert au ménage des lignes mortes (voir menage() dans index.js)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------------------
--  Les ventes lues dans le salon des logs
--  ---------------------------------------------------------------------------
--  Celle-ci est une VRAIE table, et non un document rangé dans kv. Deux
--  raisons, et une seule compte vraiment :
--
--  1. L'IDEMPOTENCE. La clé primaire est l'identifiant du message Discord.
--     Avec « INSERT IGNORE », le serveur peut relire dix fois le même lot —
--     après un redémarrage, une coupure, un rattrapage d'historique — sans
--     jamais compter une vente deux fois. Sans ça, la moindre reprise fausse
--     la semaine, et on ne s'en aperçoit qu'à la clôture.
--
--  2. On agrège par personne et par semaine. C'est du SQL, pas du JSON.
--
--  `cle` est le nom du log normalisé (sans accents, en minuscules) : les logs
--  ne portent AUCUN identifiant Discord, seulement le nom RP. C'est par lui
--  que la vente rejoint une fiche du registre.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ventes (
  msg   VARCHAR(32)  NOT NULL PRIMARY KEY,  -- identifiant du message Discord : la garantie anti-doublon
  ts    BIGINT       NOT NULL,              -- date du message, en millisecondes epoch
  nom   VARCHAR(255) NOT NULL,              -- le nom RP tel qu'il est écrit dans le log
  cle   VARCHAR(255) NOT NULL,              -- le même, normalisé, pour le rattachement
  qte   INT NOT NULL,                       -- le nombre de vins : C'EST LUI le quota
  brut  INT NOT NULL,                       -- le montant de la vente
  part  INT NOT NULL,                       -- la part revenant à la société
  item  VARCHAR(100),                       -- itemId du log (wine, …)
  job   VARCHAR(100),                       -- jobName du log (Vigneron, …)
  -- Les deux lectures qui comptent : « la semaine en cours » et « les ventes
  -- de cette personne ». Sans ces index, chaque affichage relit toute la table.
  KEY ventes_ts  (ts),
  KEY ventes_cle (cle, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------------------
--  Images et PDF (nouveautés du site, catalogue) : plus de table ici.
--  ---------------------------------------------------------------------------
--  Ces fichiers vivaient un temps dans une table `images` (LONGBLOB), après
--  être passés par le KV Cloudflare avant elle. Ils partent maintenant sur le
--  service de stockage de l'opérateur FlashbackFA (STORAGE_BASE/STORAGE_TOKEN
--  dans .env, voir handleUpload dans src/index.js) : un fichier de moins à
--  faire tenir dans une sauvegarde MariaDB, et plus de plafond
--  max_allowed_packet à surveiller pour un PDF de catalogue.
-- ----------------------------------------------------------------------------
