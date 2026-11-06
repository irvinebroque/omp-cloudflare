import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetStore, searchInput, searchMemories } from '../src/gateway.ts';
const memory = {identifier:'x',media_type:'text/plain',created_at:'2026-11-06T00:00:00Z',body:'TypeScript project'};
test('gateway routes default to personal and company writes only when explicitly selected',()=>{
  assert.equal(targetStore(undefined),'personal'); assert.equal(targetStore('company'),'company');
  assert.throws(()=>targetStore('unconnected-store'));
});
test('search handles validity, case-insensitive body/title/tags and bounded results',()=>{
  assert.equal(searchMemories([memory],'typescript').length,1);
  assert.equal(searchMemories([{...memory,valid_until:'2020-01-01T00:00:00Z'}],'typescript').length,0);
  assert.equal(searchMemories([{...memory,valid_from:'2099-01-01T00:00:00Z'}],'typescript').length,0);
  assert.equal(searchMemories([{...memory,tags:['Company']}],'company').length,1);
  assert.equal(searchInput({}).limit,20); assert.throws(()=>searchInput({limit:1000}));
});
