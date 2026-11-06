import { ApiError, text, type Memory } from './model.ts';
import { read, STORES, type Store } from './storage.ts';

export interface GatewayHit { store: Store; memory: Memory; commit: string | null }
export function targetStore(value: unknown): Store {
  if (value === undefined) return 'personal';
  if (value !== 'personal' && value !== 'company') throw new ApiError(400,'store must be personal or company');
  return value;
}
export function searchMemories(memories: Memory[], query: string, now = Date.now()): Memory[] {
  const q = query.toLowerCase();
  return memories.filter(m => (!m.valid_from || Date.parse(m.valid_from) <= now) && (!m.valid_until || Date.parse(m.valid_until) > now) && `${m.identifier}\n${m.title ?? ''}\n${m.body}\n${m.tags?.join(' ') ?? ''}`.toLowerCase().includes(q));
}
export function searchInput(data: Record<string, unknown>): {query:string;limit:number} {
  const query = data.query === undefined ? '' : typeof data.query === 'string' ? data.query : text(data.query,'query',4096);
  if (query.length > 4096) throw new ApiError(400,'query is too long');
  const limit=data.limit === undefined ? 20 : Number(data.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400,'limit must be an integer from 1 to 100');
  return {query,limit};
}
/** Search every connected store. Keep store attribution even for copied identities. */
export async function federatedSearch(artifacts: Artifacts, data: Record<string, unknown>) {
  const {query,limit}=searchInput(data);
  const responses=await Promise.all(STORES.map(async store => {
    try {
      const {state,commit}=await read(artifacts,store);
      return {store,ok:true as const,commit,hits:searchMemories(state.memories,query).map(memory=>({store,memory,commit}))};
    } catch {
      return {store,ok:false as const,error:'Store unavailable',hits:[] as GatewayHit[]};
    }
  }));
  if (responses.every(r=>!r.ok)) throw new ApiError(503,'All connected memory stores are unavailable');
  const hits=responses.flatMap(r=>r.hits).sort((a,b)=>b.memory.created_at.localeCompare(a.memory.created_at) || a.store.localeCompare(b.store) || a.memory.identifier.localeCompare(b.memory.identifier));
  return {memories:hits.slice(0,limit),total:hits.length,partial:responses.some(r=>!r.ok),stores:responses.map(({hits,...status})=>status)};
}
