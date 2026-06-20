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
- [x] Station loading with curated defaults, Radio Browser fallback, and disk cache
- [x] `get-stations` and `select-station` IPC flow
- [x] Playback controls, volume, mute, keyboard shortcuts, and scroll-wheel volume
- [x] Auto-reconnect backoff
- [x] Tray icon states and tray menu
- [x] Sleep timer, listening time, bass boost, first-run hint, about dialog, and support log
- [x] Visualizer modes and mini visualizer

## Before Release

- [ ] Manually verify `npm start` on Windows with real streams
- [ ] Verify external icons/streams still work with default Electron `webSecurity`
- [ ] Run `npm run build` and install the generated NSIS package
- [x] Remove committed `src/firebase-config.js` with the fixed database URL
- [ ] Review Firebase database rules before publishing
- [ ] Check app log rotation under `%APPDATA%\wavelength\logs\app.log`
- [ ] Confirm tray behavior after suspend/resume and second-instance launch
- [ ] Check Windows media controls on the target Windows version

## Code Health

- [ ] Split `src/renderer.js` into smaller modules once behavior is stable
- [ ] Add behavior-level tests for station selection and reconnect state
- [ ] Add station cache/fallback tests around `src/stations.js`
- [ ] Replace brittle smoke markers with targeted assertions where practical
- [ ] Consider returning unsubscribe functions from preload listener helpers if renderer reload/listener churn appears

## Nice To Have

- [ ] Code signing for installer
- [ ] Branding pass for icon and color system
- [ ] Station maintenance workflow for curated defaults
