# SBP Accounting Windows V20

Proyek desktop Windows yang terpisah dari SBP Accounting V19.

## Status saat ini
- Landing page GitHub Pages: tersedia di root `index.html`.
- Fondasi Electron: berada di `electron/`.
- Antarmuka desktop: berada di `src/`.
- Database lokal: SQLite melalui sql.js.
- Belum merupakan sistem akuntansi lengkap; modul V19 belum dimigrasikan.

## Aturan perlindungan
1. Jangan melakukan commit atau push ke repositori `mfadholi27-bot/SBP-Accounting`.
2. Semua perubahan V20 hanya dilakukan di repositori ini.
3. Migrasi V19 harus melalui ekspor/impor pada salinan data, bukan mengubah database produksi.
4. Lakukan backup sebelum migrasi.

## Menjalankan di Windows 11
Gunakan Node.js 16.x untuk fondasi runtime legacy ini:
```powershell
npm install
npm start
```

## Build
```powershell
npm run dist:x86
npm run dist:x64
```
Hasil installer diarahkan ke `release/`.

## Catatan kompatibilitas
Electron 22 dipilih sebagai kandidat runtime lama. Versi ini sudah tidak menerima pembaruan keamanan. Dukungan Windows 7 SP1 x86/x64 dan Windows modern wajib diverifikasi dengan build dan pengujian nyata. Jangan menyatakan kompatibel sebelum tes selesai. Gunakan Windows 7 hanya dalam lingkungan lokal yang terisolasi dan sesuai kebijakan keamanan kantor.

## Struktur
- `electron/main.js`: proses utama, jendela, database, backup.
- `electron/preload.js`: API terbatas untuk renderer.
- `src/index.html`: antarmuka desktop.
- `src/styles.css`: gaya desktop.
- `src/app.js`: interaksi dashboard.
- `index.html`: halaman informasi GitHub Pages, terpisah dari UI desktop.
