const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, nativeTheme,
        screen, globalShortcut, Notification, dialog, shell, powerMonitor, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const { trayState: computeTrayState } = require('./utils.js');
const { loadStations, DEFAULT_STATIONS } = require('./stations.js');
const customStations = require('./custom-stations.js');
const { buildTrayStationMenuItems, stationSwitcherSubmenu } = require('./tray-menu.js');
const { createIcyMetadataClient } = require('./icy-metadata-client.js');
const windowState = require('./window-state.js');
const path = require('path');
const fs   = require('fs');

// ── Single-instance lock ──────────────────────────────────
if (process.env.NODE_ENV !== 'test' && !app.requestSingleInstanceLock()) { app.exit(0); }
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (rendererReady) { mainWindow.show(); mainWindow.focus(); }
  else showOnLoad = true; // content not ready yet
});

let mainWindow    = null;
let tray          = null;
let isPlaying     = false;
let isMini        = false;
let isPinned      = false;
let isMuted       = false;
let rendererReady = false;
let updateReadyVersion = null;
const startedHidden = process.argv.includes('--hidden');
let showOnLoad = !startedHidden;
let connectionState = 'stopped';
let dockMini = true;
const trayIconImages = new Map();   // state → colored PNG icon rendered by the renderer
const TRAY_ICON_STATES = new Set(['playing', 'reconnecting', 'muted', 'stopped']);
let fallbackTrayIcon = null;        // static icon.ico
const APP_ID = 'com.wavelength.player';
const APP_VERSION = app.getVersion();
const APP_USER_AGENT = `WavelengthRadioPlayer/${APP_VERSION} (Windows Electron App)`;
const FIRST_RUN_FILE = path.join(app.getPath('userData'), 'first-run-seen');
const LOG_FILE = path.join(app.getPath('userData'), 'logs', 'app.log');

let allStations = [];
let activeStation = null;
let fullWidth = 460;
let fullHeight = 480;

function log(message, extra = '') {
  let line = `[${new Date().toISOString()}] ${message}${extra ? ` ${extra}` : ''}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    try {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > 1 * 1024 * 1024) { // 1 MB limit
        fs.renameSync(LOG_FILE, LOG_FILE + '.old');
      }
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        line += `[${new Date().toISOString()}] [logger] Rotation check failed ${err.message || String(err)}\n`;
      }
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch (err) {
    // Last-resort logger: if app.log itself cannot be written, there is no safer local sink.
    void err;
  }
}

process.on('uncaughtException', (err) => log('uncaughtException', err.stack || String(err)));
process.on('unhandledRejection', (reason) => log('unhandledRejection', reason?.stack || String(reason)));

// ── Sleep timer ───────────────────────────────────────────
let sleepTimer  = null;
let sleepTickTimer = null;
let sleepEndsAt = 0;

function setSleepTimer(minutes) {
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  if (sleepTickTimer) { clearInterval(sleepTickTimer); sleepTickTimer = null; }
  sleepEndsAt = 0;
  if (!minutes)   { updateTrayMenu(); updateTrayTooltip(); sendSleepToRenderer(); return; }
  sleepEndsAt = Date.now() + minutes * 60_000;
  sleepTimer  = setTimeout(() => {
    sleepTimer = null;
    if (sleepTickTimer) { clearInterval(sleepTickTimer); sleepTickTimer = null; }
    sleepEndsAt = 0;
    if (isPlaying) togglePlay();
    updateTrayMenu();
    updateTrayTooltip();
    sendSleepToRenderer();
  }, minutes * 60_000);
  sleepTickTimer = setInterval(() => {
    updateTrayMenu();
    updateTrayTooltip();
    sendSleepToRenderer();
  }, 60_000);
  updateTrayMenu();
  updateTrayTooltip();
  sendSleepToRenderer();
}

function sleepLabel() {
  if (!sleepTimer) return 'Sleeptimer';
  const rem = Math.ceil((sleepEndsAt - Date.now()) / 60_000);
  return `Sleeptimer - noch ${rem} min`;
}

function sleepMenuItem(minutes) {
  const active = sleepTimer && Math.round((sleepEndsAt - Date.now()) / 60_000) === minutes;
  return {
    label: `${minutes} Minuten`,
    type: 'checkbox',
    checked: !!active,
    click: () => setSleepTimer(minutes)
  };
}

const BG_COLOR   = '#0a0915'; // Dark cyberpunk/deep space background

// ── Position persistence ─────────────────────────────────
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
let saveTimer = null;

function loadWindowState()  { return windowState.load(STATE_FILE, log); }
function saveWindowState()  { windowState.save(STATE_FILE, log, mainWindow, screen.getAllDisplays(), isMini, dockMini, fullWidth, fullHeight); }

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    snapMiniToNearestEdge();
    saveWindowState();
  }, 500);
}

// ── Window sizes ──────────────────────────────────────────
const SIZES = {
  full: { width: 460, height: 480 },
  mini: { width: 290, height: 82  }
};

function getIconPath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets', name)
    : path.join(__dirname, '..', 'assets', name);
}

function trayState() {
  return computeTrayState(connectionState, isMuted, isPlaying);
}

function getFallbackTrayIcon() {
  if (!fallbackTrayIcon) {
    fallbackTrayIcon = nativeImage.createFromPath(getIconPath('icon.png'))
      .resize({ width: 16, height: 16 });
  }
  return fallbackTrayIcon;
}

function getTrayIcon(state = trayState()) {
  return trayIconImages.get(state) || getFallbackTrayIcon();
}

function updateTrayIcon() {
  if (tray) tray.setImage(getTrayIcon());
}

function snapMiniToNearestEdge(force = false) {
  if (!mainWindow || mainWindow.isDestroyed() || !isMini || !dockMini) return;
  const bounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(bounds).workArea;
  const distances = [
    { edge: 'left', value: Math.abs(bounds.x - display.x) },
    { edge: 'right', value: Math.abs((bounds.x + bounds.width) - (display.x + display.width)) },
    { edge: 'top', value: Math.abs(bounds.y - display.y) },
    { edge: 'bottom', value: Math.abs((bounds.y + bounds.height) - (display.y + display.height)) },
  ].sort((a, b) => a.value - b.value);
  if (!force && distances[0].value > 28) return;

  let x = bounds.x;
  let y = bounds.y;
  if (distances[0].edge === 'left') x = display.x;
  if (distances[0].edge === 'right') x = display.x + display.width - bounds.width;
  if (distances[0].edge === 'top') y = display.y;
  if (distances[0].edge === 'bottom') y = display.y + display.height - bounds.height;
  if (x !== bounds.x || y !== bounds.y) mainWindow.setBounds({ x, y, width: bounds.width, height: bounds.height }, false);
}

function createWindow() {
  const saved = loadWindowState();
  fullWidth = SIZES.full.width;
  fullHeight = SIZES.full.height;
  if (saved?.isMini) isMini = true;
  if (saved && typeof saved.dockMini === 'boolean') dockMini = saved.dockMini;

  const startSize = isMini ? SIZES.mini : { width: fullWidth, height: fullHeight };
  mainWindow = new BrowserWindow({
    width: startSize.width, height: startSize.height,
    x: saved?.x, y: saved?.y,
    frame: false, transparent: false, resizable: false, maximizable: false,
    minWidth: startSize.width, minHeight: startSize.height,
    maxWidth: startSize.width, maxHeight: startSize.height,
    skipTaskbar: true, alwaysOnTop: isPinned, show: false,
    backgroundColor: BG_COLOR,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    },
    icon: getIconPath('icon.ico')
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html')).then(() => {
    if (showOnLoad) mainWindow.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true;
    mainWindow.webContents.send('app-version', APP_VERSION);
    sendStateToRenderer();
    if (activeStation) {
      mainWindow.webContents.send('set-station', activeStation);
    }
  });

  mainWindow.on('move',  scheduleSave);
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('close', (e) => { e.preventDefault(); saveWindowState(); mainWindow.hide(); });
  mainWindow.on('hide',  () => { updateTrayMenu(); mainWindow?.webContents.send('window-visible', false); });
  mainWindow.on('show',  () => { updateTrayMenu(); mainWindow?.webContents.send('window-visible', true);  });
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else { mainWindow.show(); mainWindow.focus(); }
}

function fadeInWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setOpacity(0);
  mainWindow.show();
  let op = 0;
  const timer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) { clearInterval(timer); return; }
    op = Math.min(1, op + 0.04);
    mainWindow.setOpacity(op);
    if (op >= 1) clearInterval(timer);
  }, 16);
}

function createTray() {
  tray = new Tray(getTrayIcon('stopped'));
  updateTrayIcon();
  updateTrayTooltip();
  tray.on('click', toggleWindow);
  updateTrayMenu();
}

let currentTrackTitle = '';
const icyMetadataClient = createIcyMetadataClient({
  userAgent: APP_USER_AGENT,
  log,
  isPlaying: () => isPlaying,
  onTrackTitle: (title) => {
    currentTrackTitle = title;
    if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
      mainWindow.webContents.send('track-info', title);
    }
    updateTrayTooltip();
  },
});

function stopIcyMetadataClient() {
  icyMetadataClient.stop();
  currentTrackTitle = '';
}

function startIcyMetadataClient(streamUrl) {
  icyMetadataClient.start(streamUrl);
}

function updateTrayTooltip() {
  if (!tray) return;
  const label = {
    connecting: 'Verbinden',
    live: 'Live',
    reconnecting: 'Erneut verbinden',
    muted: 'Stumm',
    stopped: 'Gestoppt',
  }[connectionState] || (isPlaying ? 'Live' : 'Gestoppt');
  const stationName = activeStation ? activeStation.name : 'Keine Station';
  let tooltip = `Wavelength v${APP_VERSION}\nStation: ${stationName}\nStatus: ${label}`;
  if (isPlaying && currentTrackTitle) {
    tooltip += `\nTrack: ${currentTrackTitle}`;
  }
  if (sleepTimer) {
    tooltip += '\n(Sleeptimer aktiv)';
  }
  tray.setToolTip(tooltip);
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const stationMenuItems = buildTrayStationMenuItems(allStations, activeStation, selectStationInternal);

  const menu = Menu.buildFromTemplate([
    { label: `Wavelength v${APP_VERSION}`, enabled: false, icon: getTrayIcon() },
    { type: 'separator' },
    { label: isPlaying ? '⏹  Stoppen' : '▶  Abspielen', click: () => togglePlay() },
    {
      label: 'Station wechseln',
      submenu: stationSwitcherSubmenu(stationMenuItems, activeStation)
    },
    { type: 'separator' },
    {
      label: sleepLabel(),
      submenu: [
        sleepMenuItem(15),
        sleepMenuItem(30),
        sleepMenuItem(60),
        sleepMenuItem(90),
        { type: 'separator' },
        { label: 'Abbrechen', enabled: !!sleepTimer, click: () => setSleepTimer(0) },
      ]
    },
    { type: 'separator' },
    { label: 'Stumm', type: 'checkbox', checked: isMuted, click: () => toggleMute() },
    { label: 'Anheften (immer im Vordergrund)', type: 'checkbox', checked: isPinned, click: () => togglePin() },
    { label: isMini ? 'Vollansicht' : 'Mini-Player', click: () => toggleMini() },
    { label: 'Mini an Bildschirmkante andocken', type: 'checkbox', checked: dockMini, click: () => toggleMiniDock() },
    { label: mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? 'Ausblenden' : 'Anzeigen', click: toggleWindow },
    { type: 'separator' },
    { label: 'Autostart', type: 'checkbox', checked: getAutostart(), click: () => toggleAutostart() },
    { type: 'separator' },
    {
      label: 'Zurücksetzen',
      submenu: [
        { label: 'Fensterposition zurücksetzen', click: resetWindowPosition },
        { label: 'Einstellungen zurücksetzen', click: resetAppSettings },
      ]
    },
    { type: 'separator' },
    { label: 'Tastaturkürzel', click: showShortcutsDialog },
    { label: 'Über Wavelength', click: showAboutDialog },
    { type: 'separator' },
    ...(updateReadyVersion ? [
      { label: `⬆  Update v${updateReadyVersion} installieren`, click: () => autoUpdater.quitAndInstall() },
      { type: 'separator' },
    ] : []),
    { label: 'Beenden', click: quitApp }
  ]);
  tray.setContextMenu(menu);
}

function selectStationInternal(station, noPlay = false) {
  activeStation = station;
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('set-station', station);
  }
  if (!noPlay) {
    if (!isPlaying) {
      togglePlay(true);
    } else {
      startIcyMetadataClient(station?.streamUrl);
    }
  } else {
    if (isPlaying) {
      startIcyMetadataClient(station?.streamUrl);
    }
  }
  updateTrayMenu();
  updateTrayTooltip();
}

function togglePlay(forceState) {
  isPlaying = (typeof forceState === 'boolean') ? forceState : !isPlaying;
  connectionState = isPlaying ? 'connecting' : 'stopped';
  if (isPlaying) {
    startIcyMetadataClient(activeStation?.streamUrl);
  } else {
    stopIcyMetadataClient();
  }
  sendStateToRenderer();
  updateTrayMenu();
  updateTrayTooltip();
  updateTrayIcon();
}

function togglePin() {
  isPinned = !isPinned;
  mainWindow.setAlwaysOnTop(isPinned);
  sendStateToRenderer();
  updateTrayMenu();
}

function toggleMute() {
  isMuted = !isMuted;
  if (isPlaying) connectionState = isMuted ? 'muted' : 'live';
  sendStateToRenderer();
  updateTrayMenu();
  updateTrayTooltip();
  updateTrayIcon();
}

function toggleMini() {
  isMini = !isMini;
  const [x, y]  = mainWindow.getPosition();
  const prevW = isMini ? fullWidth : SIZES.mini.width;
  const newW = isMini ? SIZES.mini.width : fullWidth;
  const newH = isMini ? SIZES.mini.height : fullHeight;
  let newX = x + (prevW - newW);
  let newY = y;

  if (isMini) {
    mainWindow.setMinimumSize(SIZES.mini.width, SIZES.mini.height);
  } else {
    mainWindow.setMaximumSize(SIZES.full.width, SIZES.full.height);
  }

  mainWindow.setResizable(false);

  if (isMini && dockMini) {
    const display = screen.getDisplayMatching({ x: newX, y: newY, width: newW, height: newH }).workArea;
    const distances = [
      { edge: 'left', value: Math.abs(newX - display.x) },
      { edge: 'right', value: Math.abs((newX + newW) - (display.x + display.width)) },
      { edge: 'top', value: Math.abs(newY - display.y) },
      { edge: 'bottom', value: Math.abs((newY + newH) - (display.y + display.height)) },
    ].sort((a, b) => a.value - b.value);
    
    if (distances[0].value <= 28) {
      if (distances[0].edge === 'left') newX = display.x;
      if (distances[0].edge === 'right') newX = display.x + display.width - newW;
      if (distances[0].edge === 'top') newY = display.y;
      if (distances[0].edge === 'bottom') newY = display.y + display.height - newH;
    }
  }

  mainWindow.setBounds({ x: newX, y: newY, width: newW, height: newH }, false);

  if (isMini) {
    mainWindow.setMaximumSize(SIZES.mini.width, SIZES.mini.height);
  } else {
    mainWindow.setMinimumSize(SIZES.full.width, SIZES.full.height);
  }

  mainWindow.setResizable(false);
  sendStateToRenderer();
  updateTrayMenu();
}

function toggleMiniDock() {
  dockMini = !dockMini;
  if (dockMini) snapMiniToNearestEdge(true);
  saveWindowState();
  updateTrayMenu();
}

function setConnectionState(state) {
  const allowed = new Set(['connecting', 'live', 'reconnecting', 'muted', 'stopped']);
  if (!allowed.has(state)) return;
  connectionState = state;
  updateTrayTooltip();
  updateTrayIcon();
  updateTrayMenu();
}

function sendStateToRenderer() {
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) return;
  mainWindow.webContents.send('set-playing', isPlaying);
  mainWindow.webContents.send('set-pinned',  isPinned);
  mainWindow.webContents.send('set-mini',    isMini);
  mainWindow.webContents.send('set-muted',   isMuted);
  sendSleepToRenderer();
}

function sendSleepToRenderer() {
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) return;
  mainWindow.webContents.send('sleep-update', sleepTimer ? sleepEndsAt : 0);
}

function quitApp() { saveWindowState(); app.exit(0); }

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const AUTOSTART_NAME = app.getName(); // 'Wavelength' in production

// Returns Run key value names that point to our exe but are NOT named AUTOSTART_NAME.
// These are entries Electron's own API won't find or clean up.
function findMisnamedAutostartEntries() {
  if (process.platform !== 'win32') return [];
  try {
    const { execSync } = require('child_process');
    const out = execSync(`reg query "${RUN_KEY}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const myExe = process.execPath.toLowerCase();
    const results = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s+(.*?)\s+REG_SZ\s+(.+)$/);
      if (!m) continue;
      const [, name, value] = m;
      if (name === AUTOSTART_NAME) continue; // Electron manages this one
      const exeInValue = value.trim().replace(/^"/, '').split('"')[0].trim().toLowerCase();
      if (exeInValue === myExe) results.push(name);
    }
    return results;
  } catch (_) { return []; }
}

function getAutostart() {
  if (app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin) return true;
  // Also check for misnamed entries (e.g. 'electron.app.Wavelength') that Electron's API misses
  return findMisnamedAutostartEntries().length > 0;
}

function toggleAutostart() {
  const enable = !getAutostart();
  app.setLoginItemSettings({ openAtLogin: enable, args: enable ? ['--hidden'] : [] });
  if (!enable && process.platform === 'win32') {
    // Remove any misnamed entries Electron's setLoginItemSettings won't touch
    const { execSync } = require('child_process');
    for (const name of findMisnamedAutostartEntries()) {
      try {
        execSync(`reg delete "${RUN_KEY}" /v "${name}" /f`, { stdio: 'pipe' });
        log(`[autostart] Removed misnamed autostart entry: ${name}`);
      } catch (_) {}
    }
  }
  updateTrayMenu();
}

function cleanupOrphanedAutostart() {
  if (process.platform !== 'win32') return;
  try {
    const { execSync } = require('child_process');
    const out = execSync(`reg query "${RUN_KEY}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const myExe = process.execPath.toLowerCase();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s+(.*?)\s+REG_SZ\s+(.+)$/);
      if (!m) continue;
      const [, name, value] = m;
      if (name === AUTOSTART_NAME) continue; // Electron manages this one
      const exeInValue = value.trim().replace(/^"/, '').split('"')[0].trim().toLowerCase();
      // Delete any entry under a different name pointing to our exe (misnamed) or a stale exe path
      if (exeInValue === myExe || exeInValue.includes('wavelength')) {
        try {
          execSync(`reg delete "${RUN_KEY}" /v "${name}" /f`, { stdio: 'pipe' });
          log(`[autostart] Removed misnamed/orphaned entry "${name}" → ${exeInValue}`);
        } catch (_) {}
      }
    }
  } catch (_) {}
}

function showFirstRunHint() {
  if (!Notification.isSupported() || fs.existsSync(FIRST_RUN_FILE)) return;
  if (mainWindow?.isVisible() && !startedHidden) return;
  try {
    fs.writeFileSync(FIRST_RUN_FILE, String(Date.now()));
  } catch (err) {
    log('first-run-hint-write', err.message);
    return;
  }
  new Notification({
    title: 'Wavelength',
    body: 'Läuft im Tray. Klick auf das Tray-Icon öffnet den Player.',
    icon: getIconPath('icon.ico'),
    silent: true,
  }).show();
}

function resetWindowPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  windowState.clear(STATE_FILE, log);
  fullWidth = SIZES.full.width;
  fullHeight = SIZES.full.height;
  const size = isMini ? SIZES.mini : { width: fullWidth, height: fullHeight };
  const display = screen.getPrimaryDisplay().workArea;
  const x = Math.round(display.x + (display.width - size.width) / 2);
  const y = Math.round(display.y + (display.height - size.height) / 2);
  mainWindow.setBounds({ x, y, width: size.width, height: size.height }, false);
  saveWindowState();
}

function resetAppSettings() {
  setSleepTimer(0);
  stopIcyMetadataClient();
  if (isPinned) {
    isPinned = false;
    mainWindow?.setAlwaysOnTop(false);
  }
  if (isMuted) isMuted = false;
  if (isMini) toggleMini();
  connectionState = isPlaying ? 'live' : 'stopped';
  mainWindow?.webContents.send('reset-settings');
  sendStateToRenderer();
  updateTrayMenu();
  updateTrayTooltip();
  updateTrayIcon();
}

function showAboutDialog() {
  if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
    mainWindow.webContents.send('show-about');
  }
}

function showShortcutsDialog() {
  if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
    mainWindow.webContents.send('show-shortcuts');
  }
}

// ── IPC ───────────────────────────────────────────────────
ipcMain.on('play-pause',        (_, forceState) => togglePlay(forceState));
ipcMain.on('toggle-pin',        togglePin);
ipcMain.on('toggle-mini',       toggleMini);
ipcMain.on('toggle-mute',       toggleMute);
ipcMain.on('hide-window',       () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); });
ipcMain.on('quit-app',          quitApp);
ipcMain.on('open-external',     (_, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});
ipcMain.on('cycle-sleep-timer', () => setSleepTimer(sleepTimer ? 0 : 30));
ipcMain.on('connection-state',  (_, state) => setConnectionState(state));
ipcMain.on('select-station',    (_, station, noPlay) => selectStationInternal(station, noPlay));
ipcMain.on('tray-icons',        (_, icons) => {
  for (const [state, dataUrl] of Object.entries(icons || {})) {
    if (!TRAY_ICON_STATES.has(state)) continue;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) continue;
    if (dataUrl.length > 50_000) continue;
    try {
      const img = nativeImage.createFromDataURL(dataUrl).resize({ width: 16, height: 16 });
      if (!img.isEmpty()) trayIconImages.set(state, img);
    } catch (err) {
      log('tray-icon-rejected', err.message || String(err));
    }
  }
  updateTrayIcon();
  updateTrayMenu();
});

ipcMain.handle('get-stations', async () => {
  try {
    const stations = await loadStations();
    const custom = customStations.load();
    allStations = [...custom, ...stations];
    if (!activeStation && allStations.length > 0) {
      activeStation = allStations[0];
    }
    updateTrayMenu();
    updateTrayTooltip();
    return allStations;
  } catch (err) {
    log('get-stations-failed: ' + err.message);
    const custom = customStations.load();
    allStations = [...custom, ...DEFAULT_STATIONS];
    return allStations;
  }
});

ipcMain.handle('add-custom-station', (e, data) => {
  customStations.add(data);
  const custom = customStations.load();
  allStations = [...custom, ...allStations.filter(s => !s.isCustom)];
  updateTrayMenu();
  return allStations;
});

ipcMain.handle('update-custom-station', (e, id, data) => {
  customStations.update(id, data);
  const custom = customStations.load();
  allStations = [...custom, ...allStations.filter(s => !s.isCustom)];
  if (activeStation && activeStation.id === id) {
    activeStation = custom.find(s => s.id === id) || activeStation;
  }
  updateTrayMenu();
  return allStations;
});

ipcMain.handle('remove-custom-station', (e, id) => {
  customStations.remove(id);
  const custom = customStations.load();
  allStations = [...custom, ...allStations.filter(s => !s.isCustom)];
  if (activeStation && activeStation.id === id) {
    activeStation = allStations[0] || null;
  }
  updateTrayMenu();
  return allStations;
});

ipcMain.handle('check-stream', (e, url) => new Promise(resolve => {
  try {
    const { net } = require('electron');
    const req = net.request({ method: 'HEAD', url, redirect: 'follow' });
    const timer = setTimeout(() => { try { req.abort(); } catch (_) {} resolve({ ok: false, error: 'timeout' }); }, 5000);
    req.on('response', res => { clearTimeout(timer); resolve({ ok: res.statusCode < 400, statusCode: res.statusCode }); });
    req.on('error',    err => { clearTimeout(timer); resolve({ ok: false, error: err.message }); });
    req.end();
  } catch (err) { resolve({ ok: false, error: err.message }); }
}));

ipcMain.handle('get-state',      () => ({
  isPlaying,
  isMini,
  isPinned,
  isMuted,
  version: APP_VERSION,
  sleepEndsAt,
  dockMini,
  activeStation
}));

// ── System idle detection ─────────────────────────────────
const IDLE_THRESHOLD = 600; // 10 minutes in seconds
let lastIdleState = false;

function checkSystemIdle() {
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) return;
  const state = powerMonitor.getSystemIdleState(IDLE_THRESHOLD);
  const isIdle = state === 'idle' || state === 'locked';
  if (isIdle !== lastIdleState) {
    lastIdleState = isIdle;
    mainWindow.webContents.send('system-idle', isIdle);
  }
}

// ── App lifecycle ─────────────────────────────────────────
app.whenReady().then(async () => {
  app.setAppUserModelId(APP_ID);
  cleanupOrphanedAutostart();

  // Let the WebAudio analyser read cross-origin stream data without weakening every response.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'media') {
      callback({});
      return;
    }
    const responseHeaders = {};
    for (const [key, value] of Object.entries(details.responseHeaders || {})) {
      if (key.toLowerCase() !== 'access-control-allow-origin') {
        responseHeaders[key] = value;
      }
    }
    responseHeaders['Access-Control-Allow-Origin'] = ['*'];
    callback({ responseHeaders });
  });

  nativeTheme.themeSource = 'dark';
  log(`start v${APP_VERSION}`);
  
  // Load stations on startup to pre-populate tray menu
  try {
    const stations = await loadStations();
    const custom = customStations.load();
    allStations = [...custom, ...stations];
    if (allStations.length > 0) {
      activeStation = allStations[0];
    }
  } catch (e) {
    log('startup-stations-load-error: ' + e.message);
    allStations = [];
  }

  createWindow();
  createTray();
  showFirstRunHint();
  if (startedHidden) setTimeout(fadeInWindow, 4000);

  if (!globalShortcut.register('MediaPlayPause', () => togglePlay())) log('shortcut-register-failed', 'MediaPlayPause');
  if (!globalShortcut.register('MediaStop',      () => { if (isPlaying) togglePlay(); })) log('shortcut-register-failed', 'MediaStop');

  setInterval(checkSystemIdle, 30_000);

  if (app.isPackaged) {
    autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', info => {
      log(`update-available v${info.version}`);
      new Notification({ title: 'Wavelength Update', body: `Version ${info.version} wird heruntergeladen…` }).show();
    });

    autoUpdater.on('update-downloaded', info => {
      log(`update-downloaded v${info.version}`);
      updateReadyVersion = info.version;
      new Notification({ title: 'Wavelength Update bereit', body: `v${info.version} installiert sich beim nächsten Start.` }).show();
      updateTrayMenu();
    });

    autoUpdater.on('error', err => log(`updater-error: ${err.message}`));

    setTimeout(() => autoUpdater.checkForUpdates().catch(err => log(`update-check-failed: ${err.message}`)), 10_000);
  }
});

app.on('will-quit', () => {
  log('quit');
  globalShortcut.unregisterAll();
});
