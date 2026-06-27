# Changelog

## 1.6.0

- **Interaktiver & Dynamischer 3D WebGL-Visualizer**:
  - Hinzufügung von 3 neuen WebGL-Visualisierungsmodi: Infinite Valley (`valley3d`), Audio Matrix (`matrix3d`) und Psychedelic Mandala (`mandala3d`) (insgesamt 7 fortgeschrittene WebGL-3D-Modi).
  - Dynamischer Color-Sync: Automatisierte Farbthemen-Extraktion aus den Logos der Radiosender zur Echtzeit-Anpassung der Player-UI-CSS-Variablen und der Visualizer-Farbpaletten im HSL-Triaden-Schema.
  - Bass-Shake: Kameravibrationseffekt auf Basis niedriger Frequenzen.

## 1.5.0

- **Vollständige Lokalisierung (DE/EN)**: Alle UI-Texte — Tooltips, aria-Labels, Gruppen-Header, Filter-Dropdowns, Modals, Toasts, Onboarding, Tray-Menü — gehen jetzt durch das i18n-System. Sprachwechsel aktualisiert die gesamte Oberfläche sofort inkl. Tray-Menü.
- **Kategorie-Filter lokalisiert**: Genre-Kategorien und „Alle Kategorien / All categories" werden übersetzt angezeigt; interne Filterwerte bleiben Deutsch für konsistentes Matching.
- **Equalizer-Animation-Fix**: Balken-Icon erscheint jetzt nur noch beim aktiv spielenden Sender, nicht bei allen.
- **Gain-Anzeige in Hauptansicht**: Sender-Subtitle zeigt `+X dB` wenn ein manueller Gain gesetzt ist (z.B. `Pop/Rock · DE · +4 dB`).

## 1.4.0

- **Icon-Proxy & lokales Caching**: Stationsicons werden über den Main-Prozess geladen (`net.request`), auf Disk gecacht (`userData/icons/<sha1>.<ext>`) und als `data:`-URL an den Renderer zurückgegeben. In-Memory-Map, 5 s Timeout, 200 KB-Limit, max. 300 Dateien. CSP verschärft: `img-src *` entfernt, nur noch `img-src 'self' data:` erlaubt.
- **Sleep-Timer-Zyklus**: Der Sleep-Button durchläuft jetzt vier Stufen (15 → 30 → 60 → 90 Min. → aus) statt eines einfachen An/Aus-Toggles.
- **Wiedergabeverlauf** (F4): Jeder ICY-Titel wird in `localStorage` gespeichert (max. 30 Einträge). Das History-Modal zeigt Titel mit relativen Zeitstempeln; Verlauf kann geleert werden.
- **Crash Reporter**: Renderer-Fehler (`window.error`) und unbehandelte Promise-Rejections werden per IPC an den Main-Prozess weitergeleitet und in `app.log` geloggt.
- **Barrierefreiheit**: Generischer Modal-Esc-Handler schließt alle fünf Modals; Tab-Fokus bleibt innerhalb offener Modals; Onboarding-Modal mit 3 Folien beim ersten Start.
- **Performance**: Sucheingabe per 80 ms Debounce entprellt; CSS-Containment (`contain: layout style`) auf Senderliste-Items.
- **UX-Polish**: Lade-Skeleton mit 8 Platzhalter-Zeilen; kontextbezogene Leerzustände (Favoriten, Suche, leer); Toast-Buttons mit Retry-Aktion; Shortcut-Hinweis beim ersten Start.
- **CI/CD**: GitHub Actions Pipeline — `verify` + `npm run e2e` bei jedem Push, NSIS-Installer-Release bei Tags.
- **E2E-Tests** (Playwright): 6 automatisierte UI-Tests für Play/Stop, Stationswechsel, Lautstärke, Stumm, Mini-Modus und Visualizer.
- **Inline-Style-Refactor**: Alle `element.style.display`-Zuweisungen durch `classList.add/remove('hidden')` ersetzt; `.hidden { display: none !important }` als zentrale CSS-Klasse.

## 1.3.2

- Centered the favorite star icon vertically and horizontally inside buttons (adjusted SVG size/viewBox, removed inner button inline whitespace, corrected CSS selector).

## 1.3.1

- Fixed "Über Wavelength" modal metadata fields (active station name, stream-URL, website-url) which were previously static placeholders.
- Fixed custom station genre clearing issue in `src/custom-stations.js` where clearing genre was ignored due to a falsy OR-operator check.
- Mitigated potential custom station ID collision risk by appending a random suffix to IDs.
- Fixed check-stream IPC warning during UI audit.

## 1.3.0

- Added custom station management: users can add, edit, and remove their own radio stations via a "+" button in the station list.
- Custom stations are stored in `userData/custom-stations.json` and appear at the top of the station list under "✦ Meine Sender".
- Edit and delete buttons appear on hover for each custom station.
- Station editor modal supports name, stream URL, genre, and icon URL fields with validation.

## 1.2.2

- Fixed autostart checkbox showing wrong state when the Run key was registered under a legacy name (`electron.app.Wavelength` instead of `Wavelength`). `getAutostart()` now scans the registry directly as fallback. Disabling autostart now also removes any misnamed entries. `cleanupOrphanedAutostart()` generalized to catch all Wavelength-related Run key entries regardless of name.

## 1.2.1

- Extracted all inline CSS from `index.html` into `src/index.css` so the CSP can drop `style-src 'unsafe-inline'` for stylesheet loading.
- Tightened CSP: replaced `style-src 'unsafe-inline'` with `style-src-elem 'self'` (covers `<link>`) and `style-src-attr 'unsafe-inline'` (covers dynamic `style=""` attributes only).
- Removed Google Fonts CDN references from the CSP (`googleapis.com`, `gstatic.com` no longer needed after font self-hosting).

## 1.2.0

- Added a keyboard shortcuts help dialog reachable via `?`, `F1`, or the tray menu.
- Self-hosted the Figtree and Syne fonts so no external CDN call is made and the CSP can drop `googleapis.com` / `gstatic.com`.
- Added a portable Windows build target alongside the NSIS installer.
- Added `npm run release:notes` and `npm run release:gh` to extract the CHANGELOG entry for the current version and optionally create a GitHub release with the build artifacts.

## 1.1.14

- Added a keyboard shortcuts help dialog reachable via `?`, `F1`, or the tray menu.
- Fixed the favorites star icon clipping by expanding the SVG viewBox and enabling `overflow="visible"`.
- Sanitized remaining station logo URLs in mini logo, player logo, and recent items.
- Cleaned up orphaned Windows autostart registry entries on startup so the tray checkbox reflects the real state.
- Logged audio reload failures on stop instead of swallowing the error.
- Synced the about-version in `index.html` from `bump-version.js`.

## 1.1.11

- Removed code signing from the release workflow because unsigned Windows builds are intentional for this project.
- Added release-facing README documentation and guarded the changelog in the smoke check.
- Added a Windows release checklist for build, installer, playback, media controls, and log validation.
- Set the Windows App User Model ID at runtime so the app matches the NSIS build app ID.
- Updated external request user agents to use the current package version.
- Hardened station logos by using HTTPS icon URLs and JavaScript error listeners instead of inline fallback handlers.
- Moved tray station menu building into a directly tested module.
- Moved ICY metadata parsing and reconnect handling into a dedicated main-process module.
- Moved station gain, renderer sanitizing, and UI label rules into directly tested renderer helper modules.
- Moved station selection and reconnect backoff policy into directly tested renderer helper modules.
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
