import { z } from "zod";
import type { JsonInput } from "../protocol/json.ts";
import { chatView, type ChatView } from "../agent/contracts.ts";

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

const receiptSchema = z.object({
  receipts: z.array(
    z.object({
      identifier: z.string(),
      status: z.enum(["accepted", "unchanged", "rejected"]),
      reason: z.string().optional(),
    }),
  ),
});

const exportSchema = z
  .object({
    manifest: z.object({ x_omp_identity_map: z.array(json).optional() }).catchall(json.optional()),
    memories: z.array(json),
    tombstones: z.array(json),
    next_cursor: z.string().nullable(),
  })
  .catchall(json.optional());

function element<T extends HTMLElement>(id: string, kind: { new (): T }): T {
  const found = document.getElementById(id);

  if (!(found instanceof kind)) throw new Error("Missing UI element: " + id);

  return found;
}

const token = element("token", HTMLInputElement);
const store = element("store", HTMLSelectElement);
const prompt = element("prompt", HTMLTextAreaElement);
const composer = element("composer", HTMLFormElement);
const send = element("send", HTMLButtonElement);
const newChat = element("new-chat", HTMLButtonElement);
const messages = element("messages", HTMLElement);
const status = element("status", HTMLParagraphElement);
const connection = element("connection", HTMLDetailsElement);
const memoriesPanel = element("memories-panel", HTMLDetailsElement);

const toolLabels = new Map([
  ["remember completed", "Saved a memory"],
  ["search_memories completed", "Searched memories"],
  ["read_memory completed", "Read a memory"],
  ["remember failed", "Could not save memory"],
  ["search_memories failed", "Could not search memories"],
  ["read_memory failed", "Could not read memory"],
]);

const chatEnabled = !import.meta.env.DEV || import.meta.env.VITE_OMP_REMOTE_AI === true;
let connected = false;
let busy = false;
let running = false;
let cursor: string | null = null;
let conversation = z.uuid().parse(crypto.randomUUID());
let timer: ReturnType<typeof setTimeout> | undefined;
let retry: { prompt: string; operationId: string } | undefined;

if (import.meta.env.DEV) token.value = "local-development-token-only";

function report(message: string, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function updateControls() {
  send.disabled = !connected || busy || running || !chatEnabled;
  newChat.disabled = busy || running;
  store.disabled = busy || running;
  element("connect", HTMLButtonElement).disabled = busy || running;

  for (const id of ["refresh", "more", "export"])
    element(id, HTMLButtonElement).disabled = !connected || busy || running;
  element("import", HTMLInputElement).disabled = !connected || busy || running;
}

function action(operation: () => Promise<void>) {
  return () => {
    if (busy || running) return;
    busy = true;
    updateControls();
    void operation()
      .catch((error: Error) => report(error.message, true))
      .finally(() => {
        busy = false;
        updateControls();
      });
  };
}

async function api(path: string, data?: JsonInput) {
  const options: RequestInit = {
    method: data === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer " + token.value, "content-type": "application/json" },
  };

  if (data !== undefined) options.body = JSON.stringify(data);

  const response = await fetch(path, options);

  if (response.headers.get("content-type")?.split(";").at(0) !== "application/json")
    throw new Error(`HTTP ${response.status}: unexpected server response. Reconnect to resume.`);
  const value = json.parse(await response.json());

  if (response.status === 401)
    throw new Error(
      "Access key not recognized. Check the key saved during deployment, then reconnect.",
    );

  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(value)}`);

  return value;
}

const request = (path: string, data?: JsonInput) => api(`/stores/${store.value}/${path}`, data);
const chatPath = () => `/api/chat/${conversation}?store=${store.value}`;

function session() {
  const saved = sessionStorage.getItem("omp-chat-" + store.value);
  const parsed = z.uuid().safeParse(saved);
  conversation = parsed.success ? parsed.data : crypto.randomUUID();
  sessionStorage.setItem("omp-chat-" + store.value, conversation);
  retry = undefined;
}

function render(view: ChatView) {
  const previous = messages.textContent;

  const nodes = view.messages.map((message) => {
    const node = document.createElement("article");
    node.className = "message " + message.role;
    node.setAttribute(
      "aria-label",
      message.role === "user" ? "You" : message.role === "tool" ? "Memory activity" : "Assistant",
    );
    node.textContent =
      message.role === "tool" ? (toolLabels.get(message.text) ?? message.text) : message.text;

    return node;
  });

  if (view.earlier) {
    const notice = document.createElement("p");
    notice.className = "hint";
    notice.textContent = "Showing the latest part of this conversation.";
    nodes.unshift(notice);
  }

  if (view.streaming.length > 0) {
    const node = document.createElement("article");
    node.className = "message assistant streaming";
    node.setAttribute("aria-label", "Assistant is responding");
    node.textContent = view.streaming;
    nodes.push(node);
  }

  messages.replaceChildren(...nodes);
  element("empty", HTMLElement).hidden = nodes.length > 0;
  running = view.busy;
  updateControls();

  if (view.failure !== null && !view.busy)
    report(
      `The agent could not finish (${view.failure}). Check Workers AI configuration, then send a follow-up.`,
      true,
    );
  else report(view.busy ? "Thinking…" : "");

  if (
    previous !== messages.textContent &&
    window.scrollY + window.innerHeight >= document.body.scrollHeight - 250
  )
    window.scrollTo({ top: document.body.scrollHeight });
}

async function poll() {
  try {
    const view = chatView.parse(await api(chatPath()));
    render(view);

    if (view.busy)
      timer = setTimeout(() => {
        void poll();
      }, 900);
    else await load();

    return true;
  } catch (error) {
    running = false;
    updateControls();
    report(
      error instanceof Error ? error.message : "Connection interrupted. Reconnect to resume.",
      true,
    );

    return false;
  }
}

async function load(append = false) {
  const page = searchSchema.parse(
    await request("fmp/search", {
      query: "",
      limit: 20,
      cursor: append ? (cursor ?? undefined) : undefined,
    }),
  );

  const list = element("memories", HTMLUListElement);

  if (!append) list.replaceChildren();

  for (const memory of page.memories) {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const text = document.createElement("span");
    name.textContent = memory.title ?? "Saved memory";
    text.textContent = memory.body;
    item.append(name, text);
    list.append(item);
  }

  if (page.total === 0)
    list.textContent = "Nothing saved yet. Ask the agent to remember something.";
  cursor = page.next_cursor;
  element("more", HTMLButtonElement).hidden = cursor === null;
  element("memory-count", HTMLSpanElement).textContent = page.total > 0 ? " " + page.total : "";
}

element("connect", HTMLButtonElement).addEventListener(
  "click",
  action(async () => {
    clearTimeout(timer);
    connected = false;
    session();
    await load();

    if (!(await poll())) return;
    connected = true;
    connection.open = false;
    element("connection-label", HTMLElement).textContent =
      store.value === "personal" ? "Personal" : "Company";

    if (!chatEnabled)
      report("Local memory is connected. Restart with OMP_REMOTE_AI=true for chat.");
  }),
);

store.addEventListener("change", () => {
  connected = false;
  updateControls();
  report("Connect to open this store.");
});

newChat.addEventListener(
  "click",
  action(async () => {
    if (!connected) {
      connection.open = true;

      return;
    }

    clearTimeout(timer);
    sessionStorage.removeItem("omp-chat-" + store.value);
    session();
    await poll();
    prompt.focus();
  }),
);

element("refresh", HTMLButtonElement).addEventListener(
  "click",
  action(() => load()),
);

element("more", HTMLButtonElement).addEventListener(
  "click",
  action(() => load(true)),
);

memoriesPanel.addEventListener("toggle", () => {
  if (memoriesPanel.open) connection.open = false;
});

connection.addEventListener("toggle", () => {
  if (connection.open) memoriesPanel.open = false;
});

for (const button of document.querySelectorAll("[data-prompt]")) {
  if (!(button instanceof HTMLButtonElement)) continue;
  button.addEventListener("click", () => {
    prompt.value = button.dataset.prompt ?? "";

    if (!connected) connection.open = true;
    else prompt.focus();
  });
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  action(async () => {
    if (!connected) {
      connection.open = true;

      return;
    }

    const text = prompt.value.trim();

    if (text.length === 0) return;

    if (retry?.prompt !== text) retry = { prompt: text, operationId: crypto.randomUUID() };
    await api(chatPath(), retry);
    prompt.value = "";
    retry = undefined;
    running = true;
    await poll();
  })();
});

prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();

    if (!send.disabled) composer.requestSubmit();
  }
});

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

    const { next_cursor: _cursor, storage: _storage, ...collected } = first;
    const { x_omp_pagination: _pagination, ...manifest } = collected.manifest;
    const snapshot = { ...collected, manifest: { ...manifest, selection: "snapshot" } };

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

    const receipt = receiptSchema.parse(
      await request("fmp/import", {
        ...snapshot,
        tombstones: snapshot.tombstones.slice(0, 50),
      }),
    );

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
    await load();

    const counts = ["accepted", "unchanged", "rejected"].map(
      (outcome) => `${receipt.receipts.filter((r) => r.status === outcome).length} ${outcome}`,
    );

    const rejected = receipt.receipts.flatMap((r) =>
      r.status === "rejected" ? [`${r.identifier}: ${r.reason ?? "conflict"}`] : [],
    );

    report(`Import: ${counts.join(", ")}. ${rejected.join("; ")}`, rejected.length > 0);
  }),
);

updateControls();
