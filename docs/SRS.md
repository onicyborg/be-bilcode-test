# SRS — Smart Waste Management System

## Komponen

| Komponen | Tanggung jawab |
| --- | --- |
| Next.js | Login Admin/User, dashboard, CRUD laporan sesuai role, pencarian dan filter, pengelolaan pengguna. |
| Flutter Android | Register/login, dashboard, foto dan GPS, kirim laporan, riwayat dan detail. |
| NestJS | REST API publik, autentikasi dan izin, akses data dan foto, audit, scheduler purge, klien ML. |
| PostgreSQL 18 | Akun, laporan, riwayat status, dan audit. Setiap primary key dibuat dengan UUIDv7. |
| FastAPI + TensorFlow/Keras | Prediksi internal menggunakan model MobileNetV2 hasil transfer learning. |

Web dan mobile berkomunikasi dengan NestJS. NestJS mengakses PostgreSQL, penyimpanan foto, dan FastAPI. Bentuk endpoint dan payload ditetapkan di [API.md](API.md). Struktur data ditetapkan di [schema.dbml](schema.dbml) dan DDL di [schema.sql](schema.sql).

## Aturan sistem

- **Akses.** Registrasi publik selalu membuat akun USER. Admin disiapkan lewat seed. NestJS memeriksa token, role, status akun, dan kepemilikan sebelum mengakses laporan atau foto. Respons laporan milik pengguna lain adalah 404.
- **Pembuatan laporan.** Validasi foto JPEG/PNG, koordinat, dan deskripsi. Simpan foto pada penyimpanan yang bertahan saat layanan restart. Backend mengirim foto ke FastAPI dan menyimpan kategori, confidence, dan versi model jika berhasil. Jika prediksi gagal, simpan laporan dengan prediksi kosong. Simpan laporan dan riwayat awal dalam satu transaksi.
- **Perubahan laporan.** Admin atau pemilik dapat mengedit deskripsi dan GPS atau melakukan soft delete saat PENDING. Hanya Admin dapat mengubah status. Transisi mengikuti kontrak API dan perubahan status serta riwayat ditulis dalam satu transaksi dengan penguncian baris laporan. Statistik mengecualikan data terhapus.
- **Audit.** Catat aktivitas berhasil dan gagal sesuai kontrak API. Gunakan daftar field yang diizinkan per aksi. Audit untuk mutasi sukses ikut dalam transaksi bisnis. ID audit tetap dapat digunakan untuk korelasi setelah objek dipurge.
- **Retensi.** Penghapusan akun USER oleh admin menandai akun dan seluruh laporannya dalam satu transaksi. Worker harian berjalan pukul 03:00 UTC. Setelah satu bulan kalender UTC, hapus foto terlebih dahulu, lalu baris laporan dan riwayatnya. Hapus akun setelah semua laporannya dipurge. Ulangi penghapusan yang gagal pada jadwal berikutnya. Audit memiliki retensi terpisah yang belum ditetapkan.

## Training dan evaluasi ML

Dokumentasikan sumber, jumlah gambar per kategori, dan cara menyiapkan dataset. Pisahkan train, validation, dan test secara stratified sebelum augmentasi. Pisahkan gambar duplikat atau dari objek yang sama agar kelompoknya tidak tersebar antar split. Gunakan validation untuk memilih model dan jalankan evaluasi akhir pada test set. Simpan model, mapping kategori, seed, dan hasil accuracy, confusion matrix, serta classification report. Preprocessing inferensi mengikuti preprocessing evaluasi. Catat hasil akurasi aktual dan apakah target 80% tercapai.

## Pemeriksaan sebelum pengumpulan

- Buat laporan dari Android menggunakan API demo. Periksa foto, koordinat, dan prediksi di website. Ubah status dan pastikan aplikasi menampilkan status baru setelah refresh.
- Uji akun User yang mencoba membuka laporan dan foto pengguna lain serta mencoba mengubah status. Uji validasi foto, izin GPS, dan layanan ML yang tidak tersedia.
- Periksa log login gagal dan mutasi sukses. Pastikan payload serta response audit bebas dari password, token, dan data sensitif lain.
- Jalankan purge terhadap fixture bertanggal sebelum dan sesudah batas satu bulan. Pastikan hanya data yang jatuh tempo dan fotonya terhapus, sementara audit tetap tersedia.
- Jalankan aplikasi dari README dan periksa akses tautan demo, APK, ERD, dokumentasi API, serta artefak ML.
