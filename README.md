# SBP Accounting Windows V20 — Fondasi Proyek

**Status:** kerangka awal / tahap 1  
**Repositori:** direncanakan sebagai repositori GitHub baru dan terpisah  
**Proyek V19:** tidak diubah dan tidak menjadi target commit apa pun.

## Tujuan

Membangun aplikasi desktop mandiri untuk Windows dengan database lokal, jalur impor/ekspor, serta mempertahankan aturan akuntansi SBP.

## Kompatibilitas yang ditargetkan

- Windows 7 SP1 x86 dan x64
- Windows 8 / 8.1
- Windows 10
- Windows 11 dan versi Windows berikutnya

## Catatan kompatibilitas penting

Kerangka ini menggunakan Electron 22.3.27 sebagai kandidat runtime legacy karena Electron 23 menghentikan dukungan Windows 7/8/8.1. Electron 22 sudah usang dan tidak menerima pembaruan keamanan. Karena itu:
- aplikasi harus berjalan lokal/offline dan tidak memuat konten web eksternal;
- runtime ini wajib melalui pengujian khusus pada Windows 7 SP1 x86/x64;
- dukungan Windows terbaru harus diuji terpisah;
- jangan menganggap target OS sudah lulus hanya karena installer berhasil dibuat.

Build x86/x64 masih perlu diverifikasi pada mesin build Windows 11, terutama ketersediaan paket Electron ia32 dan seluruh dependensi. SQLite memakai `sql.js` (SQLite/WebAssembly) agar tidak bergantung pada binary native SQLite yang berbeda arsitektur. File database tetap disimpan sebagai `.db`.

## Persyaratan pengembangan

- Windows 11
- Node.js 16.x (runtime proyek legacy)
- npm
- Git

## Menjalankan

```powershell
npm install
npm start
```

## Build installer

```powershell
npm run dist:x86
npm run dist:x64
```

Hasil build diarahkan ke folder `release/`.

## Struktur

```text
electron/   proses utama dan preload aman
src/        antarmuka aplikasi
assets/     ikon dan aset
release/    hasil installer
```

## Database

Database lokal dibuat di folder data aplikasi pada profil pengguna Windows (`app.getPath("userData")/data/sbp-accounting.db`).

Skema saat ini hanya fondasi awal. Belum berisi seluruh tabel dan aturan bisnis SBP V19.

## Aturan keselamatan proyek

1. Jangan commit atau push ke `mfadholi27-bot/SBP-Accounting`.
2. Buat repositori baru, misalnya `SBP-Accounting-Windows`.
3. Jangan mengimpor database V19 secara otomatis. Buat proses ekspor/impor terverifikasi dan gunakan salinan.
4. Sebelum migrasi, audit struktur data V19 dan siapkan backup.
5. Jangan menyatakan kompatibel Windows 7 sampai uji nyata di VM/perangkat target berhasil.
