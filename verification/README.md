# Live verification

Deployment: https://ompi-memory.roundtrip.workers.dev

Cloudflare account: **Roundtrip**

Worker version: `3e1c262a-67e9-4e7e-bf67-0934d0a3b6fd`

Artifacts namespace: `ompi-memory-prototype`

| Role | Artifact repository | Repository ID |
| --- | --- | --- |
| Personal store | `personal` | `se35ivyywaz5m982` |
| Company store | `company` | `jfd5mjujqire4dc6` |

Seven unit tests and all 14 live checks passed on November 6, 2026. See [live-roundtrip.json](live-roundtrip.json) for the source/destination Artifacts commit hashes and assertions. The live test uses separate HTTP requests for persistence verification, exports a memory to the other store, then exports it back and verifies its identity and extension fields. It also checks federated gateway search, explicit routing, and simultaneous writes.

Independent storage verification used the `cf` CLI, bypassing the application:

```sh
cf artifacts namespaces repos files get personal \
  --namespace ompi-memory-prototype --ref main --path omp-state.json --text
```

The command returned the persisted memory JSON from the actual Artifact. The two early scratch repositories were deleted; only the personal and company stores are connected. Smoke-test objects were removed from current views. Their commits remain in history, as documented. The live demo includes two harmless example notes to try a `TypeScript` search across stores.

Dependency audit: zero known vulnerabilities at verification time.
