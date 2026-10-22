/* Recovery – Gandhinagar Division · app (runs on GitHub Pages, talks to the Apps Script backend) */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var $app = document.getElementById('app');
  var S = {
    token: null, user: null, config: null,
    summary: null, cases: null,              // cached data, cleared after any entry
    unitTab: 'all', caseFilter: 'all', q: '',
    dash: { tab: 'all', sort: 'best', unit: 'all' },
    adminUnit: null, adminMonth: null,
    caseForm: 'update', caseData: null,
    installEvt: null
  };

  /* ================= helpers ================= */

  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function load(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
  function inr(n) { return '₹ ' + nf.format(Math.round((Number(n) || 0) * 100) / 100); }
  function amt(n) {
    n = Number(n) || 0; var a = Math.abs(n);
    if (a >= 1e7) return '₹ ' + (n / 1e7).toFixed(2) + ' Cr';
    if (a >= 1e5) return '₹ ' + (n / 1e5).toFixed(2) + ' L';
    return '₹ ' + nf.format(Math.round(n));
  }
  function pctText(p) {
    if (!isFinite(p)) return '–';
    var v = p * 100;
    return (v > 0 && v < 10 ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v))) + '%';
  }
  function dmy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : (iso || ''); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function enc(s) { return encodeURIComponent(s); }
  function fmtExtra(name, v) {
    if (/\((rs\.?|₹|inr)\)\s*$/i.test(name)) { var n = Number(String(v).replace(/[,₹\s]/g, '')); if (!isNaN(n) && String(v).trim() !== '') return inr(n); }
    return v;
  }
  function unitName(u) { var L = S.config && S.config.unitLabels; return (L && L[u]) || ('Unit ' + u); }
  function upDays() { return (S.config && S.config.updatedWithinDays) || 7; }
  function isAdmin() { return S.user && S.user.role === 'ADMIN'; }
  function isSTO() { return S.user && S.user.role === 'STO'; }

  var svg = function (d, w) { return '<svg aria-hidden="true" width="' + (w || 22) + '" height="' + (w || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>'; };
  var I = {
    back: svg('<path d="M15 18l-6-6 6-6"></path>'),
    out: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="M16 17l5-5-5-5"></path><path d="M21 12H9"></path>', 20),
    chev: svg('<path d="M9 18l6-6-6-6"></path>', 18),
    refresh: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path>', 20),
    search: svg('<circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path>', 18),
    install: svg('<path d="M12 3v12M7 10l5 5 5-5"></path><path d="M5 21h14"></path>', 18)
  };

  function toast(msg, ok) {
    var box = document.getElementById('toast');
    var el = document.createElement('div');
    el.className = 'msg ' + (ok ? 'ok' : 'err');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, ok ? 3500 : 7000);
  }

  function busy(btn, on, text) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>' + esc(text || 'Please wait…'); }
    else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  }

  function render(html, keepScroll) {
    var y = window.scrollY;
    $app.innerHTML = html;
    window.scrollTo(0, keepScroll ? y : 0);
  }

  function loadingView(title, back) {
    render(bar({ title: title, back: back }) + '<main><div class="loading"><div class="spin"></div></div></main>');
  }

  function errorView(title, back, err, retryAct) {
    render(bar({ title: title, back: back }) + '<main><div class="note err">' + esc(err.message || err) + '</div>' +
      '<button class="btn ghost" data-act="' + (retryAct || 'reload') + '">Try again</button></main>');
  }

  /* ================= backend ================= */

  function connected() { return CFG.API_URL && !/PASTE_/.test(CFG.API_URL); }

  function api(action, body) {
    if (!connected()) return Promise.reject(new Error('This app is not connected to its backend yet. Put the Web app URL in config.js.'));
    var payload = Object.assign({ action: action, token: S.token }, body || {});
    return fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(payload), redirect: 'follow' })
      .then(function (r) {
        if (!r.ok) throw new Error('Server problem (' + r.status + '). Please try again.');
        return r.json();
      }, function () { throw new Error('No connection. Check the internet and try again.'); })
      .then(function (j) {
        if (!j.ok) {
          if (j.error === 'SESSION_EXPIRED') { signOutLocal(); go('#/login'); throw new Error('Your session ended. Please sign in again.'); }
          throw new Error(j.error || 'Something went wrong.');
        }
        return j.data;
      });
  }

  function signOutLocal() {
    S.token = null; S.user = null; S.summary = null; S.cases = null; S.caseData = null;
    store('rec_token', null); store('rec_user', null);
  }

  function invalidate() { S.summary = null; S.cases = null; }

  function getSummary(force) {
    if (S.summary && !force) return Promise.resolve(S.summary);
    return api('r90.summary').then(function (d) { S.summary = d; return d; });
  }

  function getCases(force) {
    var unit = isAdmin() ? (S.adminUnit || '') : '';
    if (S.cases && !force && S.cases._unit === unit) return Promise.resolve(S.cases);
    return api('r90.cases', isAdmin() ? { unit: unit } : {}).then(function (d) { d._unit = unit; S.cases = d; return d; });
  }

  /* ================= figures ================= */

  function pick(row, tab) {
    if (tab === 'active') return row.a;
    if (tab === 'cancelled') return row.c;
    return { n: row.a.n + row.c.n, open: row.a.open + row.c.open, rec: row.a.rec + row.c.rec, upd: row.a.upd + row.c.upd, vis: row.a.vis + row.c.vis };
  }

  function total(rows, tab, rate) {
    var t = { n: 0, open: 0, rec: 0, upd: 0, vis: 0 };
    rows.forEach(function (r) { var x = pick(r, tab); t.n += x.n; t.open += x.open; t.rec += x.rec; t.upd += x.upd; t.vis += x.vis; });
    t.target = t.open * rate;
    t.ach = t.target > 0 ? t.rec / t.target : 0;
    return t;
  }

  function band(ach) { return ach >= 1 ? 'ok' : (ach < 0.5 ? 'warn' : 'mid'); }

  function meter(fraction, cls, thin) {
    var w = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    return '<div class="meter' + (thin ? ' thin' : '') + '"><div class="' + (cls || '') + '" style="width:' + w + '%"></div></div>';
  }

  /* ================= layout pieces ================= */

  function bar(o) {
    var left = o.back
      ? '<a class="iconbtn" href="' + o.back + '" aria-label="Back">' + I.back + '</a>'
      : '<img class="mark" src="assets/gst-mark-light.png" alt="Gujarat State Tax">';
    return '<header class="bar' + (o.seg ? ' has-seg' : '') + '">' + left +
      '<div class="titles"><span class="t1">' + esc(o.title) + '</span>' + (o.sub ? '<span class="t2">' + esc(o.sub) + '</span>' : '') + '</div>' +
      (o.right || '') + (o.seg || '') + '</header>';
  }

  function seg(name, current, options) {
    return '<div class="seg" role="group">' + options.map(function (o) {
      return '<button type="button" data-act="seg" data-name="' + name + '" data-val="' + o[0] + '" aria-pressed="' + (o[0] === current) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }

  function chips(name, current, options, square) {
    return '<div class="chips">' + options.map(function (o) {
      return '<button type="button" class="chip' + (square ? ' sq' : '') + '" data-act="chip" data-name="' + name + '" data-val="' + esc(o[0]) + '" aria-pressed="' + (String(o[0]) === String(current)) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }

  var TABS = [['active', 'Active'], ['cancelled', 'Cancelled'], ['all', 'All']];
  var TAB_LABEL = { active: 'Active cases', cancelled: 'Cancelled cases', all: 'All cases' };

  function figuresCard(title, t, extra) {
    var b = band(t.ach);
    return '<section class="card raised">' +
      '<div class="card-h"><h2 class="h2">' + esc(title) + '</h2><span class="small">' + t.n + ' cases</span></div>' +
      '<div class="stats">' +
      '<div class="stat"><span class="k">Pending (start of month)</span><span class="v">' + amt(t.open) + '</span></div>' +
      '<div class="stat gold"><span class="k">Target (10%)</span><span class="v">' + amt(t.target) + '</span></div>' +
      '<div class="stat ok"><span class="k">Recovered this month</span><span class="v">' + amt(t.rec) + '</span></div>' +
      '<div class="stat dark"><span class="k">Target achieved</span><span class="v">' + pctText(t.ach) + '</span></div>' +
      '</div>' + meter(t.ach, b === 'ok' ? 'ok' : (b === 'warn' ? 'warn' : '')) + (extra || '') + '</section>';
  }

  /* ================= routing ================= */

  function go(h) { if (location.hash === h) route(); else location.hash = h; }

  function route() {
    var parts = (location.hash || '#/').replace(/^#\/?/, '').split('/');
    if (!S.token) return parts[0] === 'admin-login' ? viewAdminLogin() : viewLogin();
    switch (parts[0]) {
      case 'r90':
        if (parts[1] === 'case') return viewCase(decodeURIComponent(parts.slice(2).join('/')));
        if (parts[1] === 'dash') return viewDash();
        return viewR90();
      case 'admin':
        return isAdmin() ? viewAdmin() : go('#/home');
      default:
        return viewHome();
    }
  }

  /* ================= sign in ================= */

  function viewLogin() {
    var c = S.config;
    if (!c) return viewNotConnected();
    var last = load('rec_last') || {};
    var unit = last.unit && c.units.indexOf(last.unit) >= 0 ? last.unit : c.units[0];
    render(
      '<div class="signin-top"><img src="assets/gst-lockup-tagline.png" alt="Gujarat State Tax"><div class="ruled"><span>Recovery</span></div>' +
      '<div class="sub" style="margin-top:-12px">' + esc(c.division) + '</div></div>' +
      '<main><form class="card" data-submit="login" autocomplete="on">' +
      '<div class="grid2"><div class="field"><label for="l-unit">Unit</label><select id="l-unit" name="unit" class="input" data-change="loginUnit">' +
      c.units.map(function (u) { return '<option value="' + u + '"' + (u === unit ? ' selected' : '') + '>' + unitName(u) + '</option>'; }).join('') +
      '</select></div><div class="field"><label for="l-charge">Charge</label><select id="l-charge" name="charge" class="input">' + chargeOptions(unit, last.charge) + '</select></div></div>' +
      '<div class="field"><label for="l-pin">PIN</label><input id="l-pin" name="pin" class="input pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" required></div>' +
      '<div class="field"><label for="l-name">Entering as (your name)</label><input id="l-name" name="name" class="input" autocomplete="name" maxlength="60" value="' + esc(last.name || '') + '" required></div>' +
      '<button class="btn block" type="submit">Sign in</button></form>' +
      '<div class="row" style="justify-content:center;flex-wrap:wrap"><a class="linkbtn" href="#/admin-login">Admin sign in</a>' + installBtn() + '</div>' +
      '<div style="text-align:center"><span class="pill"><i></i>Month open: ' + esc(c.monthLabel) + '</span></div></main>'
    );
  }

  function chargeOptions(unit, selected) {
    var list = (S.config.charges[unit] || []);
    if (!list.length) return '<option value="">No charges yet</option>';
    return list.map(function (ch) { return '<option' + (ch === selected ? ' selected' : '') + '>' + esc(ch) + '</option>'; }).join('');
  }

  function viewAdminLogin() {
    if (!S.config) return viewNotConnected();
    render(bar({ title: 'Admin sign in', sub: S.config.division, back: '#/login' }) +
      '<main><form class="card" data-submit="adminLogin">' +
      '<div class="field"><label for="a-user">Username</label><input id="a-user" name="username" class="input" autocomplete="username" value="admin" required></div>' +
      '<div class="field"><label for="a-pw">Password</label><input id="a-pw" name="password" class="input" type="password" autocomplete="current-password" required></div>' +
      '<button class="btn block" type="submit">Sign in</button></form></main>');
  }

  function viewNotConnected() {
    render('<div class="splash"><img src="assets/gst-mark-light.png" alt="Gujarat State Tax"><div class="t">Recovery</div><div class="rule"></div>' +
      '<div class="s" style="max-width:300px;text-align:center;padding:0 16px">' +
      (connected() ? 'Could not reach the server. Check the internet connection.' : 'Not connected yet: the backend URL is missing in config.js.') +
      '</div><button class="btn gold" data-act="reload" style="margin-top:8px">Try again</button></div>');
  }

  function installBtn() {
    return S.installEvt ? '<button class="linkbtn" data-act="install">' + I.install + ' Install app</button>' : '';
  }

  /* ================= home ================= */

  function viewHome() {
    var u = S.user, c = S.config;
    var who = u.role === 'ADMIN' ? ['Gandhinagar Division', 'Admin'] : [unitName(u.unit), u.charge];
    render(
      '<header class="bar tall"><img class="mark" src="assets/gst-mark-light.png" alt="Gujarat State Tax">' +
      '<div class="titles"><span class="t1">Recovery</span><span class="t2">Gujarat State Tax · ' + esc(c.division) + '</span></div>' +
      '<button class="iconbtn" data-act="signout" aria-label="Sign out">' + I.out + '</button>' +
      '<div class="who"><div><span class="w1">' + esc(who[0]) + '</span><span class="w2">' + esc(who[1]) + '</span></div>' +
      '<span class="tag">' + esc(c.monthLabel) + ' · open</span></div></header>' +
      '<main><div class="lift" id="home-fig"><section class="card raised"><div class="loading"><div class="spin"></div></div></section></div>' +
      '<div class="section-h"><h2 class="h2">Modules</h2></div><div class="tiles">' +
      '<a class="tile goldt" href="#/r90"><span class="code">90+</span><span><span class="tn">90+ Day Recovery</span><br><span class="tm" id="tile-r90">Weekly update due ' + esc(c.weeklyDueDay) + '</span></span></a>' +
      '<a class="tile" href="#/r90/dash"><span class="code">DB</span><span><span class="tn">Division Dashboard</span><br><span class="tm">All units · STO-wise</span></span></a>' +
      soonTile('VD', 'VAT Diary') + soonTile('GD', 'GST Diary', true) + soonTile('GR', 'GST Recovery', true) +
      (isAdmin() ? '<a class="tile" href="#/admin"><span class="code">AD</span><span><span class="tn">Admin</span><br><span class="tm">Lists, PINs, month</span></span></a>' : '') +
      '</div><div class="foot">' + (u.role !== 'ADMIN' ? 'Entering as ' + esc(u.name) + ' · ' : '') + installBtn() + '</div></main>'
    );
    getSummary().then(function (s) {
      var rows = s.rows, title;
      if (u.role === 'STO') { rows = rows.filter(function (r) { return r.unit === u.unit && r.charge === u.charge; }); title = '90+ Day Recovery · my charge'; }
      else if (u.role === 'UNIT_HEAD') { rows = rows.filter(function (r) { return r.unit === u.unit; }); title = '90+ Day Recovery · ' + unitName(u.unit); }
      else title = '90+ Day Recovery · division';
      var t = total(rows, 'all', s.targetRate);
      var el = document.getElementById('home-fig');
      if (!el) return;
      el.innerHTML = rows.length ? figuresCard(title, t) :
        '<section class="card raised"><div class="note info">No 90+ day cases for you in ' + esc(s.monthLabel) + ' yet.</div></section>';
      var tl = document.getElementById('tile-r90');
      if (tl && t.n) tl.textContent = 'Updated (last ' + upDays() + ' days): ' + t.upd + ' of ' + t.n;
    }).catch(function (e) {
      var el = document.getElementById('home-fig');
      if (el) el.innerHTML = '<section class="card raised"><div class="note err">' + esc(e.message) + '</div></section>';
    });
  }

  function soonTile(code, name, gold) {
    return '<div class="tile soon' + (gold ? ' goldt' : '') + '" aria-disabled="true"><span class="code">' + code + '</span><span><span class="tn">' + esc(name) + '</span><br><span class="tm">Coming soon</span></span></div>';
  }

  /* ================= 90+ Day Recovery – my unit ================= */

  function r90Unit() {
    if (isAdmin()) return S.adminUnit ? Number(S.adminUnit) : S.config.units[S.config.units.length - 1];
    return S.user.unit;
  }

  function viewR90() {
    if (isAdmin() && !S.adminUnit) S.adminUnit = String(r90Unit());
    loadingView('90+ Day Recovery', '#/home');
    Promise.all([getSummary(), getCases()]).then(drawR90).catch(function (e) { errorView('90+ Day Recovery', '#/home', e); });
  }

  function drawR90(keep) {
    var s = S.summary, cs = S.cases, u = S.user, unit = r90Unit(), tab = S.unitTab;
    var rows = s.rows.filter(function (r) { return r.unit === unit; });
    var t = total(rows, tab, s.targetRate);
    var head = bar({
      title: '90+ Day Recovery', sub: unitName(unit) + ' · ' + s.monthLabel, back: '#/home',
      right: '<button class="iconbtn" data-act="exportR90" aria-label="Download Excel">' + I.install + '</button><button class="iconbtn" data-act="refreshR90" aria-label="Refresh">' + I.refresh + '</button>',
      seg: seg('unitTab', tab, TABS)
    });
    var adminPick = isAdmin() ? '<div>' + chips('adminUnit', String(unit), S.config.units.map(function (x) { return [String(x), unitName(x)]; }), true) + '</div>' : '';
    var extra = '<div class="row between small"><span>Updated in last ' + s.updatedWithinDays + ' days: <b>' + t.upd + ' of ' + t.n + '</b></span><span>Spot visits: <b>' + t.vis + '</b></span></div>';
    var stoCards = rows.length ? rows.map(function (r) {
      var x = pick(r, tab), target = x.open * s.targetRate, ach = target > 0 ? x.rec / target : 0, me = u.role === 'STO' && u.charge === r.charge;
      var updFrac = x.n ? x.upd / x.n : 0;
      return '<div class="sto' + (me ? ' me' : '') + '"><div class="row"><span class="h2 grow" style="font-size:17px">' + esc(r.charge) + '</span>' +
        (me ? '<span class="badge ind">YOUR CHARGE</span>' : '') + '<span class="pct ' + band(ach) + '">' + pctText(ach) + '</span></div>' +
        '<div class="nums"><div><span>Cases</span><span>' + x.n + '</span></div><div><span>Pending</span><span>' + amt(x.open) + '</span></div>' +
        '<div><span>Target</span><span>' + amt(target) + '</span></div><div><span>Recovered</span><span style="color:var(--ok-text)">' + amt(x.rec) + '</span></div></div>' +
        '<div class="row">' + '<div class="grow">' + meter(updFrac, updFrac < 0.7 ? 'warn' : '', true) + '</div><span class="small" style="white-space:nowrap">' + x.upd + '/' + x.n + ' updated · ' + x.vis + (x.vis === 1 ? ' visit' : ' visits') + '</span></div></div>';
    }).join('') : '<div class="empty">No cases in this unit for ' + esc(s.monthLabel) + '.</div>';

    render(head + '<main>' + adminPick + figuresCard(TAB_LABEL[tab] + ' · ' + unitName(unit), t, extra) +
      '<a class="btn dark" href="#/r90/dash"><span>Division dashboard – all units</span>' + I.chev + '</a>' +
      '<div class="section-h"><h2 class="h2">STO-wise summary</h2><span class="small">Pending at start of month</span></div>' + stoCards +
      casesBlock(cs.cases, tab) + '</main>', keep === true);
  }

  function casesBlock(all, tab) {
    var u = S.user;
    var title = u.role === 'STO' ? 'My cases' : 'Cases – ' + unitName(r90Unit());
    var list = all.filter(function (c) {
      if (tab === 'active' && c.status !== 'Active') return false;
      if (tab === 'cancelled' && c.status !== 'Cancelled') return false;
      if (S.caseFilter === 'due' && c.updatedThisWeek) return false;
      if (S.caseFilter === 'novisit' && c.visited) return false;
      if (S.caseFilter === 'recovered' && !(c.recovered > 0)) return false;
      if (S.q) { var q = S.q.toLowerCase(); if ((c.name + ' ' + c.gstin + ' ' + c.ref + ' ' + c.charge).toLowerCase().indexOf(q) < 0) return false; }
      return true;
    }).sort(function (a, b) { return b.pending - a.pending; });
    var shown = list.slice(0, 200);
    return '<div class="section-h"><h2 class="h2">' + esc(title) + '</h2><span class="small">' + list.length + ' of ' + all.length + '</span></div>' +
      '<div class="row" style="background:#fff;border:1px solid var(--field);border-radius:12px;padding:0 12px;min-height:46px">' + I.search +
      '<label class="sr" for="q">Search cases</label><input id="q" class="grow" data-input="search" value="' + esc(S.q) + '" placeholder="Dealer name, GSTIN or reference" style="border:0;outline:none;background:transparent;min-height:44px"></div>' +
      chips('caseFilter', S.caseFilter, [['all', 'All'], ['due', 'Update due'], ['novisit', 'No spot visit'], ['recovered', 'Recovery made']]) +
      '<div class="card flush list" id="case-list">' + (shown.length ? shown.map(caseItem).join('') : '<div class="empty">No cases match.</div>') + '</div>' +
      (list.length > shown.length ? '<div class="small" style="text-align:center">Showing first 200 – search to narrow down.</div>' : '');
  }

  function caseItem(c) {
    var badges = (c.status === 'Cancelled' ? '<span class="badge grey">Cancelled</span> ' : '') +
      (c.updatedThisWeek ? '<span class="badge ok">Updated</span>' : '<span class="badge warn">Update due</span>') +
      (c.recovered > 0 ? ' <span class="badge gold">− ' + amt(c.recovered) + '</span>' : '');
    return '<a class="item" href="#/r90/case/' + enc(c.key) + '"><span class="grow" style="display:flex;flex-direction:column;gap:2px">' +
      '<span class="name">' + esc(c.name || c.gstin) + '</span><span class="meta">' + esc(c.gstin) + (c.ref ? ' · ' + esc(c.ref) : '') +
      (S.user.role !== 'STO' ? ' · ' + esc(c.charge) : '') + '</span><span>' + badges + '</span></span>' +
      '<span class="amt">' + amt(c.pending) + '</span></a>';
  }

  /* ================= one case ================= */

  function viewCase(key) {
    loadingView('Case', '#/r90');
    api('r90.case', { key: key }).then(function (d) { S.caseData = d; S.caseForm = 'update'; drawCase(); })
      .catch(function (e) { errorView('Case', '#/r90', e); });
  }

  function drawCase(keep) {
    var d = S.caseData, k = d.kase, last = d.updates[0] || {};
    var target = Math.round(k.opening * (d.targetRate || 0.1));
    var extraKeys = Object.keys(k.extra || {});
    var info = '<dl class="kv"><dt>GSTIN</dt><dd>' + esc(k.gstin) + '</dd>' +
      (k.ref ? '<dt>Demand ID</dt><dd>' + esc(k.ref) + '</dd>' : '') +
      (k.orderDate ? '<dt>Date of order</dt><dd>' + esc(dmy(k.orderDate)) + '</dd>' : '') +
      '<dt>Charge</dt><dd>' + unitName(k.unit) + ' · ' + esc(k.charge) + '</dd>' +
      '<dt>Case type</dt><dd>' + (k.status === 'Cancelled' ? '<span class="badge grey">Cancelled</span>' : '<span class="badge ok">Active</span>') + '</dd>' +
      extraKeys.map(function (x) { return '<dt>' + esc(x) + '</dt><dd>' + esc(fmtExtra(x, k.extra[x])) + '</dd>'; }).join('') + '</dl>';

    var forms = '';
    if (d.canEdit) {
      forms = '<div class="seg" role="group" style="background:var(--indigo-soft)">' +
        ['update', 'recovery'].map(function (f) {
          return '<button type="button" data-act="caseForm" data-val="' + f + '" aria-pressed="' + (S.caseForm === f) + '" style="' + (S.caseForm === f ? '' : 'color:var(--indigo)') + '">' + (f === 'update' ? 'Weekly update' : 'Add recovery') + '</button>';
        }).join('') + '</div>' + (S.caseForm === 'update' ? updateForm(d, last) : recoveryForm(d));
    } else {
      forms = '<div class="note info">' + (S.user.role === 'STO' ? 'This case belongs to another charge.' : 'View only. Entries are made by the STO of this charge.') + '</div>';
    }

    var recs = d.recoveries.length ? d.recoveries.map(function (r) {
      var off = !!r.cancelled;
      return '<div class="item"><span class="dot' + (off ? '' : ' ok') + '"></span><span class="grow" style="display:flex;flex-direction:column;gap:2px">' +
        '<span class="' + (off ? 'struck' : '') + '"><b>' + inr(r.amount) + '</b> · ' + esc(r.mode) + '</span>' +
        '<span class="meta">' + esc(dmy(r.date)) + (r.ref ? ' · ' + esc(r.ref) : '') + ' · by ' + esc(r.by) + '</span>' +
        (r.remark ? '<span class="meta">' + esc(r.remark) + '</span>' : '') +
        (off ? '<span class="meta" style="color:var(--err)">' + esc(r.cancelled) + '</span>' : '') + '</span>' +
        (d.canEdit && !off ? '<button class="btn ghost small" data-act="cancelRec" data-id="' + esc(r.id) + '">Cancel</button>' : '') + '</div>';
    }).join('') : '<div class="empty">No recovery entered this month.</div>';

    var ups = d.updates.length ? d.updates.map(function (x) {
      return '<div class="item"><span class="dot"></span><span class="grow" style="display:flex;flex-direction:column;gap:2px">' +
        '<span><b>' + esc(x.step) + '</b> · ' + esc(dmy(x.stepDate)) + '</span>' +
        '<span class="meta">Cash ledger ' + (x.cashBal === '' ? '–' : inr(x.cashBal)) + ' · Credit ledger ' + (x.creditBal === '' ? '–' : inr(x.creditBal)) +
        (x.spotDate ? ' · Spot visit ' + esc(dmy(x.spotDate)) : '') + '</span>' +
        (x.remark ? '<span class="meta">' + esc(x.remark) + '</span>' : '') +
        '<span class="meta">Saved ' + esc(x.at) + ' by ' + esc(x.by) + '</span></span></div>';
    }).join('') : '<div class="empty">No weekly update yet this month.</div>';

    render(bar({ title: k.name || k.gstin, sub: k.gstin, back: '#/r90' }) + '<main>' +
      '<section class="card"><div class="stats three">' +
      '<div class="stat"><span class="k">Pending at start</span><span class="v">' + amt(k.opening) + '</span></div>' +
      '<div class="stat ok"><span class="k">Recovered</span><span class="v">' + amt(k.recovered) + '</span></div>' +
      '<div class="stat dark"><span class="k">Pending now</span><span class="v">' + amt(k.pending) + '</span></div></div>' +
      '<div class="row between small"><span>Case target (10%): <b>' + inr(target) + '</b></span><span>' +
      (k.updatedThisWeek ? '<span class="badge ok">Updated in last ' + d.updatedWithinDays + ' days</span>' : '<span class="badge warn">Update due</span>') + '</span></div>' +
      info + '</section>' + forms +
      '<div class="section-h"><h2 class="h2">Recoveries – ' + esc(d.monthLabel) + '</h2></div><div class="card flush list timeline">' + recs + '</div>' +
      '<div class="section-h"><h2 class="h2">Weekly updates</h2></div><div class="card flush list timeline">' + ups + '</div></main>', keep === true);
  }

  function updateForm(d, last) {
    var stepSel = last.step || '';
    var known = d.steps.indexOf(stepSel) >= 0;
    var isOther = /^other/i.test(stepSel);
    return '<form class="card" data-submit="saveUpdate">' +
      '<div class="card-h"><h2 class="h2">Weekly update</h2><span class="small">' + (last.at ? 'Last: ' + esc(last.at) : 'First update this month') + '</span></div>' +
      '<div class="grid2"><div class="field"><label for="u-cash">Cash ledger balance (₹)</label><input id="u-cash" name="cashBal" class="input" inputmode="decimal" value="' + esc(last.cashBal === undefined ? '' : last.cashBal) + '"></div>' +
      '<div class="field"><label for="u-credit">Credit ledger balance (₹)</label><input id="u-credit" name="creditBal" class="input" inputmode="decimal" value="' + esc(last.creditBal === undefined ? '' : last.creditBal) + '"></div></div>' +
      '<div class="field"><label for="u-spot">Spot visit date (leave empty if not visited)</label><input id="u-spot" name="spotDate" class="input" type="date" max="' + d.today + '" value="' + esc(last.spotDate || '') + '"></div>' +
      '<div class="field"><label for="u-step">Last recovery step (' + (d.kase.status === 'Cancelled' ? 'Cancelled' : 'Active') + ' case)</label><select id="u-step" name="step" class="input" data-change="stepSel" required><option value="">Select</option>' +
      (stepSel && !known ? '<option selected>' + esc(stepSel) + '</option>' : '') +
      d.steps.map(function (s) { return '<option' + (s === stepSel ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="u-sdate">Date of that step</label><input id="u-sdate" name="stepDate" class="input" type="date" max="' + d.today + '" value="' + esc(last.stepDate || '') + '" required></div>' +
      '<div class="field"><label for="u-rem">Remarks<span id="u-rem-req"' + (isOther ? '' : ' class="hidden"') + '> – required for "Other"</span></label><textarea id="u-rem" name="remark" class="input" maxlength="500"></textarea></div>' +
      '<button class="btn block" type="submit">Save update</button></form>';
  }

  function recoveryForm(d) {
    var k = d.kase;
    if (!(k.pending > 0)) return '<div class="note ok">Nothing is pending on this case.</div>';
    return '<form class="card" data-submit="addRecovery">' +
      '<div><h2 class="h2">Add recovery</h2><div class="small">Any reduction of the pending amount counts</div></div>' +
      '<div class="field"><label for="r-mode">How was it reduced?</label><select id="r-mode" name="mode" class="input" required>' +
      d.modes.map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('') + '</select></div>' +
      '<div class="grid2"><div class="field"><label for="r-amt">Amount (₹)</label><input id="r-amt" name="amount" class="input" inputmode="decimal" data-input="recAmt" required></div>' +
      '<div class="field"><label for="r-date">Date</label><input id="r-date" name="date" class="input" type="date" min="' + d.month + '-01" max="' + d.today + '" value="' + (d.today.slice(0, 7) === d.month ? d.today : '') + '" required></div></div>' +
      '<div class="field"><label for="r-ref">Challan / CIN / order no.</label><input id="r-ref" name="ref" class="input" maxlength="100"></div>' +
      '<div class="field"><label for="r-rem">Remark</label><textarea id="r-rem" name="remark" class="input" maxlength="500"></textarea></div>' +
      '<div class="after"><span>Pending after this entry</span><b id="r-after">' + inr(k.pending) + '</b></div>' +
      '<button class="btn gold block" type="submit">Save recovery</button></form>';
  }

  /* ================= division dashboard ================= */

  function viewDash() {
    loadingView('90+ Day Recovery', '#/r90');
    getSummary().then(function () { drawDash(); }).catch(function (e) { errorView('90+ Day Recovery', '#/r90', e); });
  }

  function drawDash(keep) {
    var s = S.summary, st = S.dash;
    var rows = s.rows.filter(function (r) { return st.unit === 'all' || String(r.unit) === st.unit; }).map(function (r) {
      var x = pick(r, st.tab), target = x.open * s.targetRate;
      return { unit: r.unit, charge: r.charge, n: x.n, open: x.open, rec: x.rec, target: target, ach: target > 0 ? x.rec / target : 0 };
    }).filter(function (r) { return r.n > 0; });
    var sorters = {
      best: function (a, b) { return b.ach - a.ach || b.rec - a.rec; },
      worst: function (a, b) { return a.ach - b.ach || b.open - a.open; },
      pending: function (a, b) { return b.open - a.open; },
      unit: function (a, b) { return a.unit - b.unit || (a.charge < b.charge ? -1 : 1); }
    };
    rows.sort(sorters[st.sort]);
    var t = total(s.rows.filter(function (r) { return st.unit === 'all' || String(r.unit) === st.unit; }), st.tab, s.targetRate);
    var me = S.user;
    var list = rows.length ? rows.map(function (r, i) {
      var top = st.sort === 'best' && i < 3 && r.ach > 0, b = band(r.ach);
      var mine = me.role === 'STO' && me.unit === r.unit && me.charge === r.charge;
      return '<div class="item' + (top ? ' top3' : '') + '" style="cursor:default;flex-direction:column;align-items:stretch;gap:8px">' +
        '<div class="row"><span class="rank' + (top ? ' top' : '') + '">' + (i + 1) + '</span><span class="grow" style="display:flex;flex-direction:column;line-height:1.2">' +
        '<span class="name">' + unitName(r.unit) + ' · ' + esc(r.charge) + (mine ? ' <span class="badge ind">YOU</span>' : '') + '</span>' +
        '<span class="meta">Pending ' + amt(r.open) + ' · ' + r.n + ' cases</span></span><span class="pct ' + b + '">' + pctText(r.ach) + '</span></div>' +
        '<div class="row"><div class="grow">' + meter(r.ach, b === 'ok' ? 'ok' : (b === 'warn' ? 'warn' : ''), true) + '</div>' +
        '<span class="small" style="white-space:nowrap;color:#3F4260">' + amt(r.rec) + ' of ' + amt(r.target) + '</span></div></div>';
    }).join('') : '<div class="empty">No cases for this selection.</div>';
    var sortTitle = { best: 'Best performing STOs', worst: 'STOs needing attention', pending: 'Highest pending first', unit: 'Unit-wise order' }[st.sort];

    render(bar({ title: '90+ Day Recovery', sub: 'Division dashboard · ' + s.monthLabel, back: '#/r90',
      right: '<button class="iconbtn" data-act="refreshDash" aria-label="Refresh">' + I.refresh + '</button>',
      seg: seg('dashTab', st.tab, TABS) }) + '<main>' +
      figuresCard(TAB_LABEL[st.tab] + (st.unit === 'all' ? ' · Division' : ' · ' + unitName(Number(st.unit))), t) +
      '<div class="field"><span class="label-caps">Arrange by</span>' +
      chips('dashSort', st.sort, [['best', 'Best performing'], ['worst', 'Needs attention'], ['pending', 'Highest pending'], ['unit', 'By unit']]) + '</div>' +
      '<div class="field"><span class="label-caps">Unit</span>' +
      chips('dashUnit', st.unit, [['all', 'All units']].concat(S.config.units.map(function (u) { return [String(u), String(u)]; })), true) + '</div>' +
      '<div class="section-h"><h2 class="h2">' + sortTitle + '</h2><span class="small">' + rows.length + ' STO charges</span></div>' +
      '<div class="card flush list">' + list + '</div>' +
      '<div class="small">Target = 10% of each charge\'s pending at the start of the month. Achieved = recovered this month ÷ target. Green: target met · Amber: below half.</div></main>', keep === true);
  }

  /* ================= admin ================= */

  function viewAdmin() {
    loadingView('Admin', '#/home');
    api('admin.overview', { month: S.adminMonth || '' }).then(function (d) { S.adminData = d; drawAdmin(); })
      .catch(function (e) { errorView('Admin', '#/home', e); });
  }

  function monthOptions(selected) {
    var out = [], d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 2);
    for (var i = 0; i < 18; i++) {
      var k = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
      out.push('<option value="' + k + '"' + (k === selected ? ' selected' : '') + '>' + k + ' · ' + d.toLocaleString('en-IN', { month: 'short' }) + ' ' + d.getFullYear() + '</option>');
      d.setMonth(d.getMonth() - 1);
    }
    return out.join('');
  }

  function drawAdmin(keep) {
    var d = S.adminData;
    var viewMonth = S.adminMonth || d.month;
    var byUnit = {};
    d.charges.forEach(function (c) { (byUnit[c.unit] = byUnit[c.unit] || []).push(c); });
    var chargesHtml = Object.keys(byUnit).map(function (u) {
      return '<div class="label-caps" style="padding:10px 14px 4px">' + unitName(u) + '</div>' + byUnit[u].map(function (c) {
        var id = c.unit + '|' + c.charge;
        return '<div class="item" style="cursor:default;flex-wrap:wrap"><span class="grow"><span class="name">' + esc(c.charge) + '</span> ' +
          (c.pinSet ? '<span class="badge ok">PIN set' + (c.pinSetOn ? ' ' + esc(c.pinSetOn) : '') + '</span>' : '<span class="badge warn">No PIN</span>') +
          (c.active ? '' : ' <span class="badge grey">Off</span>') + '</span>' +
          '<button class="btn ghost small" data-act="pinOpen" data-id="' + esc(id) + '">Set PIN</button>' +
          '<button class="linkbtn" data-act="toggleCharge" data-unit="' + c.unit + '" data-charge="' + esc(c.charge) + '" data-on="' + (c.active ? '0' : '1') + '">' + (c.active ? 'Turn off' : 'Turn on') + '</button>' +
          '<form class="row hidden" data-submit="setPin" data-unit="' + c.unit + '" data-charge="' + esc(c.charge) + '" id="pin-' + esc(id) + '" style="width:100%">' +
          '<label class="sr" for="pi-' + esc(id) + '">New PIN</label><input id="pi-' + esc(id) + '" name="pin" class="input pin grow" inputmode="numeric" maxlength="8" placeholder="4–8 digits" required>' +
          '<button class="btn small" type="submit">Save</button></form></div>';
      }).join('');
    }).join('');

    var log = d.log.length ? '<div class="scrollx"><table class="t"><tr><th>List</th><th>Rows</th><th>Status</th><th>Saved</th></tr>' + d.log.map(function (l) {
      return '<tr><td>' + (l.url ? '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.type) + '</a>' : esc(l.type)) + '<div class="small">' + esc(l.file) + ' · ' + esc(l.source) + '</div></td>' +
        '<td>' + l.rows + '</td><td>' + (l.status === 'SAVED' ? '<span class="badge ok">Saved</span>' : '<span class="badge warn">Failed</span>') +
        (l.message && l.message !== 'OK' ? '<div class="small" style="white-space:pre-line">' + esc(l.message.slice(0, 300)) + '</div>' : '') + '</td>' +
        '<td>' + esc(l.at) + '<div class="small">' + esc(l.by) + '</div></td></tr>';
    }).join('') + '</table></div>' : '<div class="empty">No list saved for this month yet.</div>';

    render(bar({ title: 'Admin', sub: d.monthLabel + ' is open', back: '#/home',
      right: '<button class="iconbtn" data-act="refreshAdmin" aria-label="Refresh">' + I.refresh + '</button>' }) + '<main>' +

      '<form class="card" data-submit="setMonth"><div class="card-h"><h2 class="h2">Open month</h2><span class="badge ok">' + esc(d.monthLabel) + '</span></div>' +
      '<div class="sub">Officers enter recoveries for this month. Change it after the new month\'s list is uploaded.</div>' +
      '<div class="row"><label class="sr" for="m-open">Month</label><select id="m-open" name="month" class="input grow">' + monthOptions(d.month) + '</select>' +
      '<button class="btn small" type="submit">Set</button></div></form>' +

      '<form class="card" data-submit="upload"><h2 class="h2">Upload a monthly list</h2>' +
      '<div class="grid2"><div class="field"><label for="up-type">List type</label><select id="up-type" name="typeKey" class="input">' +
      d.types.map(function (t) { return '<option value="' + esc(t.key) + '">' + esc(t.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="up-month">Month</label><select id="up-month" name="month" class="input">' + monthOptions(d.month) + '</select></div></div>' +
      '<div class="field"><label for="up-file">Excel or CSV file</label><input id="up-file" name="file" class="input" type="file" accept=".xlsx,.xls,.csv" required></div>' +
      '<div class="hint">Use the same format as the 90+ pending list (sheet <b>Cases</b>): Case Type, Unit, STO, Demand ID, GSTIN, Legal Name, Pending Demand (Rs) … The columns STOs fill (ledger balances, spot visit, last step, recovered …) can stay empty.</div>' +
      '<div id="up-result"></div><button class="btn block" type="submit">Check and save</button></form>' +

      '<section class="card"><div class="card-h"><h2 class="h2">Drive Inbox</h2><span class="badge ' + (d.inboxCount ? 'warn' : 'grey') + '">' + d.inboxCount + ' file(s) waiting</span></div>' +
      '<div class="sub">Name files like <b>2026-11 – 90+ day Recovery list.xlsx</b> and drop them in the Inbox folder.</div>' +
      '<div class="row" style="flex-wrap:wrap">' + (d.inboxUrl ? '<a class="btn ghost small" href="' + esc(d.inboxUrl) + '" target="_blank" rel="noopener">Open Inbox folder</a>' : '') +
      '<button class="btn small" data-act="processInbox">Process Inbox</button></div><div id="inbox-result"></div></section>' +

      '<section class="card"><div class="card-h"><h2 class="h2">Saved lists</h2>' +
      '<label class="sr" for="log-month">Month</label><select id="log-month" class="input" style="width:auto;min-height:40px" data-change="logMonth">' + monthOptions(viewMonth) + '</select></div>' + log +
      '<div class="row" style="flex-wrap:wrap">' + (d.folderUrl ? '<a class="linkbtn" href="' + esc(d.folderUrl) + '" target="_blank" rel="noopener">Drive folder (monthly lists)</a>' : '') +
      (d.sheetUrl ? '<a class="linkbtn" href="' + esc(d.sheetUrl) + '" target="_blank" rel="noopener">Google Sheet (combined lists)</a>' : '') + '</div>' +
      '<button class="btn ghost small" data-act="exportR90" data-all="1">' + I.install + ' Download 90+ list with STO entries (all units)</button></section>' +

      '<section class="card flush"><div style="padding:16px 16px 4px"><h2 class="h2">Charges &amp; PINs</h2><div class="sub">New STO charges appear here automatically from the 90+ list.</div></div>' +
      '<div class="list">' + chargesHtml + '</div>' +
      '<form class="row" data-submit="addCharge" style="padding:12px 14px;flex-wrap:wrap;border-top:1px solid var(--line)">' +
      '<label class="sr" for="ac-unit">Unit</label><select id="ac-unit" name="unit" class="input" style="width:auto">' + S.config.units.map(function (u) { return '<option value="' + u + '">' + unitName(u) + '</option>'; }).join('') + '</select>' +
      '<label class="sr" for="ac-ch">Charge</label><input id="ac-ch" name="charge" class="input grow" placeholder="STO-5 or Unit head" required style="min-width:140px">' +
      '<button class="btn small" type="submit">Add charge</button></form></section>' +

      '<section class="card"><h2 class="h2">List types</h2><div class="list">' + d.types.map(function (t) {
        return '<div style="padding:8px 0"><b>' + esc(t.name) + '</b> <span class="badge ' + (t.module === 'R90' ? 'gold' : 'grey') + '">' + (t.module === 'R90' ? '90+ module' : 'Store & combine') + '</span>' +
          (t.note ? '<div class="small">' + esc(t.note) + '</div>' : '') + '</div>';
      }).join('') + '</div><form class="row" data-submit="addType" style="flex-wrap:wrap"><label class="sr" for="lt-name">New list name</label>' +
      '<input id="lt-name" name="name" class="input grow" placeholder="New list name" required style="min-width:160px"><button class="btn small" type="submit">Add list type</button></form></section>' +

      '<form class="card" data-submit="password"><h2 class="h2">Change admin password</h2>' +
      '<div class="grid2"><div class="field"><label for="pw-old">Current password</label><input id="pw-old" name="oldPassword" class="input" type="password" autocomplete="current-password" required></div>' +
      '<div class="field"><label for="pw-new">New password (8+ characters)</label><input id="pw-new" name="newPassword" class="input" type="password" autocomplete="new-password" minlength="8" required></div></div>' +
      '<button class="btn ghost" type="submit">Change password</button></form></main>', keep === true);
  }

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'vendor/xlsx.full.min.js';
      s.onload = function () { res(window.XLSX); };
      s.onerror = function () { rej(new Error('Could not load the Excel reader. Check the connection.')); };
      document.head.appendChild(s);
    });
  }

  /* Reads the "Cases" sheet (or the first sheet) as rows of text. Dates become dd-mm-yyyy whatever
     their display format; numbers are kept whole (no commas or 1.2E+07). */
  function readSheetFile(file) {
    return loadXlsx().then(function (XLSX) {
      return file.arrayBuffer().then(function (buf) {
        var wb = XLSX.read(buf, { type: 'array', cellDates: false, cellNF: true });
        var name = wb.SheetNames.filter(function (n) { return /^cases$/i.test(n.trim()); })[0] || wb.SheetNames[0];
        var ws = wb.Sheets[name];
        if (!ws || !ws['!ref']) return [];
        var rg = XLSX.utils.decode_range(ws['!ref']), rows = [];
        for (var r = rg.s.r; r <= rg.e.r; r++) {
          var row = [], any = false;
          for (var c = rg.s.c; c <= rg.e.c; c++) {
            var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })], v = '';
            if (cell && cell.v !== undefined && cell.v !== null) {
              if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
                var p = XLSX.SSF.parse_date_code(cell.v);
                v = ('0' + p.d).slice(-2) + '-' + ('0' + p.m).slice(-2) + '-' + p.y;
              } else if (cell.t === 'd' && cell.v instanceof Date) {
                v = ('0' + cell.v.getDate()).slice(-2) + '-' + ('0' + (cell.v.getMonth() + 1)).slice(-2) + '-' + cell.v.getFullYear();
              } else if (cell.t === 'n') {
                v = String(Math.round(cell.v * 100) / 100);
              } else if (cell.t === 'b') {
                v = cell.v ? 'TRUE' : 'FALSE';
              } else {
                v = String(cell.w !== undefined && cell.t !== 's' ? cell.w : cell.v);
              }
            }
            if (String(v).trim() !== '') any = true;
            row.push(v);
          }
          if (any) rows.push(row);
        }
        return rows;
      });
    });
  }

  /* Excel download in the list's own format: dates as real dates (dd-mm-yyyy), (Rs) columns as #,##0. */
  function downloadExcel(d) {
    return loadXlsx().then(function (XLSX) {
      var head = d.rows[0];
      var isDate = head.map(function (h) { return /date|updated on/i.test(h); });
      var isMoney = head.map(function (h) { return /\((rs\.?|₹|inr)\)\s*$/i.test(h); });
      var aoa = d.rows.map(function (row, ri) {
        if (!ri) return row;
        return row.map(function (v, ci) {
          if (isDate[ci] && typeof v === 'string') {
            var m = /^(\d{2})-(\d{2})-(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(v);
            if (m) return { serial: (Date.UTC(+m[3], +m[2] - 1, +m[1]) - Date.UTC(1899, 11, 30)) / 864e5 + ((+(m[4] || 0)) * 60 + (+(m[5] || 0))) / 1440 };
          }
          if (isMoney[ci] && typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v.replace(/,/g, '')))) return Number(v.replace(/,/g, ''));
          return v;
        });
      });
      var serials = {};
      aoa = aoa.map(function (row, ri) {
        return row.map(function (v, ci) {
          if (v && typeof v === 'object' && 'serial' in v) { serials[ri + ',' + ci] = 1; return v.serial; }
          return v;
        });
      });
      var ws = XLSX.utils.aoa_to_sheet(aoa);
      var rg = XLSX.utils.decode_range(ws['!ref']);
      for (var r = 1; r <= rg.e.r; r++) {
        for (var c = 0; c <= rg.e.c; c++) {
          var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
          if (!cell) continue;
          if (serials[r + ',' + c]) cell.z = /updated on/i.test(head[c]) ? 'dd-mm-yyyy hh:mm' : 'dd-mm-yyyy';
          else if (isMoney[c] && cell.t === 'n') cell.z = '#,##0';
        }
      }
      ws['!cols'] = head.map(function (h) { return { wch: Math.min(40, Math.max(10, String(h).length + 2)) }; });
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: rg.e.c } }) };
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, d.sheetName || 'Cases');
      XLSX.writeFile(wb, d.fileName);
    });
  }

  /* ================= events ================= */

  var ACT = {
    reload: function () { boot(); },
    signout: function () { api('logout').catch(function () {}); signOutLocal(); go('#/login'); },
    install: function () { if (S.installEvt) { S.installEvt.prompt(); S.installEvt = null; } },
    seg: function (b) {
      var n = b.dataset.name, v = b.dataset.val;
      if (n === 'unitTab') { S.unitTab = v; drawR90(true); }
      if (n === 'dashTab') { S.dash.tab = v; drawDash(true); }
    },
    chip: function (b) {
      var n = b.dataset.name, v = b.dataset.val;
      if (n === 'caseFilter') { S.caseFilter = v; drawR90(true); }
      if (n === 'dashSort') { S.dash.sort = v; drawDash(true); }
      if (n === 'dashUnit') { S.dash.unit = v; drawDash(true); }
      if (n === 'adminUnit') { S.adminUnit = v; loadingView('90+ Day Recovery', '#/home'); getCases(true).then(drawR90).catch(function (e) { errorView('90+ Day Recovery', '#/home', e); }); }
    },
    refreshR90: function () { invalidate(); viewR90(); },
    exportR90: function (b) {
      busy(b, true, '');
      api('r90.export', isAdmin() ? { unit: b.dataset.all ? '' : (S.adminUnit || '') } : {})
        .then(function (d) { return downloadExcel(d).then(function () { busy(b, false); toast('Downloaded ' + (d.rows.length - 1) + ' cases.', true); }); })
        .catch(function (e) { busy(b, false); toast(e.message); });
    },
    refreshDash: function () { invalidate(); viewDash(); },
    refreshAdmin: function () { viewAdmin(); },
    caseForm: function (b) { S.caseForm = b.dataset.val; drawCase(true); },
    cancelRec: function (b) {
      if (!confirm('Cancel this recovery entry? It will stay in the record as cancelled.')) return;
      busy(b, true, '');
      api('r90.cancelRecovery', { id: b.dataset.id }).then(function (d) { S.caseData = d; invalidate(); drawCase(true); toast('Entry cancelled.', true); })
        .catch(function (e) { busy(b, false); toast(e.message); });
    },
    pinOpen: function (b) {
      var f = document.getElementById('pin-' + b.dataset.id);
      if (f) { f.classList.toggle('hidden'); var i = f.querySelector('input'); if (i) i.focus(); }
    },
    toggleCharge: function (b) {
      busy(b, true, '');
      api('admin.setActive', { unit: b.dataset.unit, charge: b.dataset.charge, active: b.dataset.on === '1' })
        .then(function (list) { S.adminData.charges = list; drawAdmin(true); refreshConfig(); })
        .catch(function (e) { busy(b, false); toast(e.message); });
    },
    processInbox: function (b) {
      busy(b, true, 'Processing…');
      api('admin.processInbox').then(function (res) {
        busy(b, false);
        var box = document.getElementById('inbox-result');
        var html = res.length ? res.map(function (r) { return '<div class="note ' + (r.ok ? 'ok' : 'err') + '"><b>' + esc(r.file) + '</b>\n' + esc(r.message) + '</div>'; }).join('') : '<div class="note info">The Inbox is empty.</div>';
        invalidate(); refreshConfig();
        api('admin.overview', { month: S.adminMonth || '' }).then(function (d) { S.adminData = d; drawAdmin(true); var bx = document.getElementById('inbox-result'); if (bx) bx.innerHTML = html; });
        if (box) box.innerHTML = html;
      }).catch(function (e) { busy(b, false); toast(e.message); });
    }
  };

  var CHANGE = {
    loginUnit: function (el) { document.getElementById('l-charge').innerHTML = chargeOptions(Number(el.value)); },
    stepSel: function (el) { var r = document.getElementById('u-rem-req'); if (r) r.classList.toggle('hidden', !/^other/i.test(el.value)); },
    logMonth: function (el) { S.adminMonth = el.value; api('admin.overview', { month: el.value }).then(function (d) { S.adminData = d; drawAdmin(true); }).catch(function (e) { toast(e.message); }); }
  };

  var INPUT = {
    search: function (el) {
      S.q = el.value;
      var pos = el.selectionStart;
      drawR90(true);
      var n = document.getElementById('q');
      if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
    },
    recAmt: function (el) {
      var k = S.caseData && S.caseData.kase; if (!k) return;
      var v = Number(String(el.value).replace(/[,₹\s]/g, ''));
      var out = document.getElementById('r-after');
      if (out) out.textContent = isNaN(v) ? '–' : inr(Math.max(0, k.pending - v));
    }
  };

  var SUBMIT = {
    login: function (f, btn) {
      var v = formData(f);
      busy(btn, true, 'Signing in…');
      api('login', v).then(function (d) {
        S.token = d.token; S.user = d.user; invalidate();
        store('rec_token', d.token); store('rec_user', d.user);
        store('rec_last', { unit: Number(v.unit), charge: v.charge, name: v.name });
        go('#/home');
      }).catch(function (e) { busy(btn, false); toast(e.message); });
    },
    adminLogin: function (f, btn) {
      busy(btn, true, 'Signing in…');
      api('adminLogin', formData(f)).then(function (d) {
        S.token = d.token; S.user = d.user; invalidate();
        store('rec_token', d.token); store('rec_user', d.user);
        go('#/home');
      }).catch(function (e) { busy(btn, false); toast(e.message); });
    },
    saveUpdate: function (f, btn) {
      var v = formData(f);
      v.key = S.caseData.kase.key;
      busy(btn, true, 'Saving…');
      api('r90.saveUpdate', v).then(function (d) { S.caseData = d; invalidate(); drawCase(true); toast('Weekly update saved.', true); })
        .catch(function (e) { busy(btn, false); toast(e.message); });
    },
    addRecovery: function (f, btn) {
      var v = formData(f);
      v.key = S.caseData.kase.key;
      busy(btn, true, 'Saving…');
      api('r90.addRecovery', v).then(function (d) { S.caseData = d; invalidate(); drawCase(true); toast('Recovery of ' + inr(Number(String(v.amount).replace(/[,₹\s]/g, ''))) + ' saved.', true); })
        .catch(function (e) { busy(btn, false); toast(e.message); });
    },
    setMonth: function (f, btn) {
      var v = formData(f);
      if (!confirm('Open ' + v.month + ' for entries? Officers will then see that month\'s list.')) return;
      busy(btn, true, '');
      api('admin.setMonth', v).then(function (d) { toast(d.monthLabel + ' is now open.', true); invalidate(); S.adminMonth = null; refreshConfig(); viewAdmin(); })
        .catch(function (e) { busy(btn, false); toast(e.message); });
    },
    upload: function (f, btn) {
      var v = formData(f), file = f.querySelector('input[type=file]').files[0], box = document.getElementById('up-result');
      if (!file) return toast('Choose a file.');
      busy(btn, true, 'Reading file…');
      box.innerHTML = '';
      readSheetFile(file).then(function (rows) {
        busy(btn, false); busy(btn, true, 'Checking and saving…');
        return api('admin.upload', { month: v.month, typeKey: v.typeKey, fileName: file.name, rows: rows });
      }).then(function (r) {
        busy(btn, false);
        invalidate(); refreshConfig();
        var html = '<div class="note ok"><b>Saved: ' + esc(r.month) + ' – ' + esc(r.type) + '</b>\n' + r.rows + ' rows' +
          (r.newCharges ? ' · ' + r.newCharges + ' new charge(s) added – set their PINs below' : '') + '\n<a href="' + esc(r.snapshotUrl) + '" target="_blank" rel="noopener">Open the saved monthly list</a></div>' +
          (r.warnings && r.warnings.length ? '<div class="note warn"><b>' + r.warnings.length + ' warning(s)</b> (saved anyway)\n' + esc(r.warnings.slice(0, 20).join('\n')) + (r.warnings.length > 20 ? '\n…' : '') + '</div>' : '');
        api('admin.overview', { month: S.adminMonth || '' }).then(function (d) { S.adminData = d; drawAdmin(true); var bx = document.getElementById('up-result'); if (bx) bx.innerHTML = html; });
        box.innerHTML = html;
      }).catch(function (e) { busy(btn, false); box.innerHTML = '<div class="note err">' + esc(e.message) + '</div>'; });
    },
    setPin: function (f, btn) {
      var v = formData(f);
      busy(btn, true, '');
      api('admin.setPin', { unit: f.dataset.unit, charge: f.dataset.charge, pin: v.pin }).then(function (list) {
        S.adminData.charges = list; drawAdmin(true); toast('PIN saved for ' + unitName(f.dataset.unit) + ' · ' + f.dataset.charge + '. Share it with the officer privately.', true);
      }).catch(function (e) { busy(btn, false); toast(e.message); });
    },
    addCharge: function (f, btn) {
      busy(btn, true, '');
      api('admin.addCharge', formData(f)).then(function (list) { S.adminData.charges = list; drawAdmin(true); refreshConfig(); toast('Charge added. Now set its PIN.', true); })
        .catch(function (e) { busy(btn, false); toast(e.message); });
    },
    addType: function (f, btn) {
      busy(btn, true, '');
      api('admin.addListType', formData(f)).then(function (types) { S.adminData.types = types; drawAdmin(true); toast('List type added.', true); })
        .catch(function (e) { busy(btn, false); toast(e.message); });
    },
    password: function (f, btn) {
      busy(btn, true, '');
      api('admin.password', formData(f)).then(function () { busy(btn, false); f.reset(); toast('Password changed.', true); })
        .catch(function (e) { busy(btn, false); toast(e.message); });
    }
  };

  function formData(f) {
    var o = {};
    Array.prototype.forEach.call(f.elements, function (el) {
      if (!el.name || el.type === 'file' || el.type === 'submit') return;
      o[el.name] = el.type === 'checkbox' ? el.checked : String(el.value).trim();
    });
    return o;
  }

  function refreshConfig() {
    return api('config').then(function (c) { S.config = c; store('rec_config', c); }).catch(function () { /* keep old */ });
  }

  $app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t || !ACT[t.dataset.act]) return;
    e.preventDefault();
    ACT[t.dataset.act](t, e);
  });
  $app.addEventListener('change', function (e) {
    var t = e.target.closest('[data-change]');
    if (t && CHANGE[t.dataset.change]) CHANGE[t.dataset.change](t);
  });
  $app.addEventListener('input', function (e) {
    var t = e.target.closest('[data-input]');
    if (t && INPUT[t.dataset.input]) INPUT[t.dataset.input](t);
  });
  $app.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f.dataset || !SUBMIT[f.dataset.submit]) return;
    e.preventDefault();
    SUBMIT[f.dataset.submit](f, f.querySelector('button[type=submit]'));
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.installEvt = e; });

  /* ================= start ================= */

  function boot() {
    S.token = load('rec_token'); S.user = load('rec_user');
    if (!S.token || !S.user) { S.token = null; S.user = null; }
    var cached = load('rec_config');
    if (!connected()) { S.config = null; return viewNotConnected(); }
    api('config').then(function (c) { S.config = c; store('rec_config', c); route(); })
      .catch(function () { if (cached) { S.config = cached; route(); } else viewNotConnected(); });
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
  boot();
})();
