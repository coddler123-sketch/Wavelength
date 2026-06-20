const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');

const { formatListen, averageLevel, trayState, fakeBar } = require('../src/utils.js');
const { validateStations } = require('./validate-stations.js');

const src  = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const main    = src('main.js');
const preload = src('preload.js');
const stations = src('stations.js');
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
  const channels = [...preload.matchAll(/ipcRenderer\.on\(['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(channels.length > 0, 'keine on-Kanäle in preload gefunden');
  for (const ch of channels) {
    assert.ok(
      main.includes(`'${ch}'`) || main.includes(`"${ch}"`),
      `main.js sendet Kanal '${ch}' nie`
    );
  }
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

test('Main: Tray-Updates ignorieren bereits zerstoerte Objekte', () => {
  assert.ok(main.includes('if (!tray || tray.isDestroyed()) return;'), 'updateTrayMenu muss zerstoerten Tray ignorieren');
  assert.ok(main.includes("mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? 'Ausblenden' : 'Anzeigen'"), 'Tray-Menue darf isVisible nicht auf zerstoertem Fenster aufrufen');
  assert.ok(main.includes("if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();"), 'hide-window IPC braucht Window-Guard');
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

test('Signing: signierter Build hat Guard-Script und Dokumentation', () => {
  assert.ok(pkg.scripts['signing:check'], 'signing:check Script fehlt');
  assert.ok(pkg.scripts['build:signed'] && pkg.scripts['build:signed'].includes('signing:check'), 'build:signed muss signing:check ausfuehren');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'SIGNING.md')), 'SIGNING.md fehlt');
  assert.ok(fs.existsSync(path.join(__dirname, 'check-signing.js')), 'check-signing.js fehlt');
});

test('Window: Hauptfenster bleibt feste 400x400 UI', () => {
  assert.ok(main.includes('full: { width: 400, height: 400 }'), 'Full-View-Größe muss fest definiert sein');
  assert.ok(main.includes('resizable: false'), 'BrowserWindow sollte nicht frei skalierbar sein');
  assert.ok(main.includes('maxWidth: startSize.width, maxHeight: startSize.height'), 'Fenster-Maximalgröße fehlt');
  assert.ok(main.includes('fullWidth = SIZES.full.width'), 'gespeicherte Breite darf die feste UI nicht überschreiben');
  assert.ok(!main.includes('mainWindow.getSize()'), 'Resize-Events dürfen keine freie Full-View-Größe persistieren');
});

test('Stations: NDR 2 verwendet keine bekannten toten URLs', () => {
  assert.ok(!stations.includes('ndr-ndr2-niedersachsen.icecast.ndr.de'), 'NDR 2 stream host no longer resolves');
  assert.ok(!stations.includes('NDR_2_logo_2015.png'), 'NDR 2 icon URL returns 404');
});

test('Stations: loadStations fällt bei API-Fehlern auf DEFAULT_STATIONS zurück', () => {
  assert.ok(stations.includes('stations.json'), 'DEFAULT_STATIONS werden nicht aus stations.json geladen');
  assert.ok(stations.includes('catch (err)') && stations.includes('Failed to fetch stations from Radio Browser'), 'API-Fehler werden nicht abgefangen');
  assert.ok(stations.includes('mergeStations(DEFAULT_STATIONS, apiStations)'), 'DEFAULT_STATIONS werden nicht mit API/Cache gemerged');
  assert.ok(stations.includes('return merged.map(enrichStationIcon)'), 'Stationen werden vor Rückgabe normalisiert');
});

test('Stations: kuratierte Defaults bestehen die Maintenance-Validierung', () => {
  const stationsJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'stations.json'), 'utf8'));
  assert.deepEqual(validateStations(stationsJson), []);
  assert.ok(pkg.scripts['stations:check'], 'stations:check Script fehlt');
});

test('Renderer: selectStation persistiert Auswahl, synchronisiert main und startet gestoppten Player', () => {
  const match = renderer.match(/function selectStation\(station\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'selectStation nicht gefunden');
  const body = match[1];
  assert.ok(body.includes("localStorage.setItem('wl.lastStationId', station.id)"), 'letzte Station wird nicht persistiert');
  assert.ok(body.includes('api.selectStation(station)'), 'main process wird nicht synchronisiert');
  assert.ok(body.includes('if (wasPlaying)') && body.includes('stopPlay();') && body.includes('startPlay();'), 'laufender Stream wird beim Stationswechsel nicht neu gestartet');
  assert.ok(body.includes('api.playPause(true)'), 'gestoppter Player startet bei Stationsauswahl nicht');
});

test('Main: get-stations-Fallback referenziert importierte DEFAULT_STATIONS', () => {
  assert.ok(main.includes("const { loadStations, DEFAULT_STATIONS } = require('./stations.js')"), 'DEFAULT_STATIONS wird in main.js nicht importiert');
  assert.ok(main.includes('return DEFAULT_STATIONS'), 'get-stations-Fallback gibt DEFAULT_STATIONS nicht zurueck');
});

test('Renderer: externe Stationsdaten werden vor Template-Rendering escaped', () => {
  assert.ok(renderer.includes('function escapeHtml'), 'escapeHtml fehlt');
  assert.ok(renderer.includes('function safeHttpUrl'), 'safeHttpUrl fehlt');
  assert.ok(renderer.includes('const stationName = escapeHtml(station.name)'), 'Stationsname wird nicht escaped');
  assert.ok(renderer.includes('const stationGenre = escapeHtml(station.genre'), 'Genre wird nicht escaped');
  assert.ok(renderer.includes('const stationCountry = escapeHtml(station.country'), 'Country wird nicht escaped');
  assert.ok(renderer.includes('const stationId = escapeHtml(station.id)'), 'Station-ID wird nicht escaped');
  assert.ok(renderer.includes('const iconUrl = safeHttpUrl(station.iconUrl)'), 'Icon-URL wird nicht validiert');
  assert.ok(!renderer.includes('${station.name}</span>'), 'Stationsname darf nicht roh in innerHTML interpoliert werden');
  assert.ok(!renderer.includes('src="${station.iconUrl}"'), 'Icon-URL darf nicht roh in innerHTML interpoliert werden');
});

test('Renderer: reconnect meldet reconnecting und setzt bei Erfolg wieder live/stopped', () => {
  assert.ok(renderer.includes('function scheduleReconnect()'), 'scheduleReconnect fehlt');
  assert.ok(renderer.includes('if (state.reconnectTimer || !state.playing) return;'), 'Reconnect darf nicht laufen, wenn der Player gestoppt ist');
  assert.ok(renderer.includes('setReconnecting(true)'), 'Reconnect-State wird nicht gesetzt');
  assert.ok(renderer.includes('state.reconnectAttempt++'), 'Reconnect-Versuche werden nicht hochgezählt');
  assert.ok(renderer.includes("if (state.playing) reportConnectionState(state.muted ? 'muted' : 'live')"), 'Live-State wird nach Erfolg nicht gemeldet');
  assert.ok(renderer.includes("reportConnectionState('stopped')"), 'Stopped-State wird beim Stop nicht gemeldet');
});

test('Renderer: Sender-Normalisierung nutzt stationGain zwischen analyser und limiter', () => {
  assert.ok(renderer.includes('function stationGainKey(id)'), 'stationGainKey fehlt');
  assert.ok(renderer.includes('const STATION_GAIN_MIN_DB = -9'), 'untere dB-Grenze fehlt');
  assert.ok(renderer.includes('const STATION_GAIN_MAX_DB = 9'), 'obere dB-Grenze fehlt');
  assert.ok(renderer.includes('state.stationGain = state.audioCtx.createGain()'), 'GainNode wird nicht erstellt');
  assert.ok(renderer.includes('state.analyser.connect(state.stationGain)'), 'stationGain hängt nicht nach dem analyser');
  assert.ok(renderer.includes('state.stationGain.connect(limiter)'), 'stationGain hängt nicht vor dem limiter');
  assert.ok(renderer.includes('Math.pow(10, db / 20)'), 'dB werden nicht in linearen Gain konvertiert');
});

test('Renderer: Sender-Trim ist pro Station bedienbar und persistiert', () => {
  const html = src('index.html');
  assert.ok(html.includes('id="station-gain-pill"'), 'Trim-Pill fehlt');
  assert.ok(!html.includes('id="btn-station-gain-down"'), 'leiser Button sollte nicht permanent sichtbar sein');
  assert.ok(!html.includes('id="btn-station-gain-up"'), 'lauter Button sollte nicht permanent sichtbar sein');
  assert.ok(renderer.includes("localStorage.setItem(stationGainKey(state.activeStation.id), String(next))"), 'Trim wird nicht persistiert');
  assert.ok(renderer.includes("localStorage.removeItem(stationGainKey(state.activeStation.id))"), '0 dB Trim wird nicht zurückgesetzt');
  assert.ok(renderer.includes('function resetStationGain()'), 'Reset-Funktion fehlt');
  assert.ok(renderer.includes("safeAddListener('station-gain-pill', 'click', resetStationGain)"), 'Trim-Pill ist nicht verdrahtet');
  assert.ok(!renderer.includes("case 'BracketLeft'"), 'Klammer-Shortcut sollte nicht verwendet werden');
  assert.ok(!renderer.includes("case 'BracketRight'"), 'Klammer-Shortcut sollte nicht verwendet werden');
  assert.ok(renderer.includes("case 'ArrowUp'") && renderer.includes("case 'ArrowDown'"), 'Pfeiltasten-Handling fehlt');
  assert.ok(renderer.includes('if (e.altKey) adjustStationGain(STATION_GAIN_STEP_DB)'), 'Alt+Pfeil hoch für Sender lauter fehlt');
  assert.ok(renderer.includes('if (e.altKey) adjustStationGain(-STATION_GAIN_STEP_DB)'), 'Alt+Pfeil runter für Sender leiser fehlt');
});

test('UI: Status-Badges bleiben einzeilig', () => {
  const html = src('index.html');
  assert.ok(/\.listen-badge\s*\{[\s\S]*?white-space:\s*nowrap/.test(html), 'Listen-Badge darf nicht umbrechen');
  assert.ok(/\.live-badge\s*\{[\s\S]*?white-space:\s*nowrap/.test(html), 'Live-Badge darf nicht umbrechen');
  assert.ok(/\.sleep-badge\s*\{[\s\S]*?white-space:\s*nowrap/.test(html), 'Sleep-Badge darf nicht umbrechen');
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
test('RECONNECT_DELAYS: exponentieller Backoff, endet bei 30s', () => {
  const match = renderer.match(/RECONNECT_DELAYS\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, 'RECONNECT_DELAYS nicht gefunden');
  const delays = match[1].split(',').map(s => parseInt(s.trim(), 10));
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
  if (req === 'electron') return { app: { getPath: () => stationsTmpDir } };
  return _origLoad.call(this, req, ...args);
};
const { mapStation, mergeStations, DEFAULT_STATIONS } = require('../src/stations.js');
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

test('mapStation: Genre aus erstem Tag, kapitalisiert', () => {
  const s = mapStation({ ...minimalDto, tags: 'rock,classic' });
  assert.equal(s.genre, 'Rock');
});

test('mapStation: Genre-Fallback auf "Radio" wenn tags leer', () => {
  const s = mapStation({ ...minimalDto, tags: '' });
  assert.equal(s.genre, 'Radio');
});

test('mapStation: ignoriert Tags die länger als 19 Zeichen sind', () => {
  const s = mapStation({ ...minimalDto, tags: 'diesertagistlaengeral20zeichen,pop' });
  assert.equal(s.genre, 'Pop');
});

test('mapStation: language kapitalisiert', () => {
  const s = mapStation({ ...minimalDto, language: 'english' });
  assert.equal(s.language, 'English');
});

test('mapStation: language-Fallback auf "German" wenn leer', () => {
  const s = mapStation({ ...minimalDto, language: '' });
  assert.equal(s.language, 'German');
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
  }
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
const { getStationCategory, filterStations, buildRecentsList } = require('../src/utils.js');

test('getStationCategory: Pop-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Pop'),    'Pop & Charts');
  assert.equal(getStationCategory('Top 40'), 'Pop & Charts');
  assert.equal(getStationCategory('Hits'),   'Pop & Charts');
});

test('getStationCategory: Rock/Alternative-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Rock'),        'Rock & Metal');
  assert.equal(getStationCategory('Metal'),       'Rock & Metal');
  assert.equal(getStationCategory('Alternative'), 'Rock & Metal');
  assert.equal(getStationCategory('Indie'),       'Rock & Metal');
});

test('getStationCategory: Electronic/Dance-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Electronic'), 'Electronic & Dance');
  assert.equal(getStationCategory('Techno'),     'Electronic & Dance');
  assert.equal(getStationCategory('House'),      'Electronic & Dance');
  assert.equal(getStationCategory('Dance'),      'Electronic & Dance');
});

test('getStationCategory: Hip-Hop/R&B-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Hip Hop'),  'Hip-Hop & R&B');
  assert.equal(getStationCategory('Hip-Hop'),  'Hip-Hop & R&B');
  assert.equal(getStationCategory('Rap'),      'Hip-Hop & R&B');
  assert.equal(getStationCategory('R&B'),      'Hip-Hop & R&B');
});

test('getStationCategory: Klassik-Genres werden erkannt', () => {
  assert.equal(getStationCategory('Classical'), 'Klassik & Jazz');
  assert.equal(getStationCategory('Opera'),     'Klassik & Jazz');
  assert.equal(getStationCategory('Symphony'),  'Klassik & Jazz');
});

test('getStationCategory: Nachrichten/Talk-Genres werden erkannt', () => {
  assert.equal(getStationCategory('News'),        'News & Talk');
  assert.equal(getStationCategory('Talk'),        'News & Talk');
  assert.equal(getStationCategory('Nachrichten'), 'News & Talk');
});

test('getStationCategory: Fallback auf Sonstige', () => {
  assert.equal(getStationCategory(null),      'Sonstige / Ambient');
  assert.equal(getStationCategory(''),        'Sonstige / Ambient');
  assert.equal(getStationCategory('Polka'),   'Sonstige / Ambient');
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
  const r = filterStations(STATIONS, { lang: 'de' });
  assert.equal(r.length, 2);
  assert.ok(r.every(s => s.language === 'de'));
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
  const r = filterStations(STATIONS, { genre: 'Pop & Charts', lang: 'fr' });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'd');
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
