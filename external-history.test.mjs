import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {experimental_scanPublicSdkOnly} from '@get-bb/plugin-sdk/testing';
import {ExternalHistoryStore,sourceIdentity} from './.tmp-test/external-history.js';
import {convertHistory} from './.tmp-test/history.js';
import {attachHistory} from './.tmp-test/attachments.js';
import {meta,rawHistory,fixture,args,assertNoModel} from './test-fixtures.mjs';
const store=f=>new ExternalHistoryStore(f.bb,'host_source');
const legacyThread=(id='thr_legacy',archived=false)=>({id,projectId:'proj_import',providerId:'codex',environmentHostId:'host_source',deletedAt:null,archivedAt:archived?8000:null});
const rows=(text='user 0')=>[
  {seq:1,type:'thread/identity',scope:{kind:'thread'},createdAt:1000,data:{providerThreadId:meta.id}},
  {seq:2,type:'client/turn/requested',scope:{kind:'thread'},createdAt:1005,data:{input:[{type:'text',text}],requestId:'request'}},
  {seq:3,type:'item/completed',scope:{kind:'turn',turnId:'source-turn-0'},createdAt:1999,data:{item:{type:'agentMessage',id:'a',text:'assistant 0'}}},
];
test('full replay preserves binding, source title/times, resume handle and no model',async()=>{
  const f=fixture();try{
    const s=store(f);const h=()=>convertHistory(rawHistory(),meta);
    const a=await s.importThread(args(h()));const b=await s.importThread(args(h()));
    assert.equal(a.threadId,b.threadId);assert.equal(a.inserted,1);assert.equal(b.inserted,0);assert.equal(b.skipped,1);assert.equal(f.timeline.length,1);
    const request=f.calls[0];assert.equal(request.initialTitle,meta.title);assert.equal(request.initialSourceTitle,meta.title);assert.equal(request.initialCreatedAt,1000);assert.equal(request.initialUpdatedAt,5000);assert.equal(request.sessionId,meta.id);assert.equal(request.sourceId,sourceIdentity('host_source'));
    const bind=f.harness.inspection.sdk.callsTo('threads.experimental_bindExternalSession')[0];assert.equal(bind[0].providerThreadId,meta.id);assertNoModel(f.harness);
  }finally{await f.harness.lifecycle.dispose();}
});
test('lost committed response and a subsequent process reload safely resume batches',async()=>{
  const f=fixture({loseResponseAt:1});try{
    const s=store(f);const history=()=>convertHistory(rawHistory(251),meta);
    await assert.rejects(s.importThread(args(history())),/0 confirmed entries.*response lost/);
    assert.equal([...f.entries.values()][0].size,250);
    const result=await store(f).importThread(args(history()));assert.equal(result.inserted,1);assert.equal(result.skipped,250);assert.equal([...f.entries.values()][0].size,251);assert.equal(f.timeline.length,251);assertNoModel(f.harness);
  }finally{await f.harness.lifecycle.dispose();}
});
test('changed known IDs conflict before mutation; new late backfill conflicts at API',async()=>{
  const f=fixture();try{
    await store(f).importThread(args(convertHistory(rawHistory(),meta)));
    const changed=rawHistory();changed.turns[0].items[1].text='edited';await assert.rejects(store(f).importThread(args(convertHistory(changed,meta))),/Immutable source turn changed/);assert.equal(f.calls.length,1);
    const backfill=rawHistory();backfill.turns[0].id='new-id';await assert.rejects(store(f).importThread(args(convertHistory(backfill,meta))),/backfill/);assert.equal([...f.entries.values()][0].size,1);
  }finally{await f.harness.lifecycle.dispose();}
});
test('atomic invalid batch leaves no timeline or partial first batch',async()=>{
  const f=fixture();try{
    const raw=rawHistory(2);raw.turns[1].items.push({type:'mcpToolCall',tool:'invalid-fixture',status:'completed'});
    await assert.rejects(store(f).importThread(args(convertHistory(raw,meta))),/invalid batch/);assert.equal(f.entries.size,0);assert.equal(f.timeline.length,0);
  }finally{await f.harness.lifecycle.dispose();}
});
test('new archived history imports first then archives, repeat acknowledges without bind',async()=>{
  const f=fixture();try{
    const a={...args(convertHistory(rawHistory(),meta)),source:{...meta,archived:true}};
    await store(f).importThread(a);assert.deepEqual(f.archives,['thr_imported']);assert.equal(f.harness.inspection.sdk.callsTo('threads.experimental_bindExternalSession').length,0);
    const replay=await store(f).importThread({...a,history:convertHistory(rawHistory(),meta)});assert.equal(replay.skipped,1);assert.equal(f.calls[1].adoptThreadId,'thr_imported');
    assert.equal(f.timeline.length,1);assertNoModel(f.harness);
  }finally{await f.harness.lifecycle.dispose();}
});
test('legacy matching adoption preserves thread ID, source session and canonical source sequence/time',async()=>{
  for(const archived of [false,true]){
    const f=fixture({legacyThreads:[legacyThread('thr_legacy',archived)],events:{thr_legacy:rows()}});try{
      const s=store(f);await s.load([meta.id],['proj_import']);
      const result=await s.importThread({...args(convertHistory(rawHistory(),meta)),source:{...meta,archived}});
      assert.equal(result.threadId,'thr_legacy');assert.equal(f.timeline.length,0);assert.equal(f.calls[0].adoptThreadId,'thr_legacy');
      assert.deepEqual(f.calls[0].turns[0].items.map(i=>[i.existingSequence,i.existingCreatedAt]),[[2,1005],[3,1999]]);
      assert.equal(f.harness.inspection.sdk.callsTo('threads.experimental_bindExternalSession').length,0);assertNoModel(f.harness);
    }finally{await f.harness.lifecycle.dispose();}
  }
});
test('legacy ambiguity, mismatching content and invalid tool rows never create duplicates',async()=>{
  const scenarios=[
    {legacyThreads:[legacyThread('one'),legacyThread('two')],events:{one:rows(),two:rows()},reason:/Ambiguous/},
    {legacyThreads:[legacyThread()],events:{thr_legacy:rows('wrong')},reason:/source content differs/},
    {legacyThreads:[legacyThread()],events:{thr_legacy:[...rows().slice(0,2),{...rows()[2],data:{item:{type:'toolCall',tool:'x',error:null}}}]},reason:/Invalid legacy/},
  ];
  for(const options of scenarios){const f=fixture(options);try{const s=store(f);await s.load([meta.id],['proj_import']);await assert.rejects(s.importThread(args(convertHistory(rawHistory(),meta))),options.reason);assert.equal(f.calls.length,0);}finally{await f.harness.lifecycle.dispose();}}
});
test('public event pagination is capped at 100 and advances cursor',async()=>{
  const events=Array.from({length:201},(_,i)=>({seq:i+1,type:'thread/identity',data:{providerThreadId:meta.id},scope:{kind:'thread'},createdAt:i}));
  const f=fixture({events:{thr_legacy:events}});try{assert.equal((await store(f).events('thr_legacy')).length,201);assert.deepEqual(f.harness.inspection.sdk.callsTo('threads.events.list').map(c=>c[0].afterSeq),['0','100','200']);}finally{await f.harness.lifecycle.dispose();}
});
test('active turn, queued work and failed bind are reported without interruption',async()=>{
  for(const reason of ['active turn','queued BB work','inflight context mutation']){const f=fixture({conflict:reason});try{await assert.rejects(store(f).importThread(args(convertHistory(rawHistory(),meta))),new RegExp(reason));assertNoModel(f.harness);}finally{await f.harness.lifecycle.dispose();}}
  const f=fixture({bindConflict:'host/provider unavailable'});try{const r=await store(f).importThread(args(convertHistory(rawHistory(),meta)));assert.match(r.limitations.join(','),/continuation pending/);assert.equal(f.timeline.length,1);assertNoModel(f.harness);}finally{await f.harness.lifecycle.dispose();}
});
test('ensure failure leaves explicit passive history and unsupported items stay partial',async()=>{
  const f=fixture({noEnvironment:true,ensureConflict:'checkout owned or preparing'});try{const raw=rawHistory();raw.turns[0].items.push({type:'provider-extension'});const r=await store(f).importThread(args(convertHistory(raw,meta)));assert.match(r.limitations.join(','),/provider-extension/);assert.match(r.limitations.join(','),/checkout owned or preparing/);assert.equal(f.harness.inspection.sdk.callsTo('threads.experimental_bindExternalSession').length,0);}finally{await f.harness.lifecycle.dispose();}
});
test('uploads are cached before history mutation and retries preserve canonical attachment references',async()=>{
  const uploads=[];const f=fixture({uploads});const catalog={imageDataUrls:async()=>[],imageDataUrlsByPath:async()=>new Map(),relatedImageDataUrlsByPath:async()=>new Map()};
  try{const raw=rawHistory();raw.turns[0].items[0].content.push({type:'image',url:'data:image/png;base64,aGVsbG8='});
    let h=convertHistory(raw,meta);assert.equal((await attachHistory(f.bb,catalog,'proj_import',meta.id,h)).uploaded,1);await store(f).importThread(args(h));
    h=convertHistory(raw,meta);assert.equal((await attachHistory(f.bb,catalog,'proj_import',meta.id,h)).uploaded,0);const r=await store(f).importThread(args(h));assert.equal(r.skipped,1);assert.equal(uploads.length,1);assert.equal(f.calls[0].turns[0].items[0].item.attachments.length,1);
  }finally{await f.harness.lifecycle.dispose();}
});
test('unavailable/remote attachments produce stable reported placeholders, never unready raw paths',async()=>{
  const f=fixture();const catalog={imageDataUrls:async()=>[],imageDataUrlsByPath:async()=>new Map(),relatedImageDataUrlsByPath:async()=>new Map()};
  try{const raw=rawHistory();raw.turns[0].items[0].content.push({type:'image',url:'https://example.invalid/image.png'});for(let i=0;i<2;i++){const h=convertHistory(raw,meta);const result=await attachHistory(f.bb,catalog,'proj_import',meta.id,h);assert.equal(result.unresolved.length,1);assert.match(h.turns[0].items[0].item.text,/Attachment unavailable/);assert.equal(h.turns[0].items[0].item.attachments,undefined);}}finally{await f.harness.lifecycle.dispose();}
});
test('legacy attachment adoption verifies bytes through public read and reuses existing ownership',async()=>{
  const legacy=rows();legacy[1].data.input.push({type:'localImage',path:'attachments/legacy.png'});const f=fixture({legacyThreads:[legacyThread()],events:{thr_legacy:legacy},attachmentBytes:Buffer.from('hello')});
  const catalog={imageDataUrls:async()=>[],imageDataUrlsByPath:async()=>new Map(),relatedImageDataUrlsByPath:async()=>new Map()};
  try{const raw=rawHistory();raw.turns[0].items[0].content.push({type:'image',url:'data:image/png;base64,aGVsbG8='});const h=convertHistory(raw,meta);const s=store(f);await s.load([meta.id],['proj_import']);const references=await s.attachmentReferences(meta,h);await attachHistory(f.bb,catalog,'proj_import',meta.id,h,references);await s.importThread(args(h));assert.equal(f.harness.inspection.sdk.callsTo('projects.attachments.upload').length,0);assert.equal(f.calls[0].turns[0].items[0].item.attachments[0].path,'attachments/legacy.png');}finally{await f.harness.lifecycle.dispose();}
});
test('BB-owned source turns acknowledge requests/replies with source IDs and canonical times',async()=>{
  const events={thr_imported:[
    {seq:20,type:'client/turn/requested',scope:{kind:'thread'},createdAt:2200,data:{requestId:'bb-request',input:[{type:'text',text:'user 1'}]}},
    {seq:21,type:'turn/input/accepted',scope:{kind:'turn',turnId:'source-turn-1'},createdAt:2201,data:{clientRequestId:'bb-request'}},
    {seq:22,type:'item/completed',scope:{kind:'turn',turnId:'source-turn-1'},createdAt:2999,data:{item:{type:'agentMessage',id:'bb-reply',text:'assistant 1'}}},
  ]};
  const f=fixture({events});try{
    await store(f).importThread(args(convertHistory(rawHistory(),meta)));
    const result=await store(f).importThread(args(convertHistory(rawHistory(2),meta)));
    assert.equal(result.inserted,1);assert.equal(result.skipped,1);assert.equal(f.timeline.length,1);
    assert.deepEqual(f.calls[1].turns[1].items.map(i=>[i.existingSequence,i.existingCreatedAt]),[[20,2200],[22,2999]]);
    assert.equal(f.calls[1].turns[1].createdAt,2000);assertNoModel(f.harness);
  }finally{await f.harness.lifecycle.dispose();}
});
test('all later batches are prevalidated before the first history write',async()=>{
  const f=fixture();try{const h=convertHistory(rawHistory(251),meta);h.turns.at(-1).items[0].item.text='x'.repeat(128001);await assert.rejects(store(f).importThread(args(h)),/128000/);assert.equal(f.calls.length,0);assert.equal(f.timeline.length,0);}finally{await f.harness.lifecycle.dispose();}
});
test('ambiguous environments and teardown lifecycle never bind arbitrarily',async()=>{
  const f=fixture();try{f.harness.sdk.stub('environments.list',async()=>[{id:'one',lifecycle:{phase:'active',teardown:null}},{id:'two',lifecycle:{phase:'active',teardown:null}}]);const r=await store(f).importThread(args(convertHistory(rawHistory(),meta)));assert.match(r.limitations.join(','),/Several ready environments/);assert.equal(f.harness.inspection.sdk.callsTo('threads.experimental_bindExternalSession').length,0);}finally{await f.harness.lifecycle.dispose();}
  const g=fixture({ensureConflict:'checkout teardown in progress'});try{g.harness.sdk.stub('environments.list',async()=>[{id:'bad',lifecycle:{phase:'teardown',teardown:{status:'running'}}}]);const r=await store(g).importThread(args(convertHistory(rawHistory(),meta)));assert.match(r.limitations.join(','),/checkout teardown/);}finally{await g.harness.lifecycle.dispose();}
});
test('public SDK boundary and pinned SDK provenance',async()=>{
  const result=await experimental_scanPublicSdkOnly(process.cwd(),{allow:[/^@\//,/^react(?:-dom)?(?:\/|$)/,/^@get-bb\/plugin-sdk\/testing$/, /^@radix-ui\//,/^(class-variance-authority|clsx|tailwind-merge|better-sqlite3|zod)$/, /^node:/]});
  assert.deepEqual(result.violations,[]);assert.deepEqual(result.privateDependencies,[]);
  for(const path of ['server.ts','external-history.ts','history.ts','attachments.ts']){const text=readFileSync(path,'utf8');assert.doesNotMatch(text,/bb\.db|better-sqlite3|\.prepare\(|\bdb\.exec\(|@bb\/db|BbStore|repairImported|appendStoredThread/);}
  assert.equal(JSON.parse(readFileSync('node_modules/@get-bb/plugin-sdk/package.json')).version,'0.6.11');
  const manifest=JSON.parse(readFileSync('package.json'));assert.equal(manifest.engines.bbPluginSdk,'>=0.6.11 <0.7');assert.equal(manifest.devDependencies['@get-bb/plugin-sdk'],'file:vendor-sdk/get-bb-plugin-sdk-0.6.11.tgz');
  assert.equal(createHash('sha256').update(readFileSync('vendor-sdk/get-bb-plugin-sdk-0.6.11.tgz')).digest('hex'),'6202184def479b559065deb98d4c42dd57d21ed77875ec9a0e04509b83f5f53d');
});
test('legacy preview identifies invalid rows and unsettled or changed session claims without mutation',async()=>{
  const scenarios=[
    {legacyThreads:[{...legacyThread(),status:'active',queuedWork:'none'}],events:{thr_legacy:rows()},reason:/active, queued/},
    {legacyThreads:[legacyThread()],events:{thr_legacy:[...rows(),{seq:4,type:'thread/identity',scope:{kind:'thread'},createdAt:3000,data:{providerThreadId:'replacement'}}]},reason:/identity changed/},
    {legacyThreads:[legacyThread()],events:{thr_legacy:rows('changed')},reason:/content differs/},
  ];
  for(const options of scenarios){const f=fixture(options);try{const s=store(f);await s.load([meta.id],['proj_import']);await assert.rejects(s.diagnoseLegacy(meta,convertHistory(rawHistory(),meta)),options.reason);assert.equal(f.calls.length,0);}finally{await f.harness.lifecycle.dispose();}}
});

test('missing environment ensures the recorded local source once and binds original handle',async()=>{
  const f=fixture({noEnvironment:true});try{
    const a=await store(f).importThread(args(convertHistory(rawHistory(),meta)));
    const b=await store(f).importThread(args(convertHistory(rawHistory(),meta)));
    assert.deepEqual(a.limitations,[]);assert.equal(a.threadId,b.threadId);assert.equal(f.timeline.length,1);
    const calls=f.harness.inspection.sdk.callsTo('environments.experimental_ensureProjectCheckout');
    assert.equal(calls.length,1);assert.deepEqual(calls[0][0],{projectId:'proj_import',hostId:'host_source',expectedSourceId:'src_local',expectedSourcePath:meta.cwd});
    const bind=f.harness.inspection.sdk.callsTo('threads.experimental_bindExternalSession')[0][0];
    assert.equal(bind.environmentId,'env_ensured');assert.equal(bind.providerThreadId,meta.id);assert.equal(bind.expectedSessionId,meta.id);assert.equal(bind.expectedGeneration,0);assertNoModel(f.harness);
  }finally{await f.harness.lifecycle.dispose();}
});
test('existing ready environment and archived imports never provision another checkout',async()=>{
  for(const archived of [false,true]){const f=fixture();try{await store(f).importThread(args(convertHistory(rawHistory(),{...meta,archived})));assert.equal(f.harness.inspection.sdk.callsTo('environments.experimental_ensureProjectCheckout').length,0);assertNoModel(f.harness);}finally{await f.harness.lifecycle.dispose();}}
});
test('source admission and ensure CAS failures remain pending without binding or fallback',async()=>{
  const source={id:'source',type:'local_path',hostId:'host_source',path:meta.cwd};
  for(const options of [
    {sources:[],reason:/exactly one/},
    {sources:[source,{...source,id:'another'}],reason:/exactly one/},
    {sources:[{...source,hostId:'foreign'}],reason:/exactly one/},
    {sources:[{...source,path:'/changed'}],reason:/source path changed/},
    {ensureConflict:'source CAS changed',reason:/source CAS changed/},
    {ensureConflict:'host inspection failed',reason:/host inspection failed/},
    {ensureConflict:'SDK method unavailable on this server',reason:/SDK method unavailable/},
  ]){const f=fixture({noEnvironment:true,...options});try{const r=await store(f).importThread(args(convertHistory(rawHistory(),meta)));assert.match(r.limitations.join(','),options.reason);assert.equal(f.timeline.length,1);assert.equal(f.harness.inspection.sdk.callsTo('threads.experimental_bindExternalSession').length,0);assertNoModel(f.harness);}finally{await f.harness.lifecycle.dispose();}}
});
test('bind failure after ensure keeps passive binding and replay retries with same source CAS',async()=>{
  const f=fixture({noEnvironment:true,bindConflict:'environment acquired concurrently'});try{
    for(let i=0;i<2;i++){const r=await store(f).importThread(args(convertHistory(rawHistory(),meta)));assert.match(r.limitations.join(','),/continuation pending.*environment acquired/);}
    assert.equal(f.timeline.length,1);assert.equal([...f.bindings.values()][0].mode,'passive');
    const calls=f.harness.inspection.sdk.callsTo('environments.experimental_ensureProjectCheckout');assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assertNoModel(f.harness);
  }finally{await f.harness.lifecycle.dispose();}
});

test('ensure uses routed project source rather than original Codex worktree cwd',async()=>{
  const f=fixture({noEnvironment:true});try{
    const source={...meta,cwd:'/source/.codex/worktrees/abc/repo'};
    const r=await store(f).importThread({...args(convertHistory(rawHistory(),source)),source});
    assert.deepEqual(r.limitations,[]);
    const request=f.harness.inspection.sdk.callsTo('environments.experimental_ensureProjectCheckout')[0][0];
    assert.equal(request.expectedSourcePath,meta.cwd);assert.notEqual(request.expectedSourcePath,source.cwd);assertNoModel(f.harness);
  }finally{await f.harness.lifecycle.dispose();}
});
