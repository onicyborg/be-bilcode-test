# Kontrak API sementara

Next.js dan Flutter menggunakan REST API NestJS di `/api/v1`. NestJS memanggil FastAPI melalui jaringan internal. PostgreSQL 18 membuat UUIDv7 lewat `uuidv7()` untuk setiap primary key. API mengirim ID sebagai string. Daftar laporan diurutkan berdasarkan `createdAt DESC, id DESC` agar urutan tampilan eksplisit dan stabil.

## Autentikasi dan pengguna

Gunakan `Authorization: Bearer <accessToken>` pada semua endpoint NestJS selain endpoint auth publik pada tabel di bawah. NestJS memeriksa akun belum dihapus, aktif, dan role saat menangani permintaan. Email dipangkas dan diubah ke huruf kecil sebelum penyimpanan dan pencarian. Password minimal 8 karakter dan disimpan sebagai hash. NestJS menyiapkan akun admin lewat seed.

| Metode dan path | Akses | Input → hasil |
| --- | --- | --- |
| POST /auth/register | Publik | `{name,email,password}` → 201 `{message}`. Role selalu USER. Masukkan kode verifikasi dari email sebelum login. |
| POST /auth/login | Publik | `{email,password}` → 200 `{accessToken,refreshToken,expiresIn,user}`. Email belum terverifikasi mendapat 403. |
| POST /auth/verify-email | Publik | `{email,code}` → 200 `{message}`. Kode adalah string enam digit dan berlaku 10 menit. Kode sekali pakai dan terkunci setelah lima percobaan salah. |
| POST /auth/resend-verification | Publik | `{email}` → 202 `{message}`. Kode baru menggantikan yang lama. Maksimal satu pengiriman per akun per 60 detik. |
| POST /auth/refresh | Publik dengan refresh JWT | `{refreshToken}` → 200 pasangan JWT baru dan user. |
| POST /auth/logout | Publik dengan refresh JWT | `{refreshToken}` → 204. Cabut sesi refresh. |
| GET /auth/me | Admin, User | 200 objek User. |
| GET /users | Admin | `?q=&page=&limit=` → 200 daftar User. Cari berdasarkan email atau nama. |
| PATCH /users/:id | Admin | `{isActive}` → 200 objek User. Pengelolaan dibatasi pada akun USER. |
| DELETE /users/:id | Admin | 204. Hanya untuk akun USER. Tandai akun dan semua laporannya sebagai terhapus dalam satu transaksi. |

`User = {id,name,email,role,isActive,createdAt}`. Role menggunakan `USER` atau `ADMIN`. Access JWT berlaku 15 menit. Refresh JWT berlaku 7 hari dan dirotasi setiap pemakaian. Klien mengganti pasangan token setelah refresh, dan meminta login kembali jika sesi refresh tidak berlaku. Logout mencabut refresh token. Access JWT yang sudah terbit tetap berlaku sampai kedaluwarsa selama akun masih memenuhi syarat.

## Laporan

| Metode dan path | Akses | Input → hasil |
| --- | --- | --- |
| POST /reports | Admin, User | Multipart `photo,latitude,longitude,description` → 201 Report berstatus PENDING. Pelapor berasal dari token. |
| GET /reports | Admin, User | `?q=&status=&category=&page=&limit=` → 200 daftar Report. User melihat laporan miliknya. |
| GET /reports/:id | Admin, pemilik | 200 Report dengan `statusHistory`. |
| GET /reports/:id/photo | Admin, pemilik | 200 biner gambar dengan Content-Type yang sesuai. |
| PATCH /reports/:id | Admin, pemilik | JSON parsial `{description,latitude,longitude}` → 200 Report. Hanya saat PENDING. |
| DELETE /reports/:id | Admin, pemilik | 204. Hanya saat PENDING. Simpan waktu penghapusan dan sembunyikan dari daftar, detail, foto, serta statistik. |
| PATCH /reports/:id/status | Admin | `{status,reason?}` → 200 Report. |
| GET /dashboard/stats | Admin, User | 200 `{total,byStatus}`. Admin melihat agregat seluruh laporan, User agregat laporannya sendiri. |

- `Report = {id,reporterId,description,latitude,longitude,photoUrl,status,prediction,createdAt,updatedAt}`. Koordinat dan confidence dikirim sebagai angka JSON, waktu sebagai ISO 8601 UTC, dan photoUrl mengarah ke endpoint foto dengan autentikasi.
- `prediction` bernilai `{category,confidence,modelVersion}` atau `null`. Kategori API adalah `ORGANIC`, `PLASTIC`, `PAPER`, `GLASS`, `METAL`, `CARDBOARD`, `CLOTHES`, `FOOTWEAR`, `BATTERY`, dan `OTHER`. OTHER mengikuti label trash dari dataset dan tidak menjamin penolakan semua objek di luar kategori. Jika ML tidak tersedia, laporan tetap dibuat dan klien menampilkan “Prediksi tidak tersedia”.
- Deskripsi setelah trim berisi 1–1000 karakter. Foto berupa JPEG/PNG valid, maksimal 5 MiB. Latitude antara −90 dan 90, longitude antara −180 dan 180. Unggah foto baru melalui pembuatan laporan.
- Pencarian laporan memakai deskripsi atau UUID laporan yang cocok persis. Filter status dan kategori dapat digabung. Daftar mengembalikan `{items,page,limit,total}` dengan default `page=1`, `limit=20` dan maksimum `limit=100`.
- `byStatus` berisi jumlah untuk keempat status, termasuk nol. Perubahan status yang sah adalah `PENDING → IN_PROGRESS / REJECTED` dan `IN_PROGRESS → COMPLETED / REJECTED`. Status akhir bersifat final. REJECTED memerlukan alasan 1–500 karakter.
- Riwayat berisi `{id,changedById,fromStatus,toStatus,reason,createdAt}`, terurut dari yang paling awal berdasarkan waktu dan ID. Catatan pertama memakai `fromStatus=null`. Pembuatan laporan dan catatan awal dilakukan dalam satu transaksi. Perubahan status memeriksa status terkini dan menulis laporan serta riwayat dalam satu transaksi. NestJS memperbarui `updated_at` saat laporan atau akun berubah.

## API internal ML

`POST /predict` menerima multipart `photo` dengan batas dan tipe gambar yang sama. Respons 200 berbentuk `{"category":"PLASTIC","confidence":0.9431,"modelVersion":"mobilenetv2-v1"}`. Confidence berada dalam rentang 0–1. Gambar tidak valid menghasilkan 422, ukuran berlebih 413, dan model belum siap 503. NestJS menggunakan batas waktu 10 detik saat memanggil FastAPI. Jika prediksi gagal setelah gambar lolos validasi NestJS, ketiga kolom prediksi disimpan sebagai NULL.

## Respons error NestJS

`{"code":"INVALID_STATUS_TRANSITION","message":"Perubahan status tidak diizinkan."}`

| HTTP | Kapan digunakan |
| --- | --- |
| 400 | ID, query, atau payload tidak valid |
| 401 | Kredensial salah, token tidak valid/kedaluwarsa, atau akun tidak aktif |
| 403 | Role tidak berwenang mengakses endpoint |
| 404 | Data hilang, terhapus, atau laporan milik pengguna lain |
| 409 | Email sudah terdaftar, status tidak dapat diubah, atau laporan sudah tidak PENDING saat diedit/dihapus |
| 413 | Foto melebihi batas |
| 415 | Tipe foto tidak didukung |
| 503 | Audit atau penyimpanan foto tidak tersedia |


## Audit aktivitas

NestJS mencatat satu event untuk setiap request bisnis di `/api/v1`, termasuk register, login, baca data, perubahan data, unduh foto, dan percobaan yang gagal (termasuk kegagalan autentikasi atau validasi). Gunakan template route, metode, status HTTP, hasil, durasi, ID request, serta ID dan role aktor jika identitas sudah terverifikasi. Event internal seperti hasil prediksi dan purge dicatat dengan aksi tersendiri. Untuk request yang belum terautentikasi, ID aktor kosong. Pada register atau login yang berhasil, isi ID aktor dari hasil autentikasi.

Simpan ringkasan JSON request dan response dengan daftar field yang diizinkan per aksi. Contohnya, perubahan status mencatat request `{"status":"REJECTED","reasonProvided":true}` dan response `{"id":"<reportId>","status":"REJECTED"}`. Login mencatat hasil dan ID akun jika terverifikasi. Daftar mencatat filter enum, paginasi, dan jumlah hasil. Error mencatat kode error yang dikenal. Foto dicatat lewat ukuran dan tipe yang tervalidasi. Payload yang tidak punya field aman memakai objek kosong.

Jangan simpan kode verifikasi, password atau hash, token, header autentikasi, cookie, email, nama, teks bebas (termasuk pencarian dan alasan), koordinat GPS, isi foto, maupun pesan error mentah. Audit bersifat append-only bagi aplikasi. Akses dibatasi pada operator database. Log audit menyimpan ID buram tanpa foreign key dan tetap tersedia setelah data operasional dihapus. Retensi log audit sendiri belum ditentukan.

Untuk mutasi sukses, tulis audit dalam transaksi yang sama dengan perubahan data. Jika penulisan audit gagal, rollback mutasi dan kembalikan 503. Untuk request tanpa mutasi atau request gagal, tulis audit di luar transaksi bisnis sebelum mengirim response. Jika database audit tidak tersedia, kembalikan 503 dan catat kegagalan ke log proses tanpa payload. Gunakan ID request untuk mencegah pencatatan ganda dari handler dan middleware dalam satu alur.

## Soft delete dan purge

- DELETE langsung mengisi `deleted_at`. Login, operasi dengan token lama, daftar, detail, foto, dan statistik mengecualikan data terhapus. Email tetap dicadangkan sampai akun dipurge.
- Penghapusan akun USER menandai semua laporan miliknya, termasuk yang telah diproses. Pertahankan `deleted_at` laporan yang sudah terhapus agar masa retensinya tidak dimulai ulang. Riwayat ikut disembunyikan bersama laporan.
- Worker NestJS berjalan setiap hari pada 03:00 UTC. Data layak dipurge saat waktu sekarang mencapai `deleted_at + interval '1 month'`, dihitung sebagai satu bulan kalender dalam UTC. Gunakan satu worker. Setiap run mencoba hingga 100 laporan dan 100 akun yang jatuh tempo. Sisa antrean diproses pada run berikutnya.
- Purge laporan lebih dulu. Hapus objek foto dari bucket Cloudflare R2 secara idempoten. Jika gagal, simpan baris laporan dan coba lagi pada jadwal berikutnya. Setelah file terhapus atau sudah tidak ada, hapus laporan beserta riwayatnya dan catat event purge dalam satu transaksi. Baris yang masih ada setelah gangguan dapat diproses ulang.
- Purge akun hanya jika sudah jatuh tempo dan semua laporan miliknya sudah dipurge. Catat event purge akun dalam transaksi penghapusan. Foreign key melindungi data yang masih memiliki referensi. ID aktor untuk event worker boleh kosong.
