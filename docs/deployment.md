# Deployment

The CLI entry point is `npm run deploy`, which runs `scripts/deploy.ts` with Vite+’s TypeScript runner. It uses `cf` to inspect the Artifacts namespace, creates it only on an explicit not-found response, and deploys the Worker. Authentication/permission failures stop deployment rather than being mistaken for missing resources.

## Configuration

| Setting                 | Default                          | Purpose                                                           |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | Selected by `cf`                 | Your account; never checked into the template                     |
| `OMP_WORKER_NAME`       | Project name in `wrangler.jsonc` | Worker name for CLI deployments                                   |
| `OMP_NAMESPACE`         | Project name in `wrangler.jsonc` | Artifacts namespace; use a fresh name for an independent instance |
| `MEMORY_API_TOKEN`      | Required in production           | Private token, at least 24 characters; generate 32 random bytes   |
| `OMP_API_TOKEN`         | Unset                            | Client/Codex bearer token; not a Worker configuration variable    |
| `OMP_STATE_DIR`         | `.cloudflare/state`              | Local simulator persistence                                       |
| `OMP_PORT`              | `5173`                           | Local server port                                                 |

`cloudflare.config.ts` is authoritative for `cf`. The small `wrangler.jsonc` exists for the deploy-button discovery service. It has no account ID, credentials, or resource IDs. The project name and compatibility date are read from it by `scripts/project-settings.ts`, so a name rewritten by the deploy button is also used by `cf`. The default namespace follows that project name; explicit `OMP_NAMESPACE` overrides it. The deploy script handles Artifacts because it is absent from the button’s automatic provisioning list.

A copied template can share one namespace across repeated deployments. To isolate a second instance, set a different namespace. `personal` and `company` repositories are created lazily through the binding. Their Artifacts IDs supply stable store origins; neither account IDs nor hardcoded deployment names are used as memory identities.

## Build credentials

For Workers Builds, the selected API token needs Workers Scripts write permission and Artifacts write access for namespace inspection/provisioning. Account-scoped permissions must cover the destination account. Cloudflare may update the labels in its token editor; use the permissions accepted by `cf artifacts namespaces get/create` and `cf deploy`.

The runtime `MEMORY_API_TOKEN` and the Cloudflare deployment API token are different secrets. Never put the Cloudflare API token in the browser. The browser sends only the runtime token to its own origin and retains it only in tab memory.

## Common failures

| Symptom                                                 | Resolution                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Namespace inspection gives 403                          | Check the selected account and build token’s Artifacts access                                           |
| Namespace creation fails on a free account              | Enable Workers Paid / Artifacts access before retrying                                                  |
| Protected API returns 503 asking for `MEMORY_API_TOKEN` | Set the runtime secret and redeploy; use at least 24 characters                                         |
| API or MCP returns 401                                  | Export the matching `OMP_API_TOKEN` or enter it in the browser                                          |
| Local port already in use                               | Stop the other process or set `OMP_PORT`; strict-port mode does not silently choose another port        |
| 409 on update/delete                                    | Fetch the current memory and reconcile; send its new `version`                                          |
| 409 on cursor                                           | Store changed during pagination; restart the search/export                                              |
| Expected JSON, received HTML                            | An upstream service returned an error page; inspect the HTTP status and Cloudflare logs before retrying |
| Import reports `identity_conflict`                      | Existing identity has different content; preserve both or author a new local record                     |
| Import reports `deleted_identity`                       | A tombstone blocks replay of deleted content; use a new identity for new knowledge                      |

## Rotate and remove

Generate a new `MEMORY_API_TOKEN` and run `npm run deploy` with it set. Update client environments and restart Codex. Existing clients using the old token receive 401.

Deleting the Worker does not erase Artifacts repositories. Export anything needed, then explicitly delete its dedicated namespace from your Cloudflare account if permanent teardown is intended. Do not delete a namespace shared with another Worker. Local reset is separate: stop dev, then remove `.cloudflare/state`.

Sources: [cf setup](https://developers.cloudflare.com/cf/get-started/), [programmatic configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/), [deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [Artifacts setup](https://developers.cloudflare.com/artifacts/get-started/).
