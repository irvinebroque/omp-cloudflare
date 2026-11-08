import type { z } from "zod";
import type { Archive, JsonInput, Memory } from "../src/protocol/model.ts";
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
} from "../src/protocol/contracts.ts";

export type { Archive, Memory, Receipt } from "../src/protocol/model.ts";

export type Store = z.infer<typeof storeSchema>;

export type MemoryInput = Partial<Memory> & Pick<Memory, "body">;

export type SavedMemory = z.infer<typeof savedResponse>;

export class OmpClient {
  baseUrl: string;
  store: Store;
  token: string;
  constructor(baseUrl: string, store: Store = "personal", token = "") {
    this.baseUrl = baseUrl.replace(/\/$/u, "");
    this.store = store;
    this.token = token;
  }
  private async request<S extends z.ZodType>(
    path: string,
    schema: S,
    data?: JsonInput,
  ): Promise<z.output<S>> {
    return decodeResponse(
      await fetch(this.baseUrl + "/stores/" + this.store + "/" + path, {
        ...requestOptions(data),
        headers: { "content-type": "application/json", authorization: "Bearer " + this.token },
      }),
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
  search(query: string, limit = 20, cursor?: string) {
    return this.request("fmp/search", searchResponse, { query, limit, cursor });
  }
  update(identifier: string, patch: Partial<Memory>, origin?: string, if_version?: string) {
    return this.request("fmp/update", readResponse, { identifier, patch, origin, if_version });
  }
  delete(identifier: string, origin?: string, if_version?: string) {
    return this.request("fmp/delete", deletedResponse, { identifier, origin, if_version });
  }
  export(cursor?: string) {
    return this.request(
      "fmp/read_inferences" + (cursor === undefined ? "" : "?cursor=" + encodeURIComponent(cursor)),
      exportResponse,
    );
  }
  /** Collect every tombstone page from one consistent store snapshot. */
  async snapshot(): Promise<Archive> {
    const first = await this.export();

    const append = async (cursor: string | null): Promise<void> => {
      if (cursor === null) return;
      const page = await this.export(cursor);
      first.tombstones.push(...page.tombstones);
      await append(page.next_cursor);
    };

    await append(first.next_cursor);
    const { next_cursor: _cursor, storage: _storage, ...snapshot } = first;

    return snapshot;
  }
  /** Split a collected snapshot into bounded requests, retaining per-memory receipts. */
  async importSnapshot(snapshot: Archive) {
    const first = await this.import({ ...snapshot, tombstones: snapshot.tombstones.slice(0, 50) });

    const append = async (offset: number): Promise<void> => {
      if (offset >= snapshot.tombstones.length) return;
      await this.import({
        ...snapshot,
        manifest: { ...snapshot.manifest, x_omp_identity_map: [] },
        memories: [],
        tombstones: snapshot.tombstones.slice(offset, offset + 50),
      });
      await append(offset + 50);
    };

    await append(50);

    return first;
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
  token: string;
  constructor(baseUrl: string, token = "") {
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/$/u, "");
  }
  private async request<S extends z.ZodType>(
    path: string,
    schema: S,
    data?: JsonInput,
  ): Promise<z.output<S>> {
    return decodeResponse(
      await fetch(this.baseUrl + "/gateway/" + path, {
        ...requestOptions(data),
        headers: { "content-type": "application/json", authorization: "Bearer " + this.token },
      }),
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
  search(query: string, limit = 20, cursor?: string) {
    return this.request("fmp/search", gatewaySearchResponse, { query, limit, cursor });
  }
}
