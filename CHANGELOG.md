# Changelog

## 1.1.8

- Removed code signing from the release workflow because unsigned Windows builds are intentional for this project.
- Added release-facing README documentation and guarded the changelog in the smoke check.
- Added a Windows release checklist for build, installer, playback, media controls, and log validation.
- Set the Windows App User Model ID at runtime so the app matches the NSIS build app ID.
- Updated external request user agents to use the current package version.
- Hardened station logos by using HTTPS icon URLs and JavaScript error listeners instead of inline fallback handlers.
- Moved tray station menu building into a directly tested module.
- Added direct tests for Windows media session title and artist parsing.
- Added an Electron UI audit check that renders every visualizer mode and inspects canvas pixels.
- Logged ICY request cleanup failures instead of silently swallowing them.
- Made logger rotation issues visible and reset corrupt renderer list storage on startup.
- Improved Radio Browser genre normalization with German labels such as `Rock Klassiker`, `Leichte Musik`, and `Mix`.
- Improved tray station selection with alphabetic grouping and a visible current-station entry.
- Fixed mini-mode play/stop icon state after switching views while playback is active.

## 1.1.6

- Added a versioned NSIS control build for the tray sorting and station workflow improvements.
- Kept the non-build release gate green with station validation, UI audit, and unit tests.

## 1.1.5

- Improved station genre and language localization for German station defaults and Radio Browser results.
- Added guards for curated station maintenance, duplicate handling, and fallback categories.

## 1.1.4

- Fixed station switching regressions around main-process synchronization and autoplay state.
- Added behavior-level tests for station selection and reconnect handling.

## 1.1.3

- Added the larger fixed 460x480 app window.
- Improved Windows tray, media controls, and release verification coverage.
