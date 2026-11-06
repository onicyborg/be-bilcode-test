# ERD Siklus

Diverifikasi terhadap metadata Neon PostgreSQL 18.6 pada 6 November 2026. Kelima migrasi Prisma (001–005) sudah diterapkan. Diagram menampilkan enam tabel aplikasi; `_prisma_migrations` adalah tabel internal Prisma.

[DBML untuk dbdiagram.io](schema.dbml) · [Snapshot SQL](schema.sql) · [Schema Prisma](../prisma/schema.prisma)

```mermaid
erDiagram
  users ||--o| email_verifications : memiliki
  users ||--o{ refresh_sessions : memiliki
  users ||--o{ reports : melaporkan
  users ||--o{ report_status_history : mengubah_status
  reports ||--o{ report_status_history : memiliki_riwayat
  users {
    uuid id PK
    varchar email UK
    varchar name
    text password_hash
    timestamptz email_verified_at
    user_role role
    boolean is_active
    timestamptz created_at
    timestamptz updated_at
    timestamptz deleted_at
  }
  reports {
    uuid id PK
    uuid reporter_id FK
    varchar description
    decimal latitude
    decimal longitude
    text photo_key
    waste_category predicted_category
    decimal prediction_confidence
    varchar prediction_model
    report_status status
    timestamptz created_at
    timestamptz updated_at
    timestamptz deleted_at
  }
  report_status_history {
    uuid id PK
    uuid report_id FK
    uuid changed_by_id FK
    report_status from_status
    report_status to_status
    varchar reason
    timestamptz created_at
  }
  audit_logs {
    uuid id PK
    uuid request_id
    uuid actor_id
    user_role actor_role
    varchar action
    varchar resource_type
    uuid resource_id
    varchar http_method
    varchar route_template
    smallint http_status
    varchar outcome
    jsonb request_payload
    jsonb response_payload
    integer duration_ms
    timestamptz created_at
  }
  email_verifications {
    uuid id PK
    uuid user_id FK, UK
    text token_digest UK
    timestamptz expires_at
    smallint failed_attempts
  }
  refresh_sessions {
    uuid id PK
    uuid user_id FK
    text token_digest UK
    timestamptz expires_at
  }
```

## Relasi dan aturan penting

- `users → email_verifications`: 1 ke 0..1. `user_id` unik; pengguna belum tentu memiliki kode yang tersimpan.
- `users → refresh_sessions`, `users → reports`, `users → report_status_history`, dan `reports → report_status_history`: 1 ke 0..banyak. Setiap baris anak wajib memiliki parent sesuai FK.
- `audit_logs` sengaja berdiri sendiri. `actor_id` dan `resource_id` hanya snapshot UUID, bukan foreign key, agar audit tetap ada setelah purge. Tidak ada tabel kategori atau prediksi terpisah: kategori adalah enum 10 nilai, sedangkan hasil prediksi berada di `reports`.
- Semua primary key memiliki default `uuidv7()` dan check versi UUID 7.
- `users` dan `reports` memiliki `deleted_at`; pembersihan laporan dilakukan setelah satu bulan kalender UTC sesuai service purge. Riwayat laporan ikut terhapus melalui `ON DELETE CASCADE`.
- FK ke pelapor dan pengubah status memakai `ON DELETE RESTRICT`. FK laporan/riwayat bersifat `DEFERRABLE INITIALLY IMMEDIATE`, sedangkan FK tabel autentikasi tidak deferrable.
- Verifikasi email menyimpan digest kode enam digit, masa berlaku 10 menit dan batas lima percobaan gagal. Refresh session menyimpan digest token, bukan JWT mentah.
- `photo_key` menunjuk objek R2 privat. Payload audit tidak menyimpan password, token/kode mentah, email, koordinat, atau isi foto.

## Pemakaian

Salin isi `schema.dbml` ke editor dbdiagram.io untuk melihat seluruh kolom, enum, constraint, indeks, dan relasinya. File DBML juga disalin ke `../../docs/schema.dbml` untuk paket dokumentasi project. Kedua salinan harus diperbarui bersama.

`schema.sql` adalah dokumentasi, bukan pengganti migrasi Prisma. DBML tidak merepresentasikan deferrability FK; snapshot SQL mempertahankan aturan aktual tersebut secara eksplisit.
