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
