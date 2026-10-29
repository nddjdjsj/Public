import test from 'node:test';
import assert from 'node:assert/strict';
import { SillyTavernAdapter, INTERCEPTOR, KEY, fingerprint } from '../adapters/sillytavern.js';
import { clone } from '../core/util.js';

class Bus {
    handlers = new Map();
    on(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn); }
    removeListener(name, fn) { this.handlers.get(name)?.delete(fn); }
    async emit(name, ...args) { for (const fn of [...(this.handlers.get(name) || [])]) await fn(...args); }
    count() { return [...this.handlers.values()].reduce((n, s) => n + s.size, 0); }
}
function fixture(overrides = {}) {
    const bus = new Bus(), prompts = {}, host = {}, saved = new Map();
    const types = Object.fromEntries(['CHAT_CHANGED','CHAT_CREATED','CHAT_LOADED','CHARACTER_EDITED','PERSONA_CHANGED','GENERATION_STARTED','MESSAGE_SENT','CHARACTER_MESSAGE_RENDERED','GENERATION_ENDED','GENERATION_STOPPED','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_DELETED','MESSAGE_SWIPED','MORE_MESSAGES_LOADED','CHAT_RENAMED'].map(k => [k, k]));
    const context = { characters: [{ avatar: 'alice.png', name: 'Alice', data: { extensions: {} } }, { avatar: 'beth.png', data: { extensions: {} } }], characterId: 0, chatId: 'a', name1: 'Player', chat: [], chatMetadata: {}, extensionSettings: {}, eventSource: bus, eventTypes: types,
        saveSettingsDebounced() {}, async saveMetadata() { saved.set(context.chatId, clone({ chat: context.chat, meta: context.chatMetadata })); },
        async writeExtensionField(id, key, value) { context.characters[id].data.extensions[key] = value; },
        setExtensionPrompt(key, text, ...args) { prompts[key] = { text, args }; },
        async getTokenCountAsync(text) { return Math.ceil(new TextEncoder().encode(text).length / 3); }, ...overrides };
    const adapter = new SillyTavernAdapter({ getContext: () => context, host });
    const emit = (name, ...args) => bus.emit(types[name], ...args);
    async function send(text = '我已经帮你完成了任务。', options = {}) {
        await emit('GENERATION_STARTED', 'normal', {}, false);
        context.chat.push({ name: context.name1, is_user: true, mes: text });
        await emit('MESSAGE_SENT', context.chat.length - 1);
        await host[INTERCEPTOR]([], 8000, () => {}, 'normal');
        const beforeReply = adapter.manager.state;
        context.chat.push({ name: 'Alice', is_user: false, mes: '谢谢你。', gen_finished: '2026-10-29T00:00:00Z' });
        if (options.endFirst) await emit('GENERATION_ENDED');
        await emit('CHARACTER_MESSAGE_RENDERED', context.chat.length - 1, 'normal');
        if (!options.endFirst) await emit('GENERATION_ENDED');
        return beforeReply;
    }
    return { adapter, bus, host, prompts, context, saved, emit, send };
}
test('candidate injected before response, commits only after final response and generation ended', async () => {
    const f = fixture(); await f.adapter.initialize();
    const candidate = await f.send();
    assert.equal(candidate.memories.length, 0);
    assert.equal(f.adapter.manager.state.memories.length, 1);
    assert.ok(f.adapter.manager.state.relationships['user:Player'].trust > 45);
    assert.ok(f.prompts[KEY].text.includes('角色心理状态'));
    assert.deepEqual(f.prompts[KEY].args, [1, 1, false, 0]);
    assert.equal(f.saved.size, 1);
});
test('streaming end-before-render order commits once; duplicate callbacks harmless', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send(undefined, { endFirst: true });
    const events = f.adapter.manager.export().events;
    await f.emit('CHARACTER_MESSAGE_RENDERED', 1, 'normal'); await f.emit('GENERATION_ENDED');
    assert.deepEqual(f.adapter.manager.export().events, events);
});
test('regenerate removes old receipt and recommits one source event without accumulation', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send();
    const original = f.adapter.manager.state.relationships['user:Player'];
    await f.emit('GENERATION_STARTED', 'regenerate', {}, false);
    f.context.chat.pop(); await f.emit('MESSAGE_DELETED', 1);
    assert.equal(f.adapter.manager.state.relationships['user:Player'], undefined);
    await f.host[INTERCEPTOR]([], 8000, () => {}, 'regenerate');
    f.context.chat.push({ name: 'Alice', is_user: false, mes: '再次谢谢。', gen_finished: '2026-10-29' });
    await f.emit('CHARACTER_MESSAGE_RENDERED', 1, 'normal'); await f.emit('GENERATION_ENDED');
    assert.deepEqual(f.adapter.manager.state.relationships['user:Player'], original);
    assert.equal(f.adapter.manager.state.memories.length, 1); assert.equal(f.adapter.manager.state.turn, 1);
});
test('swipe repeated or existing alternative does not accumulate player action', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send();
    const original = f.adapter.manager.state.relationships;
    const reply = f.context.chat[1]; reply.swipes = [reply.mes, '另一种回应']; reply.swipe_id = 1; reply.mes = reply.swipes[1];
    await f.emit('MESSAGE_SWIPED', 1); await f.emit('MESSAGE_SWIPED', 1);
    assert.deepEqual(f.adapter.manager.state.relationships, original);
    assert.equal(f.adapter.manager.state.memories.length, 1);
});
test('delete source rolls back effects; array-index shift preserves other stable source ids', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send(); await f.send('我为伤害你向你道歉。');
    const id = f.context.chat[2].extra[KEY].id;
    f.context.chat.splice(0, 2); await f.emit('MESSAGE_DELETED', 2);
    assert.equal(f.context.chat[0].extra[KEY].id, id);
    assert.equal(f.adapter.manager.state.memories.length, 1); assert.equal(f.adapter.manager.state.memories[0].type, 'apology');
});
test('edited player message replaces obsolete fact; ambiguous edit revokes original', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send();
    f.context.chat[0].mes = '我为伤害你向你道歉。'; await f.emit('MESSAGE_EDITED', 0); await f.emit('MESSAGE_UPDATED', 0);
    assert.deepEqual(f.adapter.manager.state.memories.map(m => m.type), ['apology']);
    f.context.chat[0].mes = '假设我背叛了你'; await f.emit('MESSAGE_UPDATED', 0);
    assert.equal(f.adapter.manager.state.memories.length, 0);
});
test('chat switching, branch cloning and character ownership stay isolated', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send(); const a = clone({ chat: f.context.chat, meta: f.context.chatMetadata });
    f.context.chatId = 'empty'; f.context.chat = []; f.context.chatMetadata = {}; await f.emit('CHAT_CHANGED');
    assert.equal(f.adapter.manager.state.memories.length, 0);
    f.context.chatId = 'branch'; f.context.chat = clone(a.chat); f.context.chatMetadata = clone(a.meta); await f.emit('CHAT_CHANGED');
    assert.equal(f.adapter.manager.state.memories.length, 1); await f.send('我为伤害你向你道歉。');
    assert.equal(f.adapter.manager.state.memories.length, 2);
    f.context.chatId = 'a'; f.context.chat = a.chat; f.context.chatMetadata = a.meta; await f.emit('CHAT_CHANGED');
    assert.equal(f.adapter.manager.state.memories.length, 1);
    f.context.characterId = 1; await f.emit('CHAT_CHANGED'); assert.equal(f.adapter.manager.state.memories.length, 0);
});
test('disable unregisters handlers and clears unique prompt; enable does not double-register', async () => {
    const f = fixture(); await f.adapter.initialize(); const count = f.bus.count(); await f.send();
    await f.adapter.updateConfig({ enabled: false }); assert.equal(f.bus.count(), 0); assert.equal(f.prompts[KEY].text, '');
    await f.host[INTERCEPTOR]([], 8000, () => {}, 'normal'); assert.equal(f.prompts[KEY].text, '');
    await f.adapter.updateConfig({ enabled: true }); await f.adapter.updateConfig({ debug: true }); assert.equal(f.bus.count(), count);
    f.adapter.destroy(); assert.equal(f.bus.count(), 0); assert.equal(f.host[INTERCEPTOR], undefined);
});
test('prompt switch disables injection while simulation still commits', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.adapter.updateConfig({ prompt: { enabled: false } });
    await f.send(); assert.equal(f.prompts[KEY].text, ''); assert.equal(f.adapter.manager.state.memories.length, 1);
});
test('persisted state reload rebuilds identically and excludes untrusted snapshots', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send(); const state = f.adapter.manager.state;
    const g = fixture({ chat: clone(f.context.chat), chatMetadata: clone(f.context.chatMetadata) }); await g.adapter.initialize();
    assert.deepEqual(g.adapter.manager.state, state);
});
test('missing APIs degrade safely and missing final lifecycle prevents automatic commit', async () => {
    const f = fixture({ eventTypes: { MESSAGE_SENT: 'MESSAGE_SENT' }, setExtensionPrompt: undefined }); await f.adapter.initialize();
    f.context.chat.push({ is_user: true, name: 'Player', mes: '我已经帮你完成了任务。' }); await f.adapter.prepare();
    f.context.chat.push({ is_user: false, mes: '谢谢', gen_finished: 'today' }); await f.adapter.rendered(1, 'normal');
    if (f.adapter.transaction) f.adapter.transaction.ended = true; await f.adapter.commitIfReady();
    assert.equal(f.adapter.manager.state.memories.length, 0);
    const absent = new SillyTavernAdapter({ getContext: () => ({}) }); await absent.initialize(); absent.destroy();
});
test('stop/error/partial response never commits; assistant inventions never become facts', async () => {
    const f = fixture(); await f.adapter.initialize();
    f.context.chat.push({ name: 'Player', is_user: true, mes: '你好' });
    await f.adapter.prepare(); f.context.chat.push({ name: 'Alice', is_user: false, mes: '我承认我欺骗了你' });
    await f.emit('CHARACTER_MESSAGE_RENDERED', 1, 'normal'); await f.emit('GENERATION_ENDED'); assert.equal(f.adapter.manager.state.memories.length, 0);
    await f.emit('GENERATION_STOPPED'); f.context.chat[0].mes = '我已经帮你完成了任务。'; await f.adapter.prepare();
    await f.emit('GENERATION_STOPPED'); f.context.chat[1].gen_finished = 'today'; await f.emit('CHARACTER_MESSAGE_RENDERED', 1, 'normal'); await f.emit('GENERATION_ENDED');
    assert.equal(f.adapter.manager.state.memories.length, 0);
});
test('LLM in-flight chat switch discards late result and does not pollute new metadata', async () => {
    let complete; const f = fixture({ generateRaw: () => new Promise(r => { complete = r; }) }); await f.adapter.initialize();
    await f.adapter.updateConfig({ event_extraction: { mode: 'llm' } });
    f.context.chat.push({ is_user: true, name: 'Player', mes: '我已经帮你完成了任务。' }); const job = f.adapter.prepare();
    await new Promise(r => setTimeout(r, 5));
    f.context.chatId = 'b'; f.context.chat = []; f.context.chatMetadata = {}; await f.emit('CHAT_CHANGED');
    complete('{"events":[]}'); await job;
    assert.equal(f.adapter.manager.state.memories.length, 0); assert.equal(f.prompts[KEY].text, ''); assert.equal(f.context.chatMetadata[KEY], undefined);
});
test('model mode call cache prevents additional calls on regeneration', async () => {
    let calls = 0; const f = fixture({ generateRaw: async () => { calls++; return '{"events":[]}'; } }); await f.adapter.initialize();
    await f.adapter.updateConfig({ event_extraction: { mode: 'llm' } });
    await f.send(); await f.adapter.prepare('regenerate'); await f.adapter.prepare('regenerate'); assert.equal(calls, 1);
});
test('high impact requires explicit confirmation and manual controls are reversible', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send('我承认我没有遵守我们的约定。');
    assert.equal(f.adapter.manager.state.relationships['user:Player'], undefined);
    const memory = f.adapter.manager.state.memories[0]; assert.equal(memory.pending_confirmation, true);
    await f.adapter.confirmEvent(memory.id); assert.ok(f.adapter.manager.state.relationships['user:Player'].trust < 45);
    await f.adapter.revokeEvent(memory.id); assert.equal(f.adapter.manager.state.relationships['user:Player'], undefined);
    await f.adapter.setStoryTime(20); assert.equal(f.adapter.manager.state.story_time, 20);
});
test('personas are separate relation subjects, group chats safely decline injection', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send(); f.context.name1 = 'Other'; await f.send();
    assert.ok(f.adapter.manager.state.relationships['user:Player']); assert.ok(f.adapter.manager.state.relationships['user:Other']);
    f.context.groupId = 'group'; await f.emit('CHAT_CHANGED'); await f.adapter.prepare(); assert.equal(f.adapter.manager, null); assert.equal(f.prompts[KEY].text, '');
});
test('unsafe backup rejected atomically, source ids stable and long fingerprints distinguish edits', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send(); const before = f.adapter.manager.state;
    await assert.rejects(f.adapter.importData('{"__proto__":{}}')); assert.deepEqual(f.adapter.manager.state, before);
    const data = f.adapter.exportData(); data.owner_avatar = 'other'; await assert.rejects(f.adapter.importData(JSON.stringify(data)));
    assert.notEqual(fingerprint('same'), fingerprint('same!')); assert.equal(fingerprint('same'), fingerprint('same'));
    const extra = f.context.chat[0].extra[KEY].id; await f.adapter.loadChat(); assert.equal(f.context.chat[0].extra[KEY].id, extra);
});
test('compiled behavior is recomputed for source speaker instead of carrying a previous strategy', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send();
    const state = f.adapter.manager.state, source = f.adapter.previousUser();
    state.policies.selected = 'withdraw'; const first = await f.adapter.compile(state, source);
    state.policies.selected = 'engage'; const second = await f.adapter.compile(state, source);
    assert.equal(first.text, second.text);
});
test('messages cloned with another message extra get new UUIDs at runtime', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send();
    const original = f.context.chat[0].extra[KEY].id;
    f.context.chat.push(clone(f.context.chat[0])); await f.emit('MESSAGE_SENT',2);
    assert.notEqual(f.context.chat[2].extra[KEY].id,original);
    assert.equal(f.context.chat[0].extra[KEY].id,original);
});
