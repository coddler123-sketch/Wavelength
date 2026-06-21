const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'tmp', 'ui-audit');
const state = {
  isPlaying: false,
  isPinned: false,
  isMini: false,
  isMuted: false,
  windowVisible: true,
  sleepEndsAt: 0,
  connectionState: 'stopped',
  activeStation: null,
};

app.setPath('userData', path.join(os.tmpdir(), `wavelength-ui-audit-${Date.now()}`));

function send(win, channel, value) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, value);
}

function wireIpc(win) {
  const { DEFAULT_STATIONS } = require(path.join(root, 'src', 'stations.js'));
  state.activeStation = DEFAULT_STATIONS[0];

  ipcMain.handle('get-stations', () => DEFAULT_STATIONS);
  ipcMain.handle('get-state', () => ({ ...state }));

  ipcMain.on('play-pause', (_event, forceState) => {
    state.isPlaying = typeof forceState === 'boolean' ? forceState : !state.isPlaying;
    send(win, 'set-playing', state.isPlaying);
  });
  ipcMain.on('toggle-pin', () => {
    state.isPinned = !state.isPinned;
    send(win, 'set-pinned', state.isPinned);
  });
  ipcMain.on('toggle-mini', () => {
    state.isMini = !state.isMini;
    send(win, 'set-mini', state.isMini);
  });
  ipcMain.on('toggle-mute', () => {
    state.isMuted = !state.isMuted;
    send(win, 'set-muted', state.isMuted);
  });
  ipcMain.on('connection-state', (_event, nextState) => {
    state.connectionState = nextState;
  });
  ipcMain.on('select-station', (_event, station) => {
    state.activeStation = station;
    send(win, 'set-station', station);
  });

  for (const channel of ['hide-window', 'quit-app', 'cycle-sleep-timer', 'tray-icons', 'open-external']) {
    ipcMain.on(channel, () => {});
  }
}

async function waitForReady(win) {
  await win.loadFile(path.join(root, 'src', 'index.html'));
  await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      const done = () => document.querySelectorAll('.station-item').length > 0;
      if (done()) return resolve(true);
      const timer = setInterval(() => {
        if (done()) {
          clearInterval(timer);
          resolve(true);
        }
      }, 50);
      setTimeout(() => {
        clearInterval(timer);
        resolve(false);
      }, 5000);
    })
  `);
}

async function audit(win, label) {
  const png = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `${label}.png`), png.toPNG());

  return win.webContents.executeJavaScript(`
    (() => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const overflow = [];
      const clippedText = [];
      const selectorFor = (el) => {
        if (el.id) return '#' + el.id;
        if (typeof el.className === 'string' && el.className.trim()) return '.' + el.className.trim().replace(/\s+/g, '.');
        return el.tagName.toLowerCase();
      };
      const hasScrollableAncestor = (el) => {
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const scrollable = /(auto|scroll)/.test(style.overflow + style.overflowY + style.overflowX);
          if (scrollable && (parent.scrollHeight > parent.clientHeight + 1 || parent.scrollWidth > parent.clientWidth + 1)) return true;
        }
        return false;
      };
      for (const el of document.querySelectorAll('body *')) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') continue;
        if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewport.width || rect.top >= viewport.height) continue;
        if (hasScrollableAncestor(el)) continue;
        if (rect.right > viewport.width + 1 || rect.bottom > viewport.height + 1 || rect.left < -1 || rect.top < -1) {
          overflow.push({
            selector: selectorFor(el),
            text: (el.textContent || '').trim().slice(0, 80),
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
          });
        }
        const ownScrollable = /(auto|scroll)/.test(style.overflow + style.overflowY + style.overflowX);
        const textNodeOnly = Array.from(el.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (!ownScrollable && textNodeOnly && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) && (el.textContent || '').trim()) {
          clippedText.push({
            selector: selectorFor(el),
            text: el.textContent.trim().slice(0, 80),
            scroll: { width: el.scrollWidth, height: el.scrollHeight },
            client: { width: el.clientWidth, height: el.clientHeight }
          });
        }
      }
      return { label: '${label}', viewport, overflow, clippedText };
    })()
  `);
}

async function viewMeta(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const picker = document.querySelector('.station-picker');
      const strip = document.querySelector('.viz-strip');
      const bodyClass = document.body.className;
      const rectFor = (el) => {
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { display: style.display, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      };
      return { bodyClass, stationPicker: rectFor(picker), vizStrip: rectFor(strip) };
    })()
  `);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    width: 460,
    height: 480,
    frame: false,
    useContentSize: true,
    show: false,
    webPreferences: {
      preload: path.join(root, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.webContents.session.clearStorageData({ storages: ['localstorage'] });
  wireIpc(win);
  await waitForReady(win);
  send(win, 'app-version', app.getVersion());
  send(win, 'set-station', state.activeStation);
  await new Promise(resolve => setTimeout(resolve, 200));

  const results = [];
  const full = await audit(win, 'full-player');
  full.meta = await viewMeta(win);
  results.push(full);
  await win.webContents.executeJavaScript(`
    document.body.classList.add('view-list-active');
    const toggleBtn = document.getElementById('btn-view-toggle');
    if (toggleBtn) {
      toggleBtn.classList.add('active');
      toggleBtn.setAttribute('aria-pressed', 'true');
    }
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  `);
  await new Promise(resolve => setTimeout(resolve, 200));
  const list = await audit(win, 'station-list');
  list.meta = await viewMeta(win);
  results.push(list);
  send(win, 'set-mini', true);
  win.setSize(290, 82);
  await new Promise(resolve => setTimeout(resolve, 200));
  const mini = await audit(win, 'mini-player');
  mini.meta = await viewMeta(win);
  results.push(mini);

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2));
  const issues = results.reduce((sum, r) => sum + r.overflow.length + r.clippedText.length, 0);
  console.log(`ui-audit ${issues === 0 ? 'ok' : 'found issues'}: ${issues} issue(s)`);
  console.log(`report: ${path.join(outDir, 'report.json')}`);
  console.log(`screenshots: ${outDir}`);
  win.destroy();
  app.exit(issues > 0 ? 1 : 0);
}

app.whenReady().then(main).catch(err => {
  console.error(err);
  app.exit(1);
});
