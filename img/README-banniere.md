# La bannière des liens partagés

`banniere.png` — 1200 × 630 — est l'image que Discord affiche quand on colle
un lien du domaine. Sa source est `_banniere-source.html`, dans ce dossier.

## Pourquoi une source HTML plutôt qu'un PNG seul

Pour pouvoir la refaire. Un PNG dont personne ne sait d'où il vient devient
intouchable : la moindre correction — une phrase, une couleur, une date —
oblige à tout recommencer dans un éditeur d'images. Ici, la bannière reprend
les **vraies** polices du site (Fraunces, Inter), les **vraies** couleurs
d'`index.html` et le **vrai** blason. Elle ne ressemble pas au domaine : elle
en est faite.

## La régénérer

Ouvrir `_banniere-source.html` dans un navigateur, mettre la fenêtre à
exactement 1200 × 630, faire une capture. Ou, proprement, avec Playwright :

```js
const p = await b.newPage({ viewport:{width:1200,height:630}, deviceScaleFactor:2 });
await p.goto('.../img/_banniere-source.html', { waitUntil:'networkidle' });
await p.evaluate(() => document.fonts.ready);   // sinon les polices manquent
await p.screenshot({ path:'banniere-2x.png' });
// puis réduire 2400×1260 → 1200×630 : le suréchantillonnage garde les
// empattements de Fraunces nets, un rendu direct les laisse baveux.
```

`await document.fonts.ready` n'est pas facultatif : sans lui, la capture part
avant que les polices ne soient chargées et la bannière sort en Times New
Roman, ce qui ne se voit qu'une fois publiée.

## Les trois pièges de l'aperçu Discord

1. **`og:image` doit être une adresse absolue.** Un chemin relatif est ignoré
   en silence, sans image et sans erreur.

2. **Discord garde l'aperçu en cache**, plusieurs heures. Après une
   modification, recoller le même lien réaffiche l'ancienne version. Pour
   forcer : coller le lien suivi de `?v=2`, puis `v=3`, etc.

3. **Les adresses sont écrites en dur** dans `index.html` et `gestion.html`,
   sur les lignes marquées `<!-- ADRESSE -->`. Au changement de domaine, ce
   sont elles qu'il faut mettre à jour — sinon l'aperçu continue de pointer
   vers l'ancien site.

## Vérifier avant de publier

Coller l'adresse du site dans un validateur d'aperçu (par exemple
`opengraph.xyz`) : il montre ce que verront Discord, Twitter et les autres,
sans avoir à polluer un salon d'essais successifs.
