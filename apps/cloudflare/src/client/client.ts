import type { z } from "zod";
import type { JsonInput, Memory } from "omp-sdk/core";
import type { Archive } from "omp-sdk/experimental";
import type { Context } from "../protocol/context.ts";
import {
  decodeResponse,
  requestOptions,
  readResponse,
  savedResponse,
  routedSavedResponse,
  importedResponse,
  deletedResponse,
  searchResponse,
  gatewaySearchResponse,
  exportResponse,
  historyResponse,
  storeInfoResponse,
  gatewayInfoResponse,
  type storeSchema,
} from "./contracts.ts";

export type Store = z.infer<typeof storeSchema>;

export type MemoryInput = Partial<Memory> & Pick<Memory, "body">;

/** Client for the experimental omp-cloudflare HTTP binding, not a universal OMP transport. */
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
  info(): Promise<z.output<typeof storeInfoResponse>> {
    return this.request("fmp/info", storeInfoResponse);
  }
  remember(memory: MemoryInput, contributor?: string): Promise<z.output<typeof savedResponse>> {
    return this.request("fmp/upload/inferences", savedResponse, { memory, contributor });
  }
  read(
    identifier: string,
    origin?: string,
    include_inactive = false,
    context?: Context,
  ): Promise<z.output<typeof readResponse>> {
    return this.request("fmp/read", readResponse, {
      identifier,
      origin,
      include_inactive,
      context,
    });
  }
  search(
    query: string,
    limit = 20,
    cursor?: string,
    context?: Context,
  ): Promise<z.output<typeof searchResponse>> {
    return this.request("fmp/search", searchResponse, { query, limit, cursor, context });
  }
  update(
    identifier: string,
    patch: Partial<Memory>,
    origin?: string,
    if_version?: string,
    contributor?: string,
  ): Promise<z.output<typeof readResponse>> {
    return this.request("fmp/update", readResponse, {
      identifier,
      patch,
      origin,
      if_version,
      contributor,
    });
  }
  delete(
    identifier: string,
    origin?: string,
    if_version?: string,
    contributor?: string,
    reason?: string,
  ): Promise<z.output<typeof deletedResponse>> {
    return this.request("fmp/delete", deletedResponse, {
      identifier,
      origin,
      if_version,
      contributor,
      reason,
    });
  }
  export(cursor?: string, origin?: string): Promise<z.output<typeof exportResponse>> {
    const query = new URLSearchParams();
    if (cursor !== undefined) query.set("cursor", cursor);
    if (origin !== undefined) query.set("origin", origin);
    const suffix = query.size === 0 ? "" : "?" + query.toString();
    return this.request("fmp/read_inferences" + suffix, exportResponse);
  }
  /** Collect every tombstone page from one consistent store snapshot. */
  async snapshot(origin?: string): Promise<Archive> {
    const first = await this.export(undefined, origin);

    const append = async (cursor: string | null): Promise<void> => {
      if (cursor === null) return;
      const page = await this.export(cursor, origin);
      first.tombstones.push(...page.tombstones);
      await append(page.next_cursor);
    };

    await append(first.next_cursor);
    const { next_cursor: _cursor, storage: _storage, ...snapshot } = first;
    const { x_omp_pagination: _pagination, ...manifest } = snapshot.manifest;
    return { ...snapshot, manifest: { ...manifest, selection: "snapshot" as const } };
  }
  /** Split a collected snapshot into bounded requests, retaining per-memory receipts. */
  async importSnapshot(snapshot: Archive): Promise<z.output<typeof importedResponse>> {
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
  import(snapshot: Archive): Promise<z.output<typeof importedResponse>> {
    return this.request("fmp/import", importedResponse, snapshot);
  }
  history(): Promise<z.output<typeof historyResponse>> {
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
  info(): Promise<z.output<typeof gatewayInfoResponse>> {
    return this.request("info", gatewayInfoResponse);
  }
  remember(
    memory: MemoryInput,
    store: Store = "personal",
    contributor?: string,
  ): Promise<z.output<typeof routedSavedResponse>> {
    return this.request("fmp/upload/inferences", routedSavedResponse, {
      memory,
      store,
      contributor,
    });
  }
  search(
    query: string,
    limit = 20,
    cursor?: string,
    context?: Context,
  ): Promise<z.output<typeof gatewaySearchResponse>> {
    return this.request("fmp/search", gatewaySearchResponse, { query, limit, cursor, context });
  }
}
