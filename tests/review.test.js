import test from 'node:test';
import assert from 'node:assert/strict';
import { SillyTavernAdapter, KEY, INTERCEPTOR } from '../adapters/sillytavern.js';
import { clone } from '../core/util.js';

function fixture(overrides = {}) {
    const callbacks = new Map(), prompts = {}, host = {};
    const eventSource = {
        on(key, fn) { if (!callbacks.has(key)) callbacks.set(key, new Set()); callbacks.get(key).add(fn); },
        removeListener(key, fn) { callbacks.get(key)?.delete(fn); },
    };
    const names = ['CHAT_CHANGED', 'GENERATION_STARTED', 'CHARACTER_MESSAGE_RENDERED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_SENT', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'PERSONA_CHANGED'];
    const context = {
        characters: [{ avatar: 'alice.png', data: { extensions: {} } }], characterId: 0, chatId: 'a', name1: 'Player',
        chat: [], chatMetadata: {}, extensionSettings: {}, eventTypes: Object.fromEntries(names.map(name => [name, name])), eventSource,
        saveSettingsDebounced() {}, async saveMetadata() {},
        async writeExtensionField(id, key, value) { context.characters[id].data.extensions[key] = clone(value); },
        setExtensionPrompt(key, text) { prompts[key] = text; },
        async getTokenCountAsync(text) { return Math.ceil(new TextEncoder().encode(text).length / 3); },
        ...overrides,
    };
    const adapter = new SillyTavernAdapter({ getContext: () => context, host });
    async function emit(name, ...args) { for (const fn of [...(callbacks.get(name) || [])]) await fn(...args); }
    async function send(text = '我已经帮你完成了任务。', avatar = undefined) {
        await emit('GENERATION_STARTED', 'normal', {}, false);
        context.chat.push({ name: context.name1, is_user: true, mes: text, ...(avatar ? { force_avatar: avatar } : {}) });
        await emit('MESSAGE_SENT', context.chat.length - 1);
        await host[INTERCEPTOR]([], 4000, () => {}, 'normal');
        context.chat.push({ name: 'Alice', is_user: false, mes: '谢谢。', gen_finished: 'complete' });
        await emit('CHARACTER_MESSAGE_RENDERED', context.chat.length - 1, 'normal');
        await emit('GENERATION_ENDED');
    }
    return { adapter, context, prompts, send, emit, host };
}

test('same-name personas with distinct locked avatars have independent relationships', async () => {
    const f = fixture(); await f.adapter.initialize();
    await f.send(undefined, '/thumbnail?type=persona&file=one.png');
    const [first] = Object.keys(f.adapter.manager.state.relationships);
    await f.send(undefined, '/thumbnail?type=persona&file=two.png');
    const keys = Object.keys(f.adapter.manager.state.relationships);
    assert.equal(keys.length, 2); assert.ok(keys.every(key => key.startsWith('persona:')));
    assert.equal(f.adapter.manager.state.relationships[first].history.length, 1);
    f.context.name1 = 'A new display name';
    await f.send(undefined, '/thumbnail?type=persona&file=one.png');
    assert.equal(Object.keys(f.adapter.manager.state.relationships).length, 2);
    assert.equal(f.adapter.manager.state.relationships[first].history.length, 2);
});

test('prompt uses source speaker identity even when current persona name has changed', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send();
    const state = f.adapter.manager.state;
    state.relationships['user:Player'].trust = 10;
    state.relationships['user:Other'] = { trust: 90, closeness: 20, conflict: 0 };
    f.context.name1 = 'Other';
    const result = await f.adapter.compile(state, f.adapter.record(0));
    assert.match(result.text, /信任谨慎/); assert.doesNotMatch(result.text, /较为信任/);
});

test('locked persona avatar changes invalidate existing source revisions', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send(undefined, '/persona/one');
    const first = f.adapter.record(0);
    f.context.chat[0].force_avatar = '/persona/two';
    const second = f.adapter.record(0);
    assert.equal(second.id, first.id); assert.notEqual(second.revision, first.revision);
});

test('corrupt recovery data and debug content do not follow a chat switch', async () => {
    const f = fixture({ chatMetadata: { [KEY]: { owner_avatar: 'alice.png', manager: { version: 99, events: [] } } } });
    await f.adapter.initialize(); assert.ok(f.adapter.exportData().recovery_backup);
    f.adapter.debug.extraction = { evidence: 'PRIVATE OLD CHAT' };
    f.context.chatId = 'b'; f.context.chat = []; f.context.chatMetadata = {}; await f.adapter.loadChat();
    assert.equal(f.adapter.exportData().recovery_backup, null);
    assert.doesNotMatch(JSON.stringify(f.adapter.debug), /PRIVATE OLD CHAT/);
    await f.send(); assert.equal(f.context.chatMetadata[KEY].recovery_backup, undefined);
});

test('import personality persists the validated profile to the character card', async () => {
    const f = fixture(); await f.adapter.initialize();
    await f.adapter.importPersonality('{"baseline":{"E":0.12,"A":0.9},"source":"manual"}', 'json');
    assert.equal(f.context.characters[0].data.extensions[KEY].baseline.E, 0.12);
    assert.equal(f.adapter.personality.baseline.E, 0.12);
});

test('reset emotion without PAD restores the personality baseline', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send();
    await f.adapter.resetEmotion({ pleasure: -0.8, arousal: 0.9, dominance: -0.5 });
    await f.adapter.resetEmotion();
    assert.deepEqual(f.adapter.manager.state.emotion.current, f.adapter.manager.state.emotion.baseline);
});

test('reset chat removes event copies from last-valid and quarantine backups', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send(); await f.send('我为伤害你向你道歉。');
    assert.ok(f.context.chatMetadata[KEY].backup.events.length);
    f.adapter.quarantine = f.adapter.manager.export();
    await f.adapter.resetChat();
    assert.equal(f.adapter.manager.events.length, 0);
    assert.equal(f.context.chatMetadata[KEY].backup, undefined);
    assert.equal(f.context.chatMetadata[KEY].recovery_backup, undefined);
    assert.equal(f.adapter.exportData().recovery_backup, null);
    assert.equal(f.context.chat.length, 4);
});

test('deleting receipt during async edited-source extraction prevents late commit', async () => {
    let complete;
    const f = fixture({ generateRaw: () => new Promise(resolve => { complete = resolve; }) }); await f.adapter.initialize();
    await f.adapter.updateConfig({ debug: true, event_extraction: { mode: 'llm' } });
    f.context.chat.push({ name: 'Player', is_user: true, mes: '我已经帮你完成了任务。' }, { name: 'Alice', is_user: false, mes: '谢谢。', gen_finished: 'complete' });
    f.adapter.scan(); const pending = f.adapter.changed(0);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(typeof complete, 'function');
    f.context.chat.pop(); await f.adapter.deleted();
    complete('{"events":[]}'); await pending;
    assert.equal(f.adapter.manager.state.memories.length, 0); assert.equal(f.adapter.manager.state.turn, 0);
    assert.equal(f.prompts[KEY], '');
});

test('late prompt preview after chat switch cannot expose the previous chat prompt', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send();
    let release, first = true;
    f.context.getTokenCountAsync = text => {
        if (first) { first = false; return new Promise(resolve => { release = resolve; }); }
        return Promise.resolve(Math.ceil(text.length / 2));
    };
    const pending = f.adapter.previewPrompt(); assert.equal(typeof release, 'function');
    f.context.chatId = 'new'; f.context.chat = []; f.context.chatMetadata = {}; await f.adapter.loadChat();
    release(10); const result = await pending;
    assert.equal(result.text, ''); assert.equal(f.adapter.prompt.text, '');
});

test('host TypeError content is not copied into debug errors', async () => {
    const f = fixture(); await f.adapter.initialize();
    f.adapter.report(new TypeError('Authorization Bearer SECRET_API_KEY'), 'save');
    assert.doesNotMatch(JSON.stringify(f.adapter.getView()), /SECRET_API_KEY/);
});

test('a backup with a missing chat log is rejected without clearing current state', async () => {
    const f = fixture(); await f.adapter.initialize(); await f.send();
    const before = f.adapter.manager.export(); const data = f.adapter.exportData(); delete data.chat;
    await assert.rejects(f.adapter.importData(JSON.stringify(data)), /missing/);
    assert.deepEqual(f.adapter.manager.export(), before);
});
