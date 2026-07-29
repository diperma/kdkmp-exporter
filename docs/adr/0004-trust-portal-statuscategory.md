# Trust the portal's `statusCategory`; never recompute completion tiers ourselves

We initially planned to compute "which Koperasi are 100% complete" ourselves from `masterSarpras.list` priorities plus each Koperasi's `sarprasReports` — treating `Internet LTE` / `Starlink` (which share `group: "internet"`) as an either/or requirement.

Tested against live data (4,657 Koperasi in Jawa Tengah, where the portal reports 563 `mandatory_complete`): the OR formula produced 589 with 50 disagreements, and the AND formula produced 17 with 550 disagreements. Neither reproduces the portal's classification. Inspecting the mismatches showed some `mandatory_complete` Koperasi have **no CCTV delivered at all**, while others with LTE delivered but no Starlink are **not** counted complete — i.e. the portal evaluates each Koperasi against its **own allocated Requirement Set** (cf. the per-Koperasi `totalRequirementCount`), not against the global Mandatory catalog. That allocation data has not been located in the API surface yet.

**Decision: `statusCategory` from `laporanVendor.getVendorReportedKoperasiMap` is the source of truth for completion-tier membership.** Exports filter on it directly. Per-item columns report only raw per-item delivery status from `sarprasReports` (a fact), never a derived "complete/incomplete" verdict of our own.

**Consequences:** the exporter can't offer completion tiers the portal doesn't compute (e.g. a custom "90%+ complete" bucket) without first reverse-engineering the Requirement Set allocation — treat that as a separate research task, not a feature assumption. Upside: the exporter's numbers will always reconcile exactly with the portal's own UI, which matters for a reporting tool whose output people will cross-check against the source system.
