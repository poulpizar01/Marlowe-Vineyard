# Migrations de la base

Un fichier par changement de structure, appliqué **une fois** au démarrage
du serveur, dans l'ordre des numéros, et inscrit dans la table `migrations`
(voir `appliquerMigrations` dans `src/db.js`). Au démarrage suivant, seuls
les nouveaux fichiers passent.

`schema.sql`, lui, crée les tables de base (`kv`, `ventes`) et se rejoue à
chaque démarrage sans rien casser. Les migrations servent à ce que
`CREATE TABLE IF NOT EXISTS` ne sait pas faire : ajouter une colonne, un
index, transformer des données.

## Écrire une migration

- Nom : `NNNN_description.sql`, quatre chiffres puis un tiret bas, par
  exemple `0001_index_ventes_job.sql`. Le numéro fixe l'ordre.
- Une instruction par point-virgule, sans point-virgule dans une chaîne.
- **Rejouable sans dommage** : `ADD COLUMN IF NOT EXISTS`, `DROP INDEX IF
  EXISTS`… MariaDB n'annule pas un `ALTER` dans une transaction : une
  migration qui échoue à mi-chemin n'est pas inscrite et sera relancée au
  démarrage suivant. Elle doit donc pouvoir repartir de l'état où elle s'est
  arrêtée.
- Ne jamais modifier un fichier déjà appliqué en production : en écrire un
  nouveau.

## Vérifier

```sql
SELECT nom, applique_le FROM migrations ORDER BY nom;
```

Le journal du serveur affiche `[db] migration appliquée : …` pour chaque
fichier passé au démarrage.
