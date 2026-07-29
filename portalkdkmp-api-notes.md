# Portal KDKMP — Internal API Notes

## Changelog — 2026-07-28, login flow captured

Logged out and back in as `002`/BPKP to capture the actual login network traffic (previously we only ever observed an already-authenticated session). Confirms the auth mechanism and gives real endpoints to implement programmatic login:

**Login screen:** "Masuk ke Akun Anda" at `https://portalkdkmp.id/` (unauthenticated root redirects here). Form fields: **No. HP** (labeled as phone number, but the value used is just `002` — a username, not an actual phone number) and **Kata Sandi** (password).

**Request sequence on submit, in order:**
1. `POST /api/trpc/users.checkUserExists` — 200. Fired before the actual sign-in call, presumably to validate the username/HP number exists and give a fast "user not found" error before asking for the real auth check. Body not captured (network tool only exposes method/URL/status, not payload) — assume `{ "json": { "phoneNumber": "002" } }`-shaped or similar; verify with a proper request/response body capture (e.g. `chrome://net-export`, DevTools Network tab, or a `fetch`/`XHR` monkey-patch injected via `javascript_tool` *before* submitting) if you need the exact shape.
2. `POST /api/auth/sign-in/username` — 200. **This confirms the backend is [better-auth](https://www.better-auth.com/) with the `username` plugin enabled** (that plugin's sign-in route is literally `/sign-in/username`, taking `{ username, password }` in the body and setting a session cookie in the response). This is the real login call — the "No. HP" field is passed as `username`, not a phone-specific field.
3. `GET /api/auth/get-session` — 200, called again after sign-in to hydrate the session client-side.
4. `GET /api/trpc/users.checkPasswordResetRequired` — 200, gates the forced-password-reset flow.

**Practical implication for the export website:** programmatic login should be a plain `POST https://portalkdkmp.id/api/auth/sign-in/username` with a JSON body of `{ "username": "<no hp>", "password": "<password>" }` (standard better-auth username-plugin shape — confirm exact field names by capturing the request body once, since this note is inferred from the plugin's known API rather than directly observed). The response should `Set-Cookie` a session token; persist that cookie jar and attach it to all subsequent `/api/trpc/*` calls. This removes the need for a user to paste an existing browser session cookie (Auth strategy option 1 in `CLAUDE.md`) — option 2 (server-side login proxy) is directly implementable now that the real endpoint is known.

No CAPTCHA, 2FA, or OTP step was observed in this flow — straight username+password to session cookie.

## Changelog — 2026-07-28 re-check

Re-opened the site with the same logged-in session (account `002`/BPKP, cookie still valid — no re-login needed). Diffed against the state captured earlier (2026-07-18ish). Key findings:

**Fixed:** the two endpoints that previously 500'd on page load (`dashboard.getKoperasiSelesaiBangunPerKodamChartData`, `koperasi.getDataEarliestReportHeavyTasks`) now return 200 for this account.

**Navigation trimmed, but APIs still live:** the sidebar no longer shows "Performa Harian", "Koperasi Siap Fisik", or "Pengaturan Vendor & Sarpras". Navigating directly to `/data-siap-fisik` or `/pengaturan-vendor-sarpras` now client-side redirects to `/dashboard` — those pages are gone from the UI. `/laporan` (Performa Harian) still loads fine if you go straight to the URL, just isn't linked anymore. **Important: the underlying tRPC procedures for all three (`koperasi.listPrerequisiteSarpras`, `masterSarpras.list`, `alokasiSarpras.*`, `vendorMaster.list`) still return 200 when called directly** — backend access outlived the frontend links. Keep hitting them by URL; don't rely on the nav to know what's available.

**New page:** `/pengiriman-sarpras` ("Pengiriman Sarpras" — "Kelola pengiriman sarana dan prasarana untuk koperasi yang telah selesai dibangun") replaced whatever used to live at that route. New headline cards: Target Nasional 80,000, Lahan Terverifikasi 37,509, Sedang Dibangun 17,082, Selesai Dibangun 18,231. New endpoints: `pemetaan.getStatistikVerified`, `pengirimanSarpras.getDataSarprasDashboard`, `pengirimanSarpras.getKodimWithCompletedKoperasi` (kodamId, provinceKode). This router hasn't been fully probed yet — worth checking for a detail/list companion endpoint the way `laporanVendor.getMonitorStats` pairs with `getCompleteMonitor`.

**`dashboard.getExternalHeadlineTotal` now returns `{totalKoperasi: null}`** — looks deprecated. The dashboard's prerequisite cards now source from `dashboard.getDashboardHeadlineStatsV2`, which gained new fields not present before:
- `koperasiSiapPembangunanFisik` (9,148) — matches `koperasi.listPrerequisiteSarpras{status:"ready"}.total` exactly
- `koperasiBelumMemenuhiPrasyaratOperasional` (9,102) — matches `status:"not_ready"` (off by ~3, likely just a few-seconds cache/timing gap between calls)
- `koperasiBelumIsiPrasyaratOperasional` (4,926) — **new**: koperasi that haven't submitted any prerequisite data at all
- `koperasiBelumSiapOperasional` (4,176) — **new**: koperasi that submitted data but aren't ready (4,926 + 4,176 = 9,102, so this is a breakdown of the old "belum memenuhi" bucket into two sub-reasons)
- also still returns `totalKoperasi`, `koperasiSelesai`, `progressKeseluruhan`, `mandorAktif`, `computedAt`

**Data has grown** across the board in ~10 days: Aceh alone went from 1,038 → 1,688 koperasi terdaftar. `laporanVendor.getVendorReportedKoperasiMap` points grew 15,793 → 17,922. The Hijau/`mandatory_complete` count (koperasi with Kasir+Software, CCTV, and Truk all delivered) grew 1,000 → 1,148.

**Ideas for obtaining more data going forward:**
1. Since the API layer is more permissive than the current UI, periodically re-probe by hitting every known procedure name directly (a quick `Promise.all` of `fetch` calls, like done here) rather than trusting the sidebar to reveal what exists — routers can survive nav removal.
2. Fully map the new `pengirimanSarpras.*` and `pemetaan.getStatistikVerified` surface — only 3 calls were observed from one page load; there's likely a paginated per-koperasi list endpoint analogous to `getCompleteMonitor`.
3. Switch any scripts pulling "Memenuhi/Belum Memenuhi Prasyarat Operasional" from `dashboard.getExternalHeadlineTotal` (now dead) to `dashboard.getDashboardHeadlineStatsV2`, and consider surfacing the new `koperasiBelumIsiPrasyaratOperasional` vs `koperasiBelumSiapOperasional` split — it's more actionable (no data yet vs data submitted but failing).
4. Worth setting up a scheduled snapshot (date, `statusCategory` counts from the vendor map, and the headline stats block) to track rollout velocity over time now that we know both are trending upward fast.

---

Base URL: `https://portalkdkmp.id/api/trpc/`
Framework: tRPC (GET requests, JSON-encoded `input` query param)
Auth: session cookie set after login (`/api/auth/get-session` confirms an active session — this looks like better-auth). No separate API key was found for these endpoints; you need to be logged in via the browser/cookie jar, or extract the session cookie and send it as a header in your own client.

Request shape (all GET):
```
GET /api/trpc/<router>.<procedure>?input={"json":{...params...},"meta":{"values":{...},"v":1}}
```
`input` must be URL-encoded. Any param not used should be `null` in the `json` object (and listed as `"undefined"` in `meta.values`).

## Endpoints seen on `/dashboard?level=province` (Monitoring Pembangunan tab)

| Procedure | Status | Purpose (best guess from UI) |
|---|---|---|
| `users.getCurrentProfile` | 200 | Logged-in user profile |
| `users.checkPasswordResetRequired` | 200 | Forces password reset flow |
| `users.checkUserHasLocation` | 200 | Gate for location-based views |
| `dashboard.getDashboardStatistics` | 200 | Headline numbers (Koperasi Sedang/Selesai Dibangun, Laporan Harian Masuk, Rata-rata Progres) |
| `dashboard.getDashboardHeadlineStatsV2` | 200 | Also feeds headline cards (v2) |
| `dashboard.getProgressBreakdown` | 200 | "Pembangunan Terlambat / Underperform / On-track" cards |
| `dashboard.getExternalHeadlineTotal` | 200 | "Koperasi Memenuhi/Belum Memenuhi Prasyarat Operasional" cards |
| `dashboard.getKoperasiSelesaiBangunChartData` | pending/200 | Line/bar chart of completions over time |
| `dashboard.getKoperasiSelesaiBangunPerKodamChartData` | 500 (errored for this account) | Completions broken down per Kodam |
| `dashboard.getMaterialUsageStats` | 200 | Material usage stats block |
| `dashboard.getMapData` | 200 | Pin/marker data for the map |
| `dashboard.getFilterOptions` | 200 | Populates the filter dropdowns |
| `koperasi.getRegionalStats` (level=province, level=kota) | 200 | "Statistik per Provinsi/Kota" table |
| `koperasi.getRegionalDrilldownStats_new` | 200 | Drilldown table when a region is selected |
| `koperasi.getProgressDistribution` | 200 | Progress distribution chart |
| `koperasi.getRegionProgressCategories` | 200 | Region progress category buckets |
| `koperasi.getDataEarliestReportSummary` | 200 | Summary of earliest reports |
| `koperasi.getDataEarliestReportHeavyTasks` | 500 (errored for this account) | Heavy-task subset of earliest reports |
| `wilayah.searchProvinces` (limit=1000) | 200 | Province list for filter dropdown |
| `dokumenSarpras.getLatestUpdate` | 200 | Latest Sarpras (logistics) document update |
| `pemetaan.getApiToken` | 403 (forbidden for this account) | Token used to embed the separate land-mapping tool |
| `pemetaan.getEmbedAccess` | 200 | Access check for the mapping embed |

## Endpoints seen on `/laporan` (Performa Harian) and `/data-siap-fisik` (Koperasi Siap Fisik)

| Procedure | Status | Purpose |
|---|---|---|
| `koperasi.list` (search, limit) | 200 | Koperasi name search/autocomplete |
| `kodam.list` / `korem.list` / `kodim.list` (limit) | 200 | Military region dropdowns |
| `wilayah.searchProvinces` / `searchCities` / `searchDistricts` / `searchVillages` (limit) | 200 | Region dropdowns (province/city/district/village) |
| `reports.getKoperasiSortedByLaporan` | 200 | Performa Harian table — koperasi not yet completed, sorted/filtered by report progress |
| `reports.getCompletedKoperasiSortedByLaporan` | 200 | Performa Harian table — completed koperasi |
| `koperasi.listPrerequisiteSarpras` | 200 | **Detail list behind the "Koperasi Memenuhi/Belum Memenuhi Prasyarat Operasional" dashboard cards** — see below |

### `koperasi.listPrerequisiteSarpras` — detailed prerequisite (readiness) list

This is the endpoint for the list you want. It powers the `/data-siap-fisik` page ("Data Koperasi Siap Fisik").

```
GET /api/trpc/koperasi.listPrerequisiteSarpras?input={"json":{...},"meta":{"values":{...},"v":1}}
```

`json` params:
| Param | Type | Notes |
|---|---|---|
| `page` | number | 1-indexed |
| `limit` | number | page size (UI default 10; raise for bulk pulls) |
| `search` | string \| null | free text (koperasi name/wilayah/alamat) |
| `status` | `"all"` \| `"ready"` \| `"not_ready"` | **`"ready"` = Memenuhi Prasyarat Operasional (7,548), `"not_ready"` = Belum Memenuhi (9,129), `"all"` = both** |
| `kodimId` | string \| null | filter by Kodim |
| `batch` | string \| null | filter by batch |
| `provinceId` | string \| null | filter by province |
| `cityId` | string \| null | filter by kabupaten/kota |
| `districtId` | string \| null | filter by kecamatan |

Response rows include: nama koperasi, Babinsa (contact person), HP Babinsa, batch, provinsi, kabupaten/kota, kecamatan (and more columns off-screen, likely desa/status detail). Results are grouped by Kodim in the UI.

To pull the full "Memenuhi Prasyarat" list: set `status: "ready"`, `limit` to something large (e.g. 100 or 500), and loop `page` until you've covered all 7,548 records. An "Export Excel" button also exists on this page — worth checking if it hits a dedicated export endpoint for a one-shot CSV/XLSX instead of paginating JSON.

## Endpoints seen on `/monitor-laporan-vendor` (Monitor Laporan Vendor) and `/pengaturan-vendor-sarpras`

| Procedure | Status | Purpose |
|---|---|---|
| `laporanVendor.getMonitorStats` (batch) | 200 | "Statistik Monitor" cards (Target Peresmian, Jumlah Koperasi, Sarpras Prioritas Lengkap, Semua Sarpras Lengkap) |
| `laporanVendor.getVendorReportedKoperasiMap` (provinceIds, cityIds, districtIds, batch, isPriority) | 200 | Pins for "Peta Laporan Vendor" map |
| `laporanVendor.getCompleteMonitor` (provinceId — **required string, omit key entirely or pass real id, not null**; includeKoperasiList) | 200 | Full monitor data grouped by Kodim, with per-koperasi `sarprasReports` breakdown |
| `laporanVendor.getTerpasangSummaryForPusat` (status: "tiba" \| "terpasang") | 200 | Nationwide arrival/installation summary |

### Does "Memenuhi Prasyarat Operasional" include vehicles? — No.

These are two separate systems tracking two different things:

**`koperasi.listPrerequisiteSarpras`** (dashboard cards 7,548 / 9,129, and `/data-siap-fisik`) checks **site readiness for construction**, filled in by Babinsa. Its fields are all physical-site booleans: `lkDinding` (wall lining), `areaParkir` (parking area), `air` (water), `listrik` (electricity), `colokanAc` (AC socket), `mcb` (circuit breaker), `kabel` (cabling), `aksesJalan` (road access) — plus photo evidence per item. No vehicle field exists here.

**`laporanVendor.*`** (the "Peta Laporan Vendor" map on `/monitor-laporan-vendor`) tracks **vendor delivery of Sarana & Prasarana (sarpras) items** to each koperasi — a logistics pipeline (Total Paket → Dikirim ke Kodim → Diterima Kodim → Dikirim ke KDKMP → Diterima KDKMP). The master sarpras catalog (`/pengaturan-vendor-sarpras`, "Sarana & Prasarana" table) **does include vehicles**: `Truk`, `Pickup 4x4`, and `Motor Bak Roda 3` are line items alongside APAR, Gerai Rak, Kasir + Software, AC, Mebel, Seragam KDKMP, CCTV, etc. (22 item types total, 353 total SKU/paket-level rows). Each item has a `Priority` (e.g. "Mandatory") and `Grup` (Primary/Secondary), which is what drives the map's color legend (Biru = semua sarpras lengkap, Hijau = Primary lengkap, Oranye = Secondary lengkap, Merah = sarpras di bawah 10, Kuning = 10+ belum lengkap, Abu-abu = belum ada laporan vendor).

**So:** a koperasi can be "Memenuhi Prasyarat Operasional" (site physically ready to build) with zero vehicles delivered, and separately be tracked on the vendor map for whether its truck/pickup/motor bak roda 3 and other sarpras have arrived. The two datasets share `koperasiId` as the join key but are otherwise independent — one is a pre-construction site checklist, the other is a post-delivery logistics tracker. Per-koperasi vendor item detail (including vehicle vendor name, e.g. "PT Dipo Internasional Pahala Otomotif (FUSO)" for trucks) is nested in `laporanVendor.getCompleteMonitor`'s `sarprasReports` object, keyed by internal `SARPRAS-<uuid>` codes.

### `SARPRAS-<uuid>` code lookup — solved

Two endpoints decode the codes used throughout `sarprasReports`:

| Procedure | Status | Purpose |
|---|---|---|
| `alokasiSarpras.getMasterSarprasList` | 200 | Simple id → name → unitPerPaket lookup (no priority/group) |
| `masterSarpras.list` | 200 | **Full catalog** — id, name, `jumlahUnitPerPaket`, `order`, `priority`, `group`, `deskripsi`, timestamps. This is the source of truth for item metadata. |
| `alokasiSarpras.getKodimList` (kodamId, provinceKode, kodimIds) | 200 | Kodim list for the "Alokasi Sarpras per Kodim" table on `/pengaturan-vendor-sarpras` |
| `vendorMaster.list` / `vendor.list` | 200 | Vendor master data (two endpoints returned same-shaped data — one may be legacy) |

`masterSarpras.list` returns 29 total item types (only 22 appeared in the "Sarana & Prasarana" summary table — some may be batch/internet-variant SKUs). Each item has a `priority`: `Mandatory` > `High` > `Medium` > `Secondary` (exact ordering inferred from context, not confirmed). Only **3 items are `Mandatory`**: `Kasir + Software`, `CCTV`, `Truk` (SARPRAS id `SARPRAS-019c4a41-8759-73e1-90c3-91896d533983`). Of the vehicle items specifically: `Truk` = Mandatory, `Pickup 4x4` = High, `Motor Bak Roda 3` = High.

### Map color legend decoded — `statusCategory` field

**Changelog — 2026-07-28, resolved via frontend source (Claude in Chrome):** Previously `partial` was guessed as "likely Oranye/Kuning" (ambiguous, since the map legend has 6 colors but only 3 statusCategory values had ever been observed in data). Pulled the actual `STATUS_STYLES` map straight out of the built frontend JS (`/assets/monitor-laporan-vendor-*.js`) to resolve it definitively — **Kuning and Oranye are two separate `statusCategory` enum values, not a rendering-only distinction:**

```js
STATUS_STYLES = {
  complete_all:        { label: "Semua sarpras lengkap",     color: "#2563eb", description: "Biru" },
  mandatory_complete:  { label: "Primary lengkap",           color: "#16a34a", description: "Hijau" },
  secondary_complete:  { label: "Secondary lengkap",         color: "#f97316", description: "Oranye" },
  below_10:            { label: "Sarpras di bawah 10",       color: "#dc2626", description: "Merah" },
  partial:             { label: "Sarpras 10+ belum lengkap", color: "#facc15", description: "Kuning" },
  no_report:           { /* Abu-abu — truncated in capture, not fully read but name confirms meaning */ },
}
```

`laporanVendor.getVendorReportedKoperasiMap` returns `{ points, provinceOptions, cityOptions, districtOptions, batchOptions }`. Each point (one per koperasi with a vendor report) has a `statusCategory` field that drives the map legend colors. Live counts as of 2026-07-28 (17,922 total points, confirmed via direct fetch replay in the browser console, matching the map's own displayed total):

| `statusCategory` | Count | Legend color | Meaning |
|---|---|---|---|
| `mandatory_complete` | 1,148 | 🟢 Hijau — Primary lengkap | All Mandatory-priority items delivered (see updated `masterSarpras.list` priorities below — this set has grown since the last check). |
| `below_10` | 16,411 | 🔴 Merah — Sarpras di bawah 10 | Fewer than 10 sarpras items delivered |
| `partial` | 363 | 🟡 **Kuning** — Sarpras 10+ belum lengkap | 10 or more items delivered, but not all required tiers complete |
| `secondary_complete` | 0 | 🟠 Oranye — Secondary lengkap | All Secondary-priority items complete — zero koperasi nationwide right now |
| `complete_all` | 0 | 🔵 Biru — Semua sarpras lengkap | Literally every sarpras item (all tiers) complete — zero koperasi nationwide |
| `no_report` | *(n/a)* | ⚫ Abu-abu — Belum ada laporan vendor | Koperasi with zero vendor reports don't appear in `points` at all, so this category never shows up in this endpoint's data — it's a UI-only placeholder in the legend |

### `batch` and `isPriority` filters on `getVendorReportedKoperasiMap` — confirmed real (2026-07-28)

Both filters narrow results server-side (verified by refetching with each value and checking `points[].batch` is homogeneous):

| Call | Total points | Notes |
|---|---|---|
| no filter | 17,922 | `batch1` + `batch2` + `null` |
| `batch: "batch1"` | 1,061 | |
| `batch: "batch2"` | 11,248 | |
| `isPriority: true` | 8,734 | Only `batch2`/`null` rows — **zero `batch1` rows are ever priority** |
| `isPriority: false` | 17,922 | Same as unfiltered |

**`batch: null` exists as real data** (~5,797 koperasi with a vendor report but no batch assignment) but `batchOptions` only lists `batch1`/`batch2` — there's no filter value to select "no batch" explicitly; you'd have to fetch unfiltered and filter client-side for `batch === null`.

**`isPriority` is unrelated to Sarpras item priority (Mandatory/High/etc).** It corresponds to the "Koperasi Prioritas" star-filter button in the UI — a per-koperasi priority flag independent of batch or completion tier. Don't conflate it with `masterSarpras.list`'s `priority` field when building tier logic (see the Requirement Set note above).

### `laporanVendor.getCompleteMonitor` — confirmed response shape (2026-07-28)

```
{ kodimList, sarprasList, provinceOptions, batchOptions }
  kodimList[]: { kodimId, kodimName, totalKoperasi, sarprasSummary, statusSummary, sarprasVendors, koperasiList }
    koperasiList[]: { koperasiId, koperasiName, desaNama, kecamatanNama, kotaNama,
                      progressPercentage, hasApprovedReport, batch, lastReviewedReport, sarprasReports }
      sarprasReports: { "SARPRAS-<uuid>": { status, vendorName, jumlahPaket, catatan,
                        namaKapal, estimatedArrival, estimatedDelivered, fotoLaporan,
                        transitLocationType, transitLocationName } }
```
Delivered statuses seen: `tiba`, `terpasang` (pipeline also has `pengiriman`, `transit`). Timing measured: Jawa Tengah (4,657 koperasi) = ~4.1s, ~11.2MB. There is **no server-side filter** to narrow the response to a single completion tier — it always returns every koperasi in the province.

**`getCompleteMonitor` does NOT cover every koperasi that `getVendorReportedKoperasiMap` returns.** Measured 2026-07-28 by joining a full national pull (all 35 province names → 30 province ids) against the map's 17,922 points:

- **2,285 koperasi (12.7%) appear on the vendor map but are absent from their own province's `getCompleteMonitor` response.**
- Every single one is `statusCategory: "below_10"`, and every single one has `totalLaporan` between 1 and 5 — so these are koperasi the portal itself says *do* have vendor reports.
- Reason not established. Plausible candidates: `getCompleteMonitor` may only include koperasi that are already built / have an approved report (`hasApprovedReport`), matching the page's framing ("koperasi yang telah selesai dibangun"). **Unverified — worth probing before relying on either endpoint as a complete census.**

Practical consequence: when joining the two, treat a missing koperasi as *unknown* per-item status, not as "no items delivered" — the map contradicts that reading.

**Province names in `points` are not canonical.** The same province shows up under multiple spellings (`Aceh` and `Aceh (NAD)`; `DI Yogyakarta` and `Daerah Istimewa Yogyakarta`; `Daerah Khusus Ibukota Jakarta` vs the `DKI Jakarta` label in `provinceOptions`). 35 distinct `provinceNama` values collapse to 30 real provinces. Any join from `provinceNama` to a `provinceOptions.value` needs normalisation, not string equality.

### Completion tiers are computed against a per-koperasi Requirement Set — do not recompute them

Tried to reproduce `statusCategory: "mandatory_complete"` from `masterSarpras.list` priorities + `sarprasReports`, over all 4,657 Jawa Tengah koperasi (portal reports 563):

| Our formula over global Mandatory items | Our count | Disagreements vs portal |
|---|---|---|
| LTE **OR** Starlink | 589 | 50 (38 we-say-yes/portal-no, 12 we-say-no/portal-yes) |
| LTE **AND** Starlink | 17 | 550 |

Mismatch inspection: some `mandatory_complete` koperasi have **CCTV entirely undelivered**, while others with LTE delivered but Starlink missing are **not** counted complete. Conclusion: **each koperasi has its own allocated Requirement Set** (cf. per-koperasi `totalRequirementCount`, which is 28 in samples but is not necessarily uniform), and the portal evaluates against that, not against the global Mandatory catalog. **The allocation source has not been found yet — `alokasiSarpras.*` is the obvious place to look and is unexplored.** Until then, treat `statusCategory` as authoritative (see `docs/adr/0004-trust-portal-statuscategory.md`).

**`masterSarpras.list` priority/group has changed since the last check (2026-07-18 → 2026-07-28):** `Internet LTE` and `Starlink` are now both `priority: "Mandatory"` with `group: "internet"` — this `group` field (previously unseen, always `null` for other items) strongly suggests these two are an either/or requirement (need one of the two, not both) rather than two independent Mandatory items. Re-verify this either/or interpretation before building a "100% lengkap" export that depends on it. `Kasir + Software`, `CCTV`, and `Truk` remain Mandatory as before, so the full Mandatory set is now: Kasir + Software, CCTV, Truk, and (Internet LTE or Starlink).

Other fields per point: `koperasiId`, `koperasiName`, `desaNama`, `kecamatanNama`, `kotaNama`, `provinceNama`, `kodimName`, `batch`, `totalLaporan`, `totalVendor`, `pengirimanCount`, `transitCount`, `tibaCount`, `terpasangCount`, `latestReportAt`, `completedSarprasCount`, `completedRequirementCount`, `totalRequirementCount`, `lat`, `lng`.

`mandatory_complete` count breaks down by `batch`: batch1 = 938 (exactly matches the "Sarpras Prioritas Lengkap" stat card for batch1), batch2 = 62. Province breakdown of the 1,000: Jawa Tengah 499, Jawa Timur 493, DKI Jakarta 4, Jawa Barat 3, Banten 1 — batch 1/2 rollout is currently Java-only aside from a handful of outliers.

### Practical recipe: pulling bulk data (1,000+ rows) via browser console

`get_page_text` / `javascript_tool` return values get truncated at ~1,000 characters, which makes pulling large result sets back through chat impractical. The workaround that worked: run the fetch + transform logic in the page context via `javascript_tool`, stash results on `window.__someVar`, then in a **second** `javascript_tool` call load SheetJS from CDN (`https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js`) and call `XLSX.writeFile(wb, 'filename.xlsx')` — this builds the workbook client-side and triggers a real browser download (lands directly in the user's Downloads folder), completely bypassing the tool output size limit. Used this to export all 1,000 `mandatory_complete` koperasi to `koperasi-hijau-primary-lengkap.xlsx`.

## Monitoring Pemetaan Lahan tab
This tab loads a separate embedded tool that requires a token from `pemetaan.getApiToken`. For account **002** that call returned **403 "Token required" / permission denied**, so this section shows a raw JSON error instead of the map — this account likely lacks the role/permission for land mapping.

## Notes / gotchas
- Two endpoints (`dashboard.getKoperasiSelesaiBangunPerKodamChartData`, `koperasi.getDataEarliestReportHeavyTasks`) returned HTTP 500 consistently on page load with `dateFrom/dateTo: null` — they may require explicit date range params to work correctly.
- `dateFrom`/`dateTo` when populated are millisecond epoch timestamps (e.g. `1783184400000`).
- Filters (`provinsi`, `kodamId`, `koremId`, `kodimId`, `koperasiId`, `statusPembangunan`, `token`) are shared across most `dashboard.*` and `koperasi.*` procedures — pass `null` to mean "all".
- `dashboard.getDashboardStatistics` / `getDashboardHeadlineStatsV2` / `getProgressBreakdown` also take a `timezoneOffset` (minutes, e.g. `-420` for WIB).
