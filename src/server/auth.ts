import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError } from "../protocol/model.ts";

/** One operator owns this deployment; store routing is not a tenant boundary. */
export function authorize(request: Request, token: string): void {
  if (token.length < 24)
    throw new ApiError(503, "Configure MEMORY_API_TOKEN with at least 24 characters");
  const authorization = request.headers.get("authorization") ?? "";
  const received = createHash("sha256").update(authorization).digest();

  const expected = createHash("sha256")
    .update("Bearer " + token)
    .digest();

  if (!timingSafeEqual(received, expected))
    throw new ApiError(401, "A valid bearer token is required");
}
