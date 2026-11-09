import { OmpError } from "./errors.ts";
import type { JsonInput } from "./json.ts";

const credentialKey =
  /^(?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?key)$/iu;
const assignment =
  /\b(?:password|passwd|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|private[_ -]?key|secret[_ -]?key)["']?[ \t]*[:=][ \t]*["']?[^\s"',;}]+/iu;
const recognizable =
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bBearer\s+[a-z0-9._~+/-]{12,}={0,2}|\b(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sk-[a-z0-9_-]{20,})/iu;

/** Reject recognizable credentials without returning their contents in errors. This is not a secret classifier. */
export function containsCredentials(
  value: JsonInput,
  knownSecrets: readonly string[] = [],
): boolean {
  if (typeof value === "string")
    return (
      knownSecrets.some((secret) => secret.length > 0 && value.includes(secret)) ||
      assignment.test(value) ||
      recognizable.test(value) ||
      /https?:\/\/[^\s/:@]+:[^\s/@]+@/iu.test(value)
    );
  if (Array.isArray(value)) return value.some((item) => containsCredentials(item, knownSecrets));
  if (value !== null && typeof value === "object")
    return Object.entries(value).some(
      ([key, item]) =>
        (credentialKey.test(key) && typeof item === "string" && item.trim().length > 0) ||
        containsCredentials(item, knownSecrets),
    );
  return false;
}

export function assertNoCredentials(value: JsonInput, knownSecrets: readonly string[] = []): void {
  if (containsCredentials(value, knownSecrets))
    throw new OmpError(
      "invalid_input",
      "Memory contains recognizable credentials; remove them before saving or exporting",
    );
}
