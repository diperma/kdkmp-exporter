# Portal KDKMP Exporter — Project Context

## What this project is

A standalone website (to be built) that connects to the internal **Portal KDKMP** tRPC API (`https://portalkdkmp.id`) and lets a user pull data (koperasi lists, vendor/sarpras delivery status, dashboard stats, etc.) and download it as **XLSX or CSV** without going through the portal's own UI.

This file is the accumulated reverse-engineering knowledge of that API, gathered by driving the real site with a logged-in session and capturing network traffic. Treat it as the spec for the data layer of this project. Re-verify anything marked "unconfirmed" before relying on it in production, since this is an internal system with no public docs and it changes over time (see Changelog).

## Source system quick facts

- **Base URL:** `https://portalkdkmp.id/api/trpc/`
- **Protocol:** tRPC over HTTP GET, one procedure per request
- **Request shape:**
  ```
  GET /api/trpc/<router>.<procedure>?input=<url-encoded JSON>
  ```
  where the JSON is `{"json": {...params}, "meta": {"values": {...}, "v": 1}}`. Any param the UI doesn't set is `null` in `json` and listed as `"undefined"` in `meta.values`. `meta` can often be omitted or left sparse if all params have real values — it mainly matters for telling superjson which `null`s actually mean `undefined`.
- **Auth:** session-cookie based, confirmed [better-auth](https://www.better-auth.com/) with the **username plugin** (see "Auth — login flow (confirmed)" below for the real endpoints). `GET /api/auth/get-session` confirms an active session. No API key / bearer token scheme exists — login is username+password only.
- **Language:** all UI strings and most field names are Indonesian. Domain vocabulary: **koperasi** = cooperative (the unit being tracked, roughly one per desa/village), **sarpras** = sarana & prasarana = facilities/equipment, **Babinsa** = the army NCO who submits site-readiness reports, **Kodam/Korem/Kodim** = military territorial command levels (largest → smallest), **prasyarat operasional** = operational prerequisites (site readiness to start building).

## Auth — login flow (confirmed)

Captured directly by logging out and back in as `002`/BPKP. The login page ("Masuk ke Akun Anda") labels its first field "No. HP" (phone number) but the actual value used is a plain username like `002` — not a real phone number.

**Request sequence:**
1. `POST /api/trpc/users.checkUserExists` — pre-flight check that the username exists, fired before the real auth call. Body shape not confirmed (network capture tool only exposes method/URL/status, not payload) — capture it directly (DevTools Network tab, or inject a `fetch`/`XHR` wrapper before submitting the form) if the exact shape matters; likely harmless to skip in a custom client and go straight to step 2.
2. `POST /api/auth/sign-in/username` — **the real login call.** This route name is better-auth's username-plugin convention, so the body is almost certainly `{ "username": "002", "password": "<password>" }`. Response sets the session cookie. Confirm exact field names with one captured request body before relying on this in code.
3. `GET /api/auth/get-session` — re-fetched after sign-in to hydrate client state.
4. `GET /api/trpc/users.checkPasswordResetRequired` — gates a forced password-reset redirect.

No CAPTCHA, OTP, or 2FA observed — straight username+password to session cookie.

**Implication:** a server-side login proxy (Auth strategy option 2 below) is directly implementable now: `POST` to `/api/auth/sign-in/username` with the user's credentials from your own backend, capture the `Set-Cookie` session token from the response, store it server-side, and attach it as a `Cookie` header on all subsequent `/api/trpc/*` calls made on that user's behalf. Never expose the portalkdkmp.id password to your frontend — collect it once server-side (e.g. via a POST to your own backend), use it immediately to obtain the session cookie, then discard or encrypt-at-rest per your own security requirements.

## Auth strategy (pick one before building)

Options for the new website, roughly in order of how much they respect the source system:

1. **User pastes their own session cookie** into the new site's settings once; the new site's backend attaches it as a `Cookie` header on server-side fetches to `portalkdkmp.id`. Simplest, but cookies expire/rotate and this is fragile.
2. **New site proxies a real login** (now fully specified above — `POST /api/auth/sign-in/username`) — user enters their portalkdkmp.id credentials into the new site once, the new site's backend does the sign-in call and stores the resulting session cookie server-side (never exposed to the frontend). Better UX than option 1, and now the recommended default since the endpoint is confirmed.
3. **Browser-side fetch from the user's own already-logged-in tab** (e.g. a bookmarklet or browser extension) — no server-side credential handling at all, but only works while the user has portalkdkmp.id open and logged in, and is a much more limited "app."

Whatever is chosen, the fetch layer should isolate the cookie-attachment logic behind one function so the rest of the app doesn't care how auth works. Session cookies from better-auth typically expire/rotate — build in a re-login-on-401 path regardless of which option is picked.

## Data model cheat sheet

- One **koperasi** = one cooperative/site, identified by `koperasiId` (opaque string, e.g. `k573k8brebm5vp0jjxqhdj0wb17vjehp`, or newer ones look like UUIDs, e.g. `019aed60-e285-7ad5-ac08-d93fbdd67467`).
- Region hierarchy: **Provinsi → Kota/Kabupaten → Kecamatan → Desa**, each with its own `wilayah.search*` lookup endpoint and its own opaque `*Id`/`*Kode` fields (inconsistent naming — some routers use `provinceId`, others `provinceKode`, others `provinsi`; always check the specific procedure).
- Military hierarchy (separate from region, but geographically aligned): **Kodam → Korem → Kodim**, each with a `.list` endpoint.
- **Two independent "readiness" concepts — do not conflate them:**
  - *Prasyarat Operasional* (`koperasi.listPrerequisiteSarpras`, dashboard field `koperasiSiapPembangunanFisik`/`koperasiBelumMemenuhiPrasyaratOperasional`) = is the **physical site** ready for construction (walls, water, electricity, road access, etc.), reported by Babinsa. No vehicles or vendor goods involved.
  - *Sarpras delivery* (`laporanVendor.*`) = has the **vendor-supplied equipment** (furniture, CCTV, trucks, uniforms, etc.) been delivered/installed at a koperasi that's already built. Separate pipeline, separate stats, joined only by `koperasiId`.
- **`SARPRAS-<uuid>` codes**: item type IDs used as object keys in `sarprasReports`. Decode via `masterSarpras.list` (id → name, priority, group, unitPerPaket, description).

## Endpoint reference

### Auth / session / user
| Procedure | Params | Notes |
|---|---|---|
| `GET /api/auth/get-session` | — | Not tRPC-prefixed; confirms login state |
| `users.getCurrentProfile` | — | Current user info |
| `users.checkPasswordResetRequired` | — | |
| `users.checkUserHasLocation` | — | |

### Dashboard headline stats (`/dashboard?level=province`)
| Procedure | Params | Notes |
|---|---|---|
| `dashboard.getDashboardStatistics` | `timezoneOffset` (e.g. `-420` for WIB), `dateFrom`, `dateTo`, `koperasiId`, `provinsi`, `kodamId`, `koremId`, `kodimId`, `statusPembangunan`, `token` | Older headline numbers endpoint |
| `dashboard.getDashboardHeadlineStatsV2` | same as above | **Current/preferred** headline endpoint. Returns `totalKoperasi`, `koperasiSelesai`, `progressKeseluruhan`, `mandorAktif`, `koperasiSiapPembangunanFisik`, `koperasiBelumMemenuhiPrasyaratOperasional`, `koperasiBelumIsiPrasyaratOperasional` (no data submitted), `koperasiBelumSiapOperasional` (data submitted, not ready), `computedAt` |
| `dashboard.getExternalHeadlineTotal` | `token` | **Deprecated as of 2026-07-28** — returns `{totalKoperasi: null}`. Don't use for new code. |
| `dashboard.getProgressBreakdown` | timezone/filter params | "Terlambat / Underperform / On-track" buckets |
| `dashboard.getKoperasiSelesaiBangunChartData` | filter params incl. `dateFrom`/`dateTo` (epoch ms) | Completions over time, chart data |
| `dashboard.getKoperasiSelesaiBangunPerKodamChartData` | same, `dateFrom`/`dateTo` required (was 500ing when null, fixed as of 2026-07-28) | Completions per Kodam |
| `dashboard.getMaterialUsageStats` | `token` | |
| `dashboard.getMapData` | `provinsi` | Marker data for province progress map |
| `dashboard.getFilterOptions` | `token` | Populates filter dropdowns |

### Koperasi / regional stats
| Procedure | Params | Notes |
|---|---|---|
| `koperasi.list` | `search`, `limit` | Name search/autocomplete |
| `koperasi.getRegionalStats` | `level` (`province`/`kota`), `provinsi`, `kota`, `kecamatan`, `token` | "Statistik per Provinsi/Kota" table |
| `koperasi.getRegionalDrilldownStats_new` | `level`, `provinceCode`, `cityCode`, `districtCode`, plus shared filters | Drilldown when a region row is clicked |
| `koperasi.getProgressDistribution` | shared filters | Progress % histogram |
| `koperasi.getRegionProgressCategories` | `level`, `province`, `kota`, `kecamatan`, `token` | Region progress buckets |
| `koperasi.getDataEarliestReportSummary` | shared filters | |
| `koperasi.getDataEarliestReportHeavyTasks` | shared filters (was 500ing when filters null, fixed as of 2026-07-28) | |
| `koperasi.listPrerequisiteSarpras` | `page`, `limit`, `search`, `status` (`"all"`/`"ready"`/`"not_ready"`), `kodimId`, `batch`, `provinceId`, `cityId`, `districtId` | **This is the "Prasyarat Operasional" list.** Rows: `koperasiName`, `picName`/`picPhoneNumber` (Babinsa), `kodimName`, `provinceNama`, `kotaNama`, `kecamatanNama`, `desaNama`, `address`, plus 8 boolean site-readiness fields (`lkDinding`, `areaParkir`, `air`, `listrik`, `colokanAc`, `mcb`, `kabel`, `aksesJalan`) each with photo `evidence`. Response includes `total` for the matched filter — use it for pagination math. Frontend page (`/data-siap-fisik`) was removed from nav as of 2026-07-28 but the endpoint still works. |

### Region / military hierarchy lookups
| Procedure | Params |
|---|---|
| `wilayah.searchProvinces` / `searchCities` / `searchDistricts` / `searchVillages` | `limit` (send generously, e.g. 500–1000, to get full lists) |
| `kodam.list` / `korem.list` / `kodim.list` | `limit` |

### Daily reports ("Performa Harian", `/laporan` — removed from nav 2026-07-28 but still live)
| Procedure | Params |
|---|---|
| `reports.getKoperasiSortedByLaporan` | `limit`, `offset`, `completedLimit`, `completedOffset`, `dateFrom`, `dateTo`, `koperasiId`, `provinceKode`, `kotaKode`, `kecamatanKode`, `desaKode`, `kodamId`, `koremId`, `kodimId`, `reportedFilter`, `timezoneOffset`, `progressFilter`, `sortBy` (e.g. `"progress_desc"`), `includeCompleted` |
| `reports.getCompletedKoperasiSortedByLaporan` | subset of the above |

### Vendor sarpras delivery (`/monitor-laporan-vendor`)
| Procedure | Params | Notes |
|---|---|---|
| `laporanVendor.getMonitorStats` | `batch` (e.g. `"batch1"`) | Stat cards: `targetPeresmian`, `totalKoperasi`, `highPriorityCompleteCount`, `allCompleteCount` |
| `laporanVendor.getVendorReportedKoperasiMap` | `provinceIds`, `cityIds`, `districtIds`, `batch`, `isPriority` (all nullable) | **The main bulk-export endpoint.** Returns `{points, provinceOptions, cityOptions, districtOptions, batchOptions}`. `points` is the full unpaginated array (one row per koperasi with any vendor report — 17,922 as of 2026-07-28, confirmed matches the UI's displayed total exactly, i.e. not truncated). Each point: `koperasiId`, `koperasiName`, `desaNama`, `kecamatanNama`, `kotaNama`, `provinceNama`, `kodimName`, `batch`, `totalLaporan`, `totalVendor`, `pengirimanCount`, `transitCount`, `tibaCount`, `terpasangCount`, `latestReportAt`, `completedSarprasCount`, `completedRequirementCount`, `totalRequirementCount`, `statusCategory`, `lat`, `lng`. |
| `laporanVendor.getCompleteMonitor` | `provinceId` (**required non-null string** — omit `null`, must resolve a real province id first via `wilayah.searchProvinces`), `includeKoperasiList` | Full detail grouped by Kodim → koperasi, each with a `sarprasReports` map keyed by `SARPRAS-<uuid>` → `{status, vendorName, jumlahPaket, catatan, ...}`. Use this to get per-item vendor/status detail after finding target koperasi via the map endpoint. |
| `laporanVendor.getTerpasangSummaryForPusat` | `status` (`"tiba"`/`"terpasang"`) | Nationwide arrival/install summary |

**`statusCategory` values** (confirmed 2026-07-28 by reading the frontend's `STATUS_STYLES` map directly — see portalkdkmp-api-notes.md for the source snippet): `mandatory_complete` (🟢 Hijau, "Primary lengkap", 1,148 koperasi), `below_10` (🔴 Merah, "Sarpras di bawah 10", 16,411), `partial` (🟡 **Kuning**, "Sarpras 10+ belum lengkap", 363), `secondary_complete` (🟠 **Oranye**, "Secondary lengkap", 0 koperasi currently), `complete_all` (🔵 Biru, "Semua sarpras lengkap", 0 koperasi currently), `no_report` (⚫ Abu-abu — never appears in `points`, koperasi with zero vendor reports aren't included in this endpoint at all). **Kuning and Oranye are distinct enum values, not just different rendering of the same category** — this was previously unconfirmed/guessed.

### Sarpras master data (`/pengaturan-vendor-sarpras` — removed from nav 2026-07-28 but still live)
| Procedure | Params | Notes |
|---|---|---|
| `masterSarpras.list` | — | **Source of truth for item catalog.** Returns `id` (`SARPRAS-<uuid>`), `name`, `jumlahUnitPerPaket`, `order`, `priority` (`Mandatory`/`High`/`Medium`/`Secondary`), `group`, `deskripsi`, timestamps. 29 items total, **full list confirmed 2026-07-29**: <br>**Mandatory (5):** Kasir + Software, CCTV, Internet LTE (`group:"internet"`), Starlink (`group:"internet"`), Truk. <br>**High (6):** Gerai Rak, Mebel, AC, APAR, Motor Bak Roda 3, Pickup 4x4. <br>**Medium (10):** ATK, Chest Freezer, Chiller, Kipas Angin Jumbo Industrial, Komputer AIO, Loker Lemari, Mesin Absensi Karyawan, Paket Security Alarm, Printer, Seragam Manajer KDKMP. <br>**Secondary (8):** Exhaust Fan, Keranjang Belanja Tarik, Tempat Sampah, Seragam Karyawan KDKMP, Brankas, Keranjang Belanja jinjing, Pallet, Genset. <br>The 11 Medium/Secondary items above have `order: null` (portal hasn't ranked them for display yet) — sort them after the ranked items, not at position 0. **Do not use this list to recompute completion tiers** — verified against live data that neither OR nor AND over the Mandatory items reproduces the portal's `statusCategory`, because tiers are evaluated per-koperasi against an allocated Requirement Set. See `docs/adr/0004-trust-portal-statuscategory.md`. The per-item export columns include **all 29 items regardless of priority** — only Tier membership is priority-gated, per-item reporting isn't. |
| `alokasiSarpras.getMasterSarprasList` | — | Simpler id→name→unitPerPaket lookup, no priority/group |
| `alokasiSarpras.getKodimList` | `kodamId`, `provinceKode`, `kodimIds` | Kodim allocation table |
| `vendorMaster.list` / `vendor.list` | — | Vendor master data (two endpoints, overlapping/possibly-duplicate data) |

### New/unconfirmed — `/pengiriman-sarpras` (appeared 2026-07-28, needs more probing)
| Procedure | Params | Notes |
|---|---|---|
| `pengirimanSarpras.getDataSarprasDashboard` | `kodamId`, `provinceKode` (both required non-null strings — omit key entirely to mean "all", not `null`; **`provinceKode` is the BPS 2-digit code from `wilayah.searchProvinces`'s `kode` field, e.g. `"33"` for Jawa Tengang — NOT the opaque `id`/`value` used everywhere else**) | Returns `{summary, villages[], kodimShipmentAnalytics}`. `summary`/each village has `totalKoperasi`, `koperasiLengkap`, `koperasiBelumLengkap`. **Confirmed 2026-07-29: `koperasiLengkap` is 0 in literally every one of 35,966 villages nationally** — it tracks the strict "all 29 sarpras items" bar (same as `laporanVendor`'s Complete-All/Biru tier, also 0 nationwide), not Mandatory-Complete/Hijau. Also covers a much larger population (35,969 koperasi) than `laporanVendor.getVendorReportedKoperasiMap` (17,927) — likely "koperasi selesai dibangun" generally, not just ones with a vendor report. **Not useful for a per-province Hijau/Mandatory-Complete breakdown** — see CONTEXT.md's note on this. |
| `pengirimanSarpras.getKodimWithCompletedKoperasi` | `kodamId`, `provinceKode` | Table data, likely paginated — **not yet fully explored, check for a per-koperasi detail companion endpoint** |
| `pemetaan.getStatistikVerified` | — | Verified land stats |

### Land mapping (mostly inaccessible to account `002`)
| Procedure | Notes |
|---|---|
| `pemetaan.getApiToken` | Returns 403 for this account — needed to embed the separate land-mapping tool |
| `pemetaan.getEmbedAccess` | 200 — access check passes even though the token call fails |

## Gotchas

- Tool/fetch responses can be huge (15k+ rows) — always paginate (`page`/`limit` or `offset`/`limit` depending on router) rather than assuming a default `limit` returns everything. Exception: `laporanVendor.getVendorReportedKoperasiMap` returns its full `points` array unpaginated regardless of any limit param (verified against the UI's own displayed total).
- Some endpoints throw 500 if a supposedly-nullable filter is actually required once you dig into it (e.g. `laporanVendor.getCompleteMonitor`'s `provinceId`) — don't assume every `null`-typed param in observed requests is truly optional; test.
- `dateFrom`/`dateTo` are millisecond epoch timestamps, not ISO strings, when populated.
- Field naming for the same concept (province, filter-all-vs-null, etc.) is inconsistent across routers — check each procedure's actual param names rather than assuming.
- The frontend nav is not a reliable map of what's accessible — routes get removed from the sidebar while their backing tRPC procedures keep working. Prefer probing procedures directly over trusting what's linked in the UI.
- This is a live production system for an active government rollout — data changes fast (e.g. vendor-map point count grew ~13% in 10 days) and the schema itself has changed under us once already (new headline fields, dead endpoint, new router). Build the export tool to tolerate new/renamed fields gracefully (e.g. don't hard-fail on unexpected keys) and re-diff this doc periodically.

## Suggested build approach for the export website

1. **Stack:** a simple full-stack app (e.g. Next.js) works well here — same codebase for the fetch layer (server-side, keeps cookie handling off the client) and the UI. Claude Code can scaffold this directly.
2. **Data layer:** one thin client module wrapping the tRPC GET convention (build the `input` query param, attach the session cookie, parse `{result: {data: {json: ...}}}`). Add pagination helpers per-router since page params differ (`page`/`limit` vs `offset`/`limit`).
3. **Export layer:** use `exceljs` (Node, more control over formatting than SheetJS) or `sheetjs`/`xlsx` for `.xlsx`; native CSV can just be joined strings with proper escaping, or reuse a small CSV lib. Stream large exports rather than buffering fully in memory if row counts keep growing.
4. **UI:** a page per "report" (mirroring the sections above — Prasyarat Operasional, Vendor Sarpras Map, Dashboard Stats, etc.), each with filter controls matching the underlying endpoint's params, a preview table, and Download XLSX / Download CSV buttons.
5. **Auth:** implement whichever strategy is chosen above first — everything else depends on it.
6. **Testing data access:** before building each report page, do a quick manual `fetch` against the real endpoint (as done throughout this doc) to confirm current param names/shapes, since this API has already changed once mid-project.
