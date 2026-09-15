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
import { readFileSync, readdirSync } from 'node:fs';
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

/* Les migrations : un fichier SQL numéroté par changement de structure,
   appliqué UNE fois, et tracé.
   ---------------------------------------------------------------------------
   schema.sql crée les tables de base et se rejoue sans risque. Mais dès
   qu'il faut modifier une table existante — ajouter une colonne, un index —
   « CREATE TABLE IF NOT EXISTS » ne fait rien, et rejouer un ALTER à chaque
   démarrage finit par échouer. D'où ce mécanisme : les fichiers de
   backend/migrations/ (NNNN_description.sql, voir le README de ce dossier)
   sont appliqués dans l'ordre, et chaque nom appliqué est inscrit dans la
   table `migrations`. Au démarrage suivant, seuls les nouveaux passent.

   Une migration doit être écrite pour pouvoir être rejouée (IF NOT EXISTS,
   IF EXISTS) : MariaDB ne sait pas annuler un ALTER dans une transaction,
   donc une migration qui échoue à moitié sera relancée au démarrage suivant. */
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function appliquerMigrations(pool) {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS migrations ('
    + ' nom VARCHAR(191) NOT NULL PRIMARY KEY,'
    + ' applique_le DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
    + ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  );
  let fichiers = [];
  try {
    fichiers = readdirSync(MIGRATIONS_DIR).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
  } catch (e) { return []; /* pas de dossier : rien à appliquer */ }

  const [faites] = await pool.query('SELECT nom FROM migrations');
  const deja = new Set(faites.map(r => r.nom));
  const appliquees = [];
  for (const f of fichiers) {
    if (deja.has(f)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const connexion = await pool.getConnection();
    try {
      await connexion.beginTransaction();
      for (const instruction of decouperSchema(sql)) await connexion.query(instruction);
      await connexion.query('INSERT INTO migrations (nom) VALUES (?)', [f]);
      await connexion.commit();
    } catch (e) {
      await connexion.rollback().catch(() => {});
      throw new Error(`Migration ${f} : ${e.message}`);
    } finally {
      connexion.release();
    }
    console.log(`[db] migration appliquée : ${f}`);
    appliquees.push(f);
  }
  return appliquees;
}

/* Combien de temps une requête attend son tour sur un document avant d'y
   renoncer (voir binding.verrou). Une écriture prend quelques dizaines de
   millisecondes ; quinze secondes, c'est déjà le signe que quelque chose
   ne va pas — et le panel préfère un refus net à une attente sans fin. */
const VERROU_ATTENTE_S = 15;

/* config = { host, port, user, password, database, connectionLimit? } */
export async function creerBase(config) {
  const parametres = {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    charset: 'utf8mb4',
  };
  const pool = mysql.createPool({ ...parametres, connectionLimit: config.connectionLimit || 10 });

  /* Un second pool, petit, réservé aux verrous nommés (binding.verrou).
     -----------------------------------------------------------------------
     Un verrou GET_LOCK appartient à la CONNEXION qui l'a pris : elle doit
     rester ouverte tant qu'on le tient, donc immobilisée pendant toute la
     section protégée. Si ces connexions venaient du pool ordinaire, dix
     requêtes en attente d'un même document en occuperaient les dix places,
     et celle qui tient le verrou n'aurait plus de connexion pour faire ses
     propres lectures et écritures : tout le monde s'attendrait. Deux pools,
     et ce blocage-là devient impossible. */
  const poolVerrous = mysql.createPool({ ...parametres, connectionLimit: config.verrousLimit || 8 });

  /* Un échec de connexion ici doit dire clairement QUOI vérifier — pas juste
     « ECONNREFUSED », qui ne dit rien à quelqu'un qui ne connaît pas MySQL. */
  try {
    await appliquerSchema(pool);
    await appliquerMigrations(pool);
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

    /* Un verrou nommé, tenu par la BASE — donc commun à toutes les instances.
       -----------------------------------------------------------------------
       Plusieurs routes lisent un document entier, le modifient et le
       réécrivent (data, journal, settings, invites, alias). Deux de ces
       sections ne doivent jamais se chevaucher, sans quoi la seconde réécrit
       par-dessus la première et un enregistrement disparaît en silence.
       La file d'attente en mémoire d'index.js (verrou()) ne vaut que pour UN
       processus : deux conteneurs, ou deux `node src/server.js` sur la même
       base, ont chacun la leur et ne se voient pas.

       GET_LOCK(nom, attente) est l'équivalent côté serveur : MariaDB comme
       MySQL ne l'accordent qu'à une connexion à la fois, quel que soit le
       processus qui la tient, et le rendent d'eux-mêmes si la connexion
       tombe — un processus tué en pleine écriture ne bloque personne.
       Le nom porte celui de la base : deux installations sur le même serveur
       (une de test à côté de la vraie) ne se gênent pas.

       Rend ce que rend `action`. Si le verrou n'est pas obtenu dans le délai,
       lève une erreur marquée `verrouOccupe` — index.js la traduit en 503,
       rien n'a été écrit. `opts.attente` en secondes ; 0 veut dire « si la
       place est prise, ne pas attendre » (la tâche périodique s'en sert). */
    async verrou(nom, action, opts) {
      const attente = (opts && typeof opts.attente === 'number') ? opts.attente : VERROU_ATTENTE_S;
      const nomSql = ('marlowe:' + config.database + ':' + nom).slice(0, 64);
      const connexion = await poolVerrous.getConnection();
      let tenu = false;
      try {
        const [lignes] = await connexion.query('SELECT GET_LOCK(?, ?) AS ok', [nomSql, attente]);
        tenu = Number(lignes && lignes[0] && lignes[0].ok) === 1;
        if (!tenu) {
          const e = new Error(attente > 0
            ? `Le document « ${nom} » est en cours d'écriture par une autre instance depuis plus de ${attente} s.`
            : `Le document « ${nom} » est en cours d'écriture par une autre instance.`);
          e.verrouOccupe = true;
          e.document = nom;
          throw e;
        }
        return await action();
      } finally {
        if (tenu) {
          /* Si le RELEASE échoue, la connexion est détruite plutôt que rendue
             au pool : le serveur libère alors le verrou de lui-même, et
             personne ne récupère une connexion qui tiendrait encore un verrou
             fantôme. */
          try { await connexion.query('SELECT RELEASE_LOCK(?)', [nomSql]); connexion.release(); }
          catch (e) { connexion.destroy(); }
        } else {
          connexion.release();
        }
      }
    },

    /* Ferme les deux pools proprement (arrêt du serveur, fin d'un banc
       d'essai). */
    async fermer() {
      await Promise.allSettled([poolVerrous.end(), pool.end()]);
    },
  };

  return { pool, binding };
}
