# Wavelength TODO

Current status after project review: the core app is implemented and tests pass. Code signing is intentionally out of scope for this project.

## Done

- [x] Electron project setup with `electron-builder`
- [x] Windows NSIS build configuration
- [x] Main process window, tray, single-instance, app lifecycle
- [x] Secure preload bridge with `window.electronAPI`
- [x] Renderer UI for player, station picker, controls, and visualizer
- [x] Shared utility module with UMD-style exports
- [x] Window state persistence
- [x] Smoke check and Node test suite
- [x] Electron UI audit for full, station-list, and mini layouts
- [x] Non-build `npm.cmd run verify` gate for stations, UI audit, and tests
- [x] Station loading with curated defaults, Radio Browser fallback, and disk cache
- [x] `get-stations` and `select-station` IPC flow
- [x] Playback controls, volume, mute, keyboard shortcuts, and scroll-wheel volume
- [x] Auto-reconnect backoff
- [x] Tray icon states and tray menu
- [x] Sleep timer, listening time, bass boost, first-run hint, about dialog, and support log
- [x] Visualizer modes and mini visualizer

## Before Release

- [x] Manually verify `npm.cmd start` on Windows with real streams
- [x] Verify external icons/streams still work with default Electron `webSecurity`
- [x] Run `npm.cmd run build` and install the generated NSIS package
- [x] Remove unused backend configuration and seed scripts
- [x] Check app log rotation under `%APPDATA%\wavelength\logs\app.log`
- [x] Confirm second-instance launch focuses/reuses the running app
- [x] Confirm tray behavior after suspend/resume
- [x] Check Windows media controls on the target Windows version

## Code Health

- [x] Split `src/renderer.js` into smaller modules once behavior is stable
- [x] Add behavior-level tests for station selection and reconnect state
- [x] Add station cache/fallback tests around `src/stations.js`
- [x] Replace brittle smoke markers with targeted assertions where practical
- [x] Return unsubscribe functions from preload listener helpers

## Nice To Have

- [x] Branding pass for icon and color system
- [x] Station maintenance workflow for curated defaults
- [x] Dynamic accent-color system — all UI colors follow station logo color
- [x] Visualizer overhaul — 16 modes, removed weak modes, fixed Flexi/Unchained/Mandala
- [x] Tray icon wave shape matches app logo
- [x] Mini-mode fade transition

## Ideas / Backlog (2026-07-05)

### Features (user-facing)

- [x] Sleep timer fade-out — fade volume down at timer end instead of hard stop
- [x] Favorites — already implemented (pinned favorites + fav filter)
- [x] Keyboard shortcut for EQ — already implemented (B key toggles the EQ popover)
- [x] Remember last station — already implemented (wl.lastStationId)
- [x] Show stream quality — already implemented (bitrate in station tooltip + bitrate filter)
- [x] Search/filter box for the station list — already implemented (search + genre/lang/bitrate filters)
- [ ] Recording — save the current stream to an MP3 file (legal note needed; discuss separately)
- [x] Global media hotkeys — already implemented (MediaPlayPause etc. via globalShortcut)
- [x] Notifications on song change (optional, off by default)

### UX / polish

- [x] EQ presets — built-in presets in the EQ popover (Flat/Neutral, Rock, Pop, Bass)
- [x] Volume persistence — already implemented (LS.vol)
- [x] Tray menu shows metadata — already implemented (updateTrayTooltip with now playing)
- [x] Dark/light theme — covered by dynamic accent-color + time-based theme system
- [x] Onboarding polish — already implemented (onboarding + scroll/viz/shortcuts hints)

### Technical

- [x] Auto-update — already implemented (electron-updater with autoDownload + quitAndInstall)
- [x] Automated station health check — weekly CI job (station-health.yml + npm run stations:health)
- [x] E2E test for EQ persistence — already implemented (equalizer popover e2e suite)
- [x] Reduce installer size — removed `extraResources` duplication; `getIconPath()` now
      reads icons straight from the asar like `stations.json` already did (Electron's
      `nativeImage`/`BrowserWindow`/`Notification` icon options support asar paths natively)
- [x] Crash reporting — covered: uncaughtException/unhandledRejection already logged to app.log
      (visible via support log)
