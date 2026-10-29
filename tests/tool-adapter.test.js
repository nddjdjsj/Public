import test from 'node:test';
import assert from 'node:assert/strict';
import { SillyTavernAdapter, INTERCEPTOR, KEY } from '../adapters/sillytavern.js';
import { clone } from '../core/util.js';

function fixture() {
    const tools = new Map(), callbacks = new Map(), host = {}, registered = [];
    const names = ['CHAT_CHANGED','GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_SENT','CHARACTER_MESSAGE_RENDERED','MESSAGE_DELETED','MESSAGE_UPDATED','TOOL_CALLS_PERFORMED'];
    const c = { characters: [{ avatar:'alice.png',data:{extensions:{}} }],characterId:0,chatId:'a',name1:'Player',chat:[],chatMetadata:{},extensionSettings:{},
        eventTypes:Object.fromEntries(names.map(n=>[n,n])),eventSource:{on(n,fn){if(!callbacks.has(n))callbacks.set(n,new Set());callbacks.get(n).add(fn);},removeListener(n,fn){callbacks.get(n)?.delete(fn);}},
        setExtensionPrompt(){},async saveMetadata(){},saveSettingsDebounced(){},isToolCallingSupported(){return true;},
        registerFunctionTool(tool){assert.ok(!tools.has(tool.name),'duplicate registry entry');tools.set(tool.name,tool);registered.push(tool.name);},unregisterFunctionTool(name){tools.delete(name);},
        async getTokenCountAsync(text){return Math.ceil(new TextEncoder().encode(text).length/3);},
    };
    const a = new SillyTavernAdapter({getContext:()=>c,host});
    async function emit(n,...args){for(const fn of [...(callbacks.get(n)||[])])await fn(...args);}
    async function start(text='我已经帮你完成了任务。谢谢你。') {
        await emit('GENERATION_STARTED','normal',{},false);c.chat.push({is_user:true,name:'Player',mes:text});await emit('MESSAGE_SENT',c.chat.length-1);await host[INTERCEPTOR]([],8000,()=>{},'normal');
    }
    async function finish(text='谢谢，我记得这件事。') {c.chat.push({is_user:false,name:'Alice',mes:text,gen_finished:'complete'});await emit('GENERATION_ENDED');await emit('CHARACTER_MESSAGE_RENDERED',c.chat.length-1,'normal');}
    const call = async(name,args={})=>JSON.parse(await tools.get(name).action(args));
    return {a,c,tools,registered,host,emit,start,finish,call};
}
const help = {type:'help',intensity:.45,confidence:.96,evidence:'我已经帮你完成了任务。'};

test('actual adapter registers four native tools with visible automatic discovery and unregisters on disable',async()=>{
    const f=fixture();await f.a.initialize();assert.equal(f.tools.size,4);assert.ok([...f.tools.values()].every(t=>t.shouldRegister()===true && t.stealth===false));
    await f.a.updateConfig({tools:{allow_event_proposals:false}});assert.equal(f.tools.size,3);assert.ok(!f.tools.has('psyche_record_event'));
    await f.a.updateConfig({tools:{allow_event_proposals:true}});assert.equal(f.tools.size,4);
    const stale=f.tools.get('psyche_get_state');await f.a.updateConfig({enabled:false});assert.equal(f.tools.size,0);assert.equal(JSON.parse(await stale.action({})).ok,false);
    await f.a.updateConfig({enabled:true});assert.equal(f.tools.size,4);const staleAfterDestroy=f.tools.get('psyche_get_state');f.a.destroy();assert.equal(f.tools.size,0);assert.equal(JSON.parse(await staleAfterDestroy.action({})).ok,false);
});
test('unsupported connection keeps native tools undiscoverable and cannot invoke actions',async()=>{
    const f=fixture();f.c.isToolCallingSupported=()=>false;await f.a.initialize();assert.equal(f.tools.size,4);assert.ok([...f.tools.values()].every(t=>t.shouldRegister()===false));
    assert.equal((await f.call('psyche_get_state')).ok,false);assert.equal(f.a.capabilities().tool_calling,false);
});
test('tool proposal survives real-style recursive generation and commits exactly once after final response',async()=>{
    const f=fixture();await f.a.initialize();await f.start();assert.equal(f.a.transaction.events.length,0);
    f.c.chat.push({is_user:false,name:'Alice',mes:'让我回想一下。',gen_finished:'intermediate'});await f.emit('CHARACTER_MESSAGE_RENDERED',1,'normal');
    const result=await f.call('psyche_record_event',help);assert.equal(result.ok,true);assert.equal(result.result.accepted,true);assert.equal(f.a.manager.state.memories.length,0);
    const id=result.result.event_id;f.c.chat.push({is_user:false,is_system:true,mes:'tool',extra:{tool_invocations:[{name:'psyche_record_event'}]}});await f.emit('TOOL_CALLS_PERFORMED',[]);
    assert.equal(f.c.chat[1].extra[KEY].tool_intermediate,true);
    await f.emit('GENERATION_STARTED','normal',{},false);await f.host[INTERCEPTOR]([],8000,()=>{},'normal');
    assert.equal(f.a.transaction.events[0].id,id);assert.equal(f.a.transaction.tool_calls,1);assert.equal(f.a.manager.state.memories.length,0);
    await f.finish();assert.equal(f.a.manager.state.memories.length,1);assert.ok(f.a.manager.state.relationships['user:Player'].trust>45);
    await f.emit('GENERATION_ENDED');await f.emit('CHARACTER_MESSAGE_RENDERED',3,'normal');assert.equal(f.a.manager.state.memories.length,1);assert.equal(f.a.manager.state.turn,1);
});
for(const placeholder of ['', '...'])test(`tool placeholder cleanup ${JSON.stringify(placeholder)} preserves transaction before tool action`,async()=>{
    const f=fixture();await f.a.initialize();await f.start();const source=f.a.transaction.source.id;
    f.c.chat.push({is_user:false,name:'Alice',mes:placeholder,gen_finished:'intermediate'});await f.emit('CHARACTER_MESSAGE_RENDERED',1,'normal');
    f.c.chat.pop();await f.emit('MESSAGE_DELETED',1);assert.equal(f.a.transaction.source.id,source);
    assert.equal((await f.call('psyche_record_event',help)).result.accepted,true);await f.finish();assert.equal(f.a.manager.state.memories.length,1);
});
test('rules and model tool cannot double count the same source action or override its intensity',async()=>{
    const f=fixture();await f.a.initialize();await f.start('我已经帮你完成了任务。');const original=clone(f.a.transaction.events);
    assert.equal((await f.call('psyche_record_event',help)).result.status,'already_staged');assert.deepEqual(f.a.transaction.events,original);
    assert.equal((await f.call('psyche_record_event',{...help,evidence:'帮你完成了任务'})).result.status,'already_staged');await f.finish();assert.equal(f.a.manager.state.memories.length,1);
});
test('tools reject hallucinated evidence and hypotheticals and cannot edit personality or arbitrary numeric state',async()=>{
    const f=fixture();await f.a.initialize();await f.start();
    assert.equal((await f.call('psyche_record_event',{...help,evidence:'没有出现过的原文证据'})).result.accepted,false);
    assert.equal((await f.call('psyche_record_event',{...help,trust:100})).ok,false);assert.equal(f.a.transaction.events.length,0);
    f.c.chat[0].mes='假设我已经帮你完成了任务。';await f.emit('MESSAGE_UPDATED',0);await f.a.prepare();
    const denied=await f.call('psyche_record_event',help);assert.equal(denied.result?.accepted??false,false);assert.equal(f.a.manager.state.memories.length,0);
});
test('high-impact tool events wait for user confirmation after committing the candidate',async()=>{
    const f=fixture();await f.a.initialize();await f.start('我承认我没有遵守我们的约定。对此我想解释。');
    const r=await f.call('psyche_record_event',{type:'promise_broken',intensity:.65,confidence:.96,evidence:'我承认我没有遵守我们的约定。'});
    assert.equal(r.result.requires_confirmation,true);await f.finish();assert.equal(f.a.manager.state.memories[0].pending_confirmation,true);assert.equal(f.a.manager.state.relationships['user:Player'],undefined);
});
test('tool call budget survives continuation and stops and scope switches discard proposals',async()=>{
    const f=fixture();await f.a.initialize();await f.a.updateConfig({tools:{max_calls_per_turn:1}});await f.start();assert.equal((await f.call('psyche_record_event',help)).ok,true);
    await f.emit('TOOL_CALLS_PERFORMED',[]);await f.emit('GENERATION_STARTED','normal',{},false);await f.host[INTERCEPTOR]([],8000,()=>{},'normal');assert.equal((await f.call('psyche_get_state')).ok,false);
    await f.emit('GENERATION_STOPPED');await f.finish();assert.equal(f.a.manager.state.memories.length,0);
    await f.start();await f.call('psyche_record_event',help);f.c.chatId='b';f.c.chat=[];f.c.chatMetadata={};await f.emit('CHAT_CHANGED');assert.equal(f.a.transaction,null);assert.equal(f.a.manager.state.memories.length,0);
});
test('source deletion rolls back staged actions and tool reads remain read-only',async()=>{
    const f=fixture();await f.a.initialize();await f.start();const original=clone(f.a.manager.export());
    assert.equal((await f.call('psyche_get_state')).result.status,'candidate_pending_final_reply');assert.equal((await f.call('psyche_get_behavior')).ok,true);assert.equal((await f.call('psyche_recall',{query:'任务'})).ok,true);
    assert.deepEqual(f.a.manager.export(),original);await f.call('psyche_record_event',help);f.c.chat=[];await f.emit('MESSAGE_DELETED',0);assert.equal(f.a.transaction,null);assert.equal(f.a.manager.state.memories.length,0);
});
test('model cannot restore manually revoked source event or read another persona memories',async()=>{
    const f=fixture();await f.a.initialize();await f.start();const r=await f.call('psyche_record_event',help);await f.finish();await f.a.revokeEvent(r.result.event_id);
    await f.a.prepare();assert.equal((await f.call('psyche_record_event',help)).result.status,'manually_revoked');
    f.c.name1='Other';await f.start('你好。');const memories=await f.call('psyche_recall',{query:'任务'});assert.deepEqual(memories.result.memories,[]);
});
test('regeneration reuses a validated tool fact even when the new model response does not call tools again',async()=>{
    const f=fixture();await f.a.initialize();await f.start();const staged=await f.call('psyche_record_event',help);await f.finish();const before=f.a.manager.state.relationships;
    await f.emit('GENERATION_STARTED','regenerate',{},false);f.c.chat.pop();await f.emit('MESSAGE_DELETED',1);assert.equal(f.a.manager.state.memories.length,0);
    await f.host[INTERCEPTOR]([],8000,()=>{},'regenerate');assert.equal(f.a.transaction.events[0].id,staged.result.event_id);await f.finish();assert.deepEqual(f.a.manager.state.relationships,before);assert.equal(f.a.manager.state.memories.length,1);
});
for(const action of ['keep','revoke','correct'])test(`automatic extraction honors committed tool event across paths: ${action}`,async()=>{
    const f=fixture();f.c.generateRaw=async()=>'{"events":[]}';await f.a.initialize();await f.a.updateConfig({event_extraction:{mode:'llm'}});await f.start('我已经帮你完成了任务。');
    assert.equal(f.a.transaction.events.length,0);const staged=await f.call('psyche_record_event',help);assert.ok(staged.result.event_id.startsWith('tool_'));await f.finish();const before=f.a.manager.state.relationships;
    if(action==='revoke')await f.a.revokeEvent(staged.result.event_id);
    if(action==='correct')await f.a.correctEvent(staged.result.event_id,{type:'apology'});
    await f.a.updateConfig({event_extraction:{mode:'rules'}});await f.a.prepare();await f.finish();
    if(action==='keep'){assert.equal(f.a.manager.state.memories.length,1);assert.deepEqual(f.a.manager.state.relationships,before);}
    if(action==='revoke')assert.equal(f.a.manager.state.memories.length,0);
    if(action==='correct')assert.deepEqual(f.a.manager.state.memories.map(m=>m.type),['apology']);
});
