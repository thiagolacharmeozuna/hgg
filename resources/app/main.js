const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
let mainWin = null;
const path = require('path'), fs = require('fs'), https = require('https');
const { spawn } = require('child_process');

const dir = app.getPath('userData');
const cfgF = path.join(dir, 'config.json');
const covDir = path.join(dir, 'covers');
fs.mkdirSync(covDir, { recursive: true });

const defSettings = { v: 2, sound: true, volume: 0.6, sounds: {}, c1: '#0c3b12', c2: '#000000', accent: '#43d243', size: 200, bg: '', reflect: true, fullscreen: false, speed: 1, bgDim: 0 };
const load = () => {
  try {
    const d = JSON.parse(fs.readFileSync(cfgF, 'utf8'));
    const s = { ...defSettings, ...(d.settings || {}) };
    if (s.v !== 2) { s.c1 = defSettings.c1; s.c2 = defSettings.c2; s.accent = defSettings.accent; s.v = 2; }
    return { items: d.items || [], settings: s };
  } catch { return { items: [], settings: { ...defSettings } }; }
};
const save = d => fs.writeFileSync(cfgF, JSON.stringify(d, null, 1));

function getJSON(url) {
  return new Promise((res, rej) => https.get(url, { headers: { 'User-Agent': 'XboxDash' } }, r => {
    let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej));
}
function download(url, dest, n = 0) {
  return new Promise((res, rej) => https.get(url, { headers: { 'User-Agent': 'XboxDash' } }, r => {
    if ([301, 302].includes(r.statusCode) && n < 5) return res(download(r.headers.location, dest, n + 1));
    if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode)); }
    const f = fs.createWriteStream(dest); r.pipe(f); f.on('finish', () => f.close(() => res(dest)));
  }).on('error', rej));
}
const clean = s => s.replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ').replace(/\b(launcher|x64|x86|win64|shipping)\b/gi, '').replace(/\s+/g, ' ').trim();

async function steamCover(id, steamId, name) {
  const dest = path.join(covDir, id + '.jpg');
  try {
    if (!steamId) {
      const r = await getJSON('https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(name) + '&cc=us&l=en');
      if (!r.items || !r.items.length) return null;
      steamId = r.items[0].id;
    }
    const base = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + steamId + '/';
    try { await download(base + 'library_600x900.jpg', dest); }
    catch { await download(base + 'header.jpg', dest); }
    return dest;
  } catch { return null; }
}

function shrink(file, maxH, maxW) {
  try {
    if (!/\.(jpe?g|png)$/i.test(file)) return false;
    let img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return false;
    const s = img.getSize();
    if (s.height <= maxH && s.width <= maxW) return false;
    const k = Math.min(maxH / s.height, maxW / s.width);
    img = img.resize({ width: Math.round(s.width * k), height: Math.round(s.height * k), quality: 'better' });
    fs.writeFileSync(file, /\.png$/i.test(file) ? img.toPNG() : img.toJPEG(90));
    return true;
  } catch { return false; }
}
async function optimizeImages() {
  const jobs = [];
  try {
    for (const f of fs.readdirSync(covDir)) jobs.push([path.join(covDir, f), 900, 900]);
    for (const f of fs.readdirSync(dir).filter(x => /^bg_/.test(x))) jobs.push([path.join(dir, f), 1080, 1920]);
  } catch {}
  for (const [f, h, wd] of jobs) {
    try { if (fs.statSync(f).size > 250 * 1024) shrink(f, h, wd); } catch {}
    await new Promise(r => setTimeout(r, 40));
  }
}

function createWindow() {
  const d = load();
  const w = new BrowserWindow({
    width: 1280, height: 720, show: false, fullscreen: d.settings.fullscreen, backgroundColor: '#000000',
    autoHideMenuBar: true, title: 'Xbox Dash',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), autoplayPolicy: 'no-user-gesture-required', spellcheck: false }
  });
  mainWin = w;
  w.once('ready-to-show', () => { w.show(); setTimeout(optimizeImages, 4000); });
  w.loadFile('index.html');
  ipcMain.handle('data', () => ({ ...load(), covDir }));
  ipcMain.handle('save', (e, d) => { save(d); w.setFullScreen(!!d.settings.fullscreen); });
  ipcMain.handle('findCover', async (e, it) => {
    const c = await steamCover(it.id, it.steamId, it.name);
    return c ? path.basename(c) : '';
  });
  ipcMain.handle('pickFile', async (e, kind) => {
    const F = { exe: [{ name: 'Ejecutables', extensions: ['exe', 'lnk', 'bat', 'url'] }], audio: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }], img: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }] };
    const filters = F[kind] || F.img;
    const r = await dialog.showOpenDialog(w, { properties: ['openFile'], filters });
    return r.canceled ? '' : r.filePaths[0];
  });
  ipcMain.handle('copyImg', (e, kind, src, id) => {
    const ext = path.extname(src);
    if (kind === 'snd') { const sd = path.join(dir, 'sounds'); fs.mkdirSync(sd, { recursive: true }); const f = path.join(sd, id + '_' + Date.now() + ext); fs.copyFileSync(src, f); return f; }
    if (kind === 'bg') { const f = path.join(dir, 'bg_' + Date.now() + ext); fs.copyFileSync(src, f); shrink(f, 1080, 1920); return f; }
    const f = id + '_' + Date.now() + ext; const fp = path.join(covDir, f); fs.copyFileSync(src, fp); shrink(fp, 900, 900); return f;
  });
  ipcMain.handle('steamScan', async () => {
    const roots = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam', 'D:\\SteamLibrary', 'E:\\SteamLibrary'];
    const out = [];
    for (const r of roots) {
      const sa = path.join(r, 'steamapps');
      if (!fs.existsSync(sa)) continue;
      for (const f of fs.readdirSync(sa).filter(x => /^appmanifest_\d+\.acf$/.test(x))) {
        const t = fs.readFileSync(path.join(sa, f), 'utf8');
        const id = (t.match(/"appid"\s+"(\d+)"/) || [])[1], nm = (t.match(/"name"\s+"([^"]+)"/) || [])[1];
        if (id && nm && !/Steamworks|Redistributable/i.test(nm)) out.push({ id: 'st' + id, steamId: id, name: nm, type: 'steam', path: 'steam://rungameid/' + id, cover: '' });
      }
    }
    return out;
  });
  ipcMain.handle('launch', (e, it) => {
    if (it.type === 'steam') return shell.openExternal(it.path);
    if (/\.exe$/i.test(it.path)) {
      try { const c = spawn(it.path, [], { detached: true, stdio: 'ignore', cwd: path.dirname(it.path) }); c.on('error', () => shell.openPath(it.path)); c.unref(); }
      catch { shell.openPath(it.path); }
    } else shell.openPath(it.path);
  });
  ipcMain.handle('quit', () => app.quit());
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => app.quit());
