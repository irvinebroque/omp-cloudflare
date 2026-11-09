/** Protocol failures carry semantic codes; transports choose their own status mapping. */
export class OmpError extends Error {
  constructor(
    public code: "invalid_input" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "OmpError";
  }
}
