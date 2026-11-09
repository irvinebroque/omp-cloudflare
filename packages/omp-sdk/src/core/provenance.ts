import { contributorSchema, type Memory } from "./model.ts";
import type { z } from "zod";

export type Contributor = z.infer<typeof contributorSchema>;

/** Append explicit attribution without inferring identity, kind or the original author. */
export function appendContribution(memory: Memory, contributor: Contributor): Memory {
  return {
    ...memory,
    provenance: [...(memory.provenance ?? []), contributorSchema.parse(contributor)],
  };
}
