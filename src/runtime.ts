import { createHash } from 'node:crypto';
import picomatch from 'picomatch';
import { ApiError, object, stable, text, type Memory, type State } from './model.ts';

/** Local experimental conventions inspired by issue #22; not a settled OMP schema. */
export interface Context { repository?: string; directory?: string; paths?: string[]; explicit_request?: boolean }
export interface Applicability { level: 'user' | 'organization' | 'repository' | 'directory' | 'paths'; repository?: string; directory?: string; globs?: string[] }
export interface Activation { mode: 'always' | 'paths' | 'relevant' | 'on_request'; globs?: string[]; description?: string }

export function repositoryKey(value: string): string {
  const candidate = value.replace(/^git@([^:]+):/, 'https://$1/');
  try {
    const url = new URL(candidate);
    if (!['https:', 'http:', 'ssh:'].includes(url.protocol)) throw new Error();
    return `${url.host.toLowerCase()}${url.pathname.replace(/\/$/, '').replace(/\.git$/, '')}`;
  } catch { throw new ApiError(400, 'repository must be a remote URL or git@host:path'); }
}
export function relativePath(value: string): string {
  const path = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').includes('..')) throw new ApiError(400, 'Paths must be repository-relative, without ..');
  return path === '.' ? '' : path;
}
function globs(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 32) throw new ApiError(400, 'globs must contain 1 to 32 patterns');
  return value.map(v => relativePath(text(v, 'glob', 512)));
}
export function validateConventions(memory: Memory): void {
  if (memory.applies_to !== undefined) {
    const a = object(memory.applies_to);
    if (!['user','organization','repository','directory','paths'].includes(String(a.level))) throw new ApiError(400, 'Unsupported applies_to.level');
    if (!['user','organization'].includes(String(a.level))) repositoryKey(text(a.repository, 'applies_to.repository', 1024));
    if (a.level === 'directory') relativePath(text(a.directory, 'applies_to.directory', 1024));
    if (a.level === 'paths') globs(a.globs);
  }
  if (memory.activation !== undefined) {
    const a = object(memory.activation);
    if (!['always','paths','relevant','on_request'].includes(String(a.mode))) throw new ApiError(400, 'Unsupported activation.mode');
    if (a.mode === 'paths') globs(a.globs);
    if (a.mode === 'relevant' && !a.description && !memory.title) throw new ApiError(400, 'Relevant activation needs a description or title');
    if (a.description !== undefined) text(a.description, 'activation.description', 1024);
  }
}
export function validateContext(value: unknown): Context {
  const c = object(value);
  if (c.repository !== undefined) repositoryKey(text(c.repository, 'context.repository', 1024));
  if (c.directory !== undefined) relativePath(text(c.directory, 'context.directory', 1024));
  if (c.paths !== undefined && (!Array.isArray(c.paths) || c.paths.length > 100 || c.paths.some(p => typeof p !== 'string' || p.length > 1024))) throw new ApiError(400, 'context.paths must be up to 100 relative paths');
  for (const p of c.paths as string[] ?? []) relativePath(p);
  if (c.explicit_request !== undefined && typeof c.explicit_request !== 'boolean') throw new ApiError(400, 'explicit_request must be boolean');
  return c as Context;
}
export function applicable(memory: Memory, context: Context): boolean {
  const now = Date.now();
  if ((memory.valid_from && Date.parse(memory.valid_from) > now) || (memory.valid_until && Date.parse(memory.valid_until) <= now)) return false;
  // Unknown imported applicability must not silently turn into a global instruction.
  try { validateConventions(memory); } catch { return false; }
  const a = memory.applies_to as Applicability | undefined;
  const paths = (context.paths ?? []).map(relativePath);
  const matches = (patterns: string[]) => paths.some(path => picomatch(patterns, {dot:true})(path));
  if (a && !['user','organization'].includes(a.level)) {
    if (!context.repository || repositoryKey(context.repository) !== repositoryKey(a.repository!)) return false;
    if (a.level === 'directory') {
      const dir = relativePath(a.directory!);
      const inside = (p: string) => !dir || p === dir || p.startsWith(dir + '/');
      if (!(context.directory !== undefined && inside(relativePath(context.directory))) && !paths.some(inside)) return false;
    }
    if (a.level === 'paths' && !matches(a.globs!)) return false;
  }
  const activation = memory.activation as Activation | undefined;
  if (activation?.mode === 'on_request' && !context.explicit_request) return false;
  if (activation?.mode === 'paths' && !matches(activation.globs!)) return false;
  return true;
}

/** An opaque per-memory optimistic-concurrency token, not a portable OMP comparator. */
export const memoryVersion = (memory: Memory) => createHash('sha256').update(stable(memory)).digest('hex');
export function selectMemory(state: State, data: Record<string, unknown>): Memory {
  const identifier = text(data.identifier, 'identifier');
  const found = state.memories.filter(m => m.identifier === identifier && (!data.origin || m.x_omp_origin === data.origin));
  if (!found.length) throw new ApiError(404, 'Memory not found');
  if (found.length > 1) throw new ApiError(409, 'Ambiguous identifier; provide origin');
  return found[0];
}
export function addContribution(memory: Memory, contributor: string, contribution: string): Memory {
  const previous = Array.isArray(memory.provenance) ? memory.provenance : [];
  if (previous.length >= 100) throw new ApiError(413, 'Prototype limit: 100 provenance entries');
  return {...memory, provenance:[...previous,{id:text(contributor,'contributor'),kind:contributor.startsWith('user:') ? 'human' : 'agent',contribution,at:new Date().toISOString()}]};
}
