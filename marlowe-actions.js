/* ============================================================================
   MARLOWE VINEYARD — Comportements du panel
   ----------------------------------------------------------------------------
   Rend utilisables les boutons du panel : ajouts, suppressions, modifications.
   Chaque action modifie la collection concernée puis appelle
   MarloweData.save(...), qui redessine l'écran et enregistre sur le serveur.

   Tout passe par la délégation d'événements sur document : les tableaux sont
   redessinés en permanence, un écouteur posé sur un bouton disparaîtrait au
   premier réaffichage.
   ============================================================================ */

(function () {
  'use strict';

  const D = () => window.MarloweData;
  const $ = (id) => document.getElementById(id);
  const val = (id) => { const e = $(id); return e ? e.value.trim() : ''; };
  const clear = (...ids) => ids.forEach(i => { const e = $(i); if (e) e.value = ''; });

  /* ------------------------------------------------------------------------
     Dates — le panel travaille en jj/mm/aaaa
     ------------------------------------------------------------------------ */
  const pad = n => String(n).padStart(2, '0');
  const todayFR = () => { const d = new Date(); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };

  function parseFR(s) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  }

  /* Lundi 00h00 de la semaine d'une date. La semaine du domaine va du lundi
     au dimanche : en JS, dimanche vaut 0, d'où le décalage. */
  function mondayOf(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const shift = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - shift);
    return d;
  }

  const sameWeek = (a, b) => a && b && mondayOf(a).getTime() === mondayOf(b).getTime();
  const weekLabel = d => `Semaine du ${pad(mondayOf(d).getDate())}/${pad(mondayOf(d).getMonth() + 1)}`;

  /* ------------------------------------------------------------------------
     Confirmations et saisies — remplacent confirm()/prompt(), qui bloquent
     la page et rendent l'interface figée.
     ------------------------------------------------------------------------ */
  let dlg = null;

  function ensureDialog() {
    if (dlg) return dlg;
    const style = document.createElement('style');
    style.textContent = `
      .mv-dlg-back{position:fixed;inset:0;z-index:9997;background:rgba(8,7,6,.72);
        display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(3px);}
      .mv-dlg{width:100%;max-width:440px;background:#26231E;border:1px solid var(--band,#3D372C);
        border-radius:16px;padding:26px 24px;box-shadow:0 24px 70px rgba(0,0,0,.6);
        font-family:'Inter',sans-serif;color:var(--parchment,#EDE3CF);}
      .mv-dlg h3{font-family:'Fraunces',serif;font-size:18px;margin:0 0 8px;}
      /* « pre-line » : les retours à la ligne écrits dans le message sont
         rendus. Sans lui, une confirmation qui recopie un message Discord sur
         deux lignes s'affichait d'un seul bloc, et la citation devenait
         illisible. Les textes d'une seule ligne ne changent pas. */
      .mv-dlg p{font-size:13px;line-height:1.6;color:var(--muted,#9C9384);margin:0 0 18px;
        white-space:pre-line;}
      .mv-dlg label{display:block;font-size:10px;letter-spacing:.14em;text-transform:uppercase;
        color:var(--or-soft,#8E7C4E);margin:12px 0 6px;}
      .mv-dlg input,.mv-dlg select{width:100%;background:rgba(0,0,0,.25);border:1px solid var(--band,#3D372C);
        border-radius:9px;padding:10px 12px;color:var(--parchment,#EDE3CF);font-size:13.5px;font-family:inherit;}
      .mv-dlg input:focus,.mv-dlg select:focus{outline:none;border-color:var(--or,#C9A961);}
      .mv-dlg-btns{display:flex;gap:10px;justify-content:flex-end;margin-top:22px;}
      .mv-dlg-btns button{padding:10px 18px;border-radius:9px;font-size:13px;font-weight:600;
        cursor:pointer;font-family:inherit;border:1px solid var(--band,#3D372C);
        background:transparent;color:var(--muted,#9C9384);}
      .mv-dlg-btns button.go{background:var(--or,#C9A961);color:#1C1B18;border-color:var(--or,#C9A961);}
      .mv-dlg-btns button.danger{background:var(--bordeaux,#6B1F2A);color:#F3E4E4;border-color:var(--bordeaux-soft,#8A3540);}`;
    document.head.appendChild(style);

    dlg = document.createElement('div');
    dlg.className = 'mv-dlg-back';
    dlg.style.display = 'none';
    dlg.innerHTML = '<div class="mv-dlg"></div>';
    document.body.appendChild(dlg);
    dlg.addEventListener('mousedown', e => { if (e.target === dlg) close(null); });
    return dlg;
  }

  let resolver = null;
  function close(value) {
    if (!dlg) return;
    dlg.style.display = 'none';
    const r = resolver; resolver = null;
    if (r) r(value);
  }

  /* Demande confirmation. Renvoie true/false. */
  /* `danger` dit ROUGE, pas « Supprimer ».
     -------------------------------------------------------------------------
     Les deux étaient confondus : toute action rouge héritait du mot
     « Supprimer », y compris celles qui ne suppriment rien. Une rétrogradation
     demandait ainsi de cliquer sur « Supprimer » pour changer quelqu'un de
     grade — le bouton annonçait autre chose que ce qu'il faisait.

     `danger` peut donc être true (rouge, bouton « Supprimer ») ou une chaîne :
     le bouton reste rouge et porte ce mot-là. Le rouge signale que l'action ne
     se rattrape pas ; le libellé dit laquelle. */
  function confirmAction(title, message, danger) {
    ensureDialog();
    const rouge = !!danger;
    const mot = typeof danger === 'string' && danger.trim()
      ? danger.trim() : (rouge ? 'Supprimer' : 'Confirmer');
    dlg.querySelector('.mv-dlg').innerHTML = `
      <h3>${esc(title)}</h3><p>${esc(message)}</p>
      <div class="mv-dlg-btns">
        <button data-no>Annuler</button>
        <button data-yes class="${rouge ? 'danger' : 'go'}">${esc(mot)}</button>
      </div>`;
    dlg.style.display = 'flex';
    dlg.querySelector('[data-no]').onclick = () => close(false);
    dlg.querySelector('[data-yes]').onclick = () => close(true);
    return new Promise(r => { resolver = r; });
  }

  /* Formulaire. champs = [{key, label, value, type, options}]
     Renvoie un objet {key: valeur} ou null si annulé. */
  function askForm(title, fields, message) {
    ensureDialog();
    dlg.querySelector('.mv-dlg').innerHTML = `
      <h3>${esc(title)}</h3>
      ${message ? `<p>${esc(message)}</p>` : ''}
      ${fields.map(f => `
        <label for="mvf-${f.key}">${esc(f.label)}</label>
        ${f.options
          ? `<select id="mvf-${f.key}">${f.options.map(o =>
              `<option${String(o) === String(f.value) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`
          : `<input id="mvf-${f.key}" type="${f.type || 'text'}" value="${esc(f.value == null ? '' : f.value)}">`}
      `).join('')}
      <div class="mv-dlg-btns">
        <button data-no>Annuler</button>
        <button data-yes class="go">Enregistrer</button>
      </div>`;
    dlg.style.display = 'flex';
    const first = dlg.querySelector('input,select');
    if (first) setTimeout(() => first.focus(), 30);
    dlg.querySelector('[data-no]').onclick = () => close(null);
    dlg.querySelector('[data-yes]').onclick = () => {
      const out = {};
      fields.forEach(f => { const el = $('mvf-' + f.key); out[f.key] = el ? el.value.trim() : ''; });
      close(out);
    };
    return new Promise(r => { resolver = r; });
  }

  /* L'ordre alphabétique français : « Émilio » se range à E, pas après Z.
     Le tri par défaut de JavaScript compare des codes de caractères, ce qui
     rejette tous les accents en fin de liste. */
  const parNom = (a, b) => String(a).localeCompare(String(b), 'fr', { sensitivity: 'base' });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg) {
    let t = document.querySelector('.mv-toast');
    if (!t) {
      const st = document.createElement('style');
      st.textContent = `.mv-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:26px;z-index:9996;
        background:#26231E;border:1px solid var(--or-soft,#8E7C4E);color:var(--parchment,#EDE3CF);
        padding:11px 20px;border-radius:999px;font-size:13px;font-family:'Inter',sans-serif;
        box-shadow:0 10px 30px rgba(0,0,0,.45);opacity:0;transition:opacity .2s;}
        .mv-toast.on{opacity:1;}`;
      document.head.appendChild(st);
      t = document.createElement('div');
      t.className = 'mv-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('on'), 2600);
  }

  /* ========================================================================
     RH — EMPLOYÉS
     ======================================================================== */

  /* Le compteur d'effectif actif n'est calculé qu'au chargement dans le
     fichier d'origine : on le rafraîchit à chaque changement. */
  function refreshEffectifCount() {
    const el = $('rhEffectif');
    if (el) el.textContent = rhRosterData.filter(e => e.status === 'actif').length;
  }

  /* Le registre des départs ne garde que DEUX semaines.
     -------------------------------------------------------------------------
     Celle en cours et la précédente — assez pour la clôture du lundi, qui ne
     regarde jamais plus loin. Au-delà, la liste s'allongeait indéfiniment
     sans que personne ne la relise, et chaque ligne restait stockée pour
     toujours.

     L'élagage se fait sur le LIBELLÉ de semaine, celui-là même qui groupe les
     lignes à l'écran, plutôt que sur les dates des lignes : c'est le seul
     repère que porte le groupe. Ce libellé n'a pas d'année (« Semaine du
     24/08 ») ; un groupe vieux d'un an exactement pourrait donc survivre une
     semaine de plus avant de disparaître. Ça reste vrai une fois par an au
     pire, et le contenu tombe de toute façon la semaine suivante.

     Une entrée sans libellé de semaine — vieille donnée écrite à plat, que
     renderDeparts rattrape encore pour ne pas casser la page — est par
     construction plus vieille que ça : elle part aussi. */
  const DEPARTS_SEMAINES_GARDEES = 2;

  function elaguerDeparts() {
    if (typeof rhDeparts === 'undefined' || !Array.isArray(rhDeparts)) return false;

    const gardes = [];
    for (let i = 0; i < DEPARTS_SEMAINES_GARDEES; i++) {
      const d = new Date();
      d.setDate(d.getDate() - 7 * i);
      gardes.push(weekLabel(d));
    }

    const restant = rhDeparts.filter(g => g && gardes.includes(g.week));
    if (restant.length === rhDeparts.length) return false;

    rhDeparts.length = 0;
    restant.forEach(g => rhDeparts.push(g));
    return true;
  }

  /* Déclarer un départ : l'employé quitte le registre et rejoint
     l'historique des départs, groupé par semaine. */
  async function declareDeparture(id) {
    const i = rhRosterData.findIndex(e => String(e.id) === String(id));
    if (i < 0) return;
    const emp = rhRosterData[i];

    const res = await askForm('Déclarer un départ', [
      { key: 'reason', label: 'Motif', value: 'Démission',
        options: ['Démission', 'Licenciement'] },
      { key: 'date', label: 'Date du départ', value: todayFR() },
    ], `${emp.name} sera retiré du registre des employés et inscrit au registre des départs.`);
    if (!res) return;

    const d = parseFR(res.date) || new Date();
    const label = weekLabel(d);
    const row = {
      name: emp.name,
      poste: emp.poste,
      reason: res.reason,
      cls: /licenciement/i.test(res.reason) ? 'licenciement' : '',
      date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`,
    };

    let group = rhDeparts.find(g => g.week === label);
    if (group) group.rows.unshift(row);
    else rhDeparts.unshift({ week: label, rows: [row] });

    rhRosterData.splice(i, 1);
    elaguerDeparts();
    refreshEffectifCount();
    D().note(`a déclaré le départ de ${emp.name} (${res.reason})`);
    D().saveMany(['rhRoster', 'rhDeparts']);
    toast(`${emp.name} a quitté le domaine.`);
  }

  /* ========================================================================
     RH — RECRUTEMENT
     ======================================================================== */

  const initialsOf = (name) => name.split(/\s+/).filter(Boolean)
    .map(w => w[0]).join('').slice(0, 2).toUpperCase();

  /* Les deux tables ne couvraient que les cinq postes de terrain : tout le
     reste — direction, responsables, magasin — retombait sur « clay » et
     « terrain », donc sur le mauvais sceau et le mauvais filtre. */
  const DEPT_BY_POSTE = {
    'Patron': 'direction', 'Co-Patron': 'direction', 'Responsable Général': 'direction',
    'DRH': 'direction', 'Resp. Commercial': 'direction', 'Resp. Magasin': 'direction',
    'Resp. Runner': 'direction',
    'RH': 'direction', 'Commercial': 'direction',
    'Assistant(e) magasin': 'terrain', 'Vendeur': 'terrain', 'Vendeuse': 'terrain',
    'Runner': 'terrain', 'Chef de culture': 'terrain', 'Ouvrier viticole': 'terrain',
    'Saisonnier': 'saisonnier',
  };

  const TIER_BY_POSTE = {
    'Patron': 'gold', 'Co-Patron': 'gold', 'Responsable Général': 'gold',
    'DRH': 'gold', 'Resp. Commercial': 'silver', 'Resp. Magasin': 'silver',
    'Resp. Runner': 'silver',
    'RH': 'silver', 'Commercial': 'silver',
    'Assistant(e) magasin': 'bronze', 'Vendeur': 'bronze', 'Vendeuse': 'bronze',
    'Runner': 'bronze', 'Chef de culture': 'bronze',
    'Ouvrier viticole': 'clay', 'Saisonnier': 'clay',
  };

  /* Recompte les recrutements de la SEMAINE EN COURS (lundi → dimanche)
     à partir des dates d'arrivée du registre. C'est un calcul, pas un
     compteur qu'on incrémente : impossible de le désynchroniser. */
  /* Le compte des recrutements de la semaine, par recruteur.
     -------------------------------------------------------------------------
     Extrait de recomputeRecruiters() pour que la page Primes lise EXACTEMENT
     le même chiffre que la carte « Recruteurs de la semaine » du registre.
     Elle en avait un autre, écrit en dur, et les deux se contredisaient.

     La fenêtre est la semaine du domaine : lundi 00 h 00 au dimanche 23 h 59,
     via mondayOf(). Une arrivée de la semaine dernière ne compte plus. */
  /* Les noms se comparent par clefNom, jamais caractère par caractère : la
     tablette écrit « Julio Cortes » là où le registre porte « Julio cortes »,
     et une majuscule ne doit pas faire perdre une prime de recrutement. Le
     nom AFFICHÉ reste celui du registre, tel qu'il y est écrit. */
  function recruesSemaineDetail(roster) {
    const liste = roster || [];
    const now = new Date();
    const par = new Map();
    liste.forEach(e => {
      const d = parseFR(e && e.date);
      if (!d || !sameWeek(d, now)) return;
      const brut = String((e.rec || '').trim());
      if (!brut || brut === '—') return;
      const k = clefNom(brut);
      if (!k) return;
      if (par.has(k)) par.get(k).n++;
      else par.set(k, { nom: brut, n: 1 });
    });

    /* Le nom affiché est celui de la FICHE du recruteur quand elle existe :
       un « julio cortes » saisi à la va-vite sur une recrue s'affiche comme
       le registre l'écrit, et la carte des recruteurs cesse de mélanger deux
       orthographes de la même personne. */
    par.forEach((v, k) => {
      const f = liste.find(x => x && clefNom(x.name) === k);
      if (f && f.name) v.nom = String(f.name).trim();
    });

    return [...par.values()];
  }

  /* Le prix d'un recrutement, pour celui qui recrute.
     -------------------------------------------------------------------------
     À ne pas confondre avec la prime de BIENVENUE, réglée juste à côté : la
     bienvenue va à celui qui arrive, celle-ci va à celui qui l'a amené. Les
     deux portaient le même nom dans le panel, et une seule des deux était
     réglable — l'autre valait 4 000 $ écrits en dur dans la page Primes.

     4 000 $ reste le montant tant que personne n'a rien enregistré : un
     réglage qui apparaît ne doit pas changer une paie en silence. Une fois
     enregistré, zéro compris, c'est le réglage qui commande. */
  const PRIME_RECRUTEUR_DEFAUT = 4000;

  function primeParRecrutement() {
    const v = reglages ? reglages.primeParRecrutement : undefined;
    if (v === undefined || v === null || v === '') return PRIME_RECRUTEUR_DEFAUT;
    return Math.max(0, Math.round(Number(v) || 0));
  }
  window.mvPrimeRecruteur = primeParRecrutement;

  /* Ce que le domaine doit à ses recruteurs cette semaine, tous confondus. */
  function primeRecruteurTotale(roster) {
    const montant = primeParRecrutement();
    if (!montant) return 0;
    return recruesSemaineDetail(roster || rhRosterData)
      .reduce((s, r) => s + r.n, 0) * montant;
  }

  /* La forme dont la page Primes a besoin : clef normalisée → nombre. */
  function recruesSemaine(roster) {
    const out = {};
    recruesSemaineDetail(roster).forEach(r => { out[clefNom(r.nom)] = r.n; });
    return out;
  }

  /* Qui peut recruter au domaine.
     -------------------------------------------------------------------------
     Deux listes différentes proposaient le recruteur, et aucune des deux ne
     regardait le registre. Sur la fiche d'un employé, on ne proposait que les
     noms DÉJÀ inscrits comme recruteurs quelque part — au premier recrutement
     il n'y avait donc personne à choisir, et le seul nom déjà utilisé se
     retrouvait seul dans la liste. Sur la page Recrutement, cinq noms étaient
     écrits en dur dans le fichier : ils ne bougeaient pas quand l'équipe
     changeait, et ils restaient proposés longtemps après le départ des
     intéressés.

     La liste se lit maintenant dans le registre, et ne retient que les postes
     qui recrutent : RH, DRH, Co-Patron, Patron. Responsable Général n'y est
     pas — il n'a pas été demandé, et se l'ajouter tout seul reviendrait à
     décider à la place du domaine qui a le droit d'embaucher. */
  const POSTES_RECRUTEUR = [
    'Patron', 'Co-Patron', 'Co Patron',
    'DRH', 'Resp. RH', 'Responsable RH',
    'RH', 'Ressource Humaine', 'Ressources Humaines', 'Ressource humaines',
  ];

  function recruteursPossibles() {
    const cles = POSTES_RECRUTEUR.map(clefPoste);
    return (typeof rhRosterData !== 'undefined' ? rhRosterData : [])
      .filter(e => e && (!e.status || e.status === 'actif')
                && cles.includes(clefPoste(e.poste)))
      .map(e => String(e.name || '').trim())
      .filter(Boolean)
      .sort(parNom);
  }

  /* La liste déroulante de la page Recrutement. Elle garde la sélection en
     cours quand c'est encore possible : refaire son choix parce qu'un import
     a rafraîchi le registre serait une perte de temps. */
  function remplirRecruteurs() {
    const sel = $('newEmpRec');
    if (!sel) return;
    const garde = sel.value;
    const noms = ['—', ...recruteursPossibles()];
    sel.innerHTML = noms.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if (garde && noms.includes(garde)) sel.value = garde;
  }

  function recomputeRecruiters() {
    /* Le même calcul que la page Primes, et non plus une copie qui comptait
       « Julio Cortes » et « Julio cortes » comme deux personnes. */
    const rows = recruesSemaineDetail(rhRosterData)
      .map(r => ({ name: r.nom, n: r.n }))
      .sort((a, b) => b.n - a.n || parNom(a.name, b.name));

    rhRecruiters.length = 0;
    rows.forEach(r => rhRecruiters.push(r));

    /* Le registre vient peut-être de changer : la liste des recruteurs
       possibles en découle. Tous les chemins qui touchent au registre —
       embauche, fiche, import, réinitialisation, démarrage — passent ici. */
    remplirRecruteurs();

    /* Sans recrutement cette semaine, le graphique n'aurait rien à dessiner. */
    if (!rhRecruiters.length) rhRecruiters.push({ name: 'Aucun recrutement cette semaine', n: 0 });

    const label = document.querySelector('#recruiterCard .card-title');
    if (label) label.textContent = 'Recruteurs de la semaine';
  }

  /* ==========================================================================
     IMPORT D'UNE LISTE D'EMPLOYÉS
     --------------------------------------------------------------------------
     Le registre se tient ailleurs — un tableur partagé — et se recopiait à la
     main, ligne par ligne. Quatre-vingt-dix fiches saisies une par une, ce sont
     quatre-vingt-dix occasions de se tromper de chiffre.

     On colle le tableau tel quel. Les colonnes attendues, dans l'ordre :

         rang · nom · poste · date · n° civil · téléphone · RIB · Discord · recruteur

     Le rang en tête est facultatif : s'il est là on l'ignore, il se déduit déjà
     du poste. Les colonnes se séparent par des tabulations — ce que produit une
     copie depuis un tableur — ou à défaut par deux espaces ou plus.

     Rien n'est enregistré sans un rapport préalable : combien de fiches, quels
     doublons, quels postes non reconnus. Une importation qui se contenterait de
     dire « c'est fait » ne serait pas vérifiable.
     ========================================================================== */

  /* Les postes s'écrivent d'une main à l'autre : « Ouvrier Viticole »,
     « Responsable Commercial », « Assistants de Magasin ». Le panel, lui, a une
     orthographe unique par poste — sinon les primes, les quotas et les droits
     ne retrouvent plus leurs petits. */
  const POSTE_SYNONYMES = {
    'patron': 'Patron',
    'co patron': 'Co-Patron',
    'resp general': 'Responsable Général', 'resp generale': 'Responsable Général',
    'drh': 'DRH',
    'resp commercial': 'Resp. Commercial', 'resp commerciale': 'Resp. Commercial',
    'resp magasin': 'Resp. Magasin',
    'resp runner': 'Resp. Runner',
    'rh': 'RH',
    'commercial': 'Commercial', 'commerciale': 'Commercial',
    'assistant e magasin': 'Assistant(e) magasin',
    'assistant magasin': 'Assistant(e) magasin',
    'assistants de magasin': 'Assistant(e) magasin',
    'assistante de magasin': 'Assistant(e) magasin',
    'assistant de magasin': 'Assistant(e) magasin',
    'vendeur': 'Vendeur', 'vendeuse': 'Vendeuse',
    'runner': 'Runner',
    'saisonnier': 'Saisonnier', 'saisonniere': 'Saisonnier',
    'ouvrier viticole': 'Ouvrier viticole', 'ouvriere viticole': 'Ouvrier viticole',
    'chef de culture': 'Chef de culture',
  };

  function posteCanonique(brut) {
    const k = clefPoste(brut);
    return POSTE_SYNONYMES[k] || null;
  }

  /* Le second format, celui du registre en place
     ---------------------------------------------------------------------------
     Il ne ressemble pas au premier : trois champs par fiche seulement, aucun
     retour à la ligne, et surtout le poste et la date collés dans un même
     champ — « Chef de Culture 29/08/2026 », parfois « Saisonnier - » quand la
     date manque.

         n° civil ⇥ nom ⇥ poste date ⇥ n° civil ⇥ nom ⇥ poste date ⇥ …

     Plutôt que de demander à quelqu'un de reformater son tableau, on reconnaît
     lequel des deux arrive. La signature est nette : dans ce format, un champ
     sur trois se termine par une date ou un tiret, précédé d'un poste connu. */
  const RX_POSTE_DATE = /^(.+?)\s+(\d{2}\/\d{2}\/\d{4}|-)$/;

  function jetonsPlats(texte) {
    return String(texte || '').split(/[\t\r\n]+/).map(x => x.trim()).filter(x => x !== '');
  }

  /* Ce format arrive dans le presse-papier sous des habillages très variables :
     le n° civil et le nom parfois sur la même ligne séparés par une tabulation,
     parfois par une simple espace ; le poste sur sa propre ligne ; la date
     encore après, ou collée au poste. Compter les colonnes ne mène nulle part.

     Ce qui, en revanche, ne varie jamais : le n° civil. C'est un nombre nu de
     quatre à sept chiffres, et rien d'autre dans ce tableau n'y ressemble — ni
     un nom, ni un poste, ni une date. On s'en sert donc comme repère : chaque
     n° civil ouvre une fiche, et tout ce qui suit lui appartient jusqu'au
     suivant. Le lecteur devient insensible à la mise en page. */
  const RX_ID = /^\d{4,7}$/;
  const RX_DATE_SEULE = /^(\d{2}\/\d{2}\/\d{4}|-|—)$/;

  function jetonsRegistre(texte) {
    return jetonsPlats(texte).flatMap(x => {
      /* « 378084 Antonio Gonzalez » sur une seule ligne : on détache le
         numéro, puisqu'un nom ne commence jamais par sept chiffres. */
      const m = x.match(/^(\d{4,7})\s+(\S.*)$/);
      return m ? [m[1], m[2]] : [x];
    });
  }

  function estFormatRegistre(texte) {
    const t = jetonsRegistre(texte);
    const ids = t.filter(x => RX_ID.test(x)).length;
    const postes = t.filter(x => posteCanonique(x) || (x.match(RX_POSTE_DATE)
                      && posteCanonique(x.match(RX_POSTE_DATE)[1]))).length;
    /* Autant de postes reconnus que de numéros, et au moins deux de chaque :
       aucune autre disposition ne produit cet équilibre. */
    return ids >= 2 && postes >= 2 && Math.abs(ids - postes) <= Math.max(1, ids * 0.2);
  }

  function analyserRegistre(texte) {
    const t = jetonsRegistre(texte);
    const fiches = [], rejets = [], postesInconnus = new Set();
    const vus = new Set();

    const debuts = [];
    t.forEach((x, i) => { if (RX_ID.test(x)) debuts.push(i); });

    debuts.forEach((d, k) => {
      const fin = k + 1 < debuts.length ? debuts[k + 1] : t.length;
      const civil = t[d];
      const suite = t.slice(d + 1, fin);
      const rang = k + 1;

      if (!suite.length) {
        rejets.push({ n: rang, brut: civil, raison: 'aucun nom après le n° civil' });
        return;
      }

      const nom = suite[0];
      const reste = suite.slice(1);

      let poste = '', date = '—';
      if (reste.length) {
        const colle = reste[0].match(RX_POSTE_DATE);
        if (colle && posteCanonique(colle[1])) {
          poste = colle[1].trim();
          date = colle[2] === '-' ? '—' : colle[2];
        } else {
          poste = reste[0].trim();
          const suivant = reste.find(x => RX_DATE_SEULE.test(x));
          if (suivant) date = (suivant === '-' ? '—' : suivant);
        }
      }

      if (!poste) {
        rejets.push({ n: rang, brut: `${civil} · ${nom}`, raison: 'poste manquant' });
        return;
      }

      const canon = posteCanonique(poste);
      if (!canon) postesInconnus.add(poste);

      if (vus.has(civil)) {
        rejets.push({ n: rang, brut: nom, raison: `n° civil ${civil} déjà dans la liste` });
        return;
      }
      vus.add(civil);

      fiches.push({
        id: civil, name: nom.trim(),
        poste: canon || poste,
        init: initialsOf(nom.trim()),
        tier: TIER_BY_POSTE[canon] || 'clay',
        dept: DEPT_BY_POSTE[canon] || 'terrain',
        rec: '—', date, status: 'actif',
        /* Ce lecteur-là ne rapporte NI téléphone, NI RIB, NI Discord, NI
           recruteur : le registre du jeu ne les porte pas. Les laisser vides
           est juste — mais c'est exactement ce qui vidait les fiches quand
           l'import écrasait au lieu de fusionner. */
        phone: '', rib: '', discord: '',
        /* « — » veut dire « pas de date dans le collage » : la fusion ne doit
           pas s'en servir pour remplacer une date d'arrivée déjà connue. */
        dateFournie: date !== '—',
      });
    });

    return { fiches, rejets, postesInconnus: [...postesInconnus] };
  }

  function decouperLigne(ligne) {
    /* La tabulation fait foi dès qu'elle sépare quoi que ce soit : la version
       précédente exigeait cinq colonnes avant de la croire, et retombait sinon
       sur les espaces — qui ne séparent rien dans « 378084⇥Antonio Gonzalez ».
       Deux colonnes tabulées sont deux colonnes. */
    const parTab = ligne.split('\t');
    if (parTab.length >= 2) return parTab.map(x => x.trim());
    /* Sans tabulation, on accepte deux espaces ou plus — jamais une seule,
       sinon « Chef de culture » se couperait en trois. */
    return ligne.trim().split(/ {2,}/).map(x => x.trim());
  }

  /* L'ordre de ces deux essais compte. Le lecteur à repères est le plus
     tolérant : il passe en premier, et il a été vérifié qu'il ne revendique
     PAS le format long à neuf colonnes — dans celui-là, les RIB font autant de
     nombres à six chiffres que les n° civils, et l'équilibre entre repères et
     postes se rompt franchement. C'est ce déséquilibre qui l'écarte. */
  /* Le même piège que sur la tablette : une feuille de calcul colle son
     en-tête et sa ligne de totaux avec le reste. Ici l'en-tête passait le
     contrôle « nom et poste présents » — « Nom » et « Poste » sont deux
     chaînes — et créait une fiche d'employé nommée « Nom ». On l'écarte, et
     on le DIT dans les rejets plutôt que de la faire disparaître en silence :
     une ligne avalée sans un mot est un bug qu'on ne trouve jamais. */
  const LIGNE_PAS_UN_EMPLOYE = new Set([
    'nom', 'noms', 'employe', 'employes', 'membre', 'membres', 'name', 'joueur',
    'total', 'totaux', 'total general', 'totaux generaux', 'somme', 'cumul',
  ]);
  const clefLigne = x => String(x == null ? '' : x).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

  function analyserListeRH(texte) {
    if (estFormatRegistre(texte)) return analyserRegistre(texte);

    const lignes = String(texte || '').split(/\r?\n/);
    const fiches = [], rejets = [], postesInconnus = new Set();
    const vus = new Set();

    lignes.forEach((brut, n) => {
      if (!brut.trim()) return;
      let p = decouperLigne(brut);

      /* Le rang en tête : un ou deux chiffres seuls. On le retire — mais
         seulement s'il reste assez de colonnes derrière, sinon on aurait
         mangé le numéro civil de quelqu'un. */
      if (/^\d{1,2}$/.test(p[0]) && p.length >= 8) p = p.slice(1);

      const [nom, poste, date, civil, tel, rib, discord, rec] = p;
      if (!nom || !poste) { rejets.push({ n: n + 1, brut, raison: 'nom ou poste manquant' }); return; }
      if (LIGNE_PAS_UN_EMPLOYE.has(clefLigne(nom))) {
        rejets.push({ n: n + 1, brut, raison: 'ligne d\'en-tête ou de total, pas un employé' });
        return;
      }

      const canon = posteCanonique(poste);
      if (!canon) postesInconnus.add(poste);

      const id = String(civil || '').trim() || String(Math.floor(100000 + Math.random() * 900000));
      if (vus.has(id)) { rejets.push({ n: n + 1, brut, raison: `n° civil ${id} déjà dans la liste` }); return; }
      vus.add(id);

      fiches.push({
        id, name: nom.trim(),
        poste: canon || poste.trim(),
        init: initialsOf(nom.trim()),
        tier: TIER_BY_POSTE[canon] || 'clay',
        dept: DEPT_BY_POSTE[canon] || 'terrain',
        rec: (rec || '—').trim(),
        date: /^\d{2}\/\d{2}\/\d{4}$/.test(String(date || '').trim()) ? date.trim() : todayFR(),
        /* Une date absente est remplacée par celle du jour — acceptable pour
           une NOUVELLE fiche, désastreux sur une fiche existante : toutes les
           dates d'arrivée se retrouvaient au jour de l'import. La fusion a
           besoin de savoir si la date vient vraiment du collage. */
        dateFournie: /^\d{2}\/\d{2}\/\d{4}$/.test(String(date || '').trim()),
        status: 'actif',
        phone: (tel || '').trim(),
        rib: (rib || '').trim(),
        discord: (discord || '').trim(),
      });
    });

    return { fiches, rejets, postesInconnus: [...postesInconnus] };
  }

  /* Modifier une fiche existante
     ---------------------------------------------------------------------------
     On pouvait créer un employé et déclarer son départ, mais pas corriger sa
     fiche entre les deux. C'était supportable tant que tout se saisissait à la
     main ; ça ne l'est plus quand un import dépose quatre-vingts fiches dont le
     téléphone, le RIB et le Discord sont à compléter après coup.

     Le n° civil sert d'identifiant : le changer revient à changer de personne,
     on refuse donc si le nouveau numéro est déjà pris. */
  /* L'identifiant Discord, et pas le pseudo
     ---------------------------------------------------------------------------
     Un pseudo se renomme et ne sert à rien côté serveur : les permissions d'un
     salon ne connaissent que l'identifiant numérique. C'est lui qui permet de
     retrouver le ticket d'une personne. On accepte quand même ce qui est saisi
     — une fiche à moitié remplie vaut mieux qu'une fiche refusée — mais on
     prévient, sinon l'erreur ne se découvre qu'au premier rappel envoyé. */
  const ID_DISCORD = /^\d{17,20}$/;
  function estIdDiscord(x) { return ID_DISCORD.test(String(x || '').trim()); }
  window.estIdDiscord = estIdDiscord;

  const POSTES_CANON = [
    'Patron', 'Co-Patron', 'Responsable Général', 'DRH',
    'Resp. Commercial', 'Resp. Magasin', 'Resp. Runner',
    'RH', 'Commercial', 'Assistant(e) magasin', 'Vendeur', 'Vendeuse', 'Runner',
    'Chef de culture', 'Ouvrier viticole', 'Saisonnier',
  ];

  async function modifierEmploye(id) {
    const e = rhRosterData.find(x => String(x.id) === String(id));
    if (!e) { toast('Fiche introuvable.'); return; }

    /* Le recruteur déjà inscrit reste proposé même s'il a quitté le domaine ou
       changé de poste : sinon, ouvrir une fiche pour corriger un téléphone
       effacerait au passage le nom de celui qui l'a recrutée. */
    const actuel = String(e.rec || '—').trim();
    const recruteurs = recruteursPossibles();
    if (actuel && actuel !== '—' && !recruteurs.includes(actuel)) {
      recruteurs.push(actuel);
      recruteurs.sort(parNom);
    }

    const r = await askForm(`Fiche de ${e.name}`, [
      { key: 'name',    label: 'Prénom Nom', value: e.name || '' },
      { key: 'poste',   label: 'Poste', value: e.poste || 'Saisonnier', options: POSTES_CANON },
      { key: 'id',      label: 'N° civil', value: String(e.id || '') },
      { key: 'date',    label: "Date d'arrivée (jj/mm/aaaa)", value: e.date || '' },
      { key: 'phone',   label: 'N° téléphone', value: e.phone || '' },
      { key: 'rib',     label: 'RIB', value: e.rib || '' },
      { key: 'discord', label: 'Identifiant Discord', value: e.discord || '' },
      { key: 'rec',     label: 'Recruteur', value: actuel || '—',
        options: ['—', ...recruteurs] },
    ], 'Laissez un champ vide s\'il est encore inconnu — il restera à compléter. '
     + 'L\'identifiant Discord est un nombre à 18 chiffres (clic droit sur la personne ▸ '
     + 'Copier l\'identifiant), pas un pseudo.');
    if (!r) return;

    const nom = (r.name || '').trim();
    if (!nom) { toast('Le nom ne peut pas être vide.'); return; }

    const nouvelId = String(r.id || '').trim() || String(e.id);
    if (nouvelId !== String(e.id) && rhRosterData.some(x => String(x.id) === nouvelId)) {
      toast('Ce numéro civil appartient déjà à quelqu\'un d\'autre.');
      return;
    }

    const poste = POSTES_CANON.includes(r.poste) ? r.poste : (posteCanonique(r.poste) || e.poste);

    e.id = nouvelId;
    e.name = nom;
    e.init = initialsOf(nom);
    e.poste = poste;
    e.tier = TIER_BY_POSTE[poste] || 'clay';
    e.dept = DEPT_BY_POSTE[poste] || 'terrain';
    e.date = (r.date || '').trim() || e.date || '—';
    e.phone = (r.phone || '').trim();
    e.rib = (r.rib || '').trim();
    e.discord = (r.discord || '').trim();
    e.rec = (r.rec || '—').trim() || '—';

    recomputeRecruiters();
    D().note(`a modifié la fiche de ${nom}`);
    D().saveMany(['rhRoster', 'rhRecruiters']);
    if (e.discord && !estIdDiscord(e.discord)) {
      toast('Fiche mise à jour — mais « ' + e.discord + ' » ne ressemble pas à un identifiant Discord.');
    } else {
      toast('Fiche mise à jour.');
    }
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-emp-edit]');
    if (b) modifierEmploye(b.dataset.empEdit);
  });

  /* Fusionner une fiche importée dans une fiche existante.
     -------------------------------------------------------------------------
     Le mode « Remplacer » vidait le registre et reposait les fiches lues : tout
     ce qui avait été saisi à la main — identifiant Discord, téléphone, RIB,
     recruteur, permis, statut — partait avec. Ce n'était pas un effet de bord
     mais le comportement écrit, et il coûtait une soirée de ressaisie à chaque
     mise à jour de la liste.

     La règle tient en une phrase : le collage ENRICHIT, il n'efface jamais.
     Une valeur vide dans le collage laisse en place celle du registre ; une
     valeur pleine la remplace. On part de la fiche existante, donc tout ce que
     l'import ne connaît pas — le permis, une note, un champ ajouté plus tard —
     survit sans qu'on ait à le lister ici. */
  function fusionnerFiche(ancienne, neuve) {
    const plein = v => String(v == null ? '' : v).trim() !== ''
                    && String(v).trim() !== '—';
    const f = Object.assign({}, ancienne);

    ['name', 'poste', 'phone', 'rib', 'discord', 'rec'].forEach(k => {
      if (plein(neuve[k])) f[k] = neuve[k];
    });
    /* La date d'arrivée ne bouge que si le collage en portait vraiment une. */
    if (neuve.dateFournie && plein(neuve.date)) f.date = neuve.date;

    /* Le sceau et le pôle découlent du poste : si le poste a changé, ils
       doivent suivre, sinon la fiche afficherait l'ancien rang. */
    if (f.poste !== ancienne.poste) {
      const canon = posteCanonique(f.poste) || f.poste;
      f.tier = TIER_BY_POSTE[canon] || ancienne.tier || 'clay';
      f.dept = DEPT_BY_POSTE[canon] || ancienne.dept || 'terrain';
    }
    if (plein(f.name)) f.init = initialsOf(String(f.name).trim());
    delete f.dateFournie;
    return f;
  }

  async function importerListeRH() {
    ensureDialog();
    const d = dlg.querySelector('.mv-dlg');
    d.style.maxWidth = '720px';
    d.innerHTML = `
      <h3>Importer une liste d'employés</h3>
      <p>Collez le tableau tel qu'il sort de votre registre. Colonnes attendues, dans l'ordre :<br>
         <code class="mv-imp-c">rang · nom · poste · date · n° civil · téléphone · RIB · Discord · recruteur</code><br>
         Le rang en tête est facultatif. Les lignes vides sont ignorées.</p>
      <textarea id="mvImpTxt" class="mv-imp-txt" spellcheck="false"
        placeholder="16&#9;Miguel Raconter&#9;Saisonnier&#9;29/08/2026&#9;349438&#9;555-037-040&#9;520926&#9;1043821595245940756&#9;Julio cortes"></textarea>
      <div class="mv-dlg-btns">
        <button data-no>Annuler</button>
        <button data-yes class="go">Analyser</button>
      </div>`;
    dlg.style.display = 'flex';

    const texte = await new Promise(r => {
      resolver = r;
      d.querySelector('[data-no]').onclick = () => close(null);
      d.querySelector('[data-yes]').onclick = () => close(($('mvImpTxt') || {}).value || '');
    });
    if (texte === null) { d.style.maxWidth = ''; return; }

    const { fiches, rejets, postesInconnus } = analyserListeRH(texte);
    if (!fiches.length) {
      d.style.maxWidth = '';
      alert("Aucune fiche n'a pu être lue.\n\nVérifiez que les colonnes sont séparées par des tabulations "
          + "— c'est ce que produit une copie depuis un tableur.");
      return;
    }

    const existants = new Set(rhRosterData.map(e => String(e.id)));
    const dejaLa = fiches.filter(f => existants.has(String(f.id))).length;

    /* La première étape a refermé la boîte en se résolvant : il faut la
       rouvrir pour la seconde, sinon le rapport se construit dans le vide et
       le bouton « Analyser » semble ne rien faire. */
    ensureDialog();
    const d2 = dlg.querySelector('.mv-dlg');
    d2.style.maxWidth = '720px';
    dlg.style.display = 'flex';
    d2.innerHTML = `
      <h3>${fiches.length} fiche${fiches.length > 1 ? 's' : ''} lue${fiches.length > 1 ? 's' : ''}</h3>
      <p>Vérifiez avant d'enregistrer.</p>
      <div class="mv-imp-rap">
        <div><b>${fiches.length}</b> fiche(s) reconnue(s)</div>
        ${rejets.length ? `<div class="mv-imp-warn"><b>${rejets.length}</b> ligne(s) écartée(s) —
           ${esc(rejets.slice(0, 4).map(r => `ligne ${r.n} : ${r.raison}`).join(' · '))}${
           rejets.length > 4 ? ' …' : ''}</div>` : ''}
        ${postesInconnus.length ? `<div class="mv-imp-warn">Poste(s) non reconnu(s), gardé(s) tels quels :
           ${esc(postesInconnus.join(', '))}</div>` : ''}
        ${dejaLa ? `<div class="mv-imp-warn"><b>${dejaLa}</b> n° civil déjà présent(s) dans le registre</div>` : ''}
        ${(() => {
          const mauvais = fiches.filter(f => f.discord && !estIdDiscord(f.discord)).length;
          const vides = fiches.filter(f => !f.discord).length;
          if (!mauvais && !vides) return '';
          const bouts = [];
          if (mauvais) bouts.push(`<b>${mauvais}</b> ne ressemble(nt) pas à un identifiant Discord`);
          if (vides) bouts.push(`<b>${vides}</b> sans identifiant Discord`);
          return `<div class="mv-imp-warn">${bouts.join(' · ')} — les fiches passent quand même,
            mais le panel ne pourra pas retrouver leur ticket.</div>`;
        })()}
      </div>
      <div class="mv-imp-apercu">
        <table>
          <thead><tr><th>Nom</th><th>Poste</th><th>Arrivée</th><th>Civil</th><th>Recruteur</th></tr></thead>
          <tbody>${fiches.slice(0, 6).map(f => `<tr>
            <td>${esc(f.name)}</td><td>${esc(f.poste)}</td><td>${esc(f.date)}</td>
            <td>${esc(f.id)}</td><td>${esc(f.rec)}</td></tr>`).join('')}</tbody>
        </table>
        ${fiches.length > 6 ? `<div class="mv-imp-reste">…et ${fiches.length - 6} autre(s)</div>` : ''}
      </div>
      <!-- Un seul comportement, donc aucun choix à faire : un import qui
           efface n'a jamais été ce qu'on voulait, et le proposer c'était
           laisser la porte ouverte à la mauvaise soirée. On annonce ce qui va
           se passer, on ne demande pas de le choisir. -->
      <div class="mv-imp-rap" style="margin-top:2px;">
        <div><b>${dejaLa}</b> fiche(s) déjà connue(s) seront <b>enrichies</b>,
          <b>${fiches.length - dejaLa}</b> ajoutée(s).</div>
        <div>Ce que le collage ne porte pas — identifiant Discord, téléphone, RIB,
          recruteur, permis, statut — <b>reste en place</b>.</div>
        <div>Personne n'est supprimé : une fiche absente du collage reste au registre.</div>
      </div>
      <div class="mv-dlg-btns">
        <button data-no>Annuler</button>
        <button data-yes class="go">Mettre à jour le registre</button>
      </div>`;

    const valide = await new Promise(r => {
      resolver = r;
      d2.querySelector('[data-no]').onclick = () => close(null);
      d2.querySelector('[data-yes]').onclick = () => close(true);
    });
    d2.style.maxWidth = '';
    if (!valide) return;

    /* Un seul comportement : on enrichit ce qui existe, on ajoute ce qui
       manque, et on ne SUPPRIME personne. Les modes « Remplacer » et
       « Ajouter seulement » ont été retirés — le premier effaçait le travail
       de saisie, le second laissait vieillir les fiches connues. Aucun des
       deux ne servait, et le premier a déjà coûté une ressaisie complète. */
    let ajoutees = 0, majs = 0;
    const propre = f => { const x = Object.assign({}, f); delete x.dateFournie; return x; };

    fiches.forEach(f => {
      const i = rhRosterData.findIndex(e => String(e.id) === String(f.id));
      if (i >= 0) { rhRosterData[i] = fusionnerFiche(rhRosterData[i], f); majs++; }
      else { rhRosterData.push(propre(f)); ajoutees++; }
    });

    /* Le registre arrive dans l'ordre du tableur ; on le range par date
       d'arrivée, du plus récent au plus ancien, comme le reste du panel. */
    rhRosterData.sort((a, b) => {
      const da = parseFR(a.date), db = parseFR(b.date);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });

    recomputeRecruiters();
    refreshEffectifCount();
    D().note(`a importé ${ajoutees} fiche(s) employé`
           + (majs ? ` et mis à jour ${majs} fiche(s)` : ''));
    D().saveMany(['rhRoster', 'rhRecruiters']);

    /* Le registre vient de changer : l'effectif de production en découle. */
    const sync = syncEffectifEtEnregistrer(true);
    toast(`${ajoutees} fiche(s) ajoutée(s)`
        + (majs ? ` · ${majs} mise(s) à jour sans rien perdre` : '')
        + (sync.crees ? ` · ${sync.crees} fiche(s) de production créée(s)` : ''));
  }

  async function addEmployee() {
    const name = val('newEmpName');
    if (!name) { toast('Indiquez le nom de l\'employé.'); $('newEmpName') && $('newEmpName').focus(); return; }

    if (typeof isBlacklisted === 'function' && isBlacklisted(name)) {
      const go = await confirmAction('Personne blacklistée',
        `${name} figure dans la blacklist du domaine. Confirmez-vous l'embauche malgré tout ?`);
      if (!go) return;
    }

    const poste = val('newEmpPoste') || 'Saisonnier';
    const date = val('newEmpDate') || todayFR();
    const id = val('newEmpCivil') || String(Math.floor(100000 + Math.random() * 900000));

    if (rhRosterData.some(e => String(e.id) === String(id))) {
      toast('Ce numéro civil est déjà enregistré.');
      return;
    }

    const discordSaisi = val('newEmpDiscord').trim();

    rhRosterData.unshift({
      id, name, poste,
      init: initialsOf(name),
      tier: TIER_BY_POSTE[poste] || 'clay',
      rec: val('newEmpRec') || '—',
      date,
      status: 'actif',
      dept: DEPT_BY_POSTE[poste] || 'terrain',
      phone: val('newEmpPhone'),
      rib: val('newEmpRib'),
      discord: discordSaisi,
    });

    recomputeRecruiters();
    refreshEffectifCount();
    clear('newEmpName', 'newEmpCivil', 'newEmpPhone', 'newEmpRib', 'newEmpDiscord', 'newEmpDate');
    const w = $('blWarning'); if (w) w.style.display = 'none';

    D().note(`a recruté ${name} au poste de ${poste}`);
    D().saveMany(['rhRoster', 'rhRecruiters']);
    if (discordSaisi && !estIdDiscord(discordSaisi)) {
      toast(`${name} a rejoint le domaine — mais « ${discordSaisi} » ne ressemble pas à un identifiant Discord.`);
    } else {
      toast(`${name} a rejoint le domaine.`);
    }
  }

  /* Déclarer une absence : bascule le statut de l'employé et alimente
     le tableau des absences en cours. */
  function declareAbsence() {
    const id = val('absId');
    const emp = rhRosterData.find(e => String(e.id) === String(id));
    if (!emp) { toast('Aucun employé avec cet ID unique.'); return; }

    const start = val('absStart') || todayFR();
    const indef = $('absIndef') && $('absIndef').checked;
    const back = val('absReturn');
    if (!indef && !back) { toast('Indiquez une date de retour, ou cochez « Retour indéfini ».'); return; }

    const short = s => String(s).slice(0, 5);
    const range = indef ? `${short(start)} → indéfini` : `${short(start)} → ${short(back)}`;

    emp.status = 'absent';
    emp.absence = range;
    emp.motif = val('absMotif') || 'Congé';

    const existing = rhAbsences.findIndex(a => a.name === emp.name);
    const row = { name: emp.name, range, indef: !!indef };
    if (existing >= 0) rhAbsences[existing] = row; else rhAbsences.unshift(row);

    refreshEffectifCount();
    clear('absId', 'absStart', 'absReturn');
    if ($('absIndef')) $('absIndef').checked = false;

    D().note(`a déclaré l'absence de ${emp.name} (${range})`);
    D().saveMany(['rhRoster', 'rhAbsences']);
    toast(`${emp.name} est désormais absent.`);
  }

  /* Retirer une absence : l'employé est de retour, son statut repasse
     sur « Actif » dans le registre. */
  async function removeAbsence(name) {
    const i = rhAbsences.findIndex(a => a.name === name);
    if (i < 0) return;

    if (!await confirmAction('Retour de l\'employé',
      `${name} est de retour : l'absence est retirée et son statut repasse sur « Actif ».`)) return;

    rhAbsences.splice(i, 1);

    const emp = rhRosterData.find(e => e.name === name);
    const keys = ['rhAbsences'];
    if (emp) {
      emp.status = 'actif';
      delete emp.absence;
      delete emp.motif;
      keys.push('rhRoster');
      refreshEffectifCount();
    }

    D().note(`a marqué le retour de ${name}`);
    D().saveMany(keys);
    toast(`${name} est de retour.`);
  }

  /* ========================================================================
     BLACKLIST
     ------------------------------------------------------------------------
     L'identifiant affiché est celui du joueur, saisi à la main — le même
     que le numéro civil du registre des employés. Ce n'est pas un numéro
     interne : il sert à retrouver la personne d'un fichier à l'autre.
     ======================================================================== */

  function addBlacklist() {
    const uid = val('blUid');
    const name = val('blNom');
    const reason = val('blRaison');

    if (!uid) { toast('Indiquez l\'ID unique du joueur.'); $('blUid') && $('blUid').focus(); return; }
    if (!name) { toast('Indiquez un nom.'); return; }
    if (!reason) { toast('Indiquez une raison.'); return; }

    if (blacklistData.some(b => String(b.uid) === uid)) {
      toast('Ce joueur est déjà dans la blacklist.');
      return;
    }

    const iso = val('blDate');
    const date = iso ? iso.split('-').reverse().join('/') : todayFR();

    blacklistData.unshift({ uid, name, reason, date, by: val('blBy') || '—' });
    clear('blUid', 'blNom', 'blRaison', 'blBy');

    D().note(`a blacklisté ${name} (${reason})`);
    D().save('blacklist');
    toast(`${name} a été ajouté à la blacklist.`);
  }

  async function removeBlacklist(index) {
    const i = Number(index);
    const b = blacklistData[i];
    if (!b) return;
    if (!await confirmAction('Retirer de la blacklist',
      `${b.name} pourra de nouveau être recruté au domaine.`, 'Retirer')) return;
    D().note(`a retiré ${b.name} de la blacklist`);
    blacklistData.splice(i, 1);
    D().save('blacklist');
    toast('Entrée retirée.');
  }

  /* ========================================================================
     ÉLIGIBILITÉ
     ======================================================================== */
  /* Après une clôture, c'est la semaine archivée qui porte l'information —
     pas la production en cours, qui est repartie de zéro. */
  function setDistributed(name, state) {
    const w = lastClosedWeek();

    if (w) {
      const row = w.eligibles.find(x => x.name === name);
      if (!row) return;
      row.distributed = state;
      D().save('clotures', false);
      renderEligibilite();
    } else {
      const e = effectifData.find(x => x.name === name);
      if (!e) return;
      e.distributed = state;
      D().save('effectif');
    }

    toast(state ? `Récompense de ${name} marquée distribuée.`
                : `Distribution de ${name} annulée.`);
  }

  /* ========================================================================
     COMMERCE — historique, clients, articles, factures reçues
     ======================================================================== */

  async function deleteInvoice(num) {
    const i = historiqueData.findIndex(h => String(h.num) === String(num));
    if (i < 0) return;
    const h = historiqueData[i];
    if (!await confirmAction('Supprimer la facture',
      `Facture n°${h.num} — ${h.client} — ${h.total.toLocaleString('fr-FR')} $. Cette suppression est définitive.`, 'Supprimer')) return;
    D().note(`a supprimé la facture n°${h.num} (${h.client}, ${h.total.toLocaleString('fr-FR')} $)`);
    historiqueData.splice(i, 1);
    const c = $('histCount'); if (c) c.textContent = historiqueData.length;
    D().save('historique');
    toast('Facture supprimée.');
  }

  /* ------------------------------------------------------------------------
     Document de facture — reproduction du modèle du domaine.

     Tout est dessiné en CSS et en SVG : ni image ni ressource externe, pour
     que la facture s'ouvre et s'imprime partout, même hors ligne. Les polices
     sont chargées depuis Google Fonts avec des équivalents système en secours.

     Servi à la fois par « Imprimer / PDF » sur la facture en cours et par la
     réédition depuis l'historique.
     ------------------------------------------------------------------------ */

  const MV_RIB = '20013';          /* RIB du domaine, affiché sous l'émetteur */
  const MV_TEL = '923';            /* téléphone du domaine, sur la facture */
  const PAYMENT_DAYS = 14;         /* délai de paiement accordé aux clients   */

  /* Le vrai blason du domaine, et non plus une approximation.
     -------------------------------------------------------------------------
     La facture portait un blason redessiné en SVG : un cercle vert, un anneau
     doré et une grappe stylisée. Il ressemblait au logo sans en être un — pas
     les mêmes feuilles, pas le même cartouche, pas la même typographie. Sur un
     document qui sort du domaine et circule, c'est le vrai logo qui doit
     figurer, celui de la vitrine et du panel. */
  /* La grappe, le paysage et les écoinçons étaient dessinés en SVG à l'époque
     où le parchemin l'était aussi. Le visuel fourni les porte lui-même. */

  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  /* Numéro au format du domaine : FAC-année-000012 */
  function invoiceRef(num, dateFR) {
    const year = (parseFR(dateFR) || new Date()).getFullYear();
    const digits = String(num).replace(/\D/g, '');
    return `FAC-${year}-${digits.padStart(6, '0')}`;
  }

  const money = n => Number(n || 0).toLocaleString('fr-FR') + '$';

  function openInvoiceDoc(inv) {
    /* Le parchemin est un vrai fichier du site. La fenêtre de la facture est
       ouverte vide, donc son adresse de base est « about:blank » : un chemin
       relatif n'y résoudrait rien. On calcule l'adresse absolue ici. */
    const PARCHEMIN = new URL('img/parchemin-v2.jpg', location.href).href;
    const LOGO = new URL('logo-full.png', location.href).href;

    const w = window.open('', '_blank');
    if (!w) { toast('Le navigateur a bloqué la fenêtre. Autorisez les pop-ups.'); return; }

    const issued = parseFR(inv.date) || new Date();
    const due = addDays(issued, PAYMENT_DAYS);
    const dueFR = `${pad(due.getDate())}/${pad(due.getMonth() + 1)}/${due.getFullYear()}`;

    const remise = Number(inv.remise) || 0;

    /* Sans le détail des lignes — cas d'une facture rééditée depuis
       l'historique, qui n'en conserve que le total — on imprime une ligne
       récapitulative plutôt qu'un tableau vide. */
    const detailed = inv.rows && inv.rows.length;
    const lines = detailed
      ? inv.rows.map(l => `<tr>
          <td class="prod">${esc(l.desc)}</td>
          <td>${l.qty.toLocaleString('fr-FR')}</td>
          <td>${money(l.pu)}</td>
          <td>${money(Math.round(l.ht))}</td>
        </tr>`).join('')
      : `<tr><td class="prod">Commande — ${esc(invoiceRef(inv.num, inv.date))}</td>
          <td>—</td><td>—</td><td>${money(inv.total)}</td></tr>`;

    /* Au-delà d'une douzaine de lignes, la page A4 ne suffit plus à cette
       taille de police : on passe à un pas plus serré. */
    const nRows = detailed ? inv.rows.length : 1;
    /* Le parchemin mange plus de marge que le fond dessiné qu'il remplace :
       les seuils ont été remesurés page par page jusqu'à 30 lignes. */
    const density = nRows > 22 ? 'nano'
                  : nRows > 14 ? 'micro'
                  : nRows > 10 ? 'tight'
                  : nRows > 6  ? 'dense' : '';

    /* Au-delà de 28 lignes, même le pas le plus serré déborde sur une seconde
       feuille. Plutôt que de laisser la facture se couper en deux, on réduit
       la police proportionnellement — ça reste lisible jusqu'à une quarantaine
       de lignes, ce qu'aucune commande n'a jamais atteint. */
    const shrink = nRows > 28 ? ` style="font-size:${(7 * 22 / nRows).toFixed(2)}pt;line-height:1.05"` : '';

    const totalHT = detailed
      ? Math.round(inv.rows.reduce((s, l) => s + l.ht, 0))
      : Number(inv.total);
    /* Le montant dû part du TTC : la TVA s'applique ligne par ligne,
       la réduction sur l'ensemble. */
    const net = Math.round(Number(inv.total) * (1 - remise / 100));
    const tva = detailed ? Math.round(Number(inv.total) - totalHT) : 0;

    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(invoiceRef(inv.num, inv.date))} — Marlowe Vineyard</title>
<link rel="stylesheet" href="${new URL('fonts/polices.css', location.href).href}">
<style>
  @page{size:A4;margin:0;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#3A342A;font-family:'Cormorant Garamond',Georgia,serif;color:#4A3B22;}
  @media screen{body{padding:26px 0;}}

  /* La feuille a EXACTEMENT les proportions du visuel — 1600 x 1920, soit
     210 x 252 mm. Le forcer au format A4 étirait le parchemin de 18 % en
     hauteur : le cadre doré s'allongeait, la grappe se déformait, et le
     « fond à l'identique » n'en était plus un. Une facture de domaine se
     regarde à l'écran ; qu'elle laisse un peu de blanc en bas d'une feuille
     A4 imprimée est sans conséquence, l'inverse ne l'était pas. */
  .sheet{
    width:210mm;height:252mm;margin:0 auto;position:relative;overflow:hidden;
    background:#E6D4A6;   /* teinte de repli si le visuel ne charge pas */
    box-shadow:0 18px 60px rgba(0,0,0,.5);
  }
  /* Le parchemin est une image, pas un fond CSS : les navigateurs impriment
     les images de façon fiable, les fonds décoratifs sont souvent supprimés. */
  .parch{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;z-index:0;}
  @media print{
    .sheet{box-shadow:none;margin:0;}
    /* Sans cette ligne, Chrome imprime le parchemin en blanc. */
    body,.sheet{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  }

  /* Le cadre doré, les écoinçons, la grappe et le paysage sont DANS le
     visuel : les redessiner par-dessus ferait doublon. */
  .inner{position:relative;z-index:2;padding:22mm 24mm 0;}

  /* Le fichier du logo est carré mais son dessin est plus large que haut :
     une bonne partie de la hauteur est du vide. On le pose donc un peu plus
     grand que l'ancien blason pour que le cartouche pèse autant à l'œil. */
  .crest{width:34mm;margin:0 auto -1mm;}
  .crest img{width:100%;height:auto;display:block;
    filter:drop-shadow(0 4px 10px rgba(80,60,20,.35));}

  h1{font-family:'Cinzel',Georgia,serif;font-size:23pt;font-weight:600;letter-spacing:.09em;
    text-align:center;color:#9C7A1C;text-shadow:0 1px 0 rgba(255,250,230,.6);}
  h2{font-family:'Cormorant Garamond',Georgia,serif;font-size:28pt;font-weight:700;
    text-align:center;color:#3E3118;margin-top:1mm;}

  .rule{height:1px;background:linear-gradient(90deg,transparent,rgba(122,95,46,.55),transparent);
    margin:4mm 0 3mm;}

  .refs{display:flex;justify-content:space-between;align-items:flex-start;
    font-size:13pt;font-weight:600;line-height:1.75;color:#3B2E15;}
  .refs .r{text-align:right;padding-top:5mm;}

  /* Filigrane */

  /* La grappe du visuel descend bas dans la marge droite : sans cette
     largeur maximale, l'intitulé CLIENT passait dessous et devenait illisible. */
  .parties{display:flex;justify-content:space-between;margin-top:5mm;max-width:118mm;
    font-size:13pt;line-height:1.7;position:relative;z-index:2;color:#3B2E15;}
  .parties .lbl{font-family:'Cinzel',Georgia,serif;font-size:9.5pt;letter-spacing:.18em;
    color:#8A6E2A;margin-bottom:1mm;}
  .parties .cl{text-align:right;}
  .parties b{font-weight:700;color:#3E3118;}

  table{width:100%;border-collapse:collapse;margin-top:6mm;font-size:13pt;position:relative;z-index:2;}
  thead th{background:#17392C;color:#F2E6C4;font-family:'Cinzel',Georgia,serif;
    font-size:11.5pt;font-weight:600;letter-spacing:.05em;padding:3.2mm 3mm;text-align:center;}
  thead th:first-child{text-align:center;}
  tbody td{padding:2.9mm 3mm;text-align:center;font-weight:600;color:#3B2E15;}
  tbody td.prod{font-weight:700;color:#2C2210;}

  /* Beaucoup de lignes : on resserre pour rester sur une seule page,
     plutôt que de laisser la facture déborder sur une seconde feuille. */
  table.dense{font-size:11pt;}
  table.dense tbody td{padding:2mm 2.6mm;}
  table.dense thead th{font-size:10.5pt;padding:2.6mm 2.6mm;}
  table.tight{font-size:9.5pt;}
  table.tight tbody td{padding:1.4mm 2.2mm;}
  table.tight thead th{font-size:9.5pt;padding:2.2mm 2.2mm;}
  table.micro{font-size:8pt;}
  table.micro tbody td{padding:.9mm 2mm;}
  table.micro thead th{font-size:8.5pt;padding:1.8mm 2mm;}
  table.nano{font-size:7pt;}
  table.nano tbody td{padding:.45mm 1.6mm;}
  table.nano thead th{font-size:7.5pt;padding:1.3mm 1.6mm;}
  tbody tr:first-child td{padding-top:3.4mm;}
  .spacer td{height:5mm;padding:0;}

  /* Sur l'ancien parchemin la villa occupait le coin BAS-GAUCHE : signature et
     totaux étaient donc poussés ensemble à droite, sur du vide. Le nouveau
     visuel place la villa au centre-gauche et fait descendre une vigne à
     droite — le bloc groupé à droite retombait sur le feuillage, et le mot
     SIGNATURE se perdait dans les toits. On sépare : la signature à gauche,
     les totaux à droite, chacun sur une zone claire. */
  .bottom{position:absolute;left:20mm;right:20mm;bottom:22mm;z-index:3;
    display:flex;justify-content:space-between;align-items:flex-end;gap:10mm;}
  .sig{font-family:'Great Vibes','Segoe Script','Brush Script MT','Apple Chancery',cursive;
    font-size:28pt;color:#3E3118;line-height:1;text-align:center;
    transform:rotate(-2deg);white-space:nowrap;}
  /* Le mot SIGNATURE tombe désormais sur les rangs de vigne du visuel : en or
     clair il y disparaissait purement et simplement. Encre sombre et léger
     halo clair — le même que celui du nom — pour qu'il se lise sur un fond
     chargé sans faire tache. */
  .sig small{display:block;font-family:'Cinzel',Georgia,serif;font-size:8.5pt;letter-spacing:.16em;
    color:#4A3A18;transform:rotate(2deg);margin-top:2mm;
    text-shadow:0 1px 2px rgba(255,250,235,.75);}
  .sig{text-shadow:0 1px 3px rgba(255,250,235,.55);}
  .totals{text-align:left;font-size:15pt;font-weight:700;line-height:1.6;color:#2C2210;white-space:nowrap;}
  .totals .fin{font-size:17.5pt;}
  .totals .tva{display:block;font-size:10pt;font-weight:600;color:#6E5526;margin-top:1mm;}

</style></head><body>
<div class="sheet">
  <img class="parch" src="${PARCHEMIN}" alt="">

  <div class="inner">
    <div class="crest"><img src="${LOGO}" alt="Marlowe Vineyard"></div>
    <h1>MARLOWE VINEYARD</h1>
    <h2>Facture</h2>
    <div class="rule"></div>

    <div class="refs">
      <div>N° ${esc(invoiceRef(inv.num, inv.date))}<br>Date : ${esc(inv.date)}</div>
      <div class="r">Date limite de paiement : ${esc(dueFR)}</div>
    </div>

    <div class="parties">
      <div>
        <div class="lbl">ÉMETTEUR</div>
        <b>Marlowe Vineyard</b><br>Téléphone : ${esc(MV_TEL)} · RIB : ${esc(MV_RIB)}
      </div>
      <div class="cl">
        <div class="lbl">CLIENT</div>
        <b>${esc(inv.client || '—')}</b>
      </div>
    </div>

    <table class="${density}"${shrink}>
      <thead><tr><th>Produit</th><th>Quantité</th><th>Prix/u</th><th>Total</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>
  </div>

  <div class="bottom">
    <div class="sig">${esc(inv.emetteur || 'Marlowe Vineyard')}<small>SIGNATURE</small></div>
    <div class="totals">
      TOTAL HT : ${money(totalHT)}<br>
      Réduction : ${remise}%<br>
      <span class="fin">Total : ${money(net)}</span>
      ${tva && tva > 0 ? `<span class="tva">dont TVA : ${money(tva)}</span>` : ''}
    </div>
  </div>
</div>
<script>
/* Le tableau ne doit JAMAIS entrer dans le bloc du bas.
   ---------------------------------------------------------------------------
   Les paliers de densité ci-dessus avaient été mesurés à la main sur une
   feuille A4. La feuille suit maintenant les proportions du parchemin et fait
   45 mm de moins : dès six lignes, le tableau recouvrait les totaux. Plutôt
   que de re-régler des seuils qui redeviendront faux au prochain visuel, la
   page se mesure elle-même et se resserre jusqu'à tenir.

   On attend les polices : mesurer avant leur chargement donne des hauteurs
   fausses, et la correction serait calculée sur une page qui n'existe pas
   encore. */
function mvAjusterTable(){
  var t = document.querySelector('table');
  var b = document.querySelector('.bottom');
  if (!t || !b) return;
  var limite = b.getBoundingClientRect().top - 10;   /* 10 px de respiration */
  var st = document.createElement('style');
  document.head.appendChild(st);

  var fs = parseFloat(getComputedStyle(t).fontSize) * 0.75;  /* px -> pt */
  var py = 2.9, px = 3;
  var tours = 0;
  while (t.getBoundingClientRect().bottom > limite && tours < 80) {
    fs = Math.max(4.5, fs - 0.35);
    py = Math.max(0.25, py * 0.88);
    px = Math.max(1.2, px * 0.96);
    st.textContent =
      'table{font-size:' + fs.toFixed(2) + 'pt !important;line-height:1.15 !important;}' +
      'table tbody td{padding:' + py.toFixed(2) + 'mm ' + px.toFixed(2) + 'mm !important;}' +
      'table thead th{padding:' + (py + 0.4).toFixed(2) + 'mm ' + px.toFixed(2) + 'mm !important;' +
        'font-size:' + Math.max(4.5, fs - 0.5).toFixed(2) + 'pt !important;}' +
      'tbody tr:first-child td{padding-top:' + (py + 0.5).toFixed(2) + 'mm !important;}' +
      '.spacer td{height:' + Math.max(0, 5 - tours * 0.2).toFixed(1) + 'mm !important;}';
    tours++;
    if (fs <= 5 && py <= 0.25) break;   /* en dessous, plus personne ne lit */
  }

  /* Il reste des factures qu'aucun resserrement ne fait tenir — quarante
     lignes et plus. Trois issues possibles : rendre le texte illisible, en
     couper la fin, ou allonger la feuille. Sur une FACTURE, cacher des lignes
     est la seule qui soit vraiment grave : on allonge. Le parchemin s'étire un
     peu sur ces cas-là, mais rien n'est perdu ni illisible. */
  var manque = t.getBoundingClientRect().bottom - limite;
  if (manque > 0) {
    var f = document.querySelector('.sheet');
    f.style.height = (f.offsetHeight + manque + 14) + 'px';
  }
}
window.onload = function(){
  var pret = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  pret.then(function(){
    mvAjusterTable();
    setTimeout(function(){ window.print(); }, 450);
  });
};
<\/script>
</body></html>`);
    w.document.close();
  }

  /* Le détail d'une facture, réduit à ce qui a été saisi. Plafonné : une
     facture de plus de cent lignes n'existe pas, et si elle existait un jour
     il vaut mieux perdre sa fin que faire déborder les données du panel. */
  const LIGNES_MAX = 100;

  function lignesAbregees(rows) {
    return (rows || []).slice(0, LIGNES_MAX).map(l => ({
      d: String(l.desc || '').slice(0, 120),
      r: String(l.ref || '').slice(0, 24),
      q: Number(l.qty) || 0,
      p: Number(l.pu) || 0,
      t: Number(l.tva) || 0,
    }));
  }

  /* L'inverse : on rend des lignes complètes, totaux recalculés. */
  function lignesDepliees(lignes) {
    return (lignes || []).map(l => {
      const qty = Number(l.q) || 0, pu = Number(l.p) || 0, tva = Number(l.t) || 0;
      return { ref: l.r || '', desc: l.d || '', qty, pu, tva,
               ht: qty * pu, ttc: qty * pu * (1 + tva / 100) };
    });
  }

  /* Réédite une facture déjà enregistrée dans l'historique.

     Les factures enregistrées AVANT cette version n'ont pas de détail : on
     ne peut pas l'inventer. Elles continuent de sortir avec leur ligne
     récapitulative, exactement comme avant — c'est le repli prévu dans
     openInvoiceDoc, et il reste utile pour elles. */
  function reprintInvoice(num) {
    const h = historiqueData.find(x => String(x.num) === String(num));
    if (!h) return;
    const rows = lignesDepliees(h.lignes);
    /* Le document additionne les lignes pour le HT et la TVA ; il lui faut
       donc le total TTC AVANT remise, pas le net déjà enregistré. */
    const remise = Number(h.remise) || 0;
    const total = rows.length
      ? Math.round(rows.reduce((s, l) => s + l.ttc, 0))
      : Number(h.total);
    openInvoiceDoc({ num: h.num, date: h.date, client: h.client, emetteur: h.emetteur,
                     total, remise: rows.length ? remise : 0, rows });
  }

  /* ------------------------------------------------------------------------
     Le numéro et la date, proposés tout seuls
     ------------------------------------------------------------------------
     Les deux champs étaient écrits en dur dans la page : le même numéro et la
     même date à chaque ouverture, à corriger à la main chaque fois — et à
     oublier une fois sur deux, ce qui donne deux factures du même numéro ou
     une facture datée du mois dernier.

     Les deux se calent maintenant à l'ouverture de la page. Mais JAMAIS
     par-dessus une saisie : dès que quelqu'un touche un de ces champs, il
     est marqué et le panel n'y revient plus. Antidater une facture reste
     possible ; c'est un geste volontaire, pas un accident.
     ------------------------------------------------------------------------ */

  /* La date du jour à Paris, au format des champs « date » (AAAA-MM-JJ).
     toISOString() rendrait la date UTC : à une heure du matin, elle daterait
     la facture de la veille. */
  function aujourdhuiISO() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  }

  /* Le numéro suivant : le plus grand de l'historique, plus un.
     On ne regarde que les numéros purement chiffrés — une référence saisie à
     la main comme « AV-12 » ne doit pas fixer la suite. */
  function prochainNumero() {
    const nums = (typeof historiqueData !== 'undefined' ? historiqueData : [])
      .map(h => String(h && h.num || '').trim())
      .filter(x => /^\d+$/.test(x))
      .map(Number);
    if (!nums.length) return '';
    const max = Math.max(...nums);
    /* On garde la longueur : 410072 donne 410073, pas 410073 sur 5 chiffres. */
    return String(max + 1).padStart(String(max).length, '0');
  }

  function champTouche(el) {
    if (!el || el.dataset.mvTouche) return;
    const marquer = () => { el.dataset.mvTouche = '1'; };
    el.addEventListener('input', marquer);
    el.addEventListener('change', marquer);
  }

  /* Appelé à chaque ouverture de la page Facturation. */
  function ouvrirFacturation() {
    const num = $('invNum');
    const date = $('invDate');

    if (num && !num.dataset.mvTouche) {
      const suivant = prochainNumero();
      if (suivant) num.value = suivant;
      champTouche(num);
    }
    if (date && !date.dataset.mvTouche) {
      date.value = aujourdhuiISO();
      champTouche(date);
    }
  }

  /* Après un enregistrement, la facture suivante repart d'un numéro neuf et
     de la date du jour : sans ça, le numéro resterait celui qu'on vient
     d'utiliser et l'enregistrement suivant serait refusé pour doublon. */
  function reinitialiserEnTeteFacture() {
    const num = $('invNum');
    const date = $('invDate');
    if (num) { delete num.dataset.mvTouche; }
    if (date) { delete date.dataset.mvTouche; }
    ouvrirFacturation();
  }

  /* ------------------------------------------------------------------------
     Facture en cours de saisie
     ------------------------------------------------------------------------ */
  function readInvoice() {
    const rows = [...document.querySelectorAll('#invoiceLines .line-row')].map(r => {
      const qty = parseFloat(r.querySelector('.l-qty').value) || 0;
      const pu = parseFloat(r.querySelector('.l-pu').value) || 0;
      const tva = parseFloat(r.querySelector('.l-tva').value) || 0;
      return {
        ref: r.querySelector('.l-ref') ? r.querySelector('.l-ref').value : '',
        desc: r.querySelector('.l-desc') ? r.querySelector('.l-desc').value : '',
        qty, pu, tva, ht: qty * pu, ttc: qty * pu * (1 + tva / 100),
      };
    }).filter(l => l.qty > 0);

    const iso = val('invDate');
    const sel = $('invEmetteur');
    let emetteur = sel ? sel.value : '';
    if (/Sélectionner/i.test(emetteur)) emetteur = '';

    return {
      num: val('invNum') || String(Date.now()).slice(-6),
      date: iso ? iso.split('-').reverse().join('/') : todayFR(),
      client: val('invClient'),
      emetteur,
      rows,
      remise: Math.min(100, Math.max(0, parseFloat(val('invRemise')) || 0)),
      total: Math.round(rows.reduce((s, l) => s + l.ttc, 0)),
      bouteilles: rows.reduce((s, l) => s + l.qty, 0),
      get net() { return Math.round(this.total * (1 - this.remise / 100)); },
    };
  }

  function printCurrentInvoice() {
    const inv = readInvoice();
    if (!inv.rows.length) { toast('Ajoutez au moins une ligne avec une quantité.'); return; }
    openInvoiceDoc(inv);
  }

  async function saveInvoice() {
    const inv = readInvoice();

    if (!inv.client) { toast('Indiquez le client.'); $('invClient') && $('invClient').focus(); return; }
    if (!inv.rows.length) { toast('Ajoutez au moins une ligne avec une quantité.'); return; }
    if (historiqueData.some(h => String(h.num) === String(inv.num))) {
      toast(`Le n°${inv.num} existe déjà dans l'historique.`);
      return;
    }

    if (!await confirmAction('Enregistrer la facture',
      `N°${inv.num} — ${inv.client} — ${inv.net.toLocaleString('fr-FR')} $ ` +
      `(${inv.bouteilles.toLocaleString('fr-FR')} article(s)). Elle rejoindra l'historique.`)) return;

    historiqueData.unshift({
      num: inv.num, date: inv.date, client: inv.client,
      total: inv.net, emetteur: inv.emetteur || '—',
      remise: inv.remise || 0,
      /* Le DÉTAIL des lignes, en abrégé.
         ---------------------------------------------------------------------
         Il ne l'était pas, et c'est ce qui faisait qu'une facture rééditée
         depuis l'historique sortait avec « Commande — REF » et des tirets à
         la place des articles et des quantités : le document n'avait tout
         simplement plus rien à imprimer. Le PDF n'y était pour rien.

         Noms courts et valeurs saisies seulement — les totaux se recalculent.
         Une facture pèse ainsi quelques centaines d'octets, pas plusieurs
         kilos, et la limite de 1,5 Mo des données du panel reste loin. */
      lignes: lignesAbregees(inv.rows),
    });

    /* Le client est mémorisé s'il ne figure pas encore dans la base. */
    if (!clientsData.some(c => c.name.toLowerCase() === inv.client.toLowerCase())) {
      clientsData.unshift({ name: inv.client, addr: '—', phone: '', rib: '' });
      refreshClientCounts();
      fillClientList();
      D().save('clients');
    }

    const c = $('histCount'); if (c) c.textContent = historiqueData.length;

    /* Numéro suivant préparé pour la facture d'après. */
    D().note(`a émis la facture n°${inv.num} pour ${inv.client} (${inv.net.toLocaleString('fr-FR')} $)`);
    const next = String(parseInt(inv.num, 10) + 1);
    if ($('invNum') && /^\d+$/.test(inv.num)) $('invNum').value = next;

    resetInvoiceLines();
    reinitialiserEnTeteFacture();
    D().save('historique');
    toast(`Facture n°${inv.num} enregistrée.`);
  }

  function resetInvoiceLines() {
    const body = $('invoiceLines');
    if (!body) return;
    body.innerHTML = '';
    if (typeof addLine === 'function') addLine();
    else if (typeof recalcTotals === 'function') recalcTotals();
  }

  async function resetInvoice() {
    if (!await confirmAction('Réinitialiser la facture',
      'Toutes les lignes saisies seront effacées.', 'Réinitialiser')) return;
    resetInvoiceLines();
    if ($('invClient')) $('invClient').value = '';
    if ($('invRemise')) $('invRemise').value = '0';
    toast('Facture réinitialisée.');
  }

  /* Propose les clients existants en autocomplétion sur le champ de saisie. */
  function fillClientList() {
    const dl = $('mvClientList');
    if (!dl) return;
    dl.innerHTML = clientsData.map(c => `<option value="${esc(c.name)}"></option>`).join('');
  }

  /* ------------------------------------------------------------------------
     Archiver une facture reçue
     ------------------------------------------------------------------------ */

/* ==========================================================================
   LE JUSTIFICATIF D'UNE FACTURE REÇUE
   --------------------------------------------------------------------------
   Une capture d'écran se colle directement dans la page : Ctrl+V, et l'image
   part sur le serveur du panel. Elle est ensuite visible dans le registre,
   à côté de la ligne — ce qui n'était le cas d'AUCUNE pièce jointe jusqu'ici,
   pas même du champ « lien » qui était enregistré puis jamais réaffiché.

   L'image est réduite avant l'envoi, comme celles de la vitrine : une capture
   d'écran fait volontiers trois mégaoctets, et on n'en garde que ce qui est
   lisible.
   ========================================================================== */

  let frImage = '';        /* l'adresse du justificatif en cours de saisie */

  function frApercu() {
    const z = $('frApercu');
    if (!z) return;
    if (!frImage) {
      z.innerHTML = '<span class="fr-vide">Aucun justificatif. Collez une capture ici '
        + '(Ctrl+V), ou choisissez un fichier.</span>';
      return;
    }
    z.innerHTML = `<a href="${esc(frImage)}" target="_blank" rel="noopener">
        <img src="${esc(frImage)}" alt="justificatif"></a>
      <button type="button" class="btn" id="frImgRetirer">Retirer</button>`;
  }

  async function frDeposer(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && file.type !== 'application/pdf') {
      toast('Seules les images et les PDF peuvent être joints.'); return;
    }
    const z = $('frApercu');
    if (z) z.innerHTML = '<span class="fr-vide">Envoi en cours…</span>';
    try {
      frImage = await envoyerFichier(file);
      toast('Justificatif joint.');
    } catch (e) {
      frImage = '';
      toast('Le justificatif n\'a pas pu être envoyé : ' + (e.message || e));
    }
    frApercu();
  }

  /* Le collage n'est écouté que sur la page des factures reçues : ailleurs,
     un Ctrl+V doit rester un Ctrl+V. */
  document.addEventListener('paste', ev => {
    const page = document.querySelector('.page-content.active');
    if (!page || page.id !== 'page-facturesrecues') return;
    const cible = ev.target;
    /* On ne vole pas un collage destiné à un champ de saisie, sauf s'il
       s'agit d'une image — un champ texte n'en fera rien de toute façon. */
    const items = [...((ev.clipboardData && ev.clipboardData.items) || [])];
    const img = items.find(i => i.kind === 'file' && /^image\//.test(i.type));
    if (!img) return;
    if (cible && /^(INPUT|TEXTAREA)$/.test(cible.tagName) && !/^image\//.test(img.type)) return;
    ev.preventDefault();
    frDeposer(img.getAsFile());
  });

  document.addEventListener('change', ev => {
    const f = ev.target.closest('#frFichier');
    if (f && f.files && f.files[0]) { frDeposer(f.files[0]); f.value = ''; }
  });

  document.addEventListener('click', ev => {
    if (!ev.target.closest('#frImgRetirer')) return;
    frImage = '';
    frApercu();
  });

  document.addEventListener('dragover', ev => {
    const z = ev.target.closest && ev.target.closest('#frApercu');
    if (z) { ev.preventDefault(); z.classList.add('survol'); }
  });
  document.addEventListener('dragleave', ev => {
    const z = ev.target.closest && ev.target.closest('#frApercu');
    if (z) z.classList.remove('survol');
  });
  document.addEventListener('drop', ev => {
    const z = ev.target.closest && ev.target.closest('#frApercu');
    if (!z) return;
    ev.preventDefault();
    z.classList.remove('survol');
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) frDeposer(f);
  });

  /* Appelé à l'ouverture de la page. */
  function ouvrirFacturesRecues() {
    const d = $('frDateIn');
    if (d && !d.dataset.mvTouche) {
      d.value = aujourdhuiISO();
      champTouche(d);
    }
    frApercu();
  }

  function archiveFactureRecue() {
    const supplier = val('frSupplier');
    if (!supplier) { toast('Indiquez l\'entreprise émettrice.'); $('frSupplier') && $('frSupplier').focus(); return; }

    const iso = val('frDateIn');
    const item = {
      date: iso ? iso.split('-').reverse().join('/') : todayFR(),
      montant: parseFloat(String(val('frMontant')).replace(',', '.')) || 0,
      note: val('frNote') || '—',
      par: (window.MarloweSession && window.MarloweSession.name) || '—',
      lien: val('frLien') || '',
      image: frImage || '',
    };

    let group = facturesRecuesData.find(g => g.supplier.toLowerCase() === supplier.toLowerCase());
    if (group) group.items.unshift(item);
    else facturesRecuesData.unshift({ supplier, items: [item] });

    clear('frSupplier', 'frMontant', 'frNote', 'frLien');
    frImage = '';
    frApercu();
    refreshFrCounts();
    D().note(`a archivé une facture de ${supplier} (${item.montant.toLocaleString('fr-FR')} $)`);
    D().save('facturesRecues');
    toast(`Facture de ${supplier} archivée.`);
  }

  async function deleteClient(name) {
    const i = clientsData.findIndex(c => c.name === name);
    if (i < 0) return;
    if (!await confirmAction('Retirer le client', `${name} sera retiré de la base clients.`, 'Retirer')) return;
    D().note(`a retiré le client ${name}`);
    clientsData.splice(i, 1);
    refreshClientCounts();
    D().save('clients');
    toast('Client retiré.');
  }

  function refreshClientCounts() {
    ['clientsCount', 'clientsCount2'].forEach(id => { const e = $(id); if (e) e.textContent = clientsData.length; });
  }

  async function editClient(name) {
    const c = clientsData.find(x => x.name === name);
    if (!c) return;
    const r = await askForm('Modifier le client', [
      { key: 'name', label: 'Nom', value: c.name },
      { key: 'addr', label: 'Adresse', value: c.addr },
      { key: 'phone', label: 'Téléphone', value: c.phone || '' },
      { key: 'rib', label: 'RIB', value: c.rib || '' },
    ]);
    if (!r) return;
    if (!r.name) { toast('Le nom est obligatoire.'); return; }
    Object.assign(c, { name: r.name, addr: r.addr, phone: r.phone, rib: r.rib });
    D().save('clients');
    toast('Client mis à jour.');
  }

  async function addClient() {
    const r = await askForm('Nouveau client', [
      { key: 'name', label: 'Nom', value: '' },
      { key: 'addr', label: 'Adresse', value: '' },
      { key: 'phone', label: 'Téléphone', value: '' },
      { key: 'rib', label: 'RIB', value: '' },
    ]);
    if (!r) return;
    if (!r.name) { toast('Le nom est obligatoire.'); return; }
    clientsData.unshift({ name: r.name, addr: r.addr, phone: r.phone, rib: r.rib });
    refreshClientCounts();
    D().save('clients');
    toast('Client ajouté.');
  }

  async function deleteArticle(ref) {
    const i = articlesData.findIndex(a => a.ref === ref);
    if (i < 0) return;
    if (!await confirmAction('Retirer l\'article',
      `${articlesData[i].desc} sera retiré du catalogue.`, 'Retirer')) return;
    D().note(`a retiré l'article ${articlesData[i].desc}`);
    articlesData.splice(i, 1);
    refreshArticleCount();
    D().save('articles');
    toast('Article retiré.');
  }

  function refreshArticleCount() {
    const e = $('articlesCount'); if (e) e.textContent = articlesData.length;
  }

  async function editArticle(ref) {
    const a = articlesData.find(x => x.ref === ref);
    if (!a) return;
    const cats = [...new Set(articlesData.map(x => x.cat))];
    const r = await askForm('Modifier l\'article', [
      { key: 'desc', label: 'Description', value: a.desc },
      { key: 'cat', label: 'Catégorie', value: a.cat, options: cats },
      { key: 'poids', label: 'Poids (kg)', value: a.poids },
      { key: 'price', label: 'Prix public — vide si rupture', value: a.price == null ? '' : a.price },
      { key: 'priceB2B', label: 'Prix entreprise — vide = même prix', value: a.priceB2B == null ? '' : a.priceB2B },
    ]);
    if (!r) return;
    a.desc = r.desc || a.desc;
    a.cat = r.cat || a.cat;
    a.poids = parseFloat(String(r.poids).replace(',', '.')) || a.poids;
    a.price = r.price === '' ? null : (parseFloat(String(r.price).replace(',', '.')) || 0);
    a.priceB2B = r.priceB2B === '' ? null : (parseFloat(String(r.priceB2B).replace(',', '.')) || 0);
    D().save('articles');
    toast('Article mis à jour.');
  }

  async function addArticle() {
    const cats = [...new Set(articlesData.map(x => x.cat))];
    const r = await askForm('Nouvel article', [
      { key: 'desc', label: 'Description', value: '' },
      { key: 'cat', label: 'Catégorie', value: cats[0], options: cats },
      { key: 'poids', label: 'Poids (kg)', value: '1.5' },
      { key: 'price', label: 'Prix public — vide si rupture', value: '' },
      { key: 'priceB2B', label: 'Prix entreprise — vide = même prix', value: '' },
    ]);
    if (!r) return;
    if (!r.desc) { toast('La description est obligatoire.'); return; }

    const prefix = (typeof catPrefix === 'object' && catPrefix[r.cat]) || 'ART';
    const used = articlesData.filter(a => a.ref.startsWith(prefix + '-')).length;
    articlesData.unshift({
      cat: r.cat, desc: r.desc,
      ref: prefix + '-' + String(used + 1).padStart(2, '0'),
      poids: parseFloat(String(r.poids).replace(',', '.')) || 1.5,
      price: r.price === '' ? null : (parseFloat(String(r.price).replace(',', '.')) || 0),
      priceB2B: r.priceB2B === '' ? null : (parseFloat(String(r.priceB2B).replace(',', '.')) || 0),
    });
    refreshArticleCount();
    D().save('articles');
    toast('Article ajouté.');
  }

  function frLocate(token) {
    const [gi, ii] = String(token).split(':').map(Number);
    const g = facturesRecuesData[gi];
    if (!g || !g.items[ii]) return null;
    return { g, gi, ii, item: g.items[ii] };
  }

  async function deleteFactureRecue(token) {
    const f = frLocate(token);
    if (!f) return;
    if (!await confirmAction('Supprimer la facture reçue',
      `${f.g.supplier} — ${f.item.montant.toLocaleString('fr-FR')} $ du ${f.item.date}.`, 'Supprimer')) return;
    D().note(`a supprimé une facture reçue de ${f.g.supplier} (${f.item.montant.toLocaleString('fr-FR')} $)`);
    f.g.items.splice(f.ii, 1);
    if (!f.g.items.length) facturesRecuesData.splice(f.gi, 1);
    refreshFrCounts();
    D().save('facturesRecues');
    toast('Facture supprimée.');
  }

  function refreshFrCounts() {
    const n = facturesRecuesData.reduce((s, g) => s + g.items.length, 0);
    const a = $('frCount'); if (a) a.textContent = n;
    const b = $('frSupCount'); if (b) b.textContent = facturesRecuesData.length;
  }

  async function editFactureRecue(token) {
    const f = frLocate(token);
    if (!f) return;
    const r = await askForm('Modifier la facture reçue', [
      { key: 'date', label: 'Date', value: f.item.date },
      { key: 'montant', label: 'Montant', value: f.item.montant },
      { key: 'note', label: 'Note', value: f.item.note },
      { key: 'par', label: 'Enregistrée par', value: f.item.par },
    ]);
    if (!r) return;
    f.item.date = r.date || f.item.date;
    f.item.montant = parseFloat(String(r.montant).replace(/[^\d.,-]/g, '').replace(',', '.')) || f.item.montant;
    f.item.note = r.note;
    f.item.par = r.par;
    D().save('facturesRecues');
    toast('Facture mise à jour.');
  }

  /* ========================================================================
     CATALOGUE — retirer un lien Canva
     ======================================================================== */
  async function deleteCanva(key) {
    const slides = catalogueSlides[key];
    if (!slides || !slides.length) return;
    const idx = catalogueIndex[key] || 0;
    const s = slides[idx];

    if (!await confirmAction('Supprimer ce lien Canva',
      `« ${s.title} » sera retiré du catalogue ${key === 'entreprise' ? 'entreprise' : 'citoyens'}.`, 'Supprimer')) return;

    slides.splice(idx, 1);
    catalogueIndex[key] = Math.max(0, Math.min(idx, slides.length - 1));

    if (slides.length) renderCatalogue(key);
    else {
      const c = document.querySelector(`.canva-carousel[data-catalogue="${key}"]`);
      if (c) c.innerHTML = '<p class="empty-note" style="padding:26px 0;">Aucun lien Canva pour le moment.</p>';
    }
    D().save('catalogueSlides', false);
    toast('Lien supprimé.');
  }

  /* ========================================================================
     TABLEAU DE BORD — retirer une ligne
     ======================================================================== */
  async function deleteDashRow(name) {
    const i = dash.findIndex(d => d.name === name);
    if (i < 0) return;
    if (!await confirmAction('Retirer la ligne', `${name} sera retiré du tableau de bord.`, 'Retirer')) return;
    D().note(`a retiré ${name} du tableau de bord`);
    dash.splice(i, 1);
    D().save('dash');
    toast('Ligne retirée.');
  }

  /* ========================================================================
     AGENDA — ajouter / supprimer
     ======================================================================== */
  /* ------------------------------------------------------------------------
     QUI VOIT QUEL ÉVÉNEMENT
     La visibilité existait depuis le début mais ne servait à rien : la pastille
     changeait de couleur et l'événement restait affiché à tout le monde, « privé »
     compris. Elle filtre maintenant réellement, sur quatre niveaux :

       · public     — tout le monde ;
       · commercial — les rôles cochés dans Administration ▸ Agenda ;
       · direction  — les rôles cochés dans la même page, liste séparée ;
       · privé      — son seul auteur.

     Les deux listes de rôles sont indépendantes : à vous de mettre la direction
     dans la liste « commercial » si vous voulez qu'elle y ait accès aussi. Le
     patron voit tout, quelles que soient les listes — sinon il pourrait se
     verrouiller hors de son propre agenda.
     ------------------------------------------------------------------------ */
  const AGENDA_NIVEAUX = ['public', 'commercial', 'direction', 'prive'];

  function agendaVisible(ev) {
    if (!ev) return false;
    const vis = String(ev.vis || 'public');
    if (vis === 'public' || vis === 'tous') return true;

    const S = window.MarloweSession;
    if (!S) return false;                    /* pas encore connecté : rien de restreint */

    if (vis === 'prive') {
      /* « Privé » veut dire privé, y compris vis-à-vis du patron : c'est ce que
         la page a toujours promis. Les événements créés avant que l'auteur ne
         soit enregistré n'ont pas de « par » — ils restent visibles, plutôt que
         de disparaître sans prévenir. */
      if (!ev.par) return true;
      return String(ev.par) === String(S.id);
    }

    if (S.isPatron || S.isOwner) return true;
    if (vis === 'direction')  return !!S.voitDirection;
    if (vis === 'commercial') return !!S.voitCommercial;
    return true;
  }

  async function addEvent(visDepart) {
    const S = window.MarloweSession || {};
    const depart = AGENDA_NIVEAUX.includes(visDepart) ? visDepart : 'public';
    const r = await askForm(depart === 'commercial' ? 'Nouvel événement commercial' : 'Nouvel événement', [
      { key: 'title', label: 'Titre', value: '' },
      { key: 'date', label: 'Date (jj/mm/aaaa)', value: todayFR() },
      { key: 'heure', label: 'Heure de début', value: '18:00' },
      { key: 'heure_fin', label: 'Heure de fin', value: '19:00' },
      { key: 'vis', label: 'Visibilité', value: depart, options: AGENDA_NIVEAUX.slice() },
      { key: 'desc', label: 'Description', value: '' },
    ]);
    if (!r) return;
    if (!r.title) { toast('Le titre est obligatoire.'); return; }

    agendaData.push({
      title: r.title, date: r.date, heure: r.heure, heure_fin: r.heure_fin,
      vis: AGENDA_NIVEAUX.includes(r.vis) ? r.vis : 'public', desc: r.desc,
      /* Sans auteur, « privé » ne veut rien dire : on l'enregistre à la création. */
      par: S.id || null, parNom: S.name || null,
    });
    agendaData.sort((a, b) => {
      const da = parseFR(a.date), db = parseFR(b.date);
      return (da && db) ? da - db : 0;
    });
    D().save('agenda');
    toast('Événement ajouté.');
  }

  async function deleteEvent(i) {
    const ev = agendaData[i];
    if (!ev) return;
    if (!await confirmAction('Supprimer l\'événement', `« ${ev.title} » du ${ev.date}.`, 'Supprimer')) return;
    agendaData.splice(i, 1);
    D().save('agenda');
    toast('Événement supprimé.');
  }

  /* Le bouton d'ajout n'existe pas dans la page : on l'insère. Un par agenda,
     et celui de l'agenda commercial ouvre le formulaire déjà réglé sur
     « commercial » — sinon on créerait par mégarde un événement qui
     disparaîtrait de la page où on vient de l'ajouter. */
  function injectAgendaButton() {
    const poser = (listeId, boutonId, libelle) => {
      const list = $(listeId);
      if (!list || $(boutonId)) return;
      const bar = document.createElement('div');
      bar.className = 'btn-row';
      bar.style.margin = '0 0 16px';
      bar.innerHTML = `<button class="btn primary" id="${boutonId}">${libelle}</button>`;
      list.parentNode.insertBefore(bar, list);
    };
    poser('agendaList', 'mvAddEvent', '+ Ajouter un événement');
    poser('agendaComList', 'mvAddEventCom', '+ Ajouter un événement commercial');
  }

  /* ==========================================================================
     L'EFFECTIF SE DÉDUIT — il ne se saisissait nulle part
     --------------------------------------------------------------------------
     Vue d'ensemble, Effectif, Primes et Éligibilité lisent tous `effectifData`.
     Or RIEN dans le panel n'y écrivait jamais : la seule ligne qui en créait se
     trouvait dans l'annulation d'une clôture. Le registre RH pouvait être plein
     et la tablette collée, ces quatre écrans restaient vides — il n'y avait pas
     de passerelle entre le personnel et sa production.

     La voici. Elle croise deux sources et n'en invente aucune :

       · QUI travaille — le registre RH, pour les trois grades de production ;
       · COMBIEN il produit — le tableau de bord de la semaine, où les vins
         valent runs ÷ 5, exactement comme partout ailleurs.

     Deux prudences délibérées : une fiche déjà présente n'est jamais réécrite
     dans son grade ni son quota — une promotion accordée à la main survit à la
     synchronisation ; et personne n'est supprimé — un départ se déclare, il ne
     se devine pas.
     ========================================================================== */

  /* Les trois grades du parcours de production et leur enchaînement. Indexés
     par clé normalisée : le registre écrit « Ouvrier viticole », les primes
     « Ouvrier Viticole ». Les quotas n'y figurent plus — ils se règlent dans
     Administration ▸ Règles du domaine et se lisent par quotaDuGrade(). */
  const GRADE_PROD = {
    'saisonnier':       { grade: 'Saisonnier',       next: 'Ouvrier Viticole', final: false },
    'ouvrier viticole': { grade: 'Ouvrier Viticole', next: 'Chef de Culture',  final: false },
    'chef de culture':  { grade: 'Chef de Culture',  next: null,               final: true  },
  };

  function synchroniserEffectif() {
    const roster = (typeof rhRosterData !== 'undefined') ? rhRosterData : [];
    const lignes = (typeof dash !== 'undefined' && Array.isArray(dash)) ? dash : [];

    const production = new Map();
    lignes.forEach(d => production.set(String(d.name).trim().toLowerCase(),
                                       Math.round((Number(d.runs) || 0) / 5)));

    const existantes = new Map(effectifData.map(e => [String(e.name).trim().toLowerCase(), e]));
    let crees = 0, majBarils = 0;

    roster.forEach(emp => {
      if (emp.status && emp.status !== 'actif') return;
      const g = GRADE_PROD[clefPoste(emp.poste)];
      if (!g) return;                       /* hors parcours de production */

      const cle = String(emp.name).trim().toLowerCase();
      let e = existantes.get(cle);

      if (!e) {
        e = {
          name: emp.name, grade: g.grade, active: true,
          /* Le quota du grade et le palier de promotion se lisent dans les
             réglages : la table ci-dessus ne porte plus que l'enchaînement
             des grades. Le palier de promotion EST le quota du grade
             suivant — une seule valeur à régler, pas deux à accorder. */
          barils: 0, quota: quotaDuGrade(g.grade),
          nextGrade: g.next,
          promoTarget: g.next ? quotaDuGrade(g.next) : null,
          isFinal: g.final,
          distributed: false,
        };
        effectifData.push(e);
        existantes.set(cle, e);
        crees++;
      }

      if (production.has(cle)) {
        const b = production.get(cle);
        if (e.barils !== b) { e.barils = b; majBarils++; }
      }
    });

    /* Les fiches sans correspondance au registre ne sont pas effacées : elles
       peuvent venir d'une saisie manuelle. On les compte pour le dire. */
    const nomsRegistre = new Set(roster.map(e => String(e.name).trim().toLowerCase()));
    const orphelines = effectifData.filter(e => !nomsRegistre.has(String(e.name).trim().toLowerCase())).length;

    return { crees, majBarils, orphelines, total: effectifData.length };
  }

  function syncEffectifEtEnregistrer(silencieux) {
    const r = synchroniserEffectif();
    if (r.crees || r.majBarils) {
      D().note(`a synchronisé l'effectif (${r.crees} fiche(s) créée(s), ${r.majBarils} production(s) mise(s) à jour)`);
      D().save('effectif');
    }
    if (!silencieux) {
      const bouts = [];
      if (r.crees) bouts.push(`${r.crees} fiche(s) créée(s)`);
      if (r.majBarils) bouts.push(`${r.majBarils} production(s) reprise(s)`);
      if (r.orphelines) bouts.push(`${r.orphelines} hors registre`);
      toast(bouts.length ? bouts.join(' · ') : `Rien à reprendre — ${r.total} fiche(s) déjà à jour.`);
    }
    return r;
  }

  /* ========================================================================
     EFFECTIF — promouvoir, modifier, retirer
     ======================================================================== */
  const NEXT_GRADE = {
    'Saisonnier':       { next: 'Ouvrier Viticole', nextNext: 'Chef de Culture', final: false },
    'Ouvrier Viticole': { next: 'Chef de Culture',  nextNext: null,              final: true },
  };

  async function promoteEmployee(name) {
    const e = effectifData.find(x => x.name === name);
    if (!e) return;
    const step = NEXT_GRADE[e.grade];
    if (!step) { toast('Ce grade est déjà le dernier du parcours.'); return; }

    const nouveauQuota = quotaDuGrade(step.next);
    if (!await confirmAction('Promouvoir',
      `${e.name} passe de ${e.grade} à ${step.next}. Son quota hebdomadaire devient ${nouveauQuota.toLocaleString('fr-FR')} vins.`)) return;

    e.grade = step.next;
    e.quota = nouveauQuota;
    e.promoTarget = step.nextNext ? quotaDuGrade(step.nextNext) : null;
    e.nextGrade = step.nextNext;
    e.isFinal = step.final;

    D().note(`a promu ${e.name} au grade de ${step.next}`);
    D().save('effectif');
    toast(`${e.name} est promu ${step.next}.`);
  }

  /* Le cran EN DESSOUS, pour la rétrogradation. Écrit à part plutôt que
     déduit de NEXT_GRADE : un jour on ajoutera un grade, et une table qu'on
     lit à l'envers est une table qu'on oublie de mettre à jour. */
  const GRADE_INFERIEUR = {
    'Chef de Culture':  { bas: 'Ouvrier Viticole', nextNext: 'Chef de Culture', final: false },
    'Ouvrier Viticole': { bas: 'Saisonnier',       nextNext: 'Ouvrier Viticole', final: false },
    /* Saisonnier n'y figure pas : c'est le bas de l'échelle. On ne rétrograde
       pas quelqu'un qui est déjà au premier grade — on l'avertit. */
  };

  /* Ce que le panel propose pour une fiche sous quota.
     -------------------------------------------------------------------------
     Un ABSENT ne reçoit rien, et c'est le point le plus important : un employé
     en absence déclarée n'a pas produit parce qu'il n'était pas là. Le
     sanctionner pour ça n'a aucun sens, et c'est le genre d'automatisme qui
     fâche une équipe.

     Pour les autres, DEUX sanctions et non plus une seule au choix du panel.
     L'avertissement était réservé aux saisonniers, pour la seule raison qu'il
     n'existe pas de grade en dessous du leur — la rétrogradation prenait
     automatiquement le pas partout ailleurs. C'était confondre « la sanction
     la plus lourde possible » avec « la sanction qui convient » : un chef de
     culture à 200 vins près ne mérite pas de perdre son grade. L'avertissement
     vaut donc pour tout le monde ; la rétrogradation s'y ajoute quand il
     existe un cran en dessous, et c'est un humain qui choisit. */
  function actionSousQuota(e) {
    if (!e || !e.active) return null;
    const pct = e.quota > 0 ? (e.barils / e.quota) * 100 : 100;
    if (pct >= 100) return null;
    const bas = GRADE_INFERIEUR[e.grade];
    return { avert: true, vers: bas ? bas.bas : null };
  }
  window.mvActionSousQuota = actionSousQuota;

  async function retrograderEmploye(name) {
    const e = effectifData.find(x => x.name === name);
    if (!e) return;

    if (!e.active) {
      toast(`${e.name} est absent cette semaine — aucune sanction n'est proposée.`);
      return;
    }

    const bas = GRADE_INFERIEUR[e.grade];
    if (!bas) {
      /* Saisonnier : pas de cran en dessous, on bascule sur l'avertissement. */
      return avertirSousQuota(e);
    }

    const quotaBas = quotaDuGrade(bas.bas);
    if (!await confirmAction('Rétrograder',
      `${e.name} passe de ${e.grade} à ${bas.bas}. Son quota hebdomadaire devient `
      + `${quotaBas.toLocaleString('fr-FR')} vins.`, 'Rétrograder')) return;

    e.grade = bas.bas;
    e.quota = quotaBas;
    e.promoTarget = bas.nextNext ? quotaDuGrade(bas.nextNext) : null;
    e.nextGrade = bas.nextNext;
    e.isFinal = bas.final;

    D().note(`a rétrogradé ${e.name} au grade de ${bas.bas} (sous quota)`);
    D().save('effectif');
    toast(`${e.name} est rétrogradé ${bas.bas}.`);
  }

  /* Le NIVEAU qui vient ensuite pour quelqu'un.
     -------------------------------------------------------------------------
     Trois crans, et on monte d'un à chaque fois : rappel à l'ordre, puis
     avertissement, puis dernier avertissement. Au-delà, on reste au dernier —
     le panel ne va pas inventer une quatrième sanction, c'est une décision
     humaine qui se prend ailleurs qu'en cliquant sur un bouton. */
  function niveauSuivant(nom) {
    const deja = avertissements.filter(a => a.nom === nom).length;
    return NIVEAUX[Math.min(deja, NIVEAUX.length - 1)];
  }

  /* L'avertissement du saisonnier sous quota, SANS formulaire.
     -------------------------------------------------------------------------
     Le niveau se déduit du dossier, le motif du chiffre : il n'y a rien à
     saisir que le panel ne sache déjà. Reste une confirmation — « automatique »
     veut dire sans formulaire, pas sans qu'on demande. */
  async function avertirSousQuota(e) {
    const manque = Math.max(0, (e.quota || 0) - (e.barils || 0));
    const motif = `Quota non atteint : ${Number(e.barils || 0).toLocaleString('fr-FR')} / `
                + `${Number(e.quota || 0).toLocaleString('fr-FR')} vins, ${manque.toLocaleString('fr-FR')} manquants.`;
    const niveau = niveauSuivant(e.name);
    const deja = avertissements.filter(a => a.nom === e.name).length;

    if (!await confirmAction(`Avertir ${e.name}`,
      `${e.name} est ${e.grade} et n'a pas fait son quota. `
      + `Niveau : ${niveau}${deja ? ` (${deja} déjà au dossier)` : ''}. `
      + `Motif : ${motif} L'avertissement rejoint le dossier RH et part dans son ticket.`,
      'Avertir')) return;

    await enregistrerAvertissement({ nom: e.name, niveau, motif });
  }

  /* Le bouton ⚠ de la page Effectif : il part d'un nom, comme les autres. */
  async function avertirEmploye(name) {
    const e = effectifData.find(x => x.name === name);
    if (!e) return;
    if (!e.active) {
      toast(`${e.name} est absent cette semaine — aucune sanction n'est proposée.`);
      return;
    }
    await avertirSousQuota(e);
  }

  /* Enregistrer un avertissement, et le NOTIFIER.
     -------------------------------------------------------------------------
     Deux actes distincts, et l'ordre compte : le dossier RH d'abord, la
     notification ensuite. Ce n'est pas parce que Discord refuse d'écrire que
     la sanction n'a pas eu lieu — l'avertissement reste au dossier, et le
     panel dit que le message n'est pas parti. L'inverse — ne rien enregistrer
     parce que l'envoi a échoué — perdrait une décision RH pour une histoire
     de permission. */
  async function enregistrerAvertissement({ nom, niveau, motif, date }) {
    const sess = window.MarloweSession;
    avertissements.unshift({
      nom, niveau, motif: String(motif).trim(),
      /* Le formulaire manuel laisse antidater ; le bouton ⚠ ne passe rien et
         c'est la date du jour qui sert. */
      date: (date && String(date).trim()) || todayFR(),
      par: (sess && sess.name) || 'Direction',
    });
    D().note(`a donné un avertissement à ${nom} (${niveau})`);
    D().saveMany(['avertissements', 'rhRoster']);
    if (typeof renderAvertissements === 'function') renderAvertissements();

    const envoi = await notifierAvertissement(nom, niveau, motif);
    toast(`Avertissement enregistré pour ${nom}. ${envoi}`);
  }

  /* Prévient la personne dans son ticket. Rend une phrase à afficher. */
  async function notifierAvertissement(nom, niveau, motif) {
    const fiche = (typeof rhRosterData !== 'undefined' ? rhRosterData : [])
      .find(f => String(f.name).trim() === String(nom).trim());
    if (!fiche) return "Aucune fiche à ce nom : personne n'a été prévenu.";
    if (estDemo()) return '(démo) La personne aurait été prévenue dans son ticket.';

    const A = window.MarloweAuth;
    if (!A || !A.apiBrut) return "Le panel n'a pas pu joindre le serveur : personne n'a été prévenu.";

    const r = await A.apiBrut('/api/avertissement', {
      method: 'POST',
      body: JSON.stringify({ civil: String(fiche.id), niveau, motif: String(motif).trim() }),
    });
    if (r.ok) {
      return r.data.ou === 'ticket'
        ? `Prévenu dans #${r.data.salon}.`
        : 'Prévenu en message privé (aucun ticket ouvert).';
    }
    if (r.data && r.data.error === 'doublon') return 'Déjà notifié à l\'instant.';
    return 'MAIS la notification n\'est pas partie — ' + phraseRefus(r);
  }

  async function editEffectif(name) {
    const e = effectifData.find(x => x.name === name);
    if (!e) return;
    const r = await askForm('Modifier la fiche', [
      { key: 'barils', label: 'Production de la semaine', value: e.barils },
      { key: 'quota', label: 'Quota hebdomadaire', value: e.quota },
      { key: 'active', label: 'Dans le circuit quotas', value: e.active ? 'Oui' : 'Non', options: ['Oui', 'Non'] },
    ], e.name);
    if (!r) return;

    e.barils = parseInt(String(r.barils).replace(/\D/g, ''), 10) || 0;
    e.quota = parseInt(String(r.quota).replace(/\D/g, ''), 10) || 0;
    e.active = r.active === 'Oui';

    D().save('effectif');
    toast('Fiche mise à jour.');
  }

  async function deleteEffectif(name) {
    const i = effectifData.findIndex(x => x.name === name);
    if (i < 0) return;
    if (!await confirmAction('Retirer la fiche',
      `${name} ne sera plus suivi dans les quotas ni dans l'éligibilité.`, 'Retirer')) return;
    D().note(`a retiré la fiche de production de ${name}`);
    effectifData.splice(i, 1);
    D().save('effectif');
    toast('Fiche retirée.');
  }

  /* ========================================================================
     CYCLE HEBDOMADAIRE — clôture du lundi
     ------------------------------------------------------------------------
     Clôturer, c'est arrêter les compteurs de la semaine écoulée et repartir
     de zéro. Ce qui est archivé sert ensuite à l'éligibilité : on distribue
     les récompenses de la semaine TERMINÉE, pas de celle en cours.

     Une photo de l'état d'avant est conservée pour « Annuler la clôture ».
     ======================================================================== */

  const clotures = { weeks: [], undo: null };

  /* La semaine clôturée est celle des 7 jours qui précèdent aujourd'hui :
     un lundi, cela donne exactement lundi → dimanche. */
  function closingPeriod() {
    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    return { start, end };
  }

  const frDate = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

  /* Numéro de semaine ISO — celui qu'affiche l'en-tête « Semaine 34 ». */
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - jan1) / 86400000 + 1) / 7);
  }

  const lastClosedWeek = () => clotures.weeks[0] || null;

  async function closeWeek() {
    const { start, end } = closingPeriod();
    const label = `Semaine ${isoWeek(start)}`;

    const eligibles = effectifData
      .filter(e => e.active && e.barils >= e.quota)
      .map(e => ({
        name: e.name, grade: e.grade, barils: e.barils, quota: e.quota,
        reward: (typeof rewardsByGrade === 'object' && rewardsByGrade[e.grade]) || '—',
        distributed: false,
      }));

    const heures = serviceHistory.filter(s => s.end)
      .reduce((sum, s) => sum + durationMinutes(s.start, s.end), 0);

    /* Photographie chiffrée de la semaine, pour la page Historique. */
    const bil = bilanCompute();
    const actifs = effectifData.filter(e => e.active);
    const sansProd = actifs.filter(e => !e.barils).length;
    const meilleur = actifs.slice().sort((a, b) => (b.barils || 0) - (a.barils || 0))[0];
    const recrutes = rhRosterData.filter(e => {
      const d = parseFR(e.date);
      return d && d >= start && d <= end;
    }).length;

    const ok = await confirmAction(
      `Clôturer ${label}`,
      `Du ${frDate(start)} au ${frDate(end)}.\n\n` +
      `${eligibles.length} employé(s) ont atteint leur quota. ` +
      `Les compteurs de production et les prises de service repartent à zéro, ` +
      `et l'éligibilité basculera sur cette semaine. La clôture reste annulable.`);
    if (!ok) return;

    /* Photo de l'état actuel, pour pouvoir revenir en arrière. */
    clotures.undo = {
      effectif: JSON.parse(JSON.stringify(effectifData)),
      serviceHistory: JSON.parse(JSON.stringify(serviceHistory)),
      dash: JSON.parse(JSON.stringify(dash)),
      weekId: label + ' ' + frDate(start),
    };

    clotures.weeks.unshift({
      id: label + ' ' + frDate(start),
      label,
      du: frDate(start),
      au: frDate(end),
      closedAt: frDate(new Date()),
      heures,
      eligibles,
      /* Production de TOUT le monde, pas seulement des éligibles :
         c'est ce qui alimente l'historique personnel de chaque employé. */
      production: effectifData.map(e => ({
        name: e.name, grade: e.grade, barils: e.barils, quota: e.quota,
      })),

      /* Récapitulatif de la semaine — alimente la page Historique. */
      ca: bil.caTotal,
      primes: bil.primes,
      ventes: dash.reduce((s, d) => s + (d.ventes || 0), 0),
      effectif: rhRosterData.filter(e => e.status === 'actif').length,
      recrutements: recrutes,
      sansProduction: actifs.length ? Math.round(sansProd / actifs.length * 100) : 0,
      vainqueur: meilleur && meilleur.barils ? meilleur.name : null,
      primesExceptionnelles: primesExc.slice(),
      palier: bil.palierIndex + 1,
      taux: bil.palier.taux,
      impot: bil.impot,
      tresorerie: bil.tresorerie,
    });

    /* Remise à zéro */
    effectifData.forEach(e => { e.barils = 0; e.distributed = false; });

    /* Le tableau de bord repart lui aussi de zéro : sans ça, le chiffre
       d'affaires de la semaine écoulée serait recompté la semaine suivante.
       Les personnes restent, seuls leurs compteurs sont remis à plat. */
    dash.forEach(d => { d.runs = 0; d.factures = 0; d.ventes = 0; d.part = 0; d.heures = '0h00min'; });

    serviceHistory.length = 0;
    serviceActive = false;
    primesExc.length = 0;
    resetServiceButton();

    D().note(`a clôturé ${label} (${eligibles.length} éligible(s), ${Math.round(bil.caTotal).toLocaleString('fr-FR')} $ de CA)`);
    D().saveMany(['effectif', 'serviceHistory', 'dash']);
    D().save('clotures', false);
    D().save('primesExc', false);
    refreshWeekHeaders();
    renderEligibilite();
    renderWeekHistory();
    renderHistorique();
    renderPrimesExc();
    renderBilan();
    /* L'étape « Clôturer » se coche d'elle-même. */
    if (!(clotureSteps.done || []).includes('close')) {
      clotureSteps.done = [...(clotureSteps.done || []), 'close'];
      D().save('clotureSteps', false);
    }
    renderCloture();
    toast(`${label} clôturée — ${eligibles.length} éligible(s).`);
  }

  async function undoClose() {
    const w = lastClosedWeek();
    if (!w || !clotures.undo || clotures.undo.weekId !== w.id) {
      toast('Aucune clôture récente à annuler.');
      return;
    }
    if (!await confirmAction('Annuler la clôture',
      `${w.label} redevient la semaine en cours. Les productions et les heures de service d'avant la clôture sont rétablies.`)) return;

    effectifData.length = 0;
    clotures.undo.effectif.forEach(e => effectifData.push(e));
    serviceHistory.length = 0;
    clotures.undo.serviceHistory.forEach(s => serviceHistory.push(s));
    if (Array.isArray(clotures.undo.dash)) {
      dash.length = 0;
      clotures.undo.dash.forEach(d => dash.push(d));
    }

    if (Array.isArray(w.primesExceptionnelles)) {
      primesExc.length = 0;
      w.primesExceptionnelles.forEach(x => primesExc.push(x));
      D().save('primesExc', false);
    }
    clotures.weeks.shift();
    clotures.undo = null;

    D().note(`a annulé la clôture de ${w.label}`);
    D().saveMany(['effectif', 'serviceHistory', 'dash']);
    D().save('clotures', false);
    refreshWeekHeaders();
    renderEligibilite();
    renderWeekHistory();
    renderHistorique();
    renderPrimesExc();
    renderBilan();
    clotureSteps.done = (clotureSteps.done || []).filter(x => x !== 'close');
    D().save('clotureSteps', false);
    renderCloture();
    toast('Clôture annulée.');
  }

  function resetServiceButton() {
    const btn = $('serviceBtn'), st = $('serviceStatus');
    if (btn) { btn.textContent = 'Prise de service'; btn.classList.remove('danger'); }
    if (st) { st.textContent = 'Hors service'; st.classList.remove('on'); }
  }

  /* ------------------------------------------------------------------------
     ÉLIGIBILITÉ — la semaine clôturée fait foi
     Tant qu'aucune semaine n'a été clôturée, on garde le comportement
     d'origine : la production en cours.
     ------------------------------------------------------------------------ */
  /* Une liste vide sans explication laisse chercher la panne là où il n'y en a
     pas. Trois situations très différentes se cachaient derrière la même
     phrase : la semaine n'a pas encore de chiffres, elle en a mais personne
     n'a franchi son palier, ou l'on regarde une semaine déjà clôturée. */
  function videEligibilite(semaine) {
    if (semaine) {
      return `<tr><td colspan="6"><div class="mv-vide">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
          <rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>
        <div class="mv-vide-t">Personne n'était éligible sur cette semaine.</div>
        <div class="mv-vide-s">La ${esc(semaine.label.toLowerCase())} a bien été clôturée,
          mais aucun employé n'avait atteint son quota.</div>
      </div></td></tr>`;
    }

    /* Aucune semaine clôturée : l'éligibilité se lit sur la semaine -1, il n'y
       en a donc encore aucune à afficher. Le dire, plutôt que de montrer la
       semaine en cours — ses chiffres bougent encore et les récompenses
       auraient été distribuées sur des quotas non arrêtés. */
    const production = effectifData.some(e => e.active && (e.barils || 0) > 0);

    return `<tr><td colspan="6"><div class="mv-vide">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3">
        <rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>
      <div class="mv-vide-t">Aucune semaine n'a encore été clôturée.</div>
      <div class="mv-vide-s">Les récompenses se calculent sur la <b>semaine précédente</b>,
        une fois ses chiffres arrêtés. ${production
          ? 'La production de la semaine en cours est bien enregistrée : clôturez-la et cette liste se remplira.'
          : 'Collez d\'abord la tablette dans <b>Tableau de bord</b>, puis clôturez la semaine.'}</div>
      <button class="btn" data-aller="${production ? 'cloture' : 'statsdash'}">${
        production ? 'Aller à la clôture' : 'Aller au tableau de bord'}</button>
    </div></td></tr>`;
  }

  /* Le filtre de la page Éligibilité. Il vit hors de la fonction de rendu :
     celle-ci est rappelée à chaque synchronisation, et une variable interne
     repartirait de zéro à chaque fois. */
  let elFiltre = '';

  function renderEligibilite() {
    const body = $('eligibiliteBody');
    if (!body) return;

    /* Semaine -1 uniquement : la dernière semaine clôturée. Tant qu'aucune ne
       l'est, la page reste vide et l'explique — voir videEligibilite. */
    const w = lastClosedWeek();
    const toutes = w ? w.eligibles : [];

    /* Les trois compteurs du haut portent sur la SEMAINE, pas sur la
       recherche : ils répondent à « combien reste-t-il à distribuer », et
       taper un nom ne doit pas changer cette réponse. */
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('el-count', toutes.length);
    set('el-distrib', toutes.filter(r => r.distributed).length);
    set('el-pending', toutes.filter(r => !r.distributed).length);

    const q = elFiltre.trim().toLowerCase();
    const rows = q
      ? toutes.filter(r => `${r.name} ${r.grade} ${r.reward}`.toLowerCase().includes(q))
      : toutes;

    const champ = $('elSearch');
    if (champ && champ.value !== elFiltre) champ.value = elFiltre;

    const sub = document.querySelector('#page-eligibilite .page-sub');
    if (sub) {
      sub.textContent = w
        ? `Récompenses de la ${w.label.toLowerCase()} — du ${w.du} au ${w.au}, clôturée le ${w.closedAt}.`
        : 'Les récompenses portent sur la semaine précédente : aucune semaine clôturée pour l\'instant.';
    }

    const cls = (typeof gradePillClass === 'function') ? gradePillClass : () => 'gp-muted';

    body.innerHTML = rows.length ? rows.map(r => `
      <tr>
        <td>${esc(r.name)}</td>
        <td><span class="grade-pill ${cls(r.grade)}">${esc(r.grade)}</span></td>
        <td class="num">${Number(r.barils).toLocaleString('fr-FR')}</td>
        <td>${esc(r.reward)}</td>
        <td>${r.distributed
          ? '<span class="status-chip status-paid">Distribuée</span>'
          : '<span class="status-chip status-pending">À distribuer</span>'}</td>
        <td style="text-align:right;">${r.distributed
          ? `<button class="btn" data-undistribute="${esc(r.name)}" style="padding:7px 12px;font-size:11.5px;" title="Revenir sur cette distribution">↺ Annuler</button>`
          : `<button class="btn" data-distribute="${esc(r.name)}" style="padding:7px 12px;font-size:11.5px;">Marquer distribuée</button>`}</td>
      </tr>`).join('')
      : (toutes.length
          ? `<tr><td colspan="6"><div class="mv-vide"><div class="mv-vide-t">Aucun éligible ne correspond à « ${esc(elFiltre.trim())} ».</div></div></td></tr>`
          : videEligibilite(w));
  }

  document.addEventListener('input', e => {
    if (!e.target || e.target.id !== 'elSearch') return;
    elFiltre = e.target.value || '';
    renderEligibilite();
  });

  /* Met à jour les en-têtes qui affichaient une semaine figée dans le fichier. */
  function refreshWeekHeaders() {
    const { start, end } = closingPeriod();
    const w = lastClosedWeek();

    const range = $('weekRange');
    if (range) {
      const m = mondayOf(new Date());
      const sun = new Date(m); sun.setDate(sun.getDate() + 6);
      range.textContent = `Semaine ${isoWeek(m)} · du ${frDate(m)} au ${frDate(sun)}`;
    }

    const sub = document.querySelector('#page-statsprimes .primes-sub');
    if (sub) {
      sub.textContent = `Prochaine clôture : du ${frDate(start)} au ${frDate(end)} · `
        + `prime = vins × multiplicateur, dans la limite du plafond de prime du palier`;
    }
    const h = document.querySelector('#page-statsprimes .primes-titlewrap h1');
    if (h) h.innerHTML = `Semaine ${isoWeek(start)} — <span class="accent">Primes</span>`;

    const cancel = $('annulerClotureBtn');
    if (cancel) {
      const can = !!(w && clotures.undo && clotures.undo.weekId === w.id);
      cancel.disabled = !can;
      cancel.style.opacity = can ? '' : '.45';
      cancel.title = can ? `Annuler la clôture de ${w.label}` : 'Aucune clôture récente à annuler';
    }
  }

  /* ========================================================================
     AGENDA — la vue journée s'ouvre sur aujourd'hui
     ======================================================================== */
  const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  function refreshWeekDays() {
    if (typeof weekDays === 'undefined') return;

    const monday = mondayOf(new Date());
    const today = frDate(new Date());

    weekDays.length = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      weekDays.push({ label: DAY_LABELS[i], date: frDate(d) });
    }

    /* Le planning s'affiche à la semaine : plus d'onglet de jour à activer,
       la colonne du jour courant est simplement mise en valeur. */
    if (typeof renderWeekGrid === 'function') renderWeekGrid();
  }

  /* ========================================================================
     TARIFS — prix public et prix entreprise
     ------------------------------------------------------------------------
     Chaque article porte deux prix. Le tarif retenu sur une facture est
     choisi en haut du formulaire ; les lignes s'y conforment.
     Un article sans prix entreprise retombe sur son prix public.
     ======================================================================== */
  function currentTarif() {
    const s = $('invTarif');
    return s && s.value === 'entreprise' ? 'entreprise' : 'public';
  }

  window.mvPrixArticle = function (article, tarif) {
    if (!article) return 0;
    const t = tarif || currentTarif();
    if (t === 'entreprise' && article.priceB2B != null) return article.priceB2B;
    return article.price;
  };

  /* Rejoue les prix de toutes les lignes après un changement de tarif. */
  function applyTarifToLines() {
    document.querySelectorAll('#invoiceLines .line-row').forEach(row => {
      const ref = row.querySelector('.l-ref');
      if (!ref) return;
      const a = articlesData.find(x => x.ref === ref.value);
      if (a) row.querySelector('.l-pu').value = window.mvPrixArticle(a);
    });
    if (typeof recalcTotals === 'function') recalcTotals();
    toast(currentTarif() === 'entreprise' ? 'Tarif entreprise appliqué.' : 'Tarif public appliqué.');
  }

  /* ========================================================================
     PRESSE-PAPIERS
     ------------------------------------------------------------------------
     navigator.clipboard n'existe qu'en contexte sécurisé (https). En secours
     on passe par une zone de texte cachée, puis, en dernier recours, par une
     fenêtre où le texte est présélectionné pour un Ctrl+C manuel.
     ======================================================================== */
  async function copyToClipboard(text, quoi) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        toast(quoi + ' copié — collez dans le tableur.');
        return;
      }
    } catch (e) { /* on tente la suite */ }

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) { toast(quoi + ' copié — collez dans le tableur.'); return; }
    } catch (e) { /* on tente la suite */ }

    showCopyFallback(text, quoi);
  }

  function showCopyFallback(text, quoi) {
    ensureDialog();
    dlg.querySelector('.mv-dlg').innerHTML = `
      <h3>${esc(quoi)}</h3>
      <p>La copie automatique a été refusée par le navigateur.
         Le texte est sélectionné : faites <b>Ctrl+C</b>, puis collez dans le tableur.</p>
      <textarea id="mvCopyArea" style="width:100%;height:180px;background:rgba(0,0,0,.25);
        border:1px solid var(--band,#3D372C);border-radius:9px;padding:10px;
        color:var(--parchment,#EDE3CF);font-family:'IBM Plex Mono',monospace;font-size:11.5px;
        resize:vertical;">${esc(text)}</textarea>
      <div class="mv-dlg-btns"><button data-yes class="go">Fermer</button></div>`;
    dlg.style.display = 'flex';
    const ta = $('mvCopyArea');
    setTimeout(() => { ta.focus(); ta.select(); }, 40);
    dlg.querySelector('[data-yes]').onclick = () => close(true);
  }

  /* ========================================================================
     BILAN COMPTABLE
     ------------------------------------------------------------------------
     Tout est recalculé depuis les données vivantes : le fichier d'origine
     figeait ces valeurs au chargement, elles ne bougeaient plus ensuite.

     Enchaînement officiel :
       CA total          = Σ (runs + factures + ventes)
       Bénéfice imposable = CA total − salaires − factures reçues
                            (avant primes — c'est lui qui fixe le palier)
       Palier            → plafonds de salaire et de prime
       Primes            = vins × multiplicateur, plafonnées
       Dépenses          = salaires + primes + factures reçues
     ======================================================================== */

  /* La colonne « dir. » du barème est celle du PATRON, et de lui seul.
     -------------------------------------------------------------------------
     Elle s'appelle « direction » dans le barème du serveur, ce qui a fait
     croire — à moi comme au fichier d'origine — qu'elle couvrait toute la
     direction. Elle ne couvre que le Patron : ni le Co-Patron ni le
     Responsable Commercial n'y ont droit, ils sont plafonnés comme les
     employés. Salaire ET prime, la même règle pour les deux colonnes. */
  const RANGS_PATRON = () => (typeof bcRangsPatron !== 'undefined' ? bcRangsPatron : ['Patron']);

  /* ------------------------------------------------------------------------
     LA formule de prime — une seule, partagée.
     Le fichier d'origine en contenait deux qui ne donnaient pas le même
     résultat : la page Primes plafonnait les vins puis multipliait, le
     bilan multipliait puis plafonnait la somme.

         vins   = runs / 5        (TOUTE la production compte)
         prime  = vins × multiplicateur du grade
         prime  = min(prime, plafond de prime du palier)

     L'écrêtage des vins à 19 000 par semaine a disparu. Il inventait un
     second plafond que personne n'avait demandé : au-delà de 19 000 vins,
     produire davantage ne rapportait plus rien, et deux personnes aux
     productions très différentes ressortaient avec la même prime. Les
     3 000 / 5 000 / 8 000 sont un MINIMUM exigé, pas un maximum servi.
     Le seul plafond qui reste est celui du palier — celui du bilan
     comptable, qui est une règle du serveur et se règle dans Règles.

     Toute modification de la règle se fait ici et nulle part ailleurs.
     ------------------------------------------------------------------------ */

  /* Le quota d'une personne vient de SA fiche d'effectif, pas du barème de son
     grade : deux saisonniers peuvent avoir des attentes différentes, et c'est
     la fiche qui fait foi. Le barème ne sert que de repli tant que la fiche
     n'a pas de quota. Un quota nul ne bloque rien — sinon la direction, qui
     n'a pas de fiche de production, perdrait sa prime. */
  const QUOTA_DEFAUT_GRADE = { 'Saisonnier': 3000, 'Ouvrier Viticole': 5000, 'Chef de Culture': 8000 };

  /* Le quota MINIMUM d'un grade.
     -------------------------------------------------------------------------
     3 000 / 5 000 / 8 000 vivaient en dur à cinq endroits du panel. Ce sont
     des règles de domaine, pas du code : elles se règlent maintenant dans
     Administration ▸ Règles du domaine, et tout le reste les lit ici.

     Contrairement au multiplicateur, ZÉRO est une valeur qui veut dire quelque
     chose : « ce grade n'a pas de quota ». Le réglage stocke donc aussi les
     zéros, et le barème d'origine ne sert que tant que personne n'a rien
     enregistré. Un grade inconnu vaut 0 — jamais 3 000 : inventer un seuil à
     quelqu'un lui coûterait sa prime en silence. */
  function quotaDuGrade(grade) {
    const g = String(grade || '').trim();
    if (!g) return 0;
    const lire = t => {
      if (t[g] !== undefined) return Math.max(0, Math.round(Number(t[g]) || 0));
      const k = Object.keys(t).find(x => x.toLowerCase() === g.toLowerCase());
      return k === undefined ? undefined : Math.max(0, Math.round(Number(t[k]) || 0));
    };
    const v = lire((reglages && reglages.quotas) || {});
    if (v !== undefined) return v;
    const d = lire(QUOTA_DEFAUT_GRADE);
    return d === undefined ? 0 : d;
  }
  window.mvQuotaGrade = quotaDuGrade;

  function quotaDeLaFiche(nom, grade) {
    const lignes = (typeof effectifData !== 'undefined' && Array.isArray(effectifData)) ? effectifData : [];
    const f = nom ? lignes.find(e => clefNom(e.name) === clefNom(nom)) : null;
    const q = f ? Number(f.quota) || 0 : 0;
    if (q > 0) return q;
    return quotaDuGrade(grade);
  }
  window.mvQuotaFiche = quotaDeLaFiche;

  window.mvCalculPrime = function (runs, rang, palier, nom) {
    const barils = Math.round((runs || 0) / 5);

    /* Le quota est un SEUIL, pas une part : en dessous, aucune prime ; au-delà,
       la production réelle compte. La règle était appliquée sur la page Primes
       et NULLE PART ailleurs — le bilan payait donc une prime à quelqu'un que
       la page Primes laissait à zéro. Elle vit ici désormais, avec le reste de
       la formule. */
    const seuil = quotaDeLaFiche(nom, rang);
    if (seuil > 0 && barils < seuil) return 0;

    const mult = multiplicateurDuGrade(rang);
    let prime = barils * mult;
    /* Le plafond du palier : « sans dépasser le max » du bilan comptable. */
    if (palier) {
      const patron = RANGS_PATRON().includes(rang);
      prime = Math.min(prime, patron ? palier.primeDir : palier.primeEmp);
    }
    return Math.round(prime);
  };

  /* Lignes saisies à la main dans le bilan : elles ne viennent pas de la
     tablette, donc rien ne les régénère — sans stockage propre elles
     disparaissaient au rechargement. */
  const bcManuels = [];

  /* Les anciens employés — ceux qui ont démissionné.
     -------------------------------------------------------------------------
     Un départ RETIRE la fiche du registre : plus rien ne rattache leurs
     ventes, et le Worker les range parmi les lignes « non rattachées » de
     Quota en direct. Leur production de la semaine appartient pourtant au
     domaine et doit être déclarée. Elle entre donc d'office dans le bilan,
     sans qu'il y ait rien à cliquer — mais avec la production SEULE : ni
     salaire, ni prime, puisqu'ils ne sont plus là pour en toucher.

     Le risque, assumé : une faute de frappe dans un nom produit elle aussi
     une ligne non rattachée, qui entrera dans le bilan comme les autres.
     C'est pour ça que ces lignes portent la mention « hors registre » dans
     le détail : le total ne bouge jamais en silence. */
  let bcOrphelins = [];

  const bcClefNom = n => String(n == null ? '' : n).trim().toLowerCase();

  /* La période du bilan est la semaine du domaine — lundi 00 h 00 heure de
     Paris → maintenant. On ne lit PAS le sélecteur de Quota en direct : le
     bilan ne doit pas changer de période parce que quelqu'un a regardé les
     30 derniers jours sur une autre page. */
  async function chargerOrphelinsBilan() {
    if (typeof bcRows === 'undefined') return;
    /* En démo il n'y a pas de Worker : on prend la même ligne non rattachée
       que la page Quota, pour que la mention « hors registre » se voie. */
    if (estDemo()) {
      bcOrphelins = qdDemo().orphelines || [];
      try { renderBilan(); } catch (e) {}
      return;
    }
    const A = window.MarloweAuth;
    if (!A || !A.apiBrut) return;
    const r = await A.apiBrut(`/api/quota?du=${qdLundi(0)}&au=${Date.now()}`);
    /* Un Worker muet ne doit pas vider le bilan : on garde ce qu'on avait. */
    if (!r || !r.ok || !r.data || !Array.isArray(r.data.orphelines)) return;
    bcOrphelins = r.data.orphelines;
    try { renderBilan(); } catch (e) {}
  }

  function rebuildBcRows() {
    if (typeof bcRows === 'undefined') return;
    const manuels = bcManuels.map(m => Object.assign({ manuel: true }, m));
    const auto = dash.map(e => ({
      name: e.name, rank: e.rank,
      runs: e.runs || 0, factures: e.factures || 0, ventes: e.ventes || 0,
      ca: (e.runs || 0) + (e.factures || 0) + (e.ventes || 0),
      /* Même barème que partout ailleurs : celui des Règles du domaine.
         Le repli à 1 500 $ pour tout grade inconnu a disparu — il inventait
         un salaire à des gens qui n'en avaient pas. */
      salaire: salaireDuGrade(e.rank),
    }));

    /* Une ligne non rattachée dont le nom figure déjà dans la tablette ou
       dans une ligne manuelle serait la même production comptée deux fois. */
    const deja = new Set(auto.concat(manuels).map(e => bcClefNom(e.name)));
    const anciens = bcOrphelins
      .filter(o => o && o.nom && !deja.has(bcClefNom(o.nom)))
      .map(o => {
        /* Le log dit « 54x Vin … 270$ pour la société » : la part du domaine
           vaut cinq fois le nombre de vins, exactement comme la colonne RUN
           de la tablette dont on tire déjà les barils (runs / 5). */
        const runs = Math.max(0, Math.round(o.vins || 0)) * 5;
        /* La colonne VENTES du bilan est un MONTANT. Le « ventes » que
           renvoie /api/quota est un NOMBRE d'opérations de vente lues dans
           les logs — deux choses différentes sous le même mot. Y recopier le
           décompte affichait « 1 $ » pour une personne qui avait vendu une
           fois. La part du domaine est déjà entière dans runs. */
        return {
          name: o.nom, rank: 'Ancien employé',
          runs, factures: 0, ventes: 0,
          ca: runs, salaire: 0, exEmploye: true,
        };
      });

    bcRows = auto.concat(manuels, anciens);
  }

  /* Ajout d'une ligne manuelle : un vrai formulaire, tous les champs d'un
     coup. L'ancienne version demandait le nom par une invite du navigateur
     puis créait une ligne à zéro qu'il fallait ensuite corriger nulle part. */
  async function ajouterLigneManuelle() {
    const grades = (typeof multiplierFor === 'object')
      ? Object.keys(multiplierFor) : ['Saisonnier'];

    const r = await askForm('Ajouter une ligne au bilan', [
      { key: 'name',     label: 'Employé', value: '' },
      { key: 'rank',     label: 'Grade', value: grades[0], options: grades },
      { key: 'runs',     label: 'Runs ($)', value: '0', type: 'number' },
      { key: 'factures', label: 'Factures ($)', value: '0', type: 'number' },
      { key: 'ventes',   label: 'Ventes (nombre)', value: '0', type: 'number' },
      { key: 'salaire',  label: 'Salaire ($)', value: '0', type: 'number' },
    ], "Pour une personne absente de la tablette de la semaine. La prime est calculée automatiquement à partir des runs et du grade.");
    if (!r) return;

    const nom = (r.name || '').trim();
    if (!nom) { toast('Il faut au moins un nom.'); return; }

    const n = v => Math.max(0, Math.round(Number(v) || 0));
    const runs = n(r.runs), factures = n(r.factures), ventes = n(r.ventes);

    bcManuels.push({
      name: nom, rank: r.rank, runs, factures, ventes,
      ca: runs + factures + ventes, salaire: n(r.salaire),
    });
    D().note(`a ajouté ${nom} au bilan (ligne manuelle)`);
    D().save('bcManuels');
    toast(`${nom} ajouté au bilan.`);
  }

  function retirerLigneManuelle(nom) {
    const i = bcManuels.findIndex(m => m.name === nom);
    if (i < 0) return;
    bcManuels.splice(i, 1);
    D().note(`a retiré ${nom} du bilan`);
    D().save('bcManuels');
    toast(`${nom} retiré du bilan.`);
  }

  document.addEventListener('click', e => {
    if (e.target.closest('#bcAddRowBtn')) { ajouterLigneManuelle(); return; }
    const d = e.target.closest('[data-bc-del]');
    if (d) retirerLigneManuelle(d.dataset.bcDel);
  });

  /* Réglage du bilan : palier forcé ou détection automatique. */
  const bilanConfig = { palier: 'auto' };

  function bilanCompute() {
    rebuildBcRows();

    const rows = (typeof bcRows !== 'undefined' ? bcRows : []);
    const bareme = (typeof baremeData !== 'undefined') ? baremeData : [];
    const caTotal = rows.reduce((s, e) => s + (e.ca || 0), 0);
    const autres = facturesRecuesData
      .reduce((s, g) => s + g.items.reduce((s2, i) => s2 + (i.montant || 0), 0), 0);

    const pickPalier = (benef) => {
      if (bilanConfig.palier !== 'auto') {
        const i = Math.max(0, Math.min(bareme.length - 1, parseInt(bilanConfig.palier, 10)));
        return i;
      }
      let i = bareme.findIndex(b => benef >= b.min && benef <= b.max);
      if (i < 0) i = benef < (bareme[0] ? bareme[0].min : 0) ? 0 : bareme.length - 1;
      return i;
    };

    /* Les salaires sont plafonnés par le palier, et entrent dans le calcul
       qui détermine ce même palier. Deux passes suffisent à se stabiliser. */
    const estPatron = r => RANGS_PATRON().includes(r);
    let idx = pickPalier(caTotal - rows.reduce((s, e) => s + (e.salaire || 0), 0) - autres);
    for (let pass = 0; pass < 2; pass++) {
      const p = bareme[idx] || { salEmp: 0, salDir: 0 };
      const sal = rows.reduce((s, e) => s + Math.min(e.salaire || 0, estPatron(e.rank) ? p.salDir : p.salEmp), 0);
      idx = pickPalier(caTotal - sal - autres);
    }
    const palier = bareme[idx] || { taux: 0, salEmp: 0, salDir: 0, primeEmp: 0, primeDir: 0 };

    const recrues = recruesSemaine(rhRosterData);
    const detail = rows.map(e => {
      const patron = estPatron(e.rank);
      const exc = e.exEmploye ? 0
        : primesExc.filter(x => x.nom === e.name).reduce((s, x) => s + x.montant, 0);
      /* La prime de recrutement était payée sur la page Primes et invisible
         ici : le bilan sous-évaluait donc ce que le domaine sort réellement.
         Elle rejoint la colonne PRIME, comme sur la page Primes. */
      const rec = e.exEmploye ? 0 : (recrues[clefNom(e.name)] || 0) * primeParRecrutement();
      /* Un ancien employé apporte sa production et rien d'autre : plus de
         salaire à lui verser, et pas de prime à lui calculer. */
      const prime = e.exEmploye ? 0
        : window.mvCalculPrime(e.runs, e.rank, palier, e.name) + exc + rec;
      return Object.assign({}, e, {
        prime: Math.round(prime),
        primeExc: exc,
        primeRec: rec,
        salairePlafonne: e.exEmploye ? 0
          : Math.round(Math.min(e.salaire || 0, patron ? palier.salDir : palier.salEmp)),
        isDir: patron,
      });
    });

    /* Primes accordées à quelqu'un qui n'est pas dans le tableau de bord.
       Les lignes « hors registre » ne comptent pas comme une présence : une
       prime exceptionnelle à ce nom-là doit rester au total, pas disparaître
       derrière une ligne qui, elle, ne porte aucune prime. */
    const nomsDetail = new Set(detail.filter(e => !e.exEmploye).map(e => e.name));
    const excHorsTableau = primesExc.filter(p => !nomsDetail.has(p.nom))
      .reduce((s, p) => s + p.montant, 0);

    /* Un recruteur peut ne pas figurer dans la tablette collée — la direction
       recrute sans forcément produire. Sa prime est due quand même : on ajoute
       ce que le détail n'a pas pu porter, plutôt que de la perdre. */
    const clefsDetail = new Set(detail.filter(e => !e.exEmploye).map(e => clefNom(e.name)));
    const recHorsTableau = Object.keys(recrues)
      .filter(k => !clefsDetail.has(k))
      .reduce((s, k) => s + recrues[k], 0) * primeParRecrutement();

    const salaires = detail.reduce((s, e) => s + e.salairePlafonne, 0);
    /* La prime de recrutement ne dépend pas de la production hebdomadaire :
       elle s'ajoute au total, sinon la masse salariale serait sous-évaluée. */
    const primes = detail.reduce((s, e) => s + e.prime, 0)
      + excHorsTableau + recHorsTableau + totalPrimeRecrutement();
    const depenses = salaires + autres;

    const beneficeImposable = caTotal - depenses;
    const impot = Math.round(Math.max(0, beneficeImposable) * palier.taux / 100);
    const beneficeApresImpot = beneficeImposable - impot;
    const beneficeApresPrimes = beneficeApresImpot - primes;
    const retraits = retraitsData.reduce((s, r) => s + (r.montant || 0), 0);
    const tresorerie = beneficeApresPrimes - retraits;

    return {
      detail, caTotal, salaires, autres, depenses, primes,
      beneficeImposable, impot, beneficeApresImpot, beneficeApresPrimes,
      retraits, tresorerie, palier, palierIndex: idx,
      auto: bilanConfig.palier === 'auto',
    };
  }

  /* Le palier retenu par le bilan — override manuel compris. La page Primes
     appelait la formule commune SANS palier : elle affichait donc des primes
     que le bilan écrêtait ensuite. Deux chiffres pour la même prime, sur deux
     pages voisines. */
  window.mvPalierCourant = function () {
    try { return bilanCompute().palier || null; } catch (e) { return null; }
  };

  function renderBilan() {
    if (typeof dash === 'undefined' || !$('bcDetailBody')) return;
    const b = bilanCompute();
    const fmt$ = n => Math.round(n).toLocaleString('fr-FR') + ' $';
    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };

    /* Bandeau du haut */
    set('bcTaux', b.palier.taux + '%');
    set('bcSalCap', `${b.palier.salEmp.toLocaleString('fr-FR')}$ / ${b.palier.salDir.toLocaleString('fr-FR')}$`);
    set('bcPrimeCap', `${b.palier.primeEmp.toLocaleString('fr-FR')}$ / ${b.palier.primeDir.toLocaleString('fr-FR')}$`);
    set('bcPlafondEmp', `${b.palier.salEmp.toLocaleString('fr-FR')}$ / ${b.palier.primeEmp.toLocaleString('fr-FR')}$`);
    set('bcPlafondDir', `${b.palier.salDir.toLocaleString('fr-FR')}$ / ${b.palier.primeDir.toLocaleString('fr-FR')}$`);
    set('palierActuel', b.palierIndex + 1);
    set('bcDetailCount', b.detail.length);
    set('bcEffectif', rhRosterData.filter(e => e.status === 'actif').length);

    renderPalierSelect(b);
    renderBilanCards(b);

    /* Palier en cours mis en évidence dans le barème */
    const bb = $('baremeBody');
    if (bb && typeof baremeData !== 'undefined') {
      bb.innerHTML = baremeData.map((p, i) => `
        <tr${i === b.palierIndex ? ' style="background:rgba(201,169,97,.14);"' : ''}>
          <td class="mono">${i + 1}</td>
          <td class="num">${p.min.toLocaleString('fr-FR')} $</td>
          <td class="num">${p.max.toLocaleString('fr-FR')} $</td>
          <td class="num"${i === b.palierIndex ? ' style="color:var(--or);font-weight:700;"' : ''}>${p.taux} %</td>
          <td class="num">${p.salEmp.toLocaleString('fr-FR')} $</td>
          <td class="num">${p.salDir.toLocaleString('fr-FR')} $</td>
          <td class="num">${p.primeEmp.toLocaleString('fr-FR')} $</td>
          <td class="num">${p.primeDir.toLocaleString('fr-FR')} $</td>
          <td>${i === b.palierIndex ? '<span class="status-chip status-paid">palier actuel</span>' : ''}</td>
        </tr>`).join('');
    }

    /* Détail par employé */
    $('bcDetailBody').innerHTML = b.detail.map(e => `
      <tr>
        <td>${esc(e.name)}${e.exEmploye
          ? ' <span class="mv-horsreg" title="Personne partie du domaine : sa production est d\u00e9clar\u00e9e, mais elle ne re\u00e7oit ni salaire ni prime.">hors registre</span>'
          : ''}</td>
        <td class="rank-pill">${esc(e.rank)}</td>
        <td class="num dim">${(e.runs || 0).toLocaleString('fr-FR')} $</td>
        <td class="num dim">${(e.factures || 0).toLocaleString('fr-FR')} $</td>
        <td class="num dim">${(e.ventes || 0).toLocaleString('fr-FR')} $</td>
        <td class="num" style="color:var(--prime);">${(e.ca || 0).toLocaleString('fr-FR')} $</td>
        <td class="num">${fmt$(e.salairePlafonne)}</td>
        <td class="num">${fmt$(e.prime)}</td>
        <td style="text-align:right;">${e.manuel
          ? `<button class="icon-btn danger" data-bc-del="${esc(e.name)}" title="Retirer cette ligne">×</button>`
          : ''}</td>
      </tr>`).join('');

    /* Dépenses déductibles : salaires, primes, puis chaque facture reçue */
    /* Les primes ne sont PAS déductibles : elles se retranchent après impôt.
       Le tableau ne contient donc que les salaires et les factures reçues. */
    depensesData.length = 0;
    depensesData.push({ date: '***********', label: 'Salaires', montant: b.salaires });
    facturesRecuesData.forEach(g => g.items.forEach(i => {
      depensesData.push({ date: i.date, label: `${g.supplier}${i.note && i.note !== '—' ? ' — ' + i.note : ''}`, montant: i.montant || 0 });
    }));

    const db = $('depensesBody');
    if (db) {
      db.innerHTML = depensesData.map(d => `
        <tr><td class="mono">${esc(d.date)}</td><td><b>${esc(d.label)}</b></td>
            <td class="num"><b>${fmt$(d.montant)}</b></td></tr>`).join('')
        + `<tr><td></td><td><b>Total</b></td>
             <td class="num" style="color:var(--prime);"><b>${fmt$(b.depenses)}</b></td></tr>`;
    }

    const rb = $('retraitsBody');
    if (rb) {
      rb.innerHTML = retraitsData.length
        ? retraitsData.map(r => `<tr><td class="mono">${esc(r.date)}</td><td>${esc(r.label)}</td>
            <td class="num">${fmt$(r.montant)}</td></tr>`).join('')
          + `<tr><td></td><td><b>Total</b></td><td class="num" style="color:var(--prime);"><b>${
              fmt$(retraitsData.reduce((s, r) => s + (r.montant || 0), 0))}</b></td></tr>`
        : `<tr><td colspan="3" class="empty-note" style="text-align:center;padding:18px;">Aucun retrait</td></tr>`;
    }

    renderBilanSynthese(b);
    renderPrimesExc();
  }

  /* Liste déroulante du palier : automatique, ou forcé sur l'un des 13. */
  function renderPalierSelect(b) {
    const sel = $('bcPalierMode');
    if (!sel || typeof baremeData === 'undefined') return;

    if (sel.options.length <= 1) {
      sel.innerHTML = '<option value="auto">palier détecté automatiquement</option>'
        + baremeData.map((p, i) => `<option value="${i}">palier ${i + 1} forcé — ${p.taux} %</option>`).join('');
      sel.addEventListener('change', () => {
        bilanConfig.palier = sel.value;
        D().save('bilanConfig', false);
        renderBilan();
        toast(sel.value === 'auto'
          ? 'Palier de nouveau détecté automatiquement.'
          : `Palier ${Number(sel.value) + 1} forcé manuellement.`);
      });
    }
    sel.value = bilanConfig.palier;

    const chip = sel.closest('.bilan-chip');
    if (chip) chip.classList.toggle('mv-forced', bilanConfig.palier !== 'auto');
  }

  /* Les huit cartes de la chaîne financière, du CA à la trésorerie. */
  function renderBilanCards(b) {
    const host = $('bcCards');
    if (!host) return;
    const f = n => Math.round(n || 0).toLocaleString('fr-FR') + ' $';
    const sign = n => n < 0 ? 'neg' : '';

    host.innerHTML = `<div class="mv-kpis mv-kpis-8">
      <div class="mv-kpi"><div class="mv-kpi-l">CA brut réalisé</div>
        <div class="mv-kpi-v accent">${f(b.caTotal)}</div>
        <div class="mv-kpi-s">runs + factures + ventes</div></div>
      <div class="mv-kpi"><div class="mv-kpi-l">Dépenses déductibles</div>
        <div class="mv-kpi-v">${f(b.depenses)}</div>
        <div class="mv-kpi-s">salaires ${f(b.salaires)} · autres ${f(b.autres)}</div></div>
      <div class="mv-kpi"><div class="mv-kpi-l">Bénéfice imposable</div>
        <div class="mv-kpi-v ${sign(b.beneficeImposable)}">${f(b.beneficeImposable)}</div>
        <div class="mv-kpi-s">CA − dépenses</div></div>
      <div class="mv-kpi"><div class="mv-kpi-l">Impôts (${b.palier.taux} %)</div>
        <div class="mv-kpi-v">${f(b.impot)}</div>
        <div class="mv-kpi-s">palier ${b.palierIndex + 1}${b.auto ? '' : ' — forcé'}</div></div>
      <div class="mv-kpi"><div class="mv-kpi-l">Bénéfice après impôt</div>
        <div class="mv-kpi-v ${sign(b.beneficeApresImpot)}">${f(b.beneficeApresImpot)}</div>
        <div class="mv-kpi-s">imposable − impôts</div></div>
      <div class="mv-kpi"><div class="mv-kpi-l">Total des primes</div>
        <div class="mv-kpi-v">${f(b.primes)}</div>
        <div class="mv-kpi-s">déduites après impôt</div></div>
      <div class="mv-kpi"><div class="mv-kpi-l">Bénéfice après primes</div>
        <div class="mv-kpi-v ${sign(b.beneficeApresPrimes)}">${f(b.beneficeApresPrimes)}</div>
        <div class="mv-kpi-s">après rémunération de l'équipe</div></div>
      <div class="mv-kpi"><div class="mv-kpi-l">Trésorerie nette finale</div>
        <div class="mv-kpi-v ${sign(b.tresorerie)}">${f(b.tresorerie)}</div>
        <div class="mv-kpi-s">après retraits (${f(b.retraits)})</div></div>
    </div>`;
  }

  /* Récapitulatif chiffré, inséré sous le détail par employé. */
  function renderBilanSynthese(b) {
    const host = $('bcDetailBody');
    if (!host) return;
    const panel = host.closest('.panel');
    if (!panel) return;

    let box = $('bcSynthese');
    if (!box) {
      box = document.createElement('div');
      box.id = 'bcSynthese';
      box.className = 'mv-synth';
      panel.appendChild(box);
    }
    const fmt$ = n => Math.round(n).toLocaleString('fr-FR') + ' $';
    box.innerHTML = `
      <div class="mv-synth-row"><span>Chiffre d'affaires total</span><b>${fmt$(b.caTotal)}</b></div>
      <div class="mv-synth-row"><span>Salaires</span><b class="neg">− ${fmt$(b.salaires)}</b></div>
      <div class="mv-synth-row"><span>Factures reçues</span><b class="neg">− ${fmt$(b.autres)}</b></div>
      <div class="mv-synth-row big"><span>Bénéfice imposable</span><b class="${b.beneficeImposable < 0 ? 'neg' : 'pos'}">${fmt$(b.beneficeImposable)}</b></div>
      <div class="mv-synth-row"><span>Impôt — palier ${b.palierIndex + 1} à ${b.palier.taux} %</span><b class="neg">− ${fmt$(b.impot)}</b></div>
      <div class="mv-synth-row"><span>Primes versées</span><b class="neg">− ${fmt$(b.primes)}</b></div>
      <div class="mv-synth-row"><span>Retraits</span><b class="neg">− ${fmt$(b.retraits)}</b></div>
      <div class="mv-synth-row big"><span>Trésorerie nette finale</span><b class="${b.tresorerie < 0 ? 'neg' : 'pos'}">${fmt$(b.tresorerie)}</b></div>`;
  }

  /* ========================================================================
     EXPORTS TABLEUR
     ------------------------------------------------------------------------
     Le tableur attend une formule vivante dans la colonne « CA TOTAL
     RÉALISÉ » : =SOMME(C8:E8) sur la première ligne collée, puis C9:E9…
     On produit donc du texte tabulé, une colonne par tabulation.
     ======================================================================== */
  async function copyDetailGDoc() {
    const b = bilanCompute();
    if (!b.detail.length) { toast('Aucune ligne à copier.'); return; }

    const r = await askForm('Copier pour le tableur', [
      { key: 'start', label: 'Première ligne vide du tableur', value: '8' },
      { key: 'entete', label: 'Inclure la ligne d\'en-tête', value: 'Non', options: ['Non', 'Oui'] },
    ], `${b.detail.length} employé(s). La colonne « CA TOTAL RÉALISÉ » recevra la formule =SOMME(C…:E…), recalculée par le tableur.`);
    if (!r) return;

    let line = Math.max(1, parseInt(r.start, 10) || 8);
    const out = [];
    if (r.entete === 'Oui') {
      out.push(['Nom du salarié', 'Grade', 'RUN', 'FACTURE', 'VENTE',
                'CA TOTAL RÉALISÉ', 'Salaire', 'Prime'].join('\t'));
    }
    b.detail.forEach(e => {
      out.push([
        e.name, e.rank, e.runs || 0, e.factures || 0, e.ventes || 0,
        `=SOMME(C${line}:E${line})`, e.salairePlafonne, e.prime,
      ].join('\t'));
      line++;
    });

    copyToClipboard(out.join('\n'), 'Détail par employé');
  }

  async function copyDepensesGDoc() {
    renderBilan();                       /* on part de valeurs à jour */
    if (!depensesData.length) { toast('Aucune dépense à copier.'); return; }

    const r = await askForm('Copier pour le tableur', [
      { key: 'entete', label: 'Inclure la ligne d\'en-tête', value: 'Non', options: ['Non', 'Oui'] },
      { key: 'total', label: 'Ajouter la ligne de total', value: 'Oui', options: ['Oui', 'Non'] },
    ], `${depensesData.length} ligne(s) de dépense déductible.`);
    if (!r) return;

    const out = [];
    if (r.entete === 'Oui') out.push(['Date', 'Justificatif', 'Montant'].join('\t'));
    depensesData.forEach(d => out.push([d.date, d.label, Math.round(d.montant)].join('\t')));
    if (r.total !== 'Non') {
      out.push(['', 'Total', depensesData.reduce((s, d) => s + Math.round(d.montant), 0)].join('\t'));
    }

    copyToClipboard(out.join('\n'), 'Dépenses déductibles');
  }

  /* ========================================================================
     HISTORIQUE DES SEMAINES CLÔTURÉES
     ======================================================================== */
  function renderWeekHistory() {
    const weeks = clotures.weeks || [];

    /* Vue d'ensemble — « Semaines précédentes » */
    /* Cible explicite : depuis que le Top 5 a lui aussi un état vide, un
       simple « .ov-empty » attrapait la mauvaise carte et rangeait
       l'historique des semaines dans le Top 5. */
    const ovEmpty = $('ov-hist-empty') || document.querySelector('#page-statsvue .ov-empty');
    const ovHost = ovEmpty ? ovEmpty.parentNode : null;
    if (ovHost) {
      let box = $('mvWeekHist');
      if (!box) {
        box = document.createElement('div');
        box.id = 'mvWeekHist';
        ovHost.appendChild(box);
      }
      ovEmpty.style.display = weeks.length ? 'none' : '';
      box.innerHTML = weeks.length ? `
        <table class="gtable">
          <thead><tr><th>Semaine</th><th>Période</th><th class="num">Éligibles</th>
            <th class="num">Production</th><th class="num">Heures</th><th>Clôturée le</th></tr></thead>
          <tbody>${weeks.map(w => {
            const prod = (w.production || []).reduce((s, p) => s + (p.barils || 0), 0);
            return `<tr>
              <td><b>${esc(w.label)}</b></td>
              <td class="mono">${esc(w.du)} → ${esc(w.au)}</td>
              <td class="num">${w.eligibles.length}</td>
              <td class="num">${prod.toLocaleString('fr-FR')}</td>
              <td class="num">${Math.floor((w.heures || 0) / 60)}h${pad((w.heures || 0) % 60)}</td>
              <td class="mono">${esc(w.closedAt)}</td>
            </tr>`; }).join('')}</tbody>
        </table>` : '';
    }

    /* Ma semaine — historique personnel du membre connecté */
    const perso = document.querySelector('#page-masemaine .panel .empty-note');
    if (perso) {
      const me = (window.MarloweSession && window.MarloweSession.name) || '';
      const mine = weeks
        .map(w => ({ w, p: (w.production || []).find(x => x.name === me) }))
        .filter(x => x.p);

      let box = $('mvPersoHist');
      if (!box) {
        box = document.createElement('div');
        box.id = 'mvPersoHist';
        perso.parentNode.appendChild(box);
      }
      perso.style.display = mine.length ? 'none' : '';
      box.innerHTML = mine.length ? `
        <table class="gtable">
          <thead><tr><th>Semaine</th><th>Grade</th><th class="num">Production</th>
            <th class="num">Quota</th><th>Résultat</th></tr></thead>
          <tbody>${mine.map(({ w, p }) => `
            <tr>
              <td><b>${esc(w.label)}</b><br><span class="mono" style="font-size:11px;color:var(--muted);">${esc(w.du)} → ${esc(w.au)}</span></td>
              <td><span class="grade-pill ${typeof gradePillClass === 'function' ? gradePillClass(p.grade) : ''}">${esc(p.grade)}</span></td>
              <td class="num">${(p.barils || 0).toLocaleString('fr-FR')}</td>
              <td class="num dim">${(p.quota || 0).toLocaleString('fr-FR')}</td>
              <td>${p.barils >= p.quota
                ? '<span class="status-chip status-paid">Quota atteint</span>'
                : '<span class="status-chip status-pending">Quota manqué</span>'}</td>
            </tr>`).join('')}</tbody>
        </table>` : '';
    }
  }

  /* ========================================================================
     GRAPHIQUES — SVG écrit à la main, sans bibliothèque
     ------------------------------------------------------------------------
     Palette vérifiée sur le fond sombre du panel (#262320) :
     l'or et l'ambre passent le contraste 3:1. Chaque graphique ne porte
     qu'une seule série, donc pas de légende — le titre nomme la donnée.

     Les flèches de tendance ▲▼ portent l'information par leur forme :
     vert et rouge sont indiscernables en deutéranopie, la couleur seule
     ne dirait rien à une partie des lecteurs.
     ======================================================================== */
  const CHART = {
    or:     '#E0BE72',   /* production */
    ambre:  '#E08A50',   /* primes */
    grille: 'rgba(255,255,255,.07)',
    axe:    'rgba(255,255,255,.30)',
    encre:  '#9C9384',
  };

  const niceMax = v => {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    return Math.ceil(v / (p / 2)) * (p / 2);
  };

  const shortNum = n => {
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',') + ' M';
    if (a >= 1e3) return Math.round(n / 1e3) + ' k';
    return String(Math.round(n));
  };

  /* Histogramme — une barre par semaine, extrémité arrondie côté valeur. */
  function barChart(data, color, unit) {
    const W = 720, H = 260, L = 54, R = 12, T = 14, B = 30;
    const max = niceMax(Math.max(...data.map(d => d.v), 0));
    const iw = W - L - R, ih = H - T - B;
    const step = iw / Math.max(1, data.length);
    const bw = Math.min(46, step * 0.6);
    const ticks = [0, .25, .5, .75, 1].map(f => Math.round(max * f));

    return `<svg viewBox="0 0 ${W} ${H}" class="mv-chart" role="img"
      aria-label="Production par semaine">
      ${ticks.map(t => {
        const y = T + ih - (t / max) * ih;
        return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${CHART.grille}" stroke-width="1"/>
                <text x="${L - 8}" y="${y + 4}" text-anchor="end" fill="${CHART.encre}" font-size="10">${shortNum(t)}</text>`;
      }).join('')}
      ${data.map((d, i) => {
        const h = max ? (d.v / max) * ih : 0;
        const x = L + step * i + (step - bw) / 2;
        const y = T + ih - h;
        return `<g class="mv-bar"><title>${esc(d.k)} — ${d.v.toLocaleString('fr-FR')} ${esc(unit)}</title>
          <rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h, 1)}"
                rx="4" ry="4" fill="${color}"/>
          <rect x="${x}" y="${Math.min(y + 6, T + ih)}" width="${bw}" height="${Math.max(h - 6, 0)}" fill="${color}"/>
        </g>`;
      }).join('')}
      <line x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}" stroke="${CHART.axe}" stroke-width="1"/>
      ${data.map((d, i) => `<text x="${L + step * i + step / 2}" y="${H - 10}" text-anchor="middle"
        fill="${CHART.encre}" font-size="10.5">${esc(d.k)}</text>`).join('')}
    </svg>`;
  }

  /* Courbe avec aire — évolution des primes versées. */
  function areaChart(data, color, unit) {
    const W = 720, H = 260, L = 62, R = 12, T = 14, B = 30;
    const max = niceMax(Math.max(...data.map(d => d.v), 0));
    const iw = W - L - R, ih = H - T - B;
    const x = i => L + (data.length === 1 ? iw / 2 : (iw * i) / (data.length - 1));
    const y = v => T + ih - (max ? (v / max) * ih : 0);
    const pts = data.map((d, i) => [x(i), y(d.v)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = `${line} L ${pts[pts.length - 1][0].toFixed(1)} ${T + ih} L ${pts[0][0].toFixed(1)} ${T + ih} Z`;
    const ticks = [0, .25, .5, .75, 1].map(f => Math.round(max * f));

    return `<svg viewBox="0 0 ${W} ${H}" class="mv-chart" role="img" aria-label="Primes versées par semaine">
      <defs><linearGradient id="mvFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".34"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      ${ticks.map(t => {
        const yy = y(t);
        return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${CHART.grille}" stroke-width="1"/>
                <text x="${L - 8}" y="${yy + 4}" text-anchor="end" fill="${CHART.encre}" font-size="10">${shortNum(t)}</text>`;
      }).join('')}
      <path d="${area}" fill="url(#mvFade)"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.map((p, i) => `<g class="mv-dot"><title>${esc(data[i].k)} — ${data[i].v.toLocaleString('fr-FR')} ${esc(unit)}</title>
        <circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4.5" fill="${color}"
                stroke="#262320" stroke-width="2"/></g>`).join('')}
      <line x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}" stroke="${CHART.axe}" stroke-width="1"/>
      ${data.map((d, i) => `<text x="${x(i)}" y="${H - 10}" text-anchor="middle"
        fill="${CHART.encre}" font-size="10.5">${esc(d.k)}</text>`).join('')}
    </svg>`;
  }

  /* ========================================================================
     PAGE HISTORIQUE
     ======================================================================== */

  /* Flèche de tendance. `bonSiMonte` dit dans quel sens va le progrès :
     un pourcentage d'inactifs qui grimpe est une mauvaise nouvelle. */
  function trend(cur, prev, bonSiMonte) {
    if (prev == null || cur === prev) return '<span class="mv-tr eq" title="stable">=</span>';
    const monte = cur > prev;
    const bon = bonSiMonte ? monte : !monte;
    return `<span class="mv-tr ${bon ? 'up' : 'down'}" title="${
      monte ? 'en hausse' : 'en baisse'} par rapport à la semaine précédente">${monte ? '▲' : '▼'}</span>`;
  }

  function renderHistorique() {
    const host = $('histoBody');
    if (!host) return;
    const weeks = (clotures.weeks || []).slice();          /* plus récente en tête */
    const sub = $('histoSub');

    if (!weeks.length) {
      if (sub) sub.textContent = "Aucune semaine clôturée pour l'instant — l'historique se construit à chaque clôture du lundi.";
      host.innerHTML = `<div class="panel"><p class="empty-note" style="padding:26px 0;text-align:center;">
        Clôturez une semaine depuis <b>Primes</b> pour voir apparaître ici le récapitulatif complet :
        production, chiffre d'affaires, primes versées, effectif et tendances.</p></div>`;
      return;
    }

    const chrono = weeks.slice().reverse();                /* plus ancienne en tête */
    const prod = w => (w.production || []).reduce((s, p) => s + (p.barils || 0), 0);
    const fmt$ = n => Math.round(n || 0).toLocaleString('fr-FR') + ' $';

    /* --- Records --- */
    const best = chrono.reduce((a, w) => prod(w) > prod(a) ? w : a, chrono[0]);
    const cumul = chrono.reduce((s, w) => s + prod(w), 0);
    const moyenne = Math.round(cumul / chrono.length);

    const victoires = {};
    chrono.forEach(w => { if (w.vainqueur) victoires[w.vainqueur] = (victoires[w.vainqueur] || 0) + 1; });
    const record = Object.entries(victoires).sort((a, b) => b[1] - a[1])[0];

    if (sub) sub.textContent = `${weeks.length} semaine(s) clôturée(s) · records du domaine`;

    /* --- Séries --- */
    const serieProd = chrono.map(w => ({ k: w.label.replace(/^Semaine\s*/i, 'S'), v: prod(w) }));
    const seriePrimes = chrono.map(w => ({ k: w.label.replace(/^Semaine\s*/i, 'S'), v: Math.round(w.primes || 0) }));

    host.innerHTML = `
      <div class="mv-kpis">
        <div class="mv-kpi"><div class="mv-kpi-l">🏆 Meilleure semaine</div>
          <div class="mv-kpi-v">${prod(best).toLocaleString('fr-FR')}</div>
          <div class="mv-kpi-s">vins · ${esc(best.label)}</div></div>
        <div class="mv-kpi"><div class="mv-kpi-l">Moyenne par semaine</div>
          <div class="mv-kpi-v">${moyenne.toLocaleString('fr-FR')}</div>
          <div class="mv-kpi-s">vins</div></div>
        <div class="mv-kpi"><div class="mv-kpi-l">Production cumulée</div>
          <div class="mv-kpi-v accent">${cumul.toLocaleString('fr-FR')}</div>
          <div class="mv-kpi-s">depuis la première clôture</div></div>
        <div class="mv-kpi"><div class="mv-kpi-l">👑 Recordman</div>
          <div class="mv-kpi-v small">${record ? esc(record[0]) : '—'}</div>
          <div class="mv-kpi-s">${record ? record[1] + ' victoire(s) hebdo' : 'aucune victoire enregistrée'}</div></div>
      </div>

      <div class="grid2">
        <div class="panel"><h3>Production par semaine <span class="mv-unit">vins</span></h3>
          ${barChart(serieProd, CHART.or, 'vins')}</div>
        <div class="panel"><h3>Primes versées par semaine <span class="mv-unit">$</span></h3>
          ${areaChart(seriePrimes, CHART.ambre, '$')}</div>
      </div>

      <div class="panel">
        <h3>Statistiques par semaine — tendances</h3>
        <div class="table-wrap"><table class="gtable">
          <thead><tr><th>Semaine</th><th class="num">Recrutements</th><th class="num">CA</th>
            <th class="num">Ventes</th><th class="num">Production</th>
            <th class="num">% sans production</th><th class="num">Effectif</th></tr></thead>
          <tbody>${chrono.map((w, i) => {
            const p = i > 0 ? chrono[i - 1] : null;
            const cell = (v, prev, bonSiMonte, txt) =>
              `<td class="num">${txt}${p ? ' ' + trend(v, prev, bonSiMonte) : ''}</td>`;
            return `<tr>
              <td><b>${esc(w.label)}</b></td>
              ${cell(w.recrutements || 0, p && (p.recrutements || 0), true, (w.recrutements || 0))}
              ${cell(w.ca || 0, p && (p.ca || 0), true, fmt$(w.ca))}
              ${cell(w.ventes || 0, p && (p.ventes || 0), true, (w.ventes || 0).toLocaleString('fr-FR'))}
              ${cell(prod(w), p && prod(p), true, prod(w).toLocaleString('fr-FR'))}
              ${cell(w.sansProduction || 0, p && (p.sansProduction || 0), false, (w.sansProduction || 0) + ' %')}
              ${cell(w.effectif || 0, p && (p.effectif || 0), true, (w.effectif || 0))}
            </tr>`; }).join('')}</tbody>
        </table></div>
        <p class="empty-note" style="margin-top:12px;">
          ▲▼ = évolution par rapport à la semaine précédente · <b class="mv-tr up">vert</b> = favorable,
          <b class="mv-tr down">rouge</b> = défavorable. Un pourcentage d'inactifs qui monte, ou un effectif
          qui baisse, sont comptés comme défavorables.</p>
      </div>

      <div class="panel">
        <div class="toolbar" style="margin-bottom:14px;">
          <h3 style="margin:0;flex:1;">Détail des semaines</h3>
          <button class="btn" id="histoCopyBtn">📋 Copier pour GDoc</button>
        </div>
        <div class="table-wrap"><table class="gtable">
          <thead><tr><th>Semaine</th><th>Période</th><th>Clôturée le</th>
            <th class="num">Production</th><th class="num">CA</th><th class="num">Primes</th>
            <th class="num">Éligibles</th><th class="num">Heures</th><th>🏆 Vainqueur</th><th></th></tr></thead>
          <tbody>${weeks.map(w => `
            <tr>
              <td><b>${esc(w.label)}</b></td>
              <td class="mono">${esc(w.du)} → ${esc(w.au)}</td>
              <td class="mono">${esc(w.closedAt)}</td>
              <td class="num">${prod(w).toLocaleString('fr-FR')}</td>
              <td class="num">${fmt$(w.ca)}</td>
              <td class="num" style="color:var(--prime);">${fmt$(w.primes)}</td>
              <td class="num">${w.eligibles.length}</td>
              <td class="num">${Math.floor((w.heures || 0) / 60)}h${pad((w.heures || 0) % 60)}</td>
              <td>${esc(w.vainqueur || '—')}</td>
              <td style="text-align:right;"><button class="icon-btn danger" data-histo-del="${esc(w.id)}"
                  title="Supprimer cette semaine de l'historique">×</button></td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>`;

    const cp = $('histoCopyBtn');
    if (cp) cp.addEventListener('click', copyHistoGDoc);
  }

  async function copyHistoGDoc() {
    const weeks = (clotures.weeks || []).slice().reverse();
    if (!weeks.length) { toast('Aucune semaine à copier.'); return; }
    const r = await askForm('Copier pour le tableur', [
      { key: 'entete', label: 'Inclure la ligne d\'en-tête', value: 'Oui', options: ['Oui', 'Non'] },
    ], `${weeks.length} semaine(s) clôturée(s).`);
    if (!r) return;

    const prod = w => (w.production || []).reduce((s, p) => s + (p.barils || 0), 0);
    const out = [];
    if (r.entete === 'Oui') {
      out.push(['Semaine', 'Du', 'Au', 'Clôturée le', 'Production', 'CA', 'Primes',
                'Éligibles', 'Recrutements', 'Ventes', '% sans production', 'Effectif', 'Vainqueur'].join('\t'));
    }
    weeks.forEach(w => out.push([
      w.label, w.du, w.au, w.closedAt, prod(w), Math.round(w.ca || 0), Math.round(w.primes || 0),
      w.eligibles.length, w.recrutements || 0, w.ventes || 0, w.sansProduction || 0,
      w.effectif || 0, w.vainqueur || '',
    ].join('\t')));

    copyToClipboard(out.join('\n'), 'Historique des semaines');
  }

  async function deleteHistoWeek(id) {
    const i = clotures.weeks.findIndex(w => w.id === id);
    if (i < 0) return;
    const w = clotures.weeks[i];
    if (!await confirmAction('Supprimer de l\'historique',
      `${w.label} (${w.du} → ${w.au}) sera définitivement retirée. Cela n'annule pas la clôture, cela efface seulement son archive.`, 'Supprimer')) return;
    clotures.weeks.splice(i, 1);
    if (clotures.undo && clotures.undo.weekId === id) clotures.undo = null;
    D().save('clotures', false);
    renderHistorique();
    renderWeekHistory();
    refreshWeekHeaders();
    toast('Semaine retirée de l\'historique.');
  }

  /* ========================================================================
     PRIMES EXCEPTIONNELLES
     ------------------------------------------------------------------------
     Une gratification ponctuelle, hors barème et hors plafond : elle
     s'ajoute au total des primes de la semaine en cours et se retrouve
     dans l'archive à la clôture.
     ======================================================================== */
  const primesExc = [];

  async function addPrimeExceptionnelle() {
    const noms = [...new Set([
      ...dash.map(d => d.name),
      ...rhRosterData.map(e => e.name),
    ])].sort(parNom);

    const r = await askForm('Prime exceptionnelle', [
      { key: 'nom', label: 'Bénéficiaire', value: noms[0] || '', options: noms.length ? noms : undefined },
      { key: 'montant', label: 'Montant ($)', value: '10000' },
      { key: 'motif', label: 'Motif', value: '' },
    ], 'Hors barème et hors plafond. Elle s\'ajoute au total des primes de la semaine et sera archivée à la clôture.');
    if (!r) return;

    const montant = parseInt(String(r.montant).replace(/[^\d-]/g, ''), 10) || 0;
    if (!r.nom) { toast('Choisissez un bénéficiaire.'); return; }
    if (montant <= 0) { toast('Indiquez un montant supérieur à zéro.'); return; }

    primesExc.push({ nom: r.nom, montant, motif: r.motif || '—', date: todayFR() });
    D().note(`a accordé une prime exceptionnelle de ${montant.toLocaleString('fr-FR')} $ à ${r.nom} (${r.motif || 'sans motif'})`);
    D().save('primesExc', false);
    renderPrimesExc();
    renderBilan();
    toast(`Prime exceptionnelle de ${montant.toLocaleString('fr-FR')} $ pour ${r.nom}.`);
  }

  async function removePrimeExc(i) {
    const p = primesExc[Number(i)];
    if (!p) return;
    if (!await confirmAction('Retirer la prime exceptionnelle',
      `${p.nom} — ${p.montant.toLocaleString('fr-FR')} $.`, 'Retirer')) return;
    primesExc.splice(Number(i), 1);
    D().save('primesExc', false);
    renderPrimesExc();
    renderBilan();
    toast('Prime retirée.');
  }

  /* Encart listant les primes exceptionnelles, inséré sur la page Primes. */
  function renderPrimesExc() {
    const head = document.querySelector('#page-statsprimes .primes-head');
    if (!head) return;

    let box = $('mvPrimesExc');
    if (!box) {
      box = document.createElement('div');
      box.id = 'mvPrimesExc';
      box.className = 'panel';
      box.style.marginTop = '18px';
      head.parentNode.insertBefore(box, head.nextSibling);
    }

    const total = primesExc.reduce((s, p) => s + p.montant, 0);
    box.style.display = primesExc.length ? '' : 'none';
    if (!primesExc.length) return;

    box.innerHTML = `
      <h3>Primes exceptionnelles <span class="mv-unit">${primesExc.length} · ${total.toLocaleString('fr-FR')} $</span></h3>
      <table class="gtable">
        <thead><tr><th>Date</th><th>Bénéficiaire</th><th>Motif</th><th class="num">Montant</th><th></th></tr></thead>
        <tbody>${primesExc.map((p, i) => `
          <tr>
            <td class="mono">${esc(p.date)}</td>
            <td><b>${esc(p.nom)}</b></td>
            <td>${esc(p.motif)}</td>
            <td class="num" style="color:var(--prime);">${p.montant.toLocaleString('fr-FR')} $</td>
            <td style="text-align:right;"><button class="icon-btn danger" data-primeexc-del="${i}"
                title="Retirer">×</button></td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  /* ========================================================================
     EFFECTIF — recherche, filtre par grade, compteur
     ======================================================================== */
  const effFiltre = { q: '', grade: 'all' };

  window.mvEffectifFiltre = function () {
    const q = effFiltre.q.toLowerCase();
    return effectifData.filter(e =>
      (effFiltre.grade === 'all' || e.grade === effFiltre.grade) &&
      (!q || (e.name + ' ' + e.grade).toLowerCase().includes(q)));
  };

  function renderEffectifHead() {
    const liste = window.mvEffectifFiltre();
    const actifs = effectifData.filter(e => e.active).length;
    const sansProd = effectifData.filter(e => e.active && !e.barils).length;
    const promos = effectifData.filter(e => e.active && !e.isFinal && e.barils > e.promoTarget).length;

    const n = $('effCount');
    if (n) n.textContent = liste.length;

    const l = $('effCountLabel');
    if (l) l.textContent = (effFiltre.q || effFiltre.grade !== 'all')
      ? `fiche(s) affichée(s) sur ${effectifData.length}`
      : 'Fiches actives';

    /* Ligne de contexte sous le titre, comme sur la page Employés. */
    const head = document.querySelector('#page-statseffectif .pagehead');
    if (head) {
      let s = $('effSummary');
      if (!s) {
        s = document.createElement('p');
        s.id = 'effSummary';
        s.className = 'page-sub';
        s.style.margin = '6px 0 0';
        head.querySelector('div').appendChild(s);
      }
      s.innerHTML = `${actifs} dans le circuit quotas · <b>${sansProd}</b> sans production cette semaine · `
        + `<b>${promos}</b> montée(s) de grade disponible(s)`;
    }
  }

  function refreshEffectifFilters() {
    const sel = $('effGradeFilter');
    if (sel) {
      const grades = [...new Set(effectifData.map(e => e.grade))].sort();
      const cur = sel.value || 'all';
      sel.innerHTML = '<option value="all">Tous les grades</option>'
        + grades.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
      sel.value = grades.includes(cur) ? cur : 'all';
    }
    renderEffectifHead();
  }

  function applyEffectifFilter() {
    if (typeof renderEffectif === 'function') renderEffectif(window.mvEffectifFiltre());
    renderEffectifHead();
  }

  /* ========================================================================
     CLÔTURE DU LUNDI — la marche à suivre, dans l'ordre
     ------------------------------------------------------------------------
     Clôturer touche à tout : production, primes, éligibilité, historique.
     L'oubli le plus coûteux est de figer la semaine avant d'avoir mis à jour
     la production. Ces étapes existent pour rendre cet oubli difficile.
     ======================================================================== */
  const clotureSteps = { done: [] };

  const ETAPES = [
    { id: 'prod', titre: 'Mettre à jour la production',
      texte: 'Colle la tablette de la semaine dans le Tableau de bord (bouton « 📋 Coller la tablette »). '
           + 'Les quotas, l\'éligibilité et le bilan se recalculent dans la foulée.',
      page: 'statsdash', bouton: 'Ouvrir le tableau de bord' },

    { id: 'rh', titre: 'Vérifier l\'effectif et les absences',
      texte: 'Employés : déclare les départs de la semaine et retire les absences de ceux qui sont revenus. '
           + 'Recrutement : enregistre les arrivées — le cumul des recruteurs se recalcule tout seul.',
      page: 'rhemployes', bouton: 'Ouvrir les employés' },

    { id: 'promo', titre: 'Annoncer les promotions et les alertes',
      texte: 'Effectif : ▲ signale une promotion méritée, ▼ un employé sous quota. '
           + 'Annonce-les en jeu ou sur Discord AVANT de figer la semaine — après, les compteurs sont à zéro.',
      page: 'statseffectif', bouton: 'Ouvrir l\'effectif' },

    { id: 'bilan', titre: 'Contrôler le bilan et le palier',
      texte: 'Bilan comptable : vérifie le CA, les dépenses déductibles et le palier d\'imposition retenu. '
           + 'Tu peux le forcer si la détection automatique ne correspond pas.',
      page: 'bilan', bouton: 'Ouvrir le bilan' },

    { id: 'close', titre: 'Clôturer la semaine',
      texte: 'Fige les primes, archive tout dans l\'Historique, bascule l\'éligibilité sur la semaine écoulée, '
           + 'puis remet à zéro les productions, les prises de service et les primes exceptionnelles.',
      action: 'closeWeek', bouton: 'Clôturer la semaine', primary: true },

    { id: 'gdoc', titre: 'Copier les GDoc et vérifier',
      texte: 'Bilan → « Copier pour GDoc » pour le détail par employé, puis le second bouton pour les dépenses. '
           + 'Contrôle que les totaux du tableur correspondent à ceux du site.',
      page: 'bilan', bouton: 'Ouvrir le bilan' },

    { id: 'distrib', titre: 'Distribuer les récompenses',
      texte: 'Éligibilité : la liste porte désormais la semaine écoulée. '
           + 'Marque chaque récompense distribuée au fur et à mesure — tu peux revenir en arrière.',
      page: 'eligibilite', bouton: 'Ouvrir l\'éligibilité' },
  ];

  function gotoPage(id) {
    const item = document.querySelector(`.sidebar .nav-item[data-page="${id}"]:not(.mv-hidden)`);
    if (!item) { toast("Cette page ne vous est pas accessible."); return; }
    item.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderCloture() {
    const host = $('clotureBody');
    if (!host) return;

    const { start, end } = closingPeriod();
    const sub = $('clotureSub');
    if (sub) {
      sub.textContent = `Semaine du ${frDate(start)} au ${frDate(end)} · suis les étapes dans l'ordre, coche au fur et à mesure.`;
    }

    const done = new Set(clotureSteps.done || []);
    const courante = ETAPES.findIndex(e => !done.has(e.id));
    const w = lastClosedWeek();
    const peutAnnuler = !!(w && clotures.undo && clotures.undo.weekId === w.id);

    host.innerHTML = `
      <div class="panel mv-steps">
        ${ETAPES.map((e, i) => {
          const fait = done.has(e.id);
          const active = i === courante;
          return `
          <div class="mv-step${fait ? ' done' : ''}${active ? ' active' : ''}">
            <div class="mv-step-n">${fait ? '✓' : i + 1}</div>
            <div class="mv-step-body">
              <div class="mv-step-t">${esc(e.titre)}</div>
              <div class="mv-step-d">${esc(e.texte)}</div>
              <div class="btn-row mv-step-actions">
                <button class="btn${e.primary ? ' primary' : ''}"
                  ${e.action ? 'data-step-action="' + e.action + '"' : 'data-step-go="' + e.page + '"'}
                  >${esc(e.bouton)}</button>
                <button class="btn mv-step-check" data-step-toggle="${e.id}">${
                  fait ? '↺ Décocher' : '✓ Étape faite'}</button>
              </div>
            </div>
          </div>`;
        }).join('')}
        ${courante < 0 ? `<div class="mv-step-all">
          Toutes les étapes sont cochées. <button class="btn" data-step-reset>Repartir de zéro</button>
        </div>` : ''}
      </div>

      <div class="panel mv-undo${peutAnnuler ? '' : ' off'}">
        <h3>↩ Oubli ou erreur ?</h3>
        <p>${w
          ? `Dernière clôture : <b>${esc(w.label)}</b> — ${esc(w.du)} → ${esc(w.au)}, clôturée le ${esc(w.closedAt)}.`
            + (peutAnnuler
              ? ' Productions, heures de service et primes exceptionnelles peuvent être restaurées à l\'identique.'
              : ' Cette clôture n\'est plus annulable — la sauvegarde de restauration a été remplacée.')
          : 'Aucune semaine clôturée pour le moment.'}</p>
        <button class="btn" id="clotureUndoBtn"${peutAnnuler ? '' : ' disabled'}>↩ Annuler la dernière clôture</button>
      </div>`;

    const u = $('clotureUndoBtn');
    if (u && peutAnnuler) u.addEventListener('click', undoClose);
  }

  function toggleStep(id) {
    const done = new Set(clotureSteps.done || []);
    if (done.has(id)) done.delete(id); else done.add(id);
    clotureSteps.done = [...done];
    D().save('clotureSteps', false);
    renderCloture();
  }

  function resetSteps() {
    clotureSteps.done = [];
    D().save('clotureSteps', false);
    renderCloture();
  }

  /* ========================================================================
     BANDEAU DE MISE À JOUR
     ------------------------------------------------------------------------
     Sur un outil partagé, quelqu'un peut travailler des jours sur une
     version mise en cache par son navigateur. On relit version.json de
     temps en temps ; si le numéro a changé depuis le chargement de la
     page, on propose de recharger. Jamais de rechargement imposé —
     une saisie en cours serait perdue.
     ======================================================================== */
  const VERSION_MS = 5 * 60 * 1000;
  let versionChargee = null;

  async function lireVersion() {
    try {
      /* Paramètre anti-cache : sans lui, le navigateur renverrait
         éternellement la version qu'il a en mémoire. */
      const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  async function verifierVersion() {
    const v = await lireVersion();
    if (!v || !v.v) return;
    if (versionChargee === null) { versionChargee = v.v; return; }
    if (v.v !== versionChargee) afficherBandeauVersion(v);
  }

  function afficherBandeauVersion(v) {
    if ($('mvUpdate')) return;
    const bar = document.createElement('div');
    bar.id = 'mvUpdate';
    bar.className = 'mv-update';
    bar.innerHTML = `
      <span>Une nouvelle version du panel est disponible${v.note ? ' — ' + esc(v.note) : ''}.</span>
      <button class="btn primary" id="mvUpdateGo">Recharger</button>
      <button class="mv-update-x" id="mvUpdateX" title="Plus tard">×</button>`;
    document.body.appendChild(bar);
    $('mvUpdateGo').addEventListener('click', () => location.reload());
    $('mvUpdateX').addEventListener('click', () => bar.remove());
  }

  /* ========================================================================
     PRÉSENCE — qui d'autre travaille en ce moment
     ======================================================================== */
  /* Deux minutes entre deux battements : le serveur n'inscrit la fiche que
     lorsqu'elle a changé ou qu'elle vieillit, mais chaque appel reste une
     lecture de la base. Inutile de la solliciter toutes les 45 secondes. */
  const PRESENCE_MS = 120000;
  let presenceTimer = null;

  function pageCourante() {
    const a = document.querySelector('.page-content.active');
    return a ? a.id.replace(/^page-/, '') : '';
  }

  async function battementPresence() {
    const cfg = (window.MarloweAuth && window.MarloweAuth.CONFIG) || {};
    if (cfg.MODE !== 'discord') return;
    let tok = null;
    try { tok = JSON.parse(localStorage.getItem('mv.token') || 'null'); } catch (e) {}
    if (!tok) return;

    try {
      const res = await fetch(cfg.API_BASE + '/api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ page: pageCourante() }),
      });
      if (!res.ok) return;
      renderPresence(await res.json());
    } catch (e) { /* réseau capricieux : on retentera au prochain battement */ }
  }

  const LABEL_PAGE = {};
  function labelPage(id) {
    if (!Object.keys(LABEL_PAGE).length) {
      /* Deux entrées peuvent viser la même page (Facturation et Clients) :
         on garde la première, qui est l'intitulé principal. */
      document.querySelectorAll('.sidebar .nav-item[data-page]').forEach(n => {
        if (!LABEL_PAGE[n.dataset.page]) LABEL_PAGE[n.dataset.page] = n.textContent.trim();
      });
    }
    return LABEL_PAGE[id] || '';
  }

  /* Le volet de présence vit à droite de l'écran plutôt que dans la barre
     latérale : on veut savoir qui travaille en même temps que soi sans avoir
     à descendre le menu, et la place manquait à gauche. Il se replie en
     languette, et le choix est retenu d'une session à l'autre. */
  function boitePresence() {
    let box = $('mvOnline');
    if (box) return box;

    box = document.createElement('aside');
    box.id = 'mvOnline';
    box.className = 'mv-online';
    let plie = false;
    try { plie = localStorage.getItem('mv.online.plie') === '1'; } catch (e) {}
    if (plie) box.classList.add('plie');

    document.body.appendChild(box);
    box.addEventListener('click', e => {
      if (!e.target.closest('[data-online-toggle]')) return;
      box.classList.toggle('plie');
      try { localStorage.setItem('mv.online.plie', box.classList.contains('plie') ? '1' : '0'); } catch (err) {}
    });
    return box;
  }

  function ligneEnLigne(m, moi) {
    const p = labelPage(m.page);
    const ini = String(m.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    return `<div class="mv-on-row${moi ? ' moi' : ''}" title="${esc(m.name)}${p ? ' — ' + esc(p) : ''}">
        <span class="mv-on-av">${m.avatar ? `<img src="${esc(m.avatar)}" alt="">` : esc(ini)}</span>
        <span class="mv-on-txt">
          <span class="mv-on-n">${esc(m.name)}${moi ? ' <i>vous</i>' : ''}</span>
          <span class="mv-on-p">${p ? esc(p) : 'en ligne'}</span>
        </span>
      </div>`;
  }

  function renderPresence(data) {
    /* L'ancien encart de la barre latérale faisait doublon. */
    const vieux = $('mvPresence');
    if (vieux) vieux.remove();

    const box = boitePresence();
    const tous = data.membres || [];
    const moi = tous.filter(m => m.id === data.moi);
    const autres = tous.filter(m => m.id !== data.moi);

    box.innerHTML = `
      <button class="mv-on-head" data-online-toggle type="button">
        <span class="mv-on-dot${autres.length ? '' : ' solo'}"></span>
        <span class="mv-on-title">En ligne</span>
        <span class="mv-on-cpt">${tous.length}</span>
        <span class="mv-on-chev">›</span>
      </button>
      <div class="mv-on-list">
        ${moi.map(m => ligneEnLigne(m, true)).join('')}
        ${autres.map(m => ligneEnLigne(m, false)).join('')}
        ${autres.length ? '' : `<p class="mv-on-vide">Personne d'autre sur le panel pour l'instant.</p>`}
      </div>`;
  }

  function startPresence() {
    const cfg = (window.MarloweAuth && window.MarloweAuth.CONFIG) || {};
    if (cfg.MODE !== 'discord' || presenceTimer) return;
    battementPresence();
    presenceTimer = setInterval(battementPresence, PRESENCE_MS);
    /* Un changement de page se signale tout de suite. */
    document.addEventListener('click', e => {
      if (e.target.closest('.sidebar .nav-item')) setTimeout(battementPresence, 300);
    });
  }

  /* ========================================================================
     AFFICHAGE — plein écran et zoom
     ------------------------------------------------------------------------
     Les tableaux du panel sont larges. Le plein écran récupère la hauteur
     de la barre du navigateur, le zoom permet de faire entrer une colonne
     de plus. Le niveau choisi est retenu d'une visite à l'autre.
     ======================================================================== */
  const ZOOMS = [80, 90, 100, 110, 125];
  let zoomIdx = 2;

  function appliquerZoom() {
    const z = ZOOMS[zoomIdx];
    document.documentElement.style.setProperty('--mv-zoom', z + '%');
    document.querySelector('.app-shell').style.zoom = z + '%';
    const l = $('mvZoomLabel');
    if (l) l.textContent = z + ' %';
    try { localStorage.setItem('mv.zoom', String(zoomIdx)); } catch (e) {}
  }

  function setZoom(delta) {
    zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, zoomIdx + delta));
    appliquerZoom();
  }

  function toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement) {
      (d.documentElement.requestFullscreen || (() => {})).call(d.documentElement)
        .catch(() => toast("Le navigateur a refusé le plein écran."));
    } else {
      (d.exitFullscreen || (() => {})).call(d);
    }
  }

  function buildAffichageBar() {
    if ($('mvViewBar')) return;
    const sidebar = document.querySelector('.sidebar .mv-user');
    if (!sidebar) return;

    try {
      const z = parseInt(localStorage.getItem('mv.zoom'), 10);
      if (!isNaN(z)) zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, z));
    } catch (e) {}

    const bar = document.createElement('div');
    bar.id = 'mvViewBar';
    bar.className = 'mv-viewbar';
    bar.innerHTML = `
      <button class="mv-vb" id="mvZoomOut" title="Réduire l'affichage">−</button>
      <span class="mv-vb-l" id="mvZoomLabel">100 %</span>
      <button class="mv-vb" id="mvZoomIn" title="Agrandir l'affichage">+</button>
      <button class="mv-vb wide" id="mvFull" title="Plein écran">⛶</button>`;
    sidebar.parentNode.insertBefore(bar, sidebar);

    $('mvZoomOut').addEventListener('click', () => setZoom(-1));
    $('mvZoomIn').addEventListener('click', () => setZoom(1));
    $('mvFull').addEventListener('click', toggleFullscreen);

    document.addEventListener('fullscreenchange', () => {
      const b = $('mvFull');
      if (b) { b.textContent = document.fullscreenElement ? '⛚' : '⛶'; b.title = document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran'; }
    });

    /* Raccourcis : Ctrl + / − / 0 restent utiles même sans la barre. */
    document.addEventListener('keydown', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(1); }
      else if (e.key === '-') { e.preventDefault(); setZoom(-1); }
      else if (e.key === '0') { e.preventDefault(); zoomIdx = 2; appliquerZoom(); }
    });

    appliquerZoom();
  }

  /* Quelqu'un d'autre a enregistré : on le signale sans interrompre. */
  function signalerChangementDistant(qui, cles) {
    const noms = {
      rhRoster: 'les employés', rhDeparts: 'les départs', rhAbsences: 'les absences',
      blacklist: 'la blacklist', clients: 'les clients', articles: 'les articles',
      historique: 'les factures', facturesRecues: 'les factures reçues',
      effectif: 'la production', dash: 'le tableau de bord', agenda: 'l\'agenda',
      clotures: 'la clôture', primesExc: 'les primes exceptionnelles',
    };
    const quoi = (cles || []).map(k => noms[k]).filter(Boolean);
    const detail = quoi.length ? ' — ' + [...new Set(quoi)].slice(0, 3).join(', ') : '';
    toast(`${qui ? qui + ' a' : 'Quelqu\'un a'} mis à jour le panel${detail}.`);
  }

  /* ========================================================================
     LECTURE SEULE
     ------------------------------------------------------------------------
     Un rôle peut voir une page sans pouvoir la modifier. Ici on neutralise
     les boutons d'action et on l'annonce clairement — le vrai verrou est
     côté serveur, qui refuse l'écriture quoi qu'il arrive.
     ======================================================================== */
  function appliquerLectureSeule() {
    const ses = window.MarloweSession || {};
    const ro = new Set(ses.readOnly || []);
    if (!ro.size) return;

    ro.forEach(id => {
      const page = $('page-' + id);
      if (!page || page.querySelector('.mv-ro-bandeau')) return;

      page.classList.add('mv-ro');
      const b = document.createElement('div');
      b.className = 'mv-ro-bandeau';
      b.innerHTML = '👁 <b>Lecture seule</b> — vous pouvez consulter cette page, '
                  + 'mais pas la modifier. Adressez-vous à la direction si besoin.';
      page.insertBefore(b, page.firstChild);
    });
  }

  /* ========================================================================
     QUOTAS SUR TROIS SEMAINES
     ------------------------------------------------------------------------
     Une semaine isolée ne dit rien : c'est la tendance qui permet de décider
     d'une promotion, d'une descente de grade ou d'un licenciement.
     ======================================================================== */
  function renderQuotas3() {
    const host = $('q3Body');
    if (!host) return;

    const weeks = (clotures.weeks || []).slice(0, 3);   /* les 3 plus récentes */
    const sub = $('q3Sub');

    if (!weeks.length) {
      if (sub) sub.textContent = 'Aucune semaine clôturée pour l\'instant.';
      host.innerHTML = `<div class="panel"><p class="empty-note" style="padding:26px 0;text-align:center;">
        Ce tableau se remplit à partir des semaines clôturées. Clôturez une première semaine
        depuis <b>Clôture du lundi</b> pour commencer à suivre les tendances.</p></div>`;
      return;
    }

    const anciennes = weeks.slice().reverse();          /* de la plus ancienne */
    if (sub) {
      sub.textContent = `${anciennes.length} semaine(s) suivie(s), de ${anciennes[0].du} `
        + `à ${anciennes[anciennes.length - 1].au} · la semaine en cours est ajoutée à droite.`;
    }

    /* Tous ceux qui apparaissent quelque part, archives ou semaine en cours. */
    const noms = [...new Set([
      ...anciennes.flatMap(w => (w.production || []).map(p => p.name)),
      ...effectifData.filter(e => e.active).map(e => e.name),
    ])].sort(parNom);

    const lignes = noms.map(nom => {
      const cases = anciennes.map(w => (w.production || []).find(p => p.name === nom) || null);
      const encours = effectifData.find(e => e.name === nom);
      cases.push(encours ? { grade: encours.grade, barils: encours.barils, quota: encours.quota } : null);

      const pcts = cases.map(c => (c && c.quota > 0) ? Math.round(c.barils / c.quota * 100) : null);
      const connus = pcts.filter(v => v !== null);
      const moyenne = connus.length ? Math.round(connus.reduce((a, b) => a + b, 0) / connus.length) : 0;

      /* Trois semaines de suite sous le quota : le signal qui compte. */
      const archives = pcts.slice(0, anciennes.length).filter(v => v !== null);
      const alerte = archives.length >= 2 && archives.every(v => v < 100);
      const progression = connus.length >= 2 ? connus[connus.length - 1] - connus[connus.length - 2] : null;

      return { nom, cases, pcts, moyenne, alerte, progression };
    });

    /* Les plus faibles en premier : c'est là qu'il faut agir. */
    lignes.sort((a, b) => a.moyenne - b.moyenne);

    const entetes = [...anciennes.map(w => w.label.replace(/^Semaine\s*/i, 'S')), 'En cours'];
    const cellule = (c, pct) => {
      if (!c) return '<td class="num dim">—</td>';
      const cls = pct === null ? '' : (pct >= 100 ? 'q3-ok' : (pct >= 50 ? 'q3-mid' : 'q3-bad'));
      return `<td class="num"><span class="q3-cell ${cls}">
        ${(c.barils || 0).toLocaleString('fr-FR')}
        <small>${pct === null ? 'hors quota' : pct + ' %'}</small></span></td>`;
    };

    host.innerHTML = `
      <div class="panel">
        <div class="table-wrap"><table class="gtable">
          <thead><tr><th>Employé</th><th>Grade</th>
            ${entetes.map(h => `<th class="num">${esc(h)}</th>`).join('')}
            <th class="num">Moyenne</th><th>Tendance</th></tr></thead>
          <tbody>${lignes.map(l => {
            const dernier = l.cases[l.cases.length - 1] || l.cases.filter(Boolean).pop();
            const g = dernier ? dernier.grade : '—';
            return `<tr${l.alerte ? ' class="q3-alerte"' : ''}>
              <td><b>${esc(l.nom)}</b>${l.alerte
                ? ' <span class="q3-flag" title="Sous son quota sur toutes les semaines archivées">⚠</span>' : ''}</td>
              <td><span class="grade-pill ${typeof gradePillClass === 'function' ? gradePillClass(g) : ''}">${esc(g)}</span></td>
              ${l.cases.map((c, i) => cellule(c, l.pcts[i])).join('')}
              <td class="num"><b>${l.moyenne} %</b></td>
              <td>${l.progression === null ? '<span class="mv-tr eq">—</span>'
                : l.progression === 0 ? '<span class="mv-tr eq">= stable</span>'
                : `<span class="mv-tr ${l.progression > 0 ? 'up' : 'down'}">${
                    l.progression > 0 ? '▲ +' : '▼ '}${l.progression} pts</span>`}</td>
            </tr>`; }).join('')}</tbody>
        </table></div>
        <p class="empty-note" style="margin-top:12px;">
          Trié du plus faible au plus fort — les situations à traiter sont en haut.
          <span class="q3-flag">⚠</span> signale un employé sous son quota sur <b>toutes</b> les semaines archivées.
          La tendance compare la dernière semaine à la précédente.</p>
      </div>`;
  }

  /* ========================================================================
     JOURNAL DES ACTIONS
     ======================================================================== */
  function tempsRelatif(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const sec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return "à l'instant";
    if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
    if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
    const j = Math.floor(sec / 86400);
    return j === 1 ? 'hier' : `il y a ${j} jours`;
  }

  const dateHeureFR = iso => {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  let journalCache = [];

  async function renderJournal(recharger) {
    const host = $('jBody');
    if (!host) return;
    const sub = $('jSub');

    if (recharger !== false) {
      try { journalCache = await D().journal(); }
      catch (e) { journalCache = []; }
    }

    if ((window.MarloweAuth.CONFIG.MODE) !== 'discord') {
      if (sub) sub.textContent = 'Le journal est tenu par le serveur — il ne fonctionne pas en mode test.';
      host.innerHTML = `<div class="panel"><p class="empty-note" style="padding:26px 0;text-align:center;">
        En mode test, aucune action n'est envoyée au serveur : il n'y a donc rien à journaliser.</p></div>`;
      return;
    }

    if (!journalCache.length) {
      if (sub) sub.textContent = 'Aucune action enregistrée pour le moment.';
      host.innerHTML = `<div class="panel"><p class="empty-note" style="padding:26px 0;text-align:center;">
        Le journal se remplit dès qu'une donnée est modifiée : ajout, suppression, clôture.</p></div>`;
      return;
    }

    const auteurs = [...new Set(journalCache.map(e => e.by))].sort();
    if (sub) sub.textContent = `${journalCache.length} action(s) · ${auteurs.length} auteur(s) · les 500 dernières sont conservées`;

    host.innerHTML = `
      <div class="panel">
        <div class="toolbar" style="margin-bottom:14px;">
          <div class="search"><span style="color:var(--muted);font-size:13px;">⌕</span>
            <input type="text" id="jSearch" placeholder="Rechercher une action, un nom…"></div>
          <select id="jWho"><option value="all">Tous les auteurs</option>
            ${auteurs.map(a => `<option>${esc(a)}</option>`).join('')}</select>
          <button class="btn" id="jReload">↻ Rafraîchir</button>
        </div>
        <div id="jList"></div>
      </div>`;

    $('jSearch').addEventListener('input', filtrerJournal);
    $('jWho').addEventListener('change', filtrerJournal);
    $('jReload').addEventListener('click', () => renderJournal(true));
    filtrerJournal();
  }

  function filtrerJournal() {
    const q = (val('jSearch') || '').toLowerCase();
    const who = $('jWho') ? $('jWho').value : 'all';
    const list = $('jList');
    if (!list) return;

    const vus = journalCache.filter(e =>
      (who === 'all' || e.by === who) &&
      (!q || (e.texte + ' ' + e.by).toLowerCase().includes(q)));

    if (!vus.length) { list.innerHTML = '<p class="empty-note" style="padding:22px 0;text-align:center;">Aucune action ne correspond.</p>'; return; }

    /* Regroupé par jour : on cherche presque toujours « ce qui s'est passé ce jour-là ». */
    const jours = {};
    vus.forEach(e => {
      const d = new Date(e.at);
      const k = isNaN(d) ? '—' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
      (jours[k] = jours[k] || []).push(e);
    });

    list.innerHTML = Object.entries(jours).map(([jour, entrees]) => `
      <div class="j-jour">${esc(jour)}</div>
      ${entrees.map(e => {
        const ini = String(e.by).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        return `<div class="j-row">
          <span class="j-av">${esc(ini)}</span>
          <span class="j-txt"><b>${esc(e.by)}</b> ${esc(e.texte)}</span>
          <span class="j-time" title="${esc(dateHeureFR(e.at))}">${esc(tempsRelatif(e.at))}</span>
        </div>`;
      }).join('')}`).join('');
  }

  /* ========================================================================
     ÉTATS VIDES
     ------------------------------------------------------------------------
     Un tableau vide sans un mot ressemble à une panne. On y met une phrase
     qui dit ce qui manque et où l'ajouter.
     ======================================================================== */
  const VIDES = [
    ['rosterBody',        8,  "Aucun employé au registre — enregistrez une arrivée depuis Recrutement."],
    ['blacklistBody',     6,  "Personne dans la blacklist."],
    ['clientsBody',       5,  "Aucun client — le premier s'ajoutera tout seul à la première facture."],
    ['articlesBody',      7,  "Aucun article au catalogue."],
    ['historiqueBody',    7,  "Aucune facture émise pour l'instant."],
    ['dashBody',          11, "Aucune ligne — collez la tablette de la semaine depuis « 📋 Coller la tablette »."],
    ['bcDetailBody',      9,  "Aucune donnée de production — le tableau se remplit depuis le Tableau de bord."],
    ['serviceHistoryBody', 4, "Aucune prise de service enregistrée."],
  ];

  const VIDES_BLOCS = [
    ['effectifList',       "Aucune fiche de production."],
    ['absGrid',            "Aucune absence en cours."],
    ['departCard',         "Aucun départ enregistré."],
    ['facturesRecuesList', "Aucune facture reçue archivée."],
    ['agendaList',         "Aucun événement au planning."],
  ];

  function remplirVides() {
    VIDES.forEach(([id, cols, texte]) => {
      const b = $(id);
      if (!b || b.children.length) return;
      b.innerHTML = `<tr><td colspan="${cols}" class="empty-note"
        style="text-align:center;padding:26px 12px;">${esc(texte)}</td></tr>`;
    });
    VIDES_BLOCS.forEach(([id, texte]) => {
      const b = $(id);
      if (!b || b.children.length) return;
      b.innerHTML = `<p class="empty-note" style="text-align:center;padding:26px 12px;">${esc(texte)}</p>`;
    });
  }

  /* Le jeu de démonstration et la remise à zéro du panel vivaient ici, avec
     la page « Données du panel » qui les appelait. Les trois sont retirés :
     le domaine tourne sur ses vraies données depuis longtemps, et un bouton
     qui vide tout sans retour en arrière n'a plus de raison d'attendre dans
     un menu. Rien d'autre ne s'en servait — les noms inventés, le tirage des
     dates et la liste des collections à vider partaient avec. */

  /* ========================================================================
     LOT A — AJUSTEMENTS D'AFFICHAGE
     ======================================================================== */
  function injectStyles() {
    const st = document.createElement('style');
    st.textContent = `
      /* Grades & quotas : la grille était collée aux bords sur grand écran. */
      #page-statsgrades .grade-grid{max-width:1080px;margin-left:auto;margin-right:auto;}
      #page-statsgrades .pagehead{max-width:1080px;margin-left:auto;margin-right:auto;}
      @media(max-width:1000px){#page-statsgrades .grade-grid{grid-template-columns:1fr;}}

      /* Bon de commande : le formulaire vit dans la page depuis qu'il n'a
         plus la boîte de dialogue pour l'habiller. */
      .mv-bon-panel{margin-bottom:18px;}
      .mv-bon-lab{display:block;font-size:11px;letter-spacing:.06em;
        text-transform:uppercase;color:var(--muted,#9C9384);margin-bottom:7px;}
      .mv-bon-form > select, .mv-bon-form > input{width:100%;max-width:340px;}
      .mv-bon-table{margin-top:2px;max-width:820px;}
      .mv-bon-total{font-size:13px;color:var(--muted,#9C9384);}
      .mv-bon-total b{color:var(--or,#C9A961);font-size:15px;}

      /* Bilan : les lignes qui viennent des logs et non du registre. */
      /* Sur sa propre ligne : posée à côté du nom, la mention poussait le nom
         hors de la colonne, qui le coupait — on ne lisait plus ni l'un ni
         l'autre. */
      .mv-horsreg{display:block;width:fit-content;margin:3px 0 0;padding:1px 6px;
        border:1px solid rgba(201,169,97,.42);border-radius:5px;
        font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;
        color:var(--or,#c9a961);opacity:.85;
        white-space:nowrap;font-weight:600;}

      /* Effectif : la légende explicative passe au second plan. */
      #page-statseffectif .legend{opacity:.55;font-size:11px;margin-top:26px;
        transition:opacity .18s;}
      #page-statseffectif .legend:hover{opacity:1;}


      /* Barres de défilement discrètes, au lieu des grises par défaut. */
      .sidebar nav, .table-wrap, .content{scrollbar-width:thin;
        scrollbar-color:#4A4336 transparent;}
      .sidebar nav::-webkit-scrollbar,
      .table-wrap::-webkit-scrollbar{width:8px;height:8px;}
      .sidebar nav::-webkit-scrollbar-track,
      .table-wrap::-webkit-scrollbar-track{background:transparent;}
      .sidebar nav::-webkit-scrollbar-thumb,
      .table-wrap::-webkit-scrollbar-thumb{background:#4A4336;border-radius:99px;}
      .sidebar nav::-webkit-scrollbar-thumb:hover,
      .table-wrap::-webkit-scrollbar-thumb:hover{background:var(--or-soft,#8E7C4E);}

      /* Le tableau des accès, lui, se défile À LA MAIN et dans les deux sens :
         sa barre est le seul moyen d'atteindre les colonnes de droite. Une
         barre de 8 px se vise mal — celle-ci est deux fois plus épaisse, avec
         un fond de rail visible pour qu'on sache où cliquer. */
      .mv-matrix-wrap{scrollbar-width:auto;scrollbar-color:#6B6250 rgba(0,0,0,.25);}
      .mv-matrix-wrap::-webkit-scrollbar{width:16px;height:16px;}
      .mv-matrix-wrap::-webkit-scrollbar-track{background:rgba(0,0,0,.25);
        border-radius:99px;margin:4px;}
      .mv-matrix-wrap::-webkit-scrollbar-thumb{background:#6B6250;border-radius:99px;
        border:4px solid transparent;background-clip:padding-box;}
      .mv-matrix-wrap::-webkit-scrollbar-thumb:hover{background:var(--or,#C9A961);
        border:3px solid transparent;background-clip:padding-box;}
      .mv-matrix-wrap::-webkit-scrollbar-corner{background:transparent;}

      .mv-synth{margin-top:18px;padding-top:16px;border-top:1px solid var(--band,#3D372C);
        max-width:520px;margin-left:auto;}
      .mv-synth-row{display:flex;justify-content:space-between;gap:20px;padding:5px 0;font-size:13.5px;}
      .mv-synth-row span{color:var(--muted,#9C9384);}
      .mv-synth-row b{font-variant-numeric:tabular-nums;}
      .mv-synth-row.big{font-size:16px;padding:9px 0;margin-top:4px;
        border-top:1px solid var(--band,#3D372C);font-family:'Fraunces',serif;}
      .mv-synth-row b.pos{color:var(--vine,#6E8B5D);} .mv-synth-row b.neg{color:#E08A7A;}
      .mv-synth-note{font-size:11px;color:var(--muted,#9C9384);margin-top:8px;text-align:right;font-style:italic;}

      /* --- Cartes de synthèse et page Historique --- */
      .mv-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;}
      .mv-kpis-8{margin-bottom:22px;}
      @media(max-width:1200px){.mv-kpis{grid-template-columns:repeat(2,1fr);}}
      @media(max-width:680px){.mv-kpis{grid-template-columns:1fr;}}
      .mv-kpi{background:var(--oak,rgba(38,35,30,.86));border:1px solid var(--band,#3D372C);
        border-radius:14px;padding:16px 18px;border-top:2px solid var(--or-soft,#8E7C4E);}
      .mv-kpi-l{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;
        color:var(--muted,#9C9384);margin-bottom:9px;}
      .mv-kpi-v{font-family:'Fraunces',serif;font-size:26px;font-weight:600;
        color:var(--parchment,#EDE3CF);line-height:1.1;font-variant-numeric:tabular-nums;}
      .mv-kpi-v.accent{color:var(--or,#C9A961);}
      .mv-kpi-v.neg{color:#E88A72;}
      .mv-kpi-v.small{font-size:19px;}
      .mv-kpi-s{font-size:11px;color:var(--muted,#9C9384);margin-top:7px;line-height:1.45;}

      .mv-chart{width:100%;height:auto;display:block;margin-top:6px;}
      .mv-bar rect,.mv-dot circle{transition:opacity .15s;}
      .mv-chart:hover .mv-bar{opacity:.55;} .mv-chart .mv-bar:hover{opacity:1;}
      .mv-chart:hover .mv-dot{opacity:.55;} .mv-chart .mv-dot:hover{opacity:1;}
      .mv-unit{font-family:'Inter',sans-serif;font-size:11px;font-weight:400;
        color:var(--muted,#9C9384);margin-left:8px;letter-spacing:.04em;}

      /* Les flèches disent le sens ; la couleur ne fait que confirmer —
         vert et rouge sont indiscernables en deutéranopie. */
      .mv-tr{font-size:10px;margin-left:5px;}
      .mv-tr.up{color:#7FBF6A;} .mv-tr.down{color:#E88A72;} .mv-tr.eq{color:var(--muted,#9C9384);}

      .bilan-chip.mv-forced{border-color:var(--amber,#D6A75C) !important;
        color:var(--amber,#D6A75C) !important;}

      /* --- Clôture du lundi --- */
      .mv-steps{padding:6px 0;}
      .mv-step{display:grid;grid-template-columns:auto 1fr;gap:16px;padding:20px 22px;
        border-bottom:1px solid var(--band,#3D372C);opacity:.6;transition:.18s;}
      .mv-step:last-of-type{border-bottom:none;}
      .mv-step.active,.mv-step.done{opacity:1;}
      .mv-step.active{background:rgba(201,169,97,.05);}
      .mv-step-n{width:30px;height:30px;border-radius:50%;flex-shrink:0;
        display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;
        border:1px solid var(--band,#3D372C);color:var(--muted,#9C9384);font-family:'Fraunces',serif;}
      .mv-step.active .mv-step-n{border-color:var(--or,#C9A961);color:#1C1B18;background:var(--or,#C9A961);}
      .mv-step.done .mv-step-n{border-color:var(--vine,#6E8B5D);color:var(--vine,#6E8B5D);
        background:rgba(110,139,93,.12);}
      .mv-step-t{font-family:'Fraunces',serif;font-weight:600;font-size:16px;
        color:var(--parchment,#EDE3CF);margin-bottom:6px;}
      .mv-step.done .mv-step-t{text-decoration:line-through;text-decoration-color:rgba(156,147,132,.5);}
      .mv-step-d{font-size:13px;line-height:1.7;color:var(--muted,#9C9384);max-width:760px;}
      .mv-step-actions{margin-top:14px;}
      .mv-step:not(.active):not(.done) .mv-step-actions{display:none;}
      .mv-step-all{padding:18px 22px;font-size:13.5px;color:var(--vine,#6E8B5D);
        display:flex;align-items:center;gap:14px;border-top:1px solid var(--band,#3D372C);}
      .mv-undo{margin-top:18px;border-color:rgba(214,167,92,.35);background:rgba(214,167,92,.05);}
      .mv-undo.off{opacity:.6;}
      .mv-undo p{font-size:13px;line-height:1.7;color:var(--muted,#9C9384);margin:8px 0 16px;max-width:760px;}
      .mv-undo button[disabled]{opacity:.45;cursor:not-allowed;}

      /* --- Bandeau de mise à jour --- */
      .mv-update{position:fixed;left:50%;transform:translateX(-50%);top:16px;z-index:9995;
        display:flex;align-items:center;gap:14px;background:#26231E;
        border:1px solid var(--or-soft,#8E7C4E);border-radius:999px;padding:10px 12px 10px 22px;
        box-shadow:0 12px 34px rgba(0,0,0,.5);font-size:13px;color:var(--parchment,#EDE3CF);
        max-width:min(760px,92vw);}
      .mv-update span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .mv-update .btn{padding:7px 16px;font-size:12.5px;white-space:nowrap;}
      .mv-update-x{background:none;border:none;color:var(--muted,#9C9384);font-size:18px;
        cursor:pointer;line-height:1;padding:0 4px;}
      .mv-update-x:hover{color:var(--parchment,#EDE3CF);}

      /* --- Volet « en ligne » (à droite) --- */
      .mv-online{position:fixed;right:0;top:96px;z-index:80;width:226px;
        background:rgba(28,27,24,.94);border:1px solid var(--band,#3D372C);border-right:none;
        border-radius:14px 0 0 14px;box-shadow:-10px 14px 34px rgba(0,0,0,.4);
        backdrop-filter:blur(6px);overflow:hidden;transition:width .22s ease;}
      .mv-on-head{width:100%;display:flex;align-items:center;gap:8px;background:none;border:none;
        padding:11px 13px;cursor:pointer;color:var(--muted,#9C9384);font:inherit;font-size:10.5px;
        letter-spacing:.14em;text-transform:uppercase;border-bottom:1px solid var(--band,#3D372C);}
      .mv-on-head:hover{color:var(--parchment,#EDE3CF);}
      .mv-on-dot{width:7px;height:7px;border-radius:50%;background:var(--vine,#6E8B5D);
        box-shadow:0 0 0 3px rgba(110,139,93,.18);flex-shrink:0;}
      .mv-on-dot.solo{background:var(--band,#3D372C);box-shadow:none;}
      .mv-on-title{flex:1;text-align:left;}
      .mv-on-cpt{color:var(--or,#C9A961);font-size:11px;letter-spacing:0;
        font-variant-numeric:tabular-nums;}
      .mv-on-chev{transition:transform .22s ease;font-size:14px;line-height:1;}
      .mv-on-list{display:flex;flex-direction:column;gap:2px;padding:8px 8px 10px;
        max-height:min(46vh,320px);overflow-y:auto;}
      .mv-on-row{display:flex;align-items:center;gap:9px;padding:6px 6px;border-radius:9px;min-width:0;}
      .mv-on-row.moi{background:rgba(201,169,97,.08);}
      .mv-on-av{width:26px;height:26px;border-radius:50%;flex-shrink:0;overflow:hidden;
        background:rgba(201,169,97,.15);border:1px solid var(--or-soft,#8E7C4E);
        display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:600;
        color:var(--or,#C9A961);}
      .mv-on-av img{width:100%;height:100%;object-fit:cover;}
      .mv-on-txt{display:flex;flex-direction:column;min-width:0;line-height:1.35;}
      .mv-on-n{font-size:12px;color:var(--parchment,#EDE3CF);
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .mv-on-n i{font-style:normal;color:var(--or-soft,#8E7C4E);font-size:10px;}
      .mv-on-p{font-size:10px;color:var(--muted,#9C9384);
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .mv-on-vide{margin:6px 6px 2px;font-size:11px;line-height:1.5;color:var(--muted,#9C9384);}

      /* Replié : il ne reste que la pastille et le compteur, en languette. */
      .mv-online.plie{width:52px;}
      .mv-online.plie .mv-on-list,
      .mv-online.plie .mv-on-title{display:none;}
      .mv-online.plie .mv-on-head{border-bottom:none;justify-content:center;padding:11px 8px;}
      .mv-online.plie .mv-on-chev{transform:rotate(180deg);}

      /* Sous 1200 px il masquerait le contenu : on l'efface. */
      @media(max-width:1200px){.mv-online{display:none;}}
      @media print{.mv-online{display:none;}}

      /* --- Barre d'affichage --- */
      /* Barre d'affichage — accordée à la colonne « coucher de vigne ». Le fond
         est opaque : le décor de la colonne passe derrière, jamais à travers. */
      .mv-viewbar{margin:0 -16px;padding:10px 16px;border-top:1px solid rgba(243,208,138,.14);
        background:rgba(20,16,13,.88);display:flex;align-items:center;gap:6px;}
      .mv-vb{width:26px;height:26px;border-radius:7px;border:1px solid rgba(243,208,138,.18);
        background:transparent;color:var(--muted,#9C9384);cursor:pointer;font-size:13px;
        line-height:1;display:flex;align-items:center;justify-content:center;transition:.15s;}
      .mv-vb:hover{color:#F3D08A;border-color:rgba(243,208,138,.45);}
      .mv-vb.wide{margin-left:auto;}
      .mv-vb-l{font-size:10.5px;color:var(--muted,#9C9384);min-width:38px;text-align:center;
        font-variant-numeric:tabular-nums;}

      /* --- Avertissements RH --- */
      .av-seal{display:inline-block;margin-left:7px;padding:1px 7px;border-radius:999px;
        font-size:10px;font-weight:600;vertical-align:middle;
        background:rgba(214,167,92,.14);border:1px solid rgba(214,167,92,.42);color:var(--amber,#D6A75C);}
      .av-seal.fort{background:rgba(150,52,60,.16);border-color:rgba(190,80,90,.5);color:#E08A7A;}
      .av-pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;
        border:1px solid;white-space:nowrap;}
      .av-doux{color:var(--muted,#9C9384);border-color:var(--band,#3D372C);background:rgba(255,255,255,.03);}
      .av-moyen{color:var(--amber,#D6A75C);border-color:rgba(214,167,92,.42);background:rgba(214,167,92,.10);}
      .av-fort{color:#E08A7A;border-color:rgba(190,80,90,.5);background:rgba(150,52,60,.14);}
      .mv-cpt-av{font-size:11px;font-weight:400;color:var(--muted,#9C9384);margin-left:6px;}

      /* --- Lecture seule --- */
      .mv-ro-bandeau{background:rgba(214,167,92,.10);border:1px solid rgba(214,167,92,.35);
        border-radius:11px;padding:12px 16px;margin-bottom:18px;font-size:13px;
        color:var(--amber,#D6A75C);line-height:1.6;}
      .mv-ro .btn,.mv-ro .btn-primary,.mv-ro .icon-btn,.mv-ro .eq-icon,
      .mv-ro .btn-depart,.mv-ro .btn-reset,.mv-ro .pbtn{
        pointer-events:none;opacity:.35;filter:grayscale(.6);}
      .mv-ro .mv-ro-bandeau{opacity:1;}

      /* --- Quotas 3 semaines --- */
      .q3-cell{display:inline-flex;flex-direction:column;align-items:flex-end;line-height:1.25;}
      .q3-cell small{font-size:10px;color:var(--muted,#9C9384);font-weight:400;}
      .q3-cell.q3-ok{color:var(--vine,#6E8B5D);}
      .q3-cell.q3-mid{color:var(--amber,#D6A75C);}
      .q3-cell.q3-bad{color:#E88A72;}
      tr.q3-alerte{background:rgba(138,53,64,.10);}
      .q3-flag{color:#E88A72;font-size:12px;}

      /* --- Journal --- */
      .j-jour{font-size:10px;letter-spacing:.16em;text-transform:uppercase;
        color:var(--or-soft,#8E7C4E);margin:18px 0 8px;padding-bottom:6px;
        border-bottom:1px solid var(--band,#3D372C);}
      .j-jour:first-child{margin-top:0;}
      .j-row{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;
        padding:9px 2px;font-size:13px;border-bottom:1px solid rgba(61,55,44,.45);}
      .j-row:last-child{border-bottom:none;}
      .j-av{width:24px;height:24px;border-radius:50%;flex-shrink:0;font-size:9.5px;font-weight:600;
        background:rgba(201,169,97,.14);border:1px solid var(--or-soft,#8E7C4E);color:var(--or,#C9A961);
        display:flex;align-items:center;justify-content:center;}
      .j-txt{color:var(--muted,#9C9384);line-height:1.5;}
      .j-txt b{color:var(--parchment,#EDE3CF);font-weight:600;}
      .j-time{font-size:11px;color:var(--or-soft,#8E7C4E);white-space:nowrap;}

      /* La règle générale « .mv-dlg label » met les libellés en petites
         capitales espacées, empilées — parfait pour un champ de saisie, illisible
         pour une case à cocher. Elle est plus spécifique que .mv-reset-l seule :
         il faut donc nommer les deux pour reprendre la main. */
      .mv-dlg label.mv-reset-l, .mv-reset-l{display:flex;align-items:center;gap:10px;
        padding:7px 0;margin:0;font-size:13px;letter-spacing:normal;text-transform:none;
        color:var(--parchment,#EDE3CF);cursor:pointer;}
      /* Même combat pour la case elle-même : « .mv-dlg input » lui donne
         width:100%, ce qui la fait occuper toute la ligne et rejette le texte
         hors de la boîte. À spécificité égale c'est la feuille la plus récente
         qui gagne — et c'est la sienne. On monte donc d'un cran. */
      .mv-dlg label.mv-reset-l input, .mv-reset-l input{
        width:15px;height:15px;min-width:15px;accent-color:var(--or,#C9A961);
        flex-shrink:0;margin:0;}
      .mv-reset-n{font-size:11.5px;color:var(--muted,#9C9384);line-height:1.6;
        margin-top:14px;padding-top:12px;border-top:1px solid var(--band,#3D372C);}

      .table-wrap{overflow-x:auto;}

      .action-icons{white-space:nowrap;}
      .action-icons .icon-btn{margin-left:4px;}`;
    document.head.appendChild(st);
  }

  /* Le repli des sections du menu a été retiré.
     ---------------------------------------------------------------------------
     Il existait pour dompter une liste de vingt-cinq entrées : on pliait ce
     dont on ne se servait pas. Le rail règle ce problème autrement — la colonne
     ne montre déjà qu'une section à la fois. Garder les deux était pire que n'en
     avoir aucun : une section repliée vidait complètement la colonne, et son
     intitulé, devenu invisible, ne permettait plus de la déplier.

     L'état était retenu dans le navigateur : on l'efface, sinon un repli
     enregistré il y a des semaines continuerait de masquer des pages. */
  function nettoyerAncienRepli() {
    try { localStorage.removeItem('mv.navFolded'); } catch (e) {}
    document.querySelectorAll('.nav-item.mv-folded')
      .forEach(i => i.classList.remove('mv-folded'));
    document.querySelectorAll('.nav-section.mv-collapsed')
      .forEach(s => s.classList.remove('mv-collapsed'));
  }

  /* ========================================================================
     BRANCHEMENT
     ======================================================================== */
  function wire() {
    /* Un seul écouteur pour tous les boutons des tableaux : ils sont
       recréés à chaque réaffichage, un écouteur direct serait perdu. */
    document.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-depart],[data-bl-del],[data-distribute],[data-undistribute],' +
        '[data-hist-del],[data-hist-pdf],[data-client-del],[data-client-edit],' +
        '[data-article-del],[data-article-edit],[data-fr-del],[data-fr-edit],' +
        '[data-canva-del],[data-dash-del],[data-agenda-del],' +
        '[data-eff-promote],[data-eff-down],[data-eff-warn],[data-eff-edit],[data-eff-del],[data-abs-del],' +
        '[data-histo-del],[data-primeexc-del],[data-step-go],[data-step-action],' +
        '[data-step-toggle],[data-step-reset]');
      if (!t) return;
      const d = t.dataset;
      ev.preventDefault();

      if (d.depart)        return declareDeparture(d.depart);
      if (d.blDel)         return removeBlacklist(d.blDel);
      if (d.distribute)    return setDistributed(d.distribute, true);
      if (d.undistribute)  return setDistributed(d.undistribute, false);
      if (d.histDel)       return deleteInvoice(d.histDel);
      if (d.histPdf)       return reprintInvoice(d.histPdf);
      if (d.clientDel)     return deleteClient(d.clientDel);
      if (d.clientEdit)    return editClient(d.clientEdit);
      if (d.articleDel)    return deleteArticle(d.articleDel);
      if (d.articleEdit)   return editArticle(d.articleEdit);
      if (d.frDel)         return deleteFactureRecue(d.frDel);
      if (d.frEdit)        return editFactureRecue(d.frEdit);
      if (d.canvaDel)      return deleteCanva(d.canvaDel);
      if (d.dashDel)       return deleteDashRow(d.dashDel);
      if (d.absDel)        return removeAbsence(d.absDel);
      if (d.histoDel)      return deleteHistoWeek(d.histoDel);
      if (d.stepGo)        return gotoPage(d.stepGo);
      if (d.stepAction)    return closeWeek();
      if (d.stepToggle)    return toggleStep(d.stepToggle);
      if (t.hasAttribute('data-step-reset')) return resetSteps();
      if (d.primeexcDel)   return removePrimeExc(d.primeexcDel);
      if (d.effPromote)    return promoteEmployee(d.effPromote);
      if (d.effDown)       return retrograderEmploye(d.effDown);
      if (d.effWarn)       return avertirEmploye(d.effWarn);
      if (d.effEdit)       return editEffectif(d.effEdit);
      if (d.effDel)        return deleteEffectif(d.effDel);
      if (d.agendaDel !== undefined) return deleteEvent(Number(d.agendaDel));
    });

    const on = (id, fn) => { const e = $(id); if (e) e.addEventListener('click', fn); };
    on('addEmpBtn', addEmployee);
    on('impEmpBtn', importerListeRH);
    on('syncEffectifBtn', () => syncEffectifEtEnregistrer(false));
    on('absBtn', declareAbsence);
    on('blAddBtn', addBlacklist);
    on('addClientBtn', addClient);
    on('addArticleBtn', addArticle);
    on('mvAddEvent', () => addEvent('public'));
    on('mvAddEventCom', () => addEvent('commercial'));
    on('primesExcBtn', addPrimeExceptionnelle);
    on('bcCopyBtn', copyDetailGDoc);
    on('depCopyBtn', copyDepensesGDoc);
    on('frArchiveBtn', archiveFactureRecue);
    on('invSaveBtn', saveInvoice);
    on('invPrintBtn', printCurrentInvoice);
    on('invResetBtn', resetInvoice);
    on('cloturerBtn', closeWeek);
    on('annulerClotureBtn', undoClose);

    /* Entrée dans le champ de nom = ajouter l'employé. */
    /* Le journal n'est chargé qu'à l'ouverture de sa page : inutile
       d'aller le chercher pour quelqu'un qui n'y va jamais. */
    document.addEventListener('click', ev => {
      const n = ev.target.closest('.sidebar .nav-item[data-page="journal"]');
      if (n) setTimeout(() => renderJournal(true), 120);
    });

    const es = $('effSearch');
    if (es) es.addEventListener('input', () => { effFiltre.q = es.value.trim(); applyEffectifFilter(); });
    const eg = $('effGradeFilter');
    if (eg) eg.addEventListener('change', () => { effFiltre.grade = eg.value; applyEffectifFilter(); });

    const tarif = $('invTarif');
    if (tarif) tarif.addEventListener('change', applyTarifToLines);

    const n = $('newEmpName');
    if (n) n.addEventListener('keydown', e => { if (e.key === 'Enter') addEmployee(); });
  }

  function start() {
    if (!window.MarloweData) { console.warn('[Marlowe] marlowe-data.js absent'); return; }
    if (document.querySelector('.mv-gate')) return;   // pas connecté

    injectStyles();
    injectAgendaButton();
    nettoyerAncienRepli();
    wire();

    /* L'éligibilité doit être lue depuis la dernière semaine clôturée :
       on remplace la version du fichier d'origine. */
    window.renderEligibilite = renderEligibilite;

    /* Les semaines passées s'en vont au démarrage, avant le premier
       affichage : la liste ne montre jamais ce qu'elle ne garde plus. */
    if (elaguerDeparts()) { D().save('rhDeparts'); D().redraw('rhDeparts'); }

    recomputeRecruiters();
    refreshEffectifCount();
    refreshClientCounts();
    fillClientList();
    refreshArticleCount();
    refreshFrCounts();
    refreshWeekDays();
    refreshWeekHeaders();
    renderEligibilite();
    renderBilan();
    /* Les ventes des partants arrivent du Worker, donc après coup : le bilan
       se redessine tout seul quand elles tombent. */
    chargerOrphelinsBilan();
    renderWeekHistory();
    renderHistorique();
    renderCloture();
    refreshEffectifFilters();
    renderQuotas3();
    remplirCartesGrades();
    renderMagasin();
    renderComRunner();
    renderRegles();
    renderTombola();
    renderEntretien();
    renderDocuments();
    railConstruire();
    appliquerLectureSeule();
    remplirVides();
    D().redraw('rhRecruiters');

    /* Confort : version, présence, affichage. */
    verifierVersion();
    setInterval(verifierVersion, VERSION_MS);
    buildAffichageBar();
    startPresence();
    D().onRemoteChange(signalerChangementDistant);
    D().startSync();
  }

  /* Les données arrivent après la connexion : on attend qu'elles soient là
     pour recalculer les compteurs, sinon ils porteraient sur le contenu
     d'origine du fichier. */
  function boot(tries) {
    if (document.querySelector('.mv-gate')) return;
    if (window.MarloweData && window.MarloweData.isLoaded()) { start(); return; }
    if ((tries || 0) > 60) { start(); return; }
    setTimeout(() => boot((tries || 0) + 1), 120);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot(0));
  } else {
    boot(0);
  }

  /* Exposé pour que marlowe-data.js puisse enregistrer les clôtures
     comme n'importe quelle autre collection. */
  window.MarloweClotures = clotures;


/* ==========================================================================
   VITRINE DU SITE — nouveautés et catalogue
   --------------------------------------------------------------------------
   Le patron dépose ici les visuels qui s'afficheront sur la page d'accueil.
   Les fichiers sont réduits DANS LE NAVIGATEUR avant d'être envoyés : une
   capture de jeu fait facilement 4 Mo, et personne n'a envie d'attendre ça au
   chargement de la vitrine. On monte le résultat à 1 600 px de large, ce qui
   reste net sur un grand écran.
   ========================================================================== */

  const vitrine = {
    nouveautes: [],
    /* Catalogue citoyen : publié sur le site vitrine. */
    catTitre: '', catDesc: '', catPdf: '', catEmbed: '', catPages: [],
    /* Catalogue entreprise : il ne passe PAS par la route publique, il reste
       dans les données du panel et n'est visible que connecté. */
    entTitre: '', entDesc: '', entPdf: '', entEmbed: '', entPages: [],
  };
  const NOUV_MAX = 5;

  /* Les données venues du serveur REMPLACENT le contenu de cet objet, clé pour
     clé. Un enregistrement fait avant l'ajout d'un champ ne contient donc pas
     ce champ — et `vitrine.entPages.length` cesse d'exister, ce qui interrompt
     tout l'affichage de la page sans le moindre message visible.

     Deux lignes ici valent mieux qu'une chasse au fantôme : après chaque
     lecture, les champs absents retrouvent leur valeur par défaut. */
  const VITRINE_DEFAUTS = {
    nouveautes: [], catTitre: '', catDesc: '', catPdf: '', catEmbed: '', catPages: [],
    entTitre: '', entDesc: '', entPdf: '', entEmbed: '', entPages: [],
  };

  function normaliserVitrine() {
    Object.keys(VITRINE_DEFAUTS).forEach(k => {
      const attendu = VITRINE_DEFAUTS[k];
      if (Array.isArray(attendu)) {
        if (!Array.isArray(vitrine[k])) vitrine[k] = [];
      } else if (typeof vitrine[k] !== 'string') {
        vitrine[k] = vitrine[k] == null ? '' : String(vitrine[k]);
      }
    });
    return vitrine;
  }

  /* Un lien copié depuis le bouton « Partager » de Canva ne s'affiche PAS dans
     une page : Canva l'interdit, et le cadre reste blanc. Seule la forme
     « …/view?embed » est intégrable. On remet donc le lien en forme dès la
     saisie, pour que ça marche tout de suite dans le panel — le serveur refait
     la même chose de son côté, par sécurité. */
/* --- Les liens de catalogue -------------------------------------------------
   Un lien de partage ordinaire ne s'affiche pas dans un cadre : Canva comme
   Google refusent d'être intégrés sous cette forme, et la page reste blanche
   sans le moindre message. Chacun a une adresse de consultation distincte,
   celle-là intégrable — c'est elle qu'on reconstruit ici à partir du lien que
   la personne a copié, quel qu'il soit.

   Renvoie l'adresse intégrable, '' si le champ est vide, ou null si le lien
   n'est d'aucun service reconnu. */
  function lienEmbed(brut) {
    const t = String(brut || '').trim();
    if (!t) return '';
    let u;
    try { u = new URL(t); } catch (e) { return null; }
    const hote = u.hostname.replace(/^www\./, '');
    const p = u.pathname;
    let m;

    if (hote === 'canva.com') {
      m = p.match(/^\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/);
      return m ? `https://www.canva.com/design/${m[1]}/${m[2]}/view?embed` : null;
    }

    if (hote === 'docs.google.com') {
      /* Présentation, document, tableur : même forme d'adresse, terminaison
         différente. « embed » fait défiler les diapositives ; « preview »
         affiche la page sans la barre d'outils d'édition. */
      m = p.match(/^\/(presentation|document|spreadsheets)\/d\/(?:e\/)?([A-Za-z0-9_-]{10,})/);
      if (!m) return null;
      const fin = m[1] === 'presentation' ? 'embed?start=false&loop=false&delayms=60000' : 'preview';
      return `https://docs.google.com/${m[1]}/d/${m[2]}/${fin}`;
    }

    if (hote === 'drive.google.com') {
      m = p.match(/^\/file\/d\/([A-Za-z0-9_-]{10,})/);
      return m ? `https://drive.google.com/file/d/${m[1]}/preview` : null;
    }

    return null;
  }

  /* L'ancien nom reste en service : il est appelé ailleurs dans le fichier. */
  const lienCanva = lienEmbed;
  const CAT_MAX  = 40;

  function cfgAuth() { return (window.MarloweAuth && window.MarloweAuth.CONFIG) || {}; }

  /* Seule cette adresse est acceptée par le serveur : c'est la valeur de
     SITE_URL côté Worker. Ouvrir le panel ailleurs fait échouer tous les
     appels réseau, pas seulement l'envoi Discord. */
  const SITE_ATTENDU = 'https://poulpizar01.github.io';

  function jeton() {
    try { return JSON.parse(localStorage.getItem('mv.token') || 'null'); } catch (e) { return null; }
  }

  /* Réduit un fichier image et renvoie un Blob JPEG. Un PDF passe tel quel :
     il n'y a rien à redimensionner, et le recompresser le casserait. */
  function reduireImage(file, cote = 1600) {
    if (file.type === 'application/pdf') return Promise.resolve(file);

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        URL.revokeObjectURL(url);
        const ech = Math.min(1, cote / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width  = Math.round(im.width  * ech);
        c.height = Math.round(im.height * ech);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        c.toBlob(b => b ? resolve(b) : reject(new Error('conversion impossible')), 'image/jpeg', 0.82);
      };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
      im.src = url;
    });
  }

  async function envoyerFichier(file) {
    const cfg = cfgAuth();
    const tok = jeton();
    if (!cfg.API_BASE || !tok) throw new Error('connectez-vous au panel avant de déposer un visuel');

    const blob = await reduireImage(file);
    const res = await fetch(cfg.API_BASE + '/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || file.type, 'Authorization': 'Bearer ' + tok },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 413) throw new Error(file.type === 'application/pdf'
        ? 'PDF trop lourd — le plafond est de 12 Mo, allégez-le avant de le joindre'
        : 'fichier trop lourd même après réduction');
      if (res.status === 403) throw new Error('seul le patron peut déposer un visuel');
      throw new Error(data.error || ('erreur ' + res.status));
    }
    return cfg.API_BASE + data.url;
  }

  /* Ce que le champ contient et ce qui est enregistré ne sont pas la même
     chose : le lien est remis en forme au moment d'enregistrer. Afficher
     l'adresse réellement retenue évite de se demander si ça a pris. */
  function temoinLien(url) {
    return url
      ? `<p class="mv-temoin est-ok">✓ Enregistré : <code>${esc(url)}</code></p>`
      : `<p class="mv-temoin">Aucun lien enregistré — le catalogue s'affichera à partir des pages déposées, ou restera vide.</p>`;
  }

  function renderVitrine() {
    const box = document.getElementById('mvVitrine');
    if (!box) return;
    normaliserVitrine();

    const n = vitrine.nouveautes;
    const cartes = n.length ? n.map((x, i) => `
      <li class="mv-nouv" data-i="${i}">
        <div class="mv-nouv-vis" style="background-image:url('${String(x.img).replace(/'/g, "%27")}')"></div>
        <div class="mv-nouv-champs">
          <input type="text" data-champ="titre" data-i="${i}" placeholder="Titre (facultatif)" value="${esc(x.titre || '')}">
          <input type="text" data-champ="texte" data-i="${i}" placeholder="Une ligne de description (facultatif)" value="${esc(x.texte || '')}">
        </div>
        <div class="mv-nouv-actions">
          <button class="btn" data-mv="up"   data-i="${i}" title="Monter"    ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn" data-mv="down" data-i="${i}" title="Descendre" ${i === n.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn" data-mv="del"  data-i="${i}" title="Retirer">✕</button>
        </div>
      </li>`).join('')
      : `<li class="mv-vide-note">Aucune nouveauté publiée — la page d'accueil affiche le blason du domaine à la place.</li>`;

    const pages = vitrine.catPages.length
      ? vitrine.catPages.map((u, i) => `
          <li class="mv-page" data-i="${i}">
            <span class="mv-page-n">${i + 1}</span>
            <div class="mv-page-vis" style="background-image:url('${String(u).replace(/'/g, "%27")}')"></div>
            <button class="btn" data-cat="up"   data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn" data-cat="down" data-i="${i}" ${i === vitrine.catPages.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn" data-cat="del"  data-i="${i}">✕</button>
          </li>`).join('')
      : `<li class="mv-vide-note">Aucune page déposée — le site affiche « catalogue en préparation ».</li>`;

    box.innerHTML = `
      <h3>Vitrine du site</h3>
      <p class="mv-sub">Ce que vous déposez ici s'affiche sur la page d'accueil publique,
        sans rien avoir à republier.</p>

      <div class="mv-vit-sec">
        <div class="mv-vit-head">
          <h4>Les nouveautés <span class="mv-cpt">${n.length} / ${NOUV_MAX}</span></h4>
          <div>
            <input type="file" id="mvNouvFile" accept="image/*" hidden>
            <button class="btn primary" id="mvNouvAdd" ${n.length >= NOUV_MAX ? 'disabled' : ''}>+ Ajouter une image</button>
          </div>
        </div>
        <ul class="mv-nouv-list">${cartes}</ul>
      </div>

      <div class="mv-vit-sec">
        <div class="mv-vit-head">
          <h4>Catalogue <span class="mv-cpt">${vitrine.catPages.length} page${vitrine.catPages.length > 1 ? 's' : ''}</span></h4>
          <div>
            <input type="file" id="mvCatFiles" accept="image/*" multiple hidden>
            <input type="file" id="mvCatPdf" accept="application/pdf" hidden>
            <button class="btn primary" id="mvCatAdd">+ Déposer des pages</button>
            <button class="btn" id="mvCatPdfBtn">${vitrine.catPdf ? 'Remplacer le PDF' : 'Joindre le PDF'}</button>
          </div>
        </div>
        <div class="mv-vit-champs">
          <input type="text" id="mvCatTitre" placeholder="Titre du catalogue" value="${esc(vitrine.catTitre || '')}">
          <input type="text" id="mvCatDesc" placeholder="Une ligne de présentation" value="${esc(vitrine.catDesc || '')}">
        </div>
        <input type="text" id="mvCatEmbed" class="mv-large"
               placeholder="Lien Canva ou Google (facultatif) — collez l'adresse telle quelle"
               value="${esc(vitrine.catEmbed || '')}">
        ${temoinLien(vitrine.catEmbed)}
        <p class="mv-hint">Avec un lien, le catalogue s'affiche directement : rien à exporter.
          Acceptés : Canva, Google Slides, Docs, Sheets et Drive.
          Le document doit être <b>lisible par toute personne disposant du lien</b>, sinon vos visiteurs verront une page vide.
          Sans lien, ce sont les pages déposées ci-dessous qui s'affichent.</p>
        ${vitrine.catPdf ? `<p class="mv-pdf-ok">PDF joint — un bouton de téléchargement s'affiche sur le site.
            <button class="btn" id="mvCatPdfDel">Retirer</button></p>` : ''}
        <ul class="mv-page-list">${pages}</ul>
        <p class="mv-hint">Exportez votre catalogue en <b>PNG ou JPG</b> pour l'affichage — une image par page,
          dans l'ordre. Le PDF est facultatif : il sert uniquement au bouton de téléchargement.</p>
      </div>

      <div class="mv-vit-sec">
        <div class="mv-vit-head">
          <h4>Catalogue entreprise <span class="mv-cpt">${vitrine.entPages.length} page${vitrine.entPages.length > 1 ? 's' : ''}</span></h4>
          <div>
            <input type="file" id="mvEntFiles" accept="image/*" multiple hidden>
            <input type="file" id="mvEntPdf" accept="application/pdf" hidden>
            <button class="btn primary" id="mvEntAdd">+ Déposer des pages</button>
            <button class="btn" id="mvEntPdfBtn">${vitrine.entPdf ? 'Remplacer le PDF' : 'Joindre le PDF'}</button>
          </div>
        </div>
        <div class="mv-vit-champs">
          <input type="text" id="mvEntTitre" placeholder="Titre du catalogue entreprise" value="${esc(vitrine.entTitre || '')}">
          <input type="text" id="mvEntDesc" placeholder="Une ligne de présentation" value="${esc(vitrine.entDesc || '')}">
        </div>
        <input type="text" id="mvEntEmbed" class="mv-large"
               placeholder="Lien Canva ou Google, catalogue entreprise (facultatif)"
               value="${esc(vitrine.entEmbed || '')}">
        ${temoinLien(vitrine.entEmbed)}
        <p class="mv-hint">Celui-ci <b>ne part pas sur le site public</b> : il n'apparaît que dans
          Commerce ▸ Catalogue ▸ Catalogue Entreprise, pour les membres connectés.</p>
        ${vitrine.entPdf ? `<p class="mv-pdf-ok">PDF joint.
            <button class="btn" id="mvEntPdfDel">Retirer</button></p>` : ''}
        <ul class="mv-page-list">${vitrine.entPages.length
          ? vitrine.entPages.map((u, i) => `
            <li class="mv-page" data-i="${i}">
              <span class="mv-page-n">${i + 1}</span>
              <div class="mv-page-vis" style="background-image:url('${String(u).replace(/'/g, "%27")}')"></div>
              <button class="btn" data-ent="up"   data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="btn" data-ent="down" data-i="${i}" ${i === vitrine.entPages.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="btn" data-ent="del"  data-i="${i}">✕</button>
            </li>`).join('')
          : `<li class="mv-vide-note">Aucune page déposée pour les entreprises.</li>`}</ul>
      </div>

      <div class="btn-row" style="margin-top:6px;align-items:center;">
        <button class="btn primary" id="mvVitSave">Publier sur le site</button>
        <span class="mv-saved" id="mvVitSaved">Publié ✓</span>
      </div>`;
  }

  function sauverVitrine(note) {
    const D = window.MarloweData;
    if (!D) return;
    D.note(note || 'Vitrine du site mise à jour');
    D.save('vitrine', false);
    renderVitrine();
    renderCatalogues();
  }

  function occupe(btn, actif, texte) {
    if (!btn) return;
    btn.disabled = actif;
    if (actif) { btn.dataset.avant = btn.textContent; btn.textContent = texte || 'Envoi…'; }
    else if (btn.dataset.avant) { btn.textContent = btn.dataset.avant; }
  }

  /* Toute la vitrine passe par la délégation : le panneau se redessine à chaque
     ajout, des écouteurs posés sur les boutons seraient perdus aussitôt. */
  document.addEventListener('click', async e => {
    const box = document.getElementById('mvVitrine');
    if (!box || !box.contains(e.target)) return;

    if (e.target.closest('#mvNouvAdd'))   { document.getElementById('mvNouvFile').click(); return; }
    if (e.target.closest('#mvCatAdd'))    { document.getElementById('mvCatFiles').click(); return; }
    if (e.target.closest('#mvCatPdfBtn')) { document.getElementById('mvCatPdf').click();   return; }
    if (e.target.closest('#mvEntAdd'))    { document.getElementById('mvEntFiles').click(); return; }
    if (e.target.closest('#mvEntPdfBtn')) { document.getElementById('mvEntPdf').click();   return; }

    if (e.target.closest('#mvCatPdfDel')) { vitrine.catPdf = ''; sauverVitrine('PDF du catalogue retiré'); return; }
    if (e.target.closest('#mvEntPdfDel')) { vitrine.entPdf = ''; sauverVitrine('PDF entreprise retiré'); return; }

    const en = e.target.closest('[data-ent]');
    if (en) {
      const i = +en.dataset.i, l = vitrine.entPages;
      if (en.dataset.ent === 'del')  l.splice(i, 1);
      if (en.dataset.ent === 'up'   && i > 0)            [l[i - 1], l[i]] = [l[i], l[i - 1]];
      if (en.dataset.ent === 'down' && i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]];
      sauverVitrine('Catalogue entreprise réorganisé');
      return;
    }

    const b = e.target.closest('[data-mv]');
    if (b) {
      const i = +b.dataset.i, l = vitrine.nouveautes;
      if (b.dataset.mv === 'del')  l.splice(i, 1);
      if (b.dataset.mv === 'up'   && i > 0)            [l[i - 1], l[i]] = [l[i], l[i - 1]];
      if (b.dataset.mv === 'down' && i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]];
      sauverVitrine('Nouveautés réorganisées');
      return;
    }

    const c = e.target.closest('[data-cat]');
    if (c) {
      const i = +c.dataset.i, l = vitrine.catPages;
      if (c.dataset.cat === 'del')  l.splice(i, 1);
      if (c.dataset.cat === 'up'   && i > 0)            [l[i - 1], l[i]] = [l[i], l[i - 1]];
      if (c.dataset.cat === 'down' && i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]];
      sauverVitrine('Pages du catalogue réorganisées');
      return;
    }

    if (e.target.closest('#mvVitSave')) {
      vitrine.catTitre = (document.getElementById('mvCatTitre') || {}).value || '';
      vitrine.catDesc  = (document.getElementById('mvCatDesc')  || {}).value || '';
      vitrine.entTitre = (document.getElementById('mvEntTitre') || {}).value || '';
      vitrine.entDesc  = (document.getElementById('mvEntDesc')  || {}).value || '';

      /* Un lien non reconnu est signalé plutôt qu'enregistré en silence :
         sinon le catalogue reste vide sans qu'on sache pourquoi. */
      /* Un lien non reconnu est signalé, mais il n'annule plus le reste :
         perdre un titre et une description à cause d'une adresse mal collée
         était une punition disproportionnée. Le lien fautif est simplement
         laissé de côté, les autres champs sont enregistrés. */
      const mauvais = [];
      [['mvCatEmbed', 'catEmbed', 'citoyens'], ['mvEntEmbed', 'entEmbed', 'entreprise']]
        .forEach(([id, cle, quoi]) => {
          const brut = (document.getElementById(id) || {}).value || '';
          const propre = lienEmbed(brut);
          if (propre === null) { mauvais.push(quoi); return; }
          vitrine[cle] = propre;
        });

      sauverVitrine('Vitrine publiée');

      if (mauvais.length) {
        alert("Le reste a bien été enregistré, mais le lien du catalogue "
          + mauvais.join(' et ') + " n'a pas été reconnu.\n\n"
          + "Services acceptés :\n"
          + "  · Canva          https://www.canva.com/design/…\n"
          + "  · Google Slides  https://docs.google.com/presentation/d/…\n"
          + "  · Google Docs    https://docs.google.com/document/d/…\n"
          + "  · Google Sheets  https://docs.google.com/spreadsheets/d/…\n"
          + "  · Google Drive   https://drive.google.com/file/d/…\n\n"
          + "Ouvrez le document, Partager, copiez le lien, collez-le tel quel. "
          + "Pensez aussi à autoriser la lecture à toute personne disposant du lien : "
          + "sans ça, le cadre restera vide pour les autres.");
        return;
      }
      const ok = document.getElementById('mvVitSaved');
      if (ok) { ok.classList.add('on'); setTimeout(() => ok.classList.remove('on'), 1800); }
    }
  });

  /* Les champs de texte ne déclenchent pas de redessin : on les recopie dans les
     données au fil de la frappe, sinon le curseur sauterait à chaque lettre. */
  document.addEventListener('input', e => {
    const ch = e.target.closest('#mvVitrine [data-champ]');
    if (!ch) return;
    const x = vitrine.nouveautes[+ch.dataset.i];
    if (x) x[ch.dataset.champ] = ch.value;
  });
  document.addEventListener('change', async e => {
    const box = document.getElementById('mvVitrine');
    if (!box || !box.contains(e.target)) return;
    const input = e.target;
    const files = [...(input.files || [])];
    if (!files.length) return;

    const btn = document.getElementById(
      input.id === 'mvNouvFile' ? 'mvNouvAdd'
      : input.id === 'mvCatPdf' ? 'mvCatPdfBtn'
      : input.id === 'mvEntPdf' ? 'mvEntPdfBtn'
      : input.id === 'mvEntFiles' ? 'mvEntAdd' : 'mvCatAdd');

    try {
      occupe(btn, true);
      if (input.id === 'mvNouvFile') {
        if (vitrine.nouveautes.length >= NOUV_MAX) throw new Error(NOUV_MAX + ' images au maximum');
        vitrine.nouveautes.push({ img: await envoyerFichier(files[0]), titre: '', texte: '' });
        sauverVitrine('Nouveauté ajoutée');

      } else if (input.id === 'mvCatPdf') {
        vitrine.catPdf = await envoyerFichier(files[0]);
        sauverVitrine('PDF du catalogue joint');

      } else if (input.id === 'mvEntPdf') {
        vitrine.entPdf = await envoyerFichier(files[0]);
        sauverVitrine('PDF entreprise joint');

      } else if (input.id === 'mvEntFiles') {
        const place = CAT_MAX - vitrine.entPages.length;
        if (place <= 0) throw new Error(CAT_MAX + ' pages au maximum');
        for (const f of files.slice(0, place)) {
          vitrine.entPages.push(await envoyerFichier(f));
          renderVitrine();
        }
        sauverVitrine('Pages entreprise ajoutées');

      } else {
        const place = CAT_MAX - vitrine.catPages.length;
        if (place <= 0) throw new Error(CAT_MAX + ' pages au maximum');
        /* Les fichiers sont envoyés un par un et dans l'ordre : un envoi
           parallèle irait plus vite mais mélangerait les pages. */
        for (const f of files.slice(0, place)) {
          vitrine.catPages.push(await envoyerFichier(f));
          renderVitrine();
        }
        sauverVitrine('Pages du catalogue ajoutées');
      }
    } catch (err) {
      alert('Dépôt impossible : ' + (err.message || err));
    } finally {
      occupe(btn, false);
      input.value = '';
      renderVitrine();
    }
  });

  document.addEventListener('mv:parametres-pret', () => {
    renderVitrine();
    renderCatalogues();
    if (typeof renderReglages === 'function') renderReglages();
    chargerInvites();
  });

  window.MarloweVitrine = vitrine;



/* ==========================================================================
   MA SEMAINE — la page ne s'est jamais affichée
   --------------------------------------------------------------------------
   Le fichier d'origine construisait la liste des employés UNE FOIS, au moment
   où le navigateur lisait le script :

       const prodPool = effectifData.filter(e => e.active);

   À cet instant effectifData est vide — il ne se remplit qu'après la réponse
   du serveur. prodPool restait donc un tableau vide pour toujours : le menu
   « Voir en tant que » n'avait aucune entrée, renderMaSemaine n'était jamais
   appelée, et la page affichait « — » quoi qu'il arrive.

   Tout est refait ici, lu au moment de l'affichage et rebranché sur la
   collection « effectif », qui se redessine à chaque changement.

   Deuxième correction, demandée : le menu « Voir en tant que » ne sert qu'au
   patron. Un employé arrive directement sur sa propre fiche, sans choix à
   faire — et sans pouvoir aller lire celle du voisin.
   ========================================================================== */

  const SEAL_CLASSE = { 'Saisonnier': 'seal-clay', 'Ouvrier Viticole': 'seal-bronze', 'Chef de Culture': 'seal-gold' };
  const SEAL_ABBR   = { 'Saisonnier': 'SA', 'Ouvrier Viticole': 'OV', 'Chef de Culture': 'CC' };

  /* Comparaison de noms indulgente : la session porte le pseudo Discord, le
     registre le nom RP. Accents, casse et espaces multiples ne doivent pas
     empêcher un employé de retrouver sa fiche. */
  const clefNom = t => String(t || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  /* Le sélecteur de « Ma semaine » n'était ouvert qu'au patron. La direction
     et les ressources humaines en ont l'usage tout autant : c'est à elles
     qu'on demande où en est un employé. */
  function maSemainePatron() {
    return peutVoirAutrui();
  }

  function maSemaineFiches() {
    return (typeof effectifData !== 'undefined' ? effectifData : []).filter(e => e.active !== false);
  }

  /* La fiche de la personne connectée, si on arrive à la reconnaître. */
  function maSemaineMienne() {
    const s = window.MarloweSession;
    if (!s || !s.name) return null;
    const moi = clefNom(s.name);
    return maSemaineFiches().find(e => clefNom(e.name) === moi) || null;
  }

  let maSemaineChoix = null;      /* le nom choisi par le patron dans le menu */

  function maSemaineCible() {
    const fiches = maSemaineFiches();
    if (!fiches.length) return null;
    if (!maSemainePatron()) return maSemaineMienne();
    if (maSemaineChoix) {
      const f = fiches.find(e => e.name === maSemaineChoix);
      if (f) return f;
    }
    return maSemaineMienne() || fiches[0];
  }

  function maSemaineVide(message) {
    const host = $('page-masemaine');
    if (!host) return;
    ['prodName', 'prodValue', 'prodLabel', 'prodStatus'].forEach(id => {
      const el = $(id); if (el) el.textContent = '—';
    });
    const bar = $('prodBar'); if (bar) bar.style.width = '0%';
    const rec = $('prodReward'); if (rec) rec.innerHTML = `<span class="dim">${esc(message)}</span>`;
    const nxt = $('prodNext'); if (nxt) nxt.innerHTML = '';
  }

  function renderMaSemaine(nom) {
    if (!$('prodName')) return;
    if (nom) maSemaineChoix = nom;

    /* --- le menu, et à qui il s'adresse --- */
    const wrap = $('prodSwitcher');
    const sel = $('prodEmployeeSelect');
    const patron = maSemainePatron();
    if (wrap) wrap.hidden = !patron;
    if (sel && patron) {
      const fiches = maSemaineFiches();
      const cible = maSemaineCible();
      sel.innerHTML = fiches.map(e =>
        `<option value="${esc(e.name)}"${cible && e.name === cible.name ? ' selected' : ''}>${esc(e.name)}</option>`).join('');
    }

    /* --- la semaine en cours, au lieu d'une date figée dans le fichier --- */
    const sem = $('prodWeek');
    if (sem && typeof mondayOf === 'function') {
      const m = mondayOf(new Date());
      const d = new Date(m); d.setDate(d.getDate() + 6);
      sem.textContent = `Semaine ${isoWeek(m)} · du ${frDate(m)} au ${frDate(d)}`;
    }

    const e = maSemaineCible();
    if (!e) {
      maSemaineVide(maSemaineFiches().length
        ? "Aucune fiche à votre nom dans l'effectif. Demandez aux RH de vérifier l'orthographe de votre nom dans le registre."
        : "L'effectif est vide : collez la tablette dans Tableau de bord, puis synchronisez l'effectif.");
      renderMaSemaineHisto(null);
      return;
    }

    $('prodName').textContent = e.name;
    const sealEl = $('prodSeal');
    if (sealEl) {
      sealEl.textContent = SEAL_ABBR[e.grade] || '—';
      sealEl.className = 'prod-seal-big ' + (SEAL_CLASSE[e.grade] || 'seal-clay');
    }
    const pill = $('prodGradePill');
    if (pill) {
      pill.textContent = e.grade || '—';
      pill.className = 'grade-pill ' + (typeof gradePillClass === 'function' ? gradePillClass(e.grade) : 'gp-muted');
    }

    const barils = Number(e.barils) || 0;
    const quota = Number(e.quota) || 0;
    const pct = quota > 0 ? Math.min(100, Math.round(barils / quota * 100)) : 0;
    $('prodValue').innerHTML = `${pct}<span>%</span>`;
    $('prodLabel').textContent = `${barils.toLocaleString('fr-FR')} / ${quota.toLocaleString('fr-FR')} vins`;
    const bar = $('prodBar');
    if (bar) {
      bar.style.width = pct + '%';
      bar.className = 'prod-bar-fill' + (pct < 100 && pct >= 50 ? ' warn' : '');
    }

    const st = $('prodStatus');
    if (st && typeof statusFor === 'function') {
      const s = statusFor(e);
      st.textContent = s.label;
      st.className = 'status-badge ' + s.cls;
    }

    const rec = $('prodReward');
    if (rec) {
      const lot = (typeof rewardsByGrade === 'object' && rewardsByGrade[e.grade]) || '—';
      rec.innerHTML = `Si le quota est atteint cette semaine → <b style="color:var(--or);">${esc(lot)}</b>
        <div class="prod-reward-check ${pct >= 100 ? 'ok' : 'pending'}">${pct >= 100
          ? '✓ Quota atteint — récompense acquise'
          : '○ Quota en cours — récompense pas encore débloquée'}</div>`;
    }

    const nxt = $('prodNext');
    if (nxt) {
      if (e.isFinal || !e.promoTarget) {
        nxt.innerHTML = `<p class="prod-next-title">Vous êtes au <b>grade final</b> de la filière viticole.
          Continuez de dépasser votre quota pour rester dans le Top 5 de la semaine.</p>`;
      } else {
        const reste = Math.max(0, e.promoTarget - barils);
        nxt.innerHTML = `
          <p class="prod-next-title">Passage à <b>${esc(e.nextGrade || '—')}</b> à partir de
            <b>${Number(e.promoTarget).toLocaleString('fr-FR')}</b> vins.</p>
          ${reste > 0
            ? `<div class="prod-reward-check pending">○ Encore ${reste.toLocaleString('fr-FR')} vins avant la promotion</div>`
            : `<div class="prod-reward-check ok">✓ Seuil de promotion dépassé — bascule à la prochaine clôture</div>`}`;
      }
    }

    renderMaSemaineHisto(e);
  }

  /* Le panneau « Historique personnel » affichait une phrase figée qui ne
     changeait jamais, même une fois des semaines clôturées. Il se remplit
     maintenant depuis les photographies de clôture. */
  function renderMaSemaineHisto(e) {
    const box = $('prodHisto');
    if (!box) return;

    const semaines = (clotures.weeks || [])
      .map(w => ({ w, p: (w.production || []).find(x => e && clefNom(x.name) === clefNom(e.name)) }))
      .filter(x => x.p);

    box.innerHTML = `<h3>Historique personnel</h3>` + (semaines.length ? `
      <table class="gtable" style="margin-top:12px;">
        <thead><tr><th>Semaine</th><th>Période</th><th>Grade</th>
          <th class="num">Production</th><th class="num">Quota</th><th class="num">Atteint</th></tr></thead>
        <tbody>${semaines.map(({ w, p }) => {
          const q = Number(p.quota) || 0;
          const b = Number(p.barils) || 0;
          const pc = q > 0 ? Math.round(b / q * 100) : 0;
          return `<tr>
            <td><b>${esc(w.label)}</b></td>
            <td class="mono dim">${esc(w.du)} → ${esc(w.au)}</td>
            <td class="dim">${esc(p.grade || '—')}</td>
            <td class="num">${b.toLocaleString('fr-FR')}</td>
            <td class="num dim">${q.toLocaleString('fr-FR')}</td>
            <td class="num" style="color:${pc >= 100 ? 'var(--vine,#6E8B5D)' : 'var(--muted)'};">${pc} %</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`
      : `<p class="empty-note" style="margin-top:10px;">Aucune semaine clôturée pour l'instant.
           Votre historique de production apparaîtra ici après la première clôture du lundi.</p>`);
  }

  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'prodEmployeeSelect') renderMaSemaine(e.target.value);
  });

  window.renderMaSemaine = renderMaSemaine;

/* ==========================================================================
   PRISE DE SERVICE — réservée aux postes qui pointent
   --------------------------------------------------------------------------
   Un saisonnier, un ouvrier viticole, un chef de culture ne pointent pas : leur
   semaine se mesure en vins, pas en heures — c'est le quota qui les juge.
   Le pointage concerne la vente, le commerce, le magasin, les RH et la
   direction, dont le travail ne se compte pas en production.
   ========================================================================== */

  const POSTES_SERVICE = [
    /* vente */
    'Vendeur', 'Vendeuse',
    /* commerce */
    'Commercial', 'Resp. Commercial', 'Responsable Commercial',
    /* magasin */
    'Assistant(e) magasin', 'Assistant magasin', 'Assistante magasin',
    'Resp. Magasin', 'Responsable Magasin',
    /* ressources humaines */
    'RH', 'DRH', 'Resp. RH', 'Responsable RH',
    /* la direction pointe aussi — et le patron passe de toute façon */
    'Responsable Général', 'Resp. Général', 'Patron', 'Co-Patron',
  ];

  /* Comparaison indulgente : « Resp. Magasin », « resp magasin » et
     « Responsable magasin » doivent tomber sur la même case. */
  const clefPoste = t => String(t || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^resp(onsable)?\b\.?/, 'resp')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  const SERVICE_OK = POSTES_SERVICE.map(clefPoste);

  /* ==========================================================================
     Consulter la fiche de quelqu'un d'autre
     --------------------------------------------------------------------------
     Deux questions distinctes, et les confondre serait une erreur :

       QUI peut se servir du sélecteur — la direction et les ressources
       humaines. Regarder les chiffres d'un collègue n'est pas un droit de
       curiosité, c'est un droit d'encadrement.

       QUI peut être regardé — l'équipe concernée, plus tout ce qui est au-dessus
       du Vendeur. Sans ce second point, un DRH pouvait ouvrir le menu et n'y
       trouver que des vendeurs : les responsables eux-mêmes en étaient absents.

     Les noms sont écrits dans les deux orthographes du domaine, celle des
     rôles Discord (« Ressource Humaine ») et celle des postes du registre
     (« RH ») : clefPoste rapproche les variantes de casse et de ponctuation,
     pas deux mots différents.
     ========================================================================== */
  const POSTES_VOIR_AUTRUI = [
    'Patron', 'Co-Patron', 'Co Patron',
    'Responsable Général', 'Resp. Général',
    'DRH', 'Resp. RH', 'Responsable RH',
    'RH', 'Ressource Humaine', 'Ressources Humaines', 'Ressource humaines',
  ].map(clefPoste);

  /* « Au-dessus du Vendeur » : la direction et les responsables. */
  const POSTES_ENCADREMENT = [
    'Patron', 'Co-Patron', 'Co Patron',
    'Responsable Général', 'Resp. Général',
    'DRH', 'Resp. RH', 'Responsable RH',
    'Resp. Commercial', 'Responsable Commercial',
    'Resp. Magasin', 'Responsable Magasin',
    'Resp. Runner', 'Responsable Runner',
  ].map(clefPoste);

  const estEncadrement = poste => POSTES_ENCADREMENT.includes(clefPoste(poste));

  /* Le droit est cherché à deux endroits, et il suffit qu'un des deux réponde :
     le rôle Discord de la session, et le poste inscrit au registre RH. Quelqu'un
     dont le rôle Discord n'a pas encore été posé mais qui est DRH au registre
     ne doit pas se retrouver enfermé pour autant. */
  function peutVoirAutrui(postesEnPlus) {
    const s = window.MarloweSession;
    if (!s) return true;                        /* hors connexion : on n'entrave rien */
    if (s.isPatron || s.isOwner) return true;
    const admis = POSTES_VOIR_AUTRUI.concat(postesEnPlus || []);
    if ((s.roles || []).some(r => admis.includes(clefPoste(r)))) return true;
    const f = ficheDeSession();
    return !!(f && admis.includes(clefPoste(f.poste)));
  }

  function peutPointer() {
    const s = window.MarloweSession;
    if (!s) return true;                       /* hors connexion : on n'entrave rien */
    if (s.isPatron || s.isOwner) return true;  /* la direction voit tout */

    if ((s.roles || []).some(r => SERVICE_OK.includes(clefPoste(r)))) return true;

    const moi = clefPoste(s.name);
    const fiche = (typeof rhRosterData !== 'undefined' ? rhRosterData : [])
      .find(e => clefPoste(e.name) === moi);
    return !!(fiche && SERVICE_OK.includes(clefPoste(fiche.poste)));
  }

  function appliquerAccesService() {
    const panel = $('servicePanel');
    if (!panel) return;
    const ok = peutPointer();
    panel.hidden = !ok;
    panel.style.display = ok ? '' : 'none';

    /* La remise à zéro est réservée au patron : un employé pourrait sinon
       effacer ses heures juste avant la clôture, qui est précisément ce qui
       les compte. La clôture du lundi, elle, remet le compteur à zéro toute
       seule — ce bouton ne sert qu'aux corrections en cours de semaine. */
    const btn = $('serviceReset');
    if (btn) {
      const s = window.MarloweSession;
      btn.hidden = !!(s && !s.isPatron && !s.isOwner);
    }
  }

  async function reinitialiserService() {
    const n = (typeof serviceHistory !== 'undefined' ? serviceHistory : []).length;
    if (!n) { toast('Aucun pointage à effacer.'); return; }

    const ok = await confirmAction('Remettre les heures à zéro',
      `${n} pointage${n > 1 ? 's' : ''} de la semaine ${n > 1 ? 'seront effacés' : 'sera effacé'}, `
      + `y compris un service en cours. Le total repart de 0h00.\n\n`
      + `La clôture du lundi fait déjà cette remise à zéro : ce bouton n'est là que `
      + `pour corriger une semaine en cours. L'opération ne s'annule pas.`, 'Remettre à zéro');
    if (!ok) return;

    serviceHistory.length = 0;
    serviceActive = false;
    resetServiceButton();
    D().note('a remis les heures de service à zéro');
    D().save('serviceHistory');
    toast('Heures de service remises à zéro.');
  }

/* ==========================================================================
   AVERTISSEMENTS RH
   ========================================================================== */

  const avertissements = [];
  const NIVEAUX = ['Rappel à l\'ordre', 'Avertissement', 'Dernier avertissement'];

  /* Un sceau discret à côté du nom dans le registre : on doit voir qu'une
     personne a un dossier sans avoir à descendre jusqu'au tableau. */
  function compteAvertissements(nom) {
    const n = avertissements.filter(a => a.nom === nom).length;
    if (!n) return '';
    const dur = avertissements.some(a => a.nom === nom && a.niveau === NIVEAUX[2]);
    return ` <span class="av-seal${dur ? ' fort' : ''}" title="${n} avertissement${n > 1 ? 's' : ''}">⚠ ${n}</span>`;
  }

  function renderAvertissements() {
    const body = $('avertBody');
    if (!body) return;

    const cpt = $('avertCount');
    if (cpt) cpt.textContent = avertissements.length
      ? `· ${avertissements.length} au dossier` : '';

    body.innerHTML = avertissements.length
      ? avertissements.map((a, i) => `
        <tr>
          <td class="mono">${esc(a.date)}</td>
          <td><b>${esc(a.nom)}</b></td>
          <td><span class="av-pill av-${a.niveau === NIVEAUX[2] ? 'fort' : a.niveau === NIVEAUX[1] ? 'moyen' : 'doux'}">${esc(a.niveau)}</span></td>
          <td>${esc(a.motif)}</td>
          <td class="dim">${esc(a.par || '—')}</td>
          <td style="text-align:right;"><button class="icon-btn danger" data-av-del="${i}" title="Retirer">×</button></td>
        </tr>`).join('')
      : `<tr><td colspan="6" class="empty-note" style="text-align:center;padding:18px;">Aucun avertissement au dossier.</td></tr>`;
  }

  async function donnerAvertissement() {
    const noms = (typeof rhRosterData !== 'undefined' ? rhRosterData : [])
      .map(e => e.name).sort(parNom);
    if (!noms.length) { toast("Le registre est vide — enregistrez d'abord un employé."); return; }

    const r = await askForm('Donner un avertissement', [
      { key: 'nom',    label: 'Employé', value: noms[0], options: noms },
      { key: 'niveau', label: 'Niveau', value: NIVEAUX[1], options: NIVEAUX },
      { key: 'motif',  label: 'Motif', value: '' },
      { key: 'date',   label: 'Date', value: todayFR() },
    ], "L'avertissement reste au dossier de l'employé et apparaît à côté de son nom dans le registre.");
    if (!r) return;
    if (!r.motif.trim()) { toast('Un avertissement sans motif ne sert à rien.'); return; }

    /* Le formulaire manuel passe par le MÊME chemin que le bouton ⚠ : un
       avertissement notifie la personne, quelle que soit la porte par laquelle
       il a été donné. Deux chemins d'enregistrement, c'était la garantie qu'un
       des deux oublierait de prévenir. */
    await enregistrerAvertissement({ nom: r.nom, niveau: r.niveau, motif: r.motif, date: r.date });
  }

  function retirerAvertissement(i) {
    const a = avertissements[i];
    if (!a) return;
    avertissements.splice(i, 1);
    D().note(`a retiré un avertissement de ${a.nom}`);
    D().saveMany(['avertissements', 'rhRoster']);
    toast('Avertissement retiré.');
  }

  document.addEventListener('click', e => {
    if (e.target.closest('#avertAddBtn')) { donnerAvertissement(); return; }
    const d = e.target.closest('[data-av-del]');
    if (d) retirerAvertissement(+d.dataset.avDel);
  });

  window.MarloweAvertissements = avertissements;


/* ==========================================================================
   RÈGLES DU DOMAINE — quota de service et prime de recrutement
   --------------------------------------------------------------------------
   Deux règles que le patron fixe une fois et qui s'appliquent ensuite toutes
   seules. Elles vivent ensemble : ce sont des réglages, pas des données de
   semaine, et elles survivent donc aux clôtures.
   ========================================================================== */

  const reglages = {
    quotaServiceH: 0,       /* heures de service attendues par semaine, 0 = pas de quota */
    primeRecrutMontant: 0,  /* prime de BIENVENUE, versée à une recrue de fin de semaine */
    primeRecrutQuota: 0,    /* vins minimum pour y avoir droit */
    primeParRecrutement: undefined, /* prime versée au RECRUTEUR, par personne amenée */
    rappelPermis: '',       /* texte par défaut du rappel de permis, vide = celui du serveur */
    quotas: {},             /* quota MINIMUM de vins par grade ; 0 = aucun quota exigé */
    salaires: {},           /* salaire fixe par grade, en dollars ; absent ou 0 = pas de salaire */
    multiplicateurs: {},    /* multiplicateur de prime par grade ; vide = le barème d'origine */
  };

  /* Le MULTIPLICATEUR de prime, par grade.
     -------------------------------------------------------------------------
     Il vivait en dur dans la page : « Saisonnier 1, Ouvrier 2, Chef 3 ». Un
     barème qui change au fil des saisons n'a rien à faire dans le code — il
     se règle maintenant dans Paramètres ▸ Règles du domaine.

     Le barème d'origine reste le point de départ : tant que personne n'a
     touché au réglage, rien ne bouge. Un grade absent du réglage retombe
     dessus, et un grade inconnu vaut 1 — jamais 0, sinon une faute de frappe
     dans un nom de grade supprimerait la prime de quelqu'un en silence. */
  const MULT_DEFAUT = { 'Saisonnier': 1, 'Ouvrier Viticole': 2, 'Chef de Culture': 3 };

  /* Tous les postes du domaine, dans le même ordre que la grille des salaires
     juste au-dessus — direction, responsables, pôles, production. Le barème
     d'origine ne nommait que les trois grades de production : la direction
     n'avait donc aucun champ, et son multiplicateur restait figé à 1 sans
     qu'on puisse y toucher. Un poste absent du barème vaut 1 par défaut, ce
     qui ne change rien tant qu'on ne lui donne rien d'autre. */
  const GRADES_PRIME = POSTES_CANON;

  function multiplicateurDuGrade(grade) {
    const g = String(grade || '').trim();
    const table = (reglages && reglages.multiplicateurs) || {};
    const dans = (t) => {
      if (t[g] !== undefined) return t[g];
      /* Le registre écrit « Chef de culture », la tablette « Chef de Culture ».
         On ne va pas faire dépendre une prime d'une majuscule. */
      const k = Object.keys(t).find(x => x.toLowerCase() === g.toLowerCase());
      return k ? t[k] : undefined;
    };
    const v = dans(table);
    if (v !== undefined && Number(v) > 0) return Number(v);
    const d = dans(MULT_DEFAUT);
    return d !== undefined ? Number(d) : 1;
  }

  /* La page de gestion s'en sert aussi : elle vit hors de cette portée. */
  window.mvMultGrade = multiplicateurDuGrade;

  /* Qui a droit à la colonne haute du barème. La page Primes ne peut pas lire
     bcRangsPatron directement : elle s'exécute AVANT sa déclaration dans
     gestion.html, et un const pas encore initialisé fait tout tomber — même
     interrogé par typeof. Elle passe donc par ici. */
  window.mvRangPatron = rang => RANGS_PATRON().includes(rang);

  /* Le SALAIRE d'un grade — à ne pas confondre avec la prime.
     -------------------------------------------------------------------------
     Le salaire est fixe : il est dû parce qu'on occupe le poste, que le quota
     soit atteint ou non. La prime est variable : elle se gagne, elle dépend
     des vins vendus et du multiplicateur, et elle vaut zéro quand le quota
     n'est pas fait. Les deux ne se mélangent jamais — ni dans les colonnes,
     ni dans les totaux, ni dans le plafond du palier.

     Il vivait jusqu'ici en dur à deux endroits qui ne disaient pas la même
     chose : une liste de deux personnes nommées sur la page Primes, et un
     barème par grade dans le Bilan. Une seule source désormais. */
  function salaireDuGrade(grade) {
    const table = (reglages && reglages.salaires) || {};
    const g = String(grade || '').trim();
    if (table[g] !== undefined) return Number(table[g]) || 0;
    /* Le registre écrit « Chef de culture », la tablette « Chef de Culture ».
       On ne va pas faire dépendre une paie d'une majuscule. */
    const clef = Object.keys(table).find(k => k.toLowerCase() === g.toLowerCase());
    return clef ? (Number(table[clef]) || 0) : 0;
  }
  window.mvSalaireGrade = salaireDuGrade;

  const h2m = h => Math.round((Number(h) || 0) * 60);
  const m2h = m => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;

  /* Minutes de service faites cette semaine, depuis les pointages de
     « Ma semaine ». Un service en cours ne compte pas : il n'est pas fini. */
  function minutesServiceSemaine() {
    if (typeof serviceHistory === 'undefined') return 0;
    return serviceHistory
      .filter(s => s && s.end)
      .reduce((t, s) => t + (typeof durationMinutes === 'function' ? durationMinutes(s.start, s.end) : 0), 0);
  }

  function renderQuotaService() {
    const panel = $('servicePanel');
    if (!panel) return;

    let box = $('mvQuotaService');
    const attendu = h2m(reglages.quotaServiceH);

    if (!attendu) { if (box) box.remove(); return; }

    if (!box) {
      box = document.createElement('div');
      box.id = 'mvQuotaService';
      box.className = 'mv-qs';
      panel.appendChild(box);
    }

    const fait = minutesServiceSemaine();
    const pct = Math.min(100, Math.round(fait / attendu * 100));
    const ok = fait >= attendu;

    box.innerHTML = `
      <div class="mv-qs-top">
        <span class="mv-qs-l">Quota de service</span>
        <span class="mv-qs-v ${ok ? 'ok' : ''}">${m2h(fait)} / ${m2h(attendu)}</span>
      </div>
      <div class="mv-qs-bar"><i style="width:${pct}%" class="${ok ? 'ok' : ''}"></i></div>
      <p class="mv-qs-note">${ok
        ? 'Quota atteint pour cette semaine.'
        : `Il reste ${m2h(attendu - fait)} de service à faire d'ici la clôture.`}</p>`;
  }

  /* --- Prime de recrutement -------------------------------------------------
     Elle récompense les arrivées de fin de semaine : quelqu'un recruté le
     jeudi n'a que quatre jours pour produire, il serait injuste de le juger
     sur la même barre qu'un employé présent depuis lundi. */
  function recruesEligibles() {
    if (typeof rhRosterData === 'undefined' || !reglages.primeRecrutMontant) return [];
    if (typeof mondayOf !== 'function') return [];

    const lundi = mondayOf(new Date());
    const jeudi = new Date(lundi); jeudi.setDate(jeudi.getDate() + 3);
    const lundiSuivant = new Date(lundi); lundiSuivant.setDate(lundiSuivant.getDate() + 7);
    jeudi.setHours(0, 0, 0, 0);

    const effectif = (typeof effectifData !== 'undefined') ? effectifData : [];
    const seuil = Number(reglages.primeRecrutQuota) || 0;

    return rhRosterData.map(e => {
      const d = parseFR(e.date);
      if (!d || d < jeudi || d >= lundiSuivant) return null;

      const fiche = effectif.find(x => x.name === e.name);
      const produit = fiche ? (fiche.barils || 0) : 0;
      return { nom: e.name, poste: e.poste, arrivee: e.date, produit, atteint: produit >= seuil };
    }).filter(Boolean);
  }

  function totalPrimeRecrutement() {
    return recruesEligibles().filter(r => r.atteint).length * (Number(reglages.primeRecrutMontant) || 0);
  }

  /* Le tableau des recrues s'intercale entre l'en-tête et les primes de la
     semaine, qui sont la raison d'être de la page. Il se replie donc, et reste
     replié tant qu'on ne l'a pas ouvert (préférence gardée par navigateur). */
  let primeRecrutOuvert = (() => {
    try { return localStorage.getItem('mv.primeRecrut') === 'ouvert'; } catch (e) { return false; }
  })();

  document.addEventListener('click', e => {
    if (!e.target.closest('#mvPrimeRecrutToggle')) return;
    primeRecrutOuvert = !primeRecrutOuvert;
    try { localStorage.setItem('mv.primeRecrut', primeRecrutOuvert ? 'ouvert' : 'replie'); } catch (err) {}
    renderPrimeRecrutement();
  });

  function renderPrimeRecrutement() {
    const head = document.querySelector('#page-statsprimes .primes-head');
    if (!head) return;

    let box = $('mvPrimeRecrut');
    if (!box) {
      box = document.createElement('div');
      box.id = 'mvPrimeRecrut';
      box.className = 'panel';
      box.style.marginTop = '18px';
      head.parentNode.insertBefore(box, head.nextSibling);
    }

    const recrues = recruesEligibles();
    if (!reglages.primeRecrutMontant || !recrues.length) { box.style.display = 'none'; return; }
    box.style.display = '';

    const montant = Number(reglages.primeRecrutMontant) || 0;
    const seuil = Number(reglages.primeRecrutQuota) || 0;
    const gagnants = recrues.filter(r => r.atteint).length;

    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <h3 style="margin:0;flex-grow:1;">Prime de recrutement
          <span class="mv-unit">${gagnants} sur ${recrues.length} · ${(gagnants * montant).toLocaleString('fr-FR')} $</span></h3>
        <button class="btn" id="mvPrimeRecrutToggle" style="padding:8px 14px;font-size:11.5px;"
          aria-expanded="${primeRecrutOuvert}" aria-controls="mvPrimeRecrutCorps">${
          primeRecrutOuvert ? '▾ Réduire le tableau' : `▸ Afficher les ${recrues.length} recrue${recrues.length > 1 ? 's' : ''}`}</button>
      </div>
      <div id="mvPrimeRecrutCorps"${primeRecrutOuvert ? '' : ' style="display:none;"'}>
      <p class="mv-sub" style="margin:12px 0 14px;font-size:12.5px;color:var(--muted);">Arrivées entre jeudi et dimanche de la semaine en cours.
        ${seuil ? `Il faut ${seuil.toLocaleString('fr-FR')} vins pour y avoir droit.` : 'Aucun quota exigé.'}</p>
      <table class="gtable">
        <thead><tr><th>Employé</th><th>Poste</th><th>Arrivée</th><th class="num">Production</th><th class="num">Prime</th></tr></thead>
        <tbody>${recrues.map(r => `
          <tr>
            <td><b>${esc(r.nom)}</b></td>
            <td class="dim">${esc(r.poste || '—')}</td>
            <td class="mono">${esc(r.arrivee)}</td>
            <td class="num${r.atteint ? '' : ' dim'}">${r.produit.toLocaleString('fr-FR')}</td>
            <td class="num">${r.atteint
              ? `<b style="color:var(--prime,#D4763D);">${montant.toLocaleString('fr-FR')} $</b>`
              : `<span class="dim">pas encore</span>`}</td>
          </tr>`).join('')}</tbody>
      </table>
      </div>`;
  }

  /* --- Le panneau de réglage, dans Paramètres --- */
  function renderReglages() {
    const box = $('mvReglages');
    if (!box) return;

    /* Le titre et le rappel de la règle sont désormais portés par la page
       « Règles du domaine » elle-même : les répéter ici ferait doublon. */
    box.innerHTML = `
      <div class="mv-vit-sec" style="border-top:none;padding-top:0;">
        <h4>Quota de prise de service</h4>
        <p class="mv-hint" style="margin:0 0 12px;">Pour les postes qui pointent — boutique et commerce —
          et qui ne sont donc pas jugés sur les vins produits. Le compte se fait à partir des
          prises de service enregistrées dans « Ma semaine ». Laissez à 0 pour n'imposer aucun quota.</p>
        <div class="mv-vit-champs">
          <label class="mv-lab">Heures par semaine
            <input type="number" id="mvRegQuotaS" min="0" max="60" step="0.5" value="${reglages.quotaServiceH}">
          </label>
        </div>
      </div>

      <div class="mv-vit-sec">
        <h4>Prime de bienvenue — versée à la recrue</h4>
        <p class="mv-hint" style="margin:0 0 12px;">Versée aux employés arrivés <b>entre le jeudi et le dimanche</b>
          de la semaine en cours, à condition d'avoir atteint le nombre de vins indiqué. Ils n'ont que
          quelques jours pour produire : c'est la raison d'être de cette barre plus basse. Montant à 0 = prime désactivée.</p>
        <div class="mv-vit-champs">
          <label class="mv-lab">Montant de la prime ($)
            <input type="number" id="mvRegPrime" min="0" step="500" value="${reglages.primeRecrutMontant}">
          </label>
          <label class="mv-lab">Vins minimum
            <input type="number" id="mvRegSeuil" min="0" step="100" value="${reglages.primeRecrutQuota}">
          </label>
        </div>
      </div>

      <div class="mv-vit-sec">
        <h4>Prime de recrutement — versée au recruteur</h4>
        <p class="mv-hint" style="margin:0 0 12px;">Ce que touche <b>celui qui recrute</b>, pour chaque personne
          arrivée dans la semaine en cours et dont il est inscrit comme recruteur sur la fiche. C'est le chiffre
          de la colonne <b>RECRUES</b> de la page Primes. À ne pas confondre avec la prime de bienvenue
          ci-dessus, qui va à celui qui arrive. <b>0</b> = plus de prime au recruteur.</p>
        <div class="mv-vit-champs">
          <label class="mv-lab">Montant par recrue ($)
            <input type="number" id="mvRegPrimeRec" min="0" step="500" value="${primeParRecrutement()}">
          </label>
        </div>
      </div>

      <div class="mv-vit-sec">
        <h4>Salaires par grade</h4>
        <p class="mv-hint" style="margin:0 0 12px;">Le salaire est <b>fixe</b> : il est dû parce qu'on occupe le
          poste, que le quota soit atteint ou non. Il ne se mélange jamais avec la prime, qui elle se gagne
          sur les vins vendus. Un grade laissé à 0 n'est simplement pas salarié.</p>
        <div class="mv-sal-grille">
          ${POSTES_CANON.map(g => `
            <label class="mv-lab mv-sal-l">${esc(g)}
              <input type="number" min="0" step="500" data-salaire="${esc(g)}"
                value="${Number((reglages.salaires || {})[g]) || 0}">
            </label>`).join('')}
        </div>
      </div>

      <div class="mv-vit-sec">
        <h4>Quota minimum par grade</h4>
        <p class="mv-hint" style="margin:0 0 12px;">Le nombre de vins à produire dans la semaine pour
          avoir droit à une prime. En dessous, la prime vaut <b>zéro</b> ; au-delà, toute la production
          compte. C'est un <b>minimum exigé</b>, pas un maximum servi. Le barème d'origine est
          3 000 · 5 000 · 8 000 pour les trois grades de production ; un grade à <b>0</b> n'a
          simplement aucun quota — c'est le cas de la direction et des responsables, qui ne sont
          pas jugés sur les vins.</p>
        <p class="mv-hint" style="margin:0 0 12px;">Le palier de <b>promotion</b> suit : on passe
          au grade supérieur en dépassant le quota de ce grade-là. Un quota saisi à la main sur une
          fiche d'effectif l'emporte toujours et n'est pas touché par ce réglage.</p>
        <div class="mv-sal-grille">
          ${GRADES_PRIME.map(g => `
            <label class="mv-lab mv-sal-l">${esc(g)}
              <input type="number" min="0" step="500" data-quota="${esc(g)}"
                value="${quotaDuGrade(g)}">
            </label>`).join('')}
        </div>
      </div>

      <div class="mv-vit-sec">
        <h4>Multiplicateur de prime par grade</h4>
        <p class="mv-hint" style="margin:0 0 12px;">La prime se calcule <b>vins × multiplicateur</b>, puis
          se plafonne au palier du bilan. C'est ce qui récompense la montée en grade : à production égale,
          un chef de culture touche davantage qu'un saisonnier. Le barème de production est
          1 · 2 · 3 ; <b>tous les autres postes valent 1</b> tant qu'on ne leur donne rien d'autre.
          Une valeur laissée à 0 ou vide reprend ce barème — pour retirer une prime, c'est le quota
          qu'on relève, pas le multiplicateur qu'on annule.</p>
        <div class="mv-sal-grille">
          ${GRADES_PRIME.map(g => `
            <label class="mv-lab mv-sal-l">${esc(g)}
              <input type="number" min="0" max="99" step="1" data-mult="${esc(g)}"
                value="${multiplicateurDuGrade(g)}">
            </label>`).join('')}
        </div>
      </div>

      <div class="mv-vit-sec">
        <h4>Rappel de permis</h4>
        <p class="mv-hint" style="margin:0 0 12px;">Le texte proposé par défaut quand un RH clique sur
          « ✉ Rappel » dans le registre. Il reste modifiable au cas par cas avant chaque envoi.
          Laissé vide, c'est le texte du serveur qui sert.</p>
        <label class="mv-lab" style="display:block;">Message par défaut
          <textarea id="mvRegRappel" class="mv-rap-txt" rows="3"
            placeholder="Bonjour, ton permis n'est toujours pas enregistré au domaine…">${esc(reglages.rappelPermis || '')}</textarea>
        </label>
      </div>

      <div class="mv-vit-sec">
        <h4>Liaison Discord</h4>
        <p class="mv-hint" style="margin:0 0 12px;">Vérifie que le bouton « Demander un retrait » du Com Runner
          arrive bien dans le salon. Envoie un message de test et dit précisément ce qui coince, le cas échéant.</p>
        <button class="btn" id="mvTestDiscord">Tester le lien Discord</button>
      </div>

      <div class="btn-row" style="margin-top:6px;align-items:center;">
        <button class="btn primary" id="mvRegSave">Enregistrer les règles</button>
        <span class="mv-saved" id="mvRegSaved">Enregistré ✓</span>
      </div>`;
  }

  document.addEventListener('click', e => {
    if (e.target.closest('#serviceReset')) { reinitialiserService(); return; }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#mvRegSave')) return;
    const n = id => { const el = $(id); return el ? Math.max(0, Number(el.value) || 0) : 0; };
    reglages.quotaServiceH      = n('mvRegQuotaS');
    reglages.primeRecrutMontant = Math.round(n('mvRegPrime'));
    reglages.primeRecrutQuota   = Math.round(n('mvRegSeuil'));
    /* Toujours stocké, zéro compris : ici le zéro veut dire « plus de prime
       au recruteur », et non « je n'y touche pas ». */
    reglages.primeParRecrutement = Math.round(n('mvRegPrimeRec'));
    const rap = $('mvRegRappel');
    if (rap) reglages.rappelPermis = rap.value.trim().slice(0, 1500);
    const sal = {};
    document.querySelectorAll('[data-salaire]').forEach(el => {
      const v = Math.max(0, Math.round(Number(el.value) || 0));
      if (v) sal[el.dataset.salaire] = v;      /* on ne stocke pas les zéros */
    });
    reglages.salaires = sal;

    /* Les quotas, et la mise à jour des fiches qui suivaient l'ancien barème.
       -------------------------------------------------------------------------
       Une fiche d'effectif porte SA propre valeur de quota — c'est elle qui
       fait foi, et elle peut avoir été saisie à la main pour quelqu'un en
       particulier. On ne remplace donc QUE les fiches dont le quota vaut
       encore, au vin près, l'ancien quota de leur grade : celles-là suivaient
       le barème sans le savoir. Une valeur saisie à la main reste en place. */
    const avant = {};
    GRADES_PRIME.forEach(g => { avant[g] = quotaDuGrade(g); });

    const quotas = {};
    document.querySelectorAll('[data-quota]').forEach(el => {
      /* Ici le zéro EST une valeur : « ce grade n'a pas de quota ». On stocke
         donc tout, y compris les zéros, sinon un grade ne pourrait jamais
         être libéré de son quota d'origine. */
      quotas[el.dataset.quota] = Math.max(0, Math.round(Number(el.value) || 0));
    });
    reglages.quotas = quotas;

    let fichesTouchees = 0;
    if (typeof effectifData !== 'undefined' && Array.isArray(effectifData)) {
      effectifData.forEach(f => {
        const ancien = avant[f.grade];
        const nouveau = quotaDuGrade(f.grade);
        if (ancien !== undefined && Number(f.quota) === ancien && nouveau !== ancien) {
          f.quota = nouveau;
          fichesTouchees++;
        }
        /* Le palier de promotion est le quota du grade suivant : il suit sans
           qu'on ait à le régler, et sans condition — il n'est jamais saisi à
           la main. */
        if (f.nextGrade) f.promoTarget = quotaDuGrade(f.nextGrade);
      });
    }
    const mults = {};
    document.querySelectorAll('[data-mult]').forEach(el => {
      const v = Math.max(0, Math.round(Number(el.value) || 0));
      /* Un champ vide ou à zéro n'est pas un multiplicateur de zéro : c'est
         « je n'y touche pas ». On ne le stocke donc pas, et le barème
         d'origine reprend la main. */
      if (v > 0) mults[el.dataset.mult] = v;
    });
    reglages.multiplicateurs = mults;
    D().note('a modifié les règles du domaine');
    D().save('reglages');
    if (fichesTouchees) D().save('effectif');
    /* Le multiplicateur et les salaires entrent dans des chiffres déjà
       affichés ailleurs. Sans ce rafraîchissement, la page Primes et le bilan
       montreraient l'ancien barème jusqu'au prochain rechargement — et on
       croirait que le réglage n'a pas pris. */
    if (typeof window.mvRenderPrimes === 'function') window.mvRenderPrimes();
    if (typeof renderBilan === 'function') renderBilan();
    remplirCartesGrades();
    if (typeof renderQuotaDirect === 'function' && $('qdBody')) renderQuotaDirect();
    const ok = $('mvRegSaved');
    if (ok) { ok.classList.add('on'); setTimeout(() => ok.classList.remove('on'), 1800); }
    toast(fichesTouchees
      ? `Règles enregistrées · ${fichesTouchees} fiche(s) d'effectif alignée(s) sur le nouveau quota.`
      : 'Règles enregistrées.');
  });

  /* ==========================================================================
     LA LISTE DE PAIE — prénom et montant, rien d'autre
     --------------------------------------------------------------------------
     Le « Copier pour le tableur » du bilan sort huit colonnes : parfait pour
     un tableur, inutilisable pour payer les gens un par un. Ici on ne veut que
     deux choses, prêtes à coller.

     Le prénom seul a un défaut qu'il faut regarder en face : deux personnes
     peuvent porter le même. Payer « Nella » quand il y a deux Nella, c'est se
     tromper de personne sans jamais le savoir. Alors le prénom reste le format
     par défaut, comme demandé, MAIS un prénom partagé reçoit son nom de
     famille — sur cette ligne-là seulement — et le panel le dit.
     ========================================================================== */
  function lignesDePaie() {
    /* On lit les lignes de la page Primes elle-même. Refaire le calcul ici
       donnerait un deuxième chiffre pour la même paie — c'est exactement le
       défaut qui séparait déjà cette page et le bilan. Une seule source. */
    const rows = (typeof window.mvPrimesRows === 'function') ? window.mvPrimesRows() : [];

    const gens = rows.map(r => {
      const nom = String(r.name || '').trim();
      return {
        nom,
        prenom: nom.split(/\s+/)[0] || nom,
        total: Math.round(Number(r.total) || 0),
      };
    }).filter(x => x.nom);

    /* Un prénom porté par deux personnes n'identifie personne. */
    const compte = {};
    gens.forEach(g => { const k = g.prenom.toLowerCase(); compte[k] = (compte[k] || 0) + 1; });
    gens.forEach(g => {
      g.partage = compte[g.prenom.toLowerCase()] > 1;
      g.etiquette = g.partage ? g.nom : g.prenom;
    });

    gens.sort((a, b) => a.etiquette.localeCompare(b.etiquette, 'fr', { sensitivity: 'base' }));
    return gens;
  }

  /* Copier sans rien annoncer.
     -------------------------------------------------------------------------
     copyToClipboard() affiche un bandeau à chaque appel : parfait pour une
     copie unique, insupportable ici où l'on clique deux fois par personne et
     quarante fois de suite. La confirmation se fait sur le bouton lui-même. */
  async function copierMuet(texte) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texte);
        return true;
      }
    } catch (e) { /* on tente la suite */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = texte;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  async function listeDePaie() {
    const tous = lignesDePaie();
    const payes = tous.filter(g => g.total > 0);
    if (!payes.length) {
      toast(tous.length ? 'Personne n\'a de montant à percevoir cette semaine.'
                        : 'Le tableau de bord est vide : collez la tablette d\'abord.');
      return;
    }

    const partages = payes.filter(g => g.partage);
    const zero = tous.length - payes.length;

    const avert = partages.length
      ? `<p class="mv-hint" style="margin:0 0 8px;color:var(--amber,#D6A75C);">
           ${partages.length} prénom(s) porté(s) par plusieurs personnes : ces lignes-là
           portent le nom complet, sinon on ne saurait pas qui payer.</p>` : '';
    const rien = zero
      ? `<p class="mv-hint" style="margin:0 0 8px;">${zero} personne(s) à 0 $ ne sont pas
           dans la liste.</p>` : '';

    /* Une ligne par personne, deux boutons : le nom, le montant. On paie dans
       un formulaire à deux champs — il faut donc pouvoir prendre l'un puis
       l'autre, pas un bloc de texte à découper à la main. */
    const lignes = payes.map((g, i) => `
      <div class="mvp-l" data-i="${i}">
        <button type="button" class="mvp-c mvp-nom" data-copie="nom" data-i="${i}"
          title="Copier le nom">${esc(g.etiquette)}</button>
        <button type="button" class="mvp-c mvp-sou" data-copie="montant" data-i="${i}"
          title="Copier le montant">${g.total.toLocaleString('fr-FR')} $</button>
        <button type="button" class="mvp-f" data-fait="${i}" title="Marquer comme versée">✓</button>
      </div>`).join('');

    const html = `
      <style>
        .mvp-liste{display:flex;flex-direction:column;gap:6px;}
        .mvp-l{display:flex;gap:8px;align-items:center;}
        .mvp-l.fait{opacity:.42;}
        .mvp-c{flex:1 1 auto;min-width:0;text-align:left;cursor:pointer;font:inherit;
          background:rgba(0,0,0,.25);border:1px solid var(--band,#3D372C);border-radius:9px;
          padding:9px 12px;color:var(--parchment,#EDE3CF);font-size:13.5px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:.12s;}
        .mvp-c:hover{border-color:var(--or-soft,#8E7C4E);}
        .mvp-c.ok{border-color:var(--vine,#6E8B5D);color:var(--vine,#6E8B5D);}
        .mvp-sou{flex:0 0 34%;text-align:right;font-family:ui-monospace,Menlo,Consolas,monospace;
          color:var(--or,#C9A961);}
        .mvp-f{flex:0 0 auto;cursor:pointer;font:inherit;font-size:13px;
          background:transparent;border:1px solid var(--band,#3D372C);border-radius:9px;
          padding:9px 11px;color:var(--muted,#9C9384);}
        .mvp-l.fait .mvp-f{color:var(--vine,#6E8B5D);border-color:var(--vine,#6E8B5D);}
      </style>
      ${avert}${rien}
      <p class="mv-hint" style="margin:0 0 10px;">Cliquez le nom pour le copier, puis le montant.
        La ligne se marque toute seule une fois les deux pris — de quoi ne pas perdre sa place
        au bout de trente versements. Le ✓ la marque ou la démarque à la main.</p>
      <div class="mvp-liste">${lignes}</div>
      <p class="mv-hint" id="mvPaieCpt" style="margin:10px 0 0;"></p>`;

    await askHtml('Liste de paie', html,
      `${payes.length} personne(s) à payer, ${payes.reduce((s, g) => s + g.total, 0).toLocaleString('fr-FR')} $ au total.`,
      (d) => {
        const pris = payes.map(() => ({ nom: false, montant: false }));
        const cpt = d.querySelector('#mvPaieCpt');

        const majCpt = () => {
          const n = d.querySelectorAll('.mvp-l.fait').length;
          cpt.textContent = `${n} versée(s) sur ${payes.length}.`;
        };

        const ligne = i => d.querySelector(`.mvp-l[data-i="${i}"]`);

        d.querySelectorAll('.mvp-c').forEach(btn => {
          btn.addEventListener('click', async () => {
            const i = Number(btn.dataset.i);
            const quoi = btn.dataset.copie;
            const texte = quoi === 'nom' ? payes[i].etiquette : String(payes[i].total);
            const ok = await copierMuet(texte);
            if (!ok) { toast('Le navigateur a refusé la copie.'); return; }

            /* La confirmation vit sur le bouton, une seconde. Un bandeau à
               chaque clic serait un clignotement permanent. */
            const avant = btn.textContent;
            btn.classList.add('ok');
            btn.textContent = 'copié ✓';
            setTimeout(() => { btn.classList.remove('ok'); btn.textContent = avant; }, 900);

            pris[i][quoi] = true;
            if (pris[i].nom && pris[i].montant) { ligne(i).classList.add('fait'); majCpt(); }
          });
        });

        d.querySelectorAll('.mvp-f').forEach(btn => {
          btn.addEventListener('click', () => {
            const i = Number(btn.dataset.fait);
            const l = ligne(i);
            const fait = l.classList.toggle('fait');
            pris[i].nom = pris[i].montant = fait;
            majCpt();
          });
        });

        majCpt();

        /* askHtml sert d'ordinaire à un formulaire : son pied propose
           « Annuler » et « Enregistrer ». Ici il n'y a rien à enregistrer.
           On MASQUE « Annuler » sans le retirer : askHtml lui accroche son
           gestionnaire juste après cet appel, et un bouton disparu le faisait
           échouer — la fenêtre ne se fermait plus du tout. Vu à l'écran. */
        const non = d.querySelector('[data-no]');
        const oui = d.querySelector('[data-yes]');
        if (non) non.hidden = true;
        if (oui) { oui.textContent = 'Fermer'; oui.classList.remove('go'); }
      });
  }

  document.addEventListener('click', e => {
    if (e.target.closest('#primesPaie')) listeDePaie();
  });

  /* Les trois cartes de « Grades & quotas » annonçaient 3 000 / 5 000 / 8 000
     en texte figé dans la page. Un quota qu'on règle et une carte qui n'en
     sait rien, c'est une des deux qui ment. */
  function remplirCartesGrades() {
    const vins = n => Number(n || 0).toLocaleString('fr-FR') + ' vins';
    const met = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    met('gq-saisonnier', vins(quotaDuGrade('Saisonnier')));
    met('gq-ouvrier',    vins(quotaDuGrade('Ouvrier Viticole')));
    met('gq-chef',       vins(quotaDuGrade('Chef de Culture')));
    met('gp-saisonnier', Number(quotaDuGrade('Ouvrier Viticole')).toLocaleString('fr-FR'));
    met('gp-ouvrier',    Number(quotaDuGrade('Chef de Culture')).toLocaleString('fr-FR'));
  }

  function renderRegles() {
    remplirCartesGrades();
    renderReglages();
    renderQuotaService();
    renderPrimeRecrutement();
  }

  window.MarloweReglages = reglages;


  /* --- Les deux catalogues, côté panel -------------------------------------
     Le citoyen est celui du site vitrine, montré ici en lecture pour vérifier
     ce que voient les visiteurs. L'entreprise ne sort jamais du panel. */
  function vueCatalogue(cible, cfg, publique) {
    const box = $(cible);
    if (!box) return;

    const pages = cfg.pages || [];
    const ou = publique
      ? "Publié sur le site vitrine, visible par tout le monde."
      : "Réservé au panel : ce catalogue ne part jamais sur le site public.";
    const regle = "Se règle dans <b>Paramètres ▸ Vitrine du site</b>.";

    if (!cfg.embed && !pages.length && !cfg.pdf) {
      box.innerHTML = `
        <h3>${esc(cfg.titre || (publique ? 'Catalogue citoyens' : 'Catalogue entreprise'))}</h3>
        <p class="mv-sub">${ou}</p>
        <p class="empty-note" style="margin-top:16px;">Aucun catalogue déposé pour l'instant. ${regle}</p>`;
      return;
    }

    const corps = cfg.embed
      ? `<div class="mv-cat-vue is-embed"><iframe src="${esc(cfg.embed)}" allowfullscreen loading="lazy"
            title="${esc(cfg.titre || 'Catalogue')}"></iframe></div>`
      : `<div class="mv-cat-vue" data-cat-vue="${cible}">
           ${pages.map((u, i) => `<img src="${esc(u)}" alt="Page ${i + 1}" ${i ? 'hidden loading="lazy"' : ''}>`).join('')}
         </div>
         ${pages.length > 1 ? `<div class="mv-cat-bar">
           <button class="btn" data-cat-page="-1" data-cible="${cible}">‹</button>
           <span class="mv-cat-n" id="n-${cible}">1 / ${pages.length}</span>
           <button class="btn" data-cat-page="1" data-cible="${cible}">›</button>
         </div>` : ''}`;

    box.innerHTML = `
      <h3>${esc(cfg.titre || (publique ? 'Catalogue citoyens' : 'Catalogue entreprise'))}</h3>
      <p class="mv-sub">${cfg.desc ? esc(cfg.desc) + ' · ' : ''}${ou} ${regle}</p>
      ${corps}
      ${cfg.pdf ? `<div class="btn-row" style="margin-top:14px;">
        <a class="btn" href="${esc(cfg.pdf)}" download target="_blank" rel="noopener">⬇ Télécharger le PDF</a>
      </div>` : ''}`;
  }

  function renderCatalogues() {
    normaliserVitrine();
    vueCatalogue('catCitoyens', {
      titre: vitrine.catTitre, desc: vitrine.catDesc,
      embed: vitrine.catEmbed, pdf: vitrine.catPdf, pages: vitrine.catPages,
    }, true);
    vueCatalogue('catEntreprise', {
      titre: vitrine.entTitre, desc: vitrine.entDesc,
      embed: vitrine.entEmbed, pdf: vitrine.entPdf, pages: vitrine.entPages,
    }, false);
  }

  /* Feuilletage des deux vues, en délégation : elles se redessinent à chaque
     enregistrement, des écouteurs directs seraient perdus. */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-cat-page]');
    if (!b) return;
    const vue = document.querySelector(`[data-cat-vue="${b.dataset.cible}"]`);
    if (!vue) return;
    const imgs = [...vue.querySelectorAll('img')];
    let i = imgs.findIndex(im => !im.hidden);
    i = Math.min(Math.max(i + Number(b.dataset.catPage), 0), imgs.length - 1);
    imgs.forEach((im, k) => { im.hidden = k !== i; if (k === i) im.removeAttribute('loading'); });
    const n = $('n-' + b.dataset.cible);
    if (n) n.textContent = `${i + 1} / ${imgs.length}`;
  });


  /* ==========================================================================
     LE RAIL DE NAVIGATION
     --------------------------------------------------------------------------
     Le menu comptait vingt-cinq entrées dans une seule colonne : on y cherchait
     une page en faisant défiler. Il se lit maintenant à deux niveaux — une
     icône par section dans le rail, et dans la colonne uniquement les pages de
     la section ouverte.

     Rien n'est réécrit pour autant : les <div class="nav-item" data-page="…">
     restent exactement les mêmes éléments, aux mêmes endroits. Ils sont
     simplement regroupés dans des enveloppes. Le filtrage des droits, la
     gestion des clics et la page Paramètres continuent donc de fonctionner
     sans savoir que le rail existe.

     Deux états distincts sur une icône, et c'est voulu :
       · le fond doré  = la section que la colonne est en train de montrer ;
       · le point doré = la section où se trouve la page réellement ouverte.
     Consulter le menu d'une autre section ne doit pas donner l'impression
     d'avoir changé de page.
     ========================================================================== */

  const RAIL_ICONES = {
    'rh':        '<path d="M16 21v-2a4 4 0 0 0-8 0v2"/><circle cx="12" cy="8" r="4"/>',
    'commerce':  '<path d="M3 3h18v5H3zM6 8v13h12V8"/><path d="M10 12h4"/>',
    'comptabilite': '<path d="M3 5h18v14H3Z"/><path d="M3 9h18"/><path d="M8 13h2M8 16h2M14 13h2M14 16h2"/>',
    'quotas':    '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    'magasin':   '<path d="M3 7h18l-2 12H5Z"/><path d="M8 7a4 4 0 0 1 8 0"/>',
    'gestion':   '<path d="M4 19V5a2 2 0 0 1 2-2h11l3 3v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M8 8h7M8 12h7M8 16h4"/>',
    'perso':     '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>',
    'parametres':'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15a2 2 0 0 1-2-2 2 2 0 0 1 2-2 1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6 2 2 0 0 1 11 3a2 2 0 0 1 2 2 1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 11a2 2 0 0 1 0 4Z"/>',
    'defaut':    '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  };

  /* Étiquette courte pour le rail : « Stats & Quotas » ne tient pas sous une
     icône de 48 px, et un mot coupé se lit plus mal qu'un mot choisi. */
  const RAIL_COURT = {
    'rh': 'RH', 'commerce': 'Commerce', 'comptabilite': 'Compta', 'quotas': 'Quotas',
    'gestion': 'Gestion', 'magasin': 'Magasin', 'perso': 'Perso', 'parametres': 'Réglages',
  };

  function railSlug(titre) {
    const k = String(titre || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
    if (k.startsWith('rh')) return 'rh';
    if (k.startsWith('commerce')) return 'commerce';
    if (k.startsWith('compta')) return 'comptabilite';
    /* « Stats & Quotas » s'appelle « Quotas » depuis que la comptabilité a sa
       propre section ; l'ancien nom reste reconnu, un menu plus vieux que le
       rail ne doit pas se retrouver sans icône. */
    if (k.startsWith('quotas') || k.startsWith('stats')) return 'quotas';
    if (k.startsWith('magasin')) return 'magasin';
    if (k.startsWith('gestion')) return 'gestion';
    if (k.startsWith('perso')) return 'perso';
    if (k.startsWith('parametre') || k.startsWith('administration')) return 'parametres';
    return k.replace(/\s+/g, '-') || 'defaut';
  }

  let railEnCours = false;      /* évite que nos propres retouches se rappellent */

  /* Enveloppe chaque section et ses pages dans un .mv-groupe. Les éléments
     eux-mêmes ne bougent pas : ils changent juste de parent. */
  function railGrouper(nav) {
    const enfants = [...nav.children];
    let groupe = null;

    enfants.forEach(el => {
      if (el.classList.contains('mv-groupe')) { groupe = null; return; }

      if (el.classList.contains('nav-section')) {
        groupe = document.createElement('div');
        groupe.className = 'mv-groupe';
        groupe.dataset.groupe = railSlug(el.textContent);
        groupe.dataset.titre = el.textContent.trim();
        nav.insertBefore(groupe, el);
        groupe.appendChild(el);
        return;
      }

      /* Une page orpheline (aucune section au-dessus) reste où elle est. */
      if (groupe && el.classList.contains('nav-item')) groupe.appendChild(el);
    });
  }

  function railGroupes() {
    return [...document.querySelectorAll('.sidebar nav .mv-groupe')];
  }

  function railVisible(g) {
    return [...g.querySelectorAll('.nav-item[data-page]')]
      .some(i => !i.classList.contains('mv-hidden'));
  }

  function railOuvrir(slug) {
    const groupes = railGroupes();
    const cible = groupes.find(g => g.dataset.groupe === slug && railVisible(g))
               || groupes.find(railVisible);
    if (!cible) return;

    groupes.forEach(g => g.classList.toggle('est-ouvert', g === cible));
    document.querySelectorAll('.mv-rail-btn').forEach(b =>
      b.classList.toggle('est-ouvert', b.dataset.groupe === cible.dataset.groupe));

    const titre = $('mvColTitre');
    if (titre) titre.textContent = cible.dataset.titre || 'Marlowe Vineyard';
  }

  /* Marque d'un point la section où se trouve la page réellement ouverte. */
  function railMarquerCourant() {
    const actif = document.querySelector('.sidebar nav .nav-item.active');
    const groupe = actif ? actif.closest('.mv-groupe') : null;
    const slug = groupe ? groupe.dataset.groupe : null;
    document.querySelectorAll('.mv-rail-btn').forEach(b =>
      b.classList.toggle('est-courant', !!slug && b.dataset.groupe === slug));
    return slug;
  }

  function railConstruire() {
    const nav = document.querySelector('.sidebar nav');
    const liste = $('mvRailListe');
    if (!nav || !liste) return;

    railEnCours = true;
    railGrouper(nav);

    const groupes = railGroupes();
    liste.innerHTML = groupes.map(g => {
      const slug = g.dataset.groupe;
      const d = RAIL_ICONES[slug] || RAIL_ICONES.defaut;
      const court = RAIL_COURT[slug] || g.dataset.titre;
      return `<button type="button" class="mv-rail-btn" data-groupe="${esc(slug)}"
                title="${esc(g.dataset.titre)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                     stroke-linecap="round" stroke-linejoin="round">${d}</svg>
                <span>${esc(court)}</span>
              </button>`;
    }).join('');

    railSynchroniser();
    railEnCours = false;
  }

  /* Rejoué après chaque filtrage des droits : une section dont toutes les
     pages sont interdites disparaît du rail. */
  function railSynchroniser() {
    const groupes = railGroupes();
    document.querySelectorAll('.mv-rail-btn').forEach(b => {
      const g = groupes.find(x => x.dataset.groupe === b.dataset.groupe);
      b.classList.toggle('mv-hidden', !g || !railVisible(g));
    });

    const courant = railMarquerCourant();
    const ouvert = document.querySelector('.mv-groupe.est-ouvert');
    /* On suit la page ouverte, sauf si l'on est en train de consulter une
       autre section — auquel cas on ne s'impose pas. */
    if (!ouvert || !railVisible(ouvert)) railOuvrir(courant);
    else railOuvrir(ouvert.dataset.groupe);
  }

  /* Un bouton d'état vide doit VRAIMENT emmener où il dit. On rejoue le clic
     sur l'entrée de menu correspondante plutôt que de dupliquer la logique de
     navigation — comme ça les sous-onglets et le rail suivent aussi. */
  function allerA(page) {
    const item = document.querySelector(`.sidebar nav .nav-item[data-page="${page}"]:not(.mv-hidden)`);
    if (item) { item.click(); return true; }
    toast("Cette page ne vous est pas accessible.");
    return false;
  }

  document.addEventListener('click', e => {
    const go = e.target.closest('[data-aller]');
    if (go) { allerA(go.dataset.aller); return; }

    const b = e.target.closest('.mv-rail-btn');
    if (b) { railOuvrir(b.dataset.groupe); return; }
    /* Un changement de page peut venir d'ailleurs que du menu : on resynchronise
       après coup plutôt que d'essayer de deviner à l'avance. */
    if (e.target.closest('.nav-item')) setTimeout(railMarquerCourant, 0);
  });

  window.mvRail = { construire: railConstruire, sync: railSynchroniser };

  /* ==========================================================================
     KIT D'ENTRETIEN — ce qu'on montre au candidat
     --------------------------------------------------------------------------
     Le recruteur fait défiler des documents pendant qu'il parle : le règlement,
     la grille des salaires, les véhicules, le coffre. Jusqu'ici ces documents
     vivaient éparpillés dans des salons Discord, qu'il fallait ouvrir un par un
     à côté du panel.

     Ici ils sont rangés par sujet, et un clic les affiche en grand. C'est cette
     vue-là qu'on partage à l'écran — d'où l'absence totale d'habillage dedans :
     le document occupe l'écran, rien d'autre.
     ========================================================================== */

  const ENT_MAX_ITEMS = 30;

  function entId(p) { return p + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

  function entKit() {
    return (typeof entretienKit !== 'undefined' && Array.isArray(entretienKit)) ? entretienKit : [];
  }

  function renderEntretien() {
    const box = $('entretienBox');
    if (!box) return;
    const kit = entKit();

    if (!kit.length) {
      box.innerHTML = `<div class="panel"><p class="empty-note">
        Aucune rubrique pour l'instant. Créez-en une par sujet abordé en entretien —
        Règlement, Salaires, Véhicules, Coffre — et déposez-y les visuels correspondants.</p></div>`;
      return;
    }

    box.innerHTML = kit.map((r, ri) => `
      <div class="panel ent-rub" data-ri="${ri}">
        <div class="ent-head">
          <div>
            <h3>${esc(r.titre || 'Sans titre')}
              <span class="mv-cpt">${(r.items || []).length}</span></h3>
            ${r.note ? `<p class="ent-note">${esc(r.note)}</p>` : ''}
          </div>
          <div class="btn-row">
            ${(r.items || []).length ? `<button class="btn primary" data-ent="montrer" data-ri="${ri}">▶ Présenter</button>` : ''}
            <button class="btn" data-ent="ajouter"  data-ri="${ri}">+ Visuel</button>
            <button class="btn" data-ent="lien"     data-ri="${ri}">+ Lien</button>
            <button class="btn" data-ent="renommer" data-ri="${ri}">Renommer</button>
            <button class="btn" data-ent="haut"     data-ri="${ri}" ${ri === 0 ? 'disabled' : ''} title="Monter">↑</button>
            <button class="btn" data-ent="bas"      data-ri="${ri}" ${ri === kit.length - 1 ? 'disabled' : ''} title="Descendre">↓</button>
            <button class="btn" data-ent="suppr"    data-ri="${ri}" title="Supprimer la rubrique">✕</button>
          </div>
        </div>

        ${(r.items || []).length ? `<div class="ent-grille">
          ${r.items.map((it, ii) => it.type === 'lien'
            ? `<a class="ent-vig est-lien" href="${esc(it.url)}" target="_blank" rel="noopener"
                  title="${esc(it.titre || it.url)}">
                 <span class="ent-lien-ic">🔗</span>
                 <span class="ent-vig-nom">${esc(it.titre || it.url)}</span>
                 <button class="ent-vig-x" data-ent="ritem" data-ri="${ri}" data-ii="${ii}" title="Retirer">✕</button>
               </a>`
            : `<div class="ent-vig" data-ent="voir" data-ri="${ri}" data-ii="${ii}"
                    title="${esc(it.titre || 'Afficher en grand')}">
                 <img src="${esc(it.url)}" alt="${esc(it.titre || '')}" loading="lazy">
                 ${it.titre ? `<span class="ent-vig-nom">${esc(it.titre)}</span>` : ''}
                 <button class="ent-vig-x" data-ent="ritem" data-ri="${ri}" data-ii="${ii}" title="Retirer">✕</button>
               </div>`).join('')}
        </div>` : `<p class="empty-note" style="margin-top:12px;">Rubrique vide — déposez-y un visuel ou un lien.</p>`}
      </div>`).join('');
  }

  /* La même bibliothèque, vue par ceux qui la consultent
     --------------------------------------------------------------------------
     Aucun bouton, aucune poignée : ni ajout, ni retrait, ni renommage. Ce n'est
     pas une question de confiance, c'est une question de clarté — un employé
     qui vient relire le règlement n'a pas à se demander ce que fait la croix
     rouge à côté du document. */
  function renderDocuments() {
    const box = $('documentsBox');
    if (!box) return;
    const kit = entKit().filter(r => (r.items || []).length);

    if (!kit.length) {
      box.innerHTML = `<div class="panel"><p class="empty-note">
        Aucun document publié pour l'instant. Les ressources présentées en entretien
        apparaîtront ici dès que les RH les auront déposées.</p></div>`;
      return;
    }

    box.innerHTML = kit.map((r, ri) => `
      <div class="panel ent-rub">
        <div class="ent-head">
          <div>
            <h3>${esc(r.titre || 'Sans titre')} <span class="mv-cpt">${r.items.length}</span></h3>
            ${r.note ? `<p class="ent-note">${esc(r.note)}</p>` : ''}
          </div>
        </div>
        <div class="ent-grille">
          ${r.items.map((it, ii) => it.type === 'lien'
            ? `<a class="ent-vig est-lien" href="${esc(it.url)}" target="_blank" rel="noopener"
                  title="${esc(it.titre || it.url)}">
                 <span class="ent-lien-ic">🔗</span>
                 <span class="ent-vig-nom">${esc(it.titre || it.url)}</span>
               </a>`
            : `<div class="ent-vig" data-doc="voir" data-ri="${ri}" data-ii="${ii}"
                    title="${esc(it.titre || 'Afficher en grand')}">
                 <img src="${esc(it.url)}" alt="${esc(it.titre || '')}" loading="lazy">
                 ${it.titre ? `<span class="ent-vig-nom">${esc(it.titre)}</span>` : ''}
               </div>`).join('')}
        </div>
      </div>`).join('');
  }

  /* La vue de consultation masque les rubriques vides : ses indices ne
     correspondent donc pas à ceux du kit complet, et il faut retrouver la
     bonne rubrique avant d'ouvrir le plein écran. */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-doc="voir"]');
    if (!b) return;
    const visibles = entKit().filter(r => (r.items || []).length);
    const rub = visibles[+b.dataset.ri];
    if (!rub) return;
    const vraiIndex = entKit().indexOf(rub);
    const item = rub.items[+b.dataset.ii];
    ouvrirEntretien(vraiIndex, item ? rub.items.indexOf(item) : -1);
  });

  /* --- L'affichage plein écran ---------------------------------------------
     Volontairement nu : pas de cadre, pas de titre par-dessus le document. Ce
     qui est projeté au candidat, c'est le document, pas notre interface. */
  let entVue = null;

  function ouvrirEntretien(ri, ii) {
    const r = entKit()[ri];
    if (!r || !(r.items || []).length) return;

    const images = r.items.map((it, k) => ({ ...it, k })).filter(it => it.type !== 'lien');
    if (!images.length) return;

    let pos = Math.max(0, images.findIndex(it => it.k === ii));
    if (pos < 0) pos = 0;

    if (!entVue) {
      entVue = document.createElement('div');
      entVue.className = 'ent-scene';
      entVue.innerHTML = `
        <button class="ent-fermer" title="Fermer (Échap)">✕</button>
        <button class="ent-fleche est-gauche" title="Précédent">‹</button>
        <img class="ent-grand" alt="">
        <button class="ent-fleche est-droite" title="Suivant">›</button>
        <div class="ent-legende"></div>`;
      document.body.appendChild(entVue);

      entVue.addEventListener('click', e => {
        if (e.target.closest('.ent-fermer') || e.target === entVue) { fermerEntretien(); return; }
        if (e.target.closest('.est-gauche'))  { entVue._aller(-1); return; }
        if (e.target.closest('.est-droite')) { entVue._aller(1); return; }
      });
    }

    const img = entVue.querySelector('.ent-grand');
    const leg = entVue.querySelector('.ent-legende');

    const peindre = () => {
      const it = images[pos];
      img.src = it.url;
      img.alt = it.titre || '';
      leg.textContent = `${r.titre}${it.titre ? ' — ' + it.titre : ''}   ·   ${pos + 1} / ${images.length}`;
      entVue.querySelectorAll('.ent-fleche').forEach(f => { f.hidden = images.length < 2; });
    };

    entVue._aller = d => { pos = (pos + d + images.length) % images.length; peindre(); };
    peindre();
    entVue.classList.add('on');
    document.body.style.overflow = 'hidden';
  }

  function fermerEntretien() {
    if (!entVue) return;
    entVue.classList.remove('on');
    document.body.style.overflow = '';
  }

  document.addEventListener('keydown', e => {
    if (!entVue || !entVue.classList.contains('on')) return;
    if (e.key === 'Escape')     { fermerEntretien(); e.preventDefault(); }
    if (e.key === 'ArrowLeft')  { entVue._aller(-1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { entVue._aller(1);  e.preventDefault(); }
  });

  /* --- Les actions ---------------------------------------------------------- */
  document.addEventListener('click', async e => {
    if (e.target.closest('#entNouvelle')) {
      const r = await askForm('Nouvelle rubrique', [
        { key: 'titre', label: 'Sujet', value: '' },
        { key: 'note',  label: 'Précision (facultatif)', value: '' },
      ], "Un sujet abordé pendant l'entretien : Règlement, Salaires, Véhicules, Coffre…");
      if (!r) return;
      const titre = (r.titre || '').trim();
      if (!titre) { toast('Il faut un titre.'); return; }
      entKit().push({ id: entId('R'), titre, note: (r.note || '').trim(), items: [] });
      D().note(`a créé la rubrique d'entretien « ${titre} »`);
      D().save('entretien');
      return;
    }

    const b = e.target.closest('[data-ent]');
    if (!b) return;
    const quoi = b.dataset.ent;
    const ri = +b.dataset.ri;
    const kit = entKit();
    const rub = kit[ri];
    if (!rub) return;

    /* Le ✕ d'une vignette est posé DANS la vignette cliquable : sans ça, le
       retirer ouvrirait aussi l'affichage plein écran. */
    if (quoi === 'ritem') {
      e.preventDefault();
      e.stopPropagation();
      const ii = +b.dataset.ii;
      const it = rub.items[ii];
      if (!it) return;
      if (!confirm(`Retirer « ${it.titre || 'ce document'} » de ${rub.titre} ?`)) return;
      rub.items.splice(ii, 1);
      D().note(`a retiré un document de ${rub.titre}`);
      D().save('entretien');
      return;
    }

    if (quoi === 'voir')    { ouvrirEntretien(ri, +b.dataset.ii); return; }
    if (quoi === 'montrer') { ouvrirEntretien(ri, -1); return; }   /* -1 : on part du premier */

    if (quoi === 'haut' && ri > 0)               { [kit[ri - 1], kit[ri]] = [kit[ri], kit[ri - 1]]; D().save('entretien'); return; }
    if (quoi === 'bas'  && ri < kit.length - 1)  { [kit[ri + 1], kit[ri]] = [kit[ri], kit[ri + 1]]; D().save('entretien'); return; }

    if (quoi === 'suppr') {
      if (!confirm(`Supprimer la rubrique « ${rub.titre} » et ses ${rub.items.length} document(s) ?`)) return;
      kit.splice(ri, 1);
      D().note(`a supprimé la rubrique d'entretien « ${rub.titre} »`);
      D().save('entretien');
      return;
    }

    if (quoi === 'renommer') {
      const r = await askForm('Renommer la rubrique', [
        { key: 'titre', label: 'Sujet', value: rub.titre || '' },
        { key: 'note',  label: 'Précision', value: rub.note || '' },
      ]);
      if (!r) return;
      rub.titre = (r.titre || '').trim() || rub.titre;
      rub.note = (r.note || '').trim();
      D().note(`a renommé une rubrique d'entretien`);
      D().save('entretien');
      return;
    }

    if (quoi === 'lien') {
      const r = await askForm('Ajouter un lien', [
        { key: 'titre', label: 'Intitulé', value: '' },
        { key: 'url',   label: 'Adresse', value: 'https://' },
      ], "Un document en ligne : Google Docs, Canva, un salon Discord… Il s'ouvrira dans un nouvel onglet.");
      if (!r) return;
      let u;
      try { u = new URL((r.url || '').trim()); } catch (err) { toast("Cette adresse n'est pas valide."); return; }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') { toast('Seules les adresses web sont acceptées.'); return; }
      if (rub.items.length >= ENT_MAX_ITEMS) { toast(`Maximum ${ENT_MAX_ITEMS} documents par rubrique.`); return; }
      rub.items.push({ id: entId('I'), type: 'lien', titre: (r.titre || '').trim() || u.hostname, url: u.href });
      D().note(`a ajouté un lien à ${rub.titre}`);
      D().save('entretien');
      return;
    }

    if (quoi === 'ajouter') {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.multiple = true;
      inp.onchange = async () => {
        const fichiers = [...(inp.files || [])];
        if (!fichiers.length) return;
        const place = ENT_MAX_ITEMS - rub.items.length;
        if (place <= 0) { toast(`Maximum ${ENT_MAX_ITEMS} documents par rubrique.`); return; }

        toast(`Envoi de ${Math.min(place, fichiers.length)} visuel(s)…`);
        try {
          for (const f of fichiers.slice(0, place)) {
            const url = await envoyerFichier(f);
            rub.items.push({
              id: entId('I'), type: 'image', url,
              titre: f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60),
            });
          }
          D().note(`a ajouté des documents à ${rub.titre}`);
          D().save('entretien');
          toast('Visuels ajoutés.');
        } catch (err) {
          alert("Le visuel n'a pas pu être déposé : " + err.message);
          D().save('entretien');
        }
      };
      inp.click();
      return;
    }
  });

  /* ==========================================================================
     TOMBOLA — les tickets ne se saisissent pas, ils se déduisent
     --------------------------------------------------------------------------
     Deux sources, additionnées :

       1. le grade. Un barème fixe, décidé par la direction : les postes de
          commandement n'y participent pas (ils organisent le tirage), les
          postes de terrain oui.

       2. le travail de la semaine. Un ticket de plus par tranche de 3 000 de
          quota effectué — le quota effectué étant runs ÷ 5, une tranche vaut
          donc 15 000 $ de runs.

     Rien n'est stocké : les tickets se relisent du tableau de bord à chaque
     affichage. Un tirage lancé sur une liste figée serait un tirage sur des
     chiffres périmés, ce qui est exactement ce qu'une tombola ne doit pas
     être.
     ========================================================================== */

  const TICKETS_PAR_GRADE = {
    'patron': 0, 'co patron': 0, 'resp generale': 0, 'resp general': 0,
    'drh': 0, 'rh': 0, 'saisonnier': 0,
    'resp commercial': 2, 'resp commerciale': 2, 'resp evenementiel': 2,
    'resp magasin': 2, 'resp runner': 2,
    'commercial': 2, 'commerciale': 2,
    'vendeur': 2, 'vendeuse': 2,
    'chef de culture': 2,
    'ouvrier viticole': 1, 'ouvriere viticole': 1,
  };

  /* Une tranche de quota effectué vaut un ticket. Le quota effectué est
     runs ÷ 5 : 3 000 de quota correspondent donc à 15 000 $ de runs. */
  const QUOTA_PAR_TICKET = 3000;

  function ticketsDuGrade(grade) {
    const k = clefPoste(grade);
    if (k in TICKETS_PAR_GRADE) return TICKETS_PAR_GRADE[k];

    /* Un grade inconnu ne doit ni planter ni offrir des tickets par erreur :
       on retombe sur le poste de terrain le plus courant, sans surprise. */
    return 0;
  }

  function quotaEffectue(runs) {
    return Math.round(Math.max(0, Number(runs) || 0) / 5);
  }

  function ticketsDe(ligne) {
    const q = quotaEffectue(ligne && ligne.runs);
    const parGrade = ticketsDuGrade(ligne && ligne.rank);
    const parQuota = Math.floor(q / QUOTA_PAR_TICKET);
    return { parGrade, parQuota, total: parGrade + parQuota, quota: q };
  }

  /* Les couleurs de la roue : une teinte par participant, réparties sur le
     cercle chromatique pour rester distinctes quel qu'en soit le nombre. */
  function teinte(i, n) {
    return `hsl(${Math.round((i * 360) / Math.max(n, 1) + 28) % 360} 52% 52%)`;
  }

  function participantsTombola() {
    const lignes = (typeof dash !== 'undefined' && Array.isArray(dash)) ? dash : [];
    const out = [];
    lignes.forEach(e => {
      const t = ticketsDe(e);
      if (t.total > 0) {
        out.push({ name: e.name, rank: e.rank, runs: Number(e.runs) || 0, ...t });
      }
    });
    out.sort((a, b) => b.total - a.total || String(a.name).localeCompare(b.name));
    out.forEach((p, i) => { p.color = teinte(i, out.length); });

    let curseur = 0;
    const total = out.reduce((s, p) => s + p.total, 0);
    out.forEach(p => {
      p.startDeg = total ? (curseur / total) * 360 : 0;
      curseur += p.total;
      p.endDeg = total ? (curseur / total) * 360 : 0;
    });
    return { liste: out, total };
  }

  function renderTombola() {
    const roue = $('tombolaWheel');
    if (!roue) return;

    const { liste, total } = participantsTombola();
    const lignes = (typeof dash !== 'undefined' && Array.isArray(dash)) ? dash : [];

    /* La roue. Sans participant, un disque neutre plutôt qu'un dégradé vide,
       qui s'afficherait en noir. */
    roue.style.background = liste.length
      ? `conic-gradient(${liste.map(p => `${p.color} ${p.startDeg}deg ${p.endDeg}deg`).join(', ')})`
      : 'repeating-conic-gradient(#3D372C 0deg 12deg, #2E2A23 12deg 24deg)';

    const cpt = $('tombolaCompte');
    if (cpt) cpt.textContent = liste.length
      ? `${liste.length} · ${total} ticket${total > 1 ? 's' : ''}` : '';

    const vide = $('tombolaVide');
    if (vide) vide.hidden = liste.length > 0;

    const leg = $('tombolaLegend');
    if (leg) leg.innerHTML = liste.map(p => `
      <div class="tombola-legend-row">
        <span class="tombola-swatch" style="background:${p.color};"></span>
        <span class="tombola-legend-name">${esc(p.name)}</span>
        <span class="tombola-legend-tickets">${p.total} ticket${p.total > 1 ? 's' : ''}
          · ${total ? Math.round((p.total / total) * 100) : 0} %</span>
      </div>`).join('');

    /* Le détail montre TOUT LE MONDE, y compris ceux à zéro ticket : savoir
       pourquoi on n'est pas dans la roue vaut mieux que de ne pas y être. */
    const det = $('tombolaDetail');
    if (det) {
      const rangs = lignes.slice().sort((a, b) =>
        (ticketsDe(b).total - ticketsDe(a).total) || String(a.name).localeCompare(b.name));
      det.innerHTML = rangs.length ? rangs.map(e => {
        const t = ticketsDe(e);
        return `<tr${t.total ? '' : ' style="opacity:.5;"'}>
          <td>${esc(e.name)}</td>
          <td>${esc(e.rank || '—')}</td>
          <td class="num">${(Number(e.runs) || 0).toLocaleString('fr-FR')} $</td>
          <td class="num">${t.quota.toLocaleString('fr-FR')}</td>
          <td class="num">${t.parGrade}</td>
          <td class="num">${t.parQuota}</td>
          <td class="num"><b>${t.total}</b></td>
        </tr>`;
      }).join('') : `<tr><td colspan="7" class="empty-note">Aucune ligne dans le tableau de bord de la semaine.</td></tr>`;
    }

    renderTombolaHisto();
  }

  function renderTombolaHisto() {
    const box = $('tombolaHisto');
    if (!box) return;
    const h = (typeof tombolaParticipants !== 'undefined' && Array.isArray(tombolaParticipants))
      ? tombolaParticipants : [];
    box.innerHTML = h.length ? h.map((t, i) => `
      <tr>
        <td>${esc(t.quand || '—')}</td>
        <td><b>${esc(t.gagnant || '—')}</b></td>
        <td class="num">${t.tickets || 0}</td>
        <td class="num">${t.total || 0}</td>
        <td class="num"><button class="btn btn-mini" data-tombola-del="${i}">✕</button></td>
      </tr>`).join('')
      : `<tr><td colspan="5" class="empty-note">Aucun tirage effectué pour l'instant.</td></tr>`;
  }

  /* Le tirage. La roue tourne pour le spectacle, mais le gagnant est désigné
     AVANT de la lancer : l'animation se cale ensuite sur lui. L'inverse —
     lire l'angle d'arrivée — donnerait un résultat dépendant des arrondis du
     navigateur, donc pas tout à fait proportionnel aux tickets. */
  let tombolaTourne = false;
  let tombolaAngle = 0;

  function tirerAuSort(liste, total) {
    let r = Math.random() * total;
    for (const p of liste) {
      if (r < p.total) return p;
      r -= p.total;
    }
    return liste[liste.length - 1];
  }

  document.addEventListener('click', e => {
    const del = e.target.closest('[data-tombola-del]');
    if (del) {
      const i = +del.dataset.tombolaDel;
      if (typeof tombolaParticipants === 'undefined' || !tombolaParticipants[i]) return;
      const t = tombolaParticipants[i];
      tombolaParticipants.splice(i, 1);
      D().note(`a retiré le tirage du ${t.quand} (${t.gagnant})`);
      D().save('tombola');
      return;
    }

    if (!e.target.closest('#spinBtn')) return;
    if (tombolaTourne) return;

    const roue = $('tombolaWheel');
    const btn = $('spinBtn');
    const aff = $('tombolaWinner');
    if (!roue || !btn) return;

    const { liste, total } = participantsTombola();
    if (!liste.length || !total) {
      toast("Aucun participant : le tableau de bord de la semaine est vide.");
      return;
    }

    tombolaTourne = true;
    btn.disabled = true;
    if (aff) aff.textContent = '';

    const gagnant = tirerAuSort(liste, total);
    const cible = gagnant.startDeg + Math.random() * (gagnant.endDeg - gagnant.startDeg);
    tombolaAngle = (tombolaAngle - (tombolaAngle % 360)) + 6 * 360 + (360 - cible);
    roue.style.transform = `rotate(${tombolaAngle}deg)`;

    const fini = () => {
      if (aff) aff.textContent = `🏆 Gagnant : ${gagnant.name} (${gagnant.total} ticket${gagnant.total > 1 ? 's' : ''} sur ${total})`;
      tombolaTourne = false;
      btn.disabled = false;

      if (typeof tombolaParticipants !== 'undefined' && Array.isArray(tombolaParticipants)) {
        tombolaParticipants.unshift({
          quand: quandFR(new Date()),
          gagnant: gagnant.name,
          tickets: gagnant.total,
          total,
        });
        if (tombolaParticipants.length > 100) tombolaParticipants.length = 100;
        D().note(`a tiré la tombola — ${gagnant.name} l'emporte`);
        D().save('tombola');
      }
    };

    /* transitionend peut ne jamais arriver si l'onglet passe en arrière-plan :
       un filet de sécurité évite un bouton bloqué pour toujours. */
    let fait = false;
    const une = () => { if (!fait) { fait = true; fini(); } };
    roue.addEventListener('transitionend', une, { once: true });
    setTimeout(une, 4600);
  });

  /* Une ligne saisie à la main, pour quelqu'un que la tablette n'a pas
     remonté — un service hors ligne, un oubli, une correction. Elle rejoint
     `dash` comme les autres et suit donc la clôture. */
  async function ajouterLigneDash() {
    if (typeof dash === 'undefined') return;
    const grades = (typeof multiplierFor === 'object')
      ? Object.keys(multiplierFor) : ['Saisonnier'];

    const r = await askForm('Ajouter une ligne au tableau de bord', [
      { key: 'name',     label: 'Employé', value: '' },
      { key: 'rank',     label: 'Rang', value: grades[0], options: grades },
      { key: 'factures', label: 'Factures ($)', value: '0', type: 'number' },
      { key: 'runs',     label: 'Runs ($)', value: '0', type: 'number' },
      { key: 'ventes',   label: 'Ventes (nombre)', value: '0', type: 'number' },
      { key: 'heures',   label: 'Heures', value: '0', type: 'number' },
    ], "À utiliser quand la tablette de la semaine n'a pas remonté quelqu'un. Le quota et la prime se recalculent tout seuls à partir des runs.");
    if (!r) return;

    const nom = (r.name || '').trim();
    if (!nom) { toast('Il faut au moins un nom.'); return; }
    if (dash.some(d => d.name === nom)) {
      toast(`${nom} est déjà dans le tableau — retirez la ligne existante d'abord.`);
      return;
    }

    const n = v => Math.max(0, Math.round(Number(v) || 0));
    const factures = n(r.factures), runs = n(r.runs);

    dash.push({
      name: nom, rank: r.rank,
      factures, runs, ventes: n(r.ventes),
      part: factures + runs, tickets: 0, heures: n(r.heures),
    });
    D().note(`a ajouté ${nom} au tableau de bord (ligne manuelle)`);
    D().save('dash');
    toast(`${nom} ajouté au tableau de bord.`);
  }

  document.addEventListener('click', e => {
    if (e.target.closest('#mvDashManuel')) ajouterLigneDash();
  });


/* ==========================================================================
   MAGASIN — bons de commande, stock, récap
   --------------------------------------------------------------------------
   Reprend ce que le magasin tenait dans un tableur : les commandes, l'état des
   rayons et le compte de fin de semaine. Les produits ne sont pas ressaisis —
   ils viennent du catalogue d'articles déjà utilisé par la facturation, sinon
   deux listes de prix finiraient par diverger.
   ========================================================================== */

  const commandes = [];   /* {id, date, employe, grade, lignes, total, statut} */
  const stockData = [];   /* {ref, nom, qte, seuil} */

  /* ------------------------------------------------------------------------
     QUI TIENT LE MAGASIN
     Le formulaire de bon proposait TOUT le registre : on pouvait établir une
     commande au nom d'un saisonnier, qui ne vend rien. Seuls les postes de
     vente apparaissent désormais.

     Et chacun n'y voit que ses propres chiffres : un vendeur ouvre la page sur
     ses ventes à lui, pas sur le classement de l'équipe. Le patron, le
     responsable magasin et le responsable commercial gardent la vue d'ensemble
     et peuvent passer d'un vendeur à l'autre.
     ------------------------------------------------------------------------ */
  const POSTES_VENTE = [
    'Vendeur', 'Vendeuse', 'Commercial',
    'Resp. Commercial', 'Responsable Commercial',
    'Resp. Magasin', 'Responsable Magasin',
    'Assistant(e) magasin', 'Assistant magasin', 'Assistante magasin',
  ];
  const VENTE_OK = POSTES_VENTE.map(clefPoste);

  /* Les responsables du magasin et du commerce : eux voient toute l'équipe. */
  const POSTES_MAG_CHEF = [
    'Resp. Magasin', 'Responsable Magasin', 'Resp. Commercial', 'Responsable Commercial',
  ].map(clefPoste);

  function estPosteVente(poste) { return VENTE_OK.includes(clefPoste(poste)); }

  /* Qui peut être consulté : l'équipe de vente, plus tout ce qui est au-dessus
     du Vendeur. Un DRH qui ouvrait ce menu n'y trouvait que des vendeurs — les
     responsables, dont il a précisément la charge, n'y figuraient pas. */
  function equipeMagasin() {
    const roster = (typeof rhRosterData !== 'undefined') ? rhRosterData : [];
    return roster
      .filter(e => (!e.status || e.status === 'actif')
                && (estPosteVente(e.poste) || estEncadrement(e.poste)))
      .map(e => ({ nom: e.name, poste: e.poste }));
  }

  /* La fiche de la personne connectée dans le registre, si on la reconnaît. */
  function ficheDeSession() {
    const s = window.MarloweSession;
    if (!s || !s.name) return null;
    const moi = clefNom(s.name);
    return (typeof rhRosterData !== 'undefined' ? rhRosterData : [])
      .find(e => clefNom(e.name) === moi) || null;
  }

  /* Le magasin garde ses deux chefs — ils avaient déjà cette vue et la leur
     retirer serait une régression — et y ajoute la direction et les RH. */
  function magPrivilegie() {
    return peutVoirAutrui(POSTES_MAG_CHEF);
  }

  /* Le nom sous lequel la personne connectée apparaît dans les bons. */
  function magMoi() {
    const f = ficheDeSession();
    if (f) return f.name;
    const s = window.MarloweSession;
    return (s && s.name) || '';
  }

  /* Les bons que la personne connectée a le droit de voir. */
  function bonsVisibles(liste) {
    if (magPrivilegie()) return liste;
    const moi = clefNom(magMoi());
    return liste.filter(b => clefNom(b.employe) === moi);
  }


  const STATUTS = { attente: 'En attente', validee: 'Validée', annulee: 'Annulée' };
  let magFiltre = 'tous';

  function magProduits() {
    return (typeof articlesData !== 'undefined' ? articlesData : []);
  }

  function magPrix(a) {
    return window.mvPrixArticle ? window.mvPrixArticle(a, 'entreprise') : (a ? a.price : 0);
  }

  /* --- Bons de commande ---------------------------------------------------- */

  /* --- Le bon de commande, à plusieurs articles ------------------------------
     La version précédente n'acceptait qu'un produit, à charge d'ajouter les
     suivants une fois le bon créé. C'est l'inverse de la façon dont on remplit
     un bon : on sait ce qu'on veut avant de l'écrire. Le formulaire porte donc
     autant de lignes qu'il en faut, avec le total qui se met à jour à mesure
     qu'on les remplit. */
  function ligneBonHtml(arts, i) {
    return `<tr data-bl="${i}">
      <td><select class="mv-bl-prod">${
        arts.map(a => `<option value="${esc(a.desc)}">${esc(a.desc)}</option>`).join('')
      }</select></td>
      <td style="width:92px;"><input type="number" class="mv-bl-qte" min="1" step="1" value="1"></td>
      <td class="num mv-bl-pu" style="width:90px;">—</td>
      <td class="num mv-bl-tot" style="width:100px;">—</td>
      <td style="width:34px;"><button type="button" class="btn btn-mini mv-bl-del" title="Retirer cette ligne">✕</button></td>
    </tr>`;
  }

  /* Le bon se remplit DANS la page, pas dans une fenêtre.
     -------------------------------------------------------------------------
     Créer un bon est la raison d'être de cette page. Passer par un bouton puis
     une boîte de dialogue ajoutait deux gestes à ce qu'on vient y faire, et la
     boîte recouvrait la liste pendant qu'on la remplissait. Le formulaire est
     donc posé à demeure au-dessus de la liste.

     Deux contraintes ont dicté la forme :

     · il vit dans son PROPRE conteneur, hors de #magListe — renderCommandes()
       réécrit la liste à chaque frappe dans la recherche, ce qui effacerait la
       saisie en cours ;

     · il n'est reconstruit que si le catalogue, l'équipe ou le rôle ont
       changé. Le redessiner à chaque passage sur la page reviendrait au même
       effacement, en plus discret. */
  let magFormSig = null;

  function magPrixDe(arts, nom) {
    return magPrix(arts.find(a => a.desc === nom));
  }

  function rafraichirBon(racine) {
    const arts = magProduits();
    let total = 0;
    racine.querySelectorAll('#mvBonLignes tr').forEach(tr => {
      const nom = tr.querySelector('.mv-bl-prod').value;
      const qte = Math.max(1, Math.round(Number(tr.querySelector('.mv-bl-qte').value) || 0));
      const pu = magPrixDe(arts, nom);
      const t = pu * qte;
      total += t;
      tr.querySelector('.mv-bl-pu').textContent = pu.toLocaleString('fr-FR') + ' $';
      tr.querySelector('.mv-bl-tot').textContent = t.toLocaleString('fr-FR') + ' $';
    });
    const el = racine.querySelector('#mvBonTotal');
    if (el) el.textContent = total.toLocaleString('fr-FR') + ' $';
  }

  function renderFormBon(force) {
    const box = $('magFormBon');
    if (!box) return;

    const arts = magProduits();
    const chef = magPrivilegie();
    const equipe = equipeMagasin();
    const moi = magMoi();

    /* Un vendeur ne choisit pas au nom de qui il commande : ce serait la porte
       ouverte aux bons attribués au voisin. Son nom est figé. */
    const noms = chef ? equipe.map(e => e.nom) : [moi];
    const choisi = noms.includes(moi) ? moi : (noms[0] || moi);

    /* Rien à remplir : on le dit sur place plutôt que d'afficher un formulaire
       qui refusera au moment de valider. */
    if (!arts.length || (chef && !equipe.length)) {
      magFormSig = null;
      box.innerHTML = `<div class="panel"><p class="empty-note" style="text-align:center;padding:20px;">${
        !arts.length
          ? "Le catalogue d'articles est vide — référencez d'abord un produit dans Commerce ▸ Catalogue."
          : "Aucun poste de vente dans le registre RH : ajoutez d'abord un vendeur."
      }</p></div>`;
      return;
    }

    const sig = JSON.stringify([chef, noms, arts.map(a => a.desc + '|' + magPrix(a))]);
    if (!force && sig === magFormSig && box.firstElementChild) return;
    magFormSig = sig;

    box.innerHTML = `
      <div class="panel mv-bon-panel">
        <h3>Nouveau bon de commande</h3>
        <div class="mv-bon-form">
          <label class="mv-bon-lab">Employé</label>
          ${chef
            ? `<select id="mvBonEmp">${noms.map(n =>
                `<option value="${esc(n)}"${n === choisi ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`
            : `<input type="text" id="mvBonEmp" value="${esc(choisi)}" readonly
                 title="Le bon est établi à votre nom.">`}

          <label class="mv-bon-lab" style="margin-top:16px;">Articles</label>
          <table class="gtable mv-bon-table">
            <thead><tr><th>Produit</th><th>Qté</th><th class="num">P.U.</th><th class="num">Total</th><th></th></tr></thead>
            <tbody id="mvBonLignes">${ligneBonHtml(arts, 0)}</tbody>
          </table>

          <div class="btn-row" style="margin-top:10px;justify-content:space-between;align-items:center;">
            <button type="button" class="btn" id="mvBonPlus">+ Ajouter un article</button>
            <span class="mv-bon-total">Total : <b id="mvBonTotal">0 $</b></span>
          </div>

          <div class="btn-row" style="margin-top:14px;">
            <button type="button" class="btn primary" id="mvBonCreer">Créer le bon</button>
          </div>
          <p class="empty-note" style="margin-top:10px;font-size:11px;opacity:.65;">Le stock ne bougera qu'à la validation du bon.</p>
        </div>
      </div>`;

    rafraichirBon(box);
  }

  /* Remettre le formulaire à zéro après création, sans repartir du HTML
     complet : la liste des produits et le nom choisi restent en place. */
  function viderFormBon() {
    const box = $('magFormBon');
    if (!box) return;
    const corps = box.querySelector('#mvBonLignes');
    if (!corps) return;
    const arts = magProduits();
    corps.innerHTML = ligneBonHtml(arts, 0);
    rafraichirBon(box);
  }

  function creerBon() {
    const box = $('magFormBon');
    if (!box || !box.querySelector('#mvBonLignes')) return;
    const arts = magProduits();

    const employe = ((box.querySelector('#mvBonEmp') || {}).value || '').trim();
    if (!employe) { toast('Il faut désigner un employé.'); return; }

    /* Deux fois le même produit sur un bon, c'est presque toujours une
       maladresse : on additionne les quantités plutôt que d'empiler des
       lignes qui compliqueront la préparation. */
    const parNom = new Map();
    box.querySelectorAll('#mvBonLignes tr').forEach(tr => {
      const nom = tr.querySelector('.mv-bl-prod').value;
      const qte = Math.max(1, Math.round(Number(tr.querySelector('.mv-bl-qte').value) || 0));
      if (!nom) return;
      if (parNom.has(nom)) parNom.get(nom).qte += qte;
      else {
        const art = arts.find(a => a.desc === nom);
        parNom.set(nom, { ref: art ? art.ref : '', nom, pu: magPrix(art), qte });
      }
    });

    const lignes = [...parNom.values()];
    if (!lignes.length) { toast('Aucun article sur le bon.'); return; }

    const fiche = (typeof rhRosterData !== 'undefined' ? rhRosterData : []).find(e => e.name === employe);

    commandes.unshift({
      id: 'BC' + Date.now().toString(36).toUpperCase().slice(-6),
      date: todayFR(),
      employe,
      grade: fiche ? fiche.poste : '—',
      lignes,
      statut: 'attente',
    });
    D().note(`a créé un bon de commande pour ${employe} (${lignes.length} article${lignes.length > 1 ? 's' : ''})`);
    D().save('commandes');
    viderFormBon();
    toast(`Bon créé — ${lignes.length} article${lignes.length > 1 ? 's' : ''}.`);
  }

  async function ajouterLigneBon(id) {
    const bon = commandes.find(c => c.id === id);
    if (!bon || bon.statut !== 'attente') return;
    const arts = magProduits();

    const r = await askForm('Ajouter un produit au bon', [
      { key: 'produit', label: 'Produit', value: arts[0].desc, options: arts.map(a => a.desc).slice(0, 200) },
      { key: 'qte',     label: 'Quantité', value: '1', type: 'number' },
    ], `Bon ${id} — ${bon.employe}`);
    if (!r) return;

    const art = arts.find(a => a.desc === r.produit);
    bon.lignes.push({ ref: art ? art.ref : '', nom: r.produit,
                      pu: magPrix(art), qte: Math.max(1, Math.round(Number(r.qte) || 0)) });
    D().note(`a complété le bon ${id}`);
    D().save('commandes');
  }

  /* Valider un bon sort la marchandise du stock : c'est le seul moment où les
     quantités bougent toutes seules, et ça n'arrive qu'une fois par bon. */
  function statutBon(id, statut) {
    const bon = commandes.find(c => c.id === id);
    if (!bon || bon.statut === statut) return;

    if (statut === 'validee' && bon.statut === 'attente') {
      bon.lignes.forEach(l => {
        const st = stockData.find(x => x.ref === l.ref || x.nom === l.nom);
        if (st) st.qte = Math.max(0, (st.qte || 0) - l.qte);
      });
    }
    /* Annuler un bon déjà validé rend la marchandise. */
    if (statut === 'annulee' && bon.statut === 'validee') {
      bon.lignes.forEach(l => {
        const st = stockData.find(x => x.ref === l.ref || x.nom === l.nom);
        if (st) st.qte = (st.qte || 0) + l.qte;
      });
    }

    bon.statut = statut;
    D().note(`a marqué le bon ${id} comme « ${STATUTS[statut].toLowerCase()} »`);
    D().saveMany(['commandes', 'stock']);
    toast(`Bon ${id} — ${STATUTS[statut].toLowerCase()}.`);
  }

  function totalBon(b) {
    return b.lignes.reduce((s, l) => s + l.pu * l.qte, 0);
  }

  function bonsDeLaSemaine() {
    if (typeof mondayOf !== 'function') return commandes;
    const lundi = mondayOf(new Date()); lundi.setHours(0, 0, 0, 0);
    return commandes.filter(b => { const d = parseFR(b.date); return d && d >= lundi; });
  }

  function renderCommandes() {
    const box = $('magListe');
    if (!box) return;

    renderFormBon();

    const q = ($('magSearch') && $('magSearch').value || '').toLowerCase().trim();
    /* Les compteurs du haut portent sur ce que la personne a le droit de voir :
       un vendeur qui lit « 14 bons en attente » dont 12 ne sont pas les siens
       ne sait pas quoi en faire. */
    const mesBons = bonsVisibles(commandes);
    const semaine = bonsVisibles(bonsDeLaSemaine());
    const validees = semaine.filter(b => b.statut === 'validee');

    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set('magAttente', mesBons.filter(b => b.statut === 'attente').length);
    set('magValidees', validees.length);
    set('magCA', validees.reduce((s, b) => s + totalBon(b), 0).toLocaleString('fr-FR') + ' $');

    const sub = document.querySelector('#page-magcommandes .page-sub');
    if (sub) {
      sub.textContent = magPrivilegie()
        ? 'Les commandes passées au magasin — en attente, validées, annulées.'
        : `Vos commandes — en attente, validées, annulées. Vous ne voyez que les bons établis à votre nom.`;
    }

    const liste = mesBons.filter(b => {
      if (magFiltre !== 'tous' && b.statut !== magFiltre) return false;
      if (!q) return true;
      return (b.employe + b.id + b.lignes.map(l => l.nom).join(' ')).toLowerCase().includes(q);
    });

    if (!liste.length) {
      box.innerHTML = `<div class="panel"><p class="empty-note" style="text-align:center;padding:22px;">
        ${mesBons.length ? 'Aucun bon ne correspond à ce filtre.'
          : magPrivilegie() ? 'Aucun bon de commande — remplissez le formulaire ci-dessus pour créer le premier.'
          : 'Aucun bon à votre nom pour le moment.'}
      </p></div>`;
      return;
    }

    box.innerHTML = liste.map(b => `
      <div class="panel mag-bon mag-${b.statut}">
        <div class="mag-bon-head">
          <div>
            <div class="mag-bon-qui"><b>${esc(b.employe)}</b>
              <span class="rank-pill">${esc(b.grade || '—')}</span></div>
            <div class="mag-bon-meta">${esc(b.id)} · ${esc(b.date)}</div>
          </div>
          <div class="mag-bon-droite">
            <span class="mag-statut mag-s-${b.statut}">${STATUTS[b.statut]}</span>
            <span class="mag-total">${totalBon(b).toLocaleString('fr-FR')} $</span>
          </div>
        </div>
        <table class="gtable mag-lignes">
          <thead><tr><th>Produit</th><th class="num">Prix unitaire</th><th class="num">Quantité</th><th class="num">Total</th><th></th></tr></thead>
          <tbody>${b.lignes.map((l, i) => `
            <tr>
              <td><b>${esc(l.nom)}</b></td>
              <td class="num dim">${l.pu.toLocaleString('fr-FR')} $</td>
              <td class="num">${l.qte}</td>
              <td class="num">${(l.pu * l.qte).toLocaleString('fr-FR')} $</td>
              <td style="text-align:right;">${b.statut === 'attente'
                ? `<button class="icon-btn danger" data-bon-ligne-del="${b.id}|${i}" title="Retirer">×</button>` : ''}</td>
            </tr>`).join('')}</tbody>
        </table>
        <div class="btn-row" style="margin-top:12px;">
          ${b.statut === 'attente' ? `
            <button class="btn" data-bon-ligne="${b.id}">+ Produit</button>
            <button class="btn primary" data-bon-statut="${b.id}|validee">✓ Valider</button>
            <button class="btn" data-bon-statut="${b.id}|annulee">Annuler la commande</button>` : `
            <button class="btn" data-bon-statut="${b.id}|attente">Remettre en attente</button>
            <button class="icon-btn danger" data-bon-del="${b.id}" title="Supprimer le bon">×</button>`}
        </div>
      </div>`).join('');
  }

  /* --- Stock ---------------------------------------------------------------- */

  async function referencerProduit() {
    const arts = magProduits().filter(a => !stockData.some(s => s.ref === a.ref));
    if (!arts.length) { toast('Tous les articles du catalogue sont déjà suivis.'); return; }

    const r = await askForm('Référencer un produit au stock', [
      { key: 'produit', label: 'Produit', value: arts[0].desc, options: arts.map(a => a.desc).slice(0, 200) },
      { key: 'qte',   label: 'Quantité en stock', value: '0', type: 'number' },
      { key: 'seuil', label: "Seuil d'alerte", value: '200', type: 'number' },
    ], "En dessous du seuil, le produit remonte en haut de page dans « À commander ».");
    if (!r) return;

    const art = arts.find(a => a.desc === r.produit);
    stockData.push({
      ref: art ? art.ref : '', nom: r.produit,
      qte: Math.max(0, Math.round(Number(r.qte) || 0)),
      seuil: Math.max(0, Math.round(Number(r.seuil) || 0)),
    });
    D().note(`a référencé ${r.produit} au stock`);
    D().save('stock');
    toast('Produit référencé.');
  }

  function renderStock() {
    const body = $('magStockBody');
    if (!body) return;

    const q = ($('magStockSearch') && $('magStockSearch').value || '').toLowerCase().trim();
    const sous = stockData.filter(s => s.seuil > 0 && s.qte <= s.seuil);

    const alertes = $('magAlertes');
    if (alertes) {
      if (!sous.length) {
        alertes.style.display = stockData.length ? '' : 'none';
        alertes.innerHTML = `<h3>À commander</h3>
          <p class="empty-note" style="margin-top:10px;">Aucun produit sous son seuil — les rayons tiennent.</p>`;
      } else {
        alertes.style.display = '';
        alertes.innerHTML = `<h3>À commander <span class="mv-unit">${sous.length} produit${sous.length > 1 ? 's' : ''}</span></h3>
          <div class="mag-alertes">${sous
            .sort((a, b) => (a.qte / (a.seuil || 1)) - (b.qte / (b.seuil || 1)))
            .map(s => `<span class="mag-alerte"><b>${esc(s.nom)}</b> ${s.qte.toLocaleString('fr-FR')} / ${s.seuil.toLocaleString('fr-FR')}</span>`).join('')}</div>`;
      }
    }

    const liste = stockData.filter(s => !q || s.nom.toLowerCase().includes(q));
    if (!liste.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty-note" style="text-align:center;padding:18px;">
        ${stockData.length ? 'Aucun produit ne correspond.' : "Aucun produit suivi — référencez-en un pour commencer."}</td></tr>`;
      return;
    }

    body.innerHTML = liste.map(s => {
      const i = stockData.indexOf(s);
      const bas = s.seuil > 0 && s.qte <= s.seuil;
      const vide = s.qte === 0;
      return `
      <tr class="${bas ? 'mag-bas' : ''}">
        <td><b>${esc(s.nom)}</b></td>
        <td class="num"><input class="mag-inp" type="number" min="0" value="${s.qte}" data-stock-qte="${i}"></td>
        <td class="num"><input class="mag-inp" type="number" min="0" value="${s.seuil}" data-stock-seuil="${i}"></td>
        <td>${vide ? '<span class="mag-statut mag-s-annulee">Rupture</span>'
              : bas ? '<span class="mag-statut mag-s-attente">À commander</span>'
                    : '<span class="mag-statut mag-s-validee">Suffisant</span>'}</td>
        <td style="text-align:right;"><button class="icon-btn danger" data-stock-del="${i}" title="Ne plus suivre">×</button></td>
      </tr>`;
    }).join('');
  }

  /* --- Récap ---------------------------------------------------------------- */

  /* --- Récap : l'équipe, ou une personne ------------------------------------
     La page ne montrait qu'un classement d'équipe. Un vendeur y cherchait sa
     ligne au milieu des autres, et n'avait nulle part le détail de SES ventes.
     Il ouvre maintenant la page sur sa propre fiche ; seuls le patron et les
     responsables voient l'équipe et peuvent passer d'un vendeur à l'autre.
     -------------------------------------------------------------------------- */
  let magRecapChoix = '';        /* '' = toute l'équipe */

  function magRecapCible() {
    if (!magPrivilegie()) return magMoi();
    return magRecapChoix;
  }

  function magSelecteur() {
    if (!magPrivilegie()) return '';
    const equipe = equipeMagasin();
    const cible = magRecapCible();
    return `
      <div class="prod-switcher" style="margin-bottom:16px;">
        <label>Voir</label>
        <select id="magQui">
          <option value=""${cible ? '' : ' selected'}>Toute l'équipe</option>
          ${equipe.map(e => `<option value="${esc(e.nom)}"${
            clefNom(e.nom) === clefNom(cible) ? ' selected' : ''}>${esc(e.nom)}</option>`).join('')}
        </select>
      </div>`;
  }

  /* Les chiffres d'un jeu de bons : par personne et par produit. */
  function magDepouiller(bons) {
    const parEmp = new Map();
    const parProduit = new Map();
    bons.forEach(b => {
      const e = parEmp.get(b.employe) || { nom: b.employe, grade: b.grade, bons: 0, ca: 0, articles: 0 };
      e.bons++; e.ca += totalBon(b);
      e.articles += b.lignes.reduce((s, l) => s + l.qte, 0);
      parEmp.set(b.employe, e);

      b.lignes.forEach(l => {
        const p = parProduit.get(l.nom) || { nom: l.nom, qte: 0, ca: 0 };
        p.qte += l.qte; p.ca += l.pu * l.qte;
        parProduit.set(l.nom, p);
      });
    });
    return { parEmp, parProduit };
  }

  function magTableauProduits(parProduit, titre) {
    const prods = [...parProduit.values()].sort((a, b) => b.qte - a.qte).slice(0, 10);
    if (!prods.length) return '';
    return `
      <h3>${esc(titre)}</h3>
      <table class="gtable" style="margin-top:12px;">
        <thead><tr><th>Produit</th><th class="num">Quantité</th><th class="num">Chiffre</th></tr></thead>
        <tbody>${prods.map(p => `
          <tr><td><b>${esc(p.nom)}</b></td>
            <td class="num">${p.qte.toLocaleString('fr-FR')}</td>
            <td class="num dim">${p.ca.toLocaleString('fr-FR')} $</td></tr>`).join('')}</tbody>
      </table>`;
  }

  function renderMagRecap() {
    const box = $('magRecap');
    const top = $('magTopProduits');
    if (!box) return;

    const chef = magPrivilegie();
    const cible = magRecapCible();
    const semaine = bonsDeLaSemaine().filter(b => b.statut === 'validee');

    const sub = document.querySelector('#page-magrecap .page-sub');
    if (sub) {
      sub.textContent = chef
        ? "Ce que chacun a vendu cette semaine, calculé depuis les bons validés."
        : "Ce que vous avez vendu cette semaine, calculé depuis vos bons validés.";
    }

    /* ---------- la fiche d'une personne ---------- */
    if (cible) {
      const siens = semaine.filter(b => clefNom(b.employe) === clefNom(cible));
      const { parProduit } = magDepouiller(siens);
      const ca = siens.reduce((s, b) => s + totalBon(b), 0);
      const articles = siens.reduce((s, b) => s + b.lignes.reduce((t, l) => t + l.qte, 0), 0);
      const totalEquipe = semaine.reduce((s, b) => s + totalBon(b), 0);
      const fiche = equipeMagasin().find(e => clefNom(e.nom) === clefNom(cible));

      box.innerHTML = magSelecteur() + `
        <h3>${esc(fiche ? fiche.nom : cible)}
          <span class="mv-unit">${esc(fiche ? fiche.poste : '—')}</span></h3>` + (siens.length ? `
        <div class="metric-grid-3" style="margin:14px 0 4px;">
          <div class="metric-card"><div class="metric-label">Bons validés</div>
            <div class="metric-value">${siens.length}</div><div class="metric-sub">cette semaine</div></div>
          <div class="metric-card"><div class="metric-label">Articles vendus</div>
            <div class="metric-value">${articles.toLocaleString('fr-FR')}</div><div class="metric-sub">toutes références</div></div>
          <div class="metric-card"><div class="metric-label">Chiffre</div>
            <div class="metric-value">${ca.toLocaleString('fr-FR')} $</div>
            <div class="metric-sub">${totalEquipe ? Math.round(ca / totalEquipe * 100) : 0} % du magasin</div></div>
        </div>

        <table class="gtable" style="margin-top:16px;">
          <thead><tr><th>Bon</th><th>Date</th><th class="num">Articles</th><th class="num">Total</th></tr></thead>
          <tbody>${siens.map(b => `
            <tr>
              <td><b>${esc(b.id)}</b></td>
              <td class="mono dim">${esc(b.date)}</td>
              <td class="num dim">${b.lignes.reduce((t, l) => t + l.qte, 0)}</td>
              <td class="num" style="color:var(--prime,#D4763D);">${totalBon(b).toLocaleString('fr-FR')} $</td>
            </tr>`).join('')}</tbody>
        </table>`
        : `<p class="empty-note" style="margin-top:12px;">Aucun bon validé cette semaine${
             chef ? ' pour cette personne' : ''}.</p>`);

      if (top) {
        const html = magTableauProduits(parProduit, chef && cible !== magMoi()
          ? 'Ce qu\'il ou elle a le plus vendu' : 'Ce que vous vendez le plus');
        top.style.display = html ? '' : 'none';
        top.innerHTML = html;
      }
      return;
    }

    /* ---------- l'équipe entière ---------- */
    if (!semaine.length) {
      box.innerHTML = magSelecteur() + `<h3>Cette semaine</h3>
        <p class="empty-note" style="margin-top:10px;">Aucun bon validé cette semaine.</p>`;
      if (top) top.style.display = 'none';
      return;
    }

    const { parEmp, parProduit } = magDepouiller(semaine);
    const emps = [...parEmp.values()].sort((a, b) => b.ca - a.ca);
    const total = emps.reduce((s, e) => s + e.ca, 0);

    box.innerHTML = magSelecteur() + `
      <h3>Cette semaine <span class="mv-unit">${semaine.length} bon${semaine.length > 1 ? 's' : ''} · ${total.toLocaleString('fr-FR')} $</span></h3>
      <table class="gtable" style="margin-top:12px;">
        <thead><tr><th>Employé</th><th>Poste</th><th class="num">Bons</th><th class="num">Articles</th><th class="num">Chiffre</th><th class="num">Part</th></tr></thead>
        <tbody>${emps.map(e => `
          <tr class="mag-ligne-emp" data-mag-qui="${esc(e.nom)}" title="Voir le détail de ${esc(e.nom)}">
            <td><b>${esc(e.nom)}</b></td>
            <td class="dim">${esc(e.grade || '—')}</td>
            <td class="num">${e.bons}</td>
            <td class="num dim">${e.articles}</td>
            <td class="num" style="color:var(--prime,#D4763D);">${e.ca.toLocaleString('fr-FR')} $</td>
            <td class="num dim">${total ? Math.round(e.ca / total * 100) : 0} %</td>
          </tr>`).join('')}</tbody>
      </table>
      <p class="empty-note" style="margin-top:10px;">Cliquez sur une ligne pour ouvrir la fiche de la personne.</p>`;

    if (top) {
      top.style.display = '';
      top.innerHTML = magTableauProduits(parProduit, 'Ce qui part le plus');
    }
  }

  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'magQui') { magRecapChoix = e.target.value; renderMagRecap(); }
  });

  document.addEventListener('click', e => {
    const l = e.target.closest('[data-mag-qui]');
    if (!l) return;
    magRecapChoix = l.dataset.magQui;
    renderMagRecap();
  });

  function renderMagasin() { renderCommandes(); renderStock(); renderMagRecap(); }

  /* --- Interactions, toutes en délégation ---------------------------------- */
  document.addEventListener('click', e => {
    if (e.target.closest('#magStockAdd'))  { referencerProduit(); return; }

    /* Formulaire de bon, posé dans la page : tout passe par délégation, les
       lignes apparaissant et disparaissant au fil de la saisie. */
    const fb = e.target.closest('#magFormBon');
    if (fb) {
      if (e.target.closest('#mvBonCreer')) { creerBon(); return; }
      if (e.target.closest('#mvBonPlus')) {
        const corps = fb.querySelector('#mvBonLignes');
        corps.insertAdjacentHTML('beforeend', ligneBonHtml(magProduits(), corps.children.length));
        rafraichirBon(fb);
        return;
      }
      if (e.target.closest('.mv-bl-del')) {
        const corps = fb.querySelector('#mvBonLignes');
        /* Jamais zéro ligne : un formulaire sans ligne n'a plus rien à dire. */
        if (corps.children.length > 1) e.target.closest('tr').remove();
        rafraichirBon(fb);
        return;
      }
    }

    const f = e.target.closest('[data-mag-filtre]');
    if (f) {
      magFiltre = f.dataset.magFiltre;
      document.querySelectorAll('[data-mag-filtre]').forEach(c => c.classList.toggle('active', c === f));
      renderCommandes();
      return;
    }

    const st = e.target.closest('[data-bon-statut]');
    if (st) { const [id, v] = st.dataset.bonStatut.split('|'); statutBon(id, v); return; }

    const li = e.target.closest('[data-bon-ligne]');
    if (li) { ajouterLigneBon(li.dataset.bonLigne); return; }

    const ld = e.target.closest('[data-bon-ligne-del]');
    if (ld) {
      const [id, i] = ld.dataset.bonLigneDel.split('|');
      const bon = commandes.find(c => c.id === id);
      if (bon && bon.lignes.length > 1) { bon.lignes.splice(+i, 1); D().save('commandes'); }
      else toast('Un bon garde au moins une ligne — supprimez le bon entier.');
      return;
    }

    const bd = e.target.closest('[data-bon-del]');
    if (bd) {
      const i = commandes.findIndex(c => c.id === bd.dataset.bonDel);
      if (i >= 0) { D().note(`a supprimé le bon ${commandes[i].id}`); commandes.splice(i, 1); D().save('commandes'); }
      return;
    }

    const sd = e.target.closest('[data-stock-del]');
    if (sd) {
      const i = +sd.dataset.stockDel;
      if (stockData[i]) { D().note(`a retiré ${stockData[i].nom} du suivi de stock`); stockData.splice(i, 1); D().save('stock'); }
    }
  });

  /* Les quantités se corrigent directement dans le tableau. On enregistre à la
     sortie du champ et non à chaque frappe : sinon chaque chiffre tapé
     déclencherait une écriture réseau. */
  document.addEventListener('change', e => {
    const q = e.target.closest('[data-stock-qte]');
    const s = e.target.closest('[data-stock-seuil]');
    const cible = q || s;
    if (!cible) return;
    const i = +(q ? q.dataset.stockQte : s.dataset.stockSeuil);
    if (!stockData[i]) return;
    const v = Math.max(0, Math.round(Number(cible.value) || 0));
    if (q) stockData[i].qte = v; else stockData[i].seuil = v;
    D().note(`a ajusté le stock de ${stockData[i].nom}`);
    D().save('stock');
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'magSearch') renderCommandes();
    if (e.target.id === 'magStockSearch') renderStock();
    const fb = e.target.closest('#magFormBon');
    if (fb && e.target.closest('.mv-bl-qte, .mv-bl-prod')) rafraichirBon(fb);
  });

  document.addEventListener('change', e => {
    const fb = e.target.closest('#magFormBon');
    if (fb && e.target.closest('.mv-bl-prod')) rafraichirBon(fb);
  });

  window.MarloweCommandes = commandes;
  window.MarloweStock = stockData;


/* ==========================================================================
   COM RUNNER — le fil de l'équipe et la demande de retrait
   --------------------------------------------------------------------------
   Le fil n'est pas une messagerie instantanée : il passe par le même
   enregistrement que le reste du panel, et la synchronisation le rafraîchit
   toutes les quelques secondes. C'est suffisant pour se coordonner, et ça
   évite d'ouvrir une connexion permanente pour trois messages par jour.
   ========================================================================== */

  const comRunner = [];   /* {id, auteur, texte, quand, type} */
  const CR_MAX = 200;

  function moiSession() {
    const s = window.MarloweSession;
    return (s && s.name) || 'Anonyme';
  }

  function quandFR(d) {
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ------------------------------------------------------------------------
     LES RÉPONSES
     Un fil plat oblige à répéter « @Untel, oui » pour savoir de quoi on parle.
     Chaque message porte donc ses réponses — mais repliées : le fil doit rester
     une liste qu'on parcourt d'un coup d'œil, pas une conversation qui prend
     tout l'écran. Le compteur suffit à savoir qu'il y a quelque chose à lire.

     Deux états gardés en mémoire, jamais enregistrés : les fils ouverts et le
     brouillon en cours de frappe. Le fil se redessine à chaque synchronisation
     (toutes les quelques secondes) — sans ça, un message d'un collègue fermerait
     le fil qu'on est en train de lire et effacerait ce qu'on écrit.
     ------------------------------------------------------------------------ */
  const crOuverts = new Set();     /* ids des fils dépliés */
  let crRepondreA = null;          /* id du message dont la zone de réponse est ouverte */
  let crBrouillon = '';            /* ce qui est déjà tapé dedans */

  const crInitiales = nom => String(nom || '?').split(/\s+/).filter(Boolean)
    .map(w => w[0]).join('').slice(0, 2).toUpperCase();

  /* Qui peut retirer un message ou une réponse : son auteur, et le patron.
     Personne d'autre.

     La comparaison portait sur le pseudo affiché — deux personnes au même
     pseudo se seraient effacées mutuellement. L'identifiant Discord est
     désormais enregistré à la publication et fait foi ; le nom ne sert plus
     que de repli pour les messages écrits avant ce changement.

     À noter : c'est une règle d'interface. Le fil est enregistré d'un bloc,
     et le serveur ne sait pas distinguer un message d'un autre à l'intérieur —
     il vérifie seulement que la personne a le droit d'écrire dans le panel.
     La règle protège donc des maladresses, pas d'un acharné qui passerait par
     la console. Pour aller plus loin il faudrait une route par message côté
     serveur ; dis-le-moi si tu veux que je la fasse. */
  function crPeutSupprimer(entree) {
    const s = window.MarloweSession;
    if (!s) return true;                       /* hors connexion : rien n'est bridé */
    if (s.isPatron || s.isOwner) return true;
    if (entree && entree.par) return String(entree.par) === String(s.id);
    return !!(entree && entree.auteur === moiSession());
  }

  function crReponses(m) {
    return Array.isArray(m.rep) ? m.rep : [];
  }

  function crRepHtml(m, moi) {
    const reps = crReponses(m);
    const ouvert = crOuverts.has(m.id);
    const compose = crRepondreA === m.id;

    /* Le pied de message : répondre, et le compteur qui déplie. */
    const pied = `
      <div class="cr-pied">
        <button type="button" class="cr-lien" data-cr-rep="${esc(m.id)}">↩ Répondre</button>
        ${reps.length ? `<button type="button" class="cr-lien cr-cpt" data-cr-voir="${esc(m.id)}">
          ${reps.length} réponse${reps.length > 1 ? 's' : ''} ${ouvert ? '▾' : '▸'}</button>` : ''}
      </div>`;

    if (!ouvert && !compose) return pied;

    const liste = (ouvert && reps.length) ? `
      <div class="cr-reps">${reps.map(r => `
        <div class="cr-rep${r.auteur === moi ? ' cr-moi' : ''}">
          <span class="cr-av cr-av-p">${esc(crInitiales(r.auteur))}</span>
          <div class="cr-rep-corps">
            <div class="cr-rep-tete">
              <span class="cr-nom">${esc(r.auteur)}</span>
              <span class="cr-quand">${esc(r.quand)}</span>
              ${crPeutSupprimer(r)
                ? `<button class="icon-btn danger cr-x" data-cr-repdel="${esc(m.id)}|${esc(r.id)}"
                     title="Retirer cette réponse">×</button>` : ''}
            </div>
            <div class="cr-rep-texte">${esc(r.texte).replace(/\n/g, '<br>')}</div>
          </div>
        </div>`).join('')}</div>` : '';

    const saisie = compose ? `
      <div class="cr-rep-saisie">
        <textarea id="crRepTexte" rows="2" placeholder="Répondre à ${esc(m.auteur)}…">${esc(crBrouillon)}</textarea>
        <div class="btn-row" style="margin:0;">
          <button type="button" class="btn primary" data-cr-repenv="${esc(m.id)}">Répondre</button>
          <button type="button" class="btn" data-cr-repann>Annuler</button>
        </div>
      </div>` : '';

    return pied + liste + saisie;
  }

  function renderComRunner() {
    const fil = $('crFil');
    if (!fil) return;

    /* Le droit d'annoncer peut changer en cours de session — le patron coche
       un rôle dans Paramètres et la page ne recharge pas. On le relit à
       chaque dessin du fil plutôt qu'une seule fois au démarrage. */
    majBoutonDispo();

    if (!comRunner.length) {
      fil.innerHTML = `<div class="panel"><p class="empty-note" style="text-align:center;padding:24px;">
        Rien pour l'instant. Le fil se remplit tout seul : une demande de retrait,
        une disponibilité annoncée, et l'entrée s'inscrit ici.</p></div>`;
      return;
    }

    const moi = moiSession();

    fil.innerHTML = `<div class="panel"><div class="cr-fil">${comRunner.map(m => `
      <div class="cr-msg${m.type === 'retrait' ? ' cr-retrait' : ''}${m.auteur === moi ? ' cr-moi' : ''}">
        <div class="cr-tete">
          <span class="cr-av">${esc(crInitiales(m.auteur))}</span>
          <span class="cr-nom">${esc(m.auteur)}</span>
          <span class="cr-quand">${esc(m.quand)}</span>
          ${crPeutSupprimer(m)
            ? `<button class="icon-btn danger cr-x" data-cr-del="${esc(m.id)}" title="Retirer">×</button>` : ''}
        </div>
        <div class="cr-texte">${esc(m.texte).replace(/\n/g, '<br>')}</div>
        ${crRepHtml(m, moi)}
      </div>`).join('')}</div></div>`;

    /* Le champ vient d'être recréé : on lui rend le curseur et le brouillon. */
    if (crRepondreA) {
      const t = $('crRepTexte');
      if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
    }
  }

  function crEnvoyerReponse(id) {
    const champ = $('crRepTexte');
    const texte = (champ ? champ.value : crBrouillon).trim();
    if (!texte) return;

    const m = comRunner.find(x => x.id === id);
    if (!m) return;
    if (!Array.isArray(m.rep)) m.rep = [];
    m.rep.push({
      id: 'R' + Date.now().toString(36),
      auteur: moiSession(), par: (window.MarloweSession || {}).id || null,
      texte: texte.slice(0, 800),
      quand: quandFR(new Date()),
    });
    /* Une réponse ne remonte pas le message en tête du fil : le fil est un
       journal, pas une messagerie — l'ordre des publications ne bouge pas. */

    crBrouillon = '';
    crRepondreA = null;
    crOuverts.add(id);
    D().note('a répondu dans le Com Runner');
    D().save('comRunner');
  }

  /* Le champ « Un mot pour l'équipe… » et son envoi ont été retirés de la
     page : plus rien ne les appelait, ils partent avec. Les entrées de type
     « msg » déjà enregistrées continuent de s'afficher dans le fil, et on
     peut toujours y répondre. */

  /* --- La demande de retrait ------------------------------------------------
     Le nom n'est pas demandé : il vient de la session Discord. Le serveur
     recompose le message à partir de cette même identité, donc personne ne
     peut demander un retrait au nom d'un autre. */
  /* --- L'envoi vers le salon des runners ------------------------------------
     Deux voies, essayées dans cet ordre :

     1. la voie normale — jeton dans l'en-tête Authorization. Un en-tête
        personnalisé oblige le navigateur à envoyer d'abord une requête
        préparatoire (OPTIONS). C'est la forme propre, et c'est aussi celle
        qu'un bloqueur de publicité, un antivirus ou un réseau d'entreprise
        peut avaler sans le moindre message d'erreur exploitable.

     2. la voie de repli — requête « simple » au sens du navigateur : aucun
        en-tête personnalisé, donc aucune requête préparatoire, donc rien à
        bloquer. Le jeton voyage dans le corps, vers le même serveur, en
        HTTPS : la confidentialité est identique.

     L'adresse s'appelle /api/relais et non /api/discord : les listes de
     filtrage coupent volontiers toute adresse contenant « discord ». */
  const RELAIS = '/api/relais';

  async function postRelais(cfg, tok, charge) {
    try {
      const r = await fetch(cfg.API_BASE + RELAIS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify(charge),
      });
      return { res: r, voie: 'normale' };
    } catch (e) {
      const r = await fetch(cfg.API_BASE + RELAIS, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(Object.assign({}, charge, { token: tok })),
      });
      return { res: r, voie: 'repli' };
    }
  }

  async function demanderRetrait() {
    const cfg = (window.MarloweAuth && window.MarloweAuth.CONFIG) || {};
    let tok = null;
    try { tok = JSON.parse(localStorage.getItem('mv.token') || 'null'); } catch (e) {}

    const maintenant = new Date();
    const p = n => String(n).padStart(2, '0');

    /* Le domaine ne sort qu'une chose de sa cave : du vin. Détailler les
       cuvées dans une demande de retrait n'apporterait rien au runner, qui
       charge un volume, pas un catalogue. Le produit est donc fixe, et il ne
       reste à saisir que ce qui varie vraiment : combien, et pour quand. */
    const PRODUIT = 'Vin';

    const r = await askForm('Demander un retrait', [
      { key: 'quantite', label: 'Quantité', value: '1', type: 'number' },
      { key: 'heure',    label: 'Départ souhaité', value: `${p(maintenant.getHours())}:${p(maintenant.getMinutes())}` },
    ], `Vous demandez ${PRODUIT.toLowerCase()} au nom de ${moiSession()}. Le message part dans le salon Discord des runners et mentionne le rôle.`);
    if (!r) return;

    const produit = PRODUIT;
    const quantite = Math.max(1, Math.round(Number(r.quantite) || 0));

    /* Le message rejoint le fil dans tous les cas : même si Discord est
       injoignable, l'équipe voit la demande dans le panel. */
    comRunner.unshift({
      id: 'R' + Date.now().toString(36),
      auteur: moiSession(), par: (window.MarloweSession || {}).id || null,
      texte: `Demande de retrait — ${produit} ×${quantite}, départ vers ${r.heure}`,
      quand: quandFR(new Date()), type: 'retrait',
    });
    if (comRunner.length > CR_MAX) comRunner.length = CR_MAX;
    D().note(`a demandé un retrait (${produit} ×${quantite})`);
    D().save('comRunner');

    if (cfg.MODE !== 'discord' || !tok) {
      toast('Demande inscrite au fil. Discord non relié en mode test.');
      return;
    }

    try {
      const { res } = await postRelais(cfg, tok, { produit, quantite, heure: r.heure });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { toast('Demande envoyée sur Discord.'); return; }

      if (res.status === 503 && data.error === 'webhook_invalide') {
        alert("Le salon Discord est relié, mais l'adresse enregistrée n'en est pas une.\n\n"
            + "Depuis le dossier backend :\n\n"
            + "    npx wrangler secret put DISCORD_WEBHOOK\n\n"
            + "Au prompt, RIEN ne s'affiche pendant que vous collez : c'est normal, "
            + "la saisie est masquée. Collez une fois, puis Entrée.\n\n"
            + "La demande reste visible dans le fil ci-dessous.");
        return;
      }
      if (res.status === 503) {
        alert("Le salon Discord n'est pas encore relié.\n\n"
            + "Le patron doit créer un webhook dans le salon des runners "
            + "(Modifier le salon ▸ Intégrations ▸ Webhooks ▸ Nouveau webhook), "
            + "puis l'enregistrer côté serveur avec :\n\n"
            + "    npx wrangler secret put DISCORD_WEBHOOK\n\n"
            + "La demande reste visible dans le fil ci-dessous.");
        return;
      }
      toast(data.detail || `Discord a refusé l'envoi (${res.status}).`);
    } catch (e) {
      /* Un fetch qui LÈVE (au lieu de renvoyer un code d'erreur) veut dire que
         la requête n'est jamais partie. Neuf fois sur dix c'est le navigateur
         qui l'a bloquée : le serveur n'autorise que l'adresse publique du site,
         et le panel a été ouvert depuis un fichier local. Le dire évite de
         chercher du côté de Discord, qui n'y est pour rien. */
      const attendu = (() => { try { return new URL(cfg.API_BASE).origin && SITE_ATTENDU; }
                               catch (err) { return SITE_ATTENDU; } })();
      const ici = location.origin;
      console.warn('[Marlowe] envoi Discord bloqué :', e);

      if (ici !== attendu) {
        alert("La demande est bien inscrite dans le fil, mais elle n'a pas pu partir sur Discord.\n\n"
            + `Ce panel est ouvert depuis :  ${ici || 'un fichier local'}\n`
            + `Le serveur n'accepte que :    ${attendu}\n\n`
            + "Le navigateur bloque donc l'appel avant qu'il ne parte. Testez depuis le site en ligne "
            + "(poussez vos fichiers sur GitHub), pas depuis le fichier ouvert sur votre ordinateur.");
        return;
      }
      /* Les deux voies ont échoué depuis la bonne adresse : ce n'est plus une
         question d'origine, c'est que quelque chose entre le navigateur et
         Cloudflare coupe l'appel. Le bouton de diagnostic le nomme. */
      alert("La demande est inscrite dans le fil, mais elle n'a pas pu partir sur Discord.\n\n"
          + "L'appel n'est même pas sorti du navigateur — ni par la voie normale, ni par la voie de repli.\n"
          + "C'est presque toujours une extension (bloqueur de publicité, antivirus, filtre DNS) ou le\n"
          + "réseau qui coupe les adresses en .workers.dev.\n\n"
          + "Paramètres ▸ Règles du domaine ▸ « Tester le lien Discord » donne le détail.");
    }
  }

  /* L'inverse du retrait : un responsable annonce qu'il est là.
     ------------------------------------------------------------------------
     Aucun formulaire. Les responsables l'écrivaient à la main dans le salon,
     en une seconde ; un formulaire qui demande « jusqu'à quelle heure » leur
     ferait perdre le seul avantage du bouton. Le message est composé par le
     serveur à partir du nom de la session — on ne peut pas se déclarer
     disponible au nom d'un autre. */
  async function annoncerDispo() {
    const cfg = (window.MarloweAuth && window.MarloweAuth.CONFIG) || {};
    let tok = null;
    try { tok = JSON.parse(localStorage.getItem('mv.token') || 'null'); } catch (e) {}

    /* La confirmation recopie le message MOT POUR MOT. Un résumé approximatif
       ferait valider autre chose que ce qui part réellement dans le salon. */
    const ok = await confirmAction('Annoncer votre disponibilité',
      `Le salon Discord verra, avec la mention du rôle du domaine :\n\n`
      + `« ${moiSession()} est là pour vos bouteilles et vos avantages. `
      + `Passez récupérer ce qui vous revient. »\n\n`
      + 'Une annonce toutes les dix minutes au maximum.');
    if (!ok) return;

    /* Le fil garde la trace dans tous les cas — même Discord injoignable,
       l'équipe voit qui s'est annoncé et quand. */
    comRunner.unshift({
      id: 'D' + Date.now().toString(36),
      auteur: moiSession(), par: (window.MarloweSession || {}).id || null,
      texte: 'Disponible pour les bouteilles et les avantages',
      quand: quandFR(new Date()), type: 'dispo',
    });
    if (comRunner.length > CR_MAX) comRunner.length = CR_MAX;
    D().note('s\'est annoncé disponible');
    D().save('comRunner');
    renderComRunner();

    if (cfg.MODE !== 'discord' || !tok) {
      toast('Annonce inscrite au fil. Discord non relié en mode test.');
      return;
    }

    try {
      const res = await fetch(cfg.API_BASE + '/api/dispo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        /* Partie sans mention = partie sans réveiller personne. Le dire :
           c'est exactement le défaut qu'on avait déjà eu avec le rappel de
           permis parti sans son texte, et qui avait l'air d'un succès. */
        toast(data.mention === false
          ? 'Annonce envoyée — mais sans mention : le rôle à prévenir n\'est pas déclaré côté serveur.'
          : 'Annonce envoyée sur Discord.');
        return;
      }
      if (res.status === 404) {
        toast('Cette version du serveur ne connaît pas encore ce bouton — le Worker doit être redéployé.');
        return;
      }
      toast(data.detail || `Discord a refusé l'envoi (${res.status}).`);
    } catch (e) {
      console.warn('[Marlowe] annonce de disponibilité bloquée :', e);
      toast("L'annonce est dans le fil, mais l'appel n'est pas sorti du navigateur. "
          + 'Paramètres ▸ Règles du domaine ▸ « Tester le lien Discord ».');
    }
  }

  /* Le bouton n'existe à l'écran que pour ceux qui ont le droit de s'en
     servir : un bouton visible qui refuse est pire que pas de bouton. */
  function majBoutonDispo() {
    const b = document.getElementById('crDispo');
    if (!b) return;
    const S = window.MarloweSession || {};
    b.hidden = !(S.peutAnnoncerDispo || S.isPatron || S.isOwner);
  }

  document.addEventListener('click', e => {
    if (e.target.closest('#crRetrait')) { demanderRetrait(); return; }
    if (e.target.closest('#crDispo'))   { annoncerDispo(); return; }

    /* --- les réponses --- */
    const rep = e.target.closest('[data-cr-rep]');
    if (rep) {
      const id = rep.dataset.crRep;
      crRepondreA = (crRepondreA === id) ? null : id;
      crBrouillon = '';
      if (crRepondreA) crOuverts.add(id);
      renderComRunner();
      return;
    }

    const voir = e.target.closest('[data-cr-voir]');
    if (voir) {
      const id = voir.dataset.crVoir;
      if (crOuverts.has(id)) { crOuverts.delete(id); if (crRepondreA === id) crRepondreA = null; }
      else crOuverts.add(id);
      renderComRunner();
      return;
    }

    const env = e.target.closest('[data-cr-repenv]');
    if (env) { crEnvoyerReponse(env.dataset.crRepenv); return; }

    if (e.target.closest('[data-cr-repann]')) {
      crRepondreA = null; crBrouillon = '';
      renderComRunner();
      return;
    }

    const rd = e.target.closest('[data-cr-repdel]');
    if (rd) {
      const [mid, rid] = rd.dataset.crRepdel.split('|');
      const m = comRunner.find(x => x.id === mid);
      if (m && Array.isArray(m.rep)) {
        const i = m.rep.findIndex(r => r.id === rid);
        /* La règle est revérifiée ici : masquer le bouton ne suffit pas. */
        if (i >= 0 && !crPeutSupprimer(m.rep[i])) { toast('Seul son auteur peut retirer cette réponse.'); return; }
        if (i >= 0) {
          m.rep.splice(i, 1);
          D().note('a retiré une réponse du Com Runner');
          D().save('comRunner');
        }
      }
      return;
    }

    const d = e.target.closest('[data-cr-del]');
    if (d) {
      const i = comRunner.findIndex(m => m.id === d.dataset.crDel);
      if (i >= 0 && !crPeutSupprimer(comRunner[i])) { toast('Seul son auteur ou le patron peut retirer ce message.'); return; }
      if (i >= 0) { comRunner.splice(i, 1); D().note('a retiré un message du Com Runner'); D().save('comRunner'); }
    }
  });

  /* Le brouillon suit la frappe : le fil se redessine tout seul à chaque
     synchronisation, et sans ça ce qu'on écrit disparaîtrait en cours de route. */
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'crRepTexte') crBrouillon = e.target.value;
  });

  /* Entrée envoie, Maj+Entrée passe à la ligne : le réflexe d'une messagerie. */
  document.addEventListener('keydown', e => {
    if (e.target.id === 'crRepTexte' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (crRepondreA) crEnvoyerReponse(crRepondreA);
    }
  });

  window.MarloweComRunner = comRunner;


/* ==========================================================================
   ACCÈS EXTÉRIEURS — codes remis à des gens hors Discord
   --------------------------------------------------------------------------
   Le mot de passe n'est jamais renvoyé par le serveur : il n'y est même pas
   stocké, seule une empreinte l'est. Le patron le voit une fois, au moment de
   la création ; ensuite il ne peut que le réinitialiser.
   ========================================================================== */

  let invites = [];

  async function apiInvites(methode, corps) {
    const cfg = cfgAuth();
    const tok = jeton();
    if (!cfg.API_BASE || !tok) throw new Error('connectez-vous au panel');
    const res = await fetch(cfg.API_BASE + '/api/invites', {
      method: methode,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || ('erreur ' + res.status));
    return data;
  }

  function pagesDuPanel() {
    const A = window.MarloweAuth;
    return (A && A.PAGES) ? A.PAGES.filter(p => p.id !== 'parametres') : [];
  }

  function renderInvites() {
    const box = $('mvInvites');
    if (!box) return;

    const cfg = cfgAuth();
    if (cfg.MODE !== 'discord') {
      box.innerHTML = `<h3>Accès extérieurs</h3>
        <p class="mv-sub">Indisponible en mode test : ces accès vivent sur le serveur.</p>`;
      return;
    }

    box.innerHTML = `
      <div class="mv-vit-head" style="margin-bottom:6px;">
        <h3 style="margin:0;">Accès extérieurs <span class="mv-cpt">${invites.length} / 50</span></h3>
        <button class="btn primary" id="mvInvNew">+ Créer un accès</button>
      </div>
      <p class="mv-sub">Pour un comptable, un partenaire, quelqu'un qui n'est pas sur le Discord.
        Vous choisissez les pages qu'il voit, et vous pouvez couper l'accès à tout moment —
        la coupure est immédiate, même s'il est connecté.</p>

      ${invites.length ? `<div class="mv-inv-list">${invites.map(i => `
        <div class="mv-inv${i.actif ? '' : ' off'}">
          <div class="mv-inv-top">
            <div>
              <div class="mv-inv-nom">${esc(i.nom)}
                ${i.actif ? '' : '<span class="mag-statut mag-s-annulee">Suspendu</span>'}</div>
              <div class="mv-inv-code">${esc(i.code)}</div>
            </div>
            <div class="mv-inv-actions">
              <button class="btn" data-inv="pages" data-code="${esc(i.code)}">Pages…</button>
              <button class="btn" data-inv="mdp" data-code="${esc(i.code)}">Nouveau mot de passe</button>
              <button class="btn" data-inv="basculer" data-code="${esc(i.code)}">${i.actif ? 'Suspendre' : 'Réactiver'}</button>
              <button class="icon-btn danger" data-inv="supprimer" data-code="${esc(i.code)}" title="Supprimer">×</button>
            </div>
          </div>
          <div class="mv-inv-meta">
            ${i.pages.length ? `${i.pages.length} page${i.pages.length > 1 ? 's' : ''}`
                             : '<span class="mv-inv-rien">aucune page — il ne verra rien</span>'}
            ${i.ro && i.ro.length ? ` · ${i.ro.length} en lecture seule` : ''}
            · créé le ${esc(i.cree)}
            ${i.dernier ? ` · dernière visite ${esc(i.dernier)}` : ' · jamais connecté'}
          </div>
        </div>`).join('')}</div>`
      : `<p class="empty-note" style="margin-top:14px;">Aucun accès extérieur pour l'instant.</p>`}`;
  }

  async function chargerInvites() {
    /* La page des accès extérieurs se délègue maintenant : la bonne question
       n'est plus « est-ce le patron ? » mais « la page a-t-elle été
       construite ? ». Elle ne l'est que pour qui y a droit. */
    if (!document.getElementById('mvInvites')) return;
    if (cfgAuth().MODE !== 'discord') { renderInvites(); return; }
    try {
      const d = await apiInvites('GET');
      invites = d.invites || [];
    } catch (e) { invites = []; }
    renderInvites();
  }

  async function creerInvite() {
    const r = await askForm('Créer un accès extérieur', [
      { key: 'nom', label: 'Nom de la personne ou de la structure', value: '' },
      { key: 'mdp', label: 'Mot de passe (8 caractères minimum)', value: '' },
    ], "Le code sera tiré au sort par le serveur. Notez le mot de passe : il ne pourra plus être relu ensuite, seulement remplacé.");
    if (!r) return;

    try {
      const d = await apiInvites('PUT', { action: 'creer', nom: r.nom, mdp: r.mdp, pages: [], ro: [] });
      await chargerInvites();
      alert(`Accès créé.\n\nCode : ${d.code}\nMot de passe : ${r.mdp}\n\n`
          + `Transmettez les deux à ${r.nom}. Le mot de passe n'est pas conservé en clair : `
          + `s'il est perdu, il faudra en générer un nouveau.\n\n`
          + `Pensez maintenant à cocher les pages auxquelles il a droit — pour l'instant il n'en voit aucune.`);
      D().note(`a créé un accès extérieur pour ${r.nom}`);
    } catch (e) { alert('Création impossible : ' + e.message); }
  }

  async function pagesInvite(code) {
    const inv = invites.find(i => i.code === code);
    if (!inv) return;

    const pages = pagesDuPanel();
    const etat = new Map(pages.map(p => [p.id,
      inv.pages.includes(p.id) ? (inv.ro && inv.ro.includes(p.id) ? 'ro' : 'oui') : 'non']));

    const groupes = [...new Set(pages.map(p => p.group))];
    const html = groupes.map(g => `
      <div class="mv-invp-groupe">
        <div class="mv-invp-titre">${esc(g)}</div>
        ${pages.filter(p => p.group === g).map(p => `
          <button type="button" class="mv-invp" data-page="${esc(p.id)}" data-etat="${etat.get(p.id)}">
            <span class="mv-invp-e"></span>${esc(p.label)}
          </button>`).join('')}
      </div>`).join('');

    const choix = await askHtml(`Pages visibles — ${inv.nom}`, html,
      "Cliquez pour faire tourner les trois états : aucun accès, accès complet, lecture seule.");
    if (!choix) return;

    const ouiP = [], roP = [];
    choix.querySelectorAll('.mv-invp').forEach(b => {
      if (b.dataset.etat === 'oui') ouiP.push(b.dataset.page);
      if (b.dataset.etat === 'ro') { ouiP.push(b.dataset.page); roP.push(b.dataset.page); }
    });

    try {
      await apiInvites('PUT', { action: 'pages', code, pages: ouiP, ro: roP });
      D().note(`a modifié les accès de ${inv.nom}`);
      await chargerInvites();
      toast('Accès mis à jour.');
    } catch (e) { alert('Enregistrement impossible : ' + e.message); }
  }

  /* Une variante d'askForm qui accepte du HTML libre : la matrice de pages ne
     rentre pas dans une liste de champs. */
  /* `apres` reçoit la boîte une fois dessinée : c'est là qu'un formulaire
     vivant — une liste où l'on ajoute et retire des lignes — branche ses
     propres boutons. Sans ce crochet, chaque formulaire de ce genre devrait
     réécrire toute la mécanique de la boîte de dialogue. */
  function askHtml(titre, html, message, apres) {
    ensureDialog();

    /* La boîte est un élément unique, réutilisé d'une ouverture à l'autre.
       Or `apres` y accroche des écouteurs : les laisser en place les ferait
       s'empiler, et ceux de la fois précédente continueraient d'agir sur des
       lignes qui n'existent plus. On repart donc d'un élément neuf — un clone
       sans enfants ne porte aucun écouteur. */
    const vieux = dlg.querySelector('.mv-dlg');
    const d = vieux.cloneNode(false);
    d.removeAttribute('style');      /* une largeur posée par un formulaire précédent ne doit pas suivre */
    vieux.replaceWith(d);

    d.innerHTML = `<h3>${esc(titre)}</h3>${message ? `<p>${esc(message)}</p>` : ''}
      <div class="mv-invp-wrap">${html}</div>
      <div class="mv-dlg-btns"><button data-no>Annuler</button><button data-yes class="go">Enregistrer</button></div>`;
    dlg.style.display = 'flex';

    d.querySelectorAll('.mv-invp').forEach(b => b.addEventListener('click', () => {
      const suite = { non: 'oui', oui: 'ro', ro: 'non' };
      b.dataset.etat = suite[b.dataset.etat] || 'oui';
    }));

    if (typeof apres === 'function') apres(d);

    d.querySelector('[data-no]').onclick = () => close(null);
    d.querySelector('[data-yes]').onclick = () => close(d);
    return new Promise(r => { resolver = r; });
  }

  document.addEventListener('click', async e => {
    if (e.target.closest('#mvInvNew')) { creerInvite(); return; }
    const b = e.target.closest('[data-inv]');
    if (!b) return;
    const code = b.dataset.code, quoi = b.dataset.inv;
    const inv = invites.find(i => i.code === code);

    if (quoi === 'pages') { pagesInvite(code); return; }

    if (quoi === 'mdp') {
      const r = await askForm('Nouveau mot de passe', [
        { key: 'mdp', label: 'Mot de passe (8 caractères minimum)', value: '' },
      ], `Pour ${inv ? inv.nom : code}. L'ancien cessera de fonctionner immédiatement.`);
      if (!r) return;
      try {
        await apiInvites('PUT', { action: 'mdp', code, mdp: r.mdp });
        alert(`Nouveau mot de passe pour ${inv ? inv.nom : code} :\n\n${r.mdp}\n\nNotez-le, il ne sera plus relisible.`);
        D().note(`a changé le mot de passe de l'accès ${code}`);
      } catch (err) { alert('Impossible : ' + err.message); }
      return;
    }

    if (quoi === 'basculer') {
      try { await apiInvites('PUT', { action: 'basculer', code }); await chargerInvites(); }
      catch (err) { alert('Impossible : ' + err.message); }
      return;
    }

    if (quoi === 'supprimer') {
      if (!confirm(`Supprimer définitivement l'accès de ${inv ? inv.nom : code} ?`)) return;
      try {
        await apiInvites('PUT', { action: 'supprimer', code });
        D().note(`a supprimé l'accès extérieur ${code}`);
        await chargerInvites();
        toast('Accès supprimé.');
      } catch (err) { alert('Impossible : ' + err.message); }
    }
  });


  /* --- Diagnostic du lien Discord ------------------------------------------
     Quand un envoi échoue, le navigateur ne dit presque rien : « Failed to
     fetch » couvre aussi bien un blocage CORS qu'une extension, une coupure
     réseau ou un nom de domaine filtré. Ce bouton refait l'appel étape par
     étape et rapporte ce qui se passe RÉELLEMENT, au lieu de laisser deviner. */
  async function testerDiscord() {
    const cfg = cfgAuth();
    const tok = jeton();
    const L = [];
    const dire = (t, v) => L.push(`${t.padEnd(26, '.')} ${v}`);

    dire('Adresse du panel', location.origin || 'fichier local');
    dire('Adresse attendue', SITE_ATTENDU);
    dire('Concordance', location.origin === SITE_ATTENDU ? 'oui' : 'NON — le navigateur bloquera tout');
    dire('Mode', cfg.MODE || '—');
    dire('Adresse du serveur', cfg.API_BASE || '—');
    dire('Jeton de session', tok ? 'présent' : 'ABSENT — reconnectez-vous');

    /* 1. le serveur répond-il tout court ? */
    try {
      const r = await fetch(cfg.API_BASE + '/api/vitrine', { cache: 'no-store' });
      dire('Serveur joignable', `oui (${r.status})`);
    } catch (e) {
      dire('Serveur joignable', `NON — ${e.message}`);
      dire('', '');
      dire('Conclusion', "le serveur n'est pas atteignable du tout.");
      dire('', "Une extension de navigateur (bloqueur de pubs, filtre DNS)");
      dire('', "bloque souvent les adresses en .workers.dev. Réessayez en");
      dire('', "navigation privée, extensions désactivées.");
      alert(L.join('\n'));
      return;
    }

    /* 2. la requête préparatoire passe-t-elle ?
       /api/me porte un en-tête Authorization : le navigateur envoie donc
       d'abord un OPTIONS. Si CETTE étape passe, le contrôle d'origine est
       correctement réglé — et un échec plus loin ne peut plus être du CORS.
       C'est la mesure qui départage les deux causes. */
    let prepOk = false;
    try {
      const r = await fetch(cfg.API_BASE + '/api/me', { headers: { 'Authorization': 'Bearer ' + tok } });
      prepOk = true;
      dire('Requête préparatoire', 'passe');
      dire('Session valable', r.ok ? 'oui' : `NON (${r.status}) — reconnectez-vous`);
    } catch (e) {
      dire('Requête préparatoire', `BLOQUÉE — ${e.message}`);
      dire('Session valable', 'non vérifiable');
    }

    /* 3. l'envoi lui-même. On essaie les deux voies séparément pour savoir
       laquelle marche, au lieu de conclure au hasard. */
    let r = null, voie = null, erreurNormale = null, erreurRepli = null, brut = '';
    const charge = { produit: 'Test de liaison', quantite: 1, heure: '00:00' };

    try {
      r = await fetch(cfg.API_BASE + RELAIS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify(charge),
      });
      voie = 'normale';
    } catch (e) { erreurNormale = e.message; }

    if (!r) {
      try {
        r = await fetch(cfg.API_BASE + RELAIS, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify(Object.assign({}, charge, { token: tok })),
        });
        voie = 'repli';
      } catch (e) { erreurRepli = e.message; }
    }

    dire('Voie normale', erreurNormale ? `bloquée — ${erreurNormale}` : 'passe');
    if (erreurNormale) dire('Voie de repli', erreurRepli ? `bloquée — ${erreurRepli}` : 'passe');

    if (!r) {
      /* Rien ne sort, alors que /api/vitrine répond. Une requête simple ne
         peut pas être refusée par le contrôle d'origine — le navigateur
         l'envoie et lit seulement la réponse. Donc ce n'est pas du CORS. */
      dire('', '');
      dire('Conclusion', "aucune des deux voies ne sort du navigateur, alors");
      dire('', "que le serveur répond par ailleurs. Ce n'est pas un problème");
      dire('', "de réglage : c'est une extension (bloqueur de publicité,");
      dire('', "antivirus, filtre DNS) ou le réseau qui coupe l'adresse.");
      if (prepOk) {
        dire('', "");
        dire('', "(le contrôle d'origine est hors de cause : /api/me est passé,");
        dire('', " et il utilise exactement le même mécanisme.)");
      }
      dire('', "");
      dire('À faire', "rouvrez le panel en navigation privée, extensions");
      dire('', "désactivées, et refaites ce test. Si ça passe, c'est une");
      dire('', "extension : ajoutez marlowe-api.marlowe-vineyard.workers.dev");
      dire('', "à ses exceptions.");
    } else {
      const d = await r.json().catch(() => ({}));
      dire('Envoi Discord', `${r.status} ${d.error || (d.ok ? 'envoyé' : '')} (voie ${voie})`);
      if (d.detail) dire('Détail', d.detail);
      brut = d.detail || d.error || '';

      if (r.ok) {
        dire('', '');
        dire('Conclusion', 'tout fonctionne — un message de test est parti');
        dire('', 'dans le salon des runners.');
        if (voie === 'repli') {
          dire('', "La voie normale est bloquée mais le repli prend le relais");
          dire('', "automatiquement : rien à faire, les demandes partiront.");
        }
      } else if (r.status === 503 && d.error === 'webhook_invalide') {
        dire('', '');
        dire('Conclusion', "le secret existe, mais son contenu n'est pas une");
        dire('', "adresse de webhook. Réenregistrez-le :");
        dire('', '    cd backend');
        dire('', '    npx wrangler secret put DISCORD_WEBHOOK');
        dire('', "Au prompt, RIEN ne s'affiche pendant que vous collez —");
        dire('', "c'est normal, la saisie est masquée. Collez, Entrée.");
      } else if (r.status === 503) {
        dire('', '');
        dire('Conclusion', "le webhook n'est pas enregistré côté serveur.");
        dire('', 'Dans un terminal, depuis le dossier backend :');
        dire('', '    cd backend');
        dire('', '    npx wrangler secret put DISCORD_WEBHOOK');
        dire('', "puis collez l'adresse du webhook au prompt caché.");
      } else if (r.status === 429) {
        dire('', '');
        dire('Conclusion', 'trop de demandes coup sur coup. Attendez 30 s.');
      } else if (r.status === 401) {
        dire('', '');
        dire('Conclusion', 'session expirée — déconnectez-vous et reconnectez-vous.');
      } else if (r.status === 404) {
        dire('', '');
        dire('Conclusion', "le serveur ne connaît pas encore /api/relais.");
        dire('', 'Depuis le dossier backend : npx wrangler deploy');
      } else if (r.status === 500) {
        dire('', '');
        dire('Conclusion', "le serveur a planté pendant le traitement. Le");
        dire('', "détail ci-dessus est le message exact de l'erreur.");
        dire('', "Pour la voir en direct, depuis le dossier backend :");
        dire('', '    npx wrangler tail');
        dire('', "puis recliquez sur ce bouton.");
      } else if (r.status === 502) {
        dire('', '');
        dire('Conclusion', "Discord a refusé le message : le webhook a sans doute");
        dire('', 'été supprimé. Recréez-le et réenregistrez le secret.');
      }
    }

    /* Le message exact du serveur est répété en dernier : c'est la seule
       ligne qui permet de trancher, et une capture d'écran coupe toujours
       par le bas. */
    if (brut) {
      dire('', '');
      dire('>>> MESSAGE EXACT', String(brut).slice(0, 400));
    }

    alert(L.join('\n'));
    console.log('[Marlowe] diagnostic Discord\n' + L.join('\n'));
  }

  document.addEventListener('click', e => {
    if (e.target.closest('#mvTestDiscord')) testerDiscord();
  });


/* ==========================================================================
   LE PERMIS — la pastille et le rappel
   --------------------------------------------------------------------------
   La pastille se règle ici, dans le registre, comme n'importe quelle autre
   donnée de fiche. Le rappel, lui, ne part JAMAIS d'ici : le navigateur ne
   connaît que le n° civil, et c'est le Worker qui relit l'identifiant Discord
   en base, cherche le ticket et écrit. Un employé connecté ne peut donc pas
   faire écrire le domaine à qui il veut en bricolant sa requête.
   ========================================================================== */

  const PERMIS_ETATS = [undefined, true, false];   /* à renseigner → oui → non → … */

  function basculerPermis(civil) {
    const e = (typeof rhRosterData !== 'undefined' ? rhRosterData : [])
      .find(x => String(x.id) === String(civil));
    if (!e) return;

    const i = PERMIS_ETATS.findIndex(v => v === e.permis);
    const suivant = PERMIS_ETATS[(i < 0 ? 0 : i + 1) % PERMIS_ETATS.length];
    if (suivant === undefined) delete e.permis; else e.permis = suivant;

    /* Un statut qui ouvre des droits et que tout le monde peut retourner sans
       trace, c'est une dispute programmée. Chaque bascule part au journal. */
    const dit = suivant === true ? 'a déclaré le permis de' 
              : suivant === false ? 'a retiré le permis de'
              : 'a remis à « à renseigner » le permis de';
    D().note(`${dit} ${e.name}`);
    D().saveMany(['rhRoster']);
    if (typeof renderRhRoster === 'function') renderRhRoster(rhRosterData);
  }

  function estDemo() {
    const c = window.MarloweAuth && window.MarloweAuth.CONFIG;
    return !c || c.MODE !== 'discord';
  }

  const RAPPEL_DEFAUT_LOCAL =
    "Bonjour, ton permis n'est toujours pas enregistré au domaine. "
    + "Merci de le passer et de prévenir un RH pour qu'on mette ta fiche à jour.";

  function heureFr(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    /* Heure de Paris : le panel parle une seule heure, celle du domaine. */
    return d.toLocaleString('fr-FR',
      { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });
  }

  /* Ce que dit le panel quand le Worker refuse. Chaque cas a sa phrase : un
     « échec » générique laisse la personne devant un mur. */
  function phraseRefus(r) {
    const d = (r.data && r.data.detail) ? ' (' + r.data.detail + ')' : '';
    switch (r.data && r.data.error) {
      case 'sans_identifiant':
        return "Cette fiche n'a pas d'identifiant Discord — ouvrez-la et renseignez-le d'abord.";
      case 'trop_tot': {
        const t = r.data.dernier || {};
        return `Déjà rappelé ${heureFr(t.at) ? 'le ' + heureFr(t.at) : 'récemment'}`
             + (t.par ? ` par ${t.par}` : '') + '. Une relance par personne toutes les 24 h.';
      }
      case 'refus_salon':
        return `Le ticket #${r.data.salon} a été trouvé, mais Discord refuse d'y écrire : `
             + `il manque « Envoyer des messages » à l'application sur cette catégorie${d}.`;
      case 'aucun_canal':
      case 'prive_ferme':
        return `Aucun ticket ouvert, et les messages privés de cette personne sont fermés${d}. `
             + 'Rien n\'a été envoyé.';
      case 'inconnu':   return "Cette fiche n'existe plus dans le registre.";
      case 'forbidden': return "Vous n'avez pas le droit d'envoyer un rappel.";
      case 'config':    return r.data.detail || 'Les catégories de tickets ne sont pas déclarées.';
      case 'reseau':    return 'Le serveur du panel est injoignable. Rien n\'a été envoyé.';
      /* Le routeur du Worker rend « not_found » quand l'URL demandée ne
         correspond à aucune de ses routes. Ce n'est donc pas un refus : c'est
         un serveur plus ancien que le panel qui lui parle. Le dire, sinon on
         cherche une permission Discord qui n'est pas en cause. */
      case 'not_found':
        return 'Cette version du serveur ne connaît pas encore cette fonction. '
             + 'Le Worker doit être redéployé (cd backend && npx wrangler deploy), '
             + 'puis /api/version doit afficher la version attendue.';
      default:          return `Le serveur a refusé (${(r.data && r.data.error) || r.status})${d}.`;
    }
  }

  async function rappelerPermis(civil) {
    const e = (typeof rhRosterData !== 'undefined' ? rhRosterData : [])
      .find(x => String(x.id) === String(civil));
    if (!e) return;

    const A = window.MarloweAuth;

    /* Aperçu : quel salon, et un rappel a-t-il déjà été envoyé ? En démo il
       n'y a pas de serveur, on montre la fenêtre sans rien promettre. */
    let apercu = null;
    if (!estDemo() && A && A.apiBrut) {
      const r = await A.apiBrut('/api/rappel?civil=' + encodeURIComponent(civil));
      if (!r.ok) { toast(phraseRefus(r)); return; }
      apercu = r.data;
    }

    const defaut = (apercu && apercu.defaut)
      || (reglages && reglages.rappelPermis)
      || RAPPEL_DEFAUT_LOCAL;
    const dernier = apercu && apercu.dernier;
    const salon = apercu && apercu.salon;

    ensureDialog();
    dlg.querySelector('.mv-dlg').style.maxWidth = '';
    dlg.querySelector('.mv-dlg').innerHTML = `
      <h3>Rappeler le permis à ${esc(e.name)}</h3>
      <p>Le message part au nom du domaine, signé de votre pseudo Discord.
         La signature est recomposée par le serveur : personne ne peut écrire au nom d'un autre.</p>
      <div class="mv-rap-info">
        <div><span>Destinataire</span><b>${esc(e.name)} · ${esc(e.id)}</b></div>
        <div><span>Salon trouvé</span><b class="${salon ? 'ok' : 'non'}">${
          estDemo() ? '(démo — non vérifié)'
          : salon ? '#' + esc(salon.nom)
          : 'aucun ticket ouvert — message privé'}</b></div>
        <div><span>Dernier rappel</span><b>${dernier ? esc(heureFr(dernier.at) || '—') + (dernier.par ? ' · ' + esc(dernier.par) : '') : 'aucun'}</b></div>
      </div>
      <label for="mvRapTxt">Message</label>
      <textarea id="mvRapTxt" class="mv-rap-txt" rows="4">${esc(defaut)}</textarea>
      <p class="mv-rap-pied">Modifiable. Le texte par défaut se règle dans Administration ▸ Règles du domaine.
         Une relance par personne toutes les 24 h.</p>
      <div class="mv-dlg-btns">
        <button data-no>Annuler</button>
        <button data-yes class="go">Envoyer le rappel</button>
      </div>`;
    dlg.style.display = 'flex';
    const envoi = new Promise(r => { resolver = r; });
    dlg.querySelector('[data-no]').onclick = () => close(null);
    dlg.querySelector('[data-yes]').onclick = () => {
      const t = $('mvRapTxt');
      close(t ? t.value.trim() : '');
    };
    const texte = await envoi;
    if (texte === null) return;
    if (!texte) { toast('Un rappel vide ne sert à rien.'); return; }

    if (estDemo()) {
      toast(`(démo) Le rappel serait parti à ${e.name}.`);
      return;
    }

    const r = await A.apiBrut('/api/rappel', {
      method: 'POST',
      body: JSON.stringify({ civil: String(civil), texte }),
    });
    /* phraseRefus est commune à plusieurs pages : c'est ici, et seulement ici,
       qu'on sait qu'il s'agissait d'un rappel de permis. */
    if (!r.ok) { toast('Le rappel n\'est pas parti — ' + phraseRefus(r)); return; }
    toast(r.data.ou === 'ticket'
      ? `Rappel envoyé à ${e.name} dans #${r.data.salon}.`
      : `Aucun ticket ouvert : rappel envoyé à ${e.name} en message privé.`);
  }

  document.addEventListener('click', ev => {
    const p = ev.target.closest('[data-permis]');
    if (p) { basculerPermis(p.dataset.permis); return; }
    const r = ev.target.closest('[data-rappel]');
    if (r) {
      if (r.disabled) return;
      r.disabled = true;
      rappelerPermis(r.dataset.rappel).finally(() => { r.disabled = false; });
    }
  });


/* ==========================================================================
   QUOTA EN DIRECT — les ventes lues dans les logs Discord
   --------------------------------------------------------------------------
   Cette page ne calcule rien elle-même : elle demande au Worker, qui a lu le
   salon des logs et rangé chaque vente sous l'identifiant de son message.

   Elle est VOLONTAIREMENT à part du Tableau de bord, qui reste alimenté par
   la tablette collée à la main. Les deux chiffres ne se mélangent pas encore :
   tant qu'une semaine complète de logs réels n'a pas été observée, faire
   dépendre la clôture et les primes de cette lecture serait un pari. On
   regarde d'abord, on branche ensuite.

   Trois refus assumés, tous pour la même raison — un chiffre faux qui a l'air
   juste est pire qu'un tableau vide :

   · un flux qui s'est tu depuis un moment le DIT, en haut, en couleur ;
   · une vente dont le nom ne tombe sur aucune fiche n'est ni devinée ni
     jetée : elle est comptée à part, avec un bouton pour la rattacher ;
   · une erreur de lecture s'affiche telle que Discord l'a formulée.
   ========================================================================== */

  const QD_MUET_MIN = 45;              /* minutes sans log avant de s'inquiéter */
  let qdDonnees = null, qdFiltre = '', qdEnCours = false;

  /* Le même quota que partout ailleurs — celui des Règles du domaine. Cette
     page avait sa propre table en dur : régler le quota n'aurait rien changé
     ici, et les deux pages se seraient contredites. */
  function qdQuotaDe(poste) {
    return quotaDuGrade(poste);
  }

  /* Les bornes de la semaine — à l'heure de PARIS.
     -------------------------------------------------------------------------
     La semaine du domaine commence le lundi à minuit, heure de Paris, et pas
     à minuit chez celui qui regarde. Sans ça, deux personnes dans deux fuseaux
     verraient les mêmes ventes découpées différemment, et l'une des deux
     clôturerait sur des chiffres que l'autre ne retrouverait pas.

     mondayOf(), juste au-dessus, ne convient pas ici : elle répond à une
     question de CALENDRIER (« de quelle semaine relève le 21/08 ? ») sur des
     dates saisies en jj/mm/aaaa, où le fuseau n'a aucun sens. Ce qu'il faut
     ici est un INSTANT précis — la milliseconde où commence le lundi parisien
     — parce qu'on le compare à l'horodatage réel de messages Discord. Deux
     objets différents, deux fonctions.

     Le Worker filtre en « ts >= du ET ts < au ». Une semaine complète va donc
     du lundi 00 h 00 au lundi suivant 00 h 00 EXCLU — ce qui couvre très
     exactement jusqu'au dimanche 23 h 59 min 59 s 999. Pas de seconde perdue
     entre deux semaines, et aucune vente comptée deux fois. */
  const QD_JOUR = 24 * 3600 * 1000;
  const QD_FUSEAU = 'Europe/Paris';

  /* Le décalage de Paris à un instant donné. On lit l'heure murale parisienne
     dans un format ISO, on la relit comme si elle était en UTC : l'écart avec
     l'instant réel EST le décalage. Vaut +1 h l'hiver, +2 h l'été, sans qu'on
     ait à savoir quand bascule l'heure d'été. */
  function qdDecalageParis(t) {
    /* On tronque À LA SECONDE avant de comparer. Le format sv-SE ne rend pas
       les millisecondes : sans cette troncature, l'écart calculé emporterait
       le reste de millisecondes de t, et le lundi retombait 246 ms après
       minuit. Assez pour que « dimanche 23 h 59 » s'affiche « lundi » — c'est
       exactement ce qu'on a vu à l'écran. */
    const sec = Math.floor(t / 1000) * 1000;
    const mur = new Date(sec).toLocaleString('sv-SE', { timeZone: QD_FUSEAU });
    return Date.parse(mur.replace(' ', 'T') + 'Z') - sec;
  }

  /* Lundi 00 h 00 heure de Paris, en millisecondes epoch. */
  function qdLundi(semainesAvant) {
    const maintenant = Date.now();
    const d1 = qdDecalageParis(maintenant);

    /* On raisonne dans « l'heure de Paris lue comme de l'UTC », où les
       getters UTC donnent directement le jour et l'heure parisiens. */
    const mur = new Date(maintenant + d1);
    const jour = (mur.getUTCDay() + 6) % 7;              // lundi = 0
    mur.setUTCDate(mur.getUTCDate() - jour - 7 * (semainesAvant || 0));
    mur.setUTCHours(0, 0, 0, 0);

    /* Le décalage de ce lundi-là n'est pas forcément celui d'aujourd'hui :
       une semaine peut enjamber le passage à l'heure d'hiver. On le recalcule
       sur place. Minuit n'est jamais dans l'heure escamotée du changement
       (elle tombe un dimanche à 2 h), donc un seul tour suffit. */
    const approx = mur.getTime() - d1;
    return mur.getTime() - qdDecalageParis(approx);
  }

  function qdDateCourte(t) {
    return new Date(t).toLocaleDateString('fr-FR',
      { day: '2-digit', month: '2-digit', timeZone: QD_FUSEAU });
  }

  function qdBornes() {
    const v = ($('qdFenetre') || {}).value || 'semaine';
    const maintenant = Date.now();

    if (v === 'semaine') {
      const du = qdLundi(0);
      /* La borne haute est « maintenant » et non le dimanche à venir : rien
         n'a encore été vendu dans le futur, et afficher une fin de semaine
         qui n'existe pas laisserait croire que le compte est arrêté. */
      return { du, au: maintenant,
               titre: `Semaine en cours · du lundi ${qdDateCourte(du)} 00 h 00 à maintenant` };
    }
    if (v === 'derniere') {
      const du = qdLundi(1);
      const au = qdLundi(0);
      return { du, au,
               titre: `Semaine close · du lundi ${qdDateCourte(du)} 00 h 00 `
                    + `au dimanche ${qdDateCourte(au - 1)} 23 h 59` };
    }
    if (v === '0') return { du: 0, au: maintenant, titre: 'Depuis le premier log lu' };

    const j = Number(v) || 7;
    return { du: maintenant - j * QD_JOUR, au: maintenant,
             titre: j === 1 ? 'Les dernières 24 heures' : `Les ${j} derniers jours` };
  }

  function qdAge(iso) {
    if (!iso) return null;
    const t = typeof iso === 'number' ? iso : Date.parse(iso);
    if (!t) return null;
    return Math.round((Date.now() - t) / 60000);
  }

  function qdQuandCourt(ts) {
    if (!ts) return '—';
    const m = qdAge(ts);
    if (m === null) return '—';
    if (m < 1) return "à l'instant";
    if (m < 60) return `il y a ${m} min`;
    if (m < 1440) return `il y a ${Math.floor(m / 60)} h`;
    return new Date(ts).toLocaleDateString('fr-FR', { timeZone: QD_FUSEAU });
  }

  /* Le bandeau de fraîcheur. Un tableau qui affiche 161 000 alors que le flux
     est tombé il y a deux heures est pire qu'un tableau vide : il a l'air
     juste. C'est tout l'objet de ces trois lignes. */
  function qdBandeau(etat) {
    const el = $('qdBandeau');
    if (!el) return;
    el.className = 'qd-bandeau on';

    if (!etat || !etat.at) {
      el.classList.add('muet');
      el.innerHTML = '<b>Le flux n\'a jamais été lu.</b> Vérifiez que le salon des logs est déclaré '
        + 'et que l\'intention « Contenu des messages » est activée dans le portail développeur.';
      return;
    }
    if (etat.erreur) {
      el.classList.add('muet');
      el.innerHTML = `<b>La dernière lecture a échoué.</b> ${esc(etat.erreur)}`;
      return;
    }
    const min = qdAge(etat.at);
    if (min !== null && min > QD_MUET_MIN) {
      el.classList.add('muet');
      el.innerHTML = `<b>Le flux s'est tu.</b> Dernière lecture ${qdQuandCourt(Date.parse(etat.at))}. `
        + 'Les chiffres ci-dessous sont ceux de ce moment-là, pas de maintenant.';
      return;
    }
    if (min !== null && min > 6) {
      el.classList.add('tiede');
      el.innerHTML = `Dernière lecture ${qdQuandCourt(Date.parse(etat.at))}. Le passage automatique a lieu toutes les deux minutes.`;
      return;
    }
    el.classList.add('frais');
    el.innerHTML = `À jour — dernière lecture ${qdQuandCourt(Date.parse(etat.at))}`
      + (etat.ecartees ? ` · ${etat.ecartees} message(s) du salon écarté(s), hors ventes du domaine.` : '.');
  }

  function qdLigne(r) {
    const quota = qdQuotaDe(r.poste);
    const pct = quota > 0 ? Math.min(100, Math.round(r.vins / quota * 100)) : 0;
    const atteint = quota > 0 && r.vins >= quota;
    return `<tr>
      <td><b>${esc(r.nom)}</b>${r.via === 'alias' ? '<span class="qd-via">rattaché</span>' : ''}
        <div class="emp-id">#${esc(r.civil)}</div></td>
      <td class="poste-pill">${esc(r.poste || '—')}</td>
      <td class="num"><b>${r.vins.toLocaleString('fr-FR')}</b></td>
      <td class="num">${quota ? quota.toLocaleString('fr-FR') : '<span class="dash-cell">—</span>'}</td>
      <td>${quota ? `<div class="qd-jauge${atteint ? ' ok' : ''}"><i style="width:${pct}%"></i></div>
             <span class="qd-pct">${atteint ? '✓ atteint' : `${pct} % · ${(quota - r.vins).toLocaleString('fr-FR')} restants`}</span>`
           : '<span class="dash-cell">poste sans quota</span>'}</td>
      <td class="num">${r.ventes}</td>
      <td class="date-mono">${qdQuandCourt(r.dernier)}</td>
    </tr>`;
  }

  function qdOrpheline(o) {
    const noms = (typeof rhRosterData !== 'undefined' ? rhRosterData : [])
      .filter(f => f.status !== 'parti');
    return `<tr>
      <td><b>${esc(o.nom)}</b></td>
      <td class="num">${o.vins.toLocaleString('fr-FR')}</td>
      <td class="num">${o.ventes}</td>
      <td class="date-mono">${qdQuandCourt(o.dernier)}</td>
      <td style="text-align:right;">
        <select class="qd-sel" data-orph="${esc(o.cle)}">
          <option value="">— choisir une fiche —</option>
          ${noms.map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}
        </select></td>
    </tr>`;
  }

  function qdDessiner() {
    if (!qdDonnees) return;
    const { rattachees, orphelines, etat } = qdDonnees;
    qdBandeau(etat);

    const q = qdFiltre.toLowerCase();
    const vus = q ? rattachees.filter(r => (r.nom + ' ' + r.poste).toLowerCase().includes(q)) : rattachees;

    const corps = $('qdBody');
    if (corps) {
      corps.innerHTML = vus.length ? vus.map(qdLigne).join('')
        : `<tr><td colspan="7"><div class="mv-vide"><div class="mv-vide-t">${
            rattachees.length ? 'Aucun employé ne correspond à cette recherche.'
            : 'Aucune vente rattachée sur cette période. Si le salon en contient, regardez les lignes non rattachées ci-dessous.'
          }</div></div></td></tr>`;
    }

    const totalVins = rattachees.reduce((s, r) => s + r.vins, 0)
      + orphelines.reduce((s, o) => s + o.vins, 0);
    const totalPart = rattachees.reduce((s, r) => s + (r.part || 0), 0);
    const totalVentes = rattachees.reduce((s, r) => s + r.ventes, 0)
      + orphelines.reduce((s, o) => s + o.ventes, 0);
    const atteints = rattachees.filter(r => { const q2 = qdQuotaDe(r.poste); return q2 > 0 && r.vins >= q2; }).length;
    const avecQuota = rattachees.filter(r => qdQuotaDe(r.poste) > 0).length;

    const met = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    met('qdTotal', totalVins.toLocaleString('fr-FR'));
    met('qdAtteints', avecQuota ? `${atteints} / ${avecQuota}` : '—');
    met('qdPart', totalPart.toLocaleString('fr-FR') + ' $');
    met('qdVentes', totalVentes.toLocaleString('fr-FR'));
    met('qdTotalSub', orphelines.length
      ? `dont ${orphelines.reduce((s, o) => s + o.vins, 0).toLocaleString('fr-FR')} non rattachés`
      : 'tous rattachés à une fiche');
    met('qdPeriode', qdBornes().titre);

    const panneau = $('qdOrphPanel');
    if (panneau) {
      panneau.style.display = orphelines.length ? '' : 'none';
      const c = $('qdOrphCount');
      if (c) c.textContent = orphelines.length;
      const ob = $('qdOrphBody');
      if (ob) ob.innerHTML = orphelines.map(qdOrpheline).join('');
    }
  }

  async function renderQuotaDirect() {
    if (!$('qdBody') || qdEnCours) return;
    const A = window.MarloweAuth;
    if (estDemo()) {
      qdDonnees = qdDemo();
      qdDessiner();
      return;
    }
    qdEnCours = true;
    const { du, au } = qdBornes();
    const r = await A.apiBrut(`/api/quota?du=${du}&au=${au}`);
    qdEnCours = false;
    if (!r.ok) {
      qdDonnees = { rattachees: [], orphelines: [], etat: { erreur: phraseRefus(r) } };
      qdDessiner();
      return;
    }
    qdDonnees = r.data;
    qdDessiner();
  }

  /* En démo il n'y a pas de Worker. On montre à quoi ressemble la page pleine
     — y compris une ligne non rattachée, qui est le cas qu'on veut voir. */
  function qdDemo() {
    const base = (typeof rhRosterData !== 'undefined' ? rhRosterData : []).slice(0, 6);
    return {
      rattachees: base.map((f, i) => ({
        civil: String(f.id), nom: f.name, poste: f.poste,
        vins: [5338, 4120, 2870, 1640, 940, 332][i] || 0,
        brut: 0, part: ([5338, 4120, 2870, 1640, 940, 332][i] || 0) * 5,
        ventes: [7, 5, 4, 3, 2, 1][i] || 1,
        dernier: Date.now() - (i + 1) * 17 * 60000,
        via: i === 2 ? 'alias' : 'nom',
      })),
      orphelines: [{ cle: 'krimo guendouzi', nom: 'Krimo Guendouzi', vins: 54, ventes: 1,
                     dernier: Date.now() - 40 * 60000 }],
      etat: { at: new Date().toISOString(), lus: 120, gardees: 22, ecartees: 98, erreur: null },
    };
  }

  document.addEventListener('change', async ev => {
    const f = ev.target.closest('#qdFenetre');
    if (f) { renderQuotaDirect(); return; }

    const o = ev.target.closest('[data-orph]');
    if (o) {
      const civil = o.value;
      if (!civil) return;
      if (estDemo()) { toast('(démo) Le rattachement serait enregistré.'); return; }
      const r = await window.MarloweAuth.apiBrut('/api/alias', {
        method: 'POST', body: JSON.stringify({ cle: o.dataset.orph, civil }),
      });
      if (!r.ok) { toast(phraseRefus(r)); return; }
      toast('Rattaché — les ventes suivantes suivront toutes seules.');
      renderQuotaDirect();
      /* La ligne quitte les non rattachées : elle doit aussi quitter le
         bilan, où elle figurait en « hors registre ». */
      chargerOrphelinsBilan();
    }
  });

  document.addEventListener('input', ev => {
    if (!ev.target.closest('#qdSearch')) return;
    qdFiltre = ev.target.value || '';
    qdDessiner();
  });

  document.addEventListener('click', async ev => {
    if (!ev.target.closest('#qdRelire')) return;
    if (estDemo()) { toast('(démo) Le Worker relirait le salon.'); return; }
    const b = ev.target.closest('#qdRelire');
    b.disabled = true;
    const r = await window.MarloweAuth.apiBrut('/api/journaux', { method: 'POST' });
    b.disabled = false;
    if (!r.ok) { toast(phraseRefus(r)); return; }
    if (r.data && r.data.ok === false) { toast(r.data.erreur || 'La lecture a échoué.'); }
    else { toast(`${(r.data && r.data.gardees) || 0} vente(s) ajoutée(s).`); }
    renderQuotaDirect();
  });

  window.MarloweActions = {
    recomputeRecruiters, refreshEffectifCount, reprintInvoice,
    refreshWeekDays, refreshWeekHeaders, renderEligibilite, closeWeek, undoClose,
    renderBilan, renderWeekHistory, copyDetailGDoc, copyDepensesGDoc, elaguerDeparts,
    renderHistorique, renderPrimesExc, addPrimeExceptionnelle,
    renderCloture, renderEffectifHead, refreshEffectifFilters, applyEffectifFilter,
    verifierVersion, battementPresence, renderPresence, setZoom, toggleFullscreen,
    renderQuotas3, renderJournal, appliquerLectureSeule, remplirVides,
    renderMaSemaine, reinitialiserService,
    renderVitrine, renderCatalogues, appliquerAccesService, renderAvertissements, compteAvertissements,
    openInvoiceDoc, ouvrirFacturation, ouvrirFacturesRecues, prochainNumero, renderRegles, importerListeRH, analyserListeRH, modifierEmploye, estFormatRegistre,
    synchroniserEffectif, syncEffectifEtEnregistrer, renderMagasin, renderCommandes, renderStock, renderMagRecap, renderFormBon,
    renderComRunner, testerDiscord, renderQuotaService, renderPrimeRecrutement,
    renderTombola, ticketsDe, renderEntretien, renderDocuments,
    railConstruire, railSynchroniser, allerA,
    totalPrimeRecrutement, primeParRecrutement, primeRecruteurTotale,
    agendaVisible, AGENDA_NIVEAUX,
    basculerPermis, rappelerPermis, estIdDiscord, recruesSemaine, recruesSemaineDetail,
    clefNom,
    enregistrerAvertissement, niveauSuivant, notifierAvertissement,
    retrograderEmploye, avertirEmploye, actionSousQuota,
    renderQuotaDirect,
    /* Le collage de la tablette vit dans gestion.html, hors de cette portée :
       sans cet export il n'aurait que les fenêtres du navigateur pour parler. */
    toast,
    /* Rejoué quand le patron coche des rôles dans Administration ▸ Com Runner :
       le bouton doit apparaître ou disparaître sans recharger la page. */
    majBoutonDispo,
    /* Rejoué quand le patron change les listes de rôles dans Administration ▸ Agenda. */
    rafraichirAgenda() {
      if (typeof renderAgendaList === 'function') renderAgendaList();
      if (typeof renderWeekGrid === 'function') renderWeekGrid();
    },
  };

  window.MarloweClotureSteps = clotureSteps;

  window.MarloweBcManuels = bcManuels;
  window.MarlowePrimesExc = primesExc;
  window.MarloweBilanConfig = bilanConfig;
})();
