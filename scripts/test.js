const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');

const { formatListen, averageLevel, trayState, fakeBar } = require('../src/utils.js');

const src  = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const main    = src('main.js');
const preload = src('preload.js');
const stations = src('stations.js');
const renderer = src('renderer.js');

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

test('Stations: feste Firebase-Konfiguration ist nicht mehr Teil des Runtime-Quelltexts', () => {
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'firebase-config.js')));
  assert.ok(!stations.includes('firebase-config'));
  assert.ok(!stations.includes('databaseURL'));
});

test('Stations: loadStations fällt bei API-Fehlern auf DEFAULT_STATIONS zurück', () => {
  assert.ok(stations.includes('const DEFAULT_STATIONS = ['), 'DEFAULT_STATIONS fehlen');
  assert.ok(stations.includes('catch (err)') && stations.includes('Failed to fetch stations from Radio Browser'), 'API-Fehler werden nicht abgefangen');
  assert.ok(stations.includes('mergeStations(DEFAULT_STATIONS, apiStations)'), 'DEFAULT_STATIONS werden nicht mit API/Cache gemerged');
  assert.ok(stations.includes('return merged.map(enrichStationIcon)'), 'Stationen werden vor Rückgabe normalisiert');
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

test('Renderer: reconnect meldet reconnecting und setzt bei Erfolg wieder live/stopped', () => {
  assert.ok(renderer.includes('function scheduleReconnect()'), 'scheduleReconnect fehlt');
  assert.ok(renderer.includes('if (reconnectTimer || !playing) return;'), 'Reconnect darf nicht laufen, wenn der Player gestoppt ist');
  assert.ok(renderer.includes('setReconnecting(true)'), 'Reconnect-State wird nicht gesetzt');
  assert.ok(renderer.includes('reconnectAttempt++'), 'Reconnect-Versuche werden nicht hochgezählt');
  assert.ok(renderer.includes("if (playing) reportConnectionState(muted ? 'muted' : 'live')"), 'Live-State wird nach Erfolg nicht gemeldet');
  assert.ok(renderer.includes("reportConnectionState('stopped')"), 'Stopped-State wird beim Stop nicht gemeldet');
});

test('Renderer: Sender-Normalisierung nutzt stationGain zwischen analyser und limiter', () => {
  assert.ok(renderer.includes('function stationGainKey(id)'), 'stationGainKey fehlt');
  assert.ok(renderer.includes('const STATION_GAIN_MIN_DB = -9'), 'untere dB-Grenze fehlt');
  assert.ok(renderer.includes('const STATION_GAIN_MAX_DB = 9'), 'obere dB-Grenze fehlt');
  assert.ok(renderer.includes('stationGain = audioCtx.createGain()'), 'GainNode wird nicht erstellt');
  assert.ok(renderer.includes('analyser.connect(stationGain)'), 'stationGain hängt nicht nach dem analyser');
  assert.ok(renderer.includes('stationGain.connect(limiter)'), 'stationGain hängt nicht vor dem limiter');
  assert.ok(renderer.includes('Math.pow(10, db / 20)'), 'dB werden nicht in linearen Gain konvertiert');
});

test('Renderer: Sender-Trim ist pro Station bedienbar und persistiert', () => {
  const html = src('index.html');
  assert.ok(html.includes('id="station-gain-pill"'), 'Trim-Pill fehlt');
  assert.ok(!html.includes('id="btn-station-gain-down"'), 'leiser Button sollte nicht permanent sichtbar sein');
  assert.ok(!html.includes('id="btn-station-gain-up"'), 'lauter Button sollte nicht permanent sichtbar sein');
  assert.ok(renderer.includes("localStorage.setItem(stationGainKey(activeStation.id), String(next))"), 'Trim wird nicht persistiert');
  assert.ok(renderer.includes("localStorage.removeItem(stationGainKey(activeStation.id))"), '0 dB Trim wird nicht zurückgesetzt');
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
