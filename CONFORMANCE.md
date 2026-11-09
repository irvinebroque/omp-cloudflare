# Protocol coverage

This example targets the [OMP v0.5 editors’ draft](https://github.com/The-AI-Disclosures-Project/Open-Memory-Protocol/blob/main/working-group/exchange-and-runtime/2026-11-06-working-spec-v0.5.md), with the minimal profile. The draft is not an adopted standard. Its manifest, reference addressing and runtime bindings are still evolving. `/fmp/info` describes the supported subset and local conventions. This repository does not claim full OMP conformance.

## Memory and lifecycle

The API validates required metadata, all currently typed optional standard fields, contributor records and calendar dates. Timestamps use ISO 8601's extended date/time form with `Z` or an explicit offset. Unknown JSON fields, including nested contributor and reference extensions, survive exchange. Evidence remains a list of strings or reference objects; links remain a list of objects because their detailed schemas are open in the draft.

New writes record either the supplied self-declared contributor or the known `system:omp-cloudflare` process. The latter records that the system stored or changed the memory; it does not invent the original author or an accountable human. The Pi chat tool identifies itself as `agent:pi-chat`. Updates append contribution records and cannot replace provenance. Deletes leave content-free markers recording a writer, time and reason; content remains in Git history. Imported memories keep their original provenance, including its absence, and remain immutable locally.

Ordinary HTTP and MCP reads and searches exclude future, expired and superseded records. HTTP read accepts `include_inactive: true` to inspect an inactive current record explicitly. This does not request a previous Git revision, and applicability is still checked. Supersession follows recognized `supersedes` edges whose memories have become effective; expiry of the replacement does not revive the superseded record. Supersession is local to an origin unless an edge explicitly supplies its target's `origin`.

Older versions could store malformed standard metadata. Loading an existing store preserves those complete records in an internal `quarantined` array, while valid memories remain available. Search reports `quarantined_records`; export reports the count and reason under `manifest.x_omp_omissions`. Quarantined data is excluded from memory use and exchange. Repair it in the source Artifacts repository, retaining the original identity and recording the correction; it is not silently converted into invented metadata or deleted.

## References and exchange

The local `omp-cloudflare-references/0.1` convention recognizes `{target, origin?}` objects in links and evidence and exact `[[identifier]]` references in plain text or Markdown. A `target` is an opaque memory identifier, including when it contains colons. External sources can use `{uri: "https://..."}`; free-form evidence strings and other object shapes remain opaque. These conventions are experimental, not adopted OMP syntax.

Missing recognized targets are retained. HTTP reads/searches and MCP results expose `dangling_references`; export exposes `manifest.x_omp_dangling_references`. These diagnostics are computed separately, so resolving a target does not rewrite the source record or invalidate its concurrency token.

Exports keep identifiers unique when several origins contain the same identifier. Collision aliases are applied consistently to recognized links, evidence and inline references. `x_omp_identity_map` restores original identities and references on import. Unrecognized reference shapes survive unchanged; another implementation must understand this experimental convention to reconstruct them. Portable checksums are preserved: an export that would change a checksummed record fails rather than emitting a stale checksum. Export one origin separately with `?origin=<URL-encoded-origin>` in that case. Local authoring/update does not accept portable `checksum` or `version` fields; use import to retain externally authored values. The local response `version` is a concurrency token, not an OMP revision comparator.

The supported exchange intent is `copy`, with `minimal` snapshots or selections. Absence never deletes data. Import provides receipts and preserves original identities across retries. Each HTTP export page is labelled `selection` and carries `x_omp_pagination` metadata. Collect every page against the same commit before treating the result as a snapshot. The bundled client and browser exporter do so and remove the pagination marker when complete. A page alone must not be treated as a complete deletion ledger. Tombstone transfer is incremental, rather than an atomic cross-store transaction.

## Credentials and supported profiles

Write, update, import and export boundaries reject recognizable credential fields, labelled password/key assignments, common key formats, private-key material, credential-bearing URLs and the deployment access key. Rejections do not echo the credential. Export also checks existing records. This is a deterministic rejection policy, not a universal classifier: arbitrary unlabelled secrets can resemble ordinary text. Do not submit secrets as memory. The policy rejects a whole operation rather than silently redacting unknown metadata.

Audit, secure forgetting, ACL enforcement, Markdown directory loading, moves, automatic hooks and real-time sync remain unsupported. The personal/company stores share one operator token. Git history provides persistence and revision inspection; it does not by itself establish the audit profile or erasure guarantees.

## Verification

`npm run verify` includes strict checks, unit tests, builds and isolated HTTP/MCP/concurrency/exchange tests. The `conformance:roundtrip` script adds regression checks for malformed metadata, provenance, lifecycle, dangling references, credential rejection and export completeness. These checks verify this implementation's supported contract; they are not an official OMP certification suite.
