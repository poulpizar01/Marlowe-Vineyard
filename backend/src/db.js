/* ============================================================================
   MARLOWE VINEYARD — accès base de données (MariaDB / MySQL via mysql2)
   ----------------------------------------------------------------------------
   Ce fichier est la SEULE chose qui sache que la base est du MariaDB/MySQL.
   Il expose un objet qui imite l'API D1 de Cloudflare que le reste du code
   (index.js) utilisait déjà :

       env.DB.prepare(sql).bind(...args).run()   // écrit, sans lire le résultat
       env.DB.prepare(sql).bind(...args).all()    → { results: [...] }
       env.DB.prepare(sql).bind(...args).first()  → une ligne, ou null
       env.DB.batch([...statements liés])         // exécute tout, atomiquement

   Pas une seule route d'index.js n'a eu besoin d'être réécrite grâce à cette
   façade : c'est là, et seulement là, que la conversion a lieu.

   Point d'attention en le relisant : `bind()` renvoie un NOUVEL objet à
   chaque appel plutôt que de modifier `this`. C'est indispensable — le code
   de lecture des ventes appelle `req.bind(...)` en boucle sur le MÊME
   statement préparé (voir handleLogs/lireLogs dans index.js) pour construire
   un lot ; si bind() modifiait l'objet en place, tous les appels de la boucle
   partageraient la même référence et n'écriraient que la DERNIÈRE ligne, N
   fois. C'est exactement le comportement de D1 (bind() y est immuable), donc
   on le reproduit à l'identique.
   ============================================================================ */

import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'schema.sql');

/* Un statement préparé, au sens D1 : porte son SQL et ses arguments, et
   `.bind()` renvoie une COPIE liée aux nouveaux arguments plutôt que de se
   modifier lui-même (voir l'avertissement ci-dessus). */
function creerStatement(pool, sql, args) {
  return {
    _sql: sql,
    _args: args,

    bind(...nouveauxArgs) {
      return creerStatement(pool, sql, nouveauxArgs);
    },

    async run() {
      const [resultat] = await pool.execute(sql, args);
      return { success: true, meta: resultat };
    },

    async all() {
      const [lignes] = await pool.execute(sql, args);
      return { results: lignes };
    },

    async first() {
      const [lignes] = await pool.execute(sql, args);
      return lignes[0] || null;
    },
  };
}

/* Découpe naïve du schema.sql en instructions séparées. Suffisant ici : le
   fichier est écrit à la main, sans point-virgule dans une chaîne littérale,
   et chaque instruction est un CREATE TABLE IF NOT EXISTS — donc rejouable
   sans risque à chaque démarrage. */
function decouperSchema(sqlBrut) {
  return sqlBrut
    .split('\n')
    .filter(ligne => !ligne.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

async function appliquerSchema(pool) {
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  for (const instruction of decouperSchema(sql)) {
    await pool.query(instruction);
  }
}

/* config = { host, port, user, password, database, connectionLimit? } */
export async function creerBase(config) {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: config.connectionLimit || 10,
    charset: 'utf8mb4',
  });

  /* Un échec de connexion ici doit dire clairement QUOI vérifier — pas juste
     « ECONNREFUSED », qui ne dit rien à quelqu'un qui ne connaît pas MySQL. */
  try {
    await appliquerSchema(pool);
  } catch (e) {
    throw new Error(
      "Impossible de se connecter à la base ou d'y créer les tables. "
      + "Vérifiez DB_HOST, DB_PORT, DB_USER, DB_PASSWORD et DB_NAME dans .env, "
      + "et que le serveur MariaDB/MySQL est bien démarré. Détail : " + e.message
    );
  }

  const binding = {
    prepare(sql) {
      return creerStatement(pool, sql, []);
    },

    /* Exécute plusieurs statements liés, atomiquement (tout ou rien) — c'est
       ce que lireLogs() attend pour insérer un lot de ventes d'un coup. */
    async batch(statements) {
      const connexion = await pool.getConnection();
      try {
        await connexion.beginTransaction();
        const resultats = [];
        for (const s of statements) {
          const [r] = await connexion.execute(s._sql, s._args);
          resultats.push(r);
        }
        await connexion.commit();
        return resultats;
      } catch (e) {
        await connexion.rollback();
        throw e;
      } finally {
        connexion.release();
      }
    },
  };

  return { pool, binding };
}
