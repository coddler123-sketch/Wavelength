# Wavelength – TODO

Multi-Station Radio Player für Windows. Electron Tray-Only App, ähnlich Zucca Radio, aber für beliebig viele Stationen.

---

## Entschiedene Eckdaten

| Parameter | Wert |
|---|---|
| App-Name | Wavelength |
| Fenster (Full) | 400 × 400 px |
| Fenster (Mini) | ~290 × 82 px |
| Platform | Windows x64 |
| DB-Host | Firebase Realtime DB |
| Cache Stale | 12 Stunden |
| Station Picker | Variante B – scrollbare Liste mit Icons + Genre/Country-Tags |
| Sleep Timer | Global (nicht per Station) |
| Listening Time | Pro Station getrennt |
| Visualizer | 9 Modi (wie Zucca) |
| Bass Boost | Ja |
| Media Session | Ja (SMTC) |

---

## Phase 1 – Projektgerüst

- [ ] `npm init` + Electron + electron-builder einrichten
- [ ] `package.json` mit App-ID `com.wavelength.player`, Produktname `Wavelength`
- [ ] Ordnerstruktur anlegen: `src/`, `assets/`, `scripts/`
- [ ] `src/main.js` – BrowserWindow (400×400), Tray, Single-Instance, App-Lifecycle
- [ ] `src/preload.js` – leere `electronAPI`-Bridge
- [ ] `src/index.html` + `src/renderer.js` – leere Grundstruktur
- [ ] `src/utils.js` – UMD-Pattern (wie Zucca), `formatListen`, `averageLevel`, `trayState`
- [ ] `src/window-state.js` von Zucca übernehmen (unverändert)
- [ ] `scripts/smoke-check.js` + `scripts/test.js` anlegen (von Zucca adaptieren)
- [ ] `npm start` liefert ein leeres Fenster ✓

## Phase 2 – Station-Management

- [ ] `src/stations.js` – Firebase Realtime DB lesen, LocalStorage-Cache (12h Stale)
  - Datenstruktur je Station: `{ id, name, streamUrl, iconUrl, genre, country, website }`
  - `loadStations()` – Cache prüfen, ggf. Firebase fetch, zurückgeben
  - `getCached()` / `setCache()` – LocalStorage mit Timestamp
- [ ] Firebase-Config als `src/firebase-config.js` (gitignored oder via env)
- [ ] IPC: `get-stations` (renderer → main → Firebase/Cache)
- [ ] Station Picker UI (Variante B):
  - Scrollbare Liste, jede Zeile: Icon + Name + Genre-Tag + Country-Tag
  - Suchfeld zum Filtern
  - Aktive Station visuell hervorgehoben
  - Auswahl triggert `select-station` IPC

## Phase 3 – Playback & Core Features

- [ ] `<audio>`-Element in renderer, Stream-URL dynamisch aus gewählter Station
- [ ] Play/Pause/Stop wie Zucca (`btn-playstop`, SVG-Morph)
- [ ] Auto-Reconnect mit Exponential Backoff (1/2/4/8/16/30s)
- [ ] Tray-Icon Zustände (playing/stopped/reconnecting/muted) – PNG via Canvas wie Zucca
- [ ] Volume + Mute (Slider + Knopf), gespeichert in LocalStorage
- [ ] Keyboard Shortcuts: Space, M, ↑↓
- [ ] Scroll-Wheel Volume
- [ ] Windows Media Session (SMTC) – Stationsname als Titel
- [ ] Tray-Tooltip mit Stationsname + Status
- [ ] Bass Boost (BiquadFilterNode, 0/6/12 dB, `B`-Taste)

## Phase 4 – Erweiterte Features

- [ ] **Listening Time pro Station** – LocalStorage, Today + Total, `#listen-badge`
  - Day-Rollover auf lokalem Datum
  - Tooltip auf Badge zeigt Total
- [ ] **Sleep Timer** – global, Tray-Submenu (15/30/60/90 min) + `#btn-sleep` Toggle (30 min)
  - `#sleep-badge` mit Countdown-Minuten
  - Toast bei Änderung
- [ ] **Mini-Modus** – rechter Fensterrand bleibt fixiert, `dockMini`/Snap
- [ ] **Pin** (always-on-top)
- [ ] **Autostart** mit `--hidden` Flag + Fade-In (4s Delay, 400ms Opacity)
- [ ] **Tray-Menü**: Station wechseln (Top-5 oder alle), Lautstärke, Sleep, Reset, Beenden
- [ ] **Reset**: Fensterposition / Settings
- [ ] **First-Run-Hint** (Windows-Notification)
- [ ] **About-Dialog**: Version, aktuelle Station, Website
- [ ] **Support-Log** nach `%APPDATA%\wavelength\logs\app.log`

## Phase 5 – Visualizer & Feinschliff

- [ ] `src/visualizer.js` von Zucca übernehmen und anpassen (400px-Breite)
- [ ] 9 Modi: bars, mirror, oscilloscope, waterfall, wave, dna, particles, tunnel, scanner
- [ ] Mini-Visualizer (`#mini-visualizer`, 10 Bars)
- [ ] HiDPI-Support (`devicePixelRatio`)
- [ ] Toasts (`#viz-toast`) für Modus-Wechsel, Bass, Sleep
- [ ] IPC-Contract-Test anpassen
- [ ] Smoke-Checks aktualisieren
- [ ] `npm run build` → NSIS-Installer ✓
- [ ] Branding / Icon erstellen (Name: Wavelength, Wellen-Motiv?)
- [ ] Code Signing (optional, env-Vars wie Zucca)

---

## Offene Fragen

- [ ] Firebase-Projekt-URL und Config? (benötigt für Phase 2)
- [ ] Erste Stationsliste – wer pflegt sie? Direkt in Firebase manuell eintragen?
- [ ] Branding: Farben, Logo-Ideen?
- [ ] Fenster-Style: Übernehmen von Zucca (dunkel, orange Akzent) oder neues Farbschema?
