# Audit Kesenjangan V19 → V20

Tanggal audit: 2 November 2026  
Ruang lingkup: perbandingan file V19 dan V20 yang dibaca langsung dari branch `main`.  
**Batas aman:** repository V19 hanya dibaca. Seluruh perubahan hanya dilakukan pada repository V20.

## Referensi snapshot yang diperiksa

| Komponen | Repository | File SHA |
|---|---|---|
| V19 UI | SBP-Accounting | `v19/index.html` · `3b76142f1f1bb0d4b1978bc985e670f5047e44a9` |
| V19 logic | SBP-Accounting | `v19/app.js` · `dd28027b0099e9b20828cfbab3656ec9cc6bb835` |
| V19 style | SBP-Accounting | `v19/styles.css` · `c91eaa21974caee6d17b9a588302bcc5a64ab398` |
| V19 theme | SBP-Accounting | `v19/palm-glass-theme.css` · `742a1d174530c4b40f1c54dcd5d291971d890718` |
| V20 UI | SBP-Accounting-Windows | `src/index.html` · `15e4cbf912f3ae672d3c76c6d8cbfbe896d7f6cc` |
| V20 logic | SBP-Accounting-Windows | `src/app.js` · `60dda06f5cd2dfc71b899e0aced86537a46d8b73` |
| V20 style sebelum polish | SBP-Accounting-Windows | `src/styles.css` · `4e01a0ffd124b900067a82b036ae6bc083927f5e` |
| V20 database | SBP-Accounting-Windows | `electron/schema.sql` · `9c97c01b09434b03585b8cd75fb4518f87836ac8` |
| V20 IPC | SBP-Accounting-Windows | `electron/main.js` · `6e791de72e68d1606f95a982f3d747ae17c83ee5` |

## Temuan utama

V19 memiliki 18 menu utama, sekitar 20 section halaman (termasuk halaman NPTRANS), 267 referensi elemen DOM dari JavaScript, dan sekitar 230.8 KB logika aplikasi. V20 sudah menampilkan 18 menu, tetapi file JavaScript renderer yang diperiksa sekitar 63.0 KB dengan 167 referensi elemen DOM. Kesamaan nama menu tidak berarti fitur di dalamnya sudah setara.

## Matriks kesenjangan fungsional

Status menggunakan tiga kategori:
- **Ada sebagian**: sudah ada struktur atau fungsi dasar, tetapi belum setara dengan alur V19.
- **Belum terverifikasi / belum diterapkan**: tidak ditemukan implementasi lengkap di file V20 yang diperiksa.
- **Perlu uji runtime**: kode tersedia, tetapi hasil operasional dan keselamatan data belum dibuktikan dengan pengujian aplikasi.

### 1. Dashboard
- V20: ringkasan akun, draft, posted dan status database.
- V19: ringkasan debit/kredit, jumlah transaksi, jurnal terbaru, akses cepat dan status pembukuan.
- Kesenjangan: dashboard V20 belum memberi ringkasan nominal debit/kredit dan aktivitas terbaru setara V19.

### 2. Jurnal Maintenance
- V20: input multi-baris dasar, simpan draft, posting, edit draft.
- Belum setara V19: impor jurnal massal dari Excel, template massal, pratinjau baris dan kesalahan, validasi massal, posting massal berdasarkan tanggal/bulan/rentang, mode review, split jurnal POSTED dengan kelompok baris dan alasan, serta ekspor jurnal XLSX.
- Perlu uji: edit draft, posting, nomor bukti unik, periode terkunci, dan perlindungan jurnal POSTED.

### 3. Daftar Jurnal
- V20: daftar dan filter dasar.
- Belum setara V19: pagination/page size, navigasi halaman, ekspor XLSX, dialog cetak dan filter cetak, split jurnal dari daftar, ringkasan status/total yang lebih lengkap.
- Administrasi jurnal: reversal dan correction draft sudah punya backend, tetapi alur UI dan kontrolnya harus diuji end-to-end.

### 4. Nota Debet
- V20: API dan tampilan dasar untuk draft/post/cancel.
- Perlu disamakan dengan V19: nomor nota otomatis, pemilihan transaksi sumber dari jurnal POSTED, pencarian dan pengelompokan sumber, beberapa baris rincian, edit/view dokumen, serta pemeriksaan total dan tautan jurnal.
- Catatan: model V20 saat ini harus diperiksa untuk memastikan arah nota diterima/diterbitkan dan jenis transaksi tidak hilang dalam migrasi.

### 5. Master Akun / Sandi Perkiraan
- V20: CRUD dasar, cari, aktif/nonaktif, hapus dengan pembatasan.
- Belum setara V19: impor akun dari CSV/XLSX dengan mapping header, preview, laporan kesalahan, template akun CSV/XLSX, ekspor akun CSV/XLSX, sinkronisasi SANDI NPTRANS.
- Prinsip wajib: Master Akun satu-satunya sumber kebenaran SANDI; saldo awal dan jurnal hanya mereferensikan akun, tidak membuat duplikasi.

### 6. Saldo Awal ACC & Program
- V20: input dan impor awal, daftar saldo per periode.
- Belum setara V19: preview impor yang lebih lengkap, ekspor, pemetaan program dan akun yang konsisten, validasi saldo ganda, status jurnal akun, serta integrasi penuh dengan Trial Balance dan buku besar.
- Wajib diuji: saldo awal debit/kredit, program kosong vs program bernilai, dan beberapa program pada SANDI yang sama.

### 7. Anggaran Tahunan
- V20: daftar dan penyimpanan anggaran bulanan per SANDI; preview anggaran pada form jurnal ada sebagian.
- Belum setara V19: impor workbook dengan pemetaan kolom, preview dan laporan kesalahan, distribusi anggaran, reset, validasi anggaran, ringkasan realisasi tahunan, persentase pemakaian, sisa anggaran, serta kontrol realisasi per akun/per bulan yang lengkap.
- Wajib: realisasi hanya dari jurnal POSTED, bukan DRAFT; rumus debit/kredit mengikuti jenis akun dan kebijakan anggaran yang ditetapkan.

### 8. Periode Akuntansi
- V20: buka/tutup/buka kembali dan pemeriksaan neraca saat tutup tersedia pada backend.
- Belum setara V19: pilihan periode aktif, ringkasan total transaksi per periode, kontrol guard terpusat pada semua jalur mutasi, dan alur catatan/tanggung jawab penutupan.
- Perlu uji: tidak ada celah perubahan melalui modul import, nota debet, jurnal massal, koreksi, atau restore yang melewati periode tertutup.

### 9. Buku Besar
- V20: laporan buku besar backend dan tampilan dasar.
- Belum setara V19: saldo awal bersih, saldo berjalan per transaksi, status jurnal, ekspor XLSX, cetak buku besar, filter akun/periode yang setara, serta validasi hasil terhadap Trial Balance.

### 10. Laporan / Neraca Percobaan
- V20: Trial Balance backend dan tampilan dasar; income summary backend ada.
- Belum setara V19: ekspor XLSX dan cetak laporan.
- Belum selesai: laporan laba rugi dan neraca yang benar-benar ditampilkan; klasifikasi akun dan pemetaan saldo harus diverifikasi sebelum menyebut laporan keuangan lengkap.
- Aturan hitung yang wajib dipertahankan: saldo awal dari ACC & Program; mutasi hanya jurnal POSTED; DRAFT tidak dihitung; saldo akhir per SANDI; total debit akhir harus sama dengan kredit akhir sebelum tutup periode.

### 11. Pusat Data Import / NPTRANS
- V20: tab import NPTRANS, CSV/XLSX/DBF parsing dasar, import master akun dan saldo awal tersedia sebagian.
- Belum setara V19: pengelolaan template DBF sumber, mapping field yang eksplisit, preview/validasi penuh, deteksi duplikat, pembatalan import, ekspor NPTRANS CSV/XLSX/DBF dengan mempertahankan struktur DBF asli, sinkronisasi SANDI, pembentukan draft jurnal dari NPTRANS, dan kontrol password sesuai kebijakan.
- **Kritis:** jangan menebak struktur NPSALDO.DBF atau NPTRANS DBF. Perlu contoh file sumber nyata dan pemeriksaan field/tipe/urutan/ukuran sebelum mapping dan ekspor dibuat.
- V19 tidak boleh dijadikan database bersama; migrasi ke V20 harus melalui file ekspor/impor terkontrol.

### 12. Validasi & Integritas Data
- V20: pemeriksaan backend dasar tersedia.
- Belum setara V19: tampilan kategori kesalahan, hasil per baris, ekspor hasil validasi, pemeriksaan akun tak dikenal, duplikat nomor bukti, keseimbangan jurnal, periode tertutup, konsistensi NPTRANS, saldo awal, anggaran, serta tautan antar dokumen.

### 13. Administrasi Jurnal
- V20: reversal dan correction-draft tersedia di backend dan sebagian UI.
- Belum setara V19: split POSTED yang lengkap, bulk posting dengan review, pembatalan/penyesuaian yang dapat ditelusuri, penghapusan paksa berdasarkan periode dengan autentikasi yang aman, dan daftar riwayat tindakan.
- Jurnal POSTED tidak boleh diedit atau dihapus langsung; koreksi harus meninggalkan jejak dan jurnal asal.

### 14. Template Cetak
- V20: penyimpanan pengaturan dan CSS halaman dasar.
- Belum setara V19: dialog konfigurasi cetak jurnal, mode cetak daftar jurnal, laporan, buku besar, saldo awal, master akun, kop, ringkasan, tanda tangan, nomor halaman, orientasi otomatis, dan pratinjau konsisten.
- Perlu uji printer nyata: ukuran F4 210×330 mm, A4, margin, skala, pemenggalan tabel dan nomor halaman.

### 15. Riwayat Aktivitas / Audit
- V20: endpoint daftar audit dan beberapa aksi menulis audit.
- Belum setara V19: audit lengkap untuk semua mutasi dan impor, before/after yang konsisten, identitas pelaku, filter, ekspor CSV, dan bukti korelasi dokumen.
- Tidak cukup hanya menampilkan tabel audit jika operasi lain tidak mencatat aktivitas.

### 16. Arsip 5 Tahunan & Pembaca Arsip
- V20: buat arsip JSON, daftar dan baca arsip dasar.
- Belum setara V19: validasi checksum saat dibaca, retensi 5 tahun yang benar, arsip NPTRANS, pembacaan akun/jurnal/ledger/Trial Balance, pencarian dan filter, serta mode read-only yang lengkap.
- Perlu uji: file rusak, checksum berubah, periode kosong, dan data arsip tidak bercampur dengan database aktif.

### 17. Backup & Restore
- V20: simpan backup SQLite dan restore dengan backup keselamatan serta integrity check dasar.
- Belum setara V19: backup otomatis terjadwal/berdasarkan perubahan, pengaturan lokasi backup, pengingat saat startup, rotasi backup, verifikasi backup, dan pemulihan yang diuji pada salinan database.
- Wajib: uji restore hanya pada salinan, jangan pernah menguji pada satu-satunya database kerja.

## Temuan desain / kerapian UI

1. Sidebar V20 memakai simbol karakter Unicode yang tidak konsisten, belum memakai ikon satu keluarga.
2. Hirarki ukuran judul, label, teks bantu, jarak panel dan tabel belum konsisten.
3. Lebar konten dan tinggi area kerja belum diatur sebagai sistem layout terpadu.
4. Tabel panjang perlu header, kolom angka rata kanan, lebar minimum, dan scroll horizontal yang terkontrol.
5. Form jurnal dan panel anggaran perlu jarak serta alignment konsisten.
6. Tampilan mobile/resolusi kecil belum cukup matang.
7. CSS awal relatif singkat dibanding dua lapis CSS V19; perlu satu sistem desain tunggal dan menghindari penumpukan override yang saling bertentangan.

## Prioritas implementasi berikutnya

**P0 — keselamatan dan kesetaraan inti**
- Pastikan aturan POSTED/DRAFT, periode terkunci, saldo awal, Master Akun, dan Trial Balance.
- Selesaikan import center NPTRANS + template DBF berdasarkan file sumber nyata.
- Migrasi data V19 ke V20 melalui preview, mapping, validasi, backup, dan laporan hasil.

**P1 — fitur operasional yang hilang**
- Jurnal massal, split jurnal, posting massal, ekspor/cetak.
- Master Akun dan Saldo Awal: template, import/export, validasi.
- Buku Besar, Neraca Percobaan, Laba Rugi, Neraca, ekspor/cetak.
- Nota Debet lengkap dan audit semua mutasi.

**P2 — administrasi dan arsip**
- Retensi arsip 5 tahun dan checksum verify.
- Backup otomatis, rotasi, dan restore drill.
- Audit filter/export dan laporan validasi.

**P3 — kualitas**
- Uji printer F4, A4 dan Windows.
- Uji database lama/migrasi, file rusak, dan skenario data besar.
- Uji Windows 7 SP1 x86/x64 secara langsung; jangan klaim kompatibel sebelum pengujian.
- Uji seluruh alur aplikasi setelah build installer.

## Perubahan visual yang sudah dilakukan pada audit ini

Pada commit `c7ecb7cdcee80cbe339e7d4dd6c86ba501ca8107`, hanya file `src/styles.css` V20 yang diperbarui dengan satu lapisan sistem visual: sidebar, topbar, spacing, panel, tabel, form, tombol, modal, responsive, dan print baseline. Tidak ada file V19 yang diubah. Tampilan tetap harus diverifikasi langsung di aplikasi Windows pada resolusi kerja.

## Batas klaim

Audit kode bukan bukti bahwa seluruh fitur telah diuji. Build sukses pun tidak membuktikan alur akuntansi benar. Setiap modul harus diuji dengan database salinan dan dataset contoh sebelum dinyatakan selesai.
