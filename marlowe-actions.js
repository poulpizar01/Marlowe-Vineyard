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

    D().save('blacklist');
    toast(`${name} a été ajouté à la blacklist.`);
  }

  async function removeBlacklist(index) {
    const i = Number(index);
    const b = blacklistData[i];
    if (!b) return;
    if (!await confirmAction('Retirer de la blacklist',
      `${b.name} pourra de nouveau être recruté au domaine.`, true)) return;
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
    D().save('facturesRecues');
    toast(`Facture de ${supplier} archivée.`);
  }

  async function deleteClient(name) {
    const i = clientsData.findIndex(c => c.name === name);
    if (i < 0) return;
    if (!await confirmAction('Retirer le client', `${name} sera retiré de la base clients.`, true)) return;
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
      { key: 'price', label: 'Prix HT — vide si rupture', value: a.price == null ? '' : a.price },
    ]);
    if (!r) return;
    a.desc = r.desc || a.desc;
    a.cat = r.cat || a.cat;
    a.poids = parseFloat(String(r.poids).replace(',', '.')) || a.poids;
    a.price = r.price === '' ? null : (parseFloat(String(r.price).replace(',', '.')) || 0);
    D().save('articles');
    toast('Article mis à jour.');
  }

  async function addArticle() {
    const cats = [...new Set(articlesData.map(x => x.cat))];
    const r = await askForm('Nouvel article', [
      { key: 'desc', label: 'Description', value: '' },
      { key: 'cat', label: 'Catégorie', value: cats[0], options: cats },
      { key: 'poids', label: 'Poids (kg)', value: '1.5' },
      { key: 'price', label: 'Prix HT — vide si rupture', value: '' },
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
    });

    /* Remise à zéro */
    effectifData.forEach(e => { e.barils = 0; e.distributed = false; });
    serviceHistory.length = 0;
    serviceActive = false;
    resetServiceButton();

    D().saveMany(['effectif', 'serviceHistory']);
    D().save('clotures', false);
    refreshWeekHeaders();
    renderEligibilite();
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

    clotures.weeks.shift();
    clotures.undo = null;

    D().saveMany(['effectif', 'serviceHistory']);
    D().save('clotures', false);
    refreshWeekHeaders();
    renderEligibilite();
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
        '[data-eff-promote],[data-eff-edit],[data-eff-del],[data-abs-del]');
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
    on('frArchiveBtn', archiveFactureRecue);
    on('invSaveBtn', saveInvoice);
    on('invPrintBtn', printCurrentInvoice);
    on('invResetBtn', resetInvoice);
    on('cloturerBtn', closeWeek);
    on('annulerClotureBtn', undoClose);

    /* Entrée dans le champ de nom = ajouter l'employé. */
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
    D().redraw('rhRecruiters');
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

  window.MarloweActions = {
    recomputeRecruiters, refreshEffectifCount, reprintInvoice,
    refreshWeekDays, refreshWeekHeaders, renderEligibilite, closeWeek, undoClose,
  };
})();
