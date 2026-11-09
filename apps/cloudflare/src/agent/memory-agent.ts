import { DurableObject } from "cloudflare:workers";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, ConversationBusy, type ConversationView } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";
import { z } from "zod";
import { memoryRegistry } from "./tools.ts";
import { promptInput, type ChatView, type ChatMessage } from "./contracts.ts";
import { body } from "../server/router.ts";
import { targetStore } from "../server/gateway.ts";
import { ApiError } from "../protocol/model.ts";
import { authorize } from "../server/auth.ts";

const textPart = z.object({ type: z.literal("text"), text: z.string() });

const liveSchema = z.object({
  run: z.json().optional(),
  generation: z.object({ message: z.object({ content: z.array(z.json()) }).optional() }).optional(),
  runFailure: z.object({ reason: z.string() }).optional(),
});

function project(view: ConversationView): ChatView {
  const messages: ChatMessage[] = [];

  for (const entry of view.entries) {
    for (const [index, message] of (entry.model ?? []).entries()) {
      const id = `${entry.id}:${index}`;

      if (message.role === "system") continue;

      if (message.role === "toolResult") {
        messages.push({
          id,
          role: "tool",
          text: message.toolName + (message.isError ? " failed" : " completed"),
        });
        continue;
      }

      const content = message.content;

      const text = Array.isArray(content)
        ? content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
        : content;

      if (text.length > 0) messages.push({ id, role: message.role, text });
    }
  }

  const live = liveSchema.parse(view.docs["pi.live"] ?? {});

  const streaming = (live.generation?.message?.content ?? [])
    .flatMap((part) => {
      const parsed = textPart.safeParse(part);

      return parsed.success ? [parsed.data.text] : [];
    })
    .join("");

  return {
    messages,
    streaming,
    busy: live.run !== undefined,
    failure: live.runFailure?.reason ?? null,
    earlier: view.before !== undefined,
  };
}

export class MemoryAgent extends DurableObject<Env> {
  private readonly harness = this.open();
  readonly lifecycle = Lifecycle.install(this).use(this.harness);

  private open() {
    const ai = createAI({ binding: this.env.AI });

    const registry = memoryRegistry(this.env, async () => {
      const store = await this.ctx.storage.get<string>("omp-store");

      if (store === undefined) throw new Error("Conversation store is not initialized");

      return targetStore(store);
    });

    const harness = new PiHarness({
      harness: ({ storage, context, onWake }) => {
        const models = createModels();
        models.setProvider(ai.provider);

        return Harness.open(
          storage,
          {
            models,
            registry,
            onWake,
            settings: { afterFailedRun: "withdraw", retry: { maxRetries: 1, baseDelayMs: 500 } },
          },
          context,
        );
      },
      defaults: { model: ai(this.env.CHAT_MODEL), thinkingLevel: "off", maxTurns: 6 },
    });

    return harness;
  }

  override async fetch(request: Request): Promise<Response> {
    authorize(request, this.env.MEMORY_API_TOKEN);
    const url = new URL(request.url);
    // Routing derives the store from the object's name; persisted before any durable work.
    let store = await this.ctx.storage.get<string>("omp-store");

    if (store === undefined) {
      store = targetStore(url.searchParams.get("store") ?? undefined);
      await this.ctx.storage.put("omp-store", store);
    }

    const harness = this.harness;

    if (request.method === "POST") {
      const parsed = promptInput.safeParse(await body(request));

      if (!parsed.success)
        throw new ApiError(400, "A prompt (1–8000 characters) and UUID operationId are required");

      try {
        const receipt = await harness.submit(parsed.data.prompt, {
          operationId: parsed.data.operationId,
          whenBusy: "reject",
        });

        return Response.json(receipt, { status: 202 });
      } catch (error) {
        if (error instanceof ConversationBusy)
          return Response.json({ error: "Wait for the current answer" }, { status: 409 });
        throw error;
      }
    }

    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const watch = await harness.session().watch();

    try {
      const view = project(watch.value);
      view.busy ||= (await harness.pending()).length > 0;

      return Response.json(view, { headers: { "cache-control": "no-store" } });
    } finally {
      await watch.stop();
    }
  }
}
