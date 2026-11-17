// Q-OS - the PC side of the phone interface.
// Everything the phone shows comes from this PC: its name, user, wallpaper, apps,
// battery, Wi-Fi, storage and settings. The phone only draws it.
// Copyright (c) 2026 Pruthvi. All rights reserved.
'use strict';

const { app, shell, desktopCapturer, screen, nativeImage } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';

// ---------- Windows calls (window position, focus, close) ----------
let w32 = null;
if (isWin) {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const RECT = koffi.struct('QOS_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  w32 = {
    RECT_SIZE: koffi.sizeof(RECT),
    GetForegroundWindow: user32.func('intptr __stdcall GetForegroundWindow()'),
    SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(intptr hWnd)'),
    ShowWindow: user32.func('int __stdcall ShowWindow(intptr hWnd, int nCmdShow)'),
    IsWindow: user32.func('int __stdcall IsWindow(intptr hWnd)'),
    IsIconic: user32.func('int __stdcall IsIconic(intptr hWnd)'),
    SetWindowPos: user32.func('int __stdcall SetWindowPos(intptr hWnd, intptr after, int X, int Y, int cx, int cy, uint32 flags)'),
    PostMessageW: user32.func('int __stdcall PostMessageW(intptr hWnd, uint32 msg, uintptr w, intptr l)'),
    GetWindowRect: user32.func('int __stdcall GetWindowRect(intptr hWnd, _Out_ QOS_RECT *rect)'),
    keybd_event: user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)'),
    DwmGetWindowAttribute: dwmapi.func('long __stdcall DwmGetWindowAttribute(intptr hWnd, uint32 attr, _Out_ QOS_RECT *value, uint32 size)'),
  };
}

const SW_RESTORE = 9;
const WM_CLOSE = 0x0010;
const HWND_TOPMOST = -1, HWND_NOTOPMOST = -2;
const SWP_NOMOVE = 0x2, SWP_NOSIZE = 0x1, SWP_SHOWWINDOW = 0x40;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;

// ---------- small helpers ----------
function run(file, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

function ps(script, timeoutMs) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], timeoutMs);
}

async function psJson(script, timeoutMs) {
  const out = (await ps(script, timeoutMs)).trim();
  try { return JSON.parse(out); } catch (e) { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hwndOf = (sourceId) => { const m = /^window:(\d+):/.exec(String(sourceId || '')); return m ? Number(m[1]) : 0; };

// ---------- this PC ----------
let infoCache = null, infoAt = 0;

async function pcInfo() {
  const info = await pcInfoCached();
  // The PC's own clock and time zone, so the phone shows the PC's time.
  return Object.assign({}, info, { time: Date.now(), tz: -new Date().getTimezoneOffset(), volume: volumeGuess });
}

async function pcInfoCached() {
  if (infoCache && Date.now() - infoAt < 30000) return infoCache;
  const user = os.userInfo().username;
  const info = {
    name: os.hostname(),
    user,
    os: 'Windows',
    model: '',
    maker: '',
    battery: null,        // { percent, charging } or null on a desktop PC
    wifi: '',
    brightness: null,     // 0..100, or null when the screen cannot be dimmed (most desktop monitors)
    ram: { total: os.totalmem(), free: os.freemem() },
    storage: null,
    uptime: os.uptime(),
  };
  if (isWin) {
    const data = await psJson(
      "$ErrorActionPreference='SilentlyContinue';" +
      "$cs=Get-CimInstance Win32_ComputerSystem;$os=Get-CimInstance Win32_OperatingSystem;" +
      "$b=Get-CimInstance Win32_Battery|Select-Object -First 1;" +
      "$br=(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness|Select-Object -First 1).CurrentBrightness;" +
      "$fn=(Get-CimInstance Win32_UserAccount -Filter \"Name='$env:USERNAME' AND LocalAccount=True\").FullName;" +
      "[pscustomobject]@{maker=$cs.Manufacturer;model=$cs.Model;os=$os.Caption;" +
      "bat=$b.EstimatedChargeRemaining;batStatus=$b.BatteryStatus;bright=$br;full=$fn}|ConvertTo-Json -Compress");
    if (data) {
      info.maker = String(data.maker || '').trim();
      info.model = String(data.model || '').trim();
      info.os = String(data.os || 'Windows').replace(/^Microsoft\s+/, '').trim();
      if (data.full) info.fullName = String(data.full).trim();
      if (data.bat !== null && data.bat !== undefined) info.battery = { percent: Number(data.bat), charging: Number(data.batStatus) === 2 };
      if (data.bright !== null && data.bright !== undefined) info.brightness = Number(data.bright);
    }
    const wlan = await run('netsh', ['wlan', 'show', 'interfaces'], 5000);
    const m = /^\s*SSID\s*:\s*(.+)$/m.exec(wlan);
    info.wifi = m ? m[1].trim() : '';
    try {
      const st = fs.statfsSync(process.env.SystemDrive ? process.env.SystemDrive + '\\' : 'C:\\');
      info.storage = { total: st.blocks * st.bsize, free: st.bavail * st.bsize };
    } catch (e) {}
  }
  infoCache = info; infoAt = Date.now();
  return info;
}

// ---------- desktop wallpaper (shown on the phone's lock and start screens) ----------
async function wallpaper() {
  const candidates = [];
  if (isWin) {
    const out = await run('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], 5000);
    const m = /WallPaper\s+REG_SZ\s+(.+)$/m.exec(out);
    if (m) candidates.push(m[1].trim());
    if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper'));
  }
  for (const file of candidates) {
    try {
      if (!file || !fs.existsSync(file)) continue;
      let img = nativeImage.createFromBuffer(fs.readFileSync(file));
      if (img.isEmpty()) continue;
      const s = img.getSize();
      if (s.width > 900) img = img.resize({ width: 900, quality: 'good' });
      return 'data:image/jpeg;base64,' + img.toJPEG(72).toString('base64');
    } catch (e) {}
  }
  return null;
}

// ---------- the apps installed on this PC (same list as the Windows Start menu) ----------
let appsCache = null, appsAt = 0;

function shortcutFolders() {
  const list = [];
  if (process.env.ProgramData) list.push(path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  if (process.env.APPDATA) list.push(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  return list;
}

function findShortcuts(dir, out, depth = 0) {
  if (depth > 4) return;
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) findShortcuts(p, out, depth + 1);
    else if (/\.(lnk|url)$/i.test(it.name)) out.set(it.name.replace(/\.(lnk|url)$/i, '').toLowerCase(), p);
  }
}

const SKIP = /uninstall|readme|read me|help|documentation|website|release notes|license|manual|support|\bfaq\b/i;

async function iconFor(file) {
  try {
    const img = await app.getFileIcon(file, { size: 'large' });
    if (img && !img.isEmpty()) return img.toDataURL();
  } catch (e) {}
  return null;
}

async function listApps() {
  if (appsCache && Date.now() - appsAt < 5 * 60000) return appsCache;
  let apps = [];
  if (isWin) {
    const data = await psJson('Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress', 30000);
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const links = new Map();
    shortcutFolders().forEach((d) => findShortcuts(d, links));
    const seen = new Set();
    for (const r of rows) {
      const name = String(r.Name || '').trim();
      const id = String(r.AppID || '').trim();
      if (!name || !id || SKIP.test(name) || seen.has(name.toLowerCase())) continue;
      if (/^https?:/i.test(id)) continue;
      seen.add(name.toLowerCase());
      apps.push({ name, id, link: links.get(name.toLowerCase()) || null });
    }
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  for (const a of apps) a.icon = a.link ? await iconFor(a.link) : null;
  appsCache = apps; appsAt = Date.now();
  return apps;
}

// ---------- Windows Settings pages the phone may open ----------
const SETTINGS = {
  system: 'ms-settings:', display: 'ms-settings:display', sound: 'ms-settings:sound',
  notifications: 'ms-settings:notifications', focus: 'ms-settings:quiethours', power: 'ms-settings:powersleep',
  battery: 'ms-settings:batterysaver', storage: 'ms-settings:storagesense', recovery: 'ms-settings:recovery',
  about: 'ms-settings:about', network: 'ms-settings:network', wifi: 'ms-settings:network-wifi',
  bluetooth: 'ms-settings:bluetooth', personalization: 'ms-settings:personalization', apps: 'ms-settings:appsfeatures',
  accounts: 'ms-settings:yourinfo', update: 'ms-settings:windowsupdate', nightlight: 'ms-settings:nightlight',
  accessibility: 'ms-settings:easeofaccess', time: 'ms-settings:dateandtime', privacy: 'ms-settings:privacy',
  airplane: 'ms-settings:network-airplanemode', developer: 'ms-settings:developers',
};

// ---------- windows that are open on the PC (for "recent apps") ----------
async function windowSources(thumb) {
  const size = thumb ? { width: 240, height: 420 } : { width: 0, height: 0 };
  const list = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size, fetchWindowIcons: !!thumb });
  return list.filter((s) => s.name && !/^Q-CUBIC|^Q-OS/.test(s.name));
}

async function openWindows() {
  const list = await windowSources(true);
  return list.slice(0, 16).map((s) => ({
    id: s.id,
    name: s.name,
    thumb: s.thumbnail && !s.thumbnail.isEmpty() ? 'data:image/jpeg;base64,' + s.thumbnail.toJPEG(60).toString('base64') : null,
    icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
  }));
}

// ---------- putting one window in "phone shape" ----------
function frameRect(hwnd) {
  if (!w32) return null;
  const r = {};
  if (w32.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, w32.RECT_SIZE) !== 0) {
    if (!w32.GetWindowRect(hwnd, r)) return null;
  }
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

function bringToFront(hwnd) {
  if (!w32 || !w32.IsWindow(hwnd)) return;
  if (w32.IsIconic(hwnd)) w32.ShowWindow(hwnd, SW_RESTORE);
  // Windows only lets the active app change focus; a tap of Alt makes the request allowed.
  w32.keybd_event(0x12, 0, 0, 0);
  w32.keybd_event(0x12, 0, 2, 0);
  w32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
  w32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
  w32.SetForegroundWindow(hwnd);
}

// aspect = phone height / width. The window is made as tall as the PC screen and as wide as the phone shape.
function phoneShape(hwnd, aspect) {
  if (!w32 || !w32.IsWindow(hwnd)) return;
  const d = screen.getPrimaryDisplay();
  const wa = d.workArea, k = d.scaleFactor;
  const a = Math.min(3, Math.max(1.2, Number(aspect) || 2.1));
  const h = wa.height;
  const w = Math.max(360, Math.round(h / a));
  const x = wa.x + Math.round((wa.width - w) / 2);
  if (w32.IsIconic(hwnd)) w32.ShowWindow(hwnd, SW_RESTORE);
  w32.SetWindowPos(hwnd, 0, Math.round(x * k), Math.round(wa.y * k), Math.round(w * k), Math.round(h * k), SWP_SHOWWINDOW);
  bringToFront(hwnd);
}

// Only steal focus when another window is in front (avoids stray Alt presses).
function ensureFront(hwnd) {
  if (!w32 || !w32.IsWindow(hwnd)) return;
  if (Number(w32.GetForegroundWindow()) !== Number(hwnd)) bringToFront(hwnd);
}

function closeWindow(hwnd) { if (w32 && w32.IsWindow(hwnd)) w32.PostMessageW(hwnd, WM_CLOSE, 0, 0); }

// Launch something, then find the window it opened.
async function launchAndFind(start, nameHint) {
  const before = new Set((await windowSources(false)).map((s) => s.id));
  const fgBefore = w32 ? Number(w32.GetForegroundWindow()) : 0;
  await start();
  const hint = String(nameHint || '').toLowerCase();
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const list = await windowSources(false);
    const fresh = list.find((s) => !before.has(s.id));
    if (fresh) return fresh;
    if (hint && i >= 4) {
      const named = list.find((s) => s.name.toLowerCase().includes(hint));
      if (named) return named;
    }
    if (w32 && i >= 6) {
      const fg = Number(w32.GetForegroundWindow());
      if (fg && fg !== fgBefore) {
        const match = list.find((s) => hwndOf(s.id) === fg);
        if (match) return match;
      }
    }
  }
  return null;
}

async function openApp(id) {
  const apps = await listApps();
  const a = apps.find((x) => x.id === id);
  if (!a) return null;                       // only apps that really are on this PC
  return launchAndFind(() => run('explorer.exe', ['shell:AppsFolder\\' + a.id], 3000), a.name);
}

async function openSettings(page) {
  const uri = SETTINGS[page];
  if (!uri) return null;
  return launchAndFind(() => shell.openExternal(uri), 'settings');
}

// ---------- volume and brightness ----------
let volumeGuess = null;
async function setVolume(percent) {
  if (!w32) return;
  const p = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  // Each volume key is 2%. Go to zero, then up to the level asked for.
  for (let i = 0; i < 50; i++) { w32.keybd_event(0xAE, 0, 0, 0); w32.keybd_event(0xAE, 0, 2, 0); }
  for (let i = 0; i < Math.round(p / 2); i++) { w32.keybd_event(0xAF, 0, 0, 0); w32.keybd_event(0xAF, 0, 2, 0); }
  volumeGuess = p;
}
function toggleMute() { if (w32) { w32.keybd_event(0xAD, 0, 0, 0); w32.keybd_event(0xAD, 0, 2, 0); } }

async function setBrightness(percent) {
  const p = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  await ps('Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1;Brightness=' + p + '} | Out-Null', 8000);
  if (infoCache) infoCache.brightness = p;
}

module.exports = {
  pcInfo, wallpaper, listApps, openWindows, openApp, openSettings, phoneShape, bringToFront, ensureFront,
  closeWindow, frameRect, hwndOf, setVolume, toggleMute, setBrightness,
  volume: () => volumeGuess, SETTINGS,
};
