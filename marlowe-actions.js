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
      { key: 'reason', label: 'Motif', value: 'Démission 0%',
        options: ['Démission 0%', 'Licenciement 10%', 'Licenciement 25%', 'Fin de saison', 'Abandon de poste'] },
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

  /* Grappe et feuillage, coin supérieur gauche */
  const SVG_GRAPES = `
<svg viewBox="0 0 200 180" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="lf" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#D9C169"/><stop offset="100%" stop-color="#8E7C2E"/>
    </linearGradient>
    <radialGradient id="bg1" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#6B4A6B"/><stop offset="100%" stop-color="#2B1B2E"/>
    </radialGradient>
  </defs>
  <g fill="url(#lf)" opacity=".95">
    <path d="M18 20c22-12 44-8 56 8-14 16-38 20-56 10-6-6-6-14 0-18Z"/>
    <path d="M8 52c24-8 46 0 54 18-18 12-42 10-56-4-3-6-2-12 2-14Z"/>
    <path d="M74 8c16 4 26 18 24 34-16 2-30-8-34-24-1-7 4-11 10-10Z"/>
  </g>
  <path d="M60 44c14 10 24 26 28 44" stroke="#8E7C2E" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  <g fill="url(#bg1)">
    <circle cx="96" cy="80" r="13"/><circle cx="122" cy="76" r="13"/>
    <circle cx="84" cy="102" r="13"/><circle cx="109" cy="99" r="13"/><circle cx="134" cy="95" r="13"/>
    <circle cx="96" cy="123" r="13"/><circle cx="121" cy="120" r="13"/>
    <circle cx="108" cy="143" r="13"/>
  </g>
  <g fill="#FFFFFF" opacity=".18">
    <circle cx="92" cy="75" r="4"/><circle cx="118" cy="71" r="4"/><circle cx="105" cy="94" r="4"/>
    <circle cx="92" cy="118" r="4"/><circle cx="104" cy="138" r="4"/>
  </g>
</svg>`;

  /* Paysage du domaine, en filigrane au bas de la page */
  const SVG_LANDSCAPE = `
<svg viewBox="0 0 900 300" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">
  <g fill="#8A6E3A">
    <path d="M0 210c120-40 220-30 330-8s210 26 330 2 240-24 240-24V300H0Z" opacity=".22"/>
    <path d="M0 244c150-34 280-18 400 4s250 22 500-10v62H0Z" opacity=".3"/>
  </g>
  <g stroke="#7A5F2E" stroke-width="2" opacity=".35" fill="none">
    <path d="M40 296c60-22 140-34 220-34"/><path d="M20 300c70-28 160-42 250-42"/>
    <path d="M620 262c90 0 170 12 240 34"/><path d="M640 258c90 0 180 14 250 42"/>
  </g>
  <g fill="#6E5526" opacity=".72">
    <path d="M330 300V196h30v104Z"/>
    <path d="M300 300v-74h180v74Z"/>
    <path d="M292 226 390 170l98 56Z"/>
    <path d="M322 186 360 164l38 22Z"/>
    <rect x="404" y="250" width="18" height="50"/><rect x="352" y="250" width="18" height="50"/>
    <rect x="330" y="206" width="14" height="16"/>
  </g>
  <g fill="#5E4A22" opacity=".66">
    <ellipse cx="250" cy="252" rx="16" ry="42"/><ellipse cx="286" cy="262" rx="12" ry="32"/>
    <ellipse cx="520" cy="256" rx="15" ry="38"/><ellipse cx="556" cy="266" rx="11" ry="28"/>
  </g>
  <g fill="#6E5526" opacity=".52">
    <ellipse cx="700" cy="272" rx="34" ry="26"/><rect x="694" y="272" width="12" height="28"/>
    <ellipse cx="180" cy="276" rx="30" ry="22"/><rect x="175" y="276" width="10" height="24"/>
  </g>
</svg>`;

  /* Ornement d'angle, retourné par CSS aux quatre coins */
  const SVG_CORNER = `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke="#8E6C15" stroke-width="2.4" stroke-linecap="round">
    <path d="M4 66C4 32 32 4 66 4"/>
    <path d="M14 70C14 42 42 14 70 14" opacity=".55"/>
    <path d="M26 52c-8-12-4-26 10-30 7 10 4 24-10 30Z"/>
    <path d="M52 30c12-6 26-2 30 10-12 5-26 2-30-10Z"/>
  </g>
  <path d="M26 52c-8-12-4-26 10-30 7 10 4 24-10 30Z" fill="#C9A227" fill-opacity=".38"/>
  <path d="M52 30c12-6 26-2 30 10-12 5-26 2-30-10Z" fill="#C9A227" fill-opacity=".34"/>
  <circle cx="40" cy="40" r="3.6" fill="#8E6C15"/>
</svg>`;

  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  /* Numéro au format du domaine : FAC-année-000012 */
  function invoiceRef(num, dateFR) {
    const year = (parseFR(dateFR) || new Date()).getFullYear();
    const digits = String(num).replace(/\D/g, '');
    return `FAC-${year}-${digits.padStart(6, '0')}`;
  }

  const money = n => Number(n || 0).toLocaleString('fr-FR') + '$';

  function openInvoiceDoc(inv) {
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
    const density = nRows > 24 ? 'micro' : (nRows > 18 ? 'tight' : (nRows > 12 ? 'dense' : ''));

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
    background:
      radial-gradient(ellipse 68% 52% at 50% 38%, rgba(252,243,214,.70), transparent 72%),
      radial-gradient(ellipse 130% 95% at 50% 106%, rgba(138,106,44,.34), transparent 62%),
      radial-gradient(ellipse 40% 30% at 8% 96%, rgba(138,106,44,.22), transparent 70%),
      linear-gradient(160deg,#E6D4A6 0%,#DDC894 38%,#D4BB82 70%,#C8AC70 100%);
    box-shadow:0 18px 60px rgba(0,0,0,.5);
  }
  @media print{.sheet{box-shadow:none;margin:0;}}

  /* Grain du papier */
  .sheet::after{
    content:'';position:absolute;inset:0;pointer-events:none;opacity:.30;
    background-image:
      radial-gradient(1px 1px at 12% 18%, rgba(120,95,45,.5), transparent),
      radial-gradient(1px 1px at 72% 34%, rgba(120,95,45,.4), transparent),
      radial-gradient(1px 1px at 38% 68%, rgba(120,95,45,.45), transparent),
      radial-gradient(1px 1px at 88% 82%, rgba(120,95,45,.4), transparent),
      radial-gradient(2px 2px at 55% 12%, rgba(140,110,55,.25), transparent),
      radial-gradient(2px 2px at 22% 88%, rgba(140,110,55,.25), transparent);
  }

  /* Encadrement doré */
  /* border-image laisse le centre transparent : le parchemin et le paysage
     restent visibles derrière le cadre. */
  .band{position:absolute;inset:0;z-index:4;pointer-events:none;border:9mm solid;
    border-image:linear-gradient(150deg,#8E6C15,#E8CE85 20%,#B8912F 42%,#EFDDA0 58%,#B8912F 76%,#8E6C15) 1;}
  .band::before{content:'';position:absolute;inset:2.5mm;border:1.1px solid rgba(122,95,46,.75);}
  .band::after{content:'';position:absolute;inset:4.5mm;border:.7px solid rgba(122,95,46,.4);}

  .corner{position:absolute;width:13mm;height:13mm;z-index:5;opacity:.9;}
  .corner svg{width:100%;height:100%;display:block;}
  .c-tl{top:10mm;left:10mm;}
  .c-tr{top:10mm;right:10mm;transform:scaleX(-1);}
  .c-bl{bottom:10mm;left:10mm;transform:scaleY(-1);}
  .c-br{bottom:10mm;right:10mm;transform:scale(-1,-1);}

  .inner{position:relative;z-index:2;padding:13mm 17mm 0;}

  .grapes{position:absolute;top:8mm;left:8mm;width:36mm;opacity:.95;z-index:5;}
  .grapes svg{width:100%;height:auto;display:block;}

  .crest{width:33mm;margin:0 auto 4mm;}
  .crest svg{width:100%;height:auto;display:block;
    filter:drop-shadow(0 4px 10px rgba(80,60,20,.35));}

  h1{font-family:'Cinzel',Georgia,serif;font-size:23pt;font-weight:600;letter-spacing:.09em;
    text-align:center;color:#9C7A1C;text-shadow:0 1px 0 rgba(255,250,230,.6);}
  h2{font-family:'Cormorant Garamond',Georgia,serif;font-size:28pt;font-weight:700;
    text-align:center;color:#3E3118;margin-top:1mm;}

  .rule{height:1px;background:linear-gradient(90deg,transparent,rgba(122,95,46,.55),transparent);
    margin:5mm 0 4mm;}

  .refs{display:flex;justify-content:space-between;align-items:flex-start;
    font-size:13pt;font-weight:600;line-height:1.75;color:#3B2E15;}
  .refs .r{text-align:right;padding-top:5mm;}

  /* Filigrane */
  .wm{position:absolute;top:97mm;left:0;right:0;text-align:center;z-index:1;
    font-family:'Cinzel',Georgia,serif;font-size:52pt;font-weight:700;letter-spacing:.08em;
    color:rgba(150,118,48,.34);}

  .parties{display:flex;justify-content:space-between;margin-top:7mm;
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
  tbody tr:first-child td{padding-top:3.4mm;}
  .spacer td{height:5mm;padding:0;}

  .bottom{position:absolute;left:17mm;right:17mm;bottom:15mm;z-index:3;
    display:flex;justify-content:space-between;align-items:flex-end;gap:8mm;}
  .sig{font-family:'Great Vibes','Segoe Script','Brush Script MT','Apple Chancery',cursive;font-size:35pt;color:#3E3118;line-height:1;
    transform:rotate(-2deg);white-space:nowrap;}
  .sig small{display:block;font-family:'Cinzel',Georgia,serif;font-size:8.5pt;letter-spacing:.16em;
    color:#8A6E2A;transform:rotate(2deg);margin-top:2mm;}
  .totals{text-align:left;font-size:15pt;font-weight:700;line-height:1.6;color:#2C2210;white-space:nowrap;}
  .totals .fin{font-size:17.5pt;}
  .totals .tva{display:block;font-size:10pt;font-weight:600;color:#6E5526;margin-top:1mm;}

  .landscape{position:absolute;left:0;right:0;bottom:0;height:100mm;z-index:1;opacity:.62;}
  .landscape svg{width:100%;height:100%;display:block;}
</style></head><body>
<div class="sheet">
  <div class="band"></div>
  <div class="corner c-tl">${SVG_CORNER}</div>
  <div class="corner c-tr">${SVG_CORNER}</div>
  <div class="corner c-bl">${SVG_CORNER}</div>
  <div class="corner c-br">${SVG_CORNER}</div>
  <div class="grapes">${SVG_GRAPES}</div>
  <div class="landscape">${SVG_LANDSCAPE}</div>
  <div class="wm">MV</div>

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

    <table class="${density}">
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

    let idx = weekDays.findIndex(d => d.date === today);
    if (idx < 0) idx = 0;

    const tabs = $('dayviewTabs');
    if (tabs) {
      tabs.innerHTML = weekDays.map((d, i) => `
        <div class="dayview-tab ${i === idx ? 'active' : ''}" data-idx="${i}">${d.label}<br>${d.date.slice(0, 5)}</div>
      `).join('');
    }
    if (typeof renderDayGrid === 'function') renderDayGrid(weekDays[idx]);
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

  function rebuildBcRows() {
    if (typeof bcRows === 'undefined') return;
    const manuels = bcRows.filter(r => r.rank === 'Manuel');
    const auto = dash.map(e => ({
      name: e.name, rank: e.rank,
      runs: e.runs || 0, factures: e.factures || 0, ventes: e.ventes || 0,
      ca: (e.runs || 0) + (e.factures || 0) + (e.ventes || 0),
      salaire: (typeof bcRankSalaire === 'object' && bcRankSalaire[e.rank] !== undefined)
        ? bcRankSalaire[e.rank] : 1500,
    }));
    bcRows = auto.concat(manuels);
  }

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
    const primes = detail.reduce((s, e) => s + e.prime, 0) + excHorsTableau;
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

  function renderPresence(data) {
    const sidebar = document.querySelector('.sidebar .mv-user');
    if (!sidebar) return;

    let box = $('mvPresence');
    if (!box) {
      box = document.createElement('div');
      box.id = 'mvPresence';
      box.className = 'mv-presence';
      sidebar.parentNode.insertBefore(box, sidebar);
    }

    const autres = (data.membres || []).filter(m => m.id !== data.moi);
    if (!autres.length) {
      box.innerHTML = `<div class="mv-pres-head"><span class="mv-pres-dot solo"></span>Vous êtes seul sur le panel</div>`;
      return;
    }

    box.innerHTML = `
      <div class="mv-pres-head"><span class="mv-pres-dot"></span>${autres.length} autre(s) en ligne</div>
      <div class="mv-pres-list">${autres.map(m => {
        const p = labelPage(m.page);
        const ini = m.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
        return `<div class="mv-pres-row" title="${esc(m.name)}${p ? ' — ' + esc(p) : ''}">
          <span class="mv-pres-av">${m.avatar ? `<img src="${esc(m.avatar)}" alt="">` : esc(ini)}</span>
          <span class="mv-pres-n">${esc(m.name)}</span>
          ${p ? `<span class="mv-pres-p">${esc(p)}</span>` : ''}
        </div>`;
      }).join('')}</div>`;
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
    ['bcDetailBody',      8,  "Aucune donnée de production — le tableau se remplit depuis le Tableau de bord."],
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

      /* --- Présence --- */
      .mv-presence{margin:0 -16px;padding:12px 16px;border-top:1px solid var(--band,#3D372C);
        font-size:11.5px;}
      .mv-pres-head{display:flex;align-items:center;gap:7px;color:var(--muted,#9C9384);
        font-size:10.5px;letter-spacing:.05em;margin-bottom:8px;}
      .mv-pres-dot{width:7px;height:7px;border-radius:50%;background:var(--vine,#6E8B5D);
        box-shadow:0 0 0 3px rgba(110,139,93,.18);flex-shrink:0;}
      .mv-pres-dot.solo{background:var(--band,#3D372C);box-shadow:none;}
      .mv-pres-list{display:flex;flex-direction:column;gap:6px;max-height:150px;overflow-y:auto;}
      .mv-pres-row{display:flex;align-items:center;gap:8px;min-width:0;}
      .mv-pres-av{width:20px;height:20px;border-radius:50%;flex-shrink:0;overflow:hidden;
        background:rgba(201,169,97,.15);border:1px solid var(--or-soft,#8E7C4E);
        display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:600;
        color:var(--or,#C9A961);}
      .mv-pres-av img{width:100%;height:100%;object-fit:cover;}
      .mv-pres-n{color:var(--parchment,#EDE3CF);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .mv-pres-p{margin-left:auto;color:var(--or-soft,#8E7C4E);font-size:10px;flex-shrink:0;
        max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

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

  const vitrine = { nouveautes: [], catTitre: '', catDesc: '', catPdf: '', catPages: [] };
  const NOUV_MAX = 5;
  const CAT_MAX  = 40;

  function cfgAuth() { return (window.MarloweAuth && window.MarloweAuth.CONFIG) || {}; }

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
        ${vitrine.catPdf ? `<p class="mv-pdf-ok">PDF joint — un bouton de téléchargement s'affiche sur le site.
            <button class="btn" id="mvCatPdfDel">Retirer</button></p>` : ''}
        <ul class="mv-page-list">${pages}</ul>
        <p class="mv-hint">Exportez votre catalogue en <b>PNG ou JPG</b> pour l'affichage — une image par page,
          dans l'ordre. Le PDF est facultatif : il sert uniquement au bouton de téléchargement.</p>
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

    if (e.target.closest('#mvCatPdfDel')) { vitrine.catPdf = ''; sauverVitrine('PDF du catalogue retiré'); return; }

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
      input.id === 'mvNouvFile' ? 'mvNouvAdd' : input.id === 'mvCatPdf' ? 'mvCatPdfBtn' : 'mvCatAdd');

    try {
      occupe(btn, true);
      if (input.id === 'mvNouvFile') {
        if (vitrine.nouveautes.length >= NOUV_MAX) throw new Error(NOUV_MAX + ' images au maximum');
        vitrine.nouveautes.push({ img: await envoyerFichier(files[0]), titre: '', texte: '' });
        sauverVitrine('Nouveauté ajoutée');

      } else if (input.id === 'mvCatPdf') {
        vitrine.catPdf = await envoyerFichier(files[0]);
        sauverVitrine('PDF du catalogue joint');

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

  document.addEventListener('mv:parametres-pret', renderVitrine);

  window.MarloweVitrine = vitrine;

  window.MarloweActions = {
    recomputeRecruiters, refreshEffectifCount, reprintInvoice,
    refreshWeekDays, refreshWeekHeaders, renderEligibilite, closeWeek, undoClose,
    renderBilan, renderWeekHistory, copyDetailGDoc, copyDepensesGDoc,
    renderHistorique, renderPrimesExc, addPrimeExceptionnelle,
    renderCloture, renderEffectifHead, refreshEffectifFilters, applyEffectifFilter,
    verifierVersion, battementPresence, setZoom, toggleFullscreen,
    renderQuotas3, renderJournal, appliquerLectureSeule, remplirVides, repartirDeZero,
    renderVitrine,
  };

  window.MarloweClotureSteps = clotureSteps;

  window.MarlowePrimesExc = primesExc;
  window.MarloweBilanConfig = bilanConfig;
})();
