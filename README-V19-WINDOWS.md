# SBP Accounting V19 — Windows Desktop

This branch packages the original V19 browser application inside Electron. The V19 HTML/CSS/JS accounting core is copied unchanged under `src/v19/`. The original GitHub Pages repository is not modified.

## Data isolation
- GitHub Pages V19 keeps its existing browser IndexedDB origin.
- Windows Electron uses a separate local Chromium profile under the Windows user profile.
- No live synchronization occurs between GitHub and Windows.
- Use **File → Backup Data Windows** to export a V19 JSON backup.
- Use **File → Restore Backup** to import a V19 JSON backup. Existing Windows data is backed up first; restore replaces only the Windows copy.
- To migrate GitHub data, export a V19 backup in the browser, then restore that file in Windows.

## Run and build
`npm install`, `npm start`, `npm run dist:all`.

GitHub Actions builds x86 and x64 NSIS installers. Runtime and accounting regression tests are still required before production use.
