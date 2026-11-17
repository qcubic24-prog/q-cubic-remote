// Q-OS - the phone interface. It only draws what the PC sends: the PC's apps, settings,
// wallpaper, battery, Wi-Fi and storage. Every app runs on the PC.
// Copyright (c) 2026 Pruthvi. All rights reserved.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const root = $('qos');
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const demo = isLocal && new URLSearchParams(location.search).has('demo');

  const S = { pcId: null, info: null, apps: [], wall: null, offset: 0, stack: [], cur: null, appName: '', timers: [] };

  // ---------- talking to the PC ----------
  let nextId = 1;
  const pending = new Map();
  const parts = new Map();

  function waitOpen() {
    return new Promise((resolve, reject) => {
      let n = 0;
      const tick = () => {
        if (window.QCR && window.QCR.channelOpen()) return resolve();
        if (++n > 150) return reject(new Error('not connected'));
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  async function req(op, args, timeoutMs = 45000) {
    if (demo) return Demo.req(op, args);
    await waitOpen();
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, timeoutMs);
      pending.set(id, { resolve, timer });
      window.QCR.send({ t: 'q', id, op, args: args || {} });
    });
  }

  function onMessage(d) {
    if (d.t === 'part') {
      let p = parts.get(d.id);
      if (!p) { p = { n: d.n, got: 0, list: [] }; parts.set(d.id, p); }
      if (p.list[d.i] === undefined) { p.list[d.i] = String(d.s || ''); p.got++; }
      if (p.got === p.n) { parts.delete(d.id); try { onMessage(JSON.parse(p.list.join(''))); } catch (e) {} }
      return;
    }
    if (d.t === 'res') {
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id); clearTimeout(p.timer);
      p.resolve(d.data);
      return;
    }
    if (d.t === 'ev' && d.e === 'closed' && S.cur === 'qappv') {
      toast((S.appName || 'The app') + ' was closed on your PC');
      goStart();
    }
  }

  // ---------- helpers ----------
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function svg(d, fill) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    if (fill) s.setAttribute('fill', 'currentColor');
    else { s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); }
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.appendChild(p);
    return s;
  }
  function gb(bytes) { return (bytes / 1073741824).toFixed(bytes > 100 * 1073741824 ? 0 : 1) + ' GB'; }
  function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }
  function toast(t) {
    const x = $('qtoast'); x.textContent = t; x.style.display = 'block';
    clearTimeout(toast.t); toast.t = setTimeout(() => { x.style.display = 'none'; }, 2200);
  }

  const IC = {
    wifi: 'M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01',
    bt: 'M7 7l10 10-5 5V2l5 5L7 17',
    plane: 'M10 21l2-1 2 1v-2l-1.5-1.5V13l8.5 3v-2l-8.5-5V4a1.5 1.5 0 0 0-3 0v5L1 14v2l8.5-3v4.5L8 19z',
    battery: 'M3 8h15v8H3zM21 11v2M6 11v2',
    moon: 'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z',
    access: 'M12 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5 9l7 1 7-1M12 10v5M9 21l3-6 3 6',
    display: 'M3 4h18v12H3zM8 20h8M12 16v4',
    sound: 'M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
    focus: 'M12 3a9 9 0 1 0 9 9M12 7v5l3 2',
    power: 'M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0',
    storage: 'M3 7h18v10H3zM7 12h.01M11 12h6',
    network: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
    brush: 'M14 4l6 6-9 9H5v-6zM12 6l6 6',
    apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    user: 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21a8 8 0 0 1 16 0',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    update: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    recovery: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
    info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 8h.01',
    gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
    desktop: 'M3 4h18v12H3zM8 20h8M12 16v4M7 8h4M7 11h7',
    recent: 'M4 6h10v12H4zM17 8h3v8h-3',
    folder: 'M3 6h6l2 2h10v11H3z',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
    chev: 'M9 6l6 6-6 6',
  };

  // ---------- the PC's own clock ----------
  function pcNow() {
    const tz = S.info && Number.isFinite(S.info.tz) ? S.info.tz : -new Date().getTimezoneOffset();
    return new Date(Date.now() + S.offset + tz * 60000);
  }
  const fmt = (d, o) => d.toLocaleString(undefined, Object.assign({ timeZone: 'UTC' }, o));
  function tickClock() {
    const d = pcNow();
    const time = fmt(d, { hour: 'numeric', minute: '2-digit' });
    $('qlTime').textContent = time.replace(/\s?[AP]M$/i, '');
    $('qlDate').textContent = fmt(d, { weekday: 'long', month: 'long', day: 'numeric' });
    $('qsbTime').textContent = time;
    const dt = $('tileDate');
    if (dt) { dt.querySelector('.sm').textContent = fmt(d, { weekday: 'long' }); dt.querySelector('.big').textContent = fmt(d, { day: 'numeric' }); dt.querySelector('.mid').textContent = fmt(d, { month: 'long' }); }
  }

  // ---------- screens and the back button ----------
  const SCREENS = ['qlock', 'qstart', 'qapps', 'qset', 'qappv', 'qrec'];
  function showScreen(name, push = true) {
    if (S.cur === name) return;
    if (push && S.cur && S.cur !== 'qlock') S.stack.push(S.cur);
    if (push) try { history.pushState({ qos: name }, ''); } catch (e) {}
    SCREENS.forEach((s) => $(s).classList.toggle('show', s === name));
    S.cur = name;
    $('qsb').style.display = name === 'qlock' ? 'none' : 'flex';
    $('qnav').style.display = name === 'qlock' ? 'none' : 'flex';
    const third = $('qnThird');
    third.replaceChildren(svg(name === 'qappv' ? IC.keyboard : IC.search));
    third.setAttribute('aria-label', name === 'qappv' ? 'Keyboard' : 'Search apps');
    closeAc();
  }

  async function leaveAppView() {
    if (S.cur === 'qappv' || S.cur === 'qrec') { try { await req('home', {}, 8000); } catch (e) {} }
  }

  async function back() {
    if ($('qac').classList.contains('open')) { closeAc(); return; }
    if (S.cur === 'qstart' || S.cur === 'qlock') { toast('You are on Start'); return; }
    const wasApp = S.cur === 'qappv';
    let prev = S.stack.pop() || 'qstart';
    while (prev === 'qappv' || prev === 'qrec') prev = S.stack.pop() || 'qstart';
    showScreen(prev, false);
    if (wasApp) leaveAppView();
  }

  function goStart() {
    const wasApp = S.cur === 'qappv';
    S.stack = [];
    showScreen('qstart', false);
    if (wasApp) leaveAppView();
  }

  window.addEventListener('popstate', () => {
    if (!root.classList.contains('on')) return;
    try { history.pushState({ qos: S.cur }, ''); } catch (e) {}
    back();
  });

  // ---------- wallpaper and status ----------
  function applyWall() {
    root.style.backgroundImage = S.wall ? 'url("' + S.wall + '")' : 'linear-gradient(160deg, #031a4a, #0a3fa6 45%, #061230)';
    $('qsPcImg').style.backgroundImage = S.wall ? 'url("' + S.wall + '")' : '';
  }

  function renderStatus() {
    const i = S.info || {};
    $('qsbName').textContent = i.name || 'PC';
    $('qsbWifi').replaceChildren(svg(i.wifi ? IC.wifi : IC.network));
    $('qsbBat').textContent = i.battery ? i.battery.percent + '%' + (i.battery.charging ? ' ⚡' : '') : '';
    $('qlHello').textContent = 'Hello, ' + (i.fullName || i.user || 'there');
    const card = $('qlCard'); card.replaceChildren();
    const row = (icon, text, right) => { const r = el('div', 'row'); r.append(svg(icon), el('div', '', text)); if (right) r.append(el('span', '', right)); card.append(r); };
    row(IC.desktop, i.name || 'Your PC', i.os || '');
    if (i.battery) row(IC.battery, 'Battery ' + i.battery.percent + '%', i.battery.charging ? 'Charging' : 'On battery');
    row(IC.wifi, i.wifi ? 'Connected to ' + i.wifi : 'Connected by cable or other network');
    if (i.storage) row(IC.storage, gb(i.storage.free) + ' free', 'of ' + gb(i.storage.total));
  }

  // ---------- Start screen tiles ----------
  const PREFERRED = [/^microsoft edge$/i, /^google chrome$/i, /^file explorer$/i, /^word$/i, /^excel$/i, /^powerpoint$/i, /^outlook/i, /^photos$/i, /^calculator$/i, /^notepad$/i, /^paint$/i, /^camera$/i, /^microsoft store$/i, /solidworks/i, /^autocad/i, /^whatsapp/i, /^spotify/i, /^vlc/i, /^task manager$/i, /^(windows )?terminal$|^command prompt$/i, /^calendar$/i, /^mail$/i];
  const pinKey = () => 'qos.pins.' + S.pcId;

  function pins() {
    try { const saved = JSON.parse(localStorage.getItem(pinKey())); if (Array.isArray(saved)) return saved.filter((id) => S.apps.some((a) => a.id === id)); } catch (e) {}
    const chosen = [];
    for (const re of PREFERRED) { const a = S.apps.find((x) => re.test(x.name) && !chosen.includes(x.id)); if (a) chosen.push(a.id); }
    for (const a of S.apps) { if (chosen.length >= 12) break; if (!chosen.includes(a.id)) chosen.push(a.id); }
    return chosen.slice(0, 14);
  }
  function savePins(list) { try { localStorage.setItem(pinKey(), JSON.stringify(list)); } catch (e) {} }

  function tile(size, label, onTap, onHold) {
    const t = el('button', 'tile ' + size);
    t.setAttribute('aria-label', label);
    if (label) t.append(el('span', 'lab', label));
    let timer = null, held = false;
    t.addEventListener('pointerdown', () => { held = false; if (onHold) timer = setTimeout(() => { held = true; buzz(25); onHold(); }, 600); });
    const cancel = () => clearTimeout(timer);
    t.addEventListener('pointerup', cancel); t.addEventListener('pointerleave', cancel); t.addEventListener('pointercancel', cancel);
    t.addEventListener('click', () => { if (!held) onTap(); });
    t.addEventListener('contextmenu', (e) => e.preventDefault());
    return t;
  }

  function live(lines) {
    const box = el('div', 'live');
    lines.forEach(([cls, text]) => box.append(el('div', cls, text)));
    return box;
  }

  function appIcon(a, cls) {
    if (a.icon) { const img = el('img'); img.src = a.icon; img.alt = ''; return img; }
    return el('span', cls || 'glyph', (a.name || '?').trim().charAt(0).toUpperCase());
  }

  function renderTiles() {
    const box = $('qtiles'); box.replaceChildren();
    const i = S.info || {};
    // Live tiles made from this PC's own information
    const pcT = tile('w', '', () => openSettingsScreen());
    pcT.append(live([['sm', 'This PC'], ['big', i.name || 'PC'], ['sm', [i.maker, i.model].filter(Boolean).join(' ') || i.os || ''], ['sm', i.fullName || i.user || '']]));
    box.append(pcT);

    const dateT = tile('m', '', () => openSettingsPage('time', 'Date and time'));
    dateT.id = 'tileDate';
    dateT.append(live([['sm', ''], ['big', ''], ['mid', '']]));
    box.append(dateT);

    const setT = tile('m', 'Settings', () => openSettingsScreen()); setT.append(svg(IC.gear)); box.append(setT);

    if (i.storage) {
      const used = 1 - i.storage.free / i.storage.total;
      const st = tile('m', 'Storage', () => openSettingsPage('storage', 'Storage'));
      const lv = live([['sm', 'Drive C:'], ['mid', gb(i.storage.free) + ' free'], ['sm', 'of ' + gb(i.storage.total)]]);
      const bar = el('div', 'bar'); const fill = el('i'); fill.style.width = Math.round(used * 100) + '%'; bar.append(fill); lv.append(bar);
      st.append(lv); box.append(st);
    }
    const wifiT = tile('s', 'Wi-Fi', () => openSettingsPage('wifi', 'Wi-Fi')); wifiT.append(svg(IC.wifi)); box.append(wifiT);
    if (i.battery) { const b = tile('s', 'Battery', () => openSettingsPage('battery', 'Battery')); b.append(el('span', 'glyph', String(i.battery.percent))); box.append(b); }
    const recT = tile('s', 'Recent apps', () => openRecents()); recT.append(svg(IC.recent)); box.append(recT);
    const deskT = tile('s', 'PC desktop', () => openDesktop()); deskT.append(svg(IC.desktop)); box.append(deskT);

    // Apps from the PC's Start menu
    const sizes = ['m', 'm', 's', 's', 's', 's', 'm', 's', 's', 's', 's', 'm', 'm', 's'];
    pins().forEach((id, n) => {
      const a = S.apps.find((x) => x.id === id);
      if (!a) return;
      const t = tile(sizes[n % sizes.length], a.name, () => openApp(a), () => {
        if (confirm('Unpin ' + a.name + ' from Start?')) { savePins(pins().filter((x) => x !== a.id)); renderTiles(); }
      });
      t.prepend(appIcon(a));
      box.append(t);
    });
    tickClock();
  }

  function sizeTiles() {
    const w = Math.min(root.clientWidth || window.innerWidth, 560);
    $('qtiles').style.setProperty('--u', Math.floor((w - 12 - 25) / 6) + 'px');
    $('qtiles').style.maxWidth = '560px';
  }

  // ---------- all apps ----------
  function renderApps() {
    const box = $('qappList'); box.replaceChildren();
    const q = $('qsearch').value.trim().toLowerCase();
    const list = S.apps.filter((a) => !q || a.name.toLowerCase().includes(q));
    if (!S.apps.length) { box.append(el('div', '', '')); const l = el('div', '', 'Loading the apps from your PC...'); l.id = 'qloading'; box.append(l); return; }
    if (!list.length) { const l = el('div', '', 'No app called "' + q + '" on your PC.'); l.id = 'qloading'; box.append(l); return; }
    let letter = null;
    list.forEach((a) => {
      const L = /[a-z]/i.test(a.name[0]) ? a.name[0].toUpperCase() : '#';
      if (!q && L !== letter) { letter = L; box.append(el('div', 'letter', L)); }
      const r = el('button', 'arow');
      const ico = el('span', 'ico'); ico.append(appIcon(a, ''));
      r.append(ico, el('span', 't', a.name));
      let timer = null, held = false;
      r.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; buzz(25); pinPrompt(a); }, 600); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => r.addEventListener(ev, () => clearTimeout(timer)));
      r.addEventListener('click', () => { if (!held) openApp(a); });
      r.addEventListener('contextmenu', (e) => e.preventDefault());
      box.append(r);
    });
  }

  function pinPrompt(a) {
    const list = pins();
    if (list.includes(a.id)) { toast(a.name + ' is already on Start'); return; }
    if (confirm('Pin ' + a.name + ' to Start?')) { list.push(a.id); savePins(list); renderTiles(); toast('Pinned to Start'); }
  }

  // ---------- settings screen (rows open the real Windows Settings pages on the PC) ----------
  const SET_ROWS = [
    ['display', IC.display, 'Display', 'Screen, brightness, night light, scale'],
    ['sound', IC.sound, 'Sound', 'Volume levels, audio devices'],
    ['notifications', IC.bell, 'Notifications', 'Alerts from apps and system'],
    ['focus', IC.focus, 'Focus', 'Do not disturb, focus sessions'],
    ['power', IC.power, 'Power & sleep', 'Sleep, battery usage, power mode'],
    ['battery', IC.battery, 'Battery', 'Battery saver, usage', (i) => !!i.battery],
    ['storage', IC.storage, 'Storage', 'Space on your drives, cleanup'],
    ['network', IC.network, 'Network & internet', 'Wi-Fi, Ethernet, VPN'],
    ['bluetooth', IC.bt, 'Bluetooth & devices', 'Mouse, keyboard, printers'],
    ['personalization', IC.brush, 'Personalization', 'Background, colors, themes'],
    ['apps', IC.apps, 'Apps', 'Installed apps, default apps'],
    ['accounts', IC.user, 'Accounts', 'Your info, sign-in options'],
    ['time', IC.clock, 'Time & language', 'Date, region, typing'],
    ['privacy', IC.shield, 'Privacy & security', 'Permissions, Windows Security'],
    ['update', IC.update, 'Windows Update', 'Updates and history'],
    ['recovery', IC.recovery, 'Recovery', 'Reset, advanced startup'],
    ['about', IC.info, 'About', 'Device specifications'],
  ];

  function renderSettings() {
    const i = S.info || {};
    $('qsName').textContent = i.name || 'PC';
    $('qsModel').textContent = [i.maker, i.model].filter(Boolean).join(' ') || i.os || '';
    const who = (i.fullName || i.user || '?').trim();
    $('qsAv').textContent = who.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const box = $('qsetList'); box.replaceChildren();
    SET_ROWS.forEach(([page, icon, title, desc, when]) => {
      if (when && !when(i)) return;
      const r = el('button', 'srow');
      const g = el('div', 'grow'); g.append(el('div', 't', title), el('div', 'd', desc));
      const ch = svg(IC.chev); ch.classList.add('chev');
      r.append(svg(icon), g, ch);
      r.onclick = () => openSettingsPage(page, title);
      box.append(r);
    });
  }

  function openSettingsScreen() { renderSettings(); showScreen('qset'); }

  // ---------- one PC app on the phone ----------
  const V = { s: 1, tx: 0, ty: 0, base: { x: 0, y: 0, w: 1, h: 1 } };
  const appv = $('qappv'), video = $('qvideo');

  function aspect() { return (appv.clientHeight || window.innerHeight - 52) / (appv.clientWidth || window.innerWidth); }

  function waiting(text) { $('qwaitText').textContent = text; $('qwait').style.display = 'flex'; video.style.visibility = 'hidden'; }
  function ready() { $('qwait').style.display = 'none'; video.style.visibility = 'visible'; V.s = 1; V.tx = 0; V.ty = 0; layoutVideo(); }

  async function showOnPhone(label, op, args) {
    S.appName = label;
    showScreen('qappv');
    waiting('Opening ' + label + ' on your PC...');
    let r = null;
    try { r = await req(op, Object.assign({ aspect: aspect() }, args), 30000); } catch (e) {}
    if (S.cur !== 'qappv') return;
    if (!r || !r.ok) { toast('Could not open ' + label + ' on your PC'); back(); return; }
    if (r.name) S.appName = r.name;
    ready();
  }

  function openApp(a) { showOnPhone(a.name, 'openApp', { id: a.id }); }
  function openSettingsPage(page, title) { showOnPhone(title || 'Settings', 'openSettings', { page }); }

  function layoutVideo() {
    const W = appv.clientWidth, H = appv.clientHeight;
    const vw = video.videoWidth || W, vh = video.videoHeight || H;
    const k = Math.min(W / vw, H / vh);
    const w = vw * k, h = vh * k;
    V.base = { x: (W - w) / 2, y: (H - h) / 2, w, h };
    V.s = Math.min(5, Math.max(1, V.s));
    const sw = w * V.s, sh = h * V.s;
    V.tx = sw <= W ? (W - sw) / 2 - V.base.x : Math.min(-V.base.x, Math.max(W - V.base.x - sw, V.tx));
    V.ty = sh <= H ? (H - sh) / 2 - V.base.y : Math.min(-V.base.y, Math.max(H - V.base.y - sh, V.ty));
    video.style.left = V.base.x + 'px'; video.style.top = V.base.y + 'px';
    video.style.width = w + 'px'; video.style.height = h + 'px';
    video.style.transform = 'translate(' + V.tx + 'px,' + V.ty + 'px) scale(' + V.s + ')';
  }
  video.addEventListener('loadedmetadata', layoutVideo);
  video.addEventListener('resize', layoutVideo);

  function toPc(cx, cy) {
    const r = appv.getBoundingClientRect();
    const x = (cx - r.left - V.base.x - V.tx) / (V.base.w * V.s);
    const y = (cy - r.top - V.base.y - V.ty) / (V.base.h * V.s);
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }
  const send = (ev) => window.QCR && window.QCR.send(ev);

  // Touch like a phone: tap = click, slide up/down = scroll, slide sideways = drag, hold = right click, pinch = zoom.
  const G = { one: null, two: null };
  appv.addEventListener('touchstart', (e) => {
    if (S.cur !== 'qappv') return;
    e.preventDefault();
    const ts = e.touches;
    if (ts.length >= 2) {
      if (G.one) { clearTimeout(G.one.timer); if (G.one.mode === 'drag') send({ t: 'up', b: 'left', ...G.one.pos }); G.one = null; }
      const a = ts[0], b = ts[1];
      G.two = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2, s0: V.s, tx0: V.tx, ty0: V.ty };
      return;
    }
    if (G.two) return;
    const t = ts[0];
    const one = { sx: t.clientX, sy: t.clientY, t0: Date.now(), mode: null, held: false, wheel: 0, pos: toPc(t.clientX, t.clientY) };
    one.timer = setTimeout(() => { one.held = true; buzz(25); send({ t: 'click', b: 'right', ...one.pos }); }, 550);
    G.one = one;
  }, { passive: false });

  appv.addEventListener('touchmove', (e) => {
    if (S.cur !== 'qappv') return;
    e.preventDefault();
    const ts = e.touches;
    if (G.two && ts.length >= 2) {
      const a = ts[0], b = ts[1], two = G.two;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
      const r = appv.getBoundingClientRect();
      const lx = two.mx - r.left, ly = two.my - r.top;
      const s1 = Math.min(5, Math.max(1, two.s0 * d / two.d0));
      V.tx = lx - V.base.x - (lx - V.base.x - two.tx0) * (s1 / two.s0) + (mx - two.mx);
      V.ty = ly - V.base.y - (ly - V.base.y - two.ty0) * (s1 / two.s0) + (my - two.my);
      V.s = s1; layoutVideo();
      return;
    }
    const one = G.one;
    if (!one || ts.length !== 1) return;
    const t = ts[0], dx = t.clientX - one.sx, dy = t.clientY - one.sy;
    if (!one.mode && !one.held && Math.hypot(dx, dy) > 10) {
      clearTimeout(one.timer);
      if (Math.abs(dy) >= Math.abs(dx)) { one.mode = 'scroll'; send({ t: 'move', ...one.pos }); }
      else { one.mode = 'drag'; send({ t: 'down', b: 'left', ...one.pos }); }
    }
    if (one.mode === 'scroll') {
      const steps = Math.trunc((dy - one.wheel * 40) / 40);
      if (steps) { send({ t: 'wheel', d: steps }); one.wheel += steps; }
    } else if (one.mode === 'drag') {
      one.pos = toPc(t.clientX, t.clientY);
      send({ t: 'move', ...one.pos });
    }
  }, { passive: false });

  function touchEnd(e) {
    if (S.cur !== 'qappv') return;
    e.preventDefault();
    if (G.two) { if (e.touches.length === 0) G.two = null; return; }
    const one = G.one;
    if (!one || e.touches.length) return;
    clearTimeout(one.timer);
    if (one.mode === 'drag') send({ t: 'up', b: 'left', ...one.pos });
    else if (!one.mode && !one.held) send({ t: 'click', b: 'left', ...one.pos });
    G.one = null;
  }
  appv.addEventListener('touchend', touchEnd, { passive: false });
  appv.addEventListener('touchcancel', touchEnd, { passive: false });
  // Mouse (testing on a computer)
  appv.addEventListener('mousedown', (e) => { if (S.cur === 'qappv' && !('ontouchstart' in window)) send({ t: 'click', b: e.button === 2 ? 'right' : 'left', ...toPc(e.clientX, e.clientY) }); });
  appv.addEventListener('wheel', (e) => { if (S.cur === 'qappv') { e.preventDefault(); send({ t: 'move', ...toPc(e.clientX, e.clientY) }); send({ t: 'wheel', d: e.deltaY > 0 ? -1 : 1 }); } }, { passive: false });
  appv.addEventListener('contextmenu', (e) => e.preventDefault());

  // Phone keyboard -> PC
  const kb = $('qkb');
  const SENT = ' ';
  function resetKb() { kb.value = SENT; try { kb.setSelectionRange(1, 1); } catch (e) {} }
  kb.addEventListener('input', () => {
    const v = kb.value;
    if (v.length < SENT.length) send({ t: 'key', k: 'Backspace' });
    else if (v.length > SENT.length) send({ t: 'text', s: v.slice(SENT.length) });
    resetKb();
  });
  kb.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send({ t: 'key', k: 'Enter' }); } });

  window.addEventListener('resize', () => {
    if (!root.classList.contains('on')) return;
    sizeTiles();
    if (S.cur === 'qappv') { layoutVideo(); clearTimeout(window.__qr); window.__qr = setTimeout(() => req('reshape', { aspect: aspect() }).catch(() => {}), 400); }
  });

  // ---------- recent apps (windows open on the PC) ----------
  async function openRecents() {
    showScreen('qrec');
    const box = $('qrecList'); box.replaceChildren(el('div', 'none', 'Looking at your PC...'));
    let list = [];
    try { list = await req('windows', {}, 20000) || []; } catch (e) {}
    if (S.cur !== 'qrec') return;
    box.replaceChildren();
    if (!list.length) { box.append(el('div', 'none', 'No apps are open on your PC.')); return; }
    list.forEach((w) => {
      const c = el('div', 'rcard');
      const top = el('div', 'top');
      if (w.icon) { const im = el('img'); im.src = w.icon; im.alt = ''; top.append(im); }
      top.append(el('span', 'n', w.name));
      const x = el('button', '', '✕'); x.setAttribute('aria-label', 'Close ' + w.name + ' on the PC');
      x.onclick = async () => { if (!confirm('Close ' + w.name + ' on your PC?')) return; c.remove(); try { await req('closeWindow', { id: w.id }); } catch (e) {} };
      top.append(x);
      const shot = el('button', 'shot'); shot.setAttribute('aria-label', 'Open ' + w.name);
      if (w.thumb) shot.style.backgroundImage = 'url("' + w.thumb + '")';
      shot.onclick = () => showOnPhone(w.name, 'openWindow', { id: w.id });
      c.append(top, shot);
      box.append(c);
    });
  }

  // ---------- the whole PC desktop (classic remote control) ----------
  async function openDesktop() {
    toast('Opening the PC desktop...');
    let r = null;
    try { r = await req('desktop', {}, 20000); } catch (e) {}
    if (!r || !r.ok) { toast('Could not show the PC desktop'); return; }
    root.classList.remove('on');
    window.QCR.enterView();
  }
  async function fromDesktop() {
    try { await req('home', {}, 8000); } catch (e) {}
    root.classList.add('on');
    S.stack = []; S.cur = null; showScreen('qstart', false);
  }

  // ---------- quick settings (pull down from the top) ----------
  function renderAc() {
    const i = S.info || {};
    const g = $('qacGrid'); g.replaceChildren();
    const q = (icon, label, sub, on, page, title) => {
      const b = el('button', 'qt' + (on ? ' on' : ''));
      b.append(svg(icon), el('span', '', label));
      if (sub) b.append(el('small', '', sub));
      b.onclick = () => { closeAc(); openSettingsPage(page, title || label); };
      g.append(b);
    };
    q(IC.wifi, 'Wi-Fi', i.wifi || 'Not on Wi-Fi', !!i.wifi, 'wifi');
    q(IC.bt, 'Bluetooth', '', false, 'bluetooth');
    q(IC.plane, 'Airplane mode', '', false, 'airplane');
    if (i.battery) q(IC.battery, 'Battery saver', i.battery.percent + '%', false, 'battery');
    q(IC.focus, 'Focus', '', false, 'focus');
    q(IC.moon, 'Night light', '', false, 'nightlight');
    q(IC.access, 'Accessibility', '', false, 'accessibility');
    q(IC.display, 'Display', '', false, 'display');
    if (!i.battery) q(IC.network, 'Network', '', false, 'network');

    const vol = i.volume;
    $('qVol').value = vol === null || vol === undefined ? 50 : vol;
    $('qVolV').textContent = vol === null || vol === undefined ? '' : vol;
    $('qBriRow').style.display = i.brightness === null || i.brightness === undefined ? 'none' : 'flex';
    if (i.brightness !== null && i.brightness !== undefined) { $('qBri').value = i.brightness; $('qBriV').textContent = i.brightness; }

    const st = $('qacStats'); st.replaceChildren();
    const stat = (k, v) => { const r = el('div', 'stat'); r.append(el('span', '', k), el('b', '', v)); st.append(r); };
    stat('PC', (i.name || 'PC') + (i.os ? ' · ' + i.os : ''));
    if (i.storage) stat('Drive C:', gb(i.storage.free) + ' free of ' + gb(i.storage.total));
    if (i.ram) stat('Memory', gb(i.ram.total - i.ram.free) + ' used of ' + gb(i.ram.total));
    if (i.battery) stat('Battery', i.battery.percent + '%' + (i.battery.charging ? ', charging' : ''));
    if (i.uptime) { const h = Math.floor(i.uptime / 3600); stat('On for', h >= 24 ? Math.floor(h / 24) + ' days ' + (h % 24) + ' h' : h + ' h ' + Math.floor((i.uptime % 3600) / 60) + ' min'); }
  }
  function openAc() { renderAc(); $('qac').classList.add('open'); refreshInfo(); }
  function closeAc() { $('qac').classList.remove('open'); }

  let volTimer = null;
  $('qVol').addEventListener('input', () => {
    $('qVolV').textContent = $('qVol').value;
    clearTimeout(volTimer);
    volTimer = setTimeout(() => req('volume', { value: Number($('qVol').value) }).catch(() => {}), 350);
  });
  $('qVolRow').querySelector('svg').addEventListener('click', () => { req('mute').catch(() => {}); toast('Mute switched on the PC'); });
  let briTimer = null;
  $('qBri').addEventListener('input', () => {
    $('qBriV').textContent = $('qBri').value;
    clearTimeout(briTimer);
    briTimer = setTimeout(() => req('brightness', { value: Number($('qBri').value) }).catch(() => {}), 350);
  });

  $('qsb').addEventListener('click', () => ($('qac').classList.contains('open') ? closeAc() : openAc()));
  $('qac').querySelector('.grab').addEventListener('click', closeAc);
  // Pull down from the top edge
  (() => {
    let y0 = null;
    root.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY < 36 && S.cur !== 'qlock' ? e.touches[0].clientY : null; }, { passive: true });
    root.addEventListener('touchmove', (e) => { if (y0 !== null && e.touches[0].clientY - y0 > 50) { y0 = null; openAc(); } }, { passive: true });
    let a0 = null;
    $('qac').addEventListener('touchstart', (e) => { a0 = e.touches[0].clientY; }, { passive: true });
    $('qac').addEventListener('touchmove', (e) => { if (a0 !== null && a0 - e.touches[0].clientY > 70 && $('qac').scrollTop <= 0) { a0 = null; closeAc(); } }, { passive: true });
  })();

  // ---------- lock screen ----------
  (() => {
    const lock = $('qlock');
    let y0 = null;
    const open = () => { if (S.cur === 'qlock') { showScreen('qstart', false); } };
    lock.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    lock.addEventListener('touchmove', (e) => { if (y0 !== null && y0 - e.touches[0].clientY > 60) { y0 = null; open(); } }, { passive: true });
    lock.addEventListener('click', open);
  })();

  // ---------- nav bar ----------
  (() => {
    const b = $('qnBack');
    let timer = null, held = false;
    b.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; buzz(25); openRecents(); }, 550); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(timer)));
    b.addEventListener('click', () => { if (!held) back(); });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    $('qnStart').onclick = () => goStart();
    $('qnThird').onclick = () => {
      if (S.cur === 'qappv') { resetKb(); kb.focus(); return; }
      showScreen('qapps'); renderApps(); $('qsearch').focus();
    };
    $('qallBtn').onclick = () => { showScreen('qapps'); renderApps(); };
    $('qsearch').addEventListener('input', renderApps);
    root.querySelector('.pcard .rn').onclick = () => openSettingsPage('about', 'About');
  })();

  // ---------- loading the PC's data ----------
  async function refreshInfo() {
    try {
      const info = await req('info', {}, 25000);
      if (!info) return;
      S.info = info;
      if (Number.isFinite(info.time)) S.offset = info.time - Date.now();
      renderStatus();
      if (S.cur === 'qstart') renderTiles();
      if ($('qac').classList.contains('open')) renderAc();
    } catch (e) {}
  }

  async function enter(target) {
    S.pcId = target && target.id ? target.id : 'pc';
    S.stack = []; S.cur = null; S.apps = []; S.info = { name: target && target.name };
    root.classList.add('on');
    sizeTiles(); applyWall(); renderStatus();
    showScreen('qlock', false);
    renderTiles();
    S.timers.forEach(clearInterval);
    S.timers = [setInterval(tickClock, 5000), setInterval(refreshInfo, 60000)];
    tickClock();
    await refreshInfo();
    renderTiles();
    req('wallpaper', {}, 30000).then((w) => { if (w) { S.wall = w; applyWall(); } }).catch(() => {});
    try {
      const apps = await req('apps', {}, 90000);
      if (Array.isArray(apps)) { S.apps = apps; renderTiles(); if (S.cur === 'qapps') renderApps(); }
    } catch (e) { toast('Could not load the app list from your PC'); }
  }

  function leave() {
    S.timers.forEach(clearInterval); S.timers = [];
    pending.forEach((p) => clearTimeout(p.timer)); pending.clear();
    root.classList.remove('on');
    closeAc();
  }

  window.QOS = { enter, leave, onMessage, fromDesktop };

  // ---------- demo data, only when testing this page on the computer that serves it ----------
  const Demo = {
    req(op) {
      const wait = (v, ms = 120) => new Promise((r) => setTimeout(() => r(v), ms));
      if (op === 'info') return wait({ name: 'PRUTHVI-PC', user: 'pruthvi', fullName: 'Pruthvi Setty', os: 'Windows 11 Pro', maker: 'Dell Inc.', model: 'Inspiron 15 3520', battery: { percent: 84, charging: true }, wifi: 'Home_5G', brightness: 70, volume: 40, ram: { total: 16 * 2 ** 30, free: 7 * 2 ** 30 }, storage: { total: 476 * 2 ** 30, free: 182 * 2 ** 30 }, uptime: 5 * 3600 + 1240, time: Date.now(), tz: 330 });
      if (op === 'apps') return wait(['Microsoft Edge', 'Google Chrome', 'File Explorer', 'Word', 'Excel', 'PowerPoint', 'Outlook', 'Photos', 'Calculator', 'Notepad', 'Paint', 'Camera', 'Microsoft Store', 'SOLIDWORKS 2024', 'AutoCAD 2025', 'WhatsApp', 'Spotify', 'VLC media player', 'Task Manager', 'Terminal', 'Adobe Acrobat', 'ANSYS Workbench', 'CATIA V5', 'Fusion 360', 'Settings', 'Snipping Tool'].sort().map((n) => ({ name: n, id: n, icon: null })), 400);
      if (op === 'wallpaper') return wait(null);
      if (op === 'windows') return wait([{ id: 'w1', name: 'Document1 - Word', thumb: null }, { id: 'w2', name: 'Settings', thumb: null }]);
      return wait({ ok: false }, 600);
    },
  };
  if (demo) setTimeout(() => enter({ id: 'demo', name: 'PRUTHVI-PC' }), 50);
})();
