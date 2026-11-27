// Q-CUBIC Remote - host app (runs on the PC that is controlled)
// Copyright (c) 2026 Pruthvi. All rights reserved.
'use strict';

const { app, BrowserWindow, ipcMain, session, desktopCapturer, screen, Tray, Menu, nativeImage, powerSaveBlocker } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const input = require('./input');
const qos = require('./qos');

let win = null;
let tray = null;
let quitting = false;
// What the phone is looking at: null = nothing, 'screen' = the whole PC screen, or one app window.
let target = null;     // { kind: 'screen' } | { kind: 'window', sourceId, hwnd }
let lastHwnd = 0;      // the app window the phone showed last
const startHidden = process.argv.includes('--hidden');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ---------- saved settings: this PC's ID and the phones it trusts ----------
function configPath() { return path.join(app.getPath('userData'), 'qcubic-config.json'); }

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch {}
  if (!/^[1-9]\d{8}$/.test(cfg.deviceId || '')) {
    cfg.deviceId = String(crypto.randomInt(1, 10)) + String(crypto.randomInt(0, 100000000)).padStart(8, '0');
  }
  if (!Array.isArray(cfg.trusted)) cfg.trusted = [];
  saveConfig(cfg);
  return cfg;
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

let config = null;

// ---------- reaching the phone on any network ----------
// Most networks let the phone and PC talk directly. Mobile data, offices and hotels often
// do not; then the video goes through a TURN relay. Q-CUBIC's built-in relay link is set
// at build time; a link pasted in the PC window (Metered "TURN credentials" URL) wins.
const BUILTIN_TURN = '';
let turnCache = { at: 0, list: [] };
async function turnServers() {
  const link = String((config && config.turnLink) || BUILTIN_TURN || '').trim();
  if (!/^https:\/\//i.test(link)) return [];
  if (Date.now() - turnCache.at < 10 * 60000 && turnCache.link === link) return turnCache.list;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(link, { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    const j = await r.json();
    const arr = (Array.isArray(j) ? j : (j && j.iceServers) || []).filter((x) => x && x.urls)
      .map((x) => ({ urls: x.urls, username: x.username, credential: x.credential }));
    turnCache = { at: Date.now(), link, list: arr };
    return arr;
  } catch (e) {
    return turnCache.link === link ? turnCache.list : [];
  }
}

// Keep the screen awake while a phone is connected (a sleeping screen sends no picture).
let awakeId = null;
function setAwake(on) {
  if (on && awakeId === null) awakeId = powerSaveBlocker.start('prevent-display-sleep');
  if (!on && awakeId !== null) { try { powerSaveBlocker.stop(awakeId); } catch (e) {} awakeId = null; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 640,
    show: false,
    icon: iconImage(64),
    resizable: false,
    title: 'Q-CUBIC Remote',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'host.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });
  // Closing the window keeps Q-CUBIC running in the tray, so your phone can still connect.
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
}

function iconImage(size) {
  const img = nativeImage.createFromPath(path.join(__dirname, 'icon-192.png'));
  return img.isEmpty() ? img : img.resize({ width: size, height: size });
}

// Start with Windows (after you log in), hidden in the tray.
function setAutoStart(on) {
  if (!app.isPackaged && process.platform !== 'win32') return;
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
}
function autoStartOn() { return app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin; }

function createTray() {
  tray = new Tray(iconImage(16));
  tray.setToolTip('Q-CUBIC Remote - ready for your phone');
  const build = () => Menu.buildFromTemplate([
    { label: 'Show Q-CUBIC Remote', click: () => { win.show(); win.focus(); } },
    { label: 'Start with Windows', type: 'checkbox', checked: autoStartOn(), click: (i) => { setAutoStart(i.checked); config.autoStart = i.checked; saveConfig(config); } },
    { type: 'separator' },
    { label: 'Quit (phone can no longer connect)', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(build());
  tray.on('click', () => { win.show(); win.focus(); });
  tray.on('right-click', () => tray.setContextMenu(build()));
}

app.whenReady().then(() => {
  config = loadConfig();

  // The host window always captures the real PC screen, without a picker. For one app, the host
  // window then cuts out just that app's area, so videos and modern apps show exactly as on the monitor.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then((sources) => {
      const primaryId = String(screen.getPrimaryDisplay().id);
      const src = sources.find((s) => s.display_id === primaryId) || sources[0];
      callback(src ? { video: src } : {});
    }).catch(() => callback({}));
  });

  // Requests from the phone's Q-OS interface. Every request is checked here.
  ipcMain.handle('qos', async (_e, op, args) => {
    args = args && typeof args === 'object' ? args : {};
    const useWindow = (found) => {
      const src = found && found.src ? found.src : found;
      const want = found && found.want ? found.want : (src ? { name: src.name, exe: null } : null);
      if (!src) return { ok: false };
      const hwnd = qos.hwndOf(src.id, src.name);
      if (!qos.isWindow(hwnd)) return { ok: false };
      // The app shown before goes to the background, so it cannot cover the new one.
      if (lastHwnd && lastHwnd !== hwnd) qos.minimize(lastHwnd);
      lastHwnd = hwnd;
      target = { kind: 'window', sourceId: src.id, hwnd, want, aspect: args.aspect };
      qos.phoneShape(hwnd, args.aspect);
      return { ok: true, source: src.id, name: src.name, crop: true };
    };
    switch (op) {
      case 'info': return qos.pcInfo();
      case 'wallpaper': return qos.wallpaper();
      case 'apps': return qos.listApps();
      case 'windows': return qos.openWindows();
      case 'openApp': return useWindow(await qos.openApp(String(args.id || '')));
      case 'openSettings': return useWindow(await qos.openSettings(String(args.page || '')));
      case 'openWindow': {
        const all = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
        return useWindow(all.find((s) => s.id === String(args.id || '')));
      }
      case 'rect': {
        if (!target || target.kind !== 'window') return null;
        const t = target;
        if (!qos.isWindow(t.hwnd)) {
          // The window went away (a splash screen, or the app opened its real window). Follow the app.
          const again = t.want ? await qos.findWindow(t.want) : null;
          if (target !== t) return null;
          if (!again) return null;
          t.hwnd = qos.hwndOf(again.id, again.name); t.sourceId = again.id; lastHwnd = t.hwnd;
          qos.phoneShape(t.hwnd, t.aspect);
        }
        qos.keepFront(t.hwnd);
        return qos.windowRect(t.hwnd);
      }
      case 'front': if (target && target.kind === 'window') qos.ensureFront(target.hwnd); return { ok: true };
      case 'reshape': if (target && target.kind === 'window') { target.aspect = args.aspect; qos.phoneShape(target.hwnd, args.aspect); } return { ok: true };
      case 'closeWindow': {
        const hwnd = qos.hwndOf(String(args.id || (target && target.sourceId) || ''));
        if (hwnd) qos.closeWindow(hwnd);
        if (target && target.hwnd === hwnd) target = null;
        return { ok: true };
      }
      case 'desktop': target = { kind: 'screen' }; return { ok: true };
      case 'home': target = null; return { ok: true };
      case 'volume': await qos.setVolume(args.value); return { ok: true };
      case 'mute': qos.toggleMute(); return { ok: true };
      case 'brightness': await qos.setBrightness(args.value); return { ok: true };
      default: return { ok: false };
    }
  });

  ipcMain.handle('info', () => ({
    deviceId: config.deviceId,
    trusted: config.trusted.map((t) => ({ kid: t.kid, secret: t.secret, name: t.name })),
    hostName: os.hostname(),
    brokers: process.env.QCR_BROKERS ? process.env.QCR_BROKERS.split(',') : null,
    debug: !!process.env.QCR_DEBUG,
  }));
  ipcMain.handle('add-trusted', (_e, t) => {
    if (!t || typeof t.secret !== 'string' || typeof t.kid !== 'string') return false;
    config.trusted = config.trusted.filter((x) => x.kid !== t.kid);
    config.trusted.push({ kid: t.kid, secret: t.secret, name: String(t.name || 'Phone').slice(0, 60), added: new Date().toISOString() });
    saveConfig(config);
    return true;
  });
  ipcMain.handle('turn', () => turnServers());
  ipcMain.handle('turn-link', (_e, link) => {
    if (typeof link === 'string') {
      link = link.trim();
      if (link && !/^https:\/\//i.test(link)) return { ok: false };
      config.turnLink = link; saveConfig(config); turnCache = { at: 0, list: [] };
    }
    return { ok: true, link: config.turnLink || '', builtin: !!BUILTIN_TURN };
  });
  ipcMain.on('awake', (_e, on) => setAwake(!!on));
  ipcMain.handle('clear-trusted', () => { config.trusted = []; saveConfig(config); return true; });
  ipcMain.on('log', (_e, text) => { if (process.env.QCR_DEBUG) console.log('[host]', text); });
  ipcMain.on('input', (_e, ev) => {
    if (target && target.kind === 'window') {
      // Taps land inside the app window the phone is showing (Windows pixels, no extra scaling).
      const r = qos.frameRect(target.hwnd);
      if (!r) return;
      if (ev && (ev.t === 'down' || ev.t === 'click' || ev.t === 'dbl')) qos.ensureFront(target.hwnd);
      input.handle(ev, r, 1);
      return;
    }
    const d = screen.getPrimaryDisplay();
    input.handle(ev, d.bounds, d.scaleFactor);
  });

  createWindow();
  createTray();
  if (config.autoStart !== false) setAutoStart(true);    // on by default
  powerSaveBlocker.start('prevent-app-suspension');      // keep the PC reachable
});

app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.on('before-quit', () => { quitting = true; });

// Keep running in the tray when the window is closed.
app.on('window-all-closed', () => {});
