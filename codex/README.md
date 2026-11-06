# Use OMP memory with Codex

The deployed memory gateway has a remote MCP endpoint:

**https://ompi-memory.roundtrip.workers.dev/mcp**

It searches the separate personal and company stores and routes writes to the selected store. All memory and its Git history remain in Cloudflare Artifacts. This is the local experimental binding `omp-cloudflare-mcp/0.1`, not an official OMP MCP profile.

## Install

Install the [Codex CLI](https://learn.chatgpt.com/docs/codex/quickstart) and sign in, then run from the fork:

```sh
cd prototypes/cloudflare-memory
npm ci
npm run codex:setup
```

The setup script verifies the deployment, registers `omp-memory` with `codex mcp add --url`, and links the checked-in skill into `~/.agents/skills/omp-memory`. It preserves unrelated configuration and refuses to overwrite a different server or skill with the same name. Keep this checkout in place: the skill link points into it. Run setup again safely to check/reuse the same installation.

Codex desktop, CLI, and IDE share MCP configuration. Open a **fresh Codex session** after setup. If the skill does not appear, restart Codex. Check the connection with:

```sh
codex mcp get omp-memory
codex mcp list
npm run codex:check
```

Start with:

> Use $omp-memory to recall my preferences and company context for this task.

Try a harmless persistent write, then open a new chat and recall it:

> Use $omp-memory. Remember in my personal store that my demo mascot is a turquoise otter. This applies user-wide.

> Use $omp-memory. What is my demo mascot?

For company knowledge:

> Use $omp-memory. Remember in the company store that our demo release checklist is called Starfish. This is organization-wide knowledge.

This endpoint is a **public, unauthenticated prototype**. Personal/company are routing targets, not security boundaries. Use sample data, not secrets or private company information.

## Memory use and project context

The skill is available for normal automatic selection. That is best-effort model behavior; MCP does not install a lifecycle hook. Explicitly invoke `$omp-memory` to request retrieval. For projects that should regularly consult memory, merge [AGENTS.example.md](AGENTS.example.md) into that project's existing `AGENTS.md`. Setup does not alter global or project instructions.

The harness supplies actual context, for example:

```json
{
  "query": "",
  "context": {
    "repository": "https://github.com/irvinebroque/Open-Memory-Protocol",
    "directory": "prototypes/cloudflare-memory",
    "paths": ["prototypes/cloudflare-memory/src/index.ts"]
  }
}
```

Repository-relative paths are required. Use `directory: "."` at the root. When there is no remote, omit `repository`; do not invent an identity. Empty context can retrieve unscoped/user/organization records, but cannot match repository records. SSH and HTTPS remotes normalize to the same host/path; a separate fork remains a distinct repository.

Search first returns short snippets and exact references. Fetch selected bodies with `get_memory`. Each result remains attributed to its store and original origin. The default limit is 20, maximum 100; check `total` and `partial`. This is substring search, not semantic search. Full exports preserve extension metadata, while MCP returns a smaller runtime projection.

## Tools

| Tool              | Required inputs                                          | Behavior                                                                                             |
| ----------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `about_omp`       | None                                                     | Capabilities, limitations, and binding guidance. Also available as resource `omp://about`.           |
| `search_memories` | `context`                                                | Optional `query`, `store`, `limit`; otherwise search both stores.                                    |
| `get_memory`      | `store`, `identifier`, `origin`, `context`               | Full runtime record with provenance and an opaque `version`.                                         |
| `add_memory`      | `store`, `body`, `applies_to`, `contributor`             | Optional title, identifier, tags, media type, activation. Server supplies creation time and origin.  |
| `update_memory`   | Reference, context, `if_version`, `patch`, `contributor` | Guarded local edit; omitted and unknown stored fields survive. Imported memories are immutable here. |
| `delete_memory`   | Reference, context, `if_version`                         | Remove from current views and add a tombstone. Historical bodies remain.                             |

Tool schemas reject unknown arguments. Failures return MCP tool errors with a status and guidance. An update conflict means reread and reconcile; blindly retrying the same edit is incorrect. The token hashes one complete memory, so another memory's write does not invalidate it. It is not a standardized OMP revision comparator. Git's own fast-forward check also guards each persistence operation.

Create retries are not guaranteed idempotent: without an identifier a new identity is generated, and server-generated creation/provenance timestamps can differ even with an identifier. Search/read after an uncertain result before trying again. Deletion is not secure forgetting; old bodies remain in Artifacts Git history. Provenance identifies the declared contributor, not an authenticated person or verified evidence.

## Experimental applicability and activation conventions

Inspired by [issue #22 and the editor's November 4 comments](https://github.com/The-AI-Disclosures-Project/Open-Memory-Protocol/issues/22#issuecomment-6644763521). These exact object shapes are ours and may change when upstream settles v0.3.

```json
{
  "applies_to": {
    "level": "repository",
    "repository": "https://github.com/acme/web"
  },
  "activation": {
    "mode": "relevant",
    "description": "Package manager conventions for this repository"
  }
}
```

- `applies_to.level`: `user`, `organization`, `repository`, `directory`, or `paths`. Directory/path levels require a repository plus `directory` or `globs` respectively. Organization/user are applicability labels, not ACLs.
- `activation.mode`: `always`, `paths` with `globs`, `relevant` with a description/title, or `on_request`. Omission behaves as ordinary retrievable data. `always` means eligible on the initial empty-query search; the server cannot force a harness to call it or fit all results in context.
- `paths` matches the task's repository-relative `context.paths` using picomatch globs. `on_request` requires `context.explicit_request: true`, supplied only for an explicit user request.
- Both search and direct MCP reads enforce these conventions and validity dates. Unsupported imported conventions are preserved by interchange but excluded from MCP retrieval. Legacy records without applicability remain unscoped; inspect them before treating their text as global rules.

For a new repository convention, explicitly set its repository applicability. The server does not infer that all text saved to a company store applies to every company project. `scope` remains preserved interchange data; it is not enforced as authorization here.

## Verify

```sh
npm test
npm run mcp:roundtrip -- https://ompi-memory.roundtrip.workers.dev
```

The MCP test uses the official TypeScript client, initializes the protocol, discovers tools/resources, writes and reads both stores, tests cross-repository and activation filtering, and races two guarded edits. It removes its test records afterward; historical bodies/tombstones remain.

`npm run codex:check` starts a fresh Codex app-server, checks discovery of all six deployed MCP tools, and verifies the installed skill is enabled. It makes no model request, creates no chat, and needs no model login. To use the standalone CLI for conversations, run `codex login` if necessary; that is separate from this unauthenticated MCP connection. A model-generated recall check can be performed using the sample prompts above in your signed-in desktop app or CLI.

## Manual setup, custom deployment, and removal

For manual configuration merge [config.example.toml](config.example.toml) into `~/.codex/config.toml`, and copy or symlink `skills/omp-memory` into `~/.agents/skills`. Do not install duplicate copies with the same skill name.

To use a different deployment:

```sh
npm run codex:setup -- https://your-worker.example/mcp
```

Also update the skill's `agents/openai.yaml` dependency URL for that deployment. A previously installed different endpoint is never silently overwritten. Remove it explicitly before switching. The example config includes optional timeouts for slow Git-backed writes.

To uninstall this checkout's connection and skill link, preserving stored memories:

```sh
npm run codex:setup -- --uninstall
```

For a custom endpoint, pass that same URL along with `--uninstall`. No account authentication, automatic synchronization, startup hooks, or native Codex internal-memory migration is provided by this prototype.

Official setup references: [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [skill discovery and symlinks](https://learn.chatgpt.com/docs/build-skills).
