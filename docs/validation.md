# Validation record — November 8, 2026

This record describes the checks actually run for the initial standalone example. It is evidence for these versions and environments, not an OMP conformance certification or a claim that every Cloudflare account has the same plan and permissions.

## Reproduce the automated suite

```sh
npm ci
npm run verify
npm run test:quality
npm audit --omit=dev
```

The development environment used Node 24.22.0, npm 11.19.1, Vite+ 1.5.0, `cf` 1.0.0-beta.28, and Python 3. Local checks ran on macOS; [GitHub Actions](https://github.com/irvinebroque/omp-cloudflare/actions/workflows/ci.yml) repeats a clean install and the same checks on Ubuntu with Python 3.12. The lockfile pins the resolved dependencies.

| Check                                                                                     | Result                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oxfmt, Oxlint with type-aware linting and native type checking, strict browser TypeScript | Passed; warnings fail                                                                                                                                   |
| Unit tests                                                                                | 21 passed across four files                                                                                                                             |
| Production Worker and browser builds                                                      | Passed using `cf build` delegating to Vite+                                                                                                             |
| Registered Dillon Mulroy anti-slop rules                                                  | Accepted the single-pass fixture; rejected the filter/map fixture                                                                                       |
| Production dependency audit                                                               | Zero reported vulnerabilities at validation time                                                                                                        |
| Public assets / protected endpoints                                                       | UI and health are public; unauthenticated memory and MCP requests return 401                                                                            |
| Invalid inputs                                                                            | Malformed JSON 400; wrong content type 415; over-1-MiB body 413                                                                                         |
| Persistence and isolation                                                                 | Memory survives process restart; a fresh deployment has a distinct store origin                                                                         |
| Independent exchange                                                                      | Standard-library Python receiver/exporter preserves the complete snapshot JSON without importing the TypeScript implementation                          |
| HTTP scenarios                                                                            | 14 checks: write/read/search, routing, copies, receipts, conflicts, concurrency, tombstones, history, and invalid body                                  |
| MCP scenarios                                                                             | 8 checks: initialize/discover, resources, six tools, context applicability, provenance, conditional writes/deletes, invalid arguments, concurrent edits |
| Portability regressions                                                                   | 6 checks: opaque IDs and extension data, evidence, pagination, collision-safe exports, idempotence, and multi-page tombstone replay prevention          |
| Request-isolation concurrency                                                             | Four simultaneous HTTP requests per wave across both stores; 16 records read back and removed                                                           |
| Full snapshot SDK                                                                         | Collects every tombstone page and imports bounded chunks; stale deleted content stays absent                                                            |

The E2E runner uses fresh temporary Artifacts simulators and removes them afterward. Its server restart and independent-origin checks do not depend on an existing developer checkout or Cloudflare credentials. Live test records are removed from current views; Git history and deletion markers retain them.

## Deployment flow and live service

The final application source is commit `020930194df2128d27ed1e98b7ffb21bb7e6c799`, deployed as Worker version `156397ab-3294-4e8a-a23d-3750630ec1b7`. Its [clean-install CI run](https://github.com/irvinebroque/omp-cloudflare/actions/runs/42494216167) passed all 21 unit tests and the complete E2E suite.

The request-isolation source is commit `35041044ad0efc34adf20bec9146741ef7dbdcbd`, deployed as Worker version `c151d6ef-b313-47ab-93ce-86b1e09a39ba`. Its [clean-install CI run](https://github.com/irvinebroque/omp-cloudflare/actions/runs/42494019596) exercises the additional concurrency suite.

The service was deployed with `npm run deploy` to [omp-cloudflare.roundtrip.workers.dev](https://omp-cloudflare.roundtrip.workers.dev). Live checks use a private bearer token; the public URL does not grant access to memory contents.

The **Deploy to Cloudflare button was exercised in the actual authenticated dashboard**, creating a new private GitHub copy and a separately named Worker. Production build `91846784-2061-459a-bf8c-862d419d9114` installed Node 24.22.0 from the repository, built the Worker and UI, created a fresh Artifacts namespace, and deployed Worker version `276750a1-0962-439d-92f4-06a58cc94338`. The generated operator token worked; requests without it were denied. HTTP, MCP, and portability checks passed against both the CLI deployment and this independent copy.

The first button attempt exposed a mismatch between the name rewritten in `wrangler.jsonc` and the name used by `cf`. The shared project-settings loader and its unit test fix that path. Preview builds were disabled; preview deployment is not part of this validation. The copied repository also rebuilt successfully from the final application changes (build `3ec48463-8b99-40d3-9e9a-ea43860fd76f`, Worker version `27306801-8415-409a-b1e0-8f60928bb1d5`), preserving the private runtime secret. Temporary Workers and namespaces were removed after validation, their private GitHub copies archived, and the dedicated build token removed. The primary demo remains deployed.

Live concurrency also exposed upstream `isomorphic-git` locks shared across requests, which Workers canceled as hung. The final implementation isolates those locks per mutation using the adapter described in [protocol notes](protocol.md#git-request-isolation). Both local E2E and live concurrent requests passed with that adapter, including a second independently provisioned Worker. SDK and browser clients report a non-JSON upstream failure with its HTTP status instead of hiding it behind a JSON parse error.

For your own deployment:

```sh
export OMP_API_TOKEN=your-private-runtime-token
export OMP_URL=https://your-worker.your-subdomain.workers.dev
npm run roundtrip -- "$OMP_URL"
npm run mcp:roundtrip -- "$OMP_URL"
npm run regression:roundtrip -- "$OMP_URL"
npm run concurrency:roundtrip -- "$OMP_URL"
```

These commands write disposable sample memories and retain their history. Run them only against an account and deployment you own or are authorized to test.

## Browser and real model checks

The browser workflow was exercised against the local simulator and the live deployment: connect, save, search, read, conditional edit, download a snapshot, switch stores, upload that snapshot, inspect import receipts, and delete test content. A literal `<script>` string was rendered as text. The live page also fit a 390-pixel viewport without horizontal overflow.

Codex CLI 0.162.1 setup was tested in an isolated home/config directory: repeated setup is idempotent, a fresh app-server process discovers all six MCP tools and the memory skill, and uninstall removes only the entries created by the setup command. The user's global Codex configuration was not changed.

Two fresh real Codex model processes then exercised the deployed service. The first saved a randomly generated canary through MCP. An independent REST read verified persistence. The second process searched and fetched that memory and recalled its random value; that value was absent from the second prompt. The canary was deleted from current views afterward. Machine-readable evidence is in [the validation directory](validation/).

## Limits of this record

Deployment requires Workers Paid, Artifacts access, and build credentials with the documented permissions. Beta platform behavior can change. There is no load, soak, secure-forgetting, multi-tenant isolation, binary transport, or full-profile conformance claim. Runtime context filters govern retrieval, not authorization. See [coverage and limits](protocol.md) before extending the example.
