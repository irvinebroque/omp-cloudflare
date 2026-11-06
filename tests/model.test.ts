import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, validateMemory, archive, type State } from '../src/model.ts';
const memory = () => validateMemory({identifier:'a',media_type:'text/plain',created_at:'2026-11-06T12:00:00Z',body:'Use TypeScript',custom:{owner:'team',nested:[1,2]}});
const state = (origin='store:a'):State => ({origin,memories:[],tombstones:[]});
test('unknown fields and origin survive export/import, repeated imports do not duplicate', () => {
  const a=state(), b=state('store:b'); merge(a,[memory()]);
  const exported=archive(a); assert.equal(merge(b,exported.memories)[0].status,'accepted');
  assert.deepEqual(b.memories,a.memories); assert.equal(merge(b,exported.memories)[0].status,'unchanged'); assert.equal(b.memories.length,1);
});
test('same identifier from different origins does not collide', () => {
  const s=state(); merge(s,[{...memory(),x_omp_origin:'a'},{...memory(),x_omp_origin:'b'}]); assert.equal(s.memories.length,2);
});
test('conflicting content does not silently overwrite existing identity', () => {
  const s=state(); merge(s,[memory()]); const receipts=merge(s,[{...memory(),body:'Other'}]);
  assert.equal(receipts[0].status,'rejected'); assert.equal(s.memories[0].body,'Use TypeScript');
});
test('tombstone propagates deletion and blocks old snapshot replay', () => {
  const a=state(), b=state('b'); merge(a,[memory()]); const stale=archive(a);
  merge(b,stale.memories); const t={origin:a.origin,identifier:'a',deleted_at:'2026-11-06T13:00:00Z'};
  merge(a,[],[t]); merge(b,[],archive(a).tombstones);
  assert.equal(merge(b,stale.memories)[0].reason,'deleted_identity'); assert.equal(b.memories.length,0);
});
test('typed body and timestamps are validated', () => {
  for (const patch of [{body:42},{created_at:'bad'},{media_type:''},{body:'x'.repeat(16385)},{valid_from:'2026-11-07T00:00:00Z',valid_until:'2026-11-06T00:00:00Z'}]) assert.throws(()=>validateMemory({...memory(),...patch}));
});
