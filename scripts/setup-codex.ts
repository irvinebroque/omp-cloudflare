import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readlink, realpath, symlink, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const name='omp-memory';
const args=process.argv.slice(2);
const uninstall=args.includes('--uninstall');
const urlArg=args.find(a=>!a.startsWith('--'));
if(args.some(a=>a.startsWith('--') && a!=='--uninstall')) throw new Error('Usage: npm run codex:setup -- [https://worker/mcp] [--uninstall]');
const endpoint=new URL(urlArg ?? 'https://ompi-memory.roundtrip.workers.dev/mcp');
if(endpoint.protocol!=='https:' && !(endpoint.protocol==='http:' && ['localhost','127.0.0.1'].includes(endpoint.hostname))) throw new Error('Use HTTPS, or HTTP localhost for development');
if(endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Do not put credentials, query parameters, or fragments in the endpoint URL');
const source=await realpath(resolve(import.meta.dirname,'../codex/skills/omp-memory'));
const destination=resolve(homedir(),'.agents/skills',name);
function cli(...command:string[]) {
  const result=spawnSync('codex',command,{encoding:'utf8'});
  if(result.error) throw new Error('Codex CLI was not found. Install Codex and sign in first.');
  return result;
}
const existingResult=cli('mcp','get',name,'--json');
const existing=existingResult.status===0 ? JSON.parse(existingResult.stdout) : undefined;
if(existing && existing.transport?.url!==endpoint.href) throw new Error(`The ${name} server already exists with another endpoint. Resolve it with codex mcp get/remove before changing it.`);
if(existing && existing.enabled===false && !uninstall) throw new Error('The omp-memory server is disabled in Codex config. Enable it before running setup.');
let installed=false;
try {
  const stat=await lstat(destination);
  if(!stat.isSymbolicLink() || resolve(destination,'..',await readlink(destination))!==source) throw new Error(`Skill destination already exists: ${destination}. Preserve it or remove it explicitly before proceeding.`);
  installed=true;
} catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;}
if(uninstall) {
  if(existing) {const removed=cli('mcp','remove',name);if(removed.status!==0) throw new Error(removed.stderr || 'Could not remove MCP server');}
  if(installed) await unlink(destination);
  console.log('Removed only the omp-memory MCP entry and this checkout’s skill link. Stored memories are unchanged.');
} else {
  // Verify the endpoint before making persistent local configuration changes.
  const response=await fetch(new URL('/fmp/info',endpoint),{signal:AbortSignal.timeout(15000)});
  if(!response.ok || (await response.json() as {experimental_binding?:string}).experimental_binding!=='omp-cloudflare-mcp/0.1') throw new Error('Endpoint is not the expected OMP MCP deployment');
  if(!existing) {const added=cli('mcp','add',name,'--url',endpoint.href);if(added.status!==0) throw new Error(added.stderr || 'Could not register MCP server');}
  if(!installed) {await mkdir(resolve(destination,'..'),{recursive:true});await symlink(source,destination,'dir');}
  console.log(`Registered ${name}: ${endpoint.href}\nInstalled skill: ${destination}\nOpen a fresh Codex session and try: Use $omp-memory to recall my preferences and company context.\nFor a different deployment, update the URL in the skill’s agents/openai.yaml as well.`);
}
