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
  stationSelections: [],
};

app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.tmpdir(), `wavelength-ui-audit-${Date.now()}`));

function send(win, channel, value) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, value);
}

function wireIpc(win) {
  const { DEFAULT_STATIONS } = require(path.join(root, 'src', 'stations.js'));
  state.activeStation = DEFAULT_STATIONS[0];

  ipcMain.handle('get-stations', () => DEFAULT_STATIONS);
  ipcMain.handle('get-state', () => ({ ...state }));
  ipcMain.handle('check-stream', () => ({ ok: true }));

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
  ipcMain.on('select-station', (_event, station, noPlay) => {
    state.activeStation = station;
    state.stationSelections.push({ id: station?.id, name: station?.name, noPlay: !!noPlay });
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

async function auditStationSwitch(win) {
  const beforeCount = state.stationSelections.length;
  const result = await win.webContents.executeJavaScript(`
    new Promise(resolve => {
      document.body.classList.add('view-list-active');
      const toggleBtn = document.getElementById('btn-view-toggle');
      if (toggleBtn) {
        toggleBtn.classList.add('active');
        toggleBtn.setAttribute('aria-pressed', 'true');
      }

      requestAnimationFrame(() => {
        const items = Array.from(document.querySelectorAll('.station-item'));
        const current = document.querySelector('.station-item.active');
        const currentId = current?.dataset.id || '';
        const target = items.find(item => item.dataset.id && item.dataset.id !== currentId) || items[1];
        if (!target) {
          resolve({ ok: false, reason: 'no selectable station item found' });
          return;
        }

        const targetId = target.dataset.id;
        const targetName = target.querySelector('.station-item-name')?.textContent?.trim() || '';
        target.click();

        setTimeout(() => {
          const active = document.querySelector('.station-item.active');
          resolve({
            ok: true,
            targetId,
            targetName,
            activeId: active?.dataset.id || '',
            activeName: active?.querySelector('.station-item-name')?.textContent?.trim() || '',
            headerName: document.getElementById('active-station-name-inner')?.textContent?.trim() || '',
            miniName: document.getElementById('mini-station-name')?.textContent?.trim() || '',
          });
        }, 250);
      });
    })
  `);

  const latest = state.stationSelections[state.stationSelections.length - 1] || null;
  const interactionIssues = [];
  if (!result.ok) interactionIssues.push(result.reason || 'station switch click failed');
  if (result.ok && result.activeId !== result.targetId) interactionIssues.push(`active list item stayed on ${result.activeId || 'none'} instead of ${result.targetId}`);
  if (result.ok && result.headerName !== result.targetName) interactionIssues.push(`header shows ${result.headerName || 'empty'} instead of ${result.targetName}`);
  if (result.ok && result.miniName !== result.targetName) interactionIssues.push(`mini player shows ${result.miniName || 'empty'} instead of ${result.targetName}`);
  if (state.stationSelections.length !== beforeCount + 1) interactionIssues.push('select-station IPC was not emitted exactly once');
  if (latest && latest.id !== result.targetId) interactionIssues.push(`select-station IPC used ${latest.id || 'empty'} instead of ${result.targetId}`);

  return {
    label: 'station-switch',
    result,
    ipcSelection: latest,
    interactionIssues,
  };
}

async function auditPlayTooltip(win) {
  const read = () => win.webContents.executeJavaScript(`
    (() => ({
      main: document.getElementById('btn-playstop')?.getAttribute('title') || '',
      mini: document.getElementById('mini-playstop')?.getAttribute('title') || '',
      aria: document.getElementById('btn-playstop')?.getAttribute('aria-label') || '',
      miniIcon: document.querySelector('#mini-icon path')?.getAttribute('d') || '',
    }))()
  `);

  const before = await read();
  send(win, 'set-playing', true);
  await new Promise(resolve => setTimeout(resolve, 100));
  const playing = await read();
  send(win, 'set-mini', true);
  await new Promise(resolve => setTimeout(resolve, 100));
  const playingMini = await read();
  send(win, 'set-mini', false);
  await new Promise(resolve => setTimeout(resolve, 100));
  send(win, 'set-playing', false);
  await new Promise(resolve => setTimeout(resolve, 100));
  const stopped = await read();

  const interactionIssues = [];
  if (before.main !== 'Abspielen' || before.mini !== 'Abspielen') {
    interactionIssues.push(`initial play tooltip is ${before.main || 'empty'} / ${before.mini || 'empty'}`);
  }
  if (playing.main !== 'Stoppen' || playing.mini !== 'Stoppen' || playing.aria !== 'Stoppen') {
    interactionIssues.push(`playing tooltip/aria is ${playing.main || 'empty'} / ${playing.mini || 'empty'} / ${playing.aria || 'empty'}`);
  }
  if (!playing.miniIcon.includes('2.5 2.5') || !playingMini.miniIcon.includes('2.5 2.5')) {
    interactionIssues.push(`mini play icon did not switch to stop square: ${playing.miniIcon || 'empty'} / ${playingMini.miniIcon || 'empty'}`);
  }
  if (stopped.main !== 'Abspielen' || stopped.mini !== 'Abspielen' || stopped.aria !== 'Abspielen') {
    interactionIssues.push(`stopped tooltip/aria is ${stopped.main || 'empty'} / ${stopped.mini || 'empty'} / ${stopped.aria || 'empty'}`);
  }

  return {
    label: 'play-tooltip',
    before,
    playing,
    playingMini,
    stopped,
    interactionIssues,
  };
}

async function auditVisualizerModes(win) {
  return win.webContents.executeJavaScript(`
    (async () => {
      const sleepFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const countLitPixels = (canvas) => {
        if (!canvas || canvas.width <= 0 || canvas.height <= 0) return 0;
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 0 && data[i] + data[i + 1] + data[i + 2] > 12) lit++;
        }
        return lit;
      };

      const modes = window.WavelengthVisualizer?.VISUALIZER_MODES || [];
      const mainCanvas = document.createElement('canvas');
      const miniCanvas = document.createElement('canvas');
      const issues = [];
      const results = [];
      mainCanvas.style.cssText = 'position:fixed;left:-1000px;top:-1000px;width:320px;height:120px;';
      miniCanvas.style.cssText = 'position:fixed;left:-1000px;top:-850px;width:120px;height:28px;';
      document.body.append(mainCanvas, miniCanvas);
      const auditVisualizer = window.WavelengthVisualizer.create({
        canvas: mainCanvas,
        miniCanvas,
        storageKey: 'wl.auditVisualizerMode',
        averageLevel: window.utils.averageLevel,
        getAnalyser: () => null,
        getState: () => ({ playing: false, windowVisible: true, muted: false }),
        onLevel: () => {},
        showToast: () => {},
      });

      auditVisualizer.resize();
      for (const mode of modes) {
        auditVisualizer.setMode(mode);
        auditVisualizer.drawIdle();
        await sleepFrame();
        const litPixels = countLitPixels(mainCanvas);
        const aria = mainCanvas?.getAttribute('aria-label') || '';
        results.push({ mode, litPixels, aria });
        if (litPixels < 20) issues.push(mode + ' rendered only ' + litPixels + ' lit pixels');
        if (!aria || !aria.toLowerCase().includes('modus')) issues.push(mode + ' did not update visualizer aria label');
      }

      auditVisualizer.drawIdle();
      await sleepFrame();
      const miniLitPixels = countLitPixels(miniCanvas);
      if (miniLitPixels < 8) issues.push('mini visualizer rendered only ' + miniLitPixels + ' lit pixels');
      mainCanvas.remove();
      miniCanvas.remove();

      return {
        label: 'visualizer-modes',
        modes,
        modeCount: modes.length,
        results,
        miniLitPixels,
        interactionIssues: issues,
      };
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
  results.push(await auditPlayTooltip(win));
  results.push(await auditVisualizerModes(win));
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
  const stationSwitch = await auditStationSwitch(win);
  results.push(stationSwitch);
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
  const issues = results.reduce((sum, r) =>
    sum + (r.overflow?.length || 0) + (r.clippedText?.length || 0) + (r.interactionIssues?.length || 0), 0);
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
