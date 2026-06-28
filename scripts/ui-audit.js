const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'tmp', 'ui-audit');
const webglAudit = process.env.WAVELENGTH_WEBGL_AUDIT === '1';
const AUDIT_STATION = {
  id: 'audit-unsafe',
  name: 'A<i id=x>',
  streamUrl: 'https://example.com/audit.mp3',
  iconUrl: 'javascript:alert(1)',
  genre: 'Ambient',
  country: '<b id=y>',
  language: 'Auditisch',
  bitrate: 192,
  codec: 'MP3',
};
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
  cachedIconUrls: [],
};

if (!webglAudit) app.disableHardwareAcceleration();
app.setPath('userData', path.join(os.tmpdir(), `wavelength-ui-audit-${Date.now()}`));

function send(win, channel, value) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, value);
}

function wireIpc(win) {
  const { DEFAULT_STATIONS } = require(path.join(root, 'src', 'stations.js'));
  const auditStations = [...DEFAULT_STATIONS, AUDIT_STATION];
  state.activeStation = DEFAULT_STATIONS[0];

  ipcMain.handle('get-stations', () => auditStations);
  ipcMain.handle('get-state', () => ({ ...state }));
  ipcMain.handle('check-stream', () => ({ ok: true }));
  ipcMain.handle('cache-icon', (_event, url) => {
    state.cachedIconUrls.push(url);
    return null;
  });

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
  const query = webglAudit ? { audit: '1', webglAudit: '1' } : { audit: '1' };
  await win.loadFile(path.join(root, 'src', 'index.html'), { query });
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

async function auditWebGLModes(win) {
  const modes = await win.webContents.executeJavaScript(`
    (() => {
      const wrapper = document.createElement('div');
      wrapper.id = 'webgl-audit-wrapper';
      wrapper.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:120px;background:#05070a;z-index:99999;overflow:hidden;';
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 120;
      canvas.style.cssText = 'width:320px;height:120px;';
      wrapper.appendChild(canvas);
      document.body.appendChild(wrapper);
      window.__wavelengthWebGLAudit = window.WavelengthVisualizer.create({
        canvas,
        miniCanvas: null,
        storageKey: 'wl.webglAuditMode',
        averageLevel: window.utils.averageLevel,
        getAnalyser: () => null,
        getState: () => ({ playing: false, windowVisible: true, muted: false }),
        onLevel: () => {},
        showToast: () => {},
      });
      return window.WavelengthVisualizer.VISUALIZER_MODES.filter(mode => mode.endsWith('3d'));
    })()
  `);

  await new Promise(resolve => setTimeout(resolve, 150));
  await win.webContents.capturePage({ x: 0, y: 0, width: 320, height: 120 });

  const results = [];
  for (const mode of modes) {
    const dataUrl = await win.webContents.executeJavaScript(`
      window.__wavelengthWebGLAudit.setMode(${JSON.stringify(mode)});
      window.__wavelengthWebGLAudit.drawIdle();
      document.getElementById('visualizer-webgl')?.toDataURL('image/png') || '';
    `);
    const image = nativeImage.createFromDataURL(dataUrl);
    fs.writeFileSync(path.join(outDir, `visualizer-${mode}-webgl.png`), image.toPNG());
    const bitmap = image.toBitmap();
    let litPixels = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      if (bitmap[i] + bitmap[i + 1] + bitmap[i + 2] > 18) litPixels++;
    }
    results.push({ mode, litPixels });
  }

  await win.webContents.executeJavaScript(`document.getElementById('webgl-audit-wrapper')?.remove()`);
  const issues = results.filter(result => result.litPixels < 20);
  console.log(`webgl-audit ${issues.length === 0 ? 'ok' : 'found issues'}: ${issues.length} issue(s)`);
  console.log(results.map(result => `${result.mode}: ${result.litPixels} lit pixels`).join('\n'));
  return issues.length;
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

async function auditMiniModeTransition(win) {
  state.isMini = false;
  send(win, 'set-mini', false);
  await new Promise(resolve => setTimeout(resolve, 50));

  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const read = () => ({
        miniMode: document.body.classList.contains('mini-mode'),
        fullDisplay: getComputedStyle(document.getElementById('full-view')).display,
        miniDisplay: getComputedStyle(document.getElementById('mini-view')).display,
      });

      document.getElementById('btn-toggle-mini').click();
      await sleep(100);
      const enterSettled = read();
      document.getElementById('mini-expand').click();
      await sleep(100);
      const exitSettled = read();
      return { enterSettled, exitSettled };
    })()
  `);

  const interactionIssues = [];
  if (!result.enterSettled.miniMode || result.enterSettled.fullDisplay !== 'none' || result.enterSettled.miniDisplay !== 'flex') {
    interactionIssues.push('mini layout was not exclusive after the mode switch');
  }
  if (result.exitSettled.miniMode || result.exitSettled.fullDisplay === 'none' || result.exitSettled.miniDisplay !== 'none') {
    interactionIssues.push('full layout was not restored after leaving mini mode');
  }

  return {
    label: 'mini-mode-transition',
    result,
    interactionIssues,
  };
}

async function auditStationRenderingAndFilters(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const auditItem = Array.from(document.querySelectorAll('.station-item'))
        .find(item => item.dataset.id === 'audit-unsafe');
      const initial = {
        found: !!auditItem,
        name: auditItem?.querySelector('.station-item-name')?.textContent || '',
        tags: Array.from(auditItem?.querySelectorAll('.station-tag') || []).map(tag => tag.textContent),
        injectedElement: !!document.querySelector('#x, #y'),
        iconSrc: auditItem?.querySelector('img.station-icon')?.getAttribute('src') || '',
      };

      const language = document.getElementById('lang-filter');
      language.value = 'Auditisch';
      language.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(100);
      const languageIds = Array.from(document.querySelectorAll('.station-item')).map(item => item.dataset.id);

      language.value = '';
      language.dispatchEvent(new Event('change', { bubbles: true }));
      const search = document.getElementById('station-search');
      search.value = '__wavelength_no_match__';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(150);
      const empty = {
        stationCount: document.querySelectorAll('.station-item').length,
        title: document.querySelector('.station-empty-title')?.textContent?.trim() || '',
      };

      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(150);
      return {
        initial,
        languageIds,
        empty,
        restoredCount: document.querySelectorAll('.station-item').length,
      };
    })()
  `);

  const interactionIssues = [];
  if (!result.initial.found) interactionIssues.push('unsafe audit station was not rendered');
  if (result.initial.name !== AUDIT_STATION.name) interactionIssues.push('station name was not rendered as literal text');
  if (!result.initial.tags.includes(AUDIT_STATION.country)) interactionIssues.push('station country was not rendered as literal text');
  if (result.initial.injectedElement) interactionIssues.push('station data created executable DOM elements');
  if (result.initial.iconSrc) interactionIssues.push(`unsafe icon URL reached img src: ${result.initial.iconSrc}`);
  if (state.cachedIconUrls.includes(AUDIT_STATION.iconUrl)) interactionIssues.push('unsafe icon URL reached cache-icon IPC');
  if (result.languageIds.length !== 1 || result.languageIds[0] !== AUDIT_STATION.id) {
    interactionIssues.push(`language filter returned ${result.languageIds.join(', ') || 'no stations'}`);
  }
  if (result.empty.stationCount !== 0 || !result.empty.title) interactionIssues.push('empty search result was not rendered');
  if (result.restoredCount < 2) interactionIssues.push('station list did not recover after clearing filters');

  return {
    label: 'station-rendering-and-filters',
    result,
    interactionIssues,
  };
}

async function auditVisualizerModes(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
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
      const snapshots = {};
      let auditPlaying = false;
      let syntheticFrame = 0;
      const nativeRequestAnimationFrame = window.requestAnimationFrame;
      const nativeCancelAnimationFrame = window.cancelAnimationFrame;
      const frameQueue = new Map();
      let nextFrameId = 1;
      let auditTimestamp = performance.now();
      window.requestAnimationFrame = callback => {
        const id = nextFrameId++;
        frameQueue.set(id, callback);
        return id;
      };
      window.cancelAnimationFrame = id => frameQueue.delete(id);
      const runFrame = () => {
        const callbacks = Array.from(frameQueue.values());
        frameQueue.clear();
        auditTimestamp += 1000 / 60;
        callbacks.forEach(callback => callback(auditTimestamp));
      };
      const analyser = {
        frequencyBinCount: 256,
        getByteFrequencyData(buffer) {
          syntheticFrame++;
          for (let i = 0; i < buffer.length; i++) {
            const falloff = 1 - (i / buffer.length) * 0.72;
            const pulse = 0.58 + Math.sin(syntheticFrame * 0.35 + i * 0.16) * 0.28;
            buffer[i] = Math.max(0, Math.min(255, Math.round(255 * falloff * pulse)));
          }
        },
        getByteTimeDomainData(buffer) {
          for (let i = 0; i < buffer.length; i++) {
            buffer[i] = Math.round(128 + Math.sin(syntheticFrame * 0.3 + i * 0.18) * 82);
          }
        },
      };
      mainCanvas.style.cssText = 'position:fixed;left:-1000px;top:-1000px;width:320px;height:120px;';
      miniCanvas.style.cssText = 'position:fixed;left:-1000px;top:-850px;width:120px;height:28px;';
      document.body.append(mainCanvas, miniCanvas);
      const auditVisualizer = window.WavelengthVisualizer.create({
        canvas: mainCanvas,
        miniCanvas,
        storageKey: 'wl.auditVisualizerMode',
        averageLevel: window.utils.averageLevel,
        getAnalyser: () => analyser,
        getState: () => ({ playing: auditPlaying, windowVisible: true, muted: false }),
        onLevel: () => {},
        showToast: () => {},
      });

      auditVisualizer.resize();
      for (const mode of modes) {
        auditVisualizer.setMode(mode);
        auditPlaying = true;
        auditVisualizer.start();
        for (let frame = 0; frame < 8; frame++) runFrame();
        auditVisualizer.stop();
        auditPlaying = false;
        const litPixels = countLitPixels(mainCanvas);
        const aria = mainCanvas?.getAttribute('aria-label') || '';
        snapshots[mode] = mainCanvas.toDataURL('image/png');
        results.push({ mode, litPixels, aria });
        if (litPixels < 20) issues.push(mode + ' rendered only ' + litPixels + ' lit pixels');
        if (!aria || !aria.toLowerCase().includes('modus')) issues.push(mode + ' did not update visualizer aria label');
      }

      auditVisualizer.drawIdle();
      runFrame();
      const miniLitPixels = countLitPixels(miniCanvas);
      if (miniLitPixels < 8) issues.push('mini visualizer rendered only ' + miniLitPixels + ' lit pixels');
      mainCanvas.remove();
      miniCanvas.remove();
      window.requestAnimationFrame = nativeRequestAnimationFrame;
      window.cancelAnimationFrame = nativeCancelAnimationFrame;

      return {
        label: 'visualizer-modes',
        modes,
        modeCount: modes.length,
        results,
        snapshots,
        miniLitPixels,
        interactionIssues: issues,
      };
    })()
  `);

  for (const [mode, dataUrl] of Object.entries(result.snapshots)) {
    const encoded = dataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(outDir, `visualizer-${mode}.png`), Buffer.from(encoded, 'base64'));
  }
  delete result.snapshots;
  return result;
}

async function auditButtonOverlap(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const rectsOverlap = (a, b) =>
        a.left < b.right - 1 && a.right > b.left + 1 &&
        a.top  < b.bottom - 1 && a.bottom > b.top + 1;

      const buttons = Array.from(document.querySelectorAll('button'))
        .filter(el => {
          if (el.closest('.modal-overlay')) return false;
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.top < 80;
        })
        .map(el => ({
          id: el.id || el.className.trim().split(/\s+/)[0],
          rect: el.getBoundingClientRect().toJSON(),
        }));

      const overlaps = [];
      for (let i = 0; i < buttons.length; i++) {
        for (let j = i + 1; j < buttons.length; j++) {
          if (rectsOverlap(buttons[i].rect, buttons[j].rect)) {
            overlaps.push(buttons[i].id + ' overlaps ' + buttons[j].id);
          }
        }
      }
      return { label: 'button-overlap', buttons, interactionIssues: overlaps };
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
      backgroundThrottling: false,
    },
  });

  await win.webContents.session.clearStorageData({ storages: ['localstorage'] });
  wireIpc(win);
  await waitForReady(win);
  if (webglAudit) {
    const issues = await auditWebGLModes(win);
    win.destroy();
    app.exit(issues > 0 ? 1 : 0);
    return;
  }
  send(win, 'app-version', app.getVersion());
  send(win, 'set-station', state.activeStation);
  await new Promise(resolve => setTimeout(resolve, 200));

  const results = [];
  const full = await audit(win, 'full-player');
  full.meta = await viewMeta(win);
  results.push(full);
  results.push(await auditMiniModeTransition(win));
  results.push(await auditPlayTooltip(win));
  results.push(await auditButtonOverlap(win));
  results.push(await auditVisualizerModes(win));
  results.push(await auditStationRenderingAndFilters(win));
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
