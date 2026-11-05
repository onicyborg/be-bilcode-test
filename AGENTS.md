# Panduan backend

- Backend berada di `backend/`. Gunakan modul NestJS per domain, controller untuk HTTP dan Swagger, service untuk aturan bisnis, dan query PostgreSQL berparameter.
- Jalankan `pnpm install --frozen-lockfile`, `pnpm run build`, dan uji alur terkait dengan PostgreSQL 18. Gunakan Prisma Migrate dan simpan riwayat di `backend/prisma/migrations/`. Jangan ubah migrasi yang telah diterapkan.
- Semua primary key memakai UUIDv7 bawaan PostgreSQL. Jaga konsistensi migrasi, ERD, dan kontrak API. Perbarui Swagger untuk setiap endpoint yang dibuat atau berubah.
- Access JWT berlaku 15 menit. Refresh JWT memakai secret terpisah dan rotasi sekali pakai. Simpan digest token. Selalu periksa status aktif, verifikasi email, dan soft delete sebelum mengizinkan akses.
- Gunakan DTO tervalidasi dan dokumentasikan respons sukses serta error. Jangan masukkan secret, password, token, email, koordinat, atau isi foto ke audit log.
- Mutasi sukses dan audit terkait berada dalam satu transaksi. Pertahankan aturan soft delete dan retensi satu bulan kalender UTC saat mengimplementasikan domain laporan.
- Gunakan `Database.prisma` untuk query ORM baru. Pertahankan SQL berparameter untuk operasi yang membutuhkan penguncian atau constraint khusus. Buat migrasi lokal dengan `prisma migrate dev` dan terapkan di deployment dengan `prisma migrate deploy`. Tinjau SQL untuk constraint yang tidak direpresentasikan oleh skema Prisma. Jalankan validasi Prisma dan build sebelum menyerahkan perubahan.
