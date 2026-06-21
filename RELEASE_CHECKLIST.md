# Release Checklist

Use this checklist for a Windows control release after `npm.cmd run verify` is green.

## Automated Gate

- [ ] Run `npm.cmd run verify`.
- [ ] Confirm station validation passes.
- [ ] Confirm UI audit reports `0 issue(s)`.
- [ ] Confirm the UI audit includes the visualizer mode render check.
- [ ] Confirm all Node tests pass.

## Build

- [ ] Ask before building.
- [ ] Run `npm.cmd run build` only after build approval.
- [ ] Confirm `dist/Wavelength Setup <version>.exe` exists.
- [ ] Confirm the installer is unsigned by design.

## Installer Smoke Test

- [ ] Install the generated NSIS package on Windows.
- [ ] Launch Wavelength from the Start Menu or desktop shortcut.
- [ ] Confirm the tray icon appears.
- [ ] Confirm opening the tray menu shows the current version.
- [ ] Confirm uninstall works from Windows Apps settings or the uninstaller.

## Playback Smoke Test

- [ ] Start playback on a curated default station.
- [ ] Switch to another station from the app UI.
- [ ] Switch to another station from the tray menu.
- [ ] Confirm Play/Stop state is correct in full mode and mini mode.
- [ ] Confirm volume, mute, sleep timer, and bass boost controls respond.

## Windows Integration

- [ ] Confirm the media flyout shows station metadata while playing.
- [ ] Confirm hardware media Play/Pause works.
- [ ] Confirm the app restores correctly after minimize-to-tray.
- [ ] Confirm a second app launch focuses or reuses the running instance.

## Logs

- [ ] Check `%APPDATA%\wavelength\logs\app.log` after the smoke test.
- [ ] Confirm no new startup, tray, station, or playback errors are logged.
