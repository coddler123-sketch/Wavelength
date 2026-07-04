# Changelog

## 1.9.0

- style: apply prettier formatting to stats view files
- style: apply prettier formatting to stats-view plan/spec markdown
- test: add e2e coverage for listening stats modal
- feat: wire up listening stats modal open/close/render
- feat: add listening stats modal markup, styles, and i18n strings
- feat: add collectListenData localStorage reader for stats view
- feat: add buildStatsList pure function to utils.js
- test: add failing tests for buildStatsList ahead of stats view implementation
- docs: add implementation plan for listening stats view
- docs: add design spec for listening stats view

## 1.8.2

- fix: fill station icons edge-to-edge instead of letterboxing
- fix(stations): replace dead ENERGY Deutschland stream URL

## 1.8.1

- fix: keep eq-popover within window bounds when the trigger button sits mid-window

## 1.8.0

- fix: update shortcuts-help label for B key from bass boost to equalizer
- style: apply prettier formatting to plan/spec markdown
- test: add e2e coverage for equalizer popover open/slider/reset/persistence
- fix: eq-popover closing itself on the click that opens it
- feat: wire up equalizer popover interaction and replace bass-boost shortcut
- fix: align eq-popover z-index with the context-menu pattern it's modeled on
- fix: update smoke-check marker from BASS_GAINS to setEqBand
- feat: add equalizer popover markup, styles, and i18n strings
- feat: replace bass-boost filter chain with 3-band EQ (bass/mid/treble)
- test: expect new #btn-eq element ahead of equalizer implementation
- docs: add implementation plan for 3-band equalizer
- docs: add design spec for 3-band equalizer feature

## 1.7.8

- test: draw every visualizer mode on a mock canvas in Node

## 1.7.7

- refactor: eliminate all eslint warnings, enforce --max-warnings 0
- refactor: remove dead visualizer code (drawDNA, drawScanner, unused color strings)
- refactor: extract WebGL shader sources into visualizer-shaders.js
- chore: add npm run coverage via node --experimental-test-coverage
- chore: enforce lint + prettier in verify gate, apply formatting
- fix: sync stale 2D canvas buffer immediately when switching back from WebGL
- test: add e2e regression for mini cold start → full WebGL canvas sizing

## 1.7.6

- fix: size WebGL canvas from its own layout box, not the hidden 2D canvas
- fix: remove canvas CSS size pinning that froze size after mini cold start
- fix: pin canvas CSS size to prevent browser stretching buffer on mini→full
- fix: redraw idle frame after window.resize clears the canvas
- fix: use ResizeObserver to reliably resize canvas on mini to full switch
- fix: visualizer pixelated after mini→full switch

## 1.7.5

- style: apply prettier formatting
- feat: add ESLint + Prettier, reconnect E2E test, fix ui-audit regex escapes

## 1.7.4

- **Volume Slider**: Klickfläche des Vol-Row-Reglers erweitert (`-webkit-app-region: no-drag` auf die gesamte Pille statt nur den Slider selbst) — verhindert versehentliches Fenster-Verschieben beim Bedienen.
- **Mini-Player Bugfix**: Volume-Slider-Füllfarbe und Marquee-Breite wurden beim Start bzw. Moduswechsel nicht berechnet, wenn die Mini-Ansicht zu dem Zeitpunkt `display:none` war (`offsetWidth`/`clientWidth` = 0). Beide werden jetzt beim Umschalten in den Mini-Mode neu berechnet.
- **Marquee-Scroll überarbeitet**: Sendername/Tracktitel (Full-View und Mini-View) scrollen jetzt als nahtloser Endlos-Ticker (Text dupliziert, Loop-Distanz = eine Textbreite) statt der alten "scrollen → schnell zurückspringen"-Animation. Geschwindigkeit an Textlänge gekoppelt (26 px/s).

## 1.7.3

- fix(release): harden release script and auto-update README version in bump-version.js
- fix: installer-smoke no longer force-deletes exe, masking failed uninstalls
- ci(release): Verify GitHub assets and NSIS installer

## 1.7.2

- ci(release): Verify GitHub assets and NSIS installer

## 1.7.1

- **Mini-Player Redesign**: Logo 48×48 dominant links, Sendername + Genre/Land als Subtitle, Vol-Strip als 4px-Leiste am Boden mit seitlichem Padding.
- **Tooltips im Mini-Mode**: Hover über Logo zeigt Sendernamen, Hover über Tracktitel zeigt vollen Tracktitel.
- **Volume Slider**: Thumb immer sichtbar (14px), Hover-Scale + Accent-Glow; hardcodierter Box-Shadow-Blau durch `color-mix(var(--accent))` ersetzt.
- **Mini-Mode Play-Button Hover-Glow**: Hardcodiertes Teal durch dynamische Accent-Farbe ersetzt.

## 1.7.0

- **Dynamisches Accent-Color-System**: Alle UI-Farben (Borders, Glows, Hover-States, Play-Button, Volume-Slider, Logo-Pulsieren) reagieren jetzt per CSS `color-mix()` und relativer Farbsyntax live auf den aktiven Sender — keine hardcodierten Hex-Werte mehr.
- **Play-Button-Gradient**: Monochromatischer Gradient aus der Hauptfarbe des Senders (`color-mix` hell → Accent → dunkel).
- **Farbextraktion verbessert**: `maxVal < 235`-Filter entfernt — reine Farben (z.B. `#FF0000`) werden jetzt korrekt erkannt. Radio Hamburg und ähnliche Sender mit reinem Rot/Grün/Blau werden endlich eingefärbt.
- **Visualizer überarbeitet**:
  - _Flexi_: Seam-Artefakt behoben — Fill/Stroke getrennte Pfade, `closePath()` durch `lineTo(pts[0])` ersetzt.
  - _Unchained_: Komplett neu als **Sonnenkorona** — 96 Stacheln wachsen von einem leuchtenden Innenring nach außen, langsame Rotation, 2-fach gespiegelte Frequenzmapping.
  - _Starburst_: Neuer Modus — 4-fach symmetrischer Strahlen-Burst aus dem Zentrum (ehemalige Unchained-Variante, mit Length-Cap).
  - _Mandala 3D_: Kamera-Shake entfernt, Segmentanzahl fixiert (8), Bass/Treble-Einfluss stark gedämpft — deutlich ruhigere Animation.
  - _Bars_: Bass zentriert, Höhen außen (gespiegeltes Layout).
  - Mehrere schwache Modi entfernt: Waterfall, DNA Helix, Scanner, Retrowave, Plasmakugel, Hyperspace, Mirror.
- **Tray-Icon**: Wellenform aus dem App-Logo als Bezier-Kurve — kein Sprung mehr beim Start zwischen statischem und gerendertem Icon.
- **Theme-Picker entfernt**: Festes Nacht-Theme als Basis; Accent-Farben kommen dynamisch vom Sender.
- **Favoriten-Stern**: Fest auf Gold `#ffb700` — ändert sich nicht mit dem Sender.
- **Kontext-Menü**: Bullet-Zeichen (`•`) Encoding-Bug behoben (`\2022` CSS-Escape).
- **WAVELENGTH-Label**: 13 px, Accent-Farbe, volle Sichtbarkeit.
- **Mini-Modus**: Fade-Transition beim Wechsel zwischen Mini und Vollansicht.
- **Tests**: Erweiterte Test-Suite und UI-Audit-Abdeckung.

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
