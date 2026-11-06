import type { z } from "zod";
import type { Archive, JsonInput, Memory } from "../src/model.ts";
import {
  decodeResponse,
  requestOptions,
  readResponse,
  savedResponse,
  importedResponse,
  deletedResponse,
  searchResponse,
  gatewaySearchResponse,
  exportResponse,
  historyResponse,
  storeInfoResponse,
  gatewayInfoResponse,
  storeSchema,
} from "../src/contracts.ts";

export type { Archive, Memory, Receipt } from "../src/model.ts";

export type Store = z.infer<typeof storeSchema>;

export type MemoryInput = Partial<Memory> & Pick<Memory, "body">;

export type SavedMemory = z.infer<typeof savedResponse>;

export class OmpClient {
  baseUrl: string;
  store: Store;
  constructor(baseUrl: string, store: Store = "personal") {
    this.baseUrl = baseUrl.replace(/\/$/u, "");
    this.store = store;
  }
  private async request<S extends z.ZodType>(
    path: string,
    schema: S,
    data?: JsonInput,
  ): Promise<z.output<S>> {
    return decodeResponse(
      await fetch(this.baseUrl + "/stores/" + this.store + "/" + path, requestOptions(data)),
      schema,
    );
  }
  info() {
    return this.request("fmp/info", storeInfoResponse);
  }
  remember(memory: MemoryInput) {
    return this.request("fmp/upload/inferences", savedResponse, { memory });
  }
  read(identifier: string, origin?: string) {
    return this.request("fmp/read", readResponse, { identifier, origin });
  }
  search(query: string, limit = 20) {
    return this.request("fmp/search", searchResponse, { query, limit });
  }
  update(identifier: string, patch: Partial<Memory>, origin?: string, if_version?: string) {
    return this.request("fmp/update", readResponse, { identifier, patch, origin, if_version });
  }
  delete(identifier: string, origin?: string) {
    return this.request("fmp/delete", deletedResponse, { identifier, origin });
  }
  export() {
    return this.request("fmp/read_inferences", exportResponse);
  }
  import(snapshot: Archive) {
    return this.request("fmp/import", importedResponse, snapshot);
  }
  history() {
    return this.request("history", historyResponse);
  }
}

/** One entry point across personal and company stores. Writes route explicitly. */
export class OmpGateway {
  baseUrl: string;
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/u, "");
  }
  private async request<S extends z.ZodType>(
    path: string,
    schema: S,
    data?: JsonInput,
  ): Promise<z.output<S>> {
    return decodeResponse(
      await fetch(this.baseUrl + "/gateway/" + path, requestOptions(data)),
      schema,
    );
  }
  info() {
    return this.request("info", gatewayInfoResponse);
  }
  remember(memory: MemoryInput, store: Store = "personal") {
    return this.request("fmp/upload/inferences", savedResponse.extend({ routed_to: storeSchema }), {
      memory,
      store,
    });
  }
  search(query: string, limit = 20) {
    return this.request("fmp/search", gatewaySearchResponse, { query, limit });
  }
}
