const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const vm       = require('vm');
const http     = require('http');

const { formatListen, averageLevel, trayState, fakeBar, mediaSessionFields } = require('../src/utils.js');
const { createIcyMetadataClient } = require('../src/icy-metadata-client.js');
const { buildTrayStationMenuItems, stationSwitcherSubmenu, trayStationGroupLabel } = require('../src/tray-menu.js');
const { validateStations } = require('./validate-stations.js');

const src  = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

// Minimal HTML query helper — finds an element by id and reads its attributes.
// Avoids attribute-order sensitivity of plain string includes().
function htmlEl(source, id) {
  const m = source.match(new RegExp(`<[a-zA-Z][^>]*\\bid="${id}"[^>]*>`));
  if (!m) return null;
  const tag = m[0];
  return {
    attr(name) {
      const am = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
      return am ? am[1] : null;
    },
    text() {
      const start = source.indexOf(m[0]) + m[0].length;
      const after = source.slice(start);
      const close = after.match(/^([^<]*)</);
      return close ? close[1] : '';
    },
  };
}
function htmlHasId(source, id) {
  return new RegExp(`\\bid="${id}"`).test(source);
}

const main    = src('main.js');
const preload = src('preload.js');
const stations = src('stations.js');
const icyMetadataClient = src('icy-metadata-client.js');
const html = src('index.html');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const renderer = [
  src('renderer-state.js'),
  src('renderer-ui.js'),
  src('renderer-audio.js'),
  src('renderer-stations.js'),
  src('renderer.js'),
].join('\n');

// ── formatListen ─────────────────────────────────────────────
test('formatListen: 0 ms', () => assert.equal(formatListen(0), '0 min'));
test('formatListen: unter 1 min', () => assert.equal(formatListen(59_999), '0 min'));
test('formatListen: genau 1 min', () => assert.equal(formatListen(60_000), '1 min'));
test('formatListen: 59 min', () => assert.equal(formatListen(3_540_000), '59 min'));
test('formatListen: genau 1 h', () => assert.equal(formatListen(3_600_000), '1 h'));
test('formatListen: 1 h 1 min', () => assert.equal(formatListen(3_660_000), '1 h 1 min'));
test('formatListen: 1 h 30 min', () => assert.equal(formatListen(5_400_000), '1 h 30 min'));
test('formatListen: genau 2 h', () => assert.equal(formatListen(7_200_000), '2 h'));
test('formatListen: 2 h 5 min', () => assert.equal(formatListen(7_500_000), '2 h 5 min'));

// ── averageLevel ─────────────────────────────────────────────
test('averageLevel: Nullen', () => assert.equal(averageLevel([0, 0, 0]), 0));
test('averageLevel: Einsen', () => assert.equal(averageLevel([1, 1, 1]), 1));
test('averageLevel: Mitte', () => assert.equal(averageLevel([0, 1]), 0.5));
test('averageLevel: einzelner Wert', () => assert.equal(averageLevel([0.75]), 0.75));

// ── trayState ─────────────────────────────────────────────────
test('trayState: reconnecting überschreibt alles', () => {
  assert.equal(trayState('reconnecting', false, true),  'reconnecting');
  assert.equal(trayState('reconnecting', true,  true),  'reconnecting');
  assert.equal(trayState('reconnecting', true,  false), 'reconnecting');
});
test('trayState: muted (playing)', () => {
  assert.equal(trayState('live', true, true), 'muted');
});
test('trayState: muted (nicht playing)', () => {
  assert.equal(trayState('stopped', true, false), 'muted');
});
test('trayState: playing', () => {
  assert.equal(trayState('live', false, true), 'playing');
});
test('trayState: stopped', () => {
  assert.equal(trayState('stopped', false, false), 'stopped');
});

// ── fakeBar ───────────────────────────────────────────────────
test('fakeBar: Wert immer im Bereich [0, 1]', () => {
  for (let t = 0; t < 10; t += 0.7) {
    for (let i = 0; i < 44; i++) {
      const v = fakeBar(t, i, 44);
      assert.ok(v >= 0 && v <= 1, `fakeBar(${t}, ${i}, 44) = ${v} liegt außerhalb [0,1]`);
    }
  }
});
test('fakeBar: variiert über die Zeit', () => {
  assert.notEqual(fakeBar(0, 20, 44), fakeBar(5, 20, 44));
});
test('fakeBar: Bell-Kurve — Mitte höher als Rand bei t=0', () => {
  assert.ok(fakeBar(0, 22, 44) > fakeBar(0, 0, 44), 'Mittelbalken sollte höher als Randbalken sein');
});
test('fakeBar: Randbalken = 0 (shape ist 0 am Rand)', () => {
  assert.equal(fakeBar(99, 0, 44), 0);
});

test('mediaSessionFields: Stationsname wenn keine Trackinfo vorhanden ist', () => {
  assert.deepEqual(mediaSessionFields('', 'Deutschlandfunk'), {
    title: 'Deutschlandfunk',
    artist: 'Wavelength',
  });
});

test('mediaSessionFields: trennt Artist und Titel aus ICY-Trackinfo', () => {
  assert.deepEqual(mediaSessionFields('Artist - Titel', 'Radio Eins'), {
    title: 'Titel',
    artist: 'Artist',
  });
});

test('mediaSessionFields: erhaelt Bindestriche im Titel', () => {
  assert.deepEqual(mediaSessionFields('Artist - Titel - Remix', 'Radio Eins'), {
    title: 'Titel - Remix',
    artist: 'Artist',
  });
});

test('mediaSessionFields: faellt bei unvollstaendiger Trackinfo sauber zurueck', () => {
  assert.deepEqual(mediaSessionFields('Artist - ', 'Radio Eins'), {
    title: 'Artist -',
    artist: 'Radio Eins',
  });
  assert.deepEqual(mediaSessionFields('  ', ''), {
    title: 'Wavelength',
    artist: 'Wavelength',
  });
});

// ── IPC-Contract ─────────────────────────────────────────────
test('IPC: alle preload-send-Kanäle haben ipcMain.on in main.js', () => {
  const channels = [...preload.matchAll(/ipcRenderer\.send\(['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(channels.length > 0, 'keine send-Kanäle in preload gefunden');
  for (const ch of channels) {
    assert.ok(
      main.includes(`'${ch}'`) || main.includes(`"${ch}"`),
      `main.js hat keinen Handler für send-Kanal '${ch}'`
    );
  }
});

test('IPC: alle preload-on-Kanäle werden von main.js gesendet', () => {
  const channels = [
    ...preload.matchAll(/ipcRenderer\.on\(['"]([^'"]+)['"]/g),
    ...preload.matchAll(/listen\(['"]([^'"]+)['"]/g)
  ].map(m => m[1]);
  assert.ok(channels.length > 0, 'keine on-Kanäle in preload gefunden');
  for (const ch of channels) {
    assert.ok(
      main.includes(`'${ch}'`) || main.includes(`"${ch}"`),
      `main.js sendet Kanal '${ch}' nie`
    );
  }
});

test('IPC: preload-on-Helfer geben Unsubscribe-Funktionen zurück', () => {
  assert.ok(preload.includes('function listen(channel, cb'), 'preload listen helper fehlt');
  assert.ok(preload.includes('return () => ipcRenderer.removeListener(channel, handler);'), 'preload listener cleanup fehlt');
  assert.ok(preload.includes("onSetPlaying:    (cb) => listen('set-playing'"), 'onSetPlaying nutzt listen helper nicht');
  assert.ok(preload.includes("onTrackInfo:     (cb) => listen('track-info'"), 'onTrackInfo nutzt listen helper nicht');
});

test('IPC: alle preload-invoke-Kanäle haben ipcMain.handle in main.js', () => {
  const channels = [...preload.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(channels.length > 0, 'keine invoke-Kanäle in preload gefunden');
  for (const ch of channels) {
    assert.ok(
      main.includes(`ipcMain.handle('${ch}'`) || main.includes(`ipcMain.handle("${ch}"`),
      `main.js hat kein ipcMain.handle für '${ch}'`
    );
  }
});

test('Security: BrowserWindow verwendet kein webSecurity: false', () => {
  assert.ok(!/webSecurity\s*:\s*false/.test(main), 'main.js should not disable Electron webSecurity');
});

test('Security: CORS-Header-Hook ist auf Media-Responses begrenzt', () => {
  assert.ok(main.includes("details.resourceType !== 'media'"), 'CORS-Header darf nicht global fuer alle Responses gesetzt werden');
  assert.ok(main.includes("Access-Control-Allow-Origin"), 'Media-CORS-Header fehlt');
});

test('Runtime: src-Dateien enthalten keine ungeschuetzten console.log-Aufrufe', () => {
  const runtimeFiles = fs.readdirSync(path.join(__dirname, '..', 'src')).filter(f => f.endsWith('.js'));
  for (const file of runtimeFiles) {
    const content = src(file);
    assert.ok(!/\bconsole\.log\s*\(/.test(content), `${file} enthält console.log`);
  }
});

test('Runtime: sichtbare Quellen enthalten keine Mojibake-Reste', () => {
  const files = [
    ...fs.readdirSync(path.join(__dirname, '..', 'src')).filter(f => f.endsWith('.js')).map(f => path.join('src', f)),
    path.join('src', 'index.html')
  ];
  for (const file of files) {
    const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(!/[ÃÂ�]/.test(content), `${file} enthält vermutlich kaputte UTF-8-Zeichen`);
  }
});

test('Main: Tray-Updates ignorieren bereits zerstoerte Objekte', () => {
  assert.ok(main.includes('if (!tray || tray.isDestroyed()) return;'), 'updateTrayMenu muss zerstoerten Tray ignorieren');
  assert.ok(main.includes("mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? 'Ausblenden' : 'Anzeigen'"), 'Tray-Menue darf isVisible nicht auf zerstoertem Fenster aufrufen');
  assert.ok(main.includes("if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();"), 'hide-window IPC braucht Window-Guard');
});

test('Main: ICY-Metadatenclient ignoriert veraltete Reconnect-Events', () => {
  assert.ok(main.includes("require('./icy-metadata-client.js')"), 'main.js muss den ICY-Client importieren');
  assert.ok(main.includes('const icyMetadataClient = createIcyMetadataClient'), 'main.js muss den ICY-Client initialisieren');
  assert.ok(icyMetadataClient.includes('let clientToken = 0'), 'ICY-Client-Token fehlt');
  assert.ok(icyMetadataClient.includes('let currentStreamUrl ='), 'aktuelle ICY-Stream-URL fehlt');
  assert.ok(icyMetadataClient.includes('function isCurrentClient(token, streamUrl)'), 'ICY-Current-Guard fehlt');
  assert.ok(icyMetadataClient.includes('if (!isCurrentClient(token, streamUrl)) return;'), 'veraltete ICY-Events werden nicht ignoriert');
  assert.ok(icyMetadataClient.includes('scheduleReconnect(streamUrl, token)'), 'Reconnect nutzt keinen ICY-Token');
  assert.ok(icyMetadataClient.includes('if (isCurrentClient(token, streamUrl)) start(streamUrl);'), 'Reconnect-Timer prueft Token nicht erneut');
});

test('Main: ICY-Request-Destroy-Fehler werden geloggt', () => {
  assert.ok(icyMetadataClient.includes('function destroyRequest(reason)'), 'destroyRequest Helper fehlt');
  assert.ok(icyMetadataClient.includes("log('[icy] Request destroy failed'"), 'Destroy-Fehler muessen geloggt werden');
  assert.ok(!/currentRequest\.destroy\(\);\s*}\s*catch \(_\) \{\}/.test(icyMetadataClient), 'ICY-Destroy darf Fehler nicht still verschlucken');
});

test('ICY Metadata Client: parst StreamTitle aus lokalem Stream', async () => {
  const title = 'Artist - Song';
  const metadata = `StreamTitle='${title}';`;
  const metadataBlocks = Math.ceil(Buffer.byteLength(metadata) / 16);
  const metadataBuffer = Buffer.alloc(metadataBlocks * 16);
  metadataBuffer.write(metadata);
  const chunk = Buffer.concat([
    Buffer.alloc(5),
    Buffer.from([metadataBlocks]),
    metadataBuffer,
  ]);

  const server = http.createServer((_, res) => {
    res.writeHead(200, { 'icy-metaint': '5' });
    res.end(chunk);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  const seen = [];
  const client = createIcyMetadataClient({
    userAgent: 'WavelengthRadioPlayer/test',
    log: () => {},
    isPlaying: () => true,
    onTrackTitle: value => seen.push(value),
  });
  let currentTitleBeforeStop = '';

  try {
    client.start(`http://127.0.0.1:${server.address().port}/stream`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for ICY metadata')), 1000);
      const poll = setInterval(() => {
        if (seen.length > 0) {
          clearTimeout(timer);
          clearInterval(poll);
          resolve();
        }
      }, 10);
    });
    currentTitleBeforeStop = client.getCurrentTrackTitle();
  } finally {
    client.stop();
    await new Promise(resolve => server.close(resolve));
  }

  assert.deepEqual(seen, [title]);
  assert.equal(currentTitleBeforeStop, title);
});

test('Main: Logger macht Rotationsfehler sichtbar', () => {
  assert.ok(main.includes('[logger] Rotation check failed'), 'Logger-Rotationsfehler muessen sichtbar werden');
  assert.ok(main.includes("err?.code !== 'ENOENT'"), 'fehlende Logdatei darf kein Rotationsfehler sein');
});

test('Main: Tray-Texte sind deutsch lokalisiert', () => {
  assert.ok(main.includes("connecting: 'Verbinden'"), 'Tray-Status connecting ist nicht deutsch');
  assert.ok(main.includes("reconnecting: 'Erneut verbinden'"), 'Tray-Status reconnecting ist nicht deutsch');
  assert.ok(main.includes("stopped: 'Gestoppt'"), 'Tray-Status stopped ist nicht deutsch');
  assert.ok(main.includes("'▶  Abspielen'"), 'Tray-Play-Text ist nicht deutsch');
  assert.ok(main.includes("'⏹  Stoppen'"), 'Tray-Stop-Text ist nicht deutsch');
  assert.ok(main.includes("'Anheften (immer im Vordergrund)'"), 'Tray-Pin-Text ist nicht deutsch');
  assert.ok(main.includes("return 'Sleeptimer'"), 'Tray-Sleeptimer-Text ist nicht deutsch');
  assert.ok(main.includes("'Mini-Player'"), 'Tray-Mini-Player-Text ist nicht deutsch');
});

test('Main: Tray-Stationsmenue ist alphabetisch sortiert', () => {
  const selected = [];
  const stationsForTray = [
    { id: 'z', name: 'Zebra FM' },
    { id: 'a', name: 'Äther Radio' },
    { id: 'b', name: 'alpha Radio' },
  ];
  const items = buildTrayStationMenuItems(stationsForTray, stationsForTray[2], station => selected.push(station.id));

  assert.deepEqual(items.map(item => item.label), ['alpha Radio', 'Äther Radio', 'Zebra FM']);
  assert.equal(items[0].checked, true);
  assert.equal(items[1].checked, false);
  items[1].click();
  assert.deepEqual(selected, ['a']);
});

test('Main: Tray-Stationsmenue gruppiert große Listen alphabetisch', () => {
  const stationsForTray = [
    { id: '1', name: '1 Radio' },
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
    { id: 'ä', name: 'Äther' },
  ];
  const groups = buildTrayStationMenuItems(stationsForTray, stationsForTray[2], () => {}, 2);

  assert.equal(trayStationGroupLabel({ name: '1 Radio' }), '0-9');
  assert.deepEqual(groups.map(group => group.label), ['0-9', 'A', 'Ä', '• B']);
  assert.deepEqual(groups[3].submenu.map(item => item.label), ['Beta']);
  assert.equal(groups[3].submenu[0].checked, true);
});

test('Main: Tray-Stationswechsler zeigt aktuelle Station und Ladezustand', () => {
  const menuItems = [{ label: 'Alpha' }];
  assert.deepEqual(stationSwitcherSubmenu([], null), [{ label: 'Lade Stationen...', enabled: false }]);
  assert.deepEqual(stationSwitcherSubmenu(menuItems, null), menuItems);
  assert.deepEqual(stationSwitcherSubmenu(menuItems, { name: 'Beta' }), [
    { label: 'Aktuell: Beta', enabled: false },
    { type: 'separator' },
    ...menuItems,
  ]);
});

test('UI: sichtbare Status- und Tooltexte sind deutsch lokalisiert', () => {
  assert.ok(html.includes('Multi-Sender-Radio'), 'HTML-Default-Subtitle ist nicht deutsch');
  const aboutVersion = htmlEl(html, 'about-version');
  assert.ok(aboutVersion, 'About-Version-Element fehlt');
  assert.equal(aboutVersion.text(), `v${pkg.version}`, 'About-Fallback-Version muss zur package.json passen');
  const btnPlay = htmlEl(html, 'btn-playstop');
  assert.ok(btnPlay, 'Play-Button fehlt');
  assert.equal(btnPlay.attr('aria-label'), 'Abspielen', 'Play-Button aria-label ist nicht deutsch');
  assert.equal(btnPlay.attr('aria-pressed'), 'false', 'Play-Button aria-pressed-Initialwert fehlt');
  assert.equal(btnPlay.attr('title'), 'Abspielen', 'Play-Button Tooltip ist nicht die Aktion');
  const miniPlay = htmlEl(html, 'mini-playstop');
  assert.ok(miniPlay, 'Mini-Play-Button fehlt');
  assert.equal(miniPlay.attr('aria-label'), 'Abspielen', 'Mini-Play-Button aria-label ist nicht deutsch');
  assert.equal(miniPlay.attr('title'), 'Abspielen', 'Mini-Play-Button Tooltip ist nicht die Aktion');
  assert.ok(renderer.includes('btn.title = playLabel;'), 'Play-Button Tooltip wird nicht dynamisch aktualisiert');
  assert.ok(html.includes('<path d="M 2 1 L 11 6 L 2 11 L 2 1 Z"/>'), 'Mini-Play-Icon muss als morphbarer path definiert sein');
  assert.ok(renderer.includes("'M 2.5 2.5 L 9.5 2.5 L 9.5 9.5 L 2.5 9.5 Z'"), 'Mini-Play-Icon wird nicht zum Stop-Symbol aktualisiert');
  const btnSleep = htmlEl(html, 'btn-sleep');
  assert.ok(btnSleep, 'Sleeptimer-Button fehlt');
  assert.equal(btnSleep.attr('aria-label'), 'Sleeptimer', 'Sleeptimer aria-label ist nicht deutsch');
  const btnBass = htmlEl(html, 'btn-bass');
  assert.ok(btnBass, 'Bass-Button fehlt');
  assert.equal(btnBass.attr('aria-label'), 'Bassverstärkung', 'Bass aria-label ist nicht deutsch');
  assert.ok(html.includes('Stream-URL'), 'Stream-URL Label ist nicht deutsch formatiert');
  for (const legacy of ['Multi-Station Player', 'Wavelength Player', 'aria-label="Play"', 'title="Leertaste"', 'Sleep Timer', 'Bass Boost', 'Stream URL']) {
    assert.ok(!html.includes(legacy), `HTML enthaelt noch altes UI-Label: ${legacy}`);
  }
});

test('UI Labels: deutsche Status-, Play- und Medienlabels', async () => {
  const labels = await import('../src/ui-labels.mjs');
  assert.equal(labels.connectionLabel('reconnecting'), 'Erneut verbinden');
  assert.equal(labels.connectionLabel('muted'), 'Stumm');
  assert.equal(labels.connectionLabel('connecting'), 'Verbinden');
  assert.equal(labels.connectionLabel('stopped'), 'Gestoppt');
  assert.equal(labels.connectionLabel('unknown'), 'Gestoppt');
  assert.equal(labels.playStopLabel(true), 'Stoppen');
  assert.equal(labels.playStopLabel(false), 'Abspielen');
  assert.equal(labels.bassTooltip(1), 'Bassverstärkung: +6 dB');
  assert.deepEqual(labels.MEDIA_SESSION_FALLBACK, {
    title: 'Livestream',
    artist: 'Wavelength',
    album: 'Multi-Sender-Radio',
  });
});

test('Release: User-Agent nutzt aktuelle Paketversion', () => {
  assert.ok(main.includes('const APP_VERSION = app.getVersion()'), 'main.js muss app.getVersion() nutzen');
  assert.ok(stations.includes('const APP_VERSION = app.getVersion()'), 'stations.js muss app.getVersion() nutzen');
  assert.ok(main.includes('const APP_USER_AGENT = `WavelengthRadioPlayer/${APP_VERSION} (Windows Electron App)`'), 'main.js User-Agent muss dynamisch sein');
  assert.ok(stations.includes('const APP_USER_AGENT = `WavelengthRadioPlayer/${APP_VERSION} (Windows Electron App)`'), 'stations.js User-Agent muss dynamisch sein');
  assert.ok(!main.includes('WavelengthRadioPlayer/1.0.0'), 'main.js enthaelt noch alten User-Agent');
  assert.ok(!stations.includes('WavelengthRadioPlayer/1.0.0'), 'stations.js enthaelt noch alten User-Agent');
});

test('Windows: App User Model ID passt zur Build-App-ID', () => {
  assert.equal(pkg.build.appId, 'com.wavelength.player', 'package.json appId unerwartet');
  assert.ok(main.includes("const APP_ID = 'com.wavelength.player'"), 'main.js muss die Windows App-ID zentral definieren');
  assert.ok(main.includes('app.setAppUserModelId(APP_ID)'), 'Windows App User Model ID wird nicht gesetzt');
});

test('Windows Media Controls: MediaSession und Hardware-Tasten sind verdrahtet', () => {
  assert.ok(renderer.includes('navigator.mediaSession.metadata = new MediaMetadata'), 'MediaSession-Metadaten fehlen');
  assert.ok(renderer.includes("navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'"), 'MediaSession playbackState fehlt');
  assert.ok(renderer.includes("navigator.mediaSession.setActionHandler('play'"), 'MediaSession play handler fehlt');
  assert.ok(renderer.includes("navigator.mediaSession.setActionHandler('pause'"), 'MediaSession pause handler fehlt');
  assert.ok(renderer.includes("navigator.mediaSession.setActionHandler('stop'"), 'MediaSession stop handler fehlt');
  assert.ok(main.includes("globalShortcut.register('MediaPlayPause'"), 'MediaPlayPause Shortcut fehlt');
  assert.ok(main.includes("globalShortcut.register('MediaStop'"), 'MediaStop Shortcut fehlt');
});

test('Release: Build-Skripte bleiben unsigned und einfach', () => {
  assert.ok(pkg.scripts.build && pkg.scripts.build.includes('electron-builder'), 'build Script fehlt');
  assert.ok(!pkg.scripts['signing:check'], 'signing:check soll nicht mehr Teil des Release-Flows sein');
  assert.ok(!pkg.scripts['build:signed'], 'build:signed soll nicht mehr Teil des Release-Flows sein');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'SIGNING.md')), 'SIGNING.md soll entfernt bleiben');
  assert.ok(!fs.existsSync(path.join(__dirname, 'check-signing.js')), 'check-signing.js soll entfernt bleiben');
});

test('Verify: Release-Check laeuft ohne Build-Schritt', () => {
  assert.ok(pkg.scripts.verify, 'verify Script fehlt');
  assert.ok(pkg.scripts.verify.includes('stations:check'), 'verify muss stations:check ausfuehren');
  assert.ok(pkg.scripts.verify.includes('ui:audit'), 'verify muss ui:audit ausfuehren');
  assert.ok(pkg.scripts.verify.includes('npm test'), 'verify muss npm test ausfuehren');
  assert.ok(!pkg.scripts.verify.includes('npm run build'), 'verify darf keinen Build ausfuehren');
  assert.ok(!pkg.scripts.verify.includes('electron-builder'), 'verify darf electron-builder nicht direkt ausfuehren');
});

test('UI Audit: laeuft ohne GPU-Hardwarebeschleunigung', () => {
  const audit = fs.readFileSync(path.join(__dirname, 'ui-audit.js'), 'utf8');
  assert.ok(audit.includes('app.disableHardwareAcceleration()'), 'ui-audit sollte GPU-Flakes vermeiden');
});

test('UI Audit: prueft alle Visualizer-Modi per Canvas-Pixel', () => {
  const audit = fs.readFileSync(path.join(__dirname, 'ui-audit.js'), 'utf8');
  assert.ok(audit.includes('async function auditVisualizerModes(win)'), 'Visualizer-Audit fehlt');
  assert.ok(audit.includes('window.WavelengthVisualizer?.VISUALIZER_MODES'), 'Visualizer-Audit muss die echte Modusliste nutzen');
  assert.ok(audit.includes('ctx.getImageData'), 'Visualizer-Audit muss Canvas-Pixel auswerten');
  assert.ok(audit.includes('miniLitPixels'), 'Mini-Visualizer muss mitgeprueft werden');
});

test('Window: Hauptfenster bleibt feste 460x480 UI', () => {
  assert.ok(main.includes('full: { width: 460, height: 480 }'), 'Full-View-Größe muss fest definiert sein');
  assert.ok(main.includes('resizable: false'), 'BrowserWindow sollte nicht frei skalierbar sein');
  assert.ok(main.includes('maxWidth: startSize.width, maxHeight: startSize.height'), 'Fenster-Maximalgröße fehlt');
  assert.ok(main.includes('fullWidth = SIZES.full.width'), 'gespeicherte Breite darf die feste UI nicht überschreiben');
  assert.ok(!main.includes('mainWindow.getSize()'), 'Resize-Events dürfen keine freie Full-View-Größe persistieren');
});

test('Stations: NDR 2 verwendet keine bekannten toten URLs', () => {
  assert.ok(!stations.includes('ndr-ndr2-niedersachsen.icecast.ndr.de'), 'NDR 2 stream host no longer resolves');
  assert.ok(!stations.includes('NDR_2_logo_2015.png'), 'NDR 2 icon URL returns 404');
});

test('Stations: Radio Hamburg verwendet das aktuelle Logo', () => {
  assert.ok(stations.includes('radiohamburg.de/assets/icons/apple-touch-icon.png'), 'Radio Hamburg Logo fehlt oder verweist auf alten Pfad');
  assert.ok(!stations.includes('Radio_Hamburg_Logo.svg'), 'Radio Hamburg verwendet noch den alten Logo-Pfad');
});

test('Stations: 1LIVE Diggi hat einen spezifischen Icon-Override vor 1LIVE', () => {
  assert.ok(stations.includes("'1live diggi': 'https://www1.wdr.de/radio/1live-diggi/"), '1LIVE Diggi Icon-Override fehlt');
  assert.ok(
    stations.indexOf("'1live diggi'") < stations.indexOf("'1live'"),
    '1LIVE Diggi muss vor dem generischen 1LIVE-Match stehen'
  );
});

test('Stations: loadStations fällt bei API-Fehlern auf DEFAULT_STATIONS zurück', () => {
  assert.ok(stations.includes('stations.json'), 'DEFAULT_STATIONS werden nicht aus stations.json geladen');
  assert.ok(stations.includes('catch (err)') && stations.includes('Failed to fetch stations from Radio Browser'), 'API-Fehler werden nicht abgefangen');
  assert.ok(stations.includes('mergeStations(DEFAULT_STATIONS, apiStations)'), 'DEFAULT_STATIONS werden nicht mit API/Cache gemerged');
  assert.ok(stations.includes('return merged.map(normalizeStationLanguage).map(normalizeStationGenre).map(enrichStationIcon)'), 'Stationen werden vor Rückgabe normalisiert');
});

test('Stations: kuratierte Defaults bestehen die Maintenance-Validierung', () => {
  const stationsJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'stations.json'), 'utf8'));
  assert.deepEqual(validateStations(stationsJson), []);
  assert.ok(pkg.scripts['stations:check'], 'stations:check Script fehlt');
});

test('Renderer: selectStation persistiert Auswahl, synchronisiert main ohne Doppelstart', () => {
  const match = renderer.match(/function selectStation\(station, options = \{\}\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'selectStation nicht gefunden');
  const body = match[1];
  assert.ok(body.includes("localStorage.setItem('wl.lastStationId', station.id)"), 'letzte Station wird nicht persistiert');
  assert.ok(!body.includes('api.playPause(true)'), 'selectStation darf keinen zweiten Play-Befehl senden');
  assert.ok(renderer.includes("selectStation(station, { syncMain: false, startWhenStopped: false })"), 'Main-Sync darf nicht zurück an Main funken');
  assert.ok(renderer.includes("selectStation(loadedStation, { startWhenStopped: false })"), 'Initialauswahl darf nicht automatisch Playback starten');
  assert.ok(renderer.includes('if (loadBool(LS.playing)) api.playPause(true);'), 'Autoplay-Restore muss force true nutzen');
});

test('Station Selection: Main-Sync und Playback-Restart Regeln', async () => {
  const selection = await import('../src/station-selection.mjs');
  assert.equal(selection.shouldSuppressMainAutoplay(false, false), true);
  assert.equal(selection.shouldSuppressMainAutoplay(false, true), false);
  assert.equal(selection.shouldSuppressMainAutoplay(true, false), false);
  assert.equal(selection.shouldRestartPlayback(true), true);
  assert.equal(selection.shouldRestartPlayback(false), false);
});

test('Main: get-stations-Fallback referenziert importierte DEFAULT_STATIONS', () => {
  assert.ok(main.includes("const { loadStations, DEFAULT_STATIONS } = require('./stations.js')"), 'DEFAULT_STATIONS wird in main.js nicht importiert');
  assert.ok(main.includes('DEFAULT_STATIONS'), 'get-stations-Fallback referenziert DEFAULT_STATIONS nicht');
});

test('Renderer: externe Stationsdaten werden vor Template-Rendering escaped', () => {
  assert.ok(renderer.includes('const stationName = escapeHtml(station.name)'), 'Stationsname wird nicht escaped');
  assert.ok(renderer.includes('const stationGenre = escapeHtml(station.genre'), 'Genre wird nicht escaped');
  assert.ok(renderer.includes('const stationCountry = escapeHtml(station.country'), 'Country wird nicht escaped');
  assert.ok(renderer.includes('const stationId = escapeHtml(station.id)'), 'Station-ID wird nicht escaped');
  assert.ok(renderer.includes('const iconUrl = safeHttpUrl(station.iconUrl)'), 'Icon-URL wird nicht validiert');
  assert.ok(renderer.includes('safeHttpUrl(station.iconUrl)') && renderer.includes('api.cacheIcon('), 'Icon-URLs werden nicht über Cache-Proxy geladen');
  assert.ok(renderer.includes('const recentUrl = safeHttpUrl(station.iconUrl)'), 'Recent-Item-Logo-URL wird nicht sanitiert');
  assert.ok(!renderer.includes('${station.name}</span>'), 'Stationsname darf nicht roh in innerHTML interpoliert werden');
  assert.ok(!renderer.includes('src="${station.iconUrl}"'), 'Icon-URL darf nicht roh in innerHTML interpoliert werden');
  assert.ok(!renderer.includes('onerror='), 'Inline-Event-Handler im Stations-Markup sind nicht erlaubt');
});

test('Renderer Sanitizer: escaped HTML und erlaubt nur HTTP(S)-URLs', async () => {
  const sanitize = await import('../src/renderer-sanitize.mjs');
  assert.equal(sanitize.escapeHtml(`<img src=x onerror='x'>&"`), '&lt;img src=x onerror=&#39;x&#39;&gt;&amp;&quot;');
  assert.equal(sanitize.escapeHtml(null), '');
  assert.equal(sanitize.safeHttpUrl('https://example.com/a b'), 'https://example.com/a%20b');
  assert.equal(sanitize.safeHttpUrl('http://example.com/logo.png'), 'http://example.com/logo.png');
  assert.equal(sanitize.safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(sanitize.safeHttpUrl('file:///tmp/logo.png'), '');
  assert.equal(sanitize.safeHttpUrl('not a url'), '');
});

test('Renderer: reconnect meldet reconnecting und setzt bei Erfolg wieder live/stopped', () => {
  assert.ok(renderer.includes('function scheduleReconnect()'), 'scheduleReconnect fehlt');
  assert.ok(renderer.includes('setReconnecting(true)'), 'Reconnect-State wird nicht gesetzt');
  assert.ok(renderer.includes("if (state.playing) reportConnectionState(state.muted ? 'muted' : 'live')"), 'Live-State wird nach Erfolg nicht gemeldet');
  assert.ok(renderer.includes("reportConnectionState('stopped')"), 'Stopped-State wird beim Stop nicht gemeldet');
});

test('Reconnect Policy: Backoff und Scheduling-Regeln', async () => {
  const reconnect = await import('../src/reconnect-policy.mjs');
  assert.deepEqual(reconnect.RECONNECT_DELAYS, [1000, 2000, 4000, 8000, 16000, 30000]);
  assert.equal(reconnect.shouldScheduleReconnect(null, true), true);
  assert.equal(reconnect.shouldScheduleReconnect(123, true), false);
  assert.equal(reconnect.shouldScheduleReconnect(null, false), false);
  assert.equal(reconnect.reconnectDelayForAttempt(0), 1000);
  assert.equal(reconnect.reconnectDelayForAttempt(4), 16000);
  assert.equal(reconnect.reconnectDelayForAttempt(99), 30000);
  assert.equal(reconnect.nextReconnectAttempt(2), 3);
});

test('Renderer: Sender-Normalisierung nutzt stationGain zwischen analyser und limiter', () => {
  assert.ok(renderer.includes('state.stationGain = state.audioCtx.createGain()'), 'GainNode wird nicht erstellt');
  assert.ok(renderer.includes('state.analyser.connect(state.stationGain)'), 'stationGain hängt nicht nach dem analyser');
  assert.ok(renderer.includes('state.stationGain.connect(limiter)'), 'stationGain hängt nicht vor dem limiter');
});

test('Station Gain: Regeln fuer Key, Clamp, Label und linearen Gain', async () => {
  const gain = await import('../src/station-gain.mjs');
  assert.equal(gain.stationGainKey('abc'), 'wl.stationGainDb_abc');
  assert.equal(gain.clampStationGainDb(-99), -9);
  assert.equal(gain.clampStationGainDb(99), 9);
  assert.equal(gain.clampStationGainDb('bad'), 0);
  assert.equal(gain.stationGainLabel(0), '0 dB');
  assert.equal(gain.stationGainLabel(4), '+4 dB');
  assert.equal(gain.stationGainLabel(-3), '-3 dB');
  assert.equal(gain.nextStationGainDb(8, 4), 9);
  assert.equal(gain.nextStationGainDb(-8, -4), -9);
  assert.equal(gain.gainDbToLinear(0), 1);
  assert.ok(Math.abs(gain.gainDbToLinear(6) - 1.995262) < 0.00001);
});

test('Renderer: Sender-Trim ist bedienbar verdrahtet', () => {
  const html = src('index.html');
  assert.ok(htmlHasId(html, 'station-gain-pill'), 'Trim-Pill fehlt');
  assert.ok(!htmlHasId(html, 'btn-station-gain-down'), 'leiser Button sollte nicht permanent sichtbar sein');
  assert.ok(!htmlHasId(html, 'btn-station-gain-up'), 'lauter Button sollte nicht permanent sichtbar sein');
  assert.ok(renderer.includes("localStorage.removeItem(stationGainKey(state.activeStation.id))"), '0 dB Trim wird nicht zurückgesetzt');
  assert.ok(renderer.includes("safeAddListener('station-gain-pill', 'click', resetStationGain)"), 'Trim-Pill ist nicht verdrahtet');
  assert.ok(!renderer.includes("case 'BracketLeft'"), 'Klammer-Shortcut sollte nicht verwendet werden');
  assert.ok(!renderer.includes("case 'BracketRight'"), 'Klammer-Shortcut sollte nicht verwendet werden');
  assert.ok(renderer.includes("case 'ArrowUp'") && renderer.includes("case 'ArrowDown'"), 'Pfeiltasten-Handling fehlt');
  assert.ok(renderer.includes('if (e.altKey) adjustStationGain(STATION_GAIN_STEP_DB)'), 'Alt+Pfeil hoch für Sender lauter fehlt');
  assert.ok(renderer.includes('if (e.altKey) adjustStationGain(-STATION_GAIN_STEP_DB)'), 'Alt+Pfeil runter für Sender leiser fehlt');
});

test('Renderer State: kaputte gespeicherte Listen werden bereinigt', () => {
  const removed = [];
  const storage = new Map([
    ['wl.favorites', '{bad json'],
    ['wl.recentStations', '["one","two"]'],
  ]);
  const code = src('renderer-state.js')
    .replace("export const audio = document.getElementById('audio');", "const audio = document.getElementById('audio');")
    .replace('export const state = {', 'globalThis.__state = {');
  const context = {
    document: { getElementById: () => ({}) },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      removeItem: key => removed.push(key),
    },
  };

  vm.runInNewContext(code, context);

  assert.deepEqual(removed, ['wl.favorites']);
  assert.deepEqual(Array.from(context.__state.favorites), []);
  assert.deepEqual(Array.from(context.__state.recentStations), ['one', 'two']);
});

test('UI: Status-Badges bleiben einzeilig', () => {
  const css = src('index.css');
  assert.ok(/\.listen-badge\s*\{[\s\S]*?white-space:\s*nowrap/.test(css), 'Listen-Badge darf nicht umbrechen');
  assert.ok(/\.live-badge\s*\{[\s\S]*?white-space:\s*nowrap/.test(css), 'Live-Badge darf nicht umbrechen');
  assert.ok(/\.sleep-badge\s*\{[\s\S]*?white-space:\s*nowrap/.test(css), 'Sleep-Badge darf nicht umbrechen');
});

// ── window-state ─────────────────────────────────────────────
const windowState = require('../src/window-state.js');

function tmpFile() { return path.join(os.tmpdir(), `ws-test-${Math.random().toString(36).slice(2)}.json`); }
const noop = () => {};

test('windowState.load: gibt null zurück wenn Datei fehlt', () => {
  assert.equal(windowState.load('/nonexistent/path.json', noop), null);
});

test('windowState.load: gibt null zurück bei defektem JSON', () => {
  const f = tmpFile();
  fs.writeFileSync(f, 'KEIN JSON');
  assert.equal(windowState.load(f, noop), null);
  fs.unlinkSync(f);
});

test('windowState.load: parst gültige Position korrekt', () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({ x: 100, y: 200, isMini: true, dockMini: false }));
  const s = windowState.load(f, noop);
  assert.deepEqual(s, { x: 100, y: 200, width: null, height: null, isMini: true, dockMini: false });
  fs.unlinkSync(f);
});

test('windowState.load: parst gültige Position und Größe korrekt', () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({ x: 100, y: 200, width: 450, height: 480, isMini: true, dockMini: false }));
  const s = windowState.load(f, noop);
  assert.deepEqual(s, { x: 100, y: 200, width: 450, height: 480, isMini: true, dockMini: false });
  fs.unlinkSync(f);
});

test('windowState.load: verwirft Eintrag mit nicht-finiten Koordinaten', () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({ x: null, y: 200 }));
  assert.equal(windowState.load(f, noop), null);
  fs.unlinkSync(f);
});

test('windowState.load: dockMini default true wenn fehlt', () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({ x: 10, y: 20 }));
  const s = windowState.load(f, noop);
  assert.equal(s.dockMini, true);
  fs.unlinkSync(f);
});

test('windowState.save: schreibt Datei wenn Fenster on-screen', () => {
  const f = tmpFile();
  const fakeWin = { isDestroyed: () => false, getPosition: () => [50, 60] };
  const displays = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
  windowState.save(f, noop, fakeWin, displays, false, true, 450, 480);
  const written = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(written, { x: 50, y: 60, isMini: false, dockMini: true, width: 450, height: 480 });
  fs.unlinkSync(f);
});

test('windowState.save: überspringt Schreiben wenn Fenster off-screen', () => {
  const f = tmpFile();
  const fakeWin = { isDestroyed: () => false, getPosition: () => [9999, 9999] };
  const displays = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
  windowState.save(f, noop, fakeWin, displays, false, true);
  assert.ok(!fs.existsSync(f), 'Datei sollte nicht geschrieben werden');
});

test('windowState.clear: löscht Datei wenn sie existiert', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{}');
  windowState.clear(f, noop);
  assert.ok(!fs.existsSync(f));
});

test('windowState.clear: kein Fehler wenn Datei nicht existiert', () => {
  assert.doesNotThrow(() => windowState.clear('/nonexistent/path.json', noop));
});

// ── RECONNECT_DELAYS ─────────────────────────────────────────
test('RECONNECT_DELAYS: exponentieller Backoff, endet bei 30s', async () => {
  const { RECONNECT_DELAYS: delays } = await import('../src/reconnect-policy.mjs');
  assert.equal(delays[0], 1000, 'erster Delay muss 1 s sein');
  assert.equal(delays[delays.length - 1], 30_000, 'letzter Delay muss 30 s sein');
  for (let i = 1; i < delays.length; i++) {
    assert.ok(delays[i] > delays[i - 1], `delays[${i}] muss > delays[${i - 1}] sein`);
  }
});

// ── stations.js – mapStation ──────────────────────────────────
// Electron-Mock: app.getPath() zeigt auf tmpDir, damit CACHE_FILE auflösbar ist
const Module = require('module');
const stationsTmpDir = path.join(os.tmpdir(), `wl-stations-test-${Date.now()}`);
fs.mkdirSync(stationsTmpDir, { recursive: true });
const _origLoad = Module._load;
Module._load = function (req, ...args) {
  if (req === 'electron') return { app: { getPath: () => stationsTmpDir, getVersion: () => pkg.version } };
  return _origLoad.call(this, req, ...args);
};
const { mapStation, mergeStations, DEFAULT_STATIONS, homepageFavicon, localizeGenreLabel, localizeLanguageLabel } = require('../src/stations.js');
Module._load = _origLoad;

const minimalDto = {
  stationuuid: 'abc-123',
  name: '  Test FM  ',
  url_resolved: 'https://stream.test/live.mp3',
  url: 'https://stream.test/fallback.mp3',
  favicon: 'https://test.fm/icon.png',
  tags: 'pop,charts',
  countrycode: 'DE',
  homepage: 'https://test.fm',
  language: 'german',
};

test('mapStation: mappt Pflichtfelder korrekt', () => {
  const s = mapStation(minimalDto);
  assert.equal(s.id, 'abc-123');
  assert.equal(s.name, 'Test FM');
  assert.equal(s.streamUrl, 'https://stream.test/live.mp3');
  assert.equal(s.iconUrl, 'https://test.fm/icon.png');
  assert.equal(s.country, 'DE');
  assert.equal(s.website, 'https://test.fm');
});

test('mapStation: bevorzugt url_resolved gegenüber url', () => {
  const s = mapStation(minimalDto);
  assert.equal(s.streamUrl, 'https://stream.test/live.mp3');
});

test('mapStation: fällt auf url zurück wenn url_resolved fehlt', () => {
  const s = mapStation({ ...minimalDto, url_resolved: undefined });
  assert.equal(s.streamUrl, 'https://stream.test/fallback.mp3');
});

test('mapStation: nutzt Homepage-Favicon wenn Radio Browser kein Favicon liefert', () => {
  const s = mapStation({ ...minimalDto, favicon: '' });
  assert.equal(s.iconUrl, 'https://test.fm/favicon.ico');
});

test('homepageFavicon: ignoriert ungültige oder nicht-http URLs', () => {
  assert.equal(homepageFavicon('not a url'), '');
  assert.equal(homepageFavicon('file:///tmp/logo.png'), '');
});

test('mapStation: Genre aus erstem Tag, kapitalisiert', () => {
  const s = mapStation({ ...minimalDto, tags: 'rock,classic' });
  assert.equal(s.genre, 'Rock');
});

test('mapStation: englische Radio-Browser-Genres werden eingedeutscht', () => {
  assert.equal(mapStation({ ...minimalDto, tags: 'news,pop' }).genre, 'Nachrichten');
  assert.equal(mapStation({ ...minimalDto, tags: 'culture,talk' }).genre, 'Kultur');
  assert.equal(mapStation({ ...minimalDto, tags: 'electronic,dance' }).genre, 'Elektronik');
  assert.equal(mapStation({ ...minimalDto, tags: 'classic,jazz' }).genre, 'Klassik');
  assert.equal(mapStation({ ...minimalDto, tags: 'classic rock,pop' }).genre, 'Rock Klassiker');
  assert.equal(mapStation({ ...minimalDto, tags: 'chillout+lounge,ambient' }).genre, 'Chillout / Lounge');
  assert.equal(mapStation({ ...minimalDto, tags: 'easy listening,relax' }).genre, 'Leichte Musik');
  assert.equal(mapStation({ ...minimalDto, tags: '1980s,oldies' }).genre, '80er');
});

test('localizeGenreLabel: Radio-Browser-Tags werden direkt lokalisiert', () => {
  assert.equal(localizeGenreLabel('news'), 'Nachrichten');
  assert.equal(localizeGenreLabel('culture'), 'Kultur');
  assert.equal(localizeGenreLabel('electronic'), 'Elektronik');
  assert.equal(localizeGenreLabel('classic rock'), 'Rock Klassiker');
  assert.equal(localizeGenreLabel('easy listening'), 'Leichte Musik');
  assert.equal(localizeGenreLabel('1980s'), '80er');
});

test('localizeGenreLabel: zusammengesetzte Genres bleiben dedupliziert und lokalisiert', () => {
  assert.equal(localizeGenreLabel('culture / news'), 'Kultur / Nachrichten');
  assert.equal(localizeGenreLabel('wissen / pop'), 'Wissen / Pop');
  assert.equal(localizeGenreLabel('chillout / lounge'), 'Chillout / Lounge');
  assert.equal(localizeGenreLabel('pop / pop'), 'Pop');
});

test('localizeGenreLabel: deutsche Zielwerte bleiben idempotent', () => {
  assert.equal(localizeGenreLabel('Rock Klassiker'), 'Rock Klassiker');
  assert.equal(localizeGenreLabel('Leichte Musik'), 'Leichte Musik');
  assert.equal(localizeGenreLabel('Nachrichten'), 'Nachrichten');
});

test('localizeGenreLabel: unbekannte Tags werden lesbar kapitalisiert', () => {
  assert.equal(localizeGenreLabel('deep cuts'), 'Deep cuts');
  assert.equal(localizeGenreLabel(''), '');
  assert.equal(localizeGenreLabel(null), '');
});

test('mapStation: schwache Radio-Browser-Tags werden uebersprungen', () => {
  assert.equal(mapStation({ ...minimalDto, name: 'TOP 100 CLUB CHARTS', tags: '#charts,#edm,#house,chillout' }).genre, 'Elektronik');
  assert.equal(mapStation({ ...minimalDto, name: '- 0 N - 2000s on Radio', tags: '00er,00s,2000er,pop' }).genre, '2000er');
  assert.equal(mapStation({ ...minimalDto, name: 'B5 aktuell', tags: 'ard,bayerischer rundfunk,information,news' }).genre, 'Nachrichten');
  assert.equal(mapStation({ ...minimalDto, name: 'Berliner Rundfunk 91.4', tags: 'berlin,pop' }).genre, 'Pop');
  assert.equal(mapStation({ ...minimalDto, name: 'MANGORADIO', tags: 'music,variety' }).genre, 'Mix');
});

test('mapStation: Namen helfen bei leeren oder schwachen Tags', () => {
  assert.equal(mapStation({ ...minimalDto, name: '1000 Goldschlager', tags: '' }).genre, 'Schlager');
  assert.equal(mapStation({ ...minimalDto, name: 'SWR1 BW', tags: '' }).genre, 'Oldies');
  assert.equal(mapStation({ ...minimalDto, name: 'WDR4', tags: '' }).genre, 'Oldies');
});

test('mapStation: Genre-Fallback auf "Radio" wenn tags leer', () => {
  const s = mapStation({ ...minimalDto, tags: '' });
  assert.equal(s.genre, 'Radio');
});

test('mapStation: ignoriert Tags die länger als 19 Zeichen sind', () => {
  const s = mapStation({ ...minimalDto, tags: 'diesertagistlaengeral20zeichen,pop' });
  assert.equal(s.genre, 'Pop');
});

test('mapStation: language wird eingedeutscht', () => {
  const s = mapStation({ ...minimalDto, language: 'english' });
  assert.equal(s.language, 'Deutsch');
});

test('mapStation: language-Fallback auf "Deutsch" wenn leer', () => {
  const s = mapStation({ ...minimalDto, language: '' });
  assert.equal(s.language, 'Deutsch');
});

test('mapStation: deutsche Radio-Browser-Sender bevorzugen Deutsch vor Englisch', () => {
  assert.equal(mapStation({ ...minimalDto, name: '__80S__ by rautemusik', language: 'english,german' }).language, 'Deutsch');
  assert.equal(mapStation({ ...minimalDto, name: '90s90s HipHop & Rap', language: 'english' }).language, 'Deutsch');
  assert.equal(mapStation({ ...minimalDto, name: 'TOP 100 Club Charts', language: 'english,german' }).language, 'Deutsch');
});

test('localizeLanguageLabel: nicht-deutsche Sprachen werden fuer Filter lokalisiert', () => {
  assert.equal(localizeLanguageLabel('german', 'DE'), 'Deutsch');
  assert.equal(localizeLanguageLabel('english', 'US'), 'Englisch');
  assert.equal(localizeLanguageLabel('french', 'FR'), 'Französisch');
  assert.equal(localizeLanguageLabel('instrumental', 'FR'), 'Instrumental');
});

test('mapStation: countrycode wird uppercased', () => {
  const s = mapStation({ ...minimalDto, countrycode: 'at' });
  assert.equal(s.country, 'AT');
});

test('mapStation: fehlende optionale Felder ergeben leere Strings', () => {
  const s = mapStation({ stationuuid: 'x', name: 'X', url: 'https://x.de/' });
  assert.equal(s.iconUrl, '');
  assert.equal(s.website, '');
});

// ── stations.js – mergeStations ───────────────────────────────
const curatedA = { id: 'c1', name: 'Radio Eins', streamUrl: 'https://a.de/stream', genre: 'Pop', country: 'DE', language: 'German' };
const curatedB = { id: 'c2', name: 'Jazz FM',    streamUrl: 'https://b.de/stream', genre: 'Jazz', country: 'DE', language: 'German' };
const apiNew   = { id: 'a1', name: 'Rock Radio', streamUrl: 'https://c.de/stream', genre: 'Rock', country: 'DE', language: 'German' };
const apiDupName   = { id: 'a2', name: 'Radio Eins', streamUrl: 'https://other.de/stream', genre: 'Pop', country: 'DE', language: 'German' };
const apiDupStream = { id: 'a3', name: 'Anderer Name', streamUrl: 'https://a.de/stream', genre: 'Pop', country: 'DE', language: 'German' };

test('mergeStations: kuratierte Stationen kommen immer zuerst', () => {
  const result = mergeStations([curatedA, curatedB], [apiNew]);
  assert.equal(result[0].id, 'c1');
  assert.equal(result[1].id, 'c2');
  assert.equal(result[2].id, 'a1');
});

test('mergeStations: API-Duplikat per Name wird übersprungen', () => {
  const result = mergeStations([curatedA], [apiDupName, apiNew]);
  assert.ok(!result.find(s => s.id === 'a2'), 'Duplikat per Name darf nicht enthalten sein');
  assert.ok(result.find(s => s.id === 'a1'), 'neue Station muss enthalten sein');
});

test('mergeStations: API-Duplikat per Stream-URL wird übersprungen', () => {
  const result = mergeStations([curatedA], [apiDupStream]);
  assert.ok(!result.find(s => s.id === 'a3'), 'Duplikat per URL darf nicht enthalten sein');
});

test('mergeStations: API-Duplikat per Stream-URL ignoriert Protokoll und Query', () => {
  const curated = [{ ...curatedA, streamUrl: 'https://radio.example/live.mp3' }];
  const api = [{ ...apiNew, id: 'a4', streamUrl: 'http://radio.example/live.mp3?aggregator=web' }];
  const result = mergeStations(curated, api);
  assert.ok(!result.find(s => s.id === 'a4'), 'Duplikat per URL mit http/query darf nicht enthalten sein');
});

test('mergeStations: API-Duplikat per Radio-Browser-Namenszusatz wird übersprungen', () => {
  const curated = [{ ...curatedA, name: 'Deutschlandfunk' }];
  const api = [{ ...apiNew, id: 'a5', name: 'Deutschlandfunk | DLF | MP3 128k' }];
  const result = mergeStations(curated, api);
  assert.ok(!result.find(s => s.id === 'a5'), 'Radio-Browser-Namenszusatz darf kein Duplikat erzeugen');
});

test('mergeStations: regionale Namensvarianten bleiben erhalten', () => {
  const curated = [{ id: 'ndr-info', name: 'NDR Info', streamUrl: 'https://example.test/ndrinfo/niedersachsen.mp3', genre: 'News', country: 'DE', language: 'German' }];
  const api = [{ id: 'ndr-info-hamburg', name: 'NDR Info (Hamburg)', streamUrl: 'https://example.test/ndrinfo/hamburg.mp3', genre: 'News', country: 'DE', language: 'German' }];
  const result = mergeStations(curated, api);
  assert.ok(result.find(s => s.id === 'ndr-info-hamburg'), 'regionale Varianten dürfen nicht als Namensduplikat entfernt werden');
});

test('mergeStations: leere API-Liste gibt nur kuratierte zurück', () => {
  const result = mergeStations([curatedA, curatedB], []);
  assert.equal(result.length, 2);
});

test('mergeStations: leere kuratierte Liste gibt API-Stationen zurück', () => {
  const result = mergeStations([], [apiNew]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'a1');
});

test('mergeStations: Namensvergleich ist case-insensitiv und ignoriert Sonderzeichen', () => {
  const curated = [{ ...curatedA, name: 'Radio-Eins!' }];
  const api     = [{ ...apiDupName, name: 'radio eins' }];
  const result  = mergeStations(curated, api);
  assert.equal(result.length, 1, 'Duplikat mit anderem Casing/Sonderzeichen muss erkannt werden');
});

// ── stations.js – Cache-Roundtrip ─────────────────────────────
test('stations: Cache-Roundtrip schreibt und liest Stationen korrekt', async () => {
  // loadStations mit frischem Cache in stationsTmpDir — kein Netzwerkaufruf nötig
  const cacheFile = path.join(stationsTmpDir, 'stations-cache.json');
  const fakeStations = [
    { id: 'fake1', name: 'Fake FM', streamUrl: 'https://fake.fm/stream', genre: 'Pop', country: 'DE', language: 'German', iconUrl: '', website: '' },
  ];
  fs.writeFileSync(cacheFile, JSON.stringify({ timestamp: Date.now(), stations: fakeStations }), 'utf8');

  const { loadStations: loadFresh } = require('../src/stations.js');
  const result = await loadFresh();
  assert.ok(Array.isArray(result), 'loadStations muss ein Array zurückgeben');
  assert.ok(result.length >= fakeStations.length, 'Ergebnis muss mindestens die gecachten Stationen enthalten');
  assert.ok(result.find(s => s.id === 'fake1'), 'gecachte Station muss im Ergebnis sein');
});

test('stations: alte Cache-Genres werden vor Rueckgabe normalisiert', async () => {
  const cacheFile = path.join(stationsTmpDir, 'stations-cache.json');
  const staleStations = [
    { id: 'wdr4-cache', name: 'WDR4', streamUrl: 'https://wdr4.test/stream', genre: 'Radio', country: 'DE', language: 'German', iconUrl: '', website: '' },
    { id: 'swr1-cache', name: 'SWR1 BW', streamUrl: 'https://swr1.test/stream', genre: 'Radio', country: 'DE', language: 'German', iconUrl: '', website: '' },
    { id: 'berlin-cache', name: 'Berliner Rundfunk 91.4', streamUrl: 'https://berlin.test/stream', genre: 'Berlin', country: 'DE', language: 'German', iconUrl: '', website: '' },
    { id: 'b5-cache', name: 'B5 aktuell', streamUrl: 'https://b5.test/stream', genre: 'Ard', country: 'DE', language: 'German', iconUrl: '', website: '' },
    { id: 'mango-cache', name: 'MANGORADIO', streamUrl: 'https://mango.test/stream', genre: 'Music', country: 'DE', language: 'German', iconUrl: '', website: '' },
    { id: 'compound-cache', name: 'Compound Genre Test', streamUrl: 'https://compound.test/stream', genre: 'Wissen / pop', country: 'DE', language: 'German', iconUrl: '', website: '' },
    { id: 'cultural-cache', name: 'Cultural News Test', streamUrl: 'https://cultural.test/stream', genre: 'Cultural news', country: 'DE', language: 'German', iconUrl: '', website: '' },
  ];
  fs.writeFileSync(cacheFile, JSON.stringify({ timestamp: Date.now(), stations: staleStations }), 'utf8');

  delete require.cache[require.resolve('../src/stations.js')];
  Module._load = function (req, ...args) {
    if (req === 'electron') return { app: { getPath: () => stationsTmpDir, getVersion: () => pkg.version } };
    return _origLoad.call(this, req, ...args);
  };
  const { loadStations: loadFresh } = require('../src/stations.js');
  Module._load = _origLoad;
  const result = await loadFresh();

  assert.equal(result.find(s => s.id === 'wdr4-cache')?.genre, 'Oldies');
  assert.equal(result.find(s => s.id === 'swr1-cache')?.genre, 'Oldies');
  assert.equal(result.find(s => s.id === 'berlin-cache')?.genre, 'Pop');
  assert.equal(result.find(s => s.id === 'b5-cache')?.genre, 'Nachrichten');
  assert.equal(result.find(s => s.id === 'mango-cache')?.genre, 'Mix');
  assert.equal(result.find(s => s.id === 'compound-cache')?.genre, 'Wissen / Pop');
  assert.equal(result.find(s => s.id === 'cultural-cache')?.genre, 'Kultur / Nachrichten');
});

test('DEFAULT_STATIONS: Array mit mindestens 10 Einträgen', () => {
  assert.ok(Array.isArray(DEFAULT_STATIONS), 'DEFAULT_STATIONS muss ein Array sein');
  assert.ok(DEFAULT_STATIONS.length >= 10, `Zu wenige Default-Stationen: ${DEFAULT_STATIONS.length}`);
});

test('DEFAULT_STATIONS: alle Einträge haben Pflichtfelder', () => {
  for (const s of DEFAULT_STATIONS) {
    assert.ok(s.id,        `Station ohne id: ${s.name}`);
    assert.ok(s.name,      `Station ohne name: ${s.id}`);
    assert.ok(s.streamUrl, `Station ohne streamUrl: ${s.name}`);
    assert.ok(s.genre,     `Station ohne genre: ${s.name}`);
    assert.ok(s.country,   `Station ohne country: ${s.name}`);
    assert.ok(s.streamUrl.startsWith('https://'), `streamUrl nicht HTTPS: ${s.name}`);
    assert.ok(!s.iconUrl || s.iconUrl.startsWith('https://'), `iconUrl nicht HTTPS: ${s.name}`);
  }
});

test('Stations: High-Res-Icon-Overrides verwenden HTTPS', () => {
  assert.ok(!stations.includes("'http://"), 'High-Res-Icon-Overrides duerfen kein http:// verwenden');
});

test('DEFAULT_STATIONS: Sprachlabels sind deutsch lokalisiert', () => {
  assert.ok(DEFAULT_STATIONS.some(s => s.language === 'Deutsch'), 'Deutsch fehlt in Default-Stationen');
  assert.ok(!DEFAULT_STATIONS.some(s => s.language === 'German'), 'Default-Stationen duerfen nicht German anzeigen');
});

test('Stations: Maintenance-Validierung lehnt englische Sprachlabels ab', () => {
  const errors = validateStations([{
    id: 'test-radio',
    name: 'Test Radio',
    streamUrl: 'https://example.com/live.mp3',
    iconUrl: 'https://example.com/icon.png',
    genre: 'Pop',
    country: 'DE',
    language: 'German',
  }]);
  assert.ok(errors.some(error => error.includes('language should use localized label')), errors.join('\n'));
});

// ── visualizer.js – Smoke Tests ───────────────────────────────
const vizSrc = src('visualizer.js');

test('visualizer: VISUALIZER_MODES ist definiert und enthält mindestens 9 Modi', () => {
  const match = vizSrc.match(/VISUALIZER_MODES\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, 'VISUALIZER_MODES nicht gefunden');
  const modes = match[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.ok(modes.length >= 9, `Zu wenige Visualizer-Modi: ${modes.length}`);
});

test('visualizer: alle VISUALIZER_MODES haben ein VISUALIZER_LABELS-Eintrag', () => {
  const modesMatch = vizSrc.match(/VISUALIZER_MODES\s*=\s*\[([^\]]+)\]/);
  assert.ok(modesMatch, 'VISUALIZER_MODES nicht gefunden');
  const modes = modesMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  for (const mode of modes) {
    assert.ok(vizSrc.includes(`${mode}:`), `Kein VISUALIZER_LABELS-Eintrag für Modus '${mode}'`);
  }
});

test('visualizer: create-Funktion ist definiert', () => {
  assert.ok(vizSrc.includes('function create('), 'create() fehlt in visualizer.js');
});

test('visualizer: drawMiniSignal ist definiert', () => {
  assert.ok(vizSrc.includes('drawMiniSignal'), 'drawMiniSignal fehlt in visualizer.js');
});

test('visualizer: HiDPI-Support via devicePixelRatio', () => {
  assert.ok(vizSrc.includes('devicePixelRatio'), 'HiDPI-Support (devicePixelRatio) fehlt');
});

test('visualizer: UMD-Export kompatibel mit Node und Browser', () => {
  assert.ok(vizSrc.includes("window.WavelengthVisualizer"), 'Browser-Export fehlt');
  assert.ok(vizSrc.includes("typeof module !== 'undefined'") || vizSrc.includes('typeof module !=='), 'Node-Export-Guard fehlt');
});

// ── utils: getStationCategory ─────────────────────
const { getStationCategory, getLanguageLabel, filterStations, buildRecentsList } = require('../src/utils.js');

test('DEFAULT_STATIONS: kein kuratierter Sender landet unter Sonstige', () => {
  const uncategorized = DEFAULT_STATIONS
    .filter(station => getStationCategory(station.genre) === 'Sonstige')
    .map(station => `${station.name} (${station.genre})`);
  assert.deepEqual(uncategorized, []);
});

test('getStationCategory: Pop-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Pop'),    'Pop & Charts');
  assert.equal(getStationCategory('Top 40'), 'Pop & Charts');
  assert.equal(getStationCategory('Hits'),   'Pop & Charts');
  assert.equal(getStationCategory('Mix'),    'Pop & Charts');
});

test('getStationCategory: Jahrzehnte und Oldies werden erkannt', () => {
  assert.equal(getStationCategory('70s'),          'Oldies & Jahrzehnte');
  assert.equal(getStationCategory('1980s'),        'Oldies & Jahrzehnte');
  assert.equal(getStationCategory('90er'),         'Oldies & Jahrzehnte');
  assert.equal(getStationCategory('00er'),         'Oldies & Jahrzehnte');
  assert.equal(getStationCategory('Pop / Oldies'), 'Oldies & Jahrzehnte');
  assert.equal(getStationCategory('Retro'),        'Oldies & Jahrzehnte');
});

test('getStationCategory: Rock/Alternative-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Rock'),        'Rock & Metal');
  assert.equal(getStationCategory('Metal'),       'Rock & Metal');
  assert.equal(getStationCategory('Alternative'), 'Rock & Metal');
  assert.equal(getStationCategory('Indie'),       'Rock & Metal');
});

test('getStationCategory: Elektronik/Dance-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Electro'),    'Elektronik & Dance');
  assert.equal(getStationCategory('Electronic'), 'Elektronik & Dance');
  assert.equal(getStationCategory('Elektronik'), 'Elektronik & Dance');
  assert.equal(getStationCategory('Techno'),     'Elektronik & Dance');
  assert.equal(getStationCategory('Trance'),     'Elektronik & Dance');
  assert.equal(getStationCategory('House'),      'Elektronik & Dance');
  assert.equal(getStationCategory('Dance'),      'Elektronik & Dance');
});

test('getStationCategory: Ambient/Chillout-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Ambient'),           'Ambient/Chillout');
  assert.equal(getStationCategory('Chillout'),          'Ambient/Chillout');
  assert.equal(getStationCategory('Chillout / Lounge'), 'Ambient/Chillout');
  assert.equal(getStationCategory('Lofi'),              'Ambient/Chillout');
  assert.equal(getStationCategory('Instrumental'),      'Ambient/Chillout');
  assert.equal(getStationCategory('Easy Listening'),    'Ambient/Chillout');
  assert.equal(getStationCategory('Leichte Musik'),     'Ambient/Chillout');
});

test('getStationCategory: Hip-Hop/R&B-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Hiphop'),   'Hip-Hop & R&B');
  assert.equal(getStationCategory('Hip Hop'),  'Hip-Hop & R&B');
  assert.equal(getStationCategory('Hip-Hop'),  'Hip-Hop & R&B');
  assert.equal(getStationCategory('Rap'),      'Hip-Hop & R&B');
  assert.equal(getStationCategory('R&B'),      'Hip-Hop & R&B');
  assert.equal(getStationCategory('Hip-Hop / Pop'), 'Hip-Hop & R&B');
});

test('getStationCategory: Klassik-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Classic'),   'Klassik & Jazz');
  assert.equal(getStationCategory('Classical'), 'Klassik & Jazz');
  assert.equal(getStationCategory('Opera'),     'Klassik & Jazz');
  assert.equal(getStationCategory('Symphony'),  'Klassik & Jazz');
});

test('getStationCategory: Wissen/Kultur-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Wissen'),       'Wissen & Kultur');
  assert.equal(getStationCategory('Culture'),      'Wissen & Kultur');
  assert.equal(getStationCategory('Wissen / Pop'), 'Wissen & Kultur');
});

test('getStationCategory: Nachrichten/Talk-Genres werden erkannt', () => {
  assert.equal(getStationCategory('News'),        'Nachrichten & Talk');
  assert.equal(getStationCategory('Information'), 'Nachrichten & Talk');
  assert.equal(getStationCategory('Public radio'), 'Nachrichten & Talk');
  assert.equal(getStationCategory('Talk'),        'Nachrichten & Talk');
  assert.equal(getStationCategory('Nachrichten'), 'Nachrichten & Talk');
});

test('getStationCategory: Schlager/Weltmusik-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Schlager'),  'Schlager & Weltmusik');
  assert.equal(getStationCategory('Country'),   'Schlager & Weltmusik');
  assert.equal(getStationCategory('Global'),    'Schlager & Weltmusik');
  assert.equal(getStationCategory('Weltmusik'), 'Schlager & Weltmusik');
  assert.equal(getStationCategory('World'),     'Schlager & Weltmusik');
  assert.notEqual(getStationCategory('Oldies'), 'Schlager & Weltmusik');
});

test('getStationCategory: Fallback auf Sonstige', () => {
  assert.equal(getStationCategory(null),    'Sonstige');
  assert.equal(getStationCategory(''),      'Sonstige');
  assert.equal(getStationCategory('Polka'), 'Sonstige');
});

test('getLanguageLabel: Filter-Sprachen werden eingedeutscht', () => {
  assert.equal(getLanguageLabel('German'), 'Deutsch');
  assert.equal(getLanguageLabel('de'), 'Deutsch');
  assert.equal(getLanguageLabel('English'), 'Englisch');
  assert.equal(getLanguageLabel('fr'), 'Französisch');
});

// ── utils: filterStations ─────────────────────────
const STATIONS = [
  { id: 'a', name: 'Radio Pop',  genre: 'Pop',  language: 'de', country: 'Germany' },
  { id: 'b', name: 'Rock FM',    genre: 'Rock', language: 'de', country: 'Germany' },
  { id: 'c', name: 'Jazz Cafe',  genre: 'Jazz', language: 'en', country: 'USA'     },
  { id: 'd', name: 'NRJ',        genre: 'Pop',  language: 'fr', country: 'France'  },
];

test('filterStations: ohne Filter alle zurück', () => {
  assert.equal(filterStations(STATIONS).length, 4);
});

test('filterStations: Genre-Filter', () => {
  const r = filterStations(STATIONS, { genre: 'Pop & Charts' });
  assert.equal(r.length, 2);
  assert.ok(r.every(s => s.genre === 'Pop'));
});

test('filterStations: Sprach-Filter', () => {
  const r = filterStations(STATIONS, { lang: 'Deutsch' });
  assert.equal(r.length, 2);
  assert.ok(r.every(s => getLanguageLabel(s.language) === 'Deutsch'));
});

test('filterStations: Textsuche nach Name', () => {
  const r = filterStations(STATIONS, { search: 'jazz' });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'c');
});

test('filterStations: Textsuche nach Country', () => {
  const r = filterStations(STATIONS, { search: 'france' });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'd');
});

test('filterStations: Favoriten-Filter', () => {
  const r = filterStations(STATIONS, { favorites: ['b', 'c'], favFilterActive: true });
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(s => s.id), ['b', 'c']);
});

test('filterStations: Genre + Sprache kombiniert', () => {
  const r = filterStations(STATIONS, { genre: 'Pop & Charts', lang: 'Französisch' });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'd');
});

test('filterStations: Bitrate-Filter schließt niedrige Bitraten aus', () => {
  const withBitrate = [
    { id: 'a', name: 'HQ', genre: 'Pop', language: 'de', country: 'DE', bitrate: 320 },
    { id: 'b', name: 'MQ', genre: 'Pop', language: 'de', country: 'DE', bitrate: 128 },
    { id: 'c', name: 'LQ', genre: 'Pop', language: 'de', country: 'DE', bitrate: 48  },
  ];
  const r = filterStations(withBitrate, { minBitrate: 128 });
  assert.equal(r.length, 2);
  assert.ok(r.every(s => s.bitrate >= 128));
});

test('filterStations: Bitrate-Filter ignoriert Custom-Stationen', () => {
  const withCustom = [
    { id: 'x', name: 'Eigen', genre: 'Eigene', language: 'de', country: 'DE', isCustom: true },
    { id: 'y', name: 'LQ',    genre: 'Pop',    language: 'de', country: 'DE', bitrate: 32   },
  ];
  const r = filterStations(withCustom, { minBitrate: 128 });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'x');
});

test('Renderer: Sprachfilter zeigt lokalisierte Labels', () => {
  assert.ok(renderer.includes('getLanguageLabel'), 'Renderer nutzt keine lokalisierten Sprachlabels');
  assert.ok(renderer.includes("appendOption(langSelect, '', 'Alle Sprachen')"), 'Default-Sprachfilter fehlt');
  assert.ok(renderer.includes('getLanguageLabel(s.language)'), 'Sprachfilter-Optionen werden nicht lokalisiert');
});

test('Renderer: Genre-Filter enthaelt Oldies & Jahrzehnte und Ambient/Chillout', () => {
  assert.ok(renderer.includes("'Oldies & Jahrzehnte'"), 'Oldies/Jahrzehnte-Kategorie fehlt im Genre-Filter');
  assert.ok(renderer.includes("'Ambient/Chillout'"), 'Ambient/Chillout-Kategorie fehlt im Genre-Filter');
  assert.ok(renderer.includes("'Sonstige'"), 'Sonstige-Kategorie fehlt im Genre-Filter');
  assert.ok(!renderer.includes("'Sonstige / Ambient'"), 'Alter Sonstige/Ambient-Mix darf nicht mehr im Genre-Filter stehen');
});

// ── utils: buildRecentsList ───────────────────────
test('buildRecentsList: neuer Eintrag kommt zuerst', () => {
  assert.deepEqual(buildRecentsList(['b', 'c'], 'a'), ['a', 'b', 'c']);
});

test('buildRecentsList: verschiebt vorhandenen Eintrag nach vorne', () => {
  assert.deepEqual(buildRecentsList(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
});

test('buildRecentsList: begrenzt auf max 5', () => {
  const result = buildRecentsList(['b', 'c', 'd', 'e', 'f'], 'a');
  assert.equal(result.length, 5);
  assert.equal(result[0], 'a');
});

test('buildRecentsList: leere Liste', () => {
  assert.deepEqual(buildRecentsList([], 'x'), ['x']);
});
