import { stable, type Memory } from "omp-sdk/core";

/** OMP §6.1: opaque imported revisions are equal or incomparable, never ordered by time. */
export function compareMemoryVersions(left: Memory, right: Memory): "equal" | "incomparable" {
  if (
    left.x_omp_origin === undefined ||
    left.x_omp_origin !== right.x_omp_origin ||
    left.identifier !== right.identifier ||
    left.version === undefined ||
    right.version === undefined
  )
    return "incomparable";
  return stable(left.version) === stable(right.version) ? "equal" : "incomparable";
}

// This declaration describes this implementation, not a protocol-wide version format.
export const versionComparison = {
  field: "memory.version",
  equal: "Same origin and identifier, with structurally equal JSON version values",
  otherwise: "incomparable",
  concurrency: "The HTTP response version is a separate opaque conditional-write token",
};
