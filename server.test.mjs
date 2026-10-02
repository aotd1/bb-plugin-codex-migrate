import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,rmSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import plugin from './.tmp-test/server.js';
import {fixture,meta,assertNoModel} from './test-fixtures.mjs';

function sourceFixture({git=true,threads=true}={}) {
  const directory=mkdtempSync(join(tmpdir(),'codex-api-source-'));const home=join(directory,'codex');const root=join(directory,'repo');mkdirSync(home);mkdirSync(root);
  if(git)execFileSync('git',['-C',root,'init'],{stdio:'ignore'});
  // This is exclusively a source Codex fixture, never a BB store.
  const db=new Database(join(home,'state_5.sqlite'));
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,position INTEGER,created_at_ms INTEGER);
    CREATE TABLE project_roots(project_id TEXT,position INTEGER,path TEXT);
    CREATE TABLE threads(id TEXT PRIMARY KEY,project_id TEXT,title TEXT,cwd TEXT,archived INTEGER,archived_at INTEGER,created_at_ms INTEGER,updated_at_ms INTEGER,created_at INTEGER,updated_at INTEGER,model TEXT,reasoning_effort TEXT,source TEXT,rollout_path TEXT,has_user_event INTEGER,tokens_used INTEGER,first_user_message TEXT,preview TEXT);`);
  db.prepare('INSERT INTO projects VALUES(?,?,?,?)').run('src_project','Fixture',0,1000);
  db.prepare('INSERT INTO project_roots VALUES(?,?,?)').run('src_project',0,root);
  if(threads)for(const [i,id] of [meta.id,'other-session'].entries()){
    const rollout=join(home,`${i}.jsonl`);
    writeFileSync(rollout,[
      {timestamp:'1970-01-01T00:00:01Z',type:'event_msg',payload:{type:'task_started',turn_id:'t1',started_at:1}},
      {timestamp:'1970-01-01T00:00:01Z',type:'event_msg',payload:{type:'item_completed',turn_id:'t1',item:{type:'UserMessage',id:'u1',content:[{type:'text',text:'hello'}]}}},
      {timestamp:'1970-01-01T00:00:02Z',type:'event_msg',payload:{type:'item_completed',turn_id:'t1',item:{type:'AgentMessage',id:'a1',content:'reply'}}},
      {timestamp:'1970-01-01T00:00:02Z',type:'event_msg',payload:{type:'task_complete',turn_id:'t1',completed_at:2}},
    ].map(r=>JSON.stringify(r)).join('\n')+'\n');
    db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'src_project',`Chat ${i}`,root,0,null,1000,2000,1,2,null,null,'cli',rollout,1,0,'hello','hello');
  }
  db.close();
  const cli=join(directory,'mock-codex');writeFileSync(cli,`#!/usr/bin/env node
let pending='';process.stdin.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\\n'))>=0){const r=JSON.parse(pending.slice(0,end));pending=pending.slice(end+1);if(typeof r.id!=='number')continue;const reply=r.method==='thread/read'?{id:r.id,error:{message:'paginated threads do not support thread/read'}}:{id:r.id,result:{}};process.stdout.write(JSON.stringify(reply)+'\\n');}});
`);chmodSync(cli,0o755);
  const priorHome=process.env.CODEX_HOME,priorCli=process.env.CODEX_CLI;process.env.CODEX_HOME=home;process.env.CODEX_CLI=cli;
  return {root,home,close(){if(priorHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=priorHome;if(priorCli===undefined)delete process.env.CODEX_CLI;else process.env.CODEX_CLI=priorCli;rmSync(directory,{recursive:true,force:true});}};
}

test('explicit folders and conversation selection, local history fallback, full repeat and progress',async()=>{
  const source=sourceFixture();const f=fixture({projects:[{id:'proj_import',name:'BB fixture',sources:[{hostId:'host_source',path:source.root,isDefault:true}]}]});
  try{
    await plugin(f.bb);
    const missing=await f.harness.behavior.runCli(['apply']);assert.equal(missing.exitCode,1);assert.match(missing.stderr,/Select a project/);assert.equal(f.calls.length,0);
    const repair=await f.harness.behavior.runCli(['repair']);assert.equal(repair.exitCode,1);assert.match(repair.stderr,/Unknown command/);
    const preview=await f.harness.behavior.callRpc('scan',{projects:['src_project'],all:false,includeThreads:true});assert.equal(preview.projects[0].candidates,2);assert.equal(preview.projects[0].threads.length,2);assert.deepEqual(preview.projects[0].threads[0].limitations,[]);
    const result=await f.harness.behavior.runCli(['apply','--project','src_project','--thread',meta.id,'--json']);assert.equal(result.exitCode,0,result.stderr??result.stdout);
    const report=JSON.parse(result.stdout);assert.equal(report.projects[0].candidates,1);assert.equal(report.projects[0].imported,1);assert.equal(f.calls[0].conversationId,meta.id);
    const repeated=await f.harness.behavior.runCli(['apply','--project','src_project','--thread',meta.id,'--json']);assert.equal(repeated.exitCode,0,repeated.stderr??repeated.stdout);assert.equal(JSON.parse(repeated.stdout).projects[0].existing,1);assert.equal(f.timeline.length,1);
    const status=await f.harness.behavior.callRpc('status',null);assert.equal(status.current.state,'completed');assert.equal(status.current.projectProgress[0].processed,1);assert.equal(status.current.projectProgress[0].total,1);
    const wrong=await f.harness.behavior.runCli(['apply','--project','src_project','--thread','outside']);assert.equal(wrong.exitCode,1);assert.match(wrong.stderr,/outside selected folders/);assertNoModel(f.harness);
  }finally{await f.harness.lifecycle.dispose();source.close();}
});
test('git init is explicit and only selected folder creates a project',async()=>{
  const source=sourceFixture({git:false,threads:false});const f=fixture();try{
    await plugin(f.bb);const skipped=await f.harness.behavior.runCli(['apply','--project','src_project']);assert.equal(skipped.exitCode,1);assert.equal(existsSync(join(source.root,'.git')),false);
    const applied=await f.harness.behavior.runCli(['apply','--project','src_project','--init-git','--json']);assert.equal(applied.exitCode,0,applied.stderr);assert.equal(existsSync(join(source.root,'.git')),true);assert.equal(JSON.parse(applied.stdout).projects[0].targetProjectId,'proj_import');assert.equal(f.harness.inspection.sdk.callsTo('projects.create').length,1);assertNoModel(f.harness);
  }finally{await f.harness.lifecycle.dispose();source.close();}
});
test('cross-project legacy routing conflict is surfaced before creating projects',async()=>{
  const source=sourceFixture();const f=fixture({projects:[{id:'proj_import',name:'Target',sources:[{hostId:'host_source',path:source.root,isDefault:true}]}],legacyThreads:[{id:'thr_other',projectId:'proj_elsewhere',providerId:'codex',deletedAt:null,environmentHostId:'host_source',archivedAt:null}],events:{thr_other:[{type:'thread/identity',seq:1,scope:{kind:'thread'},data:{providerThreadId:meta.id},createdAt:1000}]}});
  try{await plugin(f.bb);const preview=await f.harness.behavior.callRpc('scan',{projects:['src_project'],all:false,includeThreads:true});assert.match(preview.projects[0].conflicts[0].reason,/another BB project/);const result=await f.harness.behavior.runCli(['apply','--project','src_project','--thread',meta.id]);assert.equal(result.exitCode,1);assert.match(result.stderr,/another BB project/);assert.equal(f.calls.length,0);assert.equal(f.harness.inspection.sdk.callsTo('projects.create').length,0);}finally{await f.harness.lifecycle.dispose();source.close();}
});
test('partial continuation is visible in CLI/report/project progress and persists through reload',async()=>{
  const source=sourceFixture();const f=fixture({noEnvironment:true});try{
    await plugin(f.bb);const result=await f.harness.behavior.runCli(['apply','--project','src_project','--thread',meta.id,'--json']);assert.equal(result.exitCode,1);const report=JSON.parse(result.stdout);assert.equal(report.projects[0].partiallyImported.length,1);assert.match(report.projects[0].partiallyImported[0].message,/continuation pending/);
    const status=await f.harness.behavior.callRpc('status',null);assert.equal(status.current.partiallyImported,1);assert.equal(status.current.projectProgress[0].state,'partial');const reloaded=await f.harness.lifecycle.reload(plugin);assert.equal((await reloaded.harness.behavior.callRpc('status',null)).report.projects[0].partiallyImported.length,1);assertNoModel(reloaded.harness);await reloaded.harness.lifecycle.dispose();
  }finally{await f.harness.lifecycle.dispose();source.close();}
});
test('interrupted background progress is restored honestly on reload',async()=>{
  const f=fixture();try{await f.bb.storage.kv.set('current-run',{runId:'run_interrupted',state:'running',projects:['src_project'],startedAt:'2026-10-03T00:00:00Z',updatedAt:'2026-10-03T00:00:00Z',completedAt:null,currentProject:null,currentThread:null,processed:0,total:1,imported:0,existing:0,skippedEmpty:0,failed:0,error:null});await plugin(f.bb);const status=await f.harness.behavior.callRpc('status',null);assert.equal(status.current.state,'interrupted');assert.match(status.current.error,/Rerun/);assert.equal(status.current.projectProgress[0].state,'interrupted');}finally{await f.harness.lifecycle.dispose();}
});
test('explicit bind/release preserve original handle, use CAS and propagate settled conflicts',async()=>{
  const f=fixture({releaseConflict:'active runtime retained'});try{await plugin(f.bb);f.bindings.set(JSON.stringify(['proj_import','codex-local:host_source',meta.id]),{threadId:'thr_imported',providerId:'codex',sessionId:meta.id,generation:0,mode:'passive'});
    const missing=await f.harness.behavior.runCli(['bind','--bb-project','proj_import','--thread',meta.id]);assert.equal(missing.exitCode,1);
    const bound=await f.harness.behavior.runCli(['bind','--bb-project','proj_import','--thread',meta.id,'--environment','env_ready']);assert.equal(bound.exitCode,0,bound.stderr);
    const released=await f.harness.behavior.runCli(['release','--bb-project','proj_import','--thread',meta.id]);assert.equal(released.exitCode,1);assert.match(released.stderr,/retained/);assertNoModel(f.harness);
  }finally{await f.harness.lifecycle.dispose();}
});
test('shared project folders are deduplicated before creating targets/importing a selected conversation',async()=>{
  const source=sourceFixture();const db=new Database(join(source.home,'state_5.sqlite'));db.prepare('INSERT INTO projects VALUES(?,?,?,?)').run('src_shared','Shared',1,1000);db.prepare('INSERT INTO project_roots VALUES(?,?,?)').run('src_shared',0,source.root);db.close();
  const f=fixture();try{await plugin(f.bb);const result=await f.harness.behavior.runCli(['apply','--project','src_project','--project','src_shared','--thread',meta.id,'--json']);assert.equal(result.exitCode,0,result.stderr??result.stdout);assert.equal(f.harness.inspection.sdk.callsTo('projects.create').length,1);assert.equal(f.calls.length,1);assert.equal(JSON.parse(result.stdout).projects.length,1);}finally{await f.harness.lifecycle.dispose();source.close();}
});
test('multi-root source project creates one target per independent repository',async()=>{
  const source=sourceFixture({threads:false});const second=join(source.home,'second-repo');mkdirSync(second);execFileSync('git',['-C',second,'init'],{stdio:'ignore'});const db=new Database(join(source.home,'state_5.sqlite'));db.prepare('INSERT INTO project_roots VALUES(?,?,?)').run('src_project',1,second);db.close();
  const f=fixture();try{await plugin(f.bb);const result=await f.harness.behavior.runCli(['apply','--project','src_project','--json']);assert.equal(result.exitCode,0,result.stderr??result.stdout);assert.equal(f.harness.inspection.sdk.callsTo('projects.create').length,2);assert.equal(JSON.parse(result.stdout).projects.length,2);}finally{await f.harness.lifecycle.dispose();source.close();}
});
