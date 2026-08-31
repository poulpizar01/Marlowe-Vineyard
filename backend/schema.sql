-- ============================================================================
--  MARLOWE VINEYARD — structure de la base D1
--  ---------------------------------------------------------------------------
--  À appliquer une fois, depuis le dossier backend :
--
--      npx wrangler d1 execute marlowe --remote --file=schema.sql
--
--  (le drapeau --remote vise la vraie base ; sans lui, wrangler ne toucherait
--  qu'une copie locale de test)
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Une seule table, volontairement.
--
--  Le Worker n'a jamais eu besoin de requêtes SQL : il range et relit des
--  documents JSON entiers — les données du panel, les réglages, la matrice des
--  accès, le journal. Découper tout ça en vingt tables relationnelles serait
--  du travail pour rien, et surtout une migration risquée.
--
--  On garde donc la même forme qu'avant — une clé, une valeur — et on ne
--  change que la maison : D1 autorise 100 000 écritures par jour là où KV s'en
--  tenait à 1 000. Le code au-dessus n'a pas bougé d'une ligne.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kv (
  cle TEXT PRIMARY KEY,       -- 'data', 'settings', 'sess:xxxx', 'pres:123'…
  val TEXT NOT NULL,          -- le document, en JSON ou en texte brut
  exp INTEGER                 -- péremption en millisecondes epoch, NULL = permanent
);

-- Les listings se font toujours par préfixe ('pres:', 'sess:'). SQLite sait
-- utiliser l'index de la clé primaire pour ça, mais seulement si la colonne
-- est comparée telle quelle — d'où un index explicite sur la péremption, qui
-- sert au ménage des lignes mortes.
CREATE INDEX IF NOT EXISTS kv_exp ON kv (exp);

-- ----------------------------------------------------------------------------
--  Les ventes lues dans le salon des logs
--  ---------------------------------------------------------------------------
--  Celle-ci est une VRAIE table, et non un document rangé dans kv. Deux
--  raisons, et une seule compte vraiment :
--
--  1. L'IDEMPOTENCE. La clé primaire est l'identifiant du message Discord.
--     Avec « INSERT OR IGNORE », le Worker peut relire dix fois le même lot —
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
  msg   TEXT PRIMARY KEY,     -- identifiant du message Discord : la garantie anti-doublon
  ts    INTEGER NOT NULL,     -- date du message, en millisecondes epoch
  nom   TEXT NOT NULL,        -- le nom RP tel qu'il est écrit dans le log
  cle   TEXT NOT NULL,        -- le même, normalisé, pour le rattachement
  qte   INTEGER NOT NULL,     -- le nombre de vins : C'EST LUI le quota
  brut  INTEGER NOT NULL,     -- le montant de la vente
  part  INTEGER NOT NULL,     -- la part revenant à la société
  item  TEXT,                 -- itemId du log (wine, …)
  job   TEXT                  -- jobName du log (Vigneron, …)
);

-- Les deux lectures qui comptent : « la semaine en cours » et « les ventes de
-- cette personne ». Sans ces index, chaque affichage relit toute la table.
CREATE INDEX IF NOT EXISTS ventes_ts  ON ventes (ts);
CREATE INDEX IF NOT EXISTS ventes_cle ON ventes (cle, ts);
