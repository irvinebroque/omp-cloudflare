import { expect, it } from "vite-plus/test";
import { decodeResponse, gatewayInfoResponse } from "@omp-cloudflare/sdk/bindings/omp-cloudflare";

it("reports an upstream HTML failure with its HTTP status instead of a JSON syntax error", async () => {
  await expect(
    decodeResponse(
      new Response("<!DOCTYPE html><title>Unavailable</title>", {
        status: 503,
        headers: { "content-type": "text/html" },
      }),
      gatewayInfoResponse,
    ),
  ).rejects.toMatchObject({
    status: 503,
    message: "Expected a JSON memory response; received HTTP 503 (text/html)",
  });
});

it("retains structured server errors", async () => {
  await expect(
    decodeResponse(
      Response.json({ error: "Read again before updating" }, { status: 409 }),
      gatewayInfoResponse,
    ),
  ).rejects.toMatchObject({ status: 409, message: "Read again before updating" });
});
