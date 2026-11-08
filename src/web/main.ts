import { z } from "zod";
import type { JsonInput } from "../protocol/json.ts";

const json = z.json();

const memorySchema = z
  .object({
    identifier: z.string(),
    body: z.string(),
    title: z.string().optional(),
    media_type: z.string(),
    x_omp_origin: z.string().optional(),
  })
  .catchall(json.optional());

const readSchema = z.object({ memory: memorySchema, version: z.string() });

const searchSchema = z.object({
  memories: z.array(memorySchema),
  total: z.number(),
  next_cursor: z.string().nullable(),
});

const importSchema = z.object({
  manifest: json,
  memories: z.array(json).max(100),
  tombstones: z.array(json).default([]),
});

const exportSchema = z
  .object({
    manifest: z.object({ x_omp_identity_map: z.array(json).optional() }).catchall(json.optional()),
    memories: z.array(json),
    tombstones: z.array(json),
    next_cursor: z.string().nullable(),
  })
  .catchall(json.optional());

type SearchInput = { query: string; limit: number; cursor?: string };

type Reference = { identifier: string; origin?: string };

type Selection = z.infer<typeof readSchema>;

function element<T extends HTMLElement>(id: string, kind: { new (): T }): T {
  const found = document.getElementById(id);

  if (!(found instanceof kind)) throw new Error("Missing UI element: " + id);

  return found;
}

const token = element("token", HTMLInputElement);
const store = element("store", HTMLSelectElement);
const title = element("title", HTMLInputElement);
const body = element("body", HTMLTextAreaElement);
const media = element("media", HTMLSelectElement);
const query = element("query", HTMLInputElement);
const results = element("results", HTMLUListElement);
const more = element("more", HTMLButtonElement);
const status = element("status", HTMLPreElement);
let selection: Selection | undefined;
let cursor: string | null = null;
let busy = false;

function controlsDisabled(disabled: boolean) {
  for (const control of document.querySelectorAll("button, input, select, textarea")) {
    if (
      control instanceof HTMLButtonElement ||
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement
    )
      control.disabled = disabled;
  }
}

if (import.meta.env.DEV) token.value = "local-development-token-only";

function report(message: string, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

async function request(path: string, data?: JsonInput) {
  const options: RequestInit = {
    headers: { authorization: "Bearer " + token.value, "content-type": "application/json" },
  };

  if (data !== undefined) {
    options.method = "POST";
    options.body = JSON.stringify(data);
  }

  const response = await fetch(`/stores/${store.value}/${path}`, options);

  if (
    response.headers.get("content-type")?.split(";").at(0)?.trim().toLowerCase() !==
    "application/json"
  )
    throw new Error(
      `HTTP ${response.status}: the server returned ${response.headers.get("content-type") ?? "no content type"} instead of JSON. Refresh to check the current record before retrying.`,
    );
  const value = json.parse(await response.json());

  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(value)}`);

  return value;
}

function clear() {
  selection = undefined;
  title.value = "";
  body.value = "";
  media.value = "text/markdown";
  element("editor-title", HTMLHeadingElement).textContent = "New memory";
  element("reference", HTMLParagraphElement).textContent = "";
  element("delete", HTMLButtonElement).hidden = true;
}

function action(operation: () => Promise<void>) {
  return () => {
    if (busy) return;
    busy = true;
    controlsDisabled(true);
    void operation()
      .catch((error: Error) => report(error.message, true))
      .finally(() => {
        busy = false;
        controlsDisabled(false);
      });
  };
}

async function load(append = false) {
  const data: SearchInput = { query: query.value, limit: 20 };

  if (append && cursor !== null) data.cursor = cursor;
  const page = searchSchema.parse(await request("fmp/search", data));

  if (!append) results.replaceChildren();
  cursor = page.next_cursor;
  more.hidden = cursor === null;
  element("count", HTMLParagraphElement).textContent = `${page.total} memories in this search`;

  for (const memory of page.memories) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const name = document.createElement("strong");
    const snippet = document.createElement("span");
    name.textContent = memory.title ?? memory.identifier;
    snippet.textContent = memory.body.slice(0, 130);
    button.type = "button";
    button.append(name, snippet);
    button.addEventListener(
      "click",
      action(async () => {
        const reference: Reference = {
          identifier: memory.identifier,
        };

        if (memory.x_omp_origin !== undefined) reference.origin = memory.x_omp_origin;
        selection = readSchema.parse(await request("fmp/read", reference));
        title.value = selection.memory.title ?? "";
        body.value = selection.memory.body;
        media.value = selection.memory.media_type;
        element("editor-title", HTMLHeadingElement).textContent = "Edit memory";
        element("reference", HTMLParagraphElement).textContent =
          `${selection.memory.identifier} · ${selection.memory.x_omp_origin ?? ""}`;
        element("delete", HTMLButtonElement).hidden = false;
        report("Loaded current memory and its version. Imported memories are read-only here.");
      }),
    );
    item.append(button);
    results.append(item);
  }
}

element("connect", HTMLButtonElement).addEventListener(
  "click",
  action(async () => {
    clear();
    await load();
    report("Connected to " + store.value + ".");
  }),
);

element("refresh", HTMLButtonElement).addEventListener(
  "click",
  action(() => load()),
);

more.addEventListener(
  "click",
  action(() => load(true)),
);

store.addEventListener(
  "change",
  action(async () => {
    clear();
    await load();
    report("Opened " + store.value + ".");
  }),
);

element("new", HTMLButtonElement).addEventListener("click", clear);

element("search-form", HTMLFormElement).addEventListener("submit", (event) => {
  event.preventDefault();
  action(() => load())();
});

element("editor", HTMLFormElement).addEventListener("submit", (event) => {
  event.preventDefault();
  action(async () => {
    const patch = { body: body.value, title: title.value || undefined, media_type: media.value };
    const payload = json.parse(JSON.parse(JSON.stringify(patch)));
    let saved;

    if (selection === undefined)
      saved = await request("fmp/upload/inferences", { memory: payload });
    else
      saved = await request("fmp/update", {
        identifier: selection.memory.identifier,
        origin: selection.memory.x_omp_origin ?? "",
        if_version: selection.version,
        patch: payload,
      });
    const current = readSchema.parse(saved);
    clear();
    await load();
    report("Saved " + current.memory.identifier + ". A new Artifacts commit records this change.");
  })();
});

element("delete", HTMLButtonElement).addEventListener(
  "click",
  action(async () => {
    if (
      selection === undefined ||
      !confirm("Remove this memory from current views? Its content remains in Git history.")
    )
      return;
    await request("fmp/delete", {
      identifier: selection.memory.identifier,
      origin: selection.memory.x_omp_origin ?? "",
      if_version: selection.version,
    });
    clear();
    await load();
    report("Deleted from current views. A tombstone blocks stale imports; history is retained.");
  }),
);

element("export", HTMLButtonElement).addEventListener(
  "click",
  action(async () => {
    const first = exportSchema.parse(await request("fmp/read_inferences"));

    async function appendPage(next: string | null): Promise<void> {
      if (next === null) return;

      const page = exportSchema.parse(
        await request("fmp/read_inferences?cursor=" + encodeURIComponent(next)),
      );

      first.tombstones.push(...page.tombstones);
      await appendPage(page.next_cursor);
    }

    await appendPage(first.next_cursor);

    const { next_cursor: _cursor, storage: _storage, ...snapshot } = first;

    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot, null, 2) + "\n"], { type: "application/json" }),
    );

    const link = document.createElement("a");
    link.href = url;
    link.download = `omp-${store.value}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    report("Exported all current memories and tombstone pages. Import this file in another store.");
  }),
);

const file = element("import", HTMLInputElement);

file.addEventListener(
  "change",
  action(async () => {
    const selected = file.files?.item(0);

    if (selected === null || selected === undefined) return;

    if (selected.size > 16 * 1048576)
      throw new Error("File limit: 16 MiB. Imports are split into bounded API requests.");
    const snapshot = importSchema.parse(JSON.parse(await selected.text()));

    const receipt = await request("fmp/import", {
      ...snapshot,
      tombstones: snapshot.tombstones.slice(0, 50),
    });

    async function append(offset: number): Promise<void> {
      if (offset >= snapshot.tombstones.length) return;
      const manifest = z.object({}).catchall(json).parse(snapshot.manifest);
      await request("fmp/import", {
        manifest: { ...manifest, x_omp_identity_map: [] },
        memories: [],
        tombstones: snapshot.tombstones.slice(offset, offset + 50),
      });
      await append(offset + 50);
    }

    await append(50);
    file.value = "";
    clear();
    await load();
    report("Import receipts (check for rejected identities):\n" + JSON.stringify(receipt, null, 2));
  }),
);
