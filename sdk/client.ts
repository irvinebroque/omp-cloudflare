import type { Archive, Memory, Receipt } from '../src/model.ts';
export type { Archive, Memory, Receipt } from '../src/model.ts';
export type Store = 'personal' | 'company';
export type MemoryInput = Pick<Memory,'body'> & Partial<Omit<Memory,'body'>>;
export interface SavedMemory { memory: Memory; receipts: Receipt[]; commit: string }
export class OmpClient {
  baseUrl: string;
  store: Store;
  constructor(baseUrl: string, store: Store = 'personal') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); this.store = store;
  }
  private async request<T>(path: string, data?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}/stores/${this.store}/${path}`, data === undefined ? {} : {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    const result = await response.json() as T & {error?:string};
    if (!response.ok) throw new Error(`OMP ${response.status}: ${result.error ?? 'Request failed'}`);
    return result;
  }
  info() { return this.request<{store:Store;capabilities:string[];auth:string}>('fmp/info'); }
  remember(memory: MemoryInput) { return this.request<SavedMemory>('fmp/upload/inferences',{memory}); }
  read(identifier: string, origin?: string) { return this.request<{memory:Memory;version:string;commit:string}>('fmp/read',{identifier,origin}); }
  search(query: string, limit = 20) { return this.request<{memories:Memory[];total:number;commit:string|null}>('fmp/search',{query,limit}); }
  update(identifier: string, patch: Partial<Memory>, origin?: string, if_version?: string) { return this.request<{memory:Memory;version:string;commit:string}>('fmp/update',{identifier,patch,origin,if_version}); }
  delete(identifier: string, origin?: string) { return this.request<{deleted:true;commit:string}>('fmp/delete',{identifier,origin}); }
  export() { return this.request<Archive & {storage:{provider:string;repo:string;commit:string|null}}>('fmp/read_inferences'); }
  import(snapshot: Archive) { return this.request<{receipts:Receipt[];commit:string}>('fmp/import',snapshot); }
  history() { return this.request<{commits:{hash:string;message:string;parents:string[]}[]}>('history'); }
}

/** One entry point across personal and company stores. Writes route explicitly. */
export class OmpGateway {
  baseUrl: string;
  constructor(baseUrl: string) { this.baseUrl=baseUrl.replace(/\/$/,''); }
  private async request<T>(path:string,data?:unknown):Promise<T> {
    const r=await fetch(`${this.baseUrl}/gateway/${path}`,data === undefined ? {} : {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    const result=await r.json() as T & {error?:string};
    if (!r.ok) throw new Error(`OMP ${r.status}: ${result.error ?? 'Gateway request failed'}`);
    return result;
  }
  info() { return this.request<{connected_stores:Store[];routing:{default:Store}}>('info'); }
  remember(memory:MemoryInput,store:Store='personal') { return this.request<SavedMemory & {routed_to:Store}>('fmp/upload/inferences',{memory,store}); }
  search(query:string,limit=20) { return this.request<{memories:{store:Store;memory:Memory;commit:string|null}[];total:number;partial:boolean;stores:{store:Store;ok:boolean}[]}>('fmp/search',{query,limit}); }
}
