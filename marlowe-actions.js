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

  /* ========================================================================
     BLACKLIST
     ======================================================================== */

  function newBlacklistId() {
    let id;
    do { id = 'BL-' + String(Math.floor(1000 + Math.random() * 9000)); }
    while (blacklistData.some(b => b.uid === id));
    return id;
  }

  /* Les entrées d'origine n'ont pas d'identifiant : on leur en attribue un
     au premier chargement, une seule fois. */
  function backfillBlacklistIds() {
    let changed = false;
    blacklistData.forEach(b => { if (!b.uid) { b.uid = newBlacklistId(); changed = true; } });
    if (changed) D().save('blacklist');
  }

  function addBlacklist() {
    const name = val('blNom');
    const reason = val('blRaison');
    if (!name) { toast('Indiquez un nom.'); return; }
    if (!reason) { toast('Indiquez une raison.'); return; }

    const iso = val('blDate');
    const date = iso ? iso.split('-').reverse().join('/') : todayFR();

    blacklistData.unshift({ uid: newBlacklistId(), name, reason, date, by: val('blBy') || '—' });
    clear('blNom', 'blRaison', 'blBy');

    D().save('blacklist');
    toast(`${name} a été ajouté à la blacklist.`);
  }

  async function removeBlacklist(uid) {
    const i = blacklistData.findIndex(b => b.uid === uid);
    if (i < 0) return;
    const b = blacklistData[i];
    if (!await confirmAction('Retirer de la blacklist',
      `${b.name} pourra de nouveau être recruté au domaine.`, true)) return;
    blacklistData.splice(i, 1);
    D().save('blacklist');
    toast('Entrée retirée.');
  }

  /* ========================================================================
     ÉLIGIBILITÉ
     ======================================================================== */
  function setDistributed(name, state) {
    const e = effectifData.find(x => x.name === name);
    if (!e) return;
    e.distributed = state;
    D().save('effectif');
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

  /* Réédite une facture de l'historique sous forme de document imprimable.
     La fenêtre d'impression du navigateur permet « Enregistrer au format PDF ». */
  function reprintInvoice(num) {
    const h = historiqueData.find(x => String(x.num) === String(num));
    if (!h) return;

    const w = window.open('', '_blank');
    if (!w) { toast('Le navigateur a bloqué la fenêtre. Autorisez les pop-ups.'); return; }

    w.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Facture n°${esc(h.num)} — Marlowe Vineyard</title>
<style>
  @page{margin:18mm;}
  body{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;margin:0;}
  /* Marges à l'écran seulement : à l'impression c'est @page qui les fixe. */
  @media screen{body{max-width:800px;margin:0 auto;padding:40px 32px;}}
  .head{display:flex;justify-content:space-between;align-items:flex-start;
    border-bottom:2px solid #8E7C4E;padding-bottom:18px;margin-bottom:28px;}
  .brand{font-size:24px;letter-spacing:2px;}
  .brand small{display:block;font-size:10px;letter-spacing:3px;color:#8E7C4E;
    text-transform:uppercase;font-family:Arial,sans-serif;margin-top:4px;}
  .meta{text-align:right;font-size:12px;line-height:1.9;font-family:Arial,sans-serif;}
  .meta b{font-size:16px;}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:2px;color:#8E7C4E;
    font-family:Arial,sans-serif;margin:0 0 10px;}
  .box{border:1px solid #ddd;padding:14px 16px;margin-bottom:28px;font-size:14px;}
  table{width:100%;border-collapse:collapse;font-size:14px;}
  th{text-align:left;font-family:Arial,sans-serif;font-size:11px;text-transform:uppercase;
    letter-spacing:1px;color:#666;border-bottom:1px solid #ccc;padding:9px 0;}
  td{padding:11px 0;border-bottom:1px solid #eee;}
  .num{text-align:right;}
  .total{margin-top:26px;text-align:right;font-size:20px;}
  .total span{font-size:11px;text-transform:uppercase;letter-spacing:2px;
    color:#8E7C4E;font-family:Arial,sans-serif;display:block;}
  footer{margin-top:44px;padding-top:14px;border-top:1px solid #ddd;
    font-size:10.5px;color:#777;font-family:Arial,sans-serif;text-align:center;}
</style></head><body>
  <div class="head">
    <div class="brand">MARLOWE VINEYARD<small>Tongva Hills · San Andreas</small></div>
    <div class="meta"><b>Facture n°${esc(h.num)}</b><br>Date : ${esc(h.date)}<br>Émetteur : ${esc(h.emetteur)}</div>
  </div>
  <h2>Client</h2>
  <div class="box">${esc(h.client)}</div>
  <h2>Détail</h2>
  <table>
    <thead><tr><th>Désignation</th><th class="num">Montant</th></tr></thead>
    <tbody><tr><td>Commande — facture n°${esc(h.num)}</td>
      <td class="num">${h.total.toLocaleString('fr-FR')} $</td></tr></tbody>
  </table>
  <div class="total"><span>Total TTC</span>${h.total.toLocaleString('fr-FR')} $</div>
  <footer>Facture réglée · Marlowe Vineyard — le vin qui fait parler tout San Andreas</footer>
<script>window.onload = function(){ window.print(); };<\/script>
</body></html>`);
    w.document.close();
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
        '[data-canva-del],[data-dash-del],[data-agenda-del]');
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
      if (d.agendaDel !== undefined) return deleteEvent(Number(d.agendaDel));
    });

    const on = (id, fn) => { const e = $(id); if (e) e.addEventListener('click', fn); };
    on('addEmpBtn', addEmployee);
    on('absBtn', declareAbsence);
    on('blAddBtn', addBlacklist);
    on('addClientBtn', addClient);
    on('addArticleBtn', addArticle);
    on('mvAddEvent', addEvent);

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

    backfillBlacklistIds();
    recomputeRecruiters();
    refreshEffectifCount();
    refreshClientCounts();
    refreshArticleCount();
    refreshFrCounts();
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

  window.MarloweActions = { recomputeRecruiters, refreshEffectifCount, reprintInvoice };
})();
