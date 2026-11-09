import { ApiError } from "./errors.ts";
import { createHash } from "node:crypto";
import { appendContribution, stable, type Memory } from "omp-sdk/core";
import { text, type State } from "./model.ts";
export { applicable, validateContext, validateConventions } from "./context.ts";

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

  return appendContribution(memory, {
    id: text(contributor, "contributor"),
    kind: contributor.startsWith("system:")
      ? "system"
      : contributor.startsWith("user:")
        ? "human"
        : "agent",
    contribution,
    at,
  });
}
