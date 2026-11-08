import { z } from "zod";

export const jsonValue = z.json();

export type Json = z.infer<typeof jsonValue>;

export type JsonInput =
  | Json
  | undefined
  | { readonly [key: string]: JsonInput }
  | readonly JsonInput[];

export const objectSchema = z.record(z.string(), jsonValue);
