# Audit Mendalam Kesenjangan Fitur V19 → V20

Audit statis langsung dari file branch main pada 2 November 2026. V19 hanya dibaca; tidak ada file V19 yang diubah.

## Snapshot file yang diperiksa

- V19 `v19/app.js`: `dd28027b0099e9b20828cfbab3656ec9cc6bb835` (230,797 karakter; 172 fungsi bernama)
- V19 `v19/index.html`: `3b76142f1f1bb0d4b1978bc985e670f5047e44a9` (60,948 karakter; 312 ID HTML)
- V20 `src/app.js`: `646bd89b25159c3ab018df85d591ebd11c3df2df` (63,065 karakter; 42 fungsi bernama)
- V20 `src/index.html`: `15e4cbf912f3ae672d3c76c6d8cbfbe896d7f6cc` (27,552 karakter; 189 ID HTML)
- V20 `electron/main.js`: `6e791de72e68d1606f95a982f3d747ae17c83ee5`
- V20 `electron/preload.js`: `f2c5c1a7d99c42f8690b3fba7283d6c2e4d7c94d`
- V20 `electron/schema.sql`: `9c97c01b09434b03585b8cd75fb4518f87836ac8`

## Ringkasan kuantitatif

Angka ukuran file/fungsi/ID adalah indikator cakupan, bukan ukuran kualitas. Namun, 172 fungsi bernama di V19 dibanding 42 fungsi bernama di renderer V20 menegaskan bahwa banyak workflow V19 belum dipindahkan. V20 punya backend IPC tambahan, tetapi keberadaan handler backend tidak sama dengan UI dan alur pengguna yang lengkap.

## Kesenjangan yang terkonfirmasi dari pemeriksaan simbol dan struktur

### A. Jurnal Maintenance — prioritas kritis
Belum ditemukan di V20:
- Import jurnal massal dari file dan template massal.
- Parsing, validasi, preview, daftar error dan konfirmasi batch jurnal.
- Posting massal berdasarkan mode tanggal, bulan, atau rentang tanggal.
- Modal split jurnal POSTED, pengelompokan baris, review, alasan, eksekusi split.
- Ekspor daftar jurnal ke XLSX.
- Dialog status akun terkait jurnal.

V20 saat ini memiliki input jurnal dasar, simpan draft, posting, edit draft, dan daftar jurnal. Ini belum menggantikan workflow V19.

### B. Daftar Jurnal
Belum ditemukan:
- Pagination, page size, prev/next dan informasi halaman.
- Split dari daftar jurnal.
- Ekspor XLSX.
- Mode cetak daftar jurnal, pemilihan status dan konfirmasi cetak.
- Filter dan ringkasan daftar yang setara.

### C. Master Akun / Sandi Perkiraan
Belum ditemukan:
- Ekspor akun CSV dan XLSX.
- Template akun CSV dan XLSX.
- Import akun dengan mapping header yang matang, preview, daftar kesalahan, konfirmasi, pembatalan.
- Sinkronisasi SANDI terhadap data NPTRANS.
V20 memiliki CRUD akun dasar dan import akun yang terbatas.

### D. NPTRANS / Import Center — prioritas kritis
Belum ditemukan:
- Pengelolaan template DBF sumber dan struktur field secara lengkap.
- Ekspor NPTRANS CSV/XLSX/DBF yang mempertahankan struktur template DBF asli.
- Pembentukan draft jurnal dari NPTRANS.
- Pembatalan import NPTRANS dan rollback batch secara aman.
- Sinkronisasi SANDI dan kontrol duplikasi/rekonsiliasi penuh.
- Preview dan pemeriksaan record aktif/deleted, mapping, tipe data, panjang field, tanggal, nominal, serta nomor bukti.
NPSALDO.DBF mapping juga belum terbukti. Jangan menebak struktur field: perlu file contoh asli.

### E. Saldo Awal ACC & Program
V20 memiliki input dan import dasar. Belum ditemukan kesetaraan penuh dengan:
- Preview impor lengkap dan error per baris.
- Template, ekspor, pemetaan header yang kuat.
- Rekonsiliasi akun/program dan deteksi konflik/duplikasi yang jelas.
- Status transaksi per akun dan keterkaitan ke laporan.
- Cetak dan ekspor daftar saldo awal.

### F. Anggaran Tahunan
V20 memiliki CRUD anggaran dan preview jurnal sebagian. Belum ditemukan:
- Import workbook anggaran dan pemetaan header.
- Preview impor, validasi per bulan/akun dan laporan error.
- Distribusi anggaran dari total tahunan ke 12 bulan.
- Reset anggaran dengan konfirmasi.
- Ringkasan realisasi tahunan, persentase, sisa, dan validasi anggaran penuh.
- Perhitungan realisasi yang konsisten hanya dari POSTED serta kebijakan saldo normal per jenis akun.
Tombol/teks distribusi yang muncul di HTML tidak membuktikan fungsi sudah tersambung; tidak ditemukan API distribusi di preload/backend.

### G. Buku Besar dan Laporan
V20 memiliki backend ledger dan trial balance, serta income-summary backend. Belum ditemukan:
- Ekspor Buku Besar XLSX.
- Ekspor Trial Balance XLSX.
- Cetak Buku Besar, Trial Balance, saldo awal, master akun, dan daftar jurnal.
- Saldo berjalan per transaksi, status jurnal, detail transaksi dan kontrol rentang laporan setara V19.
- Laporan Laba Rugi dan Neraca yang disajikan utuh dengan klasifikasi akun dan rekonsiliasi.
Income-summary backend saja belum berarti laporan laba rugi sudah tersedia untuk pengguna.

Aturan hitung wajib:
1. Saldo awal berasal dari ACC & Program.
2. Mutasi berasal hanya dari jurnal POSTED pada periode.
3. DRAFT tidak dihitung.
4. Saldo akhir dihitung per SANDI.
5. Total debit akhir sama dengan total kredit akhir sebelum penutupan periode.

### H. Nota Debet
V20 memiliki CRUD dasar, post/cancel dan pembuatan jurnal tertaut. Belum ditemukan kesetaraan penuh:
- Nomor otomatis sesuai pola dan periode.
- Pencarian transaksi sumber POSTED, pengelompokan sumber dan pemilihan transaksi.
- Edit, view/detail dan pencarian nota.
- Arah/jenis nota, sumber, rincian, relasi dan validasi bisnis seperti V19.
- Cetak dan ekspor dokumen.
Perlu validasi bahwa cancel nota yang sudah POSTED tidak merusak jurnal tertaut dan selalu meninggalkan jejak.

### I. Periode Akuntansi
V20 memiliki buka/tutup/buka kembali backend. Belum terbukti:
- Periode aktif dan pemilihan periode global.
- Ringkasan aktivitas/mutasi periode.
- Guard periode terpusat untuk semua jalur: jurnal, batch, nota, import NPTRANS, saldo awal, anggaran, koreksi, reversal.
- Pengendalian force delete dengan otorisasi.
Penutupan periode harus memvalidasi saldo akhir, draft, dan semua transaksi sumber.

### J. Validasi Data
V20 memiliki validasi backend dasar. Belum ditemukan UI/fitur selengkap V19:
- Error per kategori dan per record dengan tautan menuju sumber masalah.
- Validasi import, akun tidak dikenal, nomor bukti ganda, keseimbangan jurnal, status POSTED/DRAFT, periode, saldo awal, anggaran, NPTRANS.
- Ekspor hasil validasi dan riwayat hasil.
- Pemeriksaan konsistensi relasi antar dokumen.

### K. Journal Admin
V20 sudah memiliki backend reversal dan correction draft. Belum ditemukan:
- Split POSTED lengkap.
- Posting massal dengan preview/review.
- Force delete berdasarkan tanggal/bulan/tahun dengan autentikasi dan audit.
- Riwayat koreksi, alasan, tautan jurnal asal/hasil dan kontrol agar tidak ada edit langsung terhadap POSTED.
Jurnal POSTED harus tetap immutable; koreksi dilakukan melalui dokumen baru.

### L. Cetak
V20 menyimpan pengaturan cetak dan memiliki print CSS dasar. Belum ditemukan:
- Dialog print jurnal dan daftar jurnal.
- Template cetak master akun, saldo awal, ledger, trial balance.
- Print summary, tanda tangan, kop, nomor halaman, pilihan orientasi dan pratinjau per dokumen setara V19.
- Verifikasi output F4/A4 di driver printer nyata.
Jangan mengandalkan satu CSS umum untuk semua dokumen akuntansi.

### M. Audit Log
V20 memiliki daftar audit dan beberapa aksi menulis audit. Belum ditemukan:
- Ekspor audit CSV.
- Audit perubahan sebelum/sesudah secara menyeluruh pada semua mutasi.
- Pencatatan import, posting batch, split, force delete, restore, perubahan periode dan pengaturan.
- Filter tanggal/aksi/entitas/pelaku dan korelasi dokumen.
Audit harus lengkap, bukan hanya tabel yang menampilkan beberapa event.

### N. Arsip Tahunan dan Pembaca Arsip
V20 memiliki create/list/read JSON. Belum ditemukan:
- Verifikasi checksum saat arsip dibaca.
- Retensi 5 tahun otomatis dan aturan rotasi.
- Pembaca arsip untuk akun, jurnal, NPTRANS, ledger, Trial Balance.
- Pencarian, filter dan ringkasan terpisah untuk arsip.
- Uji file rusak dan arsip yang tidak cocok.
Arsip harus read-only dan tidak boleh bercampur dengan database operasional.

### O. Backup & Restore
V20 memiliki backup manual dan restore dengan integrity check serta backup keselamatan. Belum ditemukan:
- Backup otomatis dan antrean backup.
- Pilih/sambungkan folder backup dan izin folder.
- Reconnect folder saat aplikasi dibuka ulang.
- Jadwal/trigger backup, retensi/rotasi, verifikasi backup.
- Pengingat backup pada startup dan riwayat backup.
Restore harus diuji di salinan database, bukan satu-satunya data aktif.

### P. Migrasi V19 → V20 — pekerjaan penting yang belum terlihat
Belum ada alur migrasi menyeluruh yang terkonfirmasi:
- Baca ekspor data V19, pemetaan akun/jurnal/saldo/anggaran/NPTRANS.
- Preview jumlah record dan konflik.
- Deteksi duplikat dan SANDI tak dikenal.
- Laporan baris yang ditolak dan yang berhasil.
- Backup database V20 sebelum migrasi dan rollback.
- Rekonsiliasi total debit/kredit, saldo awal, jumlah jurnal, status dan periode.
V20 tidak boleh memakai database V19 secara langsung. Migrasi harus file-based dan terkontrol.

## Hal yang sudah ada di V20 (jangan dihitung sebagai kosong)
- Electron desktop, SQLite lokal, schema migrations.
- CRUD Master Akun dasar.
- Jurnal dasar: draft, posting, edit draft, daftar.
- Anggaran akun/bulanan dasar dan preview anggaran jurnal sebagian.
- Input dan import saldo awal dasar.
- Import NPTRANS dasar.
- Nota Debet dasar.
- Periode buka/tutup/buka kembali.
- Backend Trial Balance dan Ledger.
- Backend income summary.
- Validasi dasar.
- Daftar audit.
- Pengaturan cetak dasar.
- Arsip JSON dasar.
- Backup manual dan restore dasar.
- Reversal dan correction-draft backend.

## Prioritas pengembangan terintegrasi

**P0 — integritas dan migrasi**
- Guard periode dan aturan POSTED/DRAFT pada semua jalur mutasi.
- Migrasi V19 file-based dengan preview, backup, rollback, rekonsiliasi.
- NPTRANS/NPSALDO DBF mapping berdasarkan file contoh riil.
- Validasi data lengkap.

**P1 — transaksi**
- Jurnal massal, split, bulk posting, ekspor.
- Nota Debet setara workflow V19.
- Master Akun dan Saldo Awal import/export lengkap.
- Anggaran import/distribusi/realisasi.

**P2 — laporan**
- Buku Besar, Trial Balance, Laba Rugi, Neraca.
- Ekspor XLSX dan cetak per jenis laporan.

**P3 — kontrol dan arsip**
- Audit semua mutasi + CSV.
- Arsip 5 tahun + checksum verify + reader lengkap.
- Backup otomatis, folder, retensi dan uji restore.

**P4 — verifikasi**
- Uji data besar, skenario error, printer F4/A4, resolusi layar, Windows 7 SP1 x86/x64 secara langsung.
- Build installer sukses bukan bukti semua workflow berjalan.

## Catatan keamanan dan ruang lingkup
- Repository V19 tetap read-only.
- Semua implementasi dilakukan hanya di SBP-Accounting-Windows.
- Jangan menghapus database atau folder pengguna saat memperbaiki aplikasi.
- Jangan menyatakan fitur selesai hanya karena menu, tombol, IPC handler, atau tabel database sudah ada. Selesai berarti UI → validasi → backend → database → laporan/ekspor/cetak diuji end-to-end.
