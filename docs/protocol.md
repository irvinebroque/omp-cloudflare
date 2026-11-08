# Protocol coverage and exchange

The protocol source is the OMP [editors’ v0.5 working draft](https://github.com/The-AI-Disclosures-Project/Open-Memory-Protocol/blob/main/working-group/exchange-and-runtime/2026-11-06-working-spec-v0.5.md). It describes individual memories; several manifest and lifecycle decisions remain open. This implementation is a community example, not a conformance authority.

| Area                 | Behavior here                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Minimal memory       | Required identifier, valid MIME label, timestamp and string body                                        |
| Draft v0.5 additions | Optional `protocol_version` and finite, unbounded `weight` are preserved                                |
| Extensions           | Unknown JSON fields survive validation, storage, exchange and ordinary updates                          |
| Envelope             | Experimental JSON `manifest` + `memories` + `tombstones`, snapshot/copy/minimal only                    |
| Versions             | New envelopes use `0.5`; legacy `0.2` envelopes accepted; unsupported versions rejected                 |
| Identity             | `(origin, identifier)` internally; `x_omp_origin` is this example’s extension                           |
| Import               | Accepted/unchanged/rejected receipt per memory; conflicting content never silently replaces an identity |
| Delete               | Tombstone blocks stale replay; historical Git blobs remain                                              |
| Transport            | Experimental HTTP `/fmp/…` routes and MCP binding `omp-cloudflare-mcp/0.1`                              |
| Runtime              | Local `applies_to`, `activation`, contributor and SHA-256 concurrency conventions                       |

`weight` is not interpreted as a cross-origin score. Media labels can describe UTF-8 textual formats such as JSON, XML, CSV or Markdown. Binary bodies are unsupported. The service preserves evidence, links and provenance as JSON; it does not verify their claims. MCP contribution edits reject unsupported provenance shapes rather than discarding evidence.

## Portable identifiers and links

Ordinarily, export keeps the original identifier. If two origins contain the same identifier, export gives those records deterministic SHA-256-derived identifiers so the archive has unique identifiers. A manifest extension, `x_omp_identity_map`, records original identity for lossless return to this service.

Proposed typed metadata links shaped like `links: [{target, ...}]` are rewritten to exported identifiers within the source origin; import restores the targets when the identity map is present. Unknown edge shapes and external references are left untouched. Inline body references are opaque text and are not rewritten: if you rely on inline IDs, use identifiers unique across origins before combining stores. This limitation matters in the collision case.

A generic receiver can use the unique exported IDs and typed links without understanding our identity map. The independent Python folder example demonstrates that boundary and preserves the identity extension as opaque JSON. It is deliberately a file adapter, not a second complete OMP implementation.

```mermaid
sequenceDiagram
  participant A as Original store
  participant F as Python folder adapter
  participant B as Other store
  A->>A: Validate memory + preserve extensions
  A->>F: JSON snapshot with unique exported IDs
  F->>F: Store each memory as JSON
  F->>B: Export unchanged metadata and envelope
  B->>B: Validate, restore identity map, merge
  B-->>A: Per-memory receipts; origin retained
```

## Pagination and consistency

Search cursors bind to the arguments and current commit(s). Changing a query or writing to either participating store invalidates a cursor with 409. Restart traversal after reconciling. Gateway results attribute each hit to its store and report `partial` if a store is unavailable.

Export places active memories in the first page and up to 50 tombstones in each page. `OmpClient.snapshot()` collects every page. `importSnapshot()` splits a collected snapshot into bounded requests; successful earlier requests remain committed if a later request fails. Inspect errors and receipts and safely repeat identical imports. No multi-request atomicity is claimed.

## Runtime retrieval

MCP searches summaries, then retrieves selected full memories. Actual repository remotes and repository-relative paths control local applicability checks. Unknown applicability is excluded rather than promoted to global knowledge. `on_request` requires `context.explicit_request: true`. These are retrieval conventions, not tenant authorization.

A version is a SHA-256 of canonical full memory JSON. It is an opaque optimistic-concurrency token, not the OMP draft’s version comparator. Git non-fast-forward rejection protects store writes; bounded retry reclones and reapplies operations. An `if_version` conflict survives retries and is returned to the client.

## Limits

This is a small, inspectable example: 100 active memories and 512 KiB of active JSON per store, 16 KiB per body, and 1 MiB per API request. Search is substring matching. Bodies are UTF-8 strings with valid MIME labels; binary transport is unsupported. Git history and tombstones grow over time.

## Unsupported

No adopted reference designation, full-profile conformance, official manifest schema, secure forgetting, cryptographic provenance, multi-tenant authorization, binary memory transport, move transfers, vector retrieval, automatic agent hooks, transcripts, file attachments, or realtime synchronization is claimed.

## Git request isolation

Each mutation creates its own in-memory filesystem and runs inside an `AsyncLocalStorage` lock scope. Vite aliases the `async-lock` import used by pinned `isomorphic-git` 1.44.11 to `src/storage/git-lock.ts`. That adapter implements the promise-mode `acquire` contract used by this dependency, including ordered batch keys. Development excludes that alias from dependency prebundling so the adapter and mutation use one shared context instance. Locks serialize operations inside one mutation and never queue work from another request.

The upstream library otherwise shares path/ref locks across an entire isolate, even when requests use separate filesystems. In live concurrent testing this caused Workers to cancel requests as hung. Keep the exact Git version pinned, retain the alias, and validate the adapter contract and live concurrency before upgrading it. Git's non-fast-forward rejection and bounded re-clone/reapply loop remain the guard against competing remote writes; these request-local locks do not replace that guard.
