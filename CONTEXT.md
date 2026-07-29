# Portal KDKMP Exporter

Standalone tool that pulls data out of the internal Portal KDKMP system and exports it to XLSX/CSV. This glossary covers the domain terms specific to that source system and to this exporter — see `CLAUDE.md` for the full reverse-engineered API reference.

## Language

**Koperasi**:
One cooperative/site being tracked by the program, roughly one per desa. Identified by an opaque `koperasiId`.
_Avoid_: Site, unit (in this project, always call it Koperasi).

**Sarpras**:
Sarana & prasarana — the vendor-supplied physical equipment (furniture, CCTV, trucks, uniforms, etc.) delivered to a Koperasi after it's built.
_Avoid_: Equipment, goods, materials.

**Prasyarat Operasional**:
Whether a Koperasi's physical site is ready for construction (walls, water, electricity, road access), reported by Babinsa. Entirely independent of Sarpras delivery — a Koperasi can meet this with zero vendor equipment delivered.
_Avoid_: Readiness, site status (ambiguous with Sarpras Completion Tier below — always say "Prasyarat Operasional" for this concept).

**Sarpras Completion Tier**:
A Koperasi's vendor-delivery progress, expressed as one of six mutually exclusive tiers (the `statusCategory` field). **This is the field to use whenever someone says a Koperasi is "100% lengkap"** — but "100%" is ambiguous by itself; always resolve to a specific tier:

| Tier (`statusCategory`) | Color | Meaning |
|---|---|---|
| **Complete-All** (`complete_all`) | Biru | Literally every Sarpras item, all priority tiers, delivered. The strict "100%". Zero Koperasi nationwide as of 2026-07-28. |
| **Mandatory-Complete** (`mandatory_complete`) | Hijau | All `Mandatory`-priority items delivered (Kasir + Software, CCTV, Truk, and Internet LTE or Starlink). This is what "sudah 100%" colloquially means in practice — the launch-readiness bar — since Complete-All is currently unreached by anyone. 1,148 Koperasi as of 2026-07-28. |
| **Secondary-Complete** (`secondary_complete`) | Oranye | All `Secondary`-priority items delivered (independent of whether Mandatory items are done). Zero Koperasi nationwide as of 2026-07-28. |
| **Partial** (`partial`) | Kuning | 10 or more Sarpras items delivered, but doesn't meet a tier above. |
| **Below-10** (`below_10`) | Merah | Fewer than 10 Sarpras items delivered. |
| **No-Report** (`no_report`) | Abu-abu | No vendor report submitted at all. Never appears in `laporanVendor.getVendorReportedKoperasiMap`'s results — only inferable by absence. |

_Avoid_: "100% lengkap" alone — always name the tier (usually Mandatory-Complete is what's meant).

**Report Scope**:
What one export covers: a single **Sarpras Completion Tier**, or `all` — every Koperasi that has any vendor report at all. Scope is not a tier; `all` deliberately spans every tier at once, and no Koperasi is ever counted twice because tiers are mutually exclusive.
_Avoid_: calling `all` a "category" or "tier" — it's the absence of a tier filter.

**Priority** (Sarpras item attribute):
Each Sarpras item type (from `masterSarpras.list`, 29 items total) has one of four priority levels — `Mandatory` > `High` > `Medium` > `Secondary` — which determines which Sarpras Completion Tier a Koperasi can reach. Membership has changed over time (see `CLAUDE.md` changelog) — re-verify before hardcoding which items are Mandatory. **The per-item export columns cover all 29 items regardless of Priority** — Priority determines Tier membership, it does not gate what appears in a per-item report.

**Requirement Set** (per-Koperasi):
The set of Sarpras items a *specific* Koperasi is required to receive — an allocation, not a global list. Surfaced as `totalRequirementCount` / `completedRequirementCount` per Koperasi. **A Koperasi's Sarpras Completion Tier is evaluated against its own Requirement Set, not against the global Priority catalog.**
_Avoid_: "kelengkapan wajib" as if it were the same for every Koperasi — it isn't.

**Why we don't recompute Completion Tier ourselves** (verified 2026-07-28):
Attempts to reproduce the portal's `mandatory_complete` classification from `masterSarpras.list` priorities + `sarprasReports` statuses failed in both directions, across 4,657 Jawa Tengah Koperasi:

| Formula over global Mandatory items | Portal says 563 | Our count | Disagreements |
|---|---|---|---|
| Internet LTE **OR** Starlink | 563 | 589 | 50 (38 false-positive, 12 false-negative) |
| Internet LTE **AND** Starlink | 563 | 17 | 550 |

Both directions are explained by the Requirement Set: some `mandatory_complete` Koperasi have **no CCTV delivered at all** (CCTV evidently isn't in their Requirement Set), while others with Internet LTE delivered but Starlink missing are **not** counted complete (Starlink evidently is in theirs). So neither OR nor AND over the global Mandatory list is correct, and the allocation data needed to do it properly hasn't been located yet (possibly `alokasiSarpras.*` — unexplored).

**Consequence: treat the portal's own `statusCategory` as the source of truth for tier membership.** Per-item columns in an export should report raw delivered/not-delivered status per item (factual), never a derived "lengkap/belum" verdict of our own.

## Example dialogue

> **Dev:** Bikin laporan koperasi yang udah 100%.
> **Domain expert:** 100% yang mana — Mandatory-Complete (Hijau), atau Complete-All (Biru)?
> **Dev:** Yang udah ada truk sama kelengkapan intinya aja.
> **Domain expert:** Itu Mandatory-Complete. Complete-All itu semua 29 jenis item termasuk yang Secondary/Medium — belum ada satupun Koperasi yang capai itu.
