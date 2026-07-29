# KDKMP Exporter

Menarik data dari Portal KDKMP (`portalkdkmp.id`) dan mengunduhnya sebagai XLSX/CSV.

Laporan pertama yang tersedia: **daftar koperasi per kategori kelengkapan sarpras**, lengkap
dengan status dan nama vendor untuk **semua 29 jenis item** di katalog (`masterSarpras.list`),
bukan cuma yang Mandatory.

- `CLAUDE.md` — referensi API portal hasil reverse-engineering (spec lapisan data)
- `CONTEXT.md` — glosarium istilah domain; baca ini sebelum bicara soal "100% lengkap"
- `docs/adr/` — keputusan arsitektur dan alasannya

## Struktur

```
frontend/   Vite + React, static, deploy ke GitHub Pages
backend/    Vercel Functions, memegang sesi portal, membangun file export
```

Frontend dan backend berbeda origin, jadi autentikasi memakai `Authorization: Bearer`,
bukan cookie ([ADR-0001](docs/adr/0001-token-based-session-auth.md)).

## Prasyarat

- Node.js 20+
- Akun portalkdkmp.id
- Akun Vercel dengan **KV (Upstash Redis)** dan **Upstash QStash**

## Menjalankan secara lokal

```bash
npm install
```

Salin env contoh dan isi nilainya:

```bash
cp backend/.env.example backend/.env && cp frontend/.env.example frontend/.env
```

Jalankan backend (butuh `vercel login` sekali di awal):

```bash
npm run dev:backend
```

Di terminal lain:

```bash
npm run dev:frontend
```

`KV_REST_API_URL` dan `KV_REST_API_TOKEN` **wajib** diisi — dibaca saat modul di-import,
jadi backend gagal start kalau kosong. Database Redis gratis di
[console.upstash.com](https://console.upstash.com) sudah cukup; tidak perlu project Vercel
untuk sekadar mencoba di lokal.

**Mode lokal:** biarkan `QSTASH_TOKEN` kosong. QStash tidak bisa memanggil `localhost`,
jadi kalau token itu tidak ada (dan proses tidak berjalan di Vercel), backend mengerjakan
langkah per-provinsi sendiri secara berurutan. Progressnya tetap bertahap seperti di
produksi, dan UI menandainya dengan catatan "Mode lokal". Di Vercel token wajib ada —
penjagaan ini sengaja supaya deployment yang lupa mengisinya gagal terang-terangan, bukan
diam-diam menjalankan semuanya inline lalu kena timeout.

## Deploy

**Backend (Vercel):** buat project baru, set **Root Directory** ke `backend`. Tambahkan
integrasi KV dan QStash, lalu isi env: `ALLOWED_ORIGINS` (URL GitHub Pages),
`PUBLIC_BASE_URL` (URL Vercel itu sendiri), `QSTASH_TOKEN`. Variabel `KV_REST_API_URL` dan
`KV_REST_API_TOKEN` diisi otomatis oleh integrasi KV.

**Frontend (GitHub Pages):** aktifkan Pages dengan source **GitHub Actions**, lalu set
repository variable `API_BASE_URL` ke URL backend Vercel. Workflow
`.github/workflows/deploy-frontend.yml` membangun dan men-deploy tiap push ke `main`.

Nama repo GitHub tidak boleh mengandung `%`; workflow memakai nama repo sebagai base path.

## Cara kerja laporan

1. `POST /api/reports/completion/start` — satu panggilan ringan ke peta vendor nasional
   (~18rb baris) untuk menentukan koperasi target dan provinsi mana saja yang perlu
   ditarik detailnya. Body: `{ "scope": "all" | "mandatory_complete" | "below_10" | ... }`.
2. Tiap provinsi diantrikan ke QStash sebagai satu langkah terpisah — panggilan
   `getCompleteMonitor` per provinsi berukuran ~11MB dan makan ~4 detik, terlalu berat
   untuk satu invocation ([ADR-0002](docs/adr/0002-background-job-for-heavy-per-koperasi-report.md)).
3. Frontend polling `/status` tiap 2,5 detik sampai semua provinsi selesai.
4. `/download?format=xlsx|csv` merakit file dari hasil yang tersimpan di KV.

Keanggotaan kategori selalu memakai `statusCategory` dari portal, tidak pernah dihitung
ulang sendiri — lihat [ADR-0004](docs/adr/0004-trust-portal-statuscategory.md) untuk alasannya.

### Skala

Cakupan laporan menentukan berat kerjanya. Angka per 2026-07-28:

| Kategori | Koperasi | Provinsi ditarik |
|---|---|---|
| Primary lengkap (Hijau) | 1.148 | 5 |
| Sarpras 10+ belum lengkap (Kuning) | 363 | 6 |
| Sarpras di bawah 10 (Merah) | 16.411 | 34 |
| Semua kategori | 17.922 | 35 |

Dua batas platform membentuk desainnya, dan keduanya terlampaui pada ekspor penuh:

- **KV Upstash maksimal 1MB per key** — baris dan titik disimpan dalam potongan
  (400 baris / 800 titik per key), bukan satu key per provinsi.
- **Respons Vercel maksimal 4,5MB kalau di-buffer** — file ditulis sebagai stream
  langsung ke respons, dibaca dari KV per provinsi, jadi tidak pernah ada satupun titik
  di mana seluruh laporan berada di memori.

**Kolom per-item mencakup semua 29 jenis sarpras** (bukan cuma 5 Mandatory), diukur
2026-07-29 pada skala "Semua kategori" (17.951 koperasi, 79 kolom): **CSV 14,68MB, XLSX
5,86MB**, unduh masing-masing ~17 dan ~21 detik — jauh di bawah `maxDuration: 60` pada
`vercel.json`. XLSX lebih hemat dari CSV secara proporsional karena kompresi zip-nya
efektif untuk string vendor yang berulang.

## Catatan

- Kata sandi portal tidak pernah disimpan; sesi kedaluwarsa berarti login ulang manual
  ([ADR-0003](docs/adr/0003-no-password-persistence.md)).
- `npm audit` melaporkan temuan pada dependensi transitif `@vercel/node` (hanya dev) dan
  `exceljs`→`uuid`. Perbaikan otomatisnya berupa downgrade besar (`exceljs@3`), jadi
  sengaja dibiarkan.
- Portal ini sistem produksi yang aktif berubah — skema sempat berubah di tengah proyek.
  Tipe di `backend/lib/kdkmp.ts` sengaja toleran terhadap field baru.
