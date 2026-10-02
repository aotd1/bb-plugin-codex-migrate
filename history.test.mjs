import test from 'node:test';
import assert from 'node:assert/strict';
import {convertHistory} from './.tmp-test/history.js';
import {validateHistory,batches} from './.tmp-test/external-history.js';
import {formatTitle} from './.tmp-test/titles.js';
import {meta,rawHistory} from './test-fixtures.mjs';

test('semantic whole turns retain all supported items, source times and stable IDs',()=>{
  const raw=rawHistory();raw.turns[0].items.push(
    {type:'plan',text:'plan'}, {type:'reasoning',summary:['summary'],content:['detail']},
    {type:'mcpToolCall',tool:'read',server:'files',arguments:{path:'x'},result:{ok:true},error:null,status:'completed'},
    {type:'functionCallOutput',name:'other',output:'done'},
    {type:'commandExecution',command:'pwd',cwd:'/source',aggregatedOutput:'/source',exitCode:0,status:'completed'},
    {type:'fileChange',status:'completed',changes:[{path:'x',kind:{type:'update'},diff:'diff'}]});
  const a=convertHistory(raw,meta),b=convertHistory(raw,meta);assert.deepEqual(a,b);validateHistory(a.turns);
  assert.deepEqual(a.turns[0].items.map(e=>e.item.type),['user','assistant','plan','reasoning','tool','tool','command','fileChange']);
  assert.equal(a.turns[0].createdAt,1000);assert.equal(a.turns[0].completedAt,2000);assert.equal(a.turns[0].order,0);
  assert.equal(Object.hasOwn(a.turns[0].items[4].item,'error'),false);
  assert.deepEqual(a.turns[0].items[3].item.content,['detail']);
});
test('unsupported extensions, compaction, images, approvals and unfinished turns are explicit',()=>{
  const raw=rawHistory();raw.turns[0].items.push({type:'contextCompaction'},{type:'webSearch'},{type:'imageView'},{type:'approval'});
  raw.turns.push({id:'live',status:'inProgress',items:[{type:'agentMessage',text:'partial'}]});
  const h=convertHistory(raw,meta);assert.equal(h.turns.length,1);assert.equal(h.unsupported.length,5);assert.match(h.unsupported.join(','),/unfinished/);
});
test('no whole turn splitting, text truncation or duplicate ID rewriting',()=>{
  const raw=rawHistory();raw.turns[0].items=Array.from({length:101},()=>({type:'agentMessage',text:'x'}));
  assert.throws(()=>convertHistory(raw,meta),/100 items/);
  const duplicated=rawHistory();duplicated.turns.push(duplicated.turns[0]);assert.throws(()=>convertHistory(duplicated,meta),/Duplicate/);
  const huge=convertHistory(rawHistory(),meta);huge.turns[0].items[0].item.text='x'.repeat(128001);assert.throws(()=>validateHistory(huge.turns),/128000/);
});
test('batch boundaries count terminal items and UTF8 JSON, retaining whole turns',()=>{
  const history=convertHistory(rawHistory(251),meta);
  const base={projectId:'p',sourceId:'s',conversationId:'c',sessionId:'c',providerId:'codex',generation:0};
  const parts=batches(base,history.turns,'codex-migrate');assert.deepEqual(parts.map(b=>b.turns.length),[250,1]);
  for(const b of parts)assert.ok(Buffer.byteLength(JSON.stringify({...b,pluginId:'codex-migrate'}))<=1024*1024);
  const turn={...history.turns[0],items:Array.from({length:10},()=>({createdAt:1000,item:{type:'assistant',text:'😀'.repeat(60000)}}))};
  assert.throws(()=>batches(base,[turn],'codex-migrate'),/1 MiB/);
});
test('item/source time and order invariants reject invalid input',()=>{
  const raw=rawHistory();raw.turns[0].completedAt=0;assert.throws(()=>convertHistory(raw,meta),/precedes/);
  const h=convertHistory(rawHistory(2),meta);h.turns[1].order=0;assert.throws(()=>validateHistory(h.turns),/unique/);
  assert.throws(()=>convertHistory({...rawHistory(),id:'wrong'},meta),/identity/);
});
test('title truncation retains Unicode',()=>{assert.equal(formatTitle('😀'.repeat(40),'truncate',30),'😀'.repeat(29)+'…');assert.equal(formatTitle(' A\n B ','original',80),'A\n B');});
test('unfinished tool item defers the entire turn and later append orders',()=>{
  const raw=rawHistory(2);raw.turns[0].items.push({type:'mcpToolCall',tool:'pending',status:'inProgress'});
  const history=convertHistory(raw,meta);assert.equal(history.turns.length,0);assert.match(history.unsupported.join(','),/whole turn and later turns deferred/);
});
