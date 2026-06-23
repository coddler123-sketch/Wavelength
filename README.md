# Wavelength

Wavelength is a compact Windows Electron radio player for curated stations and Radio Browser results. It is built around a tray-first workflow with a fixed 460x480 player window, mini mode, station filters, favorites, recents, visualizers, sleep timer, and Windows media controls.

## Status

Current version: `1.3.0`

The Windows installer is intentionally unsigned. Code signing certificates are out of scope for this project.

## Development

```powershell
npm.cmd start
```

Use `npm.cmd` on Windows PowerShell to avoid local execution-policy issues with npm shims.

## Verification

```powershell
npm.cmd run verify
```

`verify` runs station validation, the Electron UI audit, the smoke check, and the Node test suite. The UI audit also renders every visualizer mode and checks the canvas output. It does not build an installer.

## Build

```powershell
npm.cmd run build
```

The NSIS installer is written to `dist/Wavelength Setup <version>.exe`.

For release validation, use `RELEASE_CHECKLIST.md` after `verify` is green.

## Station Maintenance

Curated defaults live in `assets/stations.json`. After editing stations, run:

```powershell
npm.cmd run stations:check
npm.cmd run verify
```

Station data should use localized language and genre labels where practical, HTTPS icon URLs, and working HTTPS stream URLs.

## Release Notes

See `CHANGELOG.md` for versioned changes.
