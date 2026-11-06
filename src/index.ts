import { ApiError, archive, key, merge, object, text, timestamp, validateMemory, type Memory, type Tombstone } from './model.ts';
import { mutate, read, STORES, type Store } from './storage.ts';
import { page } from './page.ts';
import { federatedSearch, targetStore, searchInput, searchMemories } from './gateway.ts';

const json = (value: unknown, status = 200) => Response.json(value, {status, headers:{'cache-control':'no-store'}});
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, 'Use application/json');
  if (!request.body) throw new ApiError(400, 'JSON body required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 1048576) { await reader.cancel(); throw new ApiError(413, 'Request limit: 1 MiB'); }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return object(JSON.parse(new TextDecoder().decode(bytes))); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'Invalid JSON'); }
}
function select(memories: Memory[], data: Record<string, unknown>, fallback: string): Memory {
  const identifier = text(data.identifier, 'identifier');
  const found = memories.filter(m => m.identifier === identifier && (!data.origin || m.x_omp_origin === data.origin));
  if (!found.length) throw new ApiError(404, 'Memory not found');
  if (found.length > 1) throw new ApiError(409, 'Ambiguous identifier; provide origin');
  return found[0];
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/') return new Response(page, {headers:{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",'x-content-type-options':'nosniff'}});
  if (request.method === 'GET' && url.pathname === '/health') return json({ok:true, storage:'Cloudflare Artifacts'});
  if (request.method === 'GET' && url.pathname === '/fmp/info') return json({name:'OMP on Cloudflare', version:'0.1.0', draft:'OMP editors v0.2 / FMP proposal', profiles:['minimal'], auth:'none (public prototype)', stores:STORES, gateway:'/gateway/info', namespace:'ompi-memory-prototype', storage:'Cloudflare Artifacts Git repositories', capabilities:['remember','read','search','update','delete','export','import','history'], unsupported:['audit','secure-forget','scope-enforcement','transcripts','files','move']});
  if (request.method === 'GET' && url.pathname === '/gateway/info') return json({name:'OMP memory gateway',connected_stores:STORES,search:'/gateway/fmp/search',write:'/gateway/fmp/upload/inferences',routing:{field:'store',default:'personal',allowed:STORES},auth:'none (public prototype)'});
  if (request.method === 'POST' && url.pathname.startsWith('/gateway/fmp/')) {
    const data = await body(request);
    if (url.pathname === '/gateway/fmp/search') return json(await federatedSearch(env.ARTIFACTS,data));
    const target = targetStore(data.store);
    const supported=['upload/inferences','read','update','delete','import'];
    const operation=url.pathname.slice('/gateway/fmp/'.length);
    if (!supported.includes(operation)) throw new ApiError(404,'Gateway endpoint not supported');
    const {store: ignored, ...payload}=data;
    const internalUrl=new URL(`/stores/${target}/fmp/${operation}`,url);
    const response=await route(new Request(internalUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),env);
    return json({routed_to:target,...await response.json() as Record<string,unknown>},response.status);
  }
  const match = url.pathname.match(/^\/stores\/(personal|company)\/(fmp\/.*|history)$/);
  if (!match) throw new ApiError(404, 'Route not found; see /fmp/info');
  const store = match[1] as Store, path = match[2];
  if (request.method === 'GET' && path === 'history') {
    using repo = await env.ARTIFACTS.get(store);
    return json({commits:await repo.log({ref:'main', limit:20})});
  }
  if (request.method === 'GET' && path === 'fmp/info') return json({store, capabilities:['search','read','upload/inferences','read_inferences','delete','import','update'], auth:'none'});
  if (request.method === 'GET' && path === 'fmp/read_inferences') {
    const {state,commit} = await read(env.ARTIFACTS,store);
    return json({...archive(state), storage:{provider:'cloudflare-artifacts', repo:store, commit}});
  }
  if (request.method !== 'POST') throw new ApiError(405, 'Method not allowed');
  const data = await body(request);
  if (path === 'fmp/read') {
    const {state,commit} = await read(env.ARTIFACTS,store);
    return json({memory:select(state.memories,data,state.origin),commit});
  }
  if (path === 'fmp/search') {
    const {query,limit}=searchInput(data);
    const {state,commit} = await read(env.ARTIFACTS,store);
    const memories=searchMemories(state.memories,query);
    return json({memories:memories.slice(0,limit),total:memories.length,commit});
  }
  if (path === 'fmp/upload/inferences') {
    const memory = validateMemory({identifier:crypto.randomUUID(),media_type:'text/plain',created_at:new Date().toISOString(),...object(data.memory)});
    if (memory.x_omp_origin) throw new ApiError(400, 'Use import to ingest memories from another origin');
    const saved = await mutate(env.ARTIFACTS,store,`Remember ${memory.identifier}`,state => ({receipts:merge(state,[memory]),memory:{...memory,x_omp_origin:state.origin}}));
    return json({...saved.result,commit:saved.commit}, saved.result.receipts[0].status === 'rejected' ? 409 : 200);
  }
  if (path === 'fmp/update') {
    const result = await mutate(env.ARTIFACTS,store,`Update memory`,state => {
      const old = select(state.memories,data,state.origin);
      if (old.x_omp_origin !== state.origin) throw new ApiError(409, 'Imported memories are immutable here; create a new local memory');
      const patch = object(data.patch);
      for (const field of ['identifier','created_at','x_omp_origin']) if (field in patch) throw new ApiError(400, `Cannot patch ${field}`);
      const memory = validateMemory({...old,...patch,updated_at:new Date().toISOString()});
      state.memories = state.memories.map(m => key(m,state.origin) === key(old,state.origin) ? memory : m);
      merge(state,[]); return {memory};
    });
    return json({...result.result,commit:result.commit});
  }
  if (path === 'fmp/delete') {
    const result = await mutate(env.ARTIFACTS,store,'Delete memory',state => {
      const identifier = text(data.identifier,'identifier');
      const existing = state.memories.find(m => m.identifier === identifier && (!data.origin || m.x_omp_origin === data.origin));
      if (!existing) {
        const deleted = state.tombstones.find(t => t.identifier === identifier && (!data.origin || t.origin === data.origin));
        if (deleted) return {deleted:true,tombstone:deleted};
      }
      const m = select(state.memories,data,state.origin);
      const tombstone = {origin:m.x_omp_origin ?? state.origin,identifier:m.identifier,deleted_at:new Date().toISOString()};
      merge(state,[],[tombstone]); return {deleted:true,tombstone};
    });
    return json({...result.result,commit:result.commit});
  }
  if (path === 'fmp/import') {
    const manifest = object(data.manifest);
    if (manifest.protocol_version !== '0.2' || manifest.intent !== 'copy' || manifest.selection !== 'snapshot') throw new ApiError(400, 'Only OMP 0.2 snapshot/copy imports are supported');
    if (!Array.isArray(manifest.profiles) || manifest.profiles.length !== 1 || manifest.profiles[0] !== 'minimal') throw new ApiError(400, 'Only the minimal profile is supported');
    const source = text(manifest.origin,'manifest.origin'); timestamp(manifest.exported_at,'manifest.exported_at');
    if (!Array.isArray(data.memories) || data.memories.length > 100) throw new ApiError(400, 'memories must be an array of at most 100 objects');
    const memories = data.memories.map(m => { const v = validateMemory(m); return {...v,x_omp_origin:v.x_omp_origin ?? source}; });
    if (data.tombstones !== undefined && (!Array.isArray(data.tombstones) || data.tombstones.length > 500)) throw new ApiError(400, 'Invalid tombstones');
    const tombstones: Tombstone[] = (data.tombstones as unknown[] ?? []).map(t => { const v=object(t); return {origin:text(v.origin,'origin'),identifier:text(v.identifier,'identifier'),deleted_at:timestamp(v.deleted_at,'deleted_at')}; });
    const result = await mutate(env.ARTIFACTS,store,'Import OMP snapshot',state => ({receipts:merge(state,memories,tombstones)}));
    return json({...result.result,commit:result.commit});
  }
  throw new ApiError(404, 'Endpoint not supported');
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await route(request,env); }
    catch (error) {
      if (error instanceof ApiError) return json({error:error.message},error.status);
      console.error(JSON.stringify({event:'request_failed',message:error instanceof Error ? error.message : 'Unknown error'}));
      return json({error:'Storage operation failed'},503);
    }
  },
} satisfies ExportedHandler<Env>;
