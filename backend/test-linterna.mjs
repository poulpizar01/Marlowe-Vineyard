/* Banc d'essai de la récolte Linterna.
   ---------------------------------------------------------------------------
   Ce nombre vaut de l'argent : chaque raisin s'ajoute à la prime de la
   semaine. C'est donc l'ÉCRITURE qui est éprouvée ici, et surtout qui a le
   droit d'écrire quoi.

   Ce qui est vérifié, et pourquoi chaque point est là :

   · le nom vient de la SESSION, jamais du corps de la requête. On ne déclare
     que sa propre récolte — un « name » glissé dans l'appel est ignoré ;

   · le mode « ajout » s'additionne, le mode « total » remplace. Sans le
     second, un 500 tapé à la place de 50 resterait au dossier jusqu'à la
     clôture ;

   · un ajout négatif est refusé — c'est le mode « total » qui corrige à la
     baisse, et l'erreur le dit ;

   · un garde-fou plafonne les chiffres absurdes : au-delà, c'est une faute
     de frappe, pas une récolte ;

   · la récolte de quelqu'un d'autre n'est jamais touchée ;

   · un accès extérieur ne récolte pas.

   Lancement :  node test-linterna.mjs
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const SRC = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const TMP = new URL('./.essai-linterna.mjs', import.meta.url);
writeFileSync(TMP, SRC + '\nexport { handleLinterna, RAISINS_MAX };\n');
const W = await import(TMP.href);

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};

globalThis.fetch = async (url) => {
  const u = String(url);
  const rep = (o, st = 200) => ({ ok: st < 300, status: st, json: async () => o });
  if (/\/guilds\/\d+\/roles$/.test(u)) return rep([{ id: '9', name: 'Patron', position: 9, managed: false }]);
  if (/\/guilds\/\d+\/members\/\d+$/.test(u)) return rep({ roles: ['9'], nick: null });
  throw new Error('appel Discord non simulé : ' + u);
};

function faireEnv(data, opts = {}) {
  const kv = new Map();
  kv.set('data', JSON.stringify(data));
  kv.set('journal', JSON.stringify([]));
  kv.set('invites', JSON.stringify([{ code: 'MV-XX', nom: 'Le Comptable', actif: true, pages: [], ro: [] }]));
  kv.set('sess:jeton', JSON.stringify(opts.invite
    ? { invite: true, code: 'MV-XX', id: 'inv:MV-XX' }
    : { id: '42', name: opts.nom === undefined ? 'Nella Valmora' : opts.nom }));
  const env = {
    DISCORD_BOT_TOKEN: 'x', DISCORD_GUILD_ID: '111111111111111111', PATRON_ROLES: 'Patron',
    DB: { prepare(sql) { return { bind(...a) { return {
      async first() {
        if (/SELECT val FROM kv/.test(sql)) { const v = kv.get(a[0]); return v === undefined ? null : { val: v }; }
        return null;
      },
      async run() {
        if (/INSERT INTO kv/.test(sql)) kv.set(a[0], a[1]);
        else if (/DELETE FROM kv/.test(sql)) kv.delete(a[0]);
      },
      async all() { return { results: [] }; },
    }; } }; } },
  };
  return { env, kv, lire: () => JSON.parse(kv.get('data')) };
}

const req = (corps) => new Request('https://x/api/linterna', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jeton' },
  body: JSON.stringify(corps),
});

console.log('\n— Ajouter —');
{
  const e = faireEnv({ linterna: [{ name: 'Quelqu\'un d\'autre', raisins: 90 }] });
  let r = await W.handleLinterna(req({ raisins: 50 }), e.env);
  let d = await r.json();
  dit('un premier ajout passe', r.status === 200 && d.total === 50, d);
  dit('… et il part de zéro', d.avant === 0, d);

  r = await W.handleLinterna(req({ raisins: 30 }), e.env);
  d = await r.json();
  dit('un second ajout s\'additionne', d.total === 80 && d.avant === 50, d);

  const l = e.lire().linterna;
  dit('la ligne porte le nom de la session', l.some(x => x.name === 'Nella Valmora' && x.raisins === 80), l);
  dit('la récolte de quelqu\'un d\'autre n\'a pas bougé',
      l.some(x => x.name === "Quelqu'un d'autre" && x.raisins === 90), l);
  dit('une seule ligne par personne', l.filter(x => x.name === 'Nella Valmora').length === 1, l);
}

console.log('\n— Corriger —');
{
  const e = faireEnv({ linterna: [] });
  await W.handleLinterna(req({ raisins: 500 }), e.env);
  let r = await W.handleLinterna(req({ raisins: 50, mode: 'total' }), e.env);
  let d = await r.json();
  dit('le mode « total » remplace au lieu d\'ajouter', d.total === 50, d);
  dit('… et l\'ancien total est rappelé', d.avant === 500, d);

  r = await W.handleLinterna(req({ raisins: 0, mode: 'total' }), e.env);
  d = await r.json();
  dit('on peut remettre son total à zéro', r.status === 200 && d.total === 0, d);
}

console.log('\n— Ce qui est refusé —');
{
  let e = faireEnv({ linterna: [] });
  let r = await W.handleLinterna(req({ raisins: -10 }), e.env);
  dit('un ajout négatif est refusé', r.status === 400);
  dit('… et rien n\'a été écrit', e.lire().linterna.length === 0);

  e = faireEnv({ linterna: [] });
  r = await W.handleLinterna(req({ raisins: -10, mode: 'total' }), e.env);
  dit('un total négatif est refusé', r.status === 400);

  e = faireEnv({ linterna: [] });
  r = await W.handleLinterna(req({ raisins: 0 }), e.env);
  dit('ajouter zéro ne sert à rien et est refusé', r.status === 400);

  e = faireEnv({ linterna: [] });
  r = await W.handleLinterna(req({ raisins: 'beaucoup' }), e.env);
  dit('un nombre illisible est refusé', r.status === 400);

  e = faireEnv({ linterna: [] });
  r = await W.handleLinterna(req({ raisins: W.RAISINS_MAX + 1 }), e.env);
  dit('un chiffre absurde est refusé par le garde-fou', r.status === 400);

  e = faireEnv({ linterna: [{ name: 'Nella Valmora', raisins: W.RAISINS_MAX - 5 }] });
  r = await W.handleLinterna(req({ raisins: 100 }), e.env);
  dit('un ajout qui ferait dépasser le garde-fou est refusé', r.status === 400);
  dit('… et le total d\'avant est intact',
      e.lire().linterna[0].raisins === W.RAISINS_MAX - 5, e.lire().linterna);

  e = faireEnv({ linterna: [] });
  r = await W.handleLinterna(new Request('https://x/api/linterna', { method: 'GET' }), e.env);
  dit('un GET est refusé', r.status === 405);

  e = faireEnv({ linterna: [] }, { invite: { code: 'MV-XX' } });
  r = await W.handleLinterna(req({ raisins: 50 }), e.env);
  dit('un accès extérieur ne récolte pas', r.status === 403);

  /* Le nom du corps de la requête est ignoré. */
  e = faireEnv({ linterna: [] });
  await W.handleLinterna(req({ raisins: 50, name: 'Le Voisin' }), e.env);
  const noms = e.lire().linterna.map(x => x.name);
  dit('le nom du corps de la requête est ignoré',
      noms.includes('Nella Valmora') && !noms.includes('Le Voisin'), noms);
}

console.log('\n— La casse du nom —');
{
  const e = faireEnv({ linterna: [{ name: 'nella valmora', raisins: 20 }] });
  const r = await W.handleLinterna(req({ raisins: 10 }), e.env);
  const d = await r.json();
  dit('une majuscule différente ne crée pas une deuxième ligne',
      e.lire().linterna.length === 1, e.lire().linterna);
  dit('… et le total s\'ajoute bien à l\'existant', d.total === 30, d);
}

unlinkSync(TMP);
console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
