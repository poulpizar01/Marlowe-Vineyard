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
      .mv-dlg p{font-size:13px;line-height:1.6;color:var(--muted,#9C9384);margin:0 0 18px;}
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
  function confirmAction(title, message, danger) {
    ensureDialog();
    dlg.querySelector('.mv-dlg').innerHTML = `
      <h3>${esc(title)}</h3><p>${esc(message)}</p>
      <div class="mv-dlg-btns">
        <button data-no>Annuler</button>
        <button data-yes class="${danger ? 'danger' : 'go'}">${danger ? 'Supprimer' : 'Confirmer'}</button>
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

  const DEPT_BY_POSTE = {
    'Saisonnier': 'saisonnier',
    'Ouvrier viticole': 'terrain',
    'Chef de culture': 'terrain',
    'Vendeur': 'terrain',
    'Commercial': 'direction',
  };

  const TIER_BY_POSTE = {
    'Saisonnier': 'clay',
    'Ouvrier viticole': 'clay',
    'Chef de culture': 'bronze',
    'Vendeur': 'bronze',
    'Commercial': 'silver',
  };

  /* Recompte les recrutements de la SEMAINE EN COURS (lundi → dimanche)
     à partir des dates d'arrivée du registre. C'est un calcul, pas un
     compteur qu'on incrémente : impossible de le désynchroniser. */
  function recomputeRecruiters() {
    const now = new Date();
    const tally = new Map();

    rhRosterData.forEach(e => {
      const d = parseFR(e.date);
      if (!d || !sameWeek(d, now)) return;
      const rec = (e.rec || '—').trim();
      tally.set(rec, (tally.get(rec) || 0) + 1);
    });

    const rows = [...tally.entries()]
      .map(([name, n]) => ({ name, n }))
      .sort((a, b) => b.n - a.n);

    rhRecruiters.length = 0;
    rows.forEach(r => rhRecruiters.push(r));

    /* Sans recrutement cette semaine, le graphique n'aurait rien à dessiner. */
    if (!rhRecruiters.length) rhRecruiters.push({ name: 'Aucun recrutement cette semaine', n: 0 });

    const label = document.querySelector('#recruiterCard .card-title');
    if (label) label.textContent = 'Recruteurs de la semaine';
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
      discord: val('newEmpDiscord'),
    });

    recomputeRecruiters();
    refreshEffectifCount();
    clear('newEmpName', 'newEmpCivil', 'newEmpPhone', 'newEmpRib', 'newEmpDiscord', 'newEmpDate');
    const w = $('blWarning'); if (w) w.style.display = 'none';

    D().note(`a recruté ${name} au poste de ${poste}`);
    D().saveMany(['rhRoster', 'rhRecruiters']);
    toast(`${name} a rejoint le domaine.`);
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
      `${b.name} pourra de nouveau être recruté au domaine.`, true)) return;
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
      `Facture n°${h.num} — ${h.client} — ${h.total.toLocaleString('fr-FR')} $. Cette suppression est définitive.`, true)) return;
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
  const PAYMENT_DAYS = 14;         /* délai de paiement accordé aux clients   */

  /* Blason circulaire du domaine */
  const SVG_CREST = `
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="cg" cx="50%" cy="38%" r="65%">
      <stop offset="0%" stop-color="#2C5C46"/><stop offset="100%" stop-color="#14392C"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#E8CE85"/><stop offset="45%" stop-color="#C9A227"/>
      <stop offset="100%" stop-color="#8E6C15"/>
    </linearGradient>
  </defs>
  <circle cx="100" cy="100" r="96" fill="url(#gold)"/>
  <circle cx="100" cy="100" r="88" fill="url(#cg)"/>
  <circle cx="100" cy="100" r="82" fill="none" stroke="url(#gold)" stroke-width="1.6"/>
  <g fill="url(#gold)">
    <path d="M100 34c-11 15-11 28 0 40 11-12 11-25 0-40Z"/>
    <circle cx="78" cy="86" r="8"/><circle cx="100" cy="80" r="8"/><circle cx="122" cy="86" r="8"/>
    <circle cx="88" cy="102" r="8"/><circle cx="112" cy="102" r="8"/>
    <circle cx="100" cy="118" r="8"/>
  </g>
  <path d="M52 92c10 10 22 12 32 6M148 92c-10 10-22 12-32 6" stroke="url(#gold)"
        stroke-width="2.4" fill="none" stroke-linecap="round"/>
  <path d="M28 138h144l-14 20H42Z" fill="#14392C" stroke="url(#gold)" stroke-width="1.6"/>
  <text x="100" y="152" text-anchor="middle" font-family="Cinzel, Georgia, serif"
        font-size="15" font-weight="700" letter-spacing="1.4" fill="#E8CE85">MARLOWE</text>
  <text x="100" y="172" text-anchor="middle" font-family="Cinzel, Georgia, serif"
        font-size="10" letter-spacing="4" fill="#C9A227">VINEYARD</text>
</svg>`;

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
    const PARCHEMIN = new URL('img/parchemin.jpg', location.href).href;

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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,600&family=Great+Vibes&display=swap" rel="stylesheet">
<style>
  @page{size:A4;margin:0;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:#3A342A;font-family:'Cormorant Garamond',Georgia,serif;color:#4A3B22;}
  @media screen{body{padding:26px 0;}}

  .sheet{
    width:210mm;min-height:297mm;margin:0 auto;position:relative;overflow:hidden;
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

  .crest{width:23mm;margin:0 auto 2mm;}
  .crest svg{width:100%;height:auto;display:block;
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

  .bottom{position:absolute;left:24mm;right:24mm;bottom:28mm;z-index:3;
    display:flex;justify-content:flex-end;align-items:flex-end;gap:14mm;}
  .sig{font-family:'Great Vibes','Segoe Script','Brush Script MT','Apple Chancery',cursive;
    font-size:28pt;color:#3E3118;line-height:1;text-align:center;
    transform:rotate(-2deg);white-space:nowrap;}
  .sig small{display:block;font-family:'Cinzel',Georgia,serif;font-size:8.5pt;letter-spacing:.16em;
    color:#8A6E2A;transform:rotate(2deg);margin-top:2mm;}
  .totals{text-align:left;font-size:15pt;font-weight:700;line-height:1.6;color:#2C2210;white-space:nowrap;}
  .totals .fin{font-size:17.5pt;}
  .totals .tva{display:block;font-size:10pt;font-weight:600;color:#6E5526;margin-top:1mm;}

</style></head><body>
<div class="sheet">
  <img class="parch" src="${PARCHEMIN}" alt="">

  <div class="inner">
    <div class="crest">${SVG_CREST}</div>
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
        <b>Marlowe Vineyard</b><br>RIB : ${esc(MV_RIB)}
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
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 450); };<\/script>
</body></html>`);
    w.document.close();
  }

  /* Réédite une facture déjà enregistrée dans l'historique. */
  function reprintInvoice(num) {
    const h = historiqueData.find(x => String(x.num) === String(num));
    if (!h) return;
    openInvoiceDoc({ num: h.num, date: h.date, client: h.client, emetteur: h.emetteur, total: h.total });
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
      `(${inv.bouteilles.toLocaleString('fr-FR')} bouteille(s)). Elle rejoindra l'historique.`)) return;

    historiqueData.unshift({
      num: inv.num, date: inv.date, client: inv.client,
      total: inv.net, emetteur: inv.emetteur || '—',
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
      'Toutes les lignes saisies seront effacées.', true)) return;
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
    };

    let group = facturesRecuesData.find(g => g.supplier.toLowerCase() === supplier.toLowerCase());
    if (group) group.items.unshift(item);
    else facturesRecuesData.unshift({ supplier, items: [item] });

    clear('frSupplier', 'frMontant', 'frNote', 'frLien');
    refreshFrCounts();
    D().note(`a archivé une facture de ${supplier} (${item.montant.toLocaleString('fr-FR')} $)`);
    D().save('facturesRecues');
    toast(`Facture de ${supplier} archivée.`);
  }

  async function deleteClient(name) {
    const i = clientsData.findIndex(c => c.name === name);
    if (i < 0) return;
    if (!await confirmAction('Retirer le client', `${name} sera retiré de la base clients.`, true)) return;
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
      `${articlesData[i].desc} sera retiré du catalogue.`, true)) return;
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
      `${f.g.supplier} — ${f.item.montant.toLocaleString('fr-FR')} $ du ${f.item.date}.`, true)) return;
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
      `« ${s.title} » sera retiré du catalogue ${key === 'entreprise' ? 'entreprise' : 'citoyens'}.`, true)) return;

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
    if (!await confirmAction('Retirer la ligne', `${name} sera retiré du tableau de bord.`, true)) return;
    D().note(`a retiré ${name} du tableau de bord`);
    dash.splice(i, 1);
    D().save('dash');
    toast('Ligne retirée.');
  }

  /* ========================================================================
     AGENDA — ajouter / supprimer
     ======================================================================== */
  async function addEvent() {
    const r = await askForm('Nouvel événement', [
      { key: 'title', label: 'Titre', value: '' },
      { key: 'date', label: 'Date (jj/mm/aaaa)', value: todayFR() },
      { key: 'heure', label: 'Heure de début', value: '18:00' },
      { key: 'heure_fin', label: 'Heure de fin', value: '19:00' },
      { key: 'vis', label: 'Visibilité', value: 'public', options: ['public', 'prive', 'direction'] },
      { key: 'desc', label: 'Description', value: '' },
    ]);
    if (!r) return;
    if (!r.title) { toast('Le titre est obligatoire.'); return; }

    agendaData.push({
      title: r.title, date: r.date, heure: r.heure, heure_fin: r.heure_fin,
      vis: r.vis, desc: r.desc,
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
    if (!await confirmAction('Supprimer l\'événement', `« ${ev.title} » du ${ev.date}.`, true)) return;
    agendaData.splice(i, 1);
    D().save('agenda');
    toast('Événement supprimé.');
  }

  /* Le bouton d'ajout n'existe pas dans la page : on l'insère. */
  function injectAgendaButton() {
    const list = $('agendaList');
    if (!list || $('mvAddEvent')) return;
    const bar = document.createElement('div');
    bar.className = 'btn-row';
    bar.style.margin = '0 0 16px';
    bar.innerHTML = '<button class="btn primary" id="mvAddEvent">+ Ajouter un événement</button>';
    list.parentNode.insertBefore(bar, list);
  }

  /* ========================================================================
     EFFECTIF — promouvoir, modifier, retirer
     ======================================================================== */
  const NEXT_GRADE = {
    'Saisonnier':       { next: 'Ouvrier Viticole', quota: 5000, promoTarget: 8000, nextNext: 'Chef de Culture', final: false },
    'Ouvrier Viticole': { next: 'Chef de Culture',  quota: 8000, promoTarget: null, nextNext: null,              final: true },
  };

  async function promoteEmployee(name) {
    const e = effectifData.find(x => x.name === name);
    if (!e) return;
    const step = NEXT_GRADE[e.grade];
    if (!step) { toast('Ce grade est déjà le dernier du parcours.'); return; }

    if (!await confirmAction('Promouvoir',
      `${e.name} passe de ${e.grade} à ${step.next}. Son quota hebdomadaire devient ${step.quota.toLocaleString('fr-FR')} bouteilles.`)) return;

    e.grade = step.next;
    e.quota = step.quota;
    e.promoTarget = step.promoTarget;
    e.nextGrade = step.nextNext;
    e.isFinal = step.final;

    D().note(`a promu ${e.name} au grade de ${step.next}`);
    D().save('effectif');
    toast(`${e.name} est promu ${step.next}.`);
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
      `${name} ne sera plus suivi dans les quotas ni dans l'éligibilité.`, true)) return;
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
  function renderEligibilite() {
    const body = $('eligibiliteBody');
    if (!body) return;

    const w = lastClosedWeek();
    const rows = w ? w.eligibles
                   : effectifData.filter(e => e.active && e.barils >= e.quota)
                       .map(e => ({
                         name: e.name, grade: e.grade, barils: e.barils,
                         reward: (typeof rewardsByGrade === 'object' && rewardsByGrade[e.grade]) || '—',
                         distributed: e.distributed,
                       }));

    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('el-count', rows.length);
    set('el-distrib', rows.filter(r => r.distributed).length);
    set('el-pending', rows.filter(r => !r.distributed).length);

    const sub = document.querySelector('#page-eligibilite .page-sub');
    if (sub) {
      sub.textContent = w
        ? `Récompenses de la ${w.label.toLowerCase()} — du ${w.du} au ${w.au}, clôturée le ${w.closedAt}.`
        : 'Production de la semaine en cours — aucune semaine clôturée pour l\'instant.';
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
      : `<tr><td colspan="6" class="empty-note" style="padding:22px 0;">Personne n'a atteint son quota sur cette période.</td></tr>`;
  }

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
        + `prime = barils × multiplicateur, plafonné à 19 000 barils/semaine`;
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
       Primes            = barils × multiplicateur, plafonnées
       Dépenses          = salaires + primes + factures reçues
     ======================================================================== */

  const DIR_RANKS = () => (typeof bcDirectionRanks !== 'undefined' ? bcDirectionRanks : ['Patron', 'Co-Patron']);

  /* ------------------------------------------------------------------------
     LA formule de prime — une seule, partagée.
     Le fichier d'origine en contenait deux qui ne donnaient pas le même
     résultat : la page Primes plafonnait les barils puis multipliait, le
     bilan multipliait puis plafonnait la somme. Les deux plafonds existent
     bel et bien, ils s'appliquent donc l'un après l'autre :

         barils = runs / 5, écrêtés à PLAFOND (19 000 par semaine)
         prime  = barils × multiplicateur du grade
         prime  = min(prime, plafond de prime du palier)

     Toute modification de la règle se fait ici et nulle part ailleurs.
     ------------------------------------------------------------------------ */
  const PLAFOND_BARILS = (typeof PLAFOND !== 'undefined') ? PLAFOND : 19000;

  window.mvCalculPrime = function (runs, rang, palier) {
    const barils = Math.min(Math.round((runs || 0) / 5), PLAFOND_BARILS);
    const mult = (typeof multiplierFor === 'object' && multiplierFor[rang]) || 1;
    let prime = barils * mult;
    if (palier) {
      const dir = DIR_RANKS().includes(rang);
      prime = Math.min(prime, dir ? palier.primeDir : palier.primeEmp);
    }
    return Math.round(prime);
  };

  /* Lignes saisies à la main dans le bilan : elles ne viennent pas de la
     tablette, donc rien ne les régénère — sans stockage propre elles
     disparaissaient au rechargement. */
  const bcManuels = [];

  function rebuildBcRows() {
    if (typeof bcRows === 'undefined') return;
    const manuels = bcManuels.map(m => Object.assign({ manuel: true }, m));
    const auto = dash.map(e => ({
      name: e.name, rank: e.rank,
      runs: e.runs || 0, factures: e.factures || 0, ventes: e.ventes || 0,
      ca: (e.runs || 0) + (e.factures || 0) + (e.ventes || 0),
      salaire: (typeof bcRankSalaire === 'object' && bcRankSalaire[e.rank] !== undefined)
        ? bcRankSalaire[e.rank] : 1500,
    }));
    bcRows = auto.concat(manuels);
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
    const isDir = r => DIR_RANKS().includes(r);
    let idx = pickPalier(caTotal - rows.reduce((s, e) => s + (e.salaire || 0), 0) - autres);
    for (let pass = 0; pass < 2; pass++) {
      const p = bareme[idx] || { salEmp: 0, salDir: 0 };
      const sal = rows.reduce((s, e) => s + Math.min(e.salaire || 0, isDir(e.rank) ? p.salDir : p.salEmp), 0);
      idx = pickPalier(caTotal - sal - autres);
    }
    const palier = bareme[idx] || { taux: 0, salEmp: 0, salDir: 0, primeEmp: 0, primeDir: 0 };

    const detail = rows.map(e => {
      const dir = isDir(e.rank);
      const exc = primesExc.filter(x => x.nom === e.name).reduce((s, x) => s + x.montant, 0);
      const prime = window.mvCalculPrime(e.runs, e.rank, palier) + exc;
      return Object.assign({}, e, {
        prime: Math.round(prime),
        primeExc: exc,
        salairePlafonne: Math.round(Math.min(e.salaire || 0, dir ? palier.salDir : palier.salEmp)),
        isDir: dir,
      });
    });

    /* Primes accordées à quelqu'un qui n'est pas dans le tableau de bord */
    const nomsDetail = new Set(detail.map(e => e.name));
    const excHorsTableau = primesExc.filter(p => !nomsDetail.has(p.nom))
      .reduce((s, p) => s + p.montant, 0);

    const salaires = detail.reduce((s, e) => s + e.salairePlafonne, 0);
    /* La prime de recrutement ne dépend pas de la production hebdomadaire :
       elle s'ajoute au total, sinon la masse salariale serait sous-évaluée. */
    const primes = detail.reduce((s, e) => s + e.prime, 0) + excHorsTableau + totalPrimeRecrutement();
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
        <td>${esc(e.name)}</td>
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
    const ovEmpty = document.querySelector('#page-statsvue .ov-empty');
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
          <div class="mv-kpi-s">bouteilles · ${esc(best.label)}</div></div>
        <div class="mv-kpi"><div class="mv-kpi-l">Moyenne par semaine</div>
          <div class="mv-kpi-v">${moyenne.toLocaleString('fr-FR')}</div>
          <div class="mv-kpi-s">bouteilles</div></div>
        <div class="mv-kpi"><div class="mv-kpi-l">Production cumulée</div>
          <div class="mv-kpi-v accent">${cumul.toLocaleString('fr-FR')}</div>
          <div class="mv-kpi-s">depuis la première clôture</div></div>
        <div class="mv-kpi"><div class="mv-kpi-l">👑 Recordman</div>
          <div class="mv-kpi-v small">${record ? esc(record[0]) : '—'}</div>
          <div class="mv-kpi-s">${record ? record[1] + ' victoire(s) hebdo' : 'aucune victoire enregistrée'}</div></div>
      </div>

      <div class="grid2">
        <div class="panel"><h3>Production par semaine <span class="mv-unit">bouteilles</span></h3>
          ${barChart(serieProd, CHART.or, 'bouteilles')}</div>
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
      `${w.label} (${w.du} → ${w.au}) sera définitivement retirée. Cela n'annule pas la clôture, cela efface seulement son archive.`, true)) return;
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
    ])].sort();

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
      `${p.nom} — ${p.montant.toLocaleString('fr-FR')} $.`, true)) return;
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
  const PRESENCE_MS = 45000;
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
    ])].sort();

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
    ['rosterBody',        7,  "Aucun employé au registre — enregistrez une arrivée depuis Recrutement."],
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

  /* ========================================================================
     REPARTIR DE ZÉRO
     ------------------------------------------------------------------------
     Vider les données d'essai pour démarrer proprement, sans passer par une
     clôture — celle-ci archiverait justement ce qu'on veut jeter.

     Le catalogue d'articles et le barème d'imposition ne sont pas des
     données d'essai : ils sont proposés décochés.
     ======================================================================== */
  const GROUPES_RESET = [
    { id: 'rh',       label: 'Employés, départs, absences, recruteurs',
      cles: ['rhRoster', 'rhDeparts', 'rhAbsences', 'rhRecruiters'], defaut: true },
    { id: 'bl',       label: 'Blacklist',
      cles: ['blacklist'], defaut: true },
    { id: 'prod',     label: 'Production, éligibilité, tableau de bord',
      cles: ['effectif', 'dash', 'primesExc'], defaut: true },
    { id: 'commerce', label: 'Factures émises et reçues, clients',
      cles: ['historique', 'facturesRecues', 'clients', 'depenses', 'retraits'], defaut: true },
    { id: 'semaines', label: 'Semaines clôturées et historique',
      cles: ['clotures', 'clotureSteps'], defaut: true },
    { id: 'perso',    label: 'Prises de service, agenda, tombola',
      cles: ['serviceHistory', 'agenda', 'tombola'], defaut: true },
    { id: 'articles', label: 'Catalogue d\'articles et liens Canva',
      cles: ['articles', 'catalogueSlides'], defaut: false },
  ];

  async function repartirDeZero() {
    ensureDialog();
    dlg.querySelector('.mv-dlg').innerHTML = `
      <h3>Repartir de zéro</h3>
      <p>Vide les données choisies pour démarrer proprement. <b>Cette opération ne s'annule pas</b> —
         contrairement à une clôture, rien n'est archivé.</p>
      ${GROUPES_RESET.map(g => `
        <label class="mv-reset-l">
          <input type="checkbox" id="rz-${g.id}" ${g.defaut ? 'checked' : ''}>
          <span>${esc(g.label)}</span>
        </label>`).join('')}
      <p class="mv-reset-n">Le barème d'imposition, les grades et les quotas ne sont pas touchés :
         ce sont des règles, pas des données.</p>
      <div class="mv-dlg-btns">
        <button data-no>Annuler</button>
        <button data-yes class="danger">Vider</button>
      </div>`;
    dlg.style.display = 'flex';

    const choix = await new Promise(r => {
      resolver = r;
      dlg.querySelector('[data-no]').onclick = () => close(null);
      dlg.querySelector('[data-yes]').onclick = () => {
        close(GROUPES_RESET.filter(g => { const c = $('rz-' + g.id); return c && c.checked; }));
      };
    });
    if (!choix || !choix.length) return;

    const cles = choix.flatMap(g => g.cles);
    const confirme = await confirmAction('Confirmer le vidage',
      `${cles.length} collection(s) vont être vidées définitivement : ${
        choix.map(g => g.label.toLowerCase()).join(' · ')}.`, true);
    if (!confirme) return;

    cles.forEach(cle => {
      const r = D().ref(cle);
      if (Array.isArray(r)) r.length = 0;
      else if (r && typeof r === 'object') Object.keys(r).forEach(k => {
        if (Array.isArray(r[k])) r[k].length = 0; else delete r[k];
      });
    });

    /* Structures qui doivent rester présentes, même vides. */
    if (cles.includes('clotures')) { clotures.weeks = []; clotures.undo = null; }
    if (cles.includes('clotureSteps')) clotureSteps.done = [];
    if (cles.includes('catalogueSlides')) { catalogueSlides.entreprise = []; catalogueSlides.citoyens = []; }

    D().note(`a réinitialisé le panel (${choix.map(g => g.id).join(', ')})`);
    D().saveMany(cles, false);

    D().redrawAll();
    [renderBilan, renderEligibilite, renderHistorique, renderQuotas3, renderCloture,
     renderPrimesExc, renderWeekHistory, refreshEffectifFilters, recomputeRecruiters,
     refreshEffectifCount, refreshClientCounts, refreshArticleCount, refreshFrCounts,
     remplirVides].forEach(f => { try { f(); } catch (e) {} });

    toast('Panel réinitialisé.');
  }

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

      /* Effectif : la légende explicative passe au second plan. */
      #page-statseffectif .legend{opacity:.55;font-size:11px;margin-top:26px;
        transition:opacity .18s;}
      #page-statseffectif .legend:hover{opacity:1;}

      /* Sections repliables du menu. */
      .nav-section{cursor:pointer;user-select:none;display:flex;align-items:center;
        justify-content:space-between;gap:6px;}
      .nav-section::after{content:'▾';font-size:9px;opacity:.6;transition:transform .18s;}
      .nav-section.mv-collapsed::after{transform:rotate(-90deg);}
      .nav-item.mv-folded{display:none !important;}

      /* Barres de défilement discrètes, au lieu des grises par défaut. */
      .sidebar nav, .mv-matrix-wrap, .table-wrap, .content{scrollbar-width:thin;
        scrollbar-color:#4A4336 transparent;}
      .sidebar nav::-webkit-scrollbar, .mv-matrix-wrap::-webkit-scrollbar,
      .table-wrap::-webkit-scrollbar{width:8px;height:8px;}
      .sidebar nav::-webkit-scrollbar-track, .mv-matrix-wrap::-webkit-scrollbar-track,
      .table-wrap::-webkit-scrollbar-track{background:transparent;}
      .sidebar nav::-webkit-scrollbar-thumb, .mv-matrix-wrap::-webkit-scrollbar-thumb,
      .table-wrap::-webkit-scrollbar-thumb{background:#4A4336;border-radius:99px;}
      .sidebar nav::-webkit-scrollbar-thumb:hover, .mv-matrix-wrap::-webkit-scrollbar-thumb:hover,
      .table-wrap::-webkit-scrollbar-thumb:hover{background:var(--or-soft,#8E7C4E);}

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
      .mv-viewbar{margin:0 -16px;padding:10px 16px;border-top:1px solid var(--band,#3D372C);
        display:flex;align-items:center;gap:6px;}
      .mv-vb{width:26px;height:26px;border-radius:7px;border:1px solid var(--band,#3D372C);
        background:transparent;color:var(--muted,#9C9384);cursor:pointer;font-size:13px;
        line-height:1;display:flex;align-items:center;justify-content:center;transition:.15s;}
      .mv-vb:hover{color:var(--or,#C9A961);border-color:var(--or-soft,#8E7C4E);}
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

      .mv-reset-l{display:flex;align-items:center;gap:10px;padding:7px 0;font-size:13px;
        color:var(--parchment,#EDE3CF);cursor:pointer;}
      .mv-reset-l input{width:15px;height:15px;accent-color:var(--or,#C9A961);flex-shrink:0;}
      .mv-reset-n{font-size:11.5px;color:var(--muted,#9C9384);line-height:1.6;
        margin-top:14px;padding-top:12px;border-top:1px solid var(--band,#3D372C);}

      .table-wrap{overflow-x:auto;}

      .action-icons{white-space:nowrap;}
      .action-icons .icon-btn{margin-left:4px;}`;
    document.head.appendChild(st);
  }

  /* Replie une section du menu et retient l'état d'une visite à l'autre. */
  function setupCollapsibleNav() {
    const KEY = 'mv.navFolded';
    let folded = [];
    try { folded = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) {}

    const itemsOf = (sec) => {
      const out = [];
      let n = sec.nextElementSibling;
      while (n && !n.classList.contains('nav-section')) {
        if (n.classList.contains('nav-item')) out.push(n);
        n = n.nextElementSibling;
      }
      return out;
    };

    document.querySelectorAll('.sidebar .nav-section').forEach(sec => {
      const label = sec.textContent.trim();
      const apply = (on) => {
        sec.classList.toggle('mv-collapsed', on);
        itemsOf(sec).forEach(i => i.classList.toggle('mv-folded', on));
      };
      apply(folded.includes(label));

      sec.addEventListener('click', () => {
        const on = !sec.classList.contains('mv-collapsed');
        apply(on);
        folded = folded.filter(l => l !== label);
        if (on) folded.push(label);
        try { localStorage.setItem(KEY, JSON.stringify(folded)); } catch (e) {}
      });
    });
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
        '[data-eff-promote],[data-eff-edit],[data-eff-del],[data-abs-del],' +
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
      if (d.effEdit)       return editEffectif(d.effEdit);
      if (d.effDel)        return deleteEffectif(d.effDel);
      if (d.agendaDel !== undefined) return deleteEvent(Number(d.agendaDel));
    });

    const on = (id, fn) => { const e = $(id); if (e) e.addEventListener('click', fn); };
    on('addEmpBtn', addEmployee);
    on('absBtn', declareAbsence);
    on('blAddBtn', addBlacklist);
    on('addClientBtn', addClient);
    on('addArticleBtn', addArticle);
    on('mvAddEvent', addEvent);
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
    setupCollapsibleNav();
    wire();

    /* L'éligibilité doit être lue depuis la dernière semaine clôturée :
       on remplace la version du fichier d'origine. */
    window.renderEligibilite = renderEligibilite;

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
    renderWeekHistory();
    renderHistorique();
    renderCloture();
    refreshEffectifFilters();
    renderQuotas3();
    renderMagasin();
    renderComRunner();
    renderRegles();
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

  /* Un lien copié depuis le bouton « Partager » de Canva ne s'affiche PAS dans
     une page : Canva l'interdit, et le cadre reste blanc. Seule la forme
     « …/view?embed » est intégrable. On remet donc le lien en forme dès la
     saisie, pour que ça marche tout de suite dans le panel — le serveur refait
     la même chose de son côté, par sécurité. */
  function lienCanva(brut) {
    const t = String(brut || '').trim();
    if (!t) return '';
    let u;
    try { u = new URL(t); } catch (e) { return null; }
    if (u.hostname !== 'www.canva.com' && u.hostname !== 'canva.com') return null;
    const m = u.pathname.match(/^\/design\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    return `https://www.canva.com/design/${m[1]}/${m[2]}/view?embed`;
  }
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

  function renderVitrine() {
    const box = document.getElementById('mvVitrine');
    if (!box) return;

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
               placeholder="Lien Canva (facultatif) — collez l'adresse du design"
               value="${esc(vitrine.catEmbed || '')}">
        <p class="mv-hint">Avec un lien Canva, le catalogue s'affiche directement : rien à exporter.
          Le design doit être <b>partagé publiquement</b> dans Canva, sinon vos visiteurs verront une page vide.
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
               placeholder="Lien Canva entreprise (facultatif)"
               value="${esc(vitrine.entEmbed || '')}">
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
      const mauvais = [];
      [['mvCatEmbed', 'catEmbed', 'citoyens'], ['mvEntEmbed', 'entEmbed', 'entreprise']]
        .forEach(([id, cle, quoi]) => {
          const brut = (document.getElementById(id) || {}).value || '';
          const propre = lienCanva(brut);
          if (propre === null) { mauvais.push(quoi); return; }
          vitrine[cle] = propre;
        });

      if (mauvais.length) {
        alert("Le lien du catalogue " + mauvais.join(' et ')
          + " n'est pas une adresse Canva valide.\n\n"
          + "Attendu : une adresse qui commence par https://www.canva.com/design/…\n"
          + "Ouvrez le design, Partager, copiez le lien, et collez-le tel quel.");
        return;
      }
      sauverVitrine('Vitrine publiée');
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
   PRISE DE SERVICE — réservée aux postes de vente
   --------------------------------------------------------------------------
   Un saisonnier ne pointe pas : sa semaine se mesure en bouteilles, pas en
   heures. Le pointage ne concerne que la boutique et le commerce.
   ========================================================================== */

  const POSTES_SERVICE = [
    'Vendeur', 'Vendeuse', 'Assistant(e) magasin', 'Assistant magasin',
    'Assistante magasin', 'Resp. Magasin', 'Responsable Magasin', 'Commercial',
  ];

  /* Comparaison indulgente : « Resp. Magasin », « resp magasin » et
     « Responsable magasin » doivent tomber sur la même case. */
  const clefPoste = t => String(t || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^resp(onsable)?\b\.?/, 'resp')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  const SERVICE_OK = POSTES_SERVICE.map(clefPoste);

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
    const noms = (typeof rhRosterData !== 'undefined' ? rhRosterData : []).map(e => e.name);
    if (!noms.length) { toast("Le registre est vide — enregistrez d'abord un employé."); return; }

    const r = await askForm('Donner un avertissement', [
      { key: 'nom',    label: 'Employé', value: noms[0], options: noms },
      { key: 'niveau', label: 'Niveau', value: NIVEAUX[1], options: NIVEAUX },
      { key: 'motif',  label: 'Motif', value: '' },
      { key: 'date',   label: 'Date', value: todayFR() },
    ], "L'avertissement reste au dossier de l'employé et apparaît à côté de son nom dans le registre.");
    if (!r) return;
    if (!r.motif.trim()) { toast('Un avertissement sans motif ne sert à rien.'); return; }

    const s = window.MarloweSession;
    avertissements.unshift({
      nom: r.nom, niveau: r.niveau, motif: r.motif.trim(), date: r.date,
      par: (s && s.name) || 'Direction',
    });
    D().note(`a donné un avertissement à ${r.nom} (${r.niveau})`);
    D().saveMany(['avertissements', 'rhRoster']);
    toast(`Avertissement enregistré pour ${r.nom}.`);
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
    primeRecrutMontant: 0,  /* prime versée à une recrue de fin de semaine */
    primeRecrutQuota: 0,    /* bouteilles minimum pour y avoir droit */
  };

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
      <h3>Prime de recrutement
        <span class="mv-unit">${gagnants} sur ${recrues.length} · ${(gagnants * montant).toLocaleString('fr-FR')} $</span></h3>
      <p class="mv-sub" style="margin:6px 0 14px;">Arrivées entre jeudi et dimanche de la semaine en cours.
        ${seuil ? `Il faut ${seuil.toLocaleString('fr-FR')} bouteilles pour y avoir droit.` : 'Aucun quota exigé.'}</p>
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
      </table>`;
  }

  /* --- Le panneau de réglage, dans Paramètres --- */
  function renderReglages() {
    const box = $('mvReglages');
    if (!box) return;

    box.innerHTML = `
      <h3>Règles du domaine</h3>
      <p class="mv-sub">Deux règles que vous fixez une fois. Elles s'appliquent ensuite toutes seules,
        semaine après semaine, et survivent aux clôtures.</p>

      <div class="mv-vit-sec">
        <h4>Quota de prise de service</h4>
        <p class="mv-hint" style="margin:0 0 12px;">Pour les postes qui pointent — boutique et commerce —
          et qui ne sont donc pas jugés sur les bouteilles produites. Le compte se fait à partir des
          prises de service enregistrées dans « Ma semaine ». Laissez à 0 pour n'imposer aucun quota.</p>
        <div class="mv-vit-champs">
          <label class="mv-lab">Heures par semaine
            <input type="number" id="mvRegQuotaS" min="0" max="60" step="0.5" value="${reglages.quotaServiceH}">
          </label>
        </div>
      </div>

      <div class="mv-vit-sec">
        <h4>Prime de recrutement</h4>
        <p class="mv-hint" style="margin:0 0 12px;">Versée aux employés arrivés <b>entre le jeudi et le dimanche</b>
          de la semaine en cours, à condition d'avoir atteint le nombre de bouteilles indiqué. Ils n'ont que
          quelques jours pour produire : c'est la raison d'être de cette barre plus basse. Montant à 0 = prime désactivée.</p>
        <div class="mv-vit-champs">
          <label class="mv-lab">Montant de la prime ($)
            <input type="number" id="mvRegPrime" min="0" step="500" value="${reglages.primeRecrutMontant}">
          </label>
          <label class="mv-lab">Bouteilles minimum
            <input type="number" id="mvRegSeuil" min="0" step="100" value="${reglages.primeRecrutQuota}">
          </label>
        </div>
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
    if (!e.target.closest('#mvRegSave')) return;
    const n = id => { const el = $(id); return el ? Math.max(0, Number(el.value) || 0) : 0; };
    reglages.quotaServiceH      = n('mvRegQuotaS');
    reglages.primeRecrutMontant = Math.round(n('mvRegPrime'));
    reglages.primeRecrutQuota   = Math.round(n('mvRegSeuil'));
    D().note('a modifié les règles du domaine');
    D().save('reglages');
    const ok = $('mvRegSaved');
    if (ok) { ok.classList.add('on'); setTimeout(() => ok.classList.remove('on'), 1800); }
    toast('Règles enregistrées.');
  });

  function renderRegles() {
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

  const STATUTS = { attente: 'En attente', validee: 'Validée', annulee: 'Annulée' };
  let magFiltre = 'tous';

  function magProduits() {
    return (typeof articlesData !== 'undefined' ? articlesData : []);
  }

  function magPrix(a) {
    return window.mvPrixArticle ? window.mvPrixArticle(a, 'entreprise') : (a ? a.price : 0);
  }

  /* --- Bons de commande ---------------------------------------------------- */

  async function nouveauBon() {
    const arts = magProduits();
    if (!arts.length) { toast("Le catalogue d'articles est vide."); return; }

    const noms = (typeof rhRosterData !== 'undefined' ? rhRosterData : []).map(e => e.name);
    const moi = (window.MarloweSession && window.MarloweSession.name) || '';

    const r = await askForm('Nouveau bon de commande', [
      { key: 'employe', label: 'Employé', value: noms.includes(moi) ? moi : (noms[0] || moi),
        options: noms.length ? noms : undefined },
      { key: 'produit', label: 'Produit', value: arts[0].desc, options: arts.map(a => a.desc).slice(0, 200) },
      { key: 'qte',     label: 'Quantité', value: '1', type: 'number' },
    ], "Un bon peut contenir plusieurs produits : créez-le avec le premier, puis ajoutez les suivants depuis la ligne du bon.");
    if (!r) return;

    const art = arts.find(a => a.desc === r.produit);
    const qte = Math.max(1, Math.round(Number(r.qte) || 0));
    const pu = magPrix(art);

    const fiche = (typeof rhRosterData !== 'undefined' ? rhRosterData : []).find(e => e.name === r.employe);

    commandes.unshift({
      id: 'BC' + Date.now().toString(36).toUpperCase().slice(-6),
      date: todayFR(),
      employe: r.employe,
      grade: fiche ? fiche.poste : '—',
      lignes: [{ ref: art ? art.ref : '', nom: r.produit, pu, qte }],
      statut: 'attente',
    });
    D().note(`a créé un bon de commande pour ${r.employe}`);
    D().save('commandes');
    toast('Bon créé.');
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

    const q = ($('magSearch') && $('magSearch').value || '').toLowerCase().trim();
    const semaine = bonsDeLaSemaine();
    const validees = semaine.filter(b => b.statut === 'validee');

    const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set('magAttente', commandes.filter(b => b.statut === 'attente').length);
    set('magValidees', validees.length);
    set('magCA', validees.reduce((s, b) => s + totalBon(b), 0).toLocaleString('fr-FR') + ' $');

    const liste = commandes.filter(b => {
      if (magFiltre !== 'tous' && b.statut !== magFiltre) return false;
      if (!q) return true;
      return (b.employe + b.id + b.lignes.map(l => l.nom).join(' ')).toLowerCase().includes(q);
    });

    if (!liste.length) {
      box.innerHTML = `<div class="panel"><p class="empty-note" style="text-align:center;padding:22px;">
        ${commandes.length ? 'Aucun bon ne correspond à ce filtre.' : 'Aucun bon de commande — créez le premier avec « + Nouveau bon ».'}
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

  function renderMagRecap() {
    const box = $('magRecap');
    const top = $('magTopProduits');
    if (!box) return;

    const semaine = bonsDeLaSemaine().filter(b => b.statut === 'validee');

    if (!semaine.length) {
      box.innerHTML = `<h3>Cette semaine</h3>
        <p class="empty-note" style="margin-top:10px;">Aucun bon validé cette semaine.</p>`;
      if (top) top.style.display = 'none';
      return;
    }

    const parEmp = new Map();
    const parProduit = new Map();
    semaine.forEach(b => {
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

    const emps = [...parEmp.values()].sort((a, b) => b.ca - a.ca);
    const total = emps.reduce((s, e) => s + e.ca, 0);

    box.innerHTML = `
      <h3>Cette semaine <span class="mv-unit">${semaine.length} bon${semaine.length > 1 ? 's' : ''} · ${total.toLocaleString('fr-FR')} $</span></h3>
      <table class="gtable" style="margin-top:12px;">
        <thead><tr><th>Employé</th><th>Poste</th><th class="num">Bons</th><th class="num">Articles</th><th class="num">Chiffre</th><th class="num">Part</th></tr></thead>
        <tbody>${emps.map(e => `
          <tr>
            <td><b>${esc(e.nom)}</b></td>
            <td class="dim">${esc(e.grade || '—')}</td>
            <td class="num">${e.bons}</td>
            <td class="num dim">${e.articles}</td>
            <td class="num" style="color:var(--prime,#D4763D);">${e.ca.toLocaleString('fr-FR')} $</td>
            <td class="num dim">${total ? Math.round(e.ca / total * 100) : 0} %</td>
          </tr>`).join('')}</tbody>
      </table>`;

    if (top) {
      const prods = [...parProduit.values()].sort((a, b) => b.qte - a.qte).slice(0, 10);
      top.style.display = '';
      top.innerHTML = `
        <h3>Ce qui part le plus</h3>
        <table class="gtable" style="margin-top:12px;">
          <thead><tr><th>Produit</th><th class="num">Quantité</th><th class="num">Chiffre</th></tr></thead>
          <tbody>${prods.map(p => `
            <tr><td><b>${esc(p.nom)}</b></td>
              <td class="num">${p.qte.toLocaleString('fr-FR')}</td>
              <td class="num dim">${p.ca.toLocaleString('fr-FR')} $</td></tr>`).join('')}</tbody>
        </table>`;
    }
  }

  function renderMagasin() { renderCommandes(); renderStock(); renderMagRecap(); }

  /* --- Interactions, toutes en délégation ---------------------------------- */
  document.addEventListener('click', e => {
    if (e.target.closest('#magNouvelle'))  { nouveauBon(); return; }
    if (e.target.closest('#magStockAdd'))  { referencerProduit(); return; }

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

  function renderComRunner() {
    const fil = $('crFil');
    if (!fil) return;

    if (!comRunner.length) {
      fil.innerHTML = `<div class="panel"><p class="empty-note" style="text-align:center;padding:24px;">
        Rien pour l'instant. Le premier message lance le fil.</p></div>`;
      return;
    }

    const moi = moiSession();
    const patron = !!(window.MarloweSession && window.MarloweSession.isPatron);

    fil.innerHTML = `<div class="panel"><div class="cr-fil">${comRunner.map(m => `
      <div class="cr-msg${m.type === 'retrait' ? ' cr-retrait' : ''}${m.auteur === moi ? ' cr-moi' : ''}">
        <div class="cr-tete">
          <span class="cr-av">${esc(m.auteur.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>
          <span class="cr-nom">${esc(m.auteur)}</span>
          <span class="cr-quand">${esc(m.quand)}</span>
          ${(m.auteur === moi || patron)
            ? `<button class="icon-btn danger cr-x" data-cr-del="${esc(m.id)}" title="Retirer">×</button>` : ''}
        </div>
        <div class="cr-texte">${esc(m.texte).replace(/\n/g, '<br>')}</div>
      </div>`).join('')}</div></div>`;
  }

  function envoyerMessage() {
    const champ = $('crTexte');
    if (!champ) return;
    const texte = champ.value.trim();
    if (!texte) return;

    comRunner.unshift({
      id: 'M' + Date.now().toString(36),
      auteur: moiSession(), texte: texte.slice(0, 800),
      quand: quandFR(new Date()), type: 'msg',
    });
    /* Le fil est plafonné : sans ça il grossirait indéfiniment et finirait
       par dépasser la taille maximale d'enregistrement. */
    if (comRunner.length > CR_MAX) comRunner.length = CR_MAX;

    champ.value = '';
    D().note('a écrit dans le Com Runner');
    D().save('comRunner');
  }

  /* --- La demande de retrait ------------------------------------------------
     Le nom n'est pas demandé : il vient de la session Discord. Le serveur
     recompose le message à partir de cette même identité, donc personne ne
     peut demander un retrait au nom d'un autre. */
  async function demanderRetrait() {
    const cfg = (window.MarloweAuth && window.MarloweAuth.CONFIG) || {};
    let tok = null;
    try { tok = JSON.parse(localStorage.getItem('mv.token') || 'null'); } catch (e) {}

    const arts = (typeof articlesData !== 'undefined' ? articlesData : []);
    const maintenant = new Date();
    const p = n => String(n).padStart(2, '0');

    const r = await askForm('Demander un retrait', [
      { key: 'produit',  label: 'Produit', value: arts.length ? arts[0].desc : '',
        options: arts.length ? arts.map(a => a.desc).slice(0, 200) : undefined },
      { key: 'quantite', label: 'Quantité', value: '1', type: 'number' },
      { key: 'heure',    label: 'Départ souhaité', value: `${p(maintenant.getHours())}:${p(maintenant.getMinutes())}` },
    ], `Vous demandez au nom de ${moiSession()}. Le message part dans le salon Discord des runners et mentionne le rôle.`);
    if (!r) return;

    const produit = (r.produit || '').trim();
    const quantite = Math.max(1, Math.round(Number(r.quantite) || 0));
    if (!produit) { toast('Il faut préciser un produit.'); return; }

    /* Le message rejoint le fil dans tous les cas : même si Discord est
       injoignable, l'équipe voit la demande dans le panel. */
    comRunner.unshift({
      id: 'R' + Date.now().toString(36),
      auteur: moiSession(),
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
      const res = await fetch(cfg.API_BASE + '/api/discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ produit, quantite, heure: r.heure }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { toast('Demande envoyée sur Discord.'); return; }

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
      toast("Serveur injoignable — la demande reste dans le fil.");
    }
  }

  document.addEventListener('click', e => {
    if (e.target.closest('#crEnvoyer')) { envoyerMessage(); return; }
    if (e.target.closest('#crRetrait')) { demanderRetrait(); return; }

    const d = e.target.closest('[data-cr-del]');
    if (d) {
      const i = comRunner.findIndex(m => m.id === d.dataset.crDel);
      if (i >= 0) { comRunner.splice(i, 1); D().note('a retiré un message du Com Runner'); D().save('comRunner'); }
    }
  });

  /* Entrée envoie, Maj+Entrée passe à la ligne : le réflexe d'une messagerie. */
  document.addEventListener('keydown', e => {
    if (e.target.id !== 'crTexte') return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); envoyerMessage(); }
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
    if (!(window.MarloweSession && window.MarloweSession.isPatron)) return;
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
  function askHtml(titre, html, message) {
    ensureDialog();
    const d = dlg.querySelector('.mv-dlg');
    d.innerHTML = `<h3>${esc(titre)}</h3>${message ? `<p>${esc(message)}</p>` : ''}
      <div class="mv-invp-wrap">${html}</div>
      <div class="mv-dlg-btns"><button data-no>Annuler</button><button data-yes class="go">Enregistrer</button></div>`;
    dlg.style.display = 'flex';

    d.querySelectorAll('.mv-invp').forEach(b => b.addEventListener('click', () => {
      const suite = { non: 'oui', oui: 'ro', ro: 'non' };
      b.dataset.etat = suite[b.dataset.etat] || 'oui';
    }));

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

    /* 2. la session est-elle valable ? */
    try {
      const r = await fetch(cfg.API_BASE + '/api/me', { headers: { 'Authorization': 'Bearer ' + tok } });
      dire('Session valable', r.ok ? 'oui' : `NON (${r.status}) — reconnectez-vous`);
    } catch (e) {
      dire('Session valable', `échec — ${e.message}`);
    }

    /* 3. l'envoi lui-même, avec un message de test */
    try {
      const r = await fetch(cfg.API_BASE + '/api/discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        body: JSON.stringify({ produit: 'Test de liaison', quantite: 1, heure: '00:00' }),
      });
      const d = await r.json().catch(() => ({}));
      dire('Envoi Discord', `${r.status} ${d.error || (d.ok ? 'envoyé' : '')}`);
      if (d.detail) dire('Détail', d.detail);

      if (r.ok) {
        dire('', '');
        dire('Conclusion', 'tout fonctionne — un message de test est parti');
        dire('', 'dans le salon des runners.');
      } else if (r.status === 503) {
        dire('', '');
        dire('Conclusion', "le webhook n'est pas enregistré côté serveur.");
        dire('', 'Depuis le dossier backend :');
        dire('', 'npx wrangler secret put DISCORD_WEBHOOK');
      } else if (r.status === 429) {
        dire('', '');
        dire('Conclusion', 'trop de demandes coup sur coup. Attendez 30 s.');
      } else if (r.status === 401) {
        dire('', '');
        dire('Conclusion', 'session expirée — déconnectez-vous et reconnectez-vous.');
      } else if (r.status === 502) {
        dire('', '');
        dire('Conclusion', "Discord a refusé le message : le webhook a sans doute");
        dire('', 'été supprimé. Recréez-le et réenregistrez le secret.');
      }
    } catch (e) {
      dire('Envoi Discord', `bloqué — ${e.message}`);
      dire('', '');
      dire('Conclusion', "l'appel n'est jamais parti alors que le serveur");
      dire('', "répond par ailleurs. C'est le contrôle d'origine (CORS) :");
      dire('', "vérifiez que SITE_URL dans wrangler.toml vaut bien");
      dire('', SITE_ATTENDU + '/Marlowe-Vineyard');
      dire('', "puis relancez npx wrangler deploy.");
    }

    alert(L.join('\n'));
    console.log('[Marlowe] diagnostic Discord\n' + L.join('\n'));
  }

  document.addEventListener('click', e => {
    if (e.target.closest('#mvTestDiscord')) testerDiscord();
  });

  window.MarloweActions = {
    recomputeRecruiters, refreshEffectifCount, reprintInvoice,
    refreshWeekDays, refreshWeekHeaders, renderEligibilite, closeWeek, undoClose,
    renderBilan, renderWeekHistory, copyDetailGDoc, copyDepensesGDoc,
    renderHistorique, renderPrimesExc, addPrimeExceptionnelle,
    renderCloture, renderEffectifHead, refreshEffectifFilters, applyEffectifFilter,
    verifierVersion, battementPresence, renderPresence, setZoom, toggleFullscreen,
    renderQuotas3, renderJournal, appliquerLectureSeule, remplirVides, repartirDeZero,
    renderVitrine, renderCatalogues, appliquerAccesService, renderAvertissements, compteAvertissements,
    openInvoiceDoc, renderRegles, renderMagasin, renderCommandes, renderStock, renderMagRecap,
    renderComRunner, testerDiscord, renderQuotaService, renderPrimeRecrutement,
    totalPrimeRecrutement,
  };

  window.MarloweClotureSteps = clotureSteps;

  window.MarloweBcManuels = bcManuels;
  window.MarlowePrimesExc = primesExc;
  window.MarloweBilanConfig = bilanConfig;
})();
