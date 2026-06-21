# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Wavelength** is a Windows Electron tray-only radio player supporting multiple customizable stations. Similar architecture to Zucca Radio but designed for multiple stations from curated local defaults plus Radio Browser integration. The app runs minimally in the system tray with a 460×480 main UI, compact mini mode, and expandable visualizer.

**Key characteristics:**
- Single-instance Electron app with system tray integration
- IPC-based main/renderer communication with strict contracts
- Main player window (460×480px) with compact mini mode that can minimize to tray
- Audio visualization with 9 modes
- Station management via curated local defaults, Radio Browser loading, and disk cache
- Windows-only NSIS installer build

## Development Workflow

### Essential Commands

```bash
# Start development
npm start

# Run all tests (smoke-check + unit tests)
npm test

# Run only smoke check (quick file validation)
npm run smoke

# Build Windows NSIS installer
npm run build

# Clean and rebuild
npm run build:clean
```

### Running Single Tests

Tests use Node's built-in `test` module. To run a specific test file or pattern:

```bash
node --test scripts/test.js
node --test scripts/test.js 2>&1 | grep "trayState"  # Filter by name
```

Tests verify:
- **Utility functions** (formatListen, averageLevel, trayState, fakeBar) with comprehensive edge cases
- **IPC contract** between preload and main process (send/on/invoke channels must be symmetrical)
- **File integrity** (smoke-check validates required functions/exports exist)

## Architecture

### Process Model: Main + Renderer

**Main Process** (`src/main.js`):
- Window/tray lifecycle management
- Single-instance enforcement
- IPC handlers for all renderer requests
- Audio connection state + metadata
- Tray icon state management (playing/stopped/reconnecting/muted)
- Keyboard shortcuts and media session (SMTC)

**Renderer Process** (`src/renderer.js` + `src/index.html`):
- UI rendering and DOM updates
- HTML5 `<audio>` element for playback
- Volume/mute controls
- Station list interaction
- Toast notifications

**Preload Bridge** (`src/preload.js`):
- Exposes `window.electronAPI` — strict interface between main and renderer
- Uses `ipcRenderer.send()`, `ipcRenderer.on()`, `ipcRenderer.invoke()`
- No direct Node.js API access from renderer

### Key Modules

| File | Purpose |
|------|---------|
| `src/main.js` | App lifecycle, window, tray, IPC handlers, connection state |
| `src/preload.js` | Secure IPC bridge to renderer (`electronAPI` API) |
| `src/renderer.js` | UI logic, DOM updates, audio element control |
| `src/index.html` | UI markup (status, volume, station picker, visualizer canvas) |
| `src/stations.js` | Curated stations + Radio Browser loading with disk cache |
| `src/utils.js` | Shared UMD utilities (formatListen, averageLevel, trayState, fakeBar) |
| `src/visualizer.js` | Canvas-based audio visualization (9 modes: bars, mirror, oscilloscope, waterfall, wave, dna, particles, tunnel, scanner) |
| `src/window-state.js` | Window position/size persistence (localStorage) |

### IPC Contract Pattern

Every IPC channel is tested bidirectionally:
- **send** (renderer → main): renderer sends, main receives with `ipcMain.on()`
- **invoke** (renderer ↔ main async): renderer invokes, main handles with `ipcMain.handle()`
- **on** (main → renderer): main emits, renderer listens with `ipcRenderer.on()`

The test suite (`scripts/test.js`) enforces: every `ipcRenderer.send/on/invoke()` in preload must have a corresponding `ipcMain.on/handle` in main, and vice versa. Mismatches fail the build.

### State Flow

```
user clicks station → renderer emits IPC 'select-station'
  ↓
main.js receives, validates station, connects to stream URL
  ↓
main.js emits 'connection-state' (connecting → live/stopped/error)
  ↓
renderer receives state, updates UI (status, metadata, tray icon image)
  ↓
renderer controls <audio> play/pause/volume
```

## Testing Strategy

### 1. **Unit Tests** (`scripts/test.js`)
- Util function correctness (formatListen: 59min vs 1h formatting, trayState priority logic)
- fakeBar algorithm (ensures values stay [0,1], varies over time for fake audio)
- IPC channel symmetry (strict bidirectional contract verification)

Run: `npm test`

### 2. **Smoke Check** (`scripts/smoke-check.js`)
- Validates package.json + package-lock.json match
- Checks HTML required elements exist (`#player`, `#station-list`, `#visualizer`)
- Verifies all required functions exported from utils.js, stations.js, visualizer.js
- File structure validation (main.js, preload.js, renderer.js exist)

Run: `npm run smoke`

### 3. **Manual Testing Checklist**
- [ ] `npm start` opens window, tray icon appears
- [ ] Window persists size/position between launches
- [ ] Minimize → tray, click tray → restore window
- [ ] Station selection updates metadata, initiates connection
- [ ] Volume slider and mute button work
- [ ] Space key plays/pauses, M key mutes, ↑↓ adjusts volume
- [ ] Scroll wheel on window adjusts volume
- [ ] Keyboard shortcut B cycles bass boost (0/6/12 dB)
- [ ] Visualizer cycles modes on click; mini-visualizer shows bars
- [ ] Auto-reconnect triggers after stream interruption (backoff: 1s, 2s, 4s, 8s, 16s, 30s)
- [ ] Second app instance brings main window to front
- [ ] Power suspend/resume handled gracefully
- [ ] Tray icon state changes reflect player state (colors for playing/muted/reconnecting/stopped)

## Build & Distribution

### Building the Installer

```bash
npm run build
```

Output: `dist/Wavelength Setup 1.0.0.exe` (NSIS installer for x64 Windows)

**Build config** (`package.json` > `.build`):
- App ID: `com.wavelength.player`
- Product name: `Wavelength`
- Icons: `assets/icon.ico`
- NSIS: one-click disabled (user can choose install dir), creates Start Menu + Desktop shortcuts
- Includes: `src/**/*` + `assets/**/*`

### Code Signing (Optional)
See `SIGNING.md`. Environment variables (`.env` or shell):
```
ELECTRON_BUILDER_SIGN_KEY=<path_to_key>
WIN_CSC_LINK=<cert_path>
WIN_CSC_KEY_PASSWORD=<password>
```

## Key Patterns & Conventions

### 1. **UMD Utility Export** (src/utils.js)
Functions exported in UMD pattern for use in both main and renderer:
```javascript
if (typeof module !== 'undefined' && module.exports) { module.exports = { formatListen, averageLevel, trayState, fakeBar }; }
```

### 2. **Window State Persistence**
`window-state.js` automatically saves/restores window bounds to localStorage. On close, state persists across launches.

### 3. **Tray Icon State Machine**
`trayState(connectionState, isMuted, isPlaying)` returns canonical state:
- `'reconnecting'` overrides all (highest priority)
- `'muted'` if muted flag set
- `'playing'` if playing && !muted
- `'stopped'` otherwise

Tray icon is a colored PNG rendered by renderer → sent to main via IPC.

### 4. **Auto-Reconnect Backoff**
When stream drops, intervals: 1s, 2s, 4s, 8s, 16s, 30s, then hold. User click resets.

### 5. **Logging**
App logs to `userData/logs/app.log` with 1 MB rotation. Timestamped. On startup, check log for errors.

## Debugging Tips

1. **DevTools**: Press `Ctrl+Shift+I` in dev mode (main process) to inspect renderer
2. **Main process logs**: Check `userData/logs/app.log` for main process events
3. **IPC debugging**: Add console.log in preload for channel calls; check test output
4. **Window bounds not persisting?** Check `window-state.js` localStorage key conflicts
5. **Tray icon not updating?** Verify renderer emits IPC 'tray-icon-data' with valid PNG blob
6. **Stream disconnects?** Check stream URL validity, check auto-reconnect logic in connection-state handler

## Common Tasks

### Add a New Utility Function
1. Add to `src/utils.js` with UMD export
2. Add test case(s) to `scripts/test.js`
3. Run `npm test` to verify
4. Use in main or renderer via `require()` or `window.electronAPI`

### Add an IPC Channel
1. Add `ipcRenderer.send/on/invoke()` call in `src/preload.js`
2. Add corresponding `ipcMain.on/handle()` handler in `src/main.js`
3. Verify with `npm test` (IPC contract tests run)
4. Update JSDoc if adding new electronAPI method

### Modify Visualizer
1. Edit `src/visualizer.js` (modes, colors, animations)
2. Modes array: `VISUALIZER_MODES = ['bars', 'mirror', ...]`
3. `create()` function initializes canvas context + animation state
4. `drawFrame()` called on animationFrame
5. Mini visualizer: `drawMiniSignal()` with fewer bars
6. Test with `npm start`, cycle modes with click on canvas

### Station List Integration
1. `src/stations.js` loads curated stations plus Radio Browser results on app start
2. Renderer requests the list via IPC `get-stations`
3. Click station → emits IPC `select-station` with station object

### Maintain Curated Stations
1. Edit `assets/stations.json`
2. Follow `STATIONS.md`
3. Run `npm run stations:check` and `npm test`

## Dependencies

**Runtime:**
- `electron@^33.0.0` — framework
- `electron-builder@^25.0.0` — NSIS installer builder

**No external npm dependencies** for app logic (intentional lightweight design).

**Implied (system):**
- Windows OS (target platform)
- Node.js v18+ (dev environment)

## Configuration Files

- `package.json` — app metadata, scripts, build config, versions
- `package-lock.json` — locked dependency tree (commit this)
- `.claude/settings.local.json` — Claude Code local settings

## Related Projects

This project follows patterns from **Zucca Radio** (predecessor single-station player). Key differences:
- Multiple stations (Wavelength) vs. single station (Zucca)
- Multiple stations with Radio Browser fallback (Wavelength) vs. single station (Zucca)
- Similar UI/UX, visualizer, tray integration

## Open Questions / TODO

Refer to `TODO.md` for phase breakdown and known issues:
- Station list maintenance strategy
- Branding/color scheme finalization
- Windows Media Session integration completeness
