/* Banc d'essai de la déclaration d'absence depuis l'espace personnel.
   ---------------------------------------------------------------------------
   Discord n'est jamais appelé pour de vrai. Ce qui compte ici n'est pas le
   message mais l'ÉCRITURE : une absence déclarée est une donnée RH, et le
   message n'en est que l'écho.

   Ce qui est vérifié, et pourquoi chaque point est là :

   · le nom vient de la SESSION. Un corps de requête qui porte « name » ne
     doit rien changer — sinon n'importe qui mettrait le voisin en congé ;

   · c'est le Worker qui écrit, donc sans exiger le droit sur la page
     Recrutement. Une deuxième déclaration REMPLACE la première : on corrige
     ses dates sans se retrouver avec deux lignes à son nom ;

   · la fiche du registre suit — statut, dates, motif — quand elle existe, et
     l'absence s'enregistre quand même si elle n'existe pas ;

   · les dates sont contrôlées : jj/mm/aaaa et rien d'autre, le 31 février
     compris. Une date libre arriverait au registre sous quinze formes ;

   · l'absence est écrite AVANT l'appel à Discord. Si le salon refuse, la
     réponse le dit (« annonce: false ») mais la donnée est là — l'inverse
     perdrait une information RH pour une histoire de permission de salon ;

   · un accès extérieur n'a pas d'absence à déclarer ;

   · rien ne peut mentionner @everyone, même écrit dans un motif.

   Lancement :  node test-absence.mjs
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const SRC = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const TMP = new URL('./.essai-absence.mjs', import.meta.url);
writeFileSync(TMP, SRC + '\nexport { handleAbsence, dateFRValide, messageAbsence, absenceSalon };\n');
const W = await import(TMP.href);

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};

const SALON = '1489652680765866125';

/* Le faux Discord : lecture des rôles (le Worker revérifie l'appartenance à
   chaque appel) et écriture dans un salon. */
let ENVOIS = [];
let DISCORD = { ok: true, status: 200 };
let COUPE = false;

globalThis.fetch = async (url, init) => {
  const u = String(url);
  const rep = (o, st = 200) => ({ ok: st < 300, status: st, json: async () => o });
  if (/\/guilds\/\d+\/roles$/.test(u)) return rep([{ id: '999', name: 'Patron', position: 9, managed: false }]);
  if (/\/guilds\/\d+\/members\/\d+$/.test(u)) return rep({ roles: ['999'], nick: null });
  if (/\/channels\/\d+\/messages$/.test(u)) {
    if (COUPE) throw new Error('réseau coupé');
    if (DISCORD.ok) ENVOIS.push({ url: u, body: JSON.parse(init.body) });
    return rep({ id: 'msg-1' }, DISCORD.status);
  }
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
    DISCORD_BOT_TOKEN: 'jeton-de-test',
    DISCORD_GUILD_ID: '111111111111111111',
    PATRON_ROLES: 'Patron',
    DISCORD_ABSENCE_CHANNEL: opts.salon === undefined ? SALON : opts.salon,
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

const req = (corps) => new Request('https://x/api/absence', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jeton' },
  body: JSON.stringify(corps),
});

console.log('\n— Les dates —');
{
  dit('jj/mm/aaaa passe', W.dateFRValide('03/09/2026') === '03/09/2026');
  dit('un format court est refusé', W.dateFRValide('3/9/26') === null);
  dit('le 31 février est refusé', W.dateFRValide('31/02/2026') === null);
  dit('le mois 13 est refusé', W.dateFRValide('01/13/2026') === null);
  dit('une année farfelue est refusée', W.dateFRValide('01/01/1900') === null);
  dit('du texte est refusé', W.dateFRValide('demain') === null);
  dit('le 29 février d\'une bissextile passe', W.dateFRValide('29/02/2028') === '29/02/2028');
}

console.log('\n— Le message —');
{
  const m = W.messageAbsence('Nella `@everyone`', '03/09 → 10/09', 'Congé @here');
  dit('le nom y est', m.includes('Nella'), m);
  dit('les dates y sont', m.includes('03/09 → 10/09'), m);
  dit('le motif y est', m.includes('Congé'), m);
  dit('« @ » et « ` » sont neutralisés', !m.includes('@') && !m.includes('`'), m);
}

console.log('\n— L\'écriture au registre —');
{
  ENVOIS = []; DISCORD = { ok: true, status: 200 }; COUPE = false;
  const e = faireEnv({
    rhAbsences: [{ name: 'Quelqu\'un d\'autre', range: '01/09 → 05/09', indef: false }],
    rhRoster: [{ id: 7, name: 'Nella Valmora', poste: 'DRH', status: 'actif' }],
  });
  let r = await W.handleAbsence(req({ du: '03/09/2026', au: '10/09/2026', motif: 'Congé' }), e.env);
  let d = await r.json();
  dit('la déclaration est acceptée', r.status === 200 && d.ok === true, d);
  dit('le salon a été prévenu', d.annonce === true, d);

  let apres = e.lire();
  dit('l\'absence est inscrite au registre',
      apres.rhAbsences.some(a => a.name === 'Nella Valmora' && a.range === '03/09 → 10/09'),
      apres.rhAbsences);
  dit('celle de quelqu\'un d\'autre n\'a pas bougé',
      apres.rhAbsences.some(a => a.name === "Quelqu'un d'autre"), apres.rhAbsences);
  dit('la fiche du registre passe en absent',
      apres.rhRoster[0].status === 'absent' && apres.rhRoster[0].absence === '03/09 → 10/09',
      apres.rhRoster[0]);
  dit('le message part dans le salon déclaré',
      ENVOIS[0] && ENVOIS[0].url.endsWith(`/channels/${SALON}/messages`), ENVOIS[0] && ENVOIS[0].url);
  dit('rien ne peut mentionner @everyone',
      ENVOIS[0] && ENVOIS[0].body.allowed_mentions.parse.length === 0);

  /* Deuxième déclaration : elle remplace, elle ne s'empile pas. */
  e.kv.delete('absence:42');            /* on saute le garde-fou de cinq minutes */
  r = await W.handleAbsence(req({ du: '04/09/2026', au: '12/09/2026', motif: 'Examens' }), e.env);
  d = await r.json();
  apres = e.lire();
  const miennes = apres.rhAbsences.filter(a => a.name === 'Nella Valmora');
  dit('une correction remplace au lieu de s\'empiler', miennes.length === 1, apres.rhAbsences);
  dit('… et ce sont les nouvelles dates', miennes[0].range === '04/09 → 12/09', miennes[0]);

  /* Retour indéfini */
  e.kv.delete('absence:42');
  r = await W.handleAbsence(req({ du: '05/09/2026', indef: true }), e.env);
  d = await r.json();
  apres = e.lire();
  const ind = apres.rhAbsences.find(a => a.name === 'Nella Valmora');
  dit('le retour indéfini est accepté', r.status === 200 && ind.indef === true, ind);
  dit('… et s\'écrit « indéfini »', ind.range === '05/09 → indéfini', ind);

}

console.log('\n— Ce qui est refusé —');
{
  DISCORD = { ok: true, status: 200 }; COUPE = false;

  let e = faireEnv({ rhAbsences: [], rhRoster: [] });
  let r = await W.handleAbsence(req({ du: 'demain', au: '10/09/2026' }), e.env);
  dit('une date de départ illisible est refusée', r.status === 400);
  dit('… et rien n\'a été écrit', e.lire().rhAbsences.length === 0);

  e = faireEnv({ rhAbsences: [], rhRoster: [] });
  r = await W.handleAbsence(req({ du: '03/09/2026' }), e.env);
  dit('sans date de retour ni « indéfini », c\'est refusé', r.status === 400);

  e = faireEnv({ rhAbsences: [], rhRoster: [] });
  r = await W.handleAbsence(new Request('https://x/api/absence', { method: 'GET' }), e.env);
  dit('un GET est refusé', r.status === 405);

  e = faireEnv({ rhAbsences: [], rhRoster: [] }, { invite: { code: 'MV-XX', pages: [], ro: [] } });
  r = await W.handleAbsence(req({ du: '03/09/2026', au: '10/09/2026' }), e.env);
  dit('un accès extérieur ne peut pas déclarer d\'absence', r.status === 403);

  /* Le nom du corps de la requête est ignoré. */
  e = faireEnv({ rhAbsences: [], rhRoster: [] });
  r = await W.handleAbsence(req({ du: '03/09/2026', au: '10/09/2026', name: 'Le Voisin' }), e.env);
  const noms = e.lire().rhAbsences.map(a => a.name);
  dit('le nom du corps de la requête est ignoré',
      noms.includes('Nella Valmora') && !noms.includes('Le Voisin'), noms);

  /* Deux déclarations coup sur coup */
  e = faireEnv({ rhAbsences: [], rhRoster: [] });
  await W.handleAbsence(req({ du: '03/09/2026', au: '10/09/2026' }), e.env);
  r = await W.handleAbsence(req({ du: '04/09/2026', au: '11/09/2026' }), e.env);
  dit('deux déclarations coup sur coup : la seconde attend', r.status === 429);
}

console.log('\n— Quand Discord ne répond pas —');
{
  DISCORD = { ok: false, status: 403 }; COUPE = false;
  let e = faireEnv({ rhAbsences: [], rhRoster: [] });
  let r = await W.handleAbsence(req({ du: '03/09/2026', au: '10/09/2026' }), e.env);
  let d = await r.json();
  dit('un salon interdit ne fait pas échouer la déclaration', r.status === 200 && d.ok === true, d);
  dit('… la réponse dit que le salon n\'a pas été prévenu', d.annonce === false, d);
  dit('… et l\'absence est bien au registre', e.lire().rhAbsences.length === 1, e.lire().rhAbsences);

  COUPE = true;
  e = faireEnv({ rhAbsences: [], rhRoster: [] });
  r = await W.handleAbsence(req({ du: '03/09/2026', au: '10/09/2026' }), e.env);
  d = await r.json();
  dit('un réseau coupé ne perd pas l\'absence',
      r.status === 200 && d.ok === true && d.annonce === false, d);

  COUPE = false; DISCORD = { ok: true, status: 200 };
  e = faireEnv({ rhAbsences: [], rhRoster: [] }, { salon: '' });
  r = await W.handleAbsence(req({ du: '03/09/2026', au: '10/09/2026' }), e.env);
  d = await r.json();
  dit('sans salon déclaré, l\'absence s\'enregistre quand même',
      r.status === 200 && d.ok === true && d.raison === 'pas_de_salon', d);
}

console.log('\n— Sans fiche au registre —');
{
  DISCORD = { ok: true, status: 200 }; COUPE = false;
  const e = faireEnv({ rhAbsences: [], rhRoster: [{ id: 1, name: 'Un Autre', status: 'actif' }] });
  const r = await W.handleAbsence(req({ du: '03/09/2026', au: '10/09/2026' }), e.env);
  dit('une personne sans fiche déclare quand même son absence',
      r.status === 200 && e.lire().rhAbsences.length === 1, e.lire().rhAbsences);
  dit('… et la fiche des autres n\'est pas touchée',
      e.lire().rhRoster[0].status === 'actif', e.lire().rhRoster[0]);
}

unlinkSync(TMP);
console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
