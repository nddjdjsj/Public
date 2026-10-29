/**
 * Contract tests against a real local SillyTavern source tree. The host registry,
 * ToolDefinition, EventEmitter and selected lifecycle bodies are the actual files.
 * Browser rendering, HTTP/model generation and unrelated host dependencies are
 * controlled stubs. These are not a full SillyTavern browser/end-to-end test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { createFunctionTools } from '../adapters/function-tools.js';
import { SillyTavernAdapter } from '../adapters/sillytavern.js';

const defaultRoot = 'D:\\SillyTavern-1.19.0';
const hostRoot = process.env.SILLYTAVERN_ROOT ? resolve(process.env.SILLYTAVERN_ROOT) : defaultRoot;
const files = ['package.json', 'public/scripts/tool-calling.js', 'public/script.js', 'public/scripts/events.js', 'public/lib/eventemitter.js'];
const missing = files.filter(file => !existsSync(join(hostRoot, file)));
const reason = missing.length ? `Local SillyTavern contract not executed: ${hostRoot} missing ${missing.join(', ')}. Set SILLYTAVERN_ROOT to a source tree.` : false;
const hostTest = (name, fn) => test(`local ST contract: ${name}`, { skip: reason }, fn);
const json = value => JSON.parse(JSON.stringify(value));
const stripModule = source => source.replace(/^import\s[^;]+;\s*$/gmu, '').replace(/^export\s*\{[^}]+\}\s*;?\s*$/gmu, '').replace(/^export\s+(?=(?:class|const|function|async)\b)/gmu, '');

function extractBlock(source, marker) {
    const start = source.indexOf(marker); assert.ok(start >= 0, `Host lifecycle marker changed: ${marker}`);
    const open = start + marker.lastIndexOf('{'); let depth = 0, quote = '', comment = '';
    for (let i = open; i < source.length; i++) {
        const char = source[i], next = source[i + 1];
        if (comment === 'line') { if (char === '\n') comment = ''; continue; }
        if (comment === 'block') { if (char === '*' && next === '/') { comment = ''; i++; } continue; }
        if (quote) { if (char === '\\') i++; else if (char === quote) quote = ''; continue; }
        if (char === '/' && next === '/') { comment = 'line'; i++; continue; }
        if (char === '/' && next === '*') { comment = 'block'; i++; continue; }
        if (['\'', '"', '`'].includes(char)) { quote = char; continue; }
        if (char === '{') depth++;
        if (char === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Unbalanced actual host source block: ${marker}`);
}
function actualStatement(source, marker) {
    const at = source.indexOf(marker); assert.ok(at >= 0, `Host event marker changed: ${marker}`);
    return source.slice(at, source.indexOf(';', at) + 1);
}
function fakeElement(tag) {
    return { tag, textContent: '', children: [], classList: { add() {} }, append(...children) { this.children.push(...children); }, get outerHTML() { return `<${tag}>${this.textContent}${this.children.map(child => child.outerHTML).join('')}</${tag}>`; } };
}
function loadHost() {
    const sources = Object.fromEntries(files.map(file => [file, readFileSync(join(hostRoot, file), 'utf8')]));
    const trace = [], requests = [];
    const quiet = Object.fromEntries(['log', 'debug', 'warn', 'error', 'trace', 'info'].map(name => [name, () => {}]));
    const sourcesEnum = Object.fromEntries(['OPENAI', 'AZURE_OPENAI', 'CUSTOM', 'OPENROUTER', 'POLLINATIONS', 'FIREWORKS', 'MISTRALAI', 'AIMLAPI', 'CHUTES', 'ELECTRONHUB', 'WORKERS_AI', 'CLAUDE', 'GROQ', 'COHERE', 'DEEPSEEK', 'MAKERSUITE', 'VERTEXAI', 'AI21', 'XAI', 'MOONSHOT', 'COMETAPI', 'ZAI', 'SILICONFLOW', 'NANOGPT', 'MINIMAX'].map(key => [key, key.toLowerCase()]));
    let stopDisplay = 'flex';
    const context = vm.createContext({
        console: quiet, JSON, Error, structuredClone, setTimeout, clearTimeout, localStorage: { getItem: () => null },
        document: { createElement: fakeElement, body: { dataset: { generating: true } } },
        DOMPurify: { sanitize: value => value }, Popup: { show: { text() {} } },
        chat: [], main_api: 'openai', model_list: [], chat_completion_sources: sourcesEnum,
        custom_prompt_post_processing_types: { NONE: 'none', MERGE_TOOLS: 'merge_tools', SEMI_TOOLS: 'semi_tools', STRICT_TOOLS: 'strict_tools' },
        oai_settings: { function_calling: true, chat_completion_source: 'openai', custom_prompt_post_processing: 'none' },
        getChatCompletionModel: () => 'gpt-test', getGeneratingApi: () => 'openai', getGeneratingModel: () => 'gpt-test',
        system_avatar: 'system.png', systemUserName: 'System',
        addOneMessage(message) { trace.push({ kind: 'render', system: message.is_system === true }); },
        async saveChatConditional() { trace.push({ kind: 'save' }); },
        toastr: { info() { return 'toast'; }, clear() {}, error() {} },
        $(selector) { assert.equal(selector, '#mes_stop'); return { css(input) { if (typeof input === 'string') return stopDisplay; stopDisplay = input.display; } }; },
        is_send_press: true, streamingProcessor: null, setGenerationProgress() {}, flushEphemeralStoppingStrings() {}, flushWIInjections() {}, showSwipeButtons() {},
        chatElement: { find: () => ({}) }, addCopyToCodeBlocks() {}, syncMesToSwipe() {}, saveLogprobsForActiveMessage() {}, updateSwipeCounter() {}, parseReasoningInSwipes() {}, processImageAttachment: async () => {}, appendMediaToMessage() {},
    });
    vm.runInContext(`${stripModule(sources['public/lib/eventemitter.js'])}\nglobalThis.HostEventEmitter=EventEmitter;`, context, { filename: join(hostRoot, 'public/lib/eventemitter.js') });
    vm.runInContext(`${stripModule(sources['public/scripts/events.js'])}\nglobalThis.hostEventTypes=event_types;globalThis.hostEventSource=eventSource;`, context, { filename: join(hostRoot, 'public/scripts/events.js') });
    // Imports of script.js refer to these exact event objects.
    context.event_types = context.hostEventTypes; context.eventSource = context.hostEventSource;
    for (const [name, value] of Object.entries(context.event_types)) context.eventSource.on(value, async (...args) => trace.push({ kind: 'event', name, args: json(args) }));
    vm.runInContext(`${stripModule(sources['public/scripts/tool-calling.js'])}\nglobalThis.HostToolManager=ToolManager;globalThis.HostToolDefinition=ToolDefinition;`, context, { filename: join(hostRoot, 'public/scripts/tool-calling.js') });
    const script = sources['public/script.js'];
    const hide = extractBlock(script, 'function hideStopButton() {');
    const activate = extractBlock(script, 'export function activateSendButtons() {').replace(/^export /u, '');
    const unblock = extractBlock(script, 'function unblockGeneration(type) {');
    const branchMarker = 'if (canPerformToolCalls) {\n            const hasToolCalls = ToolManager.hasToolCalls(data);';
    const branch = extractBlock(script.replace(/\r\n/gu, '\n'), branchMarker);
    const intermediary = extractBlock(script, 'async finalizeIntermediaryMessage(messageId, text, { unlockUI = true }) {');
    const started = actualStatement(script, 'await eventSource.emit(event_types.GENERATION_STARTED,');
    const after = actualStatement(script, 'await eventSource.emit(event_types.GENERATION_AFTER_COMMANDS,');
    vm.runInContext(`${hide}\n${activate}\n${unblock}\n
        globalThis.hostEmitGenerationLifecycle=async function(type,{automatic_trigger,force_name2,quiet_prompt,quietToLoud,skipWIAN,force_chid,signal,quietImage}={},dryRun=false){${started}\n${after}};
        globalThis.hostNonStreamingBranch=async function({data,type='normal',getMessage='',reasoning='',depth=0,dryRun=false,canPerformToolCalls=true,automatic_trigger,force_name2,quiet_prompt,quietToLoud,skipWIAN,force_chid,signal,quietImage,quietName}={}){${branch}\nreturn 'fallthrough';};
        globalThis.hostFinalizeIntermediary=({${intermediary}}).finalizeIntermediaryMessage;
        globalThis.hostUnblockGeneration=unblockGeneration;
    `, context, { filename: 'actual-sillytavern-selected-lifecycle-bodies.js' });
    context.deleteLastMessage = async () => { trace.push({ kind: 'delete' }); context.chat.pop(); };
    context.Generate = async (type, options, dryRun) => {
        requests.push({ type, options: json(options), dryRun }); trace.push({ kind: 'recurse', depth: options.depth });
        await context.hostEmitGenerationLifecycle(type, options, dryRun);
        const message = { name: 'Character', is_user: false, is_system: false, mes: 'Final continued answer', extra: {} };
        context.chat.push(message);
        const index = context.chat.length - 1;
        await context.eventSource.emit(context.event_types.MESSAGE_RECEIVED, index, type);
        context.addOneMessage(message);
        await context.eventSource.emit(context.event_types.CHARACTER_MESSAGE_RENDERED, index, type);
        context.hostUnblockGeneration(type); return 'continued';
    };
    return { context, ToolManager: context.HostToolManager, ToolDefinition: context.HostToolDefinition, trace, requests, sources, showStop() { stopDisplay = 'flex'; } };
}
const callResponse = (name, args = {}, id = 'call_1') => ({ choices: [{ index: 0, message: { tool_calls: [{ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] } }] });

hostTest('reports exact local package and immutable source hashes', t => {
    const host = loadHost(), pkg = JSON.parse(host.sources['package.json']);
    assert.equal(typeof pkg.version, 'string');
    t.diagnostic(`Read-only host contract: SillyTavern ${pkg.version}; root=${hostRoot}. Browser/network/model generation are not executed.`);
    for (const file of files) t.diagnostic(`${file} SHA256=${createHash('sha256').update(host.sources[file]).digest('hex')}`);
});

hostTest('real PsycheEngine adapter executes a native model tool through actual host registry and commits after continuation', async () => {
    const { context, ToolManager } = loadHost(), globalHost = {};
    const c = { chat: context.chat, characters: [{ avatar:'fixture.png',data:{extensions:{}} }], characterId:0,chatId:'fixture-chat',name1:'Player',chatMetadata:{},extensionSettings:{},
        eventSource:context.eventSource,eventTypes:context.event_types,registerFunctionTool:ToolManager.registerFunctionTool.bind(ToolManager),unregisterFunctionTool:ToolManager.unregisterFunctionTool.bind(ToolManager),isToolCallingSupported:ToolManager.isToolCallingSupported.bind(ToolManager),
        async saveMetadata(){},saveSettingsDebounced(){},setExtensionPrompt(){},async getTokenCountAsync(text){return Math.ceil(new TextEncoder().encode(text).length/3);},
    };
    const adapter = new SillyTavernAdapter({getContext:()=>c,host:globalHost}); await adapter.initialize();
    const emit = (name,...args)=>context.eventSource.emit(context.event_types[name],...args);
    await emit('GENERATION_STARTED','normal',{},false); c.chat.push({is_user:true,name:'Player',mes:'我已经帮你完成了任务。谢谢你。'}); await emit('MESSAGE_SENT',0); await adapter.prepare();
    const request = {}; await ToolManager.registerFunctionToolsOpenAI(request); assert.equal(request.tool_choice,'auto'); assert.equal(request.tools.length,4);
    c.chat.push({is_user:false,name:'Character',mes:'...',gen_finished:'intermediate'}); await emit('CHARACTER_MESSAGE_RENDERED',1,'normal');
    context.deleteLastMessage = async()=>{c.chat.pop();await emit('MESSAGE_DELETED',c.chat.length);};
    context.Generate = async(type,options,dryRun)=>{
        await context.hostEmitGenerationLifecycle(type,options,dryRun); await adapter.prepare(type);
        assert.equal(adapter.manager.state.memories.length,0);assert.equal(adapter.transaction.events.length,1);
        c.chat.push({is_user:false,name:'Character',mes:'谢谢，我记得你的帮助。',gen_finished:'complete'});
        await emit('GENERATION_ENDED');await emit('CHARACTER_MESSAGE_RENDERED',c.chat.length-1,'normal');return 'continued';
    };
    const result = await context.hostNonStreamingBranch({data:callResponse('psyche_record_event',{type:'help',intensity:.45,confidence:.96,evidence:'我已经帮你完成了任务。'}),getMessage:'',type:'normal'});
    assert.equal(result,'continued');assert.equal(adapter.manager.state.memories.length,1);assert.ok(adapter.manager.state.relationships['user:Player'].trust>45);
    assert.equal(c.chat.find(message=>message.is_system).extra.tool_invocations[0].name,'psyche_record_event');
    adapter.destroy();assert.equal(ToolManager.tools.length,0);
});

hostTest('real registry converts definitions, evaluates visibility and requests tool_choice auto', async () => {
    const { ToolManager, ToolDefinition } = loadHost(); let enabled = true;
    ToolManager.registerFunctionTool({ name: 'psyche_visible', displayName: 'Visible', description: 'A host contract fixture', parameters: { type: 'object', properties: { value: { type: 'number' } } }, action: args => ({ doubled: args.value * 2 }), shouldRegister: () => enabled, stealth: false });
    ToolManager.registerFunctionTool({ name: 'psyche_hidden', description: 'Hidden fixture', parameters: {}, action: () => null, shouldRegister: () => false });
    assert.equal(ToolManager.tools.length, 2); assert.ok(ToolManager.tools[0] instanceof ToolDefinition);
    const data = {}; await ToolManager.registerFunctionToolsOpenAI(data);
    assert.equal(data.tool_choice, 'auto'); assert.equal(data.tools.length, 1); assert.equal(data.tools[0].function.name, 'psyche_visible'); assert.equal(data.tools[0].function.parameters.type, 'object');
    assert.equal(await ToolManager.invokeFunctionTool('psyche_visible', '{"value":3}'), '{"doubled":6}');
    enabled = false; const empty = {}; await ToolManager.registerFunctionToolsOpenAI(empty); assert.equal(empty.tools, undefined); assert.equal(empty.tool_choice, undefined);
    ToolManager.unregisterFunctionTool('psyche_visible'); ToolManager.unregisterFunctionTool('psyche_visible'); assert.equal(ToolManager.tools.length, 1);
});

hostTest('host argument parser does not enforce JSON Schema, extension validation is mandatory', async () => {
    const { ToolManager } = loadHost(); let received;
    ToolManager.registerFunctionTool({ name: 'schema_fixture', parameters: { type: 'object', required: ['value'], properties: { value: { type: 'number', maximum: 1 } }, additionalProperties: false }, action: args => { received = args; return 'accepted by fixture'; } });
    assert.equal(await ToolManager.invokeFunctionTool('schema_fixture', '{"unexpected":true}'), 'accepted by fixture'); assert.deepEqual(received, { unexpected: true });
    const error = await ToolManager.invokeFunctionTool('schema_fixture', '{invalid-json'); assert.ok(error instanceof Error);
});

hostTest('PsycheEngine factory runs through actual host registration, auto choice and invocation', async () => {
    const { ToolManager } = loadHost(); let enabled = true, recorded;
    const controller = { toolsAvailable: () => enabled, toolGetState: () => ({ emotion: 'calm' }), toolGetBehavior: () => ({ strategy: 'reflect' }), toolRecall: args => ({ query: args.query, limit: args.limit, memories: [] }), toolRecordEvent: args => { recorded = args; return { staged: true }; } };
    for (const definition of createFunctionTools(controller)) ToolManager.registerFunctionTool(definition);
    const data = {}; await ToolManager.registerFunctionToolsOpenAI(data); assert.equal(data.tool_choice, 'auto'); assert.equal(data.tools.length, 4);
    assert.equal(JSON.parse(await ToolManager.invokeFunctionTool('psyche_get_state', '{}')).ok, true);
    assert.equal(JSON.parse(await ToolManager.invokeFunctionTool('psyche_recall', '{"query":"promise","limit":3}')).result.limit, 3);
    const result = JSON.parse(await ToolManager.invokeFunctionTool('psyche_record_event', JSON.stringify({ type: 'help', intensity: .6, confidence: .95, evidence: 'I helped you carry the bag.' })));
    assert.equal(result.ok, true); assert.equal(recorded.type, 'help');
    recorded = null; const rejected = JSON.parse(await ToolManager.invokeFunctionTool('psyche_record_event', '{"type":"help","intensity":99,"confidence":1,"evidence":"invented"}')); assert.equal(rejected.ok, false); assert.equal(recorded, null);
    enabled = false; const disabled = {}; await ToolManager.registerFunctionToolsOpenAI(disabled); assert.equal(disabled.tools, undefined);
});

hostTest('non-stealth invocations create system messages and awaited performed/rendered/save sequence', async () => {
    const { context, ToolManager, trace } = loadHost();
    ToolManager.registerFunctionTool({ name: 'visible_tool', displayName: 'Visible fixture', parameters: {}, action: () => ({ staged: true }), stealth: false });
    const invoked = await ToolManager.invokeFunctionTools(callResponse('visible_tool'));
    assert.equal(invoked.invocations.length, 1); assert.equal(invoked.stealthCalls.length, 0);
    await ToolManager.saveFunctionToolInvocations(invoked.invocations);
    assert.equal(context.chat.length, 1); assert.equal(context.chat[0].is_system, true); assert.equal(context.chat[0].is_user, false); assert.equal(context.chat[0].extra.tool_invocations[0].name, 'visible_tool');
    assert.deepEqual(trace.filter(x => x.kind !== 'event' || ['TOOL_CALLS_PERFORMED', 'TOOL_CALLS_RENDERED'].includes(x.name)).map(x => x.kind === 'event' ? x.name : x.kind), ['TOOL_CALLS_PERFORMED', 'render', 'TOOL_CALLS_RENDERED', 'save']);
    assert.ok(!trace.some(x => x.name === 'GENERATION_ENDED'));
});

hostTest('actual non-stream tool branch recurses after performed/rendered and ends after continued reply', async () => {
    const { context, ToolManager, trace, requests } = loadHost(); let staged = false;
    ToolManager.registerFunctionTool({ name: 'psyche_fixture', parameters: {}, stealth: false, action: () => { staged = true; trace.push({ kind: 'action' }); return { candidate: true }; } });
    context.chat.push({ is_user: true, mes: 'The source event.' }, { is_user: false, is_system: false, mes: '', extra: {} });
    await context.hostEmitGenerationLifecycle('normal', {}, false);
    assert.equal(await context.hostNonStreamingBranch({ data: callResponse('psyche_fixture'), getMessage: '', depth: 0 }), 'continued');
    assert.equal(staged, true); assert.equal(requests.length, 1); assert.equal(requests[0].type, 'normal'); assert.equal(requests[0].options.depth, 1);
    const sequence = trace.filter(x => ['action', 'recurse'].includes(x.kind) || x.kind === 'event').map(x => x.kind === 'event' ? x.name : x.kind);
    assert.deepEqual(sequence, ['GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'action', 'TOOL_CALLS_PERFORMED', 'TOOL_CALLS_RENDERED', 'recurse', 'GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED', 'GENERATION_ENDED']);
    const starts = trace.filter(x => x.name === 'GENERATION_STARTED'); assert.equal(starts.length, 2); assert.equal(starts[1].args[1].depth, undefined);
    assert.equal(context.chat[1].is_system, true); assert.equal(context.chat[2].mes, 'Final continued answer');
});

hostTest('two actual tool branches preserve recursive depth and emit one terminal end', async () => {
    const { context, ToolManager, trace, requests } = loadHost(); let count = 0;
    ToolManager.registerFunctionTool({ name: 'chain_fixture', parameters: {}, stealth: false, action: () => ({ sequence: ++count }) });
    const finishContinuation = context.Generate;
    context.Generate = async (type, options, dryRun) => {
        if (options.depth === 1) {
            requests.push({ type, options: json(options), dryRun }); trace.push({ kind: 'recurse', depth: 1 });
            await context.hostEmitGenerationLifecycle(type, options, dryRun);
            context.chat.push({ is_user: false, is_system: false, mes: '', extra: {} });
            return context.hostNonStreamingBranch({ data: callResponse('chain_fixture', {}, 'call_2'), type, depth: options.depth, getMessage: '' });
        }
        return finishContinuation(type, options, dryRun);
    };
    context.chat.push({ is_user: true, mes: 'source' }, { is_user: false, mes: '', extra: {} });
    await context.hostEmitGenerationLifecycle('normal', {}, false);
    await context.hostNonStreamingBranch({ data: callResponse('chain_fixture'), getMessage: '', depth: 0 });
    assert.equal(count, 2); assert.deepEqual(requests.map(request => request.options.depth), [1, 2]);
    assert.equal(trace.filter(entry => entry.name === 'TOOL_CALLS_PERFORMED').length, 2);
    assert.equal(trace.filter(entry => entry.name === 'GENERATION_STARTED').length, 3);
    assert.equal(trace.filter(entry => entry.name === 'GENERATION_ENDED').length, 1);
    assert.equal(context.chat.filter(message => message.is_system && message.extra?.tool_invocations).length, 2);
});

hostTest('tool errors remain explicit host invocation results for the follow-up model', async () => {
    const { ToolManager } = loadHost();
    ToolManager.registerFunctionTool({ name: 'failing_fixture', parameters: {}, stealth: false, action: () => { throw new Error('Fixture validation failed'); } });
    const result = await ToolManager.invokeFunctionTools(callResponse('failing_fixture'));
    assert.equal(result.errors.length, 1); assert.equal(result.invocations.length, 1); assert.equal(result.invocations[0].error, true);
    assert.match(result.invocations[0].result, /Fixture validation failed/u);
});

hostTest('stream intermediary emits receipt events without ending; real finalizer ends before receipt', async () => {
    const { context, trace } = loadHost();
    context.chat.push({ is_user: false, is_system: false, mes: 'Intermediary text', extra: {}, swipes: [], swipe_info: [] });
    const processor = { type: 'normal', messageId: 0, swipes: [], images: [], messageLogprobs: [], continueMessage: '', reasoningHandler: { finish: async () => {} }, onProgressStreaming: async () => {}, markUIGenStopped: () => context.hostUnblockGeneration() };
    await context.hostFinalizeIntermediary.call(processor, 0, 'Intermediary text', { unlockUI: false });
    assert.deepEqual(trace.filter(x => x.kind === 'event').map(x => x.name), ['MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED']);
    trace.length = 0;
    await context.hostFinalizeIntermediary.call(processor, 0, 'Final text', { unlockUI: true });
    assert.deepEqual(trace.filter(x => x.kind === 'event').map(x => x.name), ['GENERATION_ENDED', 'MESSAGE_RECEIVED', 'CHARACTER_MESSAGE_RENDERED']);
});

hostTest('stealth tool halts the real branch without saving or recursive reply', async () => {
    const { context, ToolManager, trace, requests } = loadHost();
    ToolManager.registerFunctionTool({ name: 'stealth_fixture', parameters: {}, action: () => 'hidden', stealth: true });
    context.chat.push({ is_user: true, mes: 'source' }, { is_user: false, mes: '', extra: {} });
    await context.hostNonStreamingBranch({ data: callResponse('stealth_fixture'), getMessage: '' });
    assert.equal(requests.length, 0); assert.ok(!context.chat.some(message => message.extra?.tool_invocations));
    assert.ok(!trace.some(x => x.name === 'TOOL_CALLS_PERFORMED')); assert.ok(trace.some(x => x.name === 'GENERATION_ENDED'));
});

hostTest('actual support gate excludes quiet/continue/impersonate and honors user tool setting', () => {
    const { context, ToolManager, sources } = loadHost();
    assert.equal(ToolManager.isToolCallingSupported(), true); assert.equal(ToolManager.canPerformToolCalls('normal'), true); assert.equal(ToolManager.canPerformToolCalls('swipe'), true);
    for (const type of ['quiet', 'continue', 'impersonate']) assert.equal(ToolManager.canPerformToolCalls(type), false);
    context.oai_settings.function_calling = false; assert.equal(ToolManager.isToolCallingSupported(), false);
    assert.match(sources['public/script.js'], /depth\s*<\s*ToolManager\.RECURSE_LIMIT/u);
    const streamBranch = extractBlock(sources['public/script.js'], 'if (canPerformToolCalls && isStreamFinished && isStreamWithToolCalls) {');
    assert.ok(streamBranch.indexOf('depth = depth + 1') < streamBranch.indexOf('saveFunctionToolInvocations'));
    assert.ok(streamBranch.indexOf('saveFunctionToolInvocations') < streamBranch.indexOf("return Generate('normal'"));
    assert.match(streamBranch, /finalizeIntermediaryMessage\([^;]+unlockUI:\s*false/u);
});
