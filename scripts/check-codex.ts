import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';

// Exercise Codex's own MCP client and skill scanner without a model request/login.
const child=spawn('codex',['app-server','--stdio'],{stdio:['pipe','pipe','pipe']});
const lines=createInterface({input:child.stdout});
const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
let nextId=0;
function rejectAll(message:string) {
  for(const {reject,timer} of pending.values()) {clearTimeout(timer);reject(new Error(message));}
  pending.clear();
}
child.on('error',()=>rejectAll('Could not launch Codex. Install the CLI first.'));
child.on('exit',()=>rejectAll('Codex app-server exited before responding'));
// Drain diagnostics, but do not print unrelated server configuration or credentials.
child.stderr.on('data',()=>{});
lines.on('line',line=>{
  let message:{id?:number;result?:unknown;error?:{message:string}};
  try {message=JSON.parse(line);} catch {return;}
  const item=message.id===undefined ? undefined : pending.get(message.id);
  if(!item) return;
  pending.delete(message.id!);clearTimeout(item.timer);
  if(message.error) item.reject(new Error(message.error.message));else item.resolve(message.result);
});
function request<T>(method:string,params:Record<string,unknown>):Promise<T> {
  const id=++nextId;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timed out: ${method}`));},90000);
    pending.set(id,{resolve:value=>resolve(value as T),reject,timer});
    child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
}
try {
  await request('initialize',{clientInfo:{name:'omp_memory_check',version:'0.1.0'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
  const status=await request<{data:{name:string;tools:Record<string,{name:string}>;toolsError?:string;serverInfo?:{name:string}}[]}>('mcpServerStatus/list',{serverName:'omp-memory',detail:'full'});
  const server=status.data.find(s=>s.name==='omp-memory');
  assert.ok(server,'Codex did not discover omp-memory; run npm run codex:setup');
  assert.ok(!server.toolsError,server.toolsError ?? 'Codex tool discovery failed');
  const tools=Object.values(server.tools).map(t=>t.name).sort();
  assert.deepEqual(tools,['about_omp','add_memory','delete_memory','get_memory','search_memories','update_memory']);
  const skills=await request<{data:{skills:{name:string;enabled:boolean}[];errors:unknown[]}[]}>('skills/list',{cwds:[process.cwd()],forceReload:true});
  assert.ok(skills.data.some(entry=>entry.skills.some(s=>s.name==='omp-memory' && s.enabled)),'Codex did not find the enabled omp-memory skill');
  const version=spawnSync('codex',['--version'],{encoding:'utf8'}).stdout.trim();
  const report={checked_at:new Date().toISOString(),codex:version,mcp:'omp-memory',tools,skill_found:true,verification:'Fresh Codex app-server initialized the deployed MCP server and discovered its tools and installed skill. No model generation or new Codex thread was used.'};
  console.log(JSON.stringify(report,null,2));
  if(process.argv[2]) await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
} finally {
  child.stdin.end();lines.close();child.kill();
  rejectAll('Check finished');
}
