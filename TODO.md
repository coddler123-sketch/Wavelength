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

- [ ] Sleep timer fade-out — fade volume down at timer end instead of hard stop
- [ ] Favorites — mark stations as favorite, pinned to top of the station list
- [ ] Keyboard shortcut for EQ — e.g. `E` toggles the EQ popover
- [ ] Remember last station — auto-select the last played station on startup (verify current behavior)
- [ ] Show stream quality — display bitrate from ICY metadata in the UI
- [ ] Search/filter box for the station list
- [ ] Recording — save the current stream to an MP3 file (check legal note in README)
- [ ] Global media hotkeys — play/pause via keyboard even when the app is not focused
- [ ] Notifications on song change (optional, off by default)

### UX / polish

- [ ] EQ presets — a few built-in presets in the EQ popover (Rock, Pop, Bass Boost, Flat)
- [ ] Volume persistence — restore volume across sessions (verify current behavior)
- [ ] Tray menu shows metadata — currently playing song visible in the tray context menu
- [ ] Dark/light theme toggle or follow Windows theme
- [ ] Onboarding polish — short tooltip tour for EQ, stats, and mini mode

### Technical

- [ ] Auto-update — wire up electron-updater end-to-end (latest.yml is already uploaded to releases)
- [ ] Automated station health check — periodically verify stream URLs (e.g. weekly CI job)
- [ ] E2E test for EQ persistence across app restart
- [ ] Reduce installer size — audit electron-builder file includes
- [ ] Crash reporting — local crash log summary in the support log
