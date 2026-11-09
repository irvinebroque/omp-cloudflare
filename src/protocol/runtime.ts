import { createHash } from "node:crypto";
import picomatch from "picomatch";
import { z } from "zod";
import { ApiError, stable, text, type JsonInput, type Memory, type State } from "./model.ts";

/** Local experimental conventions inspired by issue #22; not a settled OMP schema. */
export const contextSchema = z.object({
  repository: z.string().max(1024).optional(),
  directory: z.string().max(1024).optional(),
  paths: z.array(z.string().max(1024)).max(100).optional(),
  explicit_request: z.boolean().optional(),
});

export type Context = z.infer<typeof contextSchema>;

const patterns = z.array(z.string().min(1).max(512)).min(1).max(32);
const repository = z.string().min(1).max(1024);

const applicabilitySchema = z.discriminatedUnion("level", [
  z.object({ level: z.literal("user") }),
  z.object({ level: z.literal("organization") }),
  z.object({ level: z.literal("repository"), repository }),
  z.object({ level: z.literal("directory"), repository, directory: z.string().min(1).max(1024) }),
  z.object({ level: z.literal("paths"), repository, globs: patterns }),
]);

const activationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("always") }),
  z.object({ mode: z.literal("paths"), globs: patterns }),
  z.object({ mode: z.literal("relevant"), description: z.string().min(1).max(1024).optional() }),
  z.object({ mode: z.literal("on_request") }),
]);

export function repositoryKey(value: string): string {
  const candidate = value.replace(/^git@([^:]+):/u, "https://$1/");

  try {
    const url = new URL(candidate);

    if (!["https:", "http:", "ssh:"].includes(url.protocol)) throw new Error();

    return url.host.toLowerCase() + url.pathname.replace(/\/$/u, "").replace(/\.git$/u, "");
  } catch {
    throw new ApiError(400, "repository must be a remote URL or git@host:path");
  }
}

export function relativePath(value: string): string {
  const path = value.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/$/u, "");

  if (path.startsWith("/") || /^[a-z]:/iu.test(path) || path.split("/").includes(".."))
    throw new ApiError(400, "Paths must be repository-relative, without ..");

  return path === "." ? "" : path;
}

function conventions(memory: Memory) {
  const applies = applicabilitySchema.optional().safeParse(memory.applies_to);
  const activation = activationSchema.optional().safeParse(memory.activation);

  if (!applies.success || !activation.success)
    throw new ApiError(400, "Invalid applies_to or activation convention");
  const a = applies.data;

  if (a !== undefined && a.level !== "user" && a.level !== "organization")
    repositoryKey(a.repository);

  if (a?.level === "directory") relativePath(a.directory);

  if (a?.level === "paths") a.globs.forEach(relativePath);

  if (activation.data?.mode === "paths") activation.data.globs.forEach(relativePath);

  if (
    activation.data?.mode === "relevant" &&
    activation.data.description === undefined &&
    memory.title === undefined
  )
    throw new ApiError(400, "Relevant activation needs a description or title");

  return { applies: a, activation: activation.data };
}

export function validateConventions(memory: Memory): void {
  conventions(memory);
}

export function validateContext(value: JsonInput): Context {
  const parsed = contextSchema.safeParse(value);

  if (!parsed.success) throw new ApiError(400, "Invalid runtime context");
  const c = parsed.data;

  if (c.repository !== undefined) repositoryKey(c.repository);

  if (c.directory !== undefined) relativePath(c.directory);
  c.paths?.forEach(relativePath);

  return c;
}

export function applicable(
  memory: Memory,
  context: Context,
  now = Date.now(),
  includeInactive = false,
): boolean {
  if (
    !includeInactive &&
    ((memory.valid_from !== undefined && Date.parse(memory.valid_from) > now) ||
      (memory.valid_until !== undefined && Date.parse(memory.valid_until) <= now))
  )
    return false;
  // Unknown imported applicability must not silently turn into a global instruction.
  let parsed: ReturnType<typeof conventions>;

  try {
    parsed = conventions(memory);
  } catch {
    return false;
  }

  const a = parsed.applies;
  const paths = (context.paths ?? []).map(relativePath);
  const matches = (globs: string[]) => paths.some((path) => picomatch(globs, { dot: true })(path));

  if (a !== undefined && a.level !== "user" && a.level !== "organization") {
    if (
      context.repository === undefined ||
      repositoryKey(context.repository) !== repositoryKey(a.repository)
    )
      return false;

    if (a.level === "directory") {
      const dir = relativePath(a.directory);
      const inside = (p: string) => dir.length === 0 || p === dir || p.startsWith(dir + "/");

      if (
        !(context.directory !== undefined && inside(relativePath(context.directory))) &&
        !paths.some(inside)
      )
        return false;
    }

    if (a.level === "paths" && !matches(a.globs)) return false;
  }

  if (parsed.activation?.mode === "on_request" && context.explicit_request !== true) return false;

  if (parsed.activation?.mode === "paths" && !matches(parsed.activation.globs)) return false;

  return true;
}

/** An opaque per-memory optimistic-concurrency token, not a portable OMP comparator. */
export const memoryVersion = (memory: Memory) =>
  createHash("sha256").update(stable(memory)).digest("hex");

export interface MemorySelection {
  identifier: string;
  origin?: string | undefined;
}

export function selectMemory(state: State, data: MemorySelection): Memory {
  const found = state.memories.filter(
    (m) =>
      m.identifier === data.identifier &&
      (data.origin === undefined || m.x_omp_origin === data.origin),
  );

  const first = found.at(0);

  if (first === undefined) throw new ApiError(404, "Memory not found");

  if (found.length > 1) throw new ApiError(409, "Ambiguous identifier; provide origin");

  return first;
}

export function addContribution(
  memory: Memory,
  contributor: string,
  contribution: string,
  at = new Date().toISOString(),
): Memory {
  const previous = memory.provenance ?? [];

  if (previous.length >= 100) throw new ApiError(413, "Prototype limit: 100 provenance entries");

  return {
    ...memory,
    provenance: [
      ...previous,
      {
        id: text(contributor, "contributor"),
        kind: contributor.startsWith("system:")
          ? "system"
          : contributor.startsWith("user:")
            ? "human"
            : "agent",
        contribution,
        at,
      },
    ],
  };
}
