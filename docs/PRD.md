# PRD — Smart Waste Management System

## Tujuan

Pengguna dapat melaporkan sampah dari Android dan memantau penanganannya. Admin dapat menemukan dan menindaklanjuti laporan dari website. Klasifikasi AI membantu mengidentifikasi jenis sampah dari foto.

## Cakupan dan kriteria penerimaan

| ID | Kebutuhan | Kriteria penerimaan |
| --- | --- | --- |
| P01 | Akun dan akses | Pengguna bisa daftar dan login dari Android. Admin dan pengguna dapat login ke website. Pengguna hanya dapat membaca data laporannya sendiri dan tidak dapat mengakses pengelolaan akun atau perubahan status. |
| P02 | Laporan mobile | Pengguna dapat membuat laporan dengan foto, GPS, dan deskripsi. Dashboard dan riwayat menampilkan laporan baru sebagai Pending. Detail menunjukkan hasil AI atau keterangan jika prediksi gagal. |
| P03 | Website laporan | Website menampilkan statistik sesuai role. Pengguna bisa membuat, melihat, mengedit, dan menghapus laporan sesuai izin. Daftar mendukung pencarian dan filter. Halaman utama tetap dapat dipakai pada layar sempit. |
| P04 | Operasional admin | Admin bisa melihat semua laporan, memeriksa detail dan riwayat, serta mengubah status. Setelah refresh di Android, pengguna melihat perubahan pada laporan yang sama. Admin bisa mencari, menonaktifkan, dan menghapus akun User. |
| P05 | Klasifikasi gambar | Model memprediksi Organic, Plastic, dan Paper melalui API. Dataset berisi minimal 150 gambar dengan sumber tercatat. Evaluasi pada test set terpisah menghasilkan accuracy, confusion matrix, dan classification report. Target akurasi testing minimal 80%. |
| P06 | Audit dan retensi | Aktivitas berhasil maupun gagal memiliki catatan audit tanpa kredensial atau isi data sensitif. Data terhapus langsung hilang dari akses normal dan layak dipurge setelah satu bulan kalender. |

## Urutan pengerjaan

1. Awal hari pertama, verifikasi Flutter/Android dengan build kosong dan cari dataset untuk tiga kategori. Jalankan baseline ML sedini mungkin agar masih ada waktu untuk evaluasi.
2. Hari pertama, bangun satu alur yang berjalan dari login dan pembuatan laporan sampai perubahan status admin terlihat di mobile. Integrasikan prediksi nyata dan penyimpanan foto.
3. Hari kedua, lengkapi fungsi website, pengelolaan akun, audit, purge, dan evaluasi ML. Siapkan deployment dan APK sejak awal hari kedua, lalu uji alur dari perangkat Android terhadap API demo.
4. Sisakan waktu untuk merekam dan memeriksa tautan serta kredensial demo.

## Demo dan pengumpulan

Buat satu laporan di Android, tampilkan prediksi, temukan laporan yang sama di website admin, ubah statusnya, lalu refresh di Android. Tutup dengan hasil evaluasi model dan penjelasan singkat arsitektur. Video maksimal 10 menit.

Paket pengumpulan mencakup repository GitHub, link demo website, APK atau link demo mobile, dokumentasi API, ERD/skema, kode dan model ML, dataset beserta sumber, hasil evaluasi, dan README instalasi serta penggunaan.
