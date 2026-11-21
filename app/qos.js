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
  const kernel32 = koffi.load('kernel32.dll');
  const RECT = koffi.struct('QOS_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  w32 = {
    RECT_SIZE: koffi.sizeof(RECT),
    GetForegroundWindow: user32.func('intptr __stdcall GetForegroundWindow()'),
    SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(intptr hWnd)'),
    ShowWindow: user32.func('int __stdcall ShowWindow(intptr hWnd, int nCmdShow)'),
    IsWindow: user32.func('int __stdcall IsWindow(intptr hWnd)'),
    IsIconic: user32.func('int __stdcall IsIconic(intptr hWnd)'),
    IsZoomed: user32.func('int __stdcall IsZoomed(intptr hWnd)'),
    FindWindowW: user32.func('intptr __stdcall FindWindowW(const char16_t *cls, const char16_t *title)'),
    SetWindowPos: user32.func('int __stdcall SetWindowPos(intptr hWnd, intptr after, int X, int Y, int cx, int cy, uint32 flags)'),
    PostMessageW: user32.func('int __stdcall PostMessageW(intptr hWnd, uint32 msg, uintptr w, intptr l)'),
    GetWindowRect: user32.func('int __stdcall GetWindowRect(intptr hWnd, _Out_ QOS_RECT *rect)'),
    GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr hWnd, intptr pid)'),
    AttachThreadInput: user32.func('int __stdcall AttachThreadInput(uint32 a, uint32 b, int attach)'),
    BringWindowToTop: user32.func('int __stdcall BringWindowToTop(intptr hWnd)'),
    GetCurrentThreadId: kernel32.func('uint32 __stdcall GetCurrentThreadId()'),
    GetWindowPid: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr hWnd, _Out_ uint32 *pid)'),
    GetWindow: user32.func('intptr __stdcall GetWindow(intptr hWnd, uint32 cmd)'),
    IsWindowVisible: user32.func('int __stdcall IsWindowVisible(intptr hWnd)'),
    OpenProcess: kernel32.func('intptr __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)'),
    QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(intptr h, uint32 flags, void *buf, _Inout_ uint32 *size)'),
    CloseHandle: kernel32.func('int __stdcall CloseHandle(intptr h)'),
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
// A captured window's id looks like "window:<handle>:0". If that is not a live window, look it up by its title.
function hwndOf(sourceId, title) {
  const m = /^window:(\d+):/.exec(String(sourceId || ''));
  const h = m ? Number(m[1]) : 0;
  if (!w32) return h;
  if (h && w32.IsWindow(h)) return h;
  if (title) { const f = Number(w32.FindWindowW(null, String(title))); if (f) return f; }
  return h;
}

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

async function iconFor(file, size = 'large') {
  try {
    const img = await app.getFileIcon(file, { size });
    if (img && !img.isEmpty()) return img.toDataURL();
  } catch (e) {}
  return null;
}

// Store apps keep their icon as an image file inside the app's folder.
function imageFile(file) {
  try {
    let img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return null;
    const s = img.getSize();
    if (s.width > 96) img = img.resize({ width: 96, quality: 'good' });
    return img.toDataURL();
  } catch (e) { return null; }
}

// Windows "known folder" ids that appear at the start of many Start-menu app ids.
function knownFolders() {
  const e = process.env, win = e.windir || e.SystemRoot || 'C:\\Windows';
  return {
    '{6D809377-6AF0-444B-8957-A3773F02200E}': e.ProgramW6432 || e.ProgramFiles,
    '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': e['ProgramFiles(x86)'],
    '{905E63B6-C1BF-494E-B29C-65B732D3D21A}': e.ProgramFiles,
    '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': path.join(win, 'System32'),
    '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}': path.join(win, 'SysWOW64'),
    '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': win,
    '{F7F1ED05-9F6D-47A2-AAAE-29D317C6F066}': e.CommonProgramFiles,
    '{6365D5A7-0F0D-45E5-87F6-0DA56B6A4F7D}': e.CommonProgramW6432 || e.CommonProgramFiles,
    '{5E6C858F-0E22-4760-9AFE-EA3317B67173}': e.USERPROFILE,
    '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}': e.LOCALAPPDATA,
    '{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}': e.APPDATA,
    '{62AB5D82-FDC1-4DC3-A9DD-070D1D495D97}': e.ProgramData,
  };
}

function exeFromAppId(id) {
  let p = null;
  const m = /^(\{[0-9A-Fa-f-]+\})\\(.+)$/.exec(id);
  if (m) { const base = knownFolders()[m[1].toUpperCase()]; if (base) p = path.join(base, m[2]); }
  else if (/^[a-z]:\\/i.test(id)) p = id;
  return p && fs.existsSync(p) ? p : null;
}

// One PowerShell pass: every Start-menu app, plus the logo file of Store apps (from the app's manifest).
const START_APPS_PS = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$pk=@{}; Get-AppxPackage | ForEach-Object { $pk[$_.PackageFamilyName]=$_ }",
  "$out = foreach($a in Get-StartApps){",
  "  $logo=$null",
  "  if($a.AppID -match '^([^!\\\\]+)!(.+)$'){",
  "    $fam=$Matches[1]; $aid=$Matches[2]; $pkg=$pk[$fam]",
  "    if($pkg){",
  "      $man=Join-Path $pkg.InstallLocation 'AppxManifest.xml'",
  "      if(Test-Path $man){",
  "        [xml]$x=Get-Content $man -Raw",
  "        $ap=@($x.Package.Applications.Application) | Where-Object { $_.Id -eq $aid } | Select-Object -First 1",
  "        $ve=$ap.VisualElements; if(-not $ve){ $ve=$ap.ChildNodes | Where-Object { $_.LocalName -eq 'VisualElements' } | Select-Object -First 1 }",
  "        $rel=$ve.Square44x44Logo; if(-not $rel){ $rel=$ve.Square150x150Logo }; if(-not $rel){ $rel=$x.Package.Properties.Logo }",
  "        if($rel){",
  "          $full=Join-Path $pkg.InstallLocation $rel",
  "          if(Test-Path $full){ $logo=$full } else {",
  "            $dir=Split-Path $full; $nm=[IO.Path]::GetFileNameWithoutExtension($full); $ext=[IO.Path]::GetExtension($full)",
  "            $c=Get-ChildItem -Path $dir -Filter ($nm+'*'+$ext) | Sort-Object @{e={ if($_.Name -match 'targetsize-48|scale-200'){0}elseif($_.Name -match 'unplated'){2}else{1} }}, Length -Descending | Select-Object -First 1",
  "            if($c){ $logo=$c.FullName }",
  "          }",
  "        }",
  "      }",
  "    }",
  "  }",
  "  [pscustomobject]@{Name=$a.Name;AppID=$a.AppID;Logo=$logo}",
  "}",
  "$out | ConvertTo-Json -Compress",
].join('\n');

function psEncoded(script, timeoutMs) {
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64], timeoutMs);
}

// The program file an app runs as (so its window can be recognised on screen).
const appExe = new Map();
function programOf(id, link) {
  let exe = exeFromAppId(id);
  if (!exe && link && /\.lnk$/i.test(link)) {
    try { const t = shell.readShortcutLink(link).target; if (t && /\.exe$/i.test(t) && fs.existsSync(t)) exe = t; } catch (e) {}
  }
  if (exe && !/\.exe$/i.test(exe)) exe = null;
  return exe ? exe.toLowerCase() : null;
}

const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

async function listApps() {
  if (appsCache && Date.now() - appsAt < 5 * 60000) return appsCache;
  let apps = [];
  if (isWin) {
    let rows = [];
    try { const d = JSON.parse((await psEncoded(START_APPS_PS, 60000)).trim()); rows = Array.isArray(d) ? d : d ? [d] : []; } catch (e) {}
    if (!rows.length) {
      const d = await psJson('Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress', 30000);
      rows = Array.isArray(d) ? d : d ? [d] : [];
    }
    const links = new Map();
    shortcutFolders().forEach((d) => findShortcuts(d, links));
    const byNorm = new Map();
    links.forEach((p, n) => byNorm.set(normName(n), p));
    const seen = new Set();
    for (const r of rows) {
      const name = String(r.Name || '').trim();
      const id = String(r.AppID || '').trim();
      if (!name || !id || SKIP.test(name) || seen.has(name.toLowerCase())) continue;
      if (/^https?:/i.test(id)) continue;
      seen.add(name.toLowerCase());
      apps.push({ name, id, logo: r.Logo ? String(r.Logo) : null, link: links.get(name.toLowerCase()) || byNorm.get(normName(name)) || null });
      appExe.set(id, programOf(id, apps[apps.length - 1].link));
    }
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  // Icon order: Store app logo, the program file itself, then its Start-menu shortcut.
  for (const a of apps) {
    let icon = null;
    if (a.logo) icon = imageFile(a.logo);
    if (!icon) { const exe = exeFromAppId(a.id); if (exe) icon = await iconFor(exe); }
    if (!icon && a.link) icon = await iconFor(a.link);
    a.icon = icon;
    delete a.logo; delete a.link;
  }
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
  // Windows only lets the active app change focus. Joining the active app's input queue
  // for a moment (plus a tap of Alt) makes the request allowed.
  const fg = Number(w32.GetForegroundWindow());
  const me = w32.GetCurrentThreadId();
  const fgThread = fg ? w32.GetWindowThreadProcessId(fg, 0) : 0;
  const attached = fgThread && fgThread !== me ? w32.AttachThreadInput(me, fgThread, 1) : 0;
  try {
    w32.keybd_event(0x12, 0, 0, 0);
    w32.keybd_event(0x12, 0, 2, 0);
    w32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    w32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    w32.BringWindowToTop(hwnd);
    w32.SetForegroundWindow(hwnd);
  } finally {
    if (attached) w32.AttachThreadInput(me, fgThread, 0);
  }
}

// Send an app to the background on the PC (like switching apps on a phone), so it cannot cover the next one.
function minimize(hwnd) {
  if (w32 && hwnd && w32.IsWindow(hwnd) && !w32.IsIconic(hwnd)) w32.ShowWindow(hwnd, 6 /* SW_MINIMIZE */);
}

// True when the handle is a real window right now.
function isWindow(hwnd) { return !!(w32 && hwnd && w32.IsWindow(hwnd)); }

// The window in front on the PC (used when a launched app's window cannot be matched by id).
function foreground() { return w32 ? Number(w32.GetForegroundWindow()) : 0; }

// Which program (process) a window belongs to.
function pidOf(hwnd) {
  if (!w32 || !hwnd) return 0;
  try { const out = [0]; w32.GetWindowPid(hwnd, out); return out[0] || 0; } catch (e) { return 0; }
}
const exeCache = new Map();
function exeOf(hwnd) {
  const pid = pidOf(hwnd);
  if (!pid) return '';
  if (exeCache.has(pid)) return exeCache.get(pid);
  let p = '';
  try {
    const h = w32.OpenProcess(0x1000, 0, pid);          // PROCESS_QUERY_LIMITED_INFORMATION
    if (h) {
      const buf = Buffer.alloc(2080), size = [1040];
      if (w32.QueryFullProcessImageNameW(h, 0, buf, size)) p = buf.toString('utf16le', 0, size[0] * 2);
      w32.CloseHandle(h);
    }
  } catch (e) {}
  p = p.toLowerCase();
  if (exeCache.size > 400) exeCache.clear();
  exeCache.set(pid, p);
  return p;
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
  // A maximized window ignores new sizes, so un-maximize it first.
  if (w32.IsIconic(hwnd) || w32.IsZoomed(hwnd)) w32.ShowWindow(hwnd, SW_RESTORE);
  const X = Math.round(x * k), Y = Math.round(wa.y * k), W = Math.round(w * k), H = Math.round(h * k);
  w32.SetWindowPos(hwnd, 0, X, Y, W, H, SWP_SHOWWINDOW);
  bringToFront(hwnd);
  // Some apps finish their own layout a moment later; set the size again.
  setTimeout(() => { try { if (w32.IsZoomed(hwnd)) w32.ShowWindow(hwnd, SW_RESTORE); w32.SetWindowPos(hwnd, 0, X, Y, W, H, SWP_SHOWWINDOW); } catch (e) {} }, 700);
}

// Only steal focus when another window is in front (avoids stray Alt presses).
function ensureFront(hwnd) {
  if (!w32 || !w32.IsWindow(hwnd)) return;
  if (Number(w32.GetForegroundWindow()) !== Number(hwnd)) bringToFront(hwnd);
}

// Where the window is on the PC screen, and how big the screen is, in real pixels.
function windowRect(hwnd) {
  const r = frameRect(hwnd);
  if (!r) return null;
  const d = screen.getPrimaryDisplay();
  return Object.assign(r, {
    sx: Math.round(d.bounds.x * d.scaleFactor), sy: Math.round(d.bounds.y * d.scaleFactor),
    sw: Math.round(d.size.width * d.scaleFactor), sh: Math.round(d.size.height * d.scaleFactor),
    minimized: !!(w32 && w32.IsIconic(hwnd)),
  });
}

function closeWindow(hwnd) { if (w32 && w32.IsWindow(hwnd)) w32.PostMessageW(hwnd, WM_CLOSE, 0, 0); }

// How well a window on screen matches the app the phone asked for.
// The program file is the surest sign; the title, a brand-new window, or the window
// that just came to the front help when the program file is not known (Store apps).
function scoreWindow(s, want, before, fgBefore, fg) {
  const h = hwndOf(s.id);
  if (!w32 || !h || !w32.IsWindow(h)) return 0;
  if (w32.GetWindow(h, 4)) return 0;                   // a dialog owned by another window
  if (pidOf(h) === process.pid) return 0;             // Q-CUBIC itself
  const icon = !!w32.IsIconic(h);
  const r = frameRect(h);
  if (!icon && !(r && r.width >= 200 && r.height >= 150)) return 0;   // tooltips, splash bits
  let sc = 0;
  if (want.exe && exeOf(h) === want.exe) sc += 6;
  const t = normName(s.name), n = normName(want.name);
  if (n && t) {
    if (t === n) sc += 4;
    else if (t.includes(n)) sc += 3;
    else if (n.length > 4 && t.length > 4 && n.includes(t)) sc += 2;
  }
  if (before && !before.has(s.id)) sc += 2;
  if (fg && h === fg && fg !== fgBefore) sc += 2;
  return sc;
}

function bestWindow(list, want, before, fgBefore) {
  const fg = foreground();
  let pick = null, top = 0;
  for (const s of list) {
    const sc = scoreWindow(s, want, before, fgBefore, fg);
    if (sc > top) { top = sc; pick = s; }
  }
  return { pick, top };
}

// Launch something, then find the window that belongs to it.
async function launchAndFind(start, want) {
  const before = new Set((await windowSources(false)).map((s) => s.id));
  const fgBefore = foreground();
  await start();
  const t0 = Date.now();
  let last = null, same = 0;
  while (Date.now() - t0 < 15000) {
    await sleep(300);
    const { pick, top } = bestWindow(await windowSources(false), want, before, fgBefore);
    if (!pick) { last = null; same = 0; continue; }
    same = last === pick.id ? same + 1 : 1;
    last = pick.id;
    if (top >= 6) return pick;                                   // its own program file
    if (top >= 3 && same >= 2) return pick;                      // name / new + front, seen twice
    if (top >= 2 && same >= 4 && Date.now() - t0 > 4000) return pick;   // only "new", stayed open
  }
  return null;
}

// Find the app's window again without launching (its first window closed, e.g. a splash screen).
async function findWindow(want) {
  const { pick, top } = bestWindow(await windowSources(false), want, null, 0);
  return top >= 3 ? pick : null;
}

// Keep the phone's app in front of other programs on the PC (at most every 1.5 s).
let frontAt = 0;
function keepFront(hwnd) {
  if (!w32 || !w32.IsWindow(hwnd) || w32.IsIconic(hwnd)) return;
  const fg = foreground();
  if (!fg || fg === Number(hwnd)) return;
  const pfg = pidOf(fg);
  if (pfg && pfg === pidOf(hwnd) && pfg !== process.pid) return;   // the app's own dialog or menu
  if (Number(w32.GetWindow(fg, 4)) === Number(hwnd)) return;
  if (Date.now() - frontAt < 1500) return;
  frontAt = Date.now();
  bringToFront(hwnd);
}

async function openApp(id) {
  const apps = await listApps();
  const a = apps.find((x) => x.id === id);
  if (!a) return null;                       // only apps that really are on this PC
  const want = { name: a.name, exe: appExe.get(a.id) || null };
  const s = await launchAndFind(() => run('explorer.exe', ['shell:AppsFolder\\' + a.id], 3000), want);
  return s ? { src: s, want } : null;
}

async function openSettings(page) {
  const uri = SETTINGS[page];
  if (!uri) return null;
  const want = { name: 'Settings', exe: null };
  const s = await launchAndFind(() => shell.openExternal(uri), want);
  return s ? { src: s, want } : null;
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
  pcInfo, wallpaper, listApps, openWindows, openApp, openSettings, phoneShape, bringToFront, ensureFront, minimize, isWindow, foreground, findWindow, keepFront,
  closeWindow, frameRect, windowRect, hwndOf, setVolume, toggleMute, setBrightness,
  volume: () => volumeGuess, SETTINGS,
};
