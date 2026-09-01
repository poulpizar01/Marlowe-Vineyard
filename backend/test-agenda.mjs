/* Banc d'essai du rappel d'agenda — trois heures avant l'événement.
   ---------------------------------------------------------------------------
   Discord n'est jamais appelé pour de vrai : un essai qui poste écrirait dans
   un salon que toute l'équipe lit. L'appel est remplacé par un faux qui note
   ce qu'on lui a demandé d'envoyer.

   Le message part par le BOT, pas par un webhook : un identifiant de salon
   n'est pas un secret, et le jeton du bot est déjà posé. Une autorisation de
   moins à faire circuler.

   Ce qui est vérifié, et pourquoi chaque point est là :

   · l'heure de l'agenda est celle de PARIS. Le Worker tourne en UTC : sans
     conversion, un événement de 18 h partirait avec deux heures d'écart l'été
     et une l'hiver. Les deux saisons sont éprouvées, et une semaine qui
     enjambe le changement d'heure aussi ;

   · seuls les événements COMMERCIAUX déclenchent un rappel. Un événement
     privé annoncé dans un salon serait une fuite, pas un service ;

   · la fenêtre : trop tôt on ne dit rien, trop tard non plus. Un événement
     créé moins de trois heures avant son début ne réveille personne ;

   · un rappel déjà parti ne repart pas, même si le passage périodique
     revient — c'est ce qui sépare un rappel d'un harcèlement ;

   · un envoi qui échoue RETIRE la marque, pour que le passage suivant
     retente. Sans ça, une panne Discord de trente secondes perdrait le
     rappel définitivement ;

   · les QUATRE rôles sont mentionnés, avec l'autorisation « allowed_mentions »
     qui va avec : sans elle, Discord accepte le message et ne réveille
     personne, en silence, avec un code 200 — le défaut exact déjà rencontré
     sur le rappel de permis. Et @everyone reste interdit, même écrit dans le
     titre d'un événement ;

   · sans salon déclaré, la fonction se tait au lieu de lever une erreur :
     le domaine a le droit de ne pas vouloir cette annonce.

   Lancement :  node test-agenda.mjs
*/
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const SRC = readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');
const TMP = new URL('./.essai-agenda.mjs', import.meta.url);
writeFileSync(TMP, SRC
  + '\nexport { rappelsAgenda, evenementsARappeler, instantParis, messageRappel, cleRappel,'
  + ' rolesAgenda, RAPPEL_AVANT_MS, RAPPEL_FENETRE_MS };\n');
const W = await import(TMP.href);

let ok = 0, ko = 0;
const dit = (nom, vrai, detail) => {
  if (vrai) { ok++; console.log('  ✓', nom); }
  else { ko++; console.log('  ✗', nom, detail === undefined ? '' : '→ ' + JSON.stringify(detail)); }
};

const SALON = '1509337025663471676';
const ROLES = ['943582598641381484', '943583588581003365',
               '1360832465211490317', '1496532772326604881'];

/* Un env porteur d'une base en mémoire : la vraie n'est jamais touchée. */
function faireEnv(agenda, opts = {}) {
  const kv = new Map();
  const envois = [];
  const env = {
    DISCORD_BOT_TOKEN: 'jeton-de-test',
    DISCORD_AGENDA_CHANNEL: opts.salon === undefined ? SALON : opts.salon,
    DISCORD_AGENDA_ROLES: opts.roles === undefined ? ROLES.join(',') : opts.roles,
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (/SELECT val FROM kv/.test(sql)) {
                  const v = kv.get(args[0]);
                  return v === undefined ? null : { val: v };
                }
                return null;
              },
              async run() {
                if (/INSERT INTO kv/.test(sql)) kv.set(args[0], args[1]);
                else if (/DELETE FROM kv/.test(sql)) kv.delete(args[0]);
              },
              async all() { return { results: [] }; },
            };
          },
        };
      },
    },
  };
  kv.set('data', JSON.stringify({ agenda }));
  return { env, kv, envois };
}

/* jj/mm/aaaa + HH:MM à Paris, pour fabriquer un événement à N heures d'ici. */
function dansNHeures(n, base) {
  const t = (base === undefined ? Date.now() : base) + n * 3600 * 1000;
  const p = new Date(t).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' });
  const [d, h] = p.split(' ');
  const [aa, mm, jj] = d.split('-');
  return { date: `${jj}/${mm}/${aa}`, heure: h.slice(0, 5) };
}

const ev = (n, vis, titre, base) => {
  const q = dansNHeures(n, base);
  return { title: titre || 'Dégustation', date: q.date, heure: q.heure,
           heure_fin: '23:00', vis: vis || 'commercial', desc: 'client' };
};

console.log('\n— L\'heure de Paris —');
{
  /* 15 janvier 2026, 18:00 Paris = 17:00 UTC (heure d'hiver, +1). */
  const hiver = W.instantParis('15/01/2026', '18:00');
  dit('un événement d\'hiver à 18 h vaut 17 h UTC',
      new Date(hiver).toISOString() === '2026-01-15T17:00:00.000Z',
      new Date(hiver).toISOString());

  /* 15 juillet 2026, 18:00 Paris = 16:00 UTC (heure d'été, +2). */
  const ete = W.instantParis('15/07/2026', '18:00');
  dit('un événement d\'été à 18 h vaut 16 h UTC',
      new Date(ete).toISOString() === '2026-07-15T16:00:00.000Z',
      new Date(ete).toISOString());

  /* Le dimanche 29 mars 2026 à 2 h, Paris passe de +1 à +2. Un événement du
     samedi soir et un du dimanche soir ne tombent pas sur le même décalage. */
  const avant = W.instantParis('28/03/2026', '20:00');
  const apres = W.instantParis('29/03/2026', '20:00');
  dit('le changement d\'heure est pris en compte des deux côtés',
      new Date(avant).toISOString() === '2026-03-28T19:00:00.000Z'
      && new Date(apres).toISOString() === '2026-03-29T18:00:00.000Z',
      [new Date(avant).toISOString(), new Date(apres).toISOString()]);

  dit('une date illisible ne casse rien', W.instantParis('pas une date', '18:00') === null);
  dit('une heure illisible ne casse rien', W.instantParis('15/01/2026', 'midi') === null);
}

console.log('\n— La fenêtre —');
{
  const t = Date.now();
  const pris = W.evenementsARappeler([
    ev(3, 'commercial', 'Pile trois heures'),
    ev(3.05, 'commercial', 'Trop tôt'),
    ev(2.9, 'commercial', 'Encore dans la fenêtre'),
    ev(2.7, 'commercial', 'Fenêtre refermée'),
    ev(0.5, 'commercial', 'Dans trente minutes'),
    ev(-2, 'commercial', 'Déjà passé'),
  ], t).map(e => e.title);

  dit('l\'événement à trois heures est retenu', pris.includes('Pile trois heures'), pris);
  dit('celui à plus de trois heures attend', !pris.includes('Trop tôt'), pris);
  dit('la fenêtre rattrape un passage manqué', pris.includes('Encore dans la fenêtre'), pris);
  dit('au-delà de dix minutes de retard, on renonce', !pris.includes('Fenêtre refermée'), pris);
  dit('un événement créé trop tard ne réveille personne', !pris.includes('Dans trente minutes'), pris);
  dit('un événement passé ne réveille personne', !pris.includes('Déjà passé'), pris);
  dit('la fenêtre fait bien dix minutes', W.RAPPEL_FENETRE_MS === 10 * 60 * 1000);
  dit('le rappel part bien trois heures avant', W.RAPPEL_AVANT_MS === 3 * 3600 * 1000);
}

console.log('\n— Seuls les événements commerciaux —');
{
  const pris = W.evenementsARappeler([
    ev(3, 'commercial', 'Commercial'),
    ev(3, 'direction', 'Direction'),
    ev(3, 'public', 'Public'),
    ev(3, 'prive', 'Privé'),
    ev(3, 'tous', 'Tous'),
  ], Date.now()).map(e => e.title);
  dit('le commercial passe', pris.includes('Commercial'), pris);
  dit('la direction ne passe pas', !pris.includes('Direction'), pris);
  dit('le public ne passe pas', !pris.includes('Public'), pris);
  dit('le privé ne passe pas — ce serait une fuite', !pris.includes('Privé'), pris);
  dit('un seul événement retenu sur cinq', pris.length === 1, pris);
}

console.log('\n— Le message —');
{
  const e = { title: 'Dégustation `@everyone`', date: '03/09/2026', heure: '18:00',
              heure_fin: '20:00', desc: 'Villa privatisée @here', vis: 'commercial' };
  const tete = ROLES.map(r => `<@&${r}>`).join(' ') + ' ';
  const m = W.messageRappel(e, tete);
  dit('les quatre rôles sont mentionnés en tête', m.startsWith(tete), m.slice(0, 90));
  dit('le titre y est', m.includes('Dégustation'), m);
  dit('les heures y sont', m.includes('18:00 – 20:00'), m);
  dit('la date y est', m.includes('03/09/2026'), m);
  dit('« @ » et « ` » sont neutralisés — pas d\'everyone par la bande',
      !m.slice(tete.length).includes('@') && !m.includes('`'), m);
  const sansDesc = W.messageRappel({ title: 'X', date: '03/09/2026', heure: '18:00' }, '');
  dit('sans description, le message tient debout quand même',
      sansDesc.includes('pas de description'), sansDesc);
}

console.log('\n— La liste des rôles —');
{
  dit('les quatre identifiants sont lus',
      W.rolesAgenda({ DISCORD_AGENDA_ROLES: ROLES.join(',') }).join(',') === ROLES.join(','));
  dit('les espaces et virgules en trop sont absorbés',
      W.rolesAgenda({ DISCORD_AGENDA_ROLES: ` ${ROLES[0]} , ,${ROLES[1]}, ` }).length === 2);
  dit('un nom de rôle glissé par erreur est écarté',
      W.rolesAgenda({ DISCORD_AGENDA_ROLES: `Responsable Commercial,${ROLES[0]}` }).length === 1);
  dit('un réglage vide ne donne aucun rôle',
      W.rolesAgenda({ DISCORD_AGENDA_ROLES: '' }).length === 0);
  dit('un réglage absent ne casse rien', W.rolesAgenda({}).length === 0);
}

console.log('\n— L\'envoi —');
{
  const vraiFetch = globalThis.fetch;

  /* 1. envoi nominal */
  let appels = [];
  const espion = (reponse) => async (url, init) => {
    appels.push({ url, init, body: JSON.parse(init.body) });
    return Object.assign({ async json() { return {}; } }, reponse);
  };
  globalThis.fetch = espion({ ok: true, status: 204 });
  let { env, kv } = faireEnv([ev(3, 'commercial', 'Dégustation Ansaldi')]);
  let r = await W.rappelsAgenda(env);
  dit('un rappel part', r.envoyes === 1 && appels.length === 1, r);
  dit('il part dans le salon déclaré',
      appels[0] && appels[0].url.endsWith(`/channels/${SALON}/messages`), appels[0] && appels[0].url);
  dit('il part avec le jeton du bot',
      appels[0] && appels[0].init.headers.Authorization === 'Bot jeton-de-test');
  dit('l\'autorisation de mention porte les quatre rôles',
      appels[0] && appels[0].body.allowed_mentions
      && appels[0].body.allowed_mentions.roles.join(',') === ROLES.join(','),
      appels[0] && appels[0].body.allowed_mentions);
  dit('rien ne peut mentionner @everyone',
      appels[0] && appels[0].body.allowed_mentions.parse.length === 0);

  /* 2. le même passage rejoué ne renvoie rien */
  appels = [];
  r = await W.rappelsAgenda(env);
  dit('un rappel déjà parti ne repart pas', r.envoyes === 0 && appels.length === 0, r);

  /* 3. envoi qui échoue : la marque est retirée, le passage suivant retente */
  appels = [];
  globalThis.fetch = espion({ ok: false, status: 500 });
  const e2 = faireEnv([ev(3, 'commercial', 'Location mariage')]);
  r = await W.rappelsAgenda(e2.env);
  dit('un envoi refusé ne compte pas comme envoyé', r.envoyes === 0, r);
  dit('la marque est retirée après un échec',
      !e2.kv.has(W.cleRappel(ev(3, 'commercial', 'Location mariage'))),
      [...e2.kv.keys()]);

  appels = [];
  globalThis.fetch = espion({ ok: true, status: 200 });
  r = await W.rappelsAgenda(e2.env);
  dit('le passage suivant retente et réussit', r.envoyes === 1 && appels.length === 1, r);

  /* 4. Discord injoignable : la fonction ne lève pas */
  globalThis.fetch = async () => { throw new Error('réseau coupé'); };
  const e3 = faireEnv([ev(3, 'commercial', 'Réseau coupé')]);
  let leve = false;
  try { r = await W.rappelsAgenda(e3.env); } catch (err) { leve = true; }
  dit('un réseau coupé ne fait pas tomber le passage périodique', !leve && r.envoyes === 0, r);

  /* 5. pas de salon déclaré */
  globalThis.fetch = async () => { throw new Error('ne devrait pas être appelé'); };
  const e4 = faireEnv([ev(3, 'commercial', 'Sans salon')], { salon: '' });
  r = await W.rappelsAgenda(e4.env);
  dit('sans salon, la fonction se tait au lieu d\'échouer',
      r.envoyes === 0 && r.raison === 'pas_de_salon', r);

  const e5 = faireEnv([ev(3, 'commercial', 'Salon mal collé')], { salon: 'le-salon-commercial' });
  r = await W.rappelsAgenda(e5.env);
  dit('un nom de salon au lieu d\'un identifiant est refusé',
      r.envoyes === 0 && r.raison === 'pas_de_salon', r);

  /* 6. sans rôle déclaré, l'annonce part quand même mais sans mention */
  appels = [];
  globalThis.fetch = espion({ ok: true, status: 200 });
  const e6 = faireEnv([ev(3, 'commercial', 'Sans rôle')], { roles: '' });
  r = await W.rappelsAgenda(e6.env);
  dit('sans rôle, le rappel part quand même', r.envoyes === 1, r);
  dit('… et il ne mentionne personne',
      appels[0] && !appels[0].body.content.startsWith('<@&')
      && appels[0].body.allowed_mentions.roles.length === 0
      && appels[0].body.allowed_mentions.parse.length === 0,
      appels[0] && appels[0].body.content.slice(0, 30));

  /* 7. agenda vide */
  const e7 = faireEnv([]);
  r = await W.rappelsAgenda(e7.env);
  dit('un agenda vide ne fait rien', r.envoyes === 0, r);

  globalThis.fetch = vraiFetch;
}

unlinkSync(TMP);
console.log(`\n${ok} vérification(s) passée(s), ${ko} en échec.\n`);
process.exit(ko ? 1 : 0);
