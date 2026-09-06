/* Banc d'essai de la connexion FolkOS (le SSO du serveur de jeu).
   ---------------------------------------------------------------------------
   C'est une route d'AUTHENTIFICATION : elle décide qui entre dans le panel RH
   du domaine. Chaque point ci-dessous correspond à une façon d'y entrer sans
   en avoir le droit, ou de s'en faire refuser l'entrée à tort.

   Ce qui est vérifié :

   · le TICKET n'est jamais cru sur parole. Il arrive par l'URL, donc du
     navigateur, donc de n'importe qui. Seule la réponse de FolkOS — obtenue
     serveur à serveur, avec notre secret — dit qui est là. Un ticket que
     FolkOS refuse n'ouvre rien, même bien formé ;

   · le secret ne fuit pas dans l'URL : il part dans le CORPS de l'appel, en
     POST. Un secret en paramètre d'URL se retrouve dans les journaux d'accès
     de tous les intermédiaires ;

   · aucun compte n'est créé. Un SSO dit « c'est bien untel », pas « untel a
     le droit d'entrer ». Un joueur inconnu du registre est refusé — sans
     cette règle, n'importe quel joueur du serveur ouvrirait les fiches RH ;

   · la session délivrée est EXACTEMENT celle de la voie Discord : même forme,
     même durée. Une seule sorte de session à sécuriser ;

   · unique_id est un ENTIER côté FolkOS et du texte chez nous. La conversion
     doit être faite, sinon la comparaison échoue en silence et l'employé se
     voit refuser l'entrée sans comprendre ;

   · une configuration incomplète, ou un FolkOS injoignable, donne une page
     lisible — pas une erreur brute ni une redirection vers le vide.

   Lancement :  node test-folkos.mjs
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const SRC = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const TMP = new URL('./.essai-folkos.mjs', import.meta.url);
writeFileSync(TMP, SRC + '\nexport { handleFolkos, originesAutorisees, allowedOrigin, ajusterCors };\n');
const W = await import(TMP.href);

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};

/* --- Le faux FolkOS et le faux Discord ----------------------------------- */
let APPELS = [];
let REPONSE = { ok: true, corps: null };

globalThis.fetch = async (url, init) => {
  const u = String(url);
  const rep = (o, st = 200) => ({ ok: st < 300, status: st, json: async () => o });
  if (/\/sso\/verify$/.test(u)) {
    APPELS.push({ url: u, methode: init && init.method, corps: JSON.parse(init.body) });
    if (REPONSE.reseau) throw new Error('FolkOS injoignable');
    return rep(REPONSE.corps, REPONSE.ok ? 200 : 401);
  }
  if (/\/guilds\/\d+\/roles$/.test(u)) return rep([{ id: '9', name: 'Patron', managed: false }]);
  if (/\/guilds\/\d+\/members\/\d+$/.test(u)) return rep({ roles: ['9'], nick: null });
  throw new Error('appel non simulé : ' + u);
};

const ROSTER = [
  { id: '482913', name: 'Julio Cortès', poste: 'Ouvrier Viticole', discord: '111222333444555666' },
  { id: '482914', name: 'Léa Fontaine', poste: 'DRH', discord: '' , uid: '4242' },
];

function faireEnv(opts = {}) {
  const kv = new Map();
  kv.set('data', JSON.stringify({ rhRoster: ROSTER }));
  const env = Object.assign({
    SITE_URL: 'https://marlowe-vineyard.fbfa.fr',
    DISCORD_GUILD_ID: '111111111111111111',
    DISCORD_BOT_TOKEN: 'jeton',
    OWNER_IDS: '826526979204841482',
    FOLKOS_ID_BASE: 'https://id.fbfa.fr/',
    FOLKOS_CLIENT_ID: 'client-abc',
    FOLKOS_CLIENT_SECRET: 'secret-xyz',
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
  }, opts);
  return { env, kv };
}

const appeler = async (env, ticket) => {
  const u = new URL('https://api.test/api/folkos'
    + (ticket === undefined ? '' : '?folkos_ticket=' + encodeURIComponent(ticket)));
  return W.handleFolkos(new Request(u), env, u);
};

const jetonDe = r => {
  const loc = r.headers.get('Location') || '';
  const m = /#token=(.+)$/.exec(loc);
  return m ? m[1] : null;
};

/* ========================================================================== */
console.log('\n— L\'échange du ticket —');
{
  APPELS = [];
  REPONSE = { ok: true, corps: { valid: true, identity: {
    sub: 'f-1', name: 'Julio Cortes', given_name: 'Julio', family_name: 'Cortes',
    discord_id: '111222333444555666', unique_id: 7, character_id: 3,
  } } };
  const { env, kv } = faireEnv();
  const r = await appeler(env, 'TICKET-VALIDE');

  dit('FolkOS est appelé une fois', APPELS.length === 1, APPELS.length);
  dit('en POST', APPELS[0] && APPELS[0].methode === 'POST');
  dit('sur {base}/sso/verify, sans double slash',
    APPELS[0] && APPELS[0].url === 'https://id.fbfa.fr/sso/verify', APPELS[0] && APPELS[0].url);
  dit('le secret part dans le CORPS, pas dans l\'URL',
    APPELS[0] && APPELS[0].corps.client_secret === 'secret-xyz'
    && !APPELS[0].url.includes('secret-xyz'));
  dit('le ticket est transmis tel quel',
    APPELS[0] && APPELS[0].corps.token === 'TICKET-VALIDE');
  dit('le client_id accompagne le secret',
    APPELS[0] && APPELS[0].corps.client_id === 'client-abc');

  dit('la réponse est une redirection', r.status === 302, r.status);
  dit('vers le panel du domaine',
    (r.headers.get('Location') || '').startsWith('https://marlowe-vineyard.fbfa.fr/gestion.html#token='),
    r.headers.get('Location'));

  const sid = jetonDe(r);
  const sess = JSON.parse(kv.get('sess:' + sid) || 'null');
  dit('une session est ouverte', !!sess);
  dit('elle porte l\'identifiant DISCORD, pas celui de FolkOS',
    sess && sess.id === '111222333444555666', sess && sess.id);
  dit('elle porte le nom du REGISTRE, pas celui du jeu',
    sess && sess.name === 'Julio Cortès', sess && sess.name);
  dit('elle est marquée comme venant de FolkOS', sess && sess.via === 'folkos');
}

console.log('\n— Ce qui ne doit ouvrir AUCUNE session —');
{
  const essais = [
    ['aucun ticket', undefined, { valid: true, identity: { discord_id: '111222333444555666' } }],
    ['un ticket vide', '', { valid: true, identity: { discord_id: '111222333444555666' } }],
    ['FolkOS répond valid:false', 'T', { valid: false, error: 'expired' }],
    ['FolkOS répond sans identité', 'T', { valid: true }],
    ['FolkOS répond n\'importe quoi', 'T', null],
  ];
  for (const [titre, ticket, corps] of essais) {
    REPONSE = { ok: true, corps };
    const { env, kv } = faireEnv();
    const r = await appeler(env, ticket);
    const sessions = [...kv.keys()].filter(k => k.startsWith('sess:'));
    dit(titre + ' → refusé', r.status !== 302 && sessions.length === 0,
      { status: r.status, sessions: sessions.length });
  }

  REPONSE = { ok: false, corps: { valid: false } };
  {
    const { env, kv } = faireEnv();
    const r = await appeler(env, 'T');
    dit('un HTTP 401 de FolkOS → refusé',
      r.status !== 302 && ![...kv.keys()].some(k => k.startsWith('sess:')));
  }

  REPONSE = { reseau: true };
  {
    const { env, kv } = faireEnv();
    const r = await appeler(env, 'T');
    /* 502 et non 403 : ce n'est pas un refus, c'est un service qui ne
       répond pas. Le code doit dire « réessayez », pas « n'insistez pas ». */
    dit('FolkOS injoignable → 502, aucune session',
      r.status === 502 && ![...kv.keys()].some(k => k.startsWith('sess:')), r.status);
    const html = await r.text();
    dit('la page propose la connexion Discord comme repli', /Discord/.test(html));
  }
}

console.log('\n— Le SSO n\'est PAS un droit d\'entrée —');
{
  REPONSE = { ok: true, corps: { valid: true, identity: {
    name: 'Passant Anonyme', discord_id: '999888777666555444', unique_id: 99,
  } } };
  const { env, kv } = faireEnv();
  const r = await appeler(env, 'T');
  dit('un joueur inconnu du registre est refusé',
    r.status !== 302 && ![...kv.keys()].some(k => k.startsWith('sess:')));
  const html = await r.text();
  dit('et on lui dit quoi faire (identifiant Discord à inscrire)',
    /identifiant Discord/i.test(html));

  /* Le développeur, lui, doit pouvoir entrer sans fiche : c'est le trousseau
     de secours, celui qui permet de réparer un registre cassé. */
  REPONSE = { ok: true, corps: { valid: true, identity: {
    name: 'Thomas', discord_id: '826526979204841482', unique_id: 1,
  } } };
  const b = faireEnv();
  const r2 = await appeler(b.env, 'T');
  dit('un compte OWNER_IDS entre même sans fiche', r2.status === 302, r2.status);
}

console.log('\n— unique_id est un entier, notre registre du texte —');
{
  REPONSE = { ok: true, corps: { valid: true, identity: {
    name: 'Léa', discord_id: '111222333444555666', unique_id: 4242,
  } } };
  const { env, kv } = faireEnv();
  const r = await appeler(env, 'T');
  dit('un entier ne fait pas échouer la recherche', r.status === 302, r.status);

  /* unique_id = 0 est une valeur, pas une absence : la confondre avec « vide »
     exclurait le tout premier joueur enregistré. */
  REPONSE = { ok: true, corps: { valid: true, identity: {
    name: 'Zéro', discord_id: '', unique_id: 0,
  } } };
  const c = faireEnv();
  const r3 = await appeler(c.env, 'T');
  dit('unique_id = 0 est traité comme une valeur, pas comme vide',
    r3.status !== 302, r3.status);
}

console.log('\n— Sans identifiant Discord, pas de droits —');
{
  REPONSE = { ok: true, corps: { valid: true, identity: {
    name: 'Léa Fontaine', unique_id: 4242,
  } } };
  const { env, kv } = faireEnv();
  const r = await appeler(env, 'T');
  dit('la fiche est trouvée par unique_id mais l\'entrée est refusée',
    r.status !== 302, r.status);
  const html = await r.text();
  dit('et la page explique pourquoi', /Discord/.test(html));
}

console.log('\n— Une configuration incomplète se voit tout de suite —');
{
  for (const manquante of ['FOLKOS_ID_BASE', 'FOLKOS_CLIENT_ID', 'FOLKOS_CLIENT_SECRET']) {
    const { env } = faireEnv({ [manquante]: '' });
    const r = await appeler(env, 'T');
    const html = await r.text();
    dit(`${manquante} manquant → la page le nomme`, html.includes(manquante));
  }
}

console.log('\n— Les origines autorisées, pendant le déménagement —');
{
  const env = {
    SITE_URL: 'https://marlowe-vineyard.fbfa.fr',
    SITE_URLS: 'https://poulpizar01.github.io, https://marlowe-vineyard.fbfa.fr',
  };
  const liste = W.originesAutorisees(env);
  dit('les deux adresses sont autorisées', liste.length === 2, liste);
  dit('sans doublon même si SITE_URL y figure aussi',
    new Set(liste).size === liste.length);

  const avec = o => new Request('https://api/x', { headers: o ? { Origin: o } : {} });
  dit('l\'ancienne adresse reçoit sa propre origine',
    W.allowedOrigin(env, avec('https://poulpizar01.github.io')) === 'https://poulpizar01.github.io');
  dit('la nouvelle aussi',
    W.allowedOrigin(env, avec('https://marlowe-vineyard.fbfa.fr')) === 'https://marlowe-vineyard.fbfa.fr');
  dit('une origine inconnue ne se voit PAS renvoyer la sienne',
    W.allowedOrigin(env, avec('https://mechant.example')) !== 'https://mechant.example');
  dit('un appel sans Origin retombe sur l\'adresse principale',
    W.allowedOrigin(env, avec(null)) === 'https://marlowe-vineyard.fbfa.fr');
  dit('une entrée illisible est ignorée sans tout casser',
    W.originesAutorisees({ SITE_URL: 'https://a.fr', SITE_URLS: 'pas une url,,https://b.fr' })
      .join('|') === 'https://a.fr|https://b.fr');

  /* La correction en sortie doit reposer l'en-tête ET Vary. */
  const rep = new Response('{}', { headers: { 'Access-Control-Allow-Origin': 'https://marlowe-vineyard.fbfa.fr' } });
  const corrigee = W.ajusterCors(rep, avec('https://poulpizar01.github.io'), env);
  dit('la réponse ressort avec l\'origine de l\'appelant',
    corrigee.headers.get('Access-Control-Allow-Origin') === 'https://poulpizar01.github.io');
  dit('et avec Vary: Origin, sans quoi un cache mélangerait les deux',
    corrigee.headers.get('Vary') === 'Origin');
}

unlinkSync(TMP);
console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
