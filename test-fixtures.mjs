import assert from 'node:assert/strict';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import { fingerprint } from './.tmp-test/external-history.js';
export const meta = { id:'session-a', title:'Source title', fallbackTitle:'', cwd:'/source/repo', projectId:'source-project', archived:false, archivedAt:null, createdAtMs:1000, updatedAtMs:5000, model:'model-source',reasoningEffort:'high',source:'cli' };
export function rawHistory(count=1) {
  return {id:meta.id,turns:Array.from({length:count},(_,i)=>({id:`source-turn-${i}`,startedAt:i+1,completedAt:i+2,status:'completed',items:[{type:'userMessage',id:`u-${i}`,content:[{type:'text',text:`user ${i}`}]},{type:'agentMessage',id:`a-${i}`,text:`assistant ${i}`}]}))};
}
export function fixture(options={}) {
  const generatedEvents=[];
  const bindings = new Map(); const entries = new Map(); const timeline=[]; const archives=[]; const calls=[];
  const key = q=>JSON.stringify([q.projectId,q.sourceId,q.conversationId]);
  let lost=options.loseResponseAt ?? 0; let call=0;
  const threads={
    list:async q=>(options.legacyThreads ?? []).filter(t=>Boolean(t.archivedAt)===Boolean(q.archived)).slice(q.offset,q.offset+q.limit),
    events:{list:async q=>{
      assert.equal(q.limit,'100');
      const rows=options.events?.[q.threadId]??generatedEvents;
      return rows.filter(row=>row.seq>Number(q.afterSeq??0)&&(!q.types||q.types.includes(row.type))).slice(0,100);
    }},
    experimental_findExternalThread:async q=>({binding:bindings.get(key(q))??null}),
    experimental_importHistory:async q=>{
      calls.push(structuredClone(q));
      if(options.conflict)throw Error(options.conflict);
      // Fixture server: stage the entire batch before committing immutable IDs.
      const k=key(q); const prior=bindings.get(k); const staged=new Map(entries.get(k)??[]);
      let last=prior?.lastOrder??null;let inserted=0,skipped=0;
      for(const t of q.turns??[]){
        const digest=fingerprint({...t,items:t.items.map(({item,createdAt})=>({item,createdAt}))});
        if(staged.has(t.id)){assert.equal(staged.get(t.id),digest);skipped++;continue;}
        if(last!==null&&t.order<=last)throw Error('external_history_conflict: backfill');
        if(t.items.some(i=>i.item.type==='tool'&&i.item.name==='invalid-fixture'))throw Error('invalid batch');
        staged.set(t.id,digest);last=t.order;inserted++;
      }
      const threadId=prior?.threadId??q.adoptThreadId??'thr_imported';
      const binding={threadId,providerId:q.providerId,sessionId:q.sessionId,generation:q.generation,lastOrder:last,mode:q.adoptThreadId?'interactive':'passive',runtimeProviderId:q.adoptThreadId?'codex':'external-history',runtimeProviderThreadId:q.adoptThreadId?q.sessionId:null,environmentId:q.adoptThreadId?'env_original':null,archived:options.legacyThreads?.find(t=>t.id===threadId)?.archivedAt!=null};
      bindings.set(k,prior?{...prior,lastOrder:last}:binding);entries.set(k,staged);
      for (const t of (q.turns??[]).filter(t=>!(prior&&t.order<=(prior.lastOrder??-1)))) {
        if (q.adoptThreadId || t.items.every(i=>i.existingSequence!==undefined)) continue;
        timeline.push(t);
        for (const entry of t.items) {
          const item=entry.item.type==='user'?{type:'userMessage',id:'u',content:[...(entry.item.text?[{type:'text',text:entry.item.text}]:[]),...(entry.item.attachments??[])]}:{type:'agentMessage',id:'a',text:entry.item.text};
          generatedEvents.push({seq:generatedEvents.length+1,type:'item/completed',scope:{kind:'turn',turnId:'external_fixture'},createdAt:entry.createdAt,data:{item}});
        }
      }
      call++;
      if(call===lost){lost=0;throw Error('response lost after commit');}
      return {threadId,created:!prior,inserted,skipped,generation:q.generation,lastOrder:last};
    },
    experimental_bindExternalSession:async q=>{
      if(options.bindConflict)throw Error(options.bindConflict);
      const binding=[...bindings.values()].find(b=>b.threadId===q.threadId);
      assert.ok(binding);assert.equal(q.providerThreadId,meta.id);assert.equal(q.expectedSessionId,meta.id);
      Object.assign(binding,{mode:'interactive',runtimeProviderId:q.providerId,runtimeProviderThreadId:q.providerThreadId,environmentId:q.environmentId});
      return {threadId:q.threadId,changed:true,mode:'interactive'};
    },
    experimental_releaseExternalSession:async q=>{if(options.releaseConflict)throw Error(options.releaseConflict);return {threadId:q.threadId,changed:true,mode:'passive'};},
    archive:async q=>{archives.push(q.threadId);const binding=[...bindings.values()].find(b=>b.threadId===q.threadId);binding.archived=true;return makeThreadResponse({id:q.threadId,archivedAt:123});},
  };
  const {bb,harness}=createFakePluginHost({pluginId:'codex-migrate',sdk:{
    threads,
    system:{config:async()=>({primaryHostId:'host_source'})},
    projects:{list:async()=>options.projects??[],create:async q=>({id:'proj_import',name:q.name,sources:[{hostId:q.source.hostId,path:q.source.path,isDefault:true}]}),attachments:{upload:async q=>({type:'localImage',path:`attachments/upload-${options.uploads?.push(q)??1}.png`}),read:async()=>({bytes:options.attachmentBytes??new Uint8Array(),mimeType:'image/png',sizeBytes:0})}},
    environments:{list:async()=>options.noEnvironment?[]:[{id:'env_ready',projectId:'proj_import',hostId:'host_source',path:meta.cwd,status:'ready',lifecycle:{phase:'active',teardown:null}}],get:async q=>({id:q.environmentId,projectId:'proj_import',hostId:'host_source',status:'ready',lifecycle:{phase:'active',teardown:null}})},
  }});
  return {bb,harness,bindings,entries,timeline,archives,calls};
}
export const args = history=>({projectId:'proj_import',projectRoot:meta.cwd,source:meta,history,titleMode:'original',titleMaxLength:80});
export function assertNoModel(harness){
  for(const method of ['threads.spawn','threads.send','threads.queuedMessages.create','threads.interrupt','threads.restoreEnvironment'])assert.equal(harness.inspection.sdk.callsTo(method).length,0,method);
}
