import {
  assertNoCredentials as assertPortableCredentials,
  containsCredentials as containsPortableCredentials,
  type JsonInput,
} from "omp-sdk/core";

// The portable check cannot know this deployment's access key; the app supplies it.
export function containsCredentials(value: JsonInput, operatorToken?: string): boolean {
  return containsPortableCredentials(value, operatorToken === undefined ? [] : [operatorToken]);
}

export function assertNoCredentials(value: JsonInput, operatorToken?: string): void {
  assertPortableCredentials(value, operatorToken === undefined ? [] : [operatorToken]);
}
