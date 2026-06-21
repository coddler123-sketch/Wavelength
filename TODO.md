# Wavelength TODO

Current status after project review: the core app is implemented and tests pass, but the release surface still needs hardening.

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
- [x] Non-build `npm run verify` gate for stations, UI audit, and tests
- [x] Station loading with curated defaults, Radio Browser fallback, and disk cache
- [x] `get-stations` and `select-station` IPC flow
- [x] Playback controls, volume, mute, keyboard shortcuts, and scroll-wheel volume
- [x] Auto-reconnect backoff
- [x] Tray icon states and tray menu
- [x] Sleep timer, listening time, bass boost, first-run hint, about dialog, and support log
- [x] Visualizer modes and mini visualizer

## Before Release

- [x] Manually verify `npm start` on Windows with real streams
- [x] Verify external icons/streams still work with default Electron `webSecurity`
- [x] Run `npm run build` and install the generated NSIS package
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

- [/] Code signing for installer (workflow prepared; requires certificate)
- [x] Branding pass for icon and color system
- [x] Station maintenance workflow for curated defaults
