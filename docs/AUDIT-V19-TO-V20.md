# Audit V19 → V20
Tanggal audit: 2 November 2026

## Tujuan dan batas keselamatan
V20 adalah penerus penuh V19, tetapi proyek dan penyimpanan datanya berdiri sendiri. Audit ini hanya membaca sumber V19. Jangan mengubah, menghapus, memindahkan, atau menulis file apa pun ke repositori `mfadholi27-bot/SBP-Accounting` (V19).

Repositori target pengembangan: `mfadholi27-bot/SBP-Accounting-Windows`.

## Sumber yang diperiksa
- `v19/index.html` — SHA `3b76142f1f1bb0d4b1978bc985e670f5047e44a9` (19 halaman aplikasi teridentifikasi).
- `v19/app.js` — SHA `dd28027b0099e9b20828cfbab3656ec9cc6bb835` (sekitar 230 KB; 172 fungsi bernama teridentifikasi).
- `v19/styles.css` — SHA `c91eaa21974caee6d17b9a588302bcc5a64ab398`.
- `v19/palm-glass-theme.css` — SHA `742a1d174530c4b40f1c54dcd5d291971d890718`.
- `v19/README.md` — dokumentasi fitur dan batas kompatibilitas.

## Inventaris menu V19
1. Dashboard
2. Input Jurnal
3. Daftar Jurnal
4. Nota Debet
5. Master Akun
6. Saldo Awal ACC & Program
7. Anggaran Tahunan
8. Periode Akuntansi
9. Buku Besar per Akun
10. Neraca Percobaan / Laporan
11. Pusat Import Data
12. Validasi & Integritas Data
13. Administrasi Jurnal
14. Template Cetak
15. Riwayat Aktivitas
16. Arsip 5 Tahunan
17. Pembaca Arsip
18. Backup & Restore

Selain menu navigasi tersebut, HTML memiliki halaman/area internal NPTRANS dan 19 section halaman secara keseluruhan.

## Model data V19 yang harus dipetakan
State utama V19 menggunakan IndexedDB (database `sbp-accounting-v19`, object store `app`, key `main`) dengan fallback localStorage. Properti state:
- `accounts`
- `journals`
- `nptrans`
- `openingBalances`
- `debitNotes`
- `annualBudgets`
- `auditLogs`
- `npTemplate`
- `periodControl`
- metadata versi

V20 harus memetakan seluruh entitas tersebut ke skema SQLite yang terstruktur, dengan transaksi database, indeks, foreign key, migrasi skema, dan backup atomik. Jangan hanya membuat tabel akun dan header jurnal lalu menganggap migrasi selesai.

## Kemampuan yang teridentifikasi

### Dashboard dan navigasi
- Ringkasan total debit, total kredit, jumlah jurnal.
- Akses cepat ke input jurnal, master akun, laporan.
- Jurnal terbaru.

### Transaksi jurnal
- Input jurnal manual multi-baris.
- Draft dan POSTED.
- Validasi minimal dua baris, akun harus ada, setiap baris hanya satu sisi debit/kredit, nominal tidak negatif, debit-kredit seimbang.
- Nomor bukti tidak boleh duplikat.
- Jurnal POSTED tidak boleh diedit; gunakan jurnal koreksi/pembalik.
- Daftar jurnal dengan pencarian, edit draft, penghapusan sesuai status/kontrol, ekspor XLSX.
- Fitur split jurnal POSTED menjadi beberapa jurnal POSTED dengan backup, pembatalan jurnal asal, dan audit log.
- Bulk posting memiliki validasi debit/kredit sendiri.

### Nota Debet
- Nota diterima atau diterbitkan.
- Jenis transaksi: pembelian TBS, pembelian lain, penjualan, biaya, umum.
- Referensi pihak, invoice/DO, alasan, dan sumber transaksi dari jurnal POSTED.
- Draft, validasi keseimbangan, posting yang membuat satu jurnal terhubung, serta pembatalan/daftar nota.
- Nota POSTED tidak diedit seperti draft.

### Master akun dan saldo awal
- Master akun menyimpan kode/SANDI dan nama.
- Import akun CSV/XLSX dan template ekspor.
- Saldo awal per periode dan akun, import dengan pratinjau.
- Saldo awal harus dipetakan ke kode akun master; validasi akun yang tidak ditemukan dan duplikasi perlu dipertahankan.

### Anggaran
- Anggaran tahunan per akun dan bulan.
- Import workbook dengan pemetaan header dan pratinjau.
- Kontrol anggaran bulanan pada input jurnal sebagai simulasi/live preview.
- Perhitungan realisasi harus mengikuti aturan status jurnal dan periode yang benar.

### Periode akuntansi
- Periode aktif, tutup dan buka kembali periode.
- Penutupan diblokir jika masih ada jurnal Draft atau Neraca Percobaan tidak seimbang.
- Periode tertutup melarang input/edit/posting/import/penghapusan; laporan tetap dapat dibaca.
- Tindakan administratif harus diaudit dan memerlukan otorisasi.
- Implementasi V19 memakai password lokal hard-coded; jangan menyalin pola password tersebut ke V20. Rancang autentikasi/otorisasi lokal yang lebih aman dan dapat dikonfigurasi.

### Buku besar dan laporan
- Buku Besar per akun dengan saldo awal, mutasi, dan saldo berjalan.
- Sumber mutasi hanya jurnal POSTED.
- Neraca Percobaan menggabungkan saldo awal periode dan mutasi jurnal POSTED pada periode yang dipilih.
- Saldo akhir dihitung per akun dari saldo neto debit-kredit.
- Laporan/ekspor XLSX dan cetak harus diaudit lebih lanjut pada tahap pemetaan detail.

### Integrasi NPTRANS, CSV, XLSX, DBF
- Import CSV NPTRANS dengan kolom logis yang dikenal: `SANDI, TANGGAL, NOBUKTI, NOURUT, KET, JUMLAH`.
- Import/export CSV dan XLSX.
- Parser DBF membaca deskriptor field, tipe, panjang, desimal, deleted record, dan jumlah record.
- Export DBF mensyaratkan template NPTRANS.DBF asli agar deskriptor field tidak ditebak.
- Exporter tidak membuat ulang indeks CDX/NDX atau companion files.
- NPSALDO/master akun CSV/DBF memiliki pemetaan nama field dasar; skema file sumber sebenarnya tetap harus diverifikasi.
- Pembuatan Draft dari NPTRANS mengelompokkan baris berdasarkan tanggal dan nomor bukti, tetapi nominal JUMLAH sumber belum otomatis menjadi jurnal debit/kredit seimbang. Jangan mengarang counterpart accounting logic.

### Administrasi, validasi, audit, arsip, backup
- Administrasi jurnal termasuk pencarian/penghapusan terkontrol dan split.
- Validasi integritas memeriksa akun, nomor bukti, tanggal, baris jurnal, keseimbangan, periode, saldo awal, serta record NPTRANS.
- Audit log menyimpan aksi, entitas, ID, ringkasan, data sebelum/sesudah; tersedia ekspor CSV.
- Arsip 5 tahunan dan pembaca arsip memiliki pembuatan, verifikasi hash, pencarian, dan tampilan data arsip.
- Backup JSON manual dan otomatis, koneksi folder lokal, restore dengan validasi dan pratinjau. Restore mengganti database aktif, sehingga V20 perlu backup pra-restore dan transaksi aman.

### Cetak dan tampilan
- Template cetak dengan pengaturan, ringkasan, tanda tangan, nomor halaman, dan cetak khusus jurnal, buku besar, neraca percobaan, saldo awal, dan master akun.
- V19 memakai `styles.css`, `palm-glass-theme.css`, ikon lokal, dan vendor XLSX lokal. V20 harus mempertahankan kualitas visual dan bekerja offline tanpa CDN.

## Aturan akuntansi inti yang wajib menjadi acceptance criteria
1. Draft tidak dihitung sebagai mutasi laporan.
2. Hanya jurnal POSTED yang masuk ke Buku Besar dan Neraca Percobaan.
3. Jurnal POSTED tidak diedit langsung; gunakan koreksi/pembalik atau alur administrasi yang diaudit.
4. Saldo awal diambil dari data Saldo Awal ACC & Program untuk periode yang sesuai.
5. Saldo akhir akun = saldo awal neto + debit POSTED − kredit POSTED.
6. Total debit dan kredit Neraca Percobaan harus seimbang sebelum periode dapat ditutup.
7. Periode tertutup mengunci perubahan data, tetapi laporan tetap dapat dibaca.
8. SANDI akun harus mengacu ke satu Master Akun sumber kebenaran.
9. Impor DBF harus mempertahankan struktur field dari template sumber; jangan menebak lebar/tipe/desimal.
10. Backup/restore dan migrasi harus menjaga data serta dapat diverifikasi.

## Perbedaan V20 saat ini
V20 saat ini baru memiliki fondasi Electron, SQLite/sql.js, ringkasan dashboard, navigasi awal, dan CRUD Master Akun dasar. Menu V20 saat ini belum setara dengan inventaris 18 menu V19; beberapa halaman masih placeholder. Skema SQLite V20 saat ini belum memuat semua entitas V19. Ini adalah kerangka awal, bukan hasil migrasi penuh.

## Strategi migrasi yang disetujui
1. Lengkapi audit spesifikasi per modul dan alur tombol/validasi/ekspor/cetak.
2. Tetapkan model data SQLite V20 dan versi migrasi skema.
3. Bangun navigasi V20 lengkap sesuai inventaris V19, lalu migrasikan modul satu per satu.
4. Migrasikan dan uji aturan jurnal, saldo awal, anggaran, periode, buku besar, dan laporan.
5. Migrasikan import/export CSV/XLSX/DBF dengan fixture file asli yang disamarkan/disposable.
6. Migrasikan administrasi, audit, validasi, arsip, backup/restore, dan cetak.
7. Buat alat import backup JSON V19 ke SQLite V20 dengan dry-run, laporan konflik, backup sebelum import, dan rekonsiliasi jumlah/total.
8. Jalankan pengujian regresi dan uji Windows x86/x64; klaim Windows 7 hanya setelah uji nyata pada target.

## Status
Audit tahap awal selesai berdasarkan sumber yang tercantum. Detail field, aturan tombol, semua alur cabang, hasil cetak, dan perilaku file DBF masih memerlukan pengujian kasus per kasus sebelum modul terkait dinyatakan setara.
