import { expect, it } from "vite-plus/test";
import { parseProjectSettings } from "../scripts/project-settings.ts";

it("uses a deploy-button-renamed project with JSONC comments and trailing commas", () => {
  const renamed = parseProjectSettings(`{
    // Cloudflare rewrites this name in the copied template.
    "name": "my-independent-memory",
    "compatibility_date": "2026-11-08",
  }`);

  expect(renamed.name).toBe("my-independent-memory");
  expect(renamed.compatibility_date).toBe("2026-11-08");
});

it("rejects invalid deployment metadata before provisioning resources", () => {
  expect(() =>
    parseProjectSettings('{ "name": "Invalid Name", "compatibility_date": "today" }'),
  ).toThrow();
});
