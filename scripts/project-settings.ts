import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import JSON5 from "json5";
import { z } from "zod";

const schema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9-]+$/u),
  compatibility_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
});

/** The deploy button rewrites this metadata in its copied repository. */
export function parseProjectSettings(source: string) {
  return schema.parse(JSON5.parse(source));
}

export const project = parseProjectSettings(
  readFileSync(resolve(import.meta.dirname, "../wrangler.jsonc"), "utf8"),
);
