/** OMP editors' draft v0.2 (PR #13), minimal profile; extensions are preserved. */
export interface Memory {
  identifier: string;
  media_type: string;
  created_at: string;
  body: string;
  title?: string;
  tags?: string[];
  valid_from?: string;
  valid_until?: string;
  x_omp_origin?: string;
  [extension: string]: unknown;
}
export interface Tombstone { origin: string; identifier: string; deleted_at: string }
export interface Archive {
  manifest: {
    protocol_version: '0.2'; profiles: string[]; origin: string;
    exported_at: string; selection: 'snapshot'; intent: 'copy'; media_types: string[];
  };
  memories: Memory[];
  tombstones: Tombstone[];
}
export interface State { origin: string; memories: Memory[]; tombstones: Tombstone[] }
export interface Receipt { identifier: string; origin: string; status: 'accepted' | 'unchanged' | 'rejected'; reason?: string }
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Expected a JSON object');
  return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(400, `${name} must be a nonempty string of at most ${max} characters`);
  return value;
}
export function timestamp(value: unknown, name: string): string {
  const result = text(value, name, 64);
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(result) || !Number.isFinite(Date.parse(result))) throw new ApiError(400, `${name} must be an ISO 8601 timestamp with timezone`);
  return result;
}
export function validateMemory(value: unknown): Memory {
  const m = object(value);
  text(m.identifier, 'identifier'); text(m.media_type, 'media_type', 128);
  timestamp(m.created_at, 'created_at');
  if (typeof m.body !== 'string' || new TextEncoder().encode(m.body).length > 16384) throw new ApiError(400, 'body must be a string of at most 16 KiB');
  if (m.tags !== undefined && (!Array.isArray(m.tags) || m.tags.length > 32 || m.tags.some(t => typeof t !== 'string' || t.length > 128))) throw new ApiError(400, 'tags must be up to 32 short strings');
  if (m.title !== undefined) text(m.title, 'title');
  if (m.x_omp_origin !== undefined) text(m.x_omp_origin, 'x_omp_origin');
  for (const key of ['valid_from', 'valid_until']) if (m[key] !== undefined) timestamp(m[key], key);
  if (m.valid_from && m.valid_until && Date.parse(String(m.valid_from)) >= Date.parse(String(m.valid_until))) throw new ApiError(400, 'valid_until must follow valid_from');
  return m as Memory;
}
export function key(m: { identifier: string; x_omp_origin?: string }, fallback: string): string {
  return JSON.stringify([m.x_omp_origin ?? fallback, m.identifier]);
}
export function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}';
  return JSON.stringify(value);
}
export function merge(state: State, memories: Memory[], tombstones: Tombstone[] = []): Receipt[] {
  const all = new Map(state.memories.map(m => [key(m, state.origin), m]));
  const deleted = new Map(state.tombstones.map(t => [key({identifier:t.identifier, x_omp_origin:t.origin}, state.origin), t]));
  for (const t of tombstones) {
    const k = key({identifier:t.identifier, x_omp_origin:t.origin}, state.origin);
    deleted.set(k, t); all.delete(k);
  }
  const receipts = memories.map(memory => {
    const m = { ...memory, x_omp_origin: memory.x_omp_origin ?? state.origin };
    const k = key(m, state.origin);
    const origin = m.x_omp_origin;
    if (deleted.has(k)) return { identifier:m.identifier, origin, status:'rejected' as const, reason:'deleted_identity' };
    const previous = all.get(k);
    if (previous && stable(previous) !== stable(m)) return { identifier:m.identifier, origin, status:'rejected' as const, reason:'identity_conflict; use update for a local memory' };
    all.set(k, m);
    return { identifier:m.identifier, origin, status: previous ? 'unchanged' as const : 'accepted' as const };
  });
  if (all.size > 100 || deleted.size > 500) throw new ApiError(413, 'Prototype limit: 100 memories and 500 tombstones per store');
  state.memories = [...all.values()]; state.tombstones = [...deleted.values()];
  if (new TextEncoder().encode(JSON.stringify(state)).length > 524288) throw new ApiError(413, 'Prototype store limit: 512 KiB');
  return receipts;
}
export function archive(state: State): Archive {
  return { manifest: {protocol_version:'0.2', profiles:['minimal'], origin:state.origin, exported_at:new Date().toISOString(), selection:'snapshot', intent:'copy', media_types:[...new Set(state.memories.map(m => m.media_type))]}, memories:state.memories, tombstones:state.tombstones };
}
