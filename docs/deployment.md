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

## Access key

The browser's **Access key** is the shared password for your deployed demo. Anyone with it can chat with the agent and access both Personal and Company memory stores, including memory changes through the API. Keep it private.

- **You deployed the demo:** use the value you created and saved as `MEMORY_API_TOKEN` during deployment. Paste that same value into **Connect → Access key**.
- **Someone shared their deployment with you:** ask its owner for the access key.
- **You are running locally:** the development key is filled in automatically.
- **You lost your deployment's key:** generate a replacement and redeploy using the [rotation instructions](#rotate-and-remove). Existing clients will need the new key.

The browser sends the key only to this demo with its requests. It keeps the value in tab memory and forgets it on refresh. Enter the demo's key here; Cloudflare API tokens are used separately for deployment.

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

## Pi chat agent

The Worker also declares `MemoryAgent`, a SQLite Durable Object class, and the `AI` Workers AI binding. `cf` reconciles the Durable Object export on deployment; no namespace ID is checked into source. The deploy-button metadata declares the same class and binding. Copied project names are also used by the self-binding, so a new template deployment gets its own conversation namespace.

`CHAT_MODEL` is configured in `cloudflare.config.ts` as `@cf/zai-org/glm-5.3-flash`. Change that setting to a compatible Workers AI model if needed. It affects newly created Pi conversations; existing sessions retain their model reference. Pi packages are pinned to the supported 1.5 minor line and exact installed versions are in the lockfile. Roll forward rather than rolling back to an incompatible Pi storage version.

Remote AI is opt-in locally: `OMP_REMOTE_AI=true npm run dev`, after `cf auth login` and account selection. Artifacts remains explicitly local even with AI enabled; local chats use local SQLite, and only model inference goes to Workers AI. The default `npm run dev` and CI do not make paid inference calls. Production always uses the real AI binding. Review [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

For deployment from a copied template, ensure the build token has Workers Scripts Edit and Artifacts Edit, and can deploy the declared Durable Object and Workers AI bindings. The demo access key remains a separate private runtime secret. No model provider API key is needed.
