import { OmpError } from "omp-sdk/core";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiError(error: unknown): ApiError | undefined {
  if (error instanceof ApiError) return error;
  if (error instanceof OmpError)
    return new ApiError(error.code === "conflict" ? 409 : 400, error.message);
  return undefined;
}
