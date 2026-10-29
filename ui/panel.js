import { FACETS, DOMAINS, createPersonality } from '../core/personality.js';

const DOMAIN_NAMES = { O: '开放性', C: '尽责性', E: '外向性', A: '宜人性', N: '神经质' };
const RELATIONS = { trust: '信任', closeness: '亲密', respect: '尊重', attachment: '依恋', conflict: '冲突' };
const PAD = { pleasure: '愉悦 P', arousal: '唤醒 A', dominance: '掌控 D' };
const EVENT_NAMES = {
    help: '帮助', comfort: '安慰', praise: '表扬', shared_experience: '共同经历', promise_made: '承诺',
    promise_kept: '履行承诺', promise_broken: '违背承诺', deception: '欺骗', apology: '道歉',
    restitution: '补救', argument: '争执', rejection: '拒绝', boundary_respected: '尊重边界',
    boundary_violated: '侵犯边界', neglect: '长期忽视', relationship_repair: '关系修复',
};
const PRESETS = {
    extravert: { name: '高外向性', scores: { O: .65, C: .55, E: .88, A: .65, N: .35 } },
    introvert: { name: '高内向性', scores: { O: .6, C: .65, E: .15, A: .6, N: .5 } },
    agreeable: { name: '高宜人性', scores: { O: .55, C: .6, E: .5, A: .9, N: .4 } },
    sensitive: { name: '高神经质', scores: { O: .6, C: .45, E: .4, A: .6, N: .87 } },
    mixed: { name: '五维混合', scores: { O: .8, C: .35, E: .4, A: .75, N: .65 } },
};
const CONFIG_FIELDS = [
    ['enabled', '启用 PsycheEngine', 'checkbox'],
    ['personality.enabled', '人格模块', 'checkbox'],
    ['personality.adaptive_personality', '缓慢人格适应（默认关闭）', 'checkbox'],
    ['emotion.enabled', '情绪模块', 'checkbox'],
    ['relationship.enabled', '关系模块', 'checkbox'],
    ['memory.enabled', '记忆模块', 'checkbox'],
    ['tools.enabled', '模型可调用工具', 'checkbox'],
    ['tools.allow_event_proposals', '允许模型提出有证据的事件候选', 'checkbox'],
    ['tools.max_calls_per_turn', '每次生成的工具调用上限', 'number', 1, 20, 1],
    ['prompt.enabled', '动态 Prompt 注入', 'checkbox'],
    ['prompt.personality', 'Prompt 包含稳定人格', 'checkbox'],
    ['prompt.emotion', 'Prompt 包含当前情绪', 'checkbox'],
    ['prompt.relationship', 'Prompt 包含对象关系', 'checkbox'],
    ['prompt.memory', 'Prompt 包含相关记忆', 'checkbox'],
    ['prompt.behavior', 'Prompt 包含行为倾向', 'checkbox'],
    ['debug', '调试日志（有长度限制）', 'checkbox'],
    ['emotion.sensitivity', '情绪敏感度', 'number', 0, 3, .1],
    ['emotion.decay_speed', '恢复速度（0.5 慢 / 1 标准 / 2 快）', 'number', .05, 5, .05],
    ['emotion.recovery_mode', '情绪恢复依据', 'select', [['story', '剧情时间'], ['turn', '有效轮次'], ['event', '仅事件与手动']]],
    ['relationship.max_event_delta', '单事件关系最大变化', 'number', 0, 20, 1],
    ['relationship.diminishing_returns', '重复事件边际递减', 'checkbox'],
    ['memory.max_retrieved_events', '最多检索记忆数', 'number', 0, 20, 1],
    ['event_extraction.mode', '事件提取模式', 'select', [['rules', '保守规则（无额外模型调用）'], ['llm', '当前模型（需要明确启用）']]],
    ['event_extraction.minimum_confidence', '最低事件置信度', 'number', .5, 1, .05],
    ['prompt.max_tokens', 'Prompt token 预算', 'number', 32, 2000, 1],
    ['prompt.language', 'Prompt 语言', 'select', [['zh', '中文'], ['en', 'English']]],
];

const TEMPLATE = `
<div class="pe-header"><h3>PsycheEngine · 动态人格</h3><span class="pe-badge" data-pe="badge">加载中</span></div>
<p class="pe-note">角色心理状态是可解释的工程模拟，不是临床诊断或真实意识。基础人格与聊天经历分别保存。</p>
<div class="pe-status" data-pe="status" role="status" aria-live="polite"></div>
<nav class="pe-tabs" role="tablist" aria-label="PsycheEngine 设置分区"></nav>
<section data-section="config"><h4>全局设置</h4><div class="pe-grid" data-pe="config-fields"></div>
<label class="pe-row"><input type="checkbox" data-pe="llm-consent"><span>我了解模型分析会将近期聊天文本发送到 SillyTavern 当前配置的模型服务。</span></label>
<p class="pe-note">规则模式不会额外调用模型。LLM 分析失败时采用保守回退；所有返回内容均先验证。</p>
<div class="pe-actions"><button type="button" data-action="config-save">应用设置</button></div>
<fieldset><legend>模型自动调用工具</legend><p class="pe-note">需要在 SillyTavern 的 Chat Completion（聊天补全）中启用 Function Calling，并使用支持工具调用的模型。模型按当前剧情自行选择是否调用；Text Completion（文本补全）不支持此调用路径。</p>
<p data-pe="tools-status" role="status"></p><p class="pe-note" data-pe="registered-tools"></p>
<p class="pe-note">psyche_get_state 读取当前心理状态；psyche_recall 检索事件记忆；psyche_get_behavior 读取行为倾向。psyche_record_event 只能提出来自当前用户消息、具有逐字证据的事件候选，不能任意写入人格或关系数值；高影响事件仍需人工确认。</p>
<p class="pe-note">工具注册不会另建模型连接。此开关与“事件提取模式”中的可选 LLM 分析分别控制；停用后不向模型提供这些工具。</p></fieldset>
<details><summary>当前环境兼容能力</summary><pre data-pe="capabilities"></pre></details>
<fieldset><legend>聊天数据备份</legend><p class="pe-note">备份可能包含私人剧情、角色配置和关系记录。导入只使用经过校验的数据。</p>
<div class="pe-actions"><button type="button" data-action="export-data">导出备份 JSON</button><button type="button" data-action="import-data">导入备份 JSON</button></div>
<label>备份文件<input type="file" accept=".json,application/json" data-pe="backup-file"></label><textarea data-pe="backup-input" aria-label="备份 JSON" placeholder="也可在此粘贴 JSON"></textarea>
<details><summary>重置当前聊天</summary><p>将删除当前聊天的 PsycheEngine 动态状态；角色人格与原始聊天仍保留。</p><label class="pe-row"><input type="checkbox" data-pe="reset-confirm">确认重置当前聊天状态</label><button type="button" class="pe-danger" data-action="reset-chat">重置当前聊天</button></details></fieldset></section>
<section data-section="personality" hidden><h4>角色稳定人格</h4><p class="pe-note" data-pe="personality-source"></p>
<fieldset><legend>五大人格 · 内部归一化 0–1</legend><div data-pe="domains"></div></fieldset>
<details><summary>30 个人格分面 · 内部归一化 0–1</summary><div data-pe="facets"></div></details>
<div class="pe-actions"><button type="button" data-action="personality-save">保存到当前角色</button><button type="button" data-action="personality-reload">放弃未保存修改</button><button type="button" data-action="personality-neutral">载入中性模拟人格</button></div>
<div class="pe-row"><label>模拟预设 <select data-pe="preset"></select></label><button type="button" data-action="preset">载入预设</button><button type="button" data-action="personality-random">随机模拟人格</button></div>
<p class="pe-note">预设和随机结果均为模拟数据；载入后需点击“保存到当前角色”。滑块不是常模百分位。</p>
<details><summary>原始分数、量表和质量标记</summary><pre data-pe="personality-raw"></pre></details>
<fieldset><legend>缓慢人格适应</legend><p class="pe-note" data-pe="adaptation-note"></p><p class="pe-note">仅调整有上限的适应偏移，保留基础人格和测试原始分数。每次调整需要明确原因，可从历史撤销。</p>
<div class="pe-row"><label>维度 <select data-pe="adaptation-domain"></select></label><label>本次偏移 <input type="number" step="0.0001" data-pe="adaptation-delta" value="0.001"></label></div>
<label>修改原因<textarea data-pe="adaptation-reason" maxlength="500" placeholder="说明长期经历如何支持这次缓慢调整"></textarea></label><button type="button" data-action="personality-adapt">确认本次适应调整</button><pre data-pe="adaptation-offsets"></pre><div data-pe="adaptation-history"></div></fieldset>
<fieldset><legend>测试结果导入与导出</legend><div class="pe-row"><label>格式 <select data-pe="personality-format"><option value="json">JSON</option><option value="csv">CSV</option></select></label><input type="file" accept=".json,.csv,application/json,text/csv" data-pe="personality-file" aria-label="人格数据文件"></div>
<textarea data-pe="personality-input" aria-label="人格导入数据" placeholder="粘贴合法来源的人格测试结果；示例格式见 README"></textarea><div class="pe-actions"><button type="button" data-action="personality-import">校验并导入当前角色</button><button type="button" data-action="personality-export">导出人格 JSON</button></div></fieldset></section>
<section data-section="emotion" hidden><h4>当前情绪</h4><div data-pe="emotion-values"></div><p data-pe="emotion-labels"></p>
<svg class="pe-chart" data-pe="emotion-chart" viewBox="0 0 320 100" role="img" aria-label="最近情绪变化，纵轴负一到正一，横轴有效事件"></svg><div class="pe-legend"><span>愉悦 P</span><span>唤醒 A</span><span>掌控 D</span></div>
<p class="pe-note">图表展示最多 60 条有效状态记录。现实时间流逝不会自动推进剧情。</p>
<fieldset><legend>手动情绪修正</legend><div data-pe="emotion-sliders"></div><div class="pe-actions"><button type="button" data-action="emotion-set">应用手动 PAD</button><button type="button" data-action="emotion-reset">恢复人格情绪基线</button></div></fieldset>
<div class="pe-row"><label>当前累计剧情分钟 <input type="number" min="0" step="1" data-pe="story-time" value="0"></label><button type="button" data-action="story-time">推进到该剧情时间</button></div></section>
<section data-section="relationship" hidden><h4>分对象关系</h4><p class="pe-note">五个维度独立变化。高依恋不等于高信任，道歉不会自动恢复全部信任。</p><div data-pe="relationships"></div></section>
<section data-section="memory" hidden><h4>事件与记忆</h4><div data-pe="pending-events"></div><label>搜索事件<input type="search" data-pe="memory-search" placeholder="关键词、事件类型或人物"></label><div class="pe-actions"><button type="button" data-action="rebuild">从有效事件重建状态</button></div><div data-pe="memories"></div><button type="button" data-action="memory-more" hidden>显示更多</button>
<details><summary>手动确认剧情事件</summary><p class="pe-note">只记录已发生的事实；不要把假设、引用或角色生成的虚构回忆当成事实。此操作将明确确认事件。</p><div class="pe-grid"><label class="pe-field"><span>事件类型</span><select data-pe="manual-type"></select></label><label class="pe-field"><span>行为对象 ID</span><input type="text" data-pe="manual-actor" value="user" maxlength="100"></label><label class="pe-field"><span>强度 0–1</span><input type="number" min="0" max="1" step=".05" data-pe="manual-intensity" value="0.5"></label></div><label>事实说明<textarea data-pe="manual-evidence" maxlength="1000"></textarea></label><button type="button" data-action="manual-event">确认并添加事件</button></details></section>
<section data-section="debug" hidden><h4>动态 Prompt 与调试</h4><div class="pe-actions"><button type="button" data-action="preview">刷新 Prompt 预览</button></div><p class="pe-note">预览使用当前状态与配置，不产生额外事件。调试日志默认关闭；本面板对长内容截断显示。</p><pre data-pe="prompt" aria-label="最终注入的 Prompt"></pre><div data-pe="debug-details"></div></section>
`;

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, number(value)));
const array = value => Array.isArray(value) ? value : [];
const get = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
function set(object, path, value) { const keys = path.split('.'); let target = object; for (const key of keys.slice(0, -1)) target = target[key] ??= {}; target[keys.at(-1)] = value; }
function readable(value, limit = 16000) { try { return (typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '暂无').slice(0, limit); } catch { return '数据无法显示'; } }

/** Browser-only panel. All user-controlled text is inserted with textContent. */
export function mountPanel({ container, controller }) {
    if (!container || !controller?.getView) throw new TypeError('PsycheEngine 面板缺少容器或控制器');
    const doc = container.ownerDocument;
    const root = doc.createElement('div');
    root.className = 'pe-panel';
    root.innerHTML = TEMPLATE; // Static application markup only; never interpolate data here.
    container.append(root);
    const find = key => root.querySelector(`[data-pe="${key}"]`);
    const controls = new Map();
    const personalityControls = new Map();
    const emotionControls = new Map();
    const disposers = [];
    let destroyed = false;
    let configDirty = false;
    let personalityDirty = false;
    let draftPersonality = null;
    let busy = false;
    let memoryLimit = 60;
    let localStatus = '';
    let localError = false;
    let view = {};
    function listen(node, type, fn) { node.addEventListener(type, fn); disposers.push(() => node.removeEventListener(type, fn)); }
    function element(tag, text, className) { const node = doc.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node; }
    function note(text) { return element('p', text, 'pe-note'); }
    function action(text, fn, dangerous = false) { const node = element('button', text, dangerous ? 'pe-danger' : ''); node.type = 'button'; node.addEventListener('click', fn); return node; }
    function errorStatus(error) { localError = true; localStatus = error instanceof Error ? error.message : String(error); }
    async function run(fn, message) {
        if (busy || destroyed) return;
        busy = true; localStatus = '正在处理…'; localError = false; renderStatus();
        try { await fn(); localStatus = message ?? '已完成'; } catch (error) { errorStatus(error); }
        finally { busy = false; if (!destroyed) render(); }
    }
    function invoke(method, ...args) { if (typeof controller[method] !== 'function') throw new Error(`当前环境暂不支持此操作：${method}`); return controller[method](...args); }
    function download(value, filename) {
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        if (controller.download) return controller.download(text, filename);
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
        const link = element('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function slider(parent, label, key, map, min = 0, max = 1) {
        const row = element('label', null, 'pe-slider'); const title = element('span', label); const input = element('input');
        input.type = 'range'; input.min = String(min); input.max = String(max); input.step = '.01'; input.value = '0.5';
        const output = element('output', '.50'); row.append(title, input, output); parent.append(row);
        listen(input, 'input', () => { output.textContent = number(input.value).toFixed(2); if (map === personalityControls) personalityDirty = true; });
        map.set(key, { input, output });
    }
    function writeSlider(control, value) { control.input.value = String(value); control.output.textContent = number(value).toFixed(2); }
    const tabs = [['config', '设置'], ['personality', '人格'], ['emotion', '情绪'], ['relationship', '关系'], ['memory', '记忆'], ['debug', '调试']];
    for (const [key, label] of tabs) {
        const tab = action(label, () => {
            for (const button of root.querySelectorAll('[role="tab"]')) button.setAttribute('aria-selected', String(button === tab));
            for (const section of root.querySelectorAll('[data-section]')) section.hidden = section.dataset.section !== key;
        });
        tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(key === 'config'));
        root.querySelector('.pe-tabs').append(tab);
    }
    for (const [path, title, kind, min, max, step] of CONFIG_FIELDS) {
        const label = element('label', null, 'pe-field'); label.append(element('span', title));
        const input = element(kind === 'select' ? 'select' : 'input');
        if (kind === 'select') for (const [value, text] of min) { const option = element('option', text); option.value = value; input.append(option); }
        else { input.type = kind; if (kind === 'number') { input.min = String(min); input.max = String(max); input.step = String(step); } }
        label.append(input); find('config-fields').append(label); controls.set(path, { input, kind }); listen(input, 'input', () => { configDirty = true; });
    }
    for (const domain of DOMAINS) slider(find('domains'), `${domain} · ${DOMAIN_NAMES[domain]}`, domain, personalityControls);
    for (const domain of DOMAINS) {
        const group = element('fieldset'); group.append(element('legend', DOMAIN_NAMES[domain]));
        for (const facet of FACETS.filter(facet => facet.domain === domain)) slider(group, `${facet.id} · ${facet.label}`, facet.id, personalityControls);
        find('facets').append(group);
    }
    for (const key of Object.keys(PAD)) slider(find('emotion-sliders'), PAD[key], key, emotionControls, -1, 1);
    for (const [key, preset] of Object.entries(PRESETS)) { const option = element('option', `${preset.name}（模拟）`); option.value = key; find('preset').append(option); }
    for (const domain of DOMAINS) { const option = element('option', `${domain} · ${DOMAIN_NAMES[domain]}`); option.value = domain; find('adaptation-domain').append(option); }
    for (const [key, name] of Object.entries(EVENT_NAMES)) { const option = element('option', name); option.value = key; find('manual-type').append(option); }
    function loadDraft(profile) {
        draftPersonality = profile; personalityDirty = false;
        for (const [key, control] of personalityControls) writeSlider(control, DOMAINS.includes(key) ? profile?.baseline?.[key] ?? .5 : profile?.facets?.[key] ?? profile?.baseline?.[key[0]] ?? .5);
    }
    function simulated(scores) {
        return createPersonality({ baseline: scores, facets: Object.fromEntries(FACETS.map(f => [f.id, scores[f.domain]])), source: 'simulated', scoring: 'internal-normalization', quality_flags: ['simulated_data'] });
    }
    function formPersonality() {
        const baseline = {}, facets = {};
        for (const [key, control] of personalityControls) (DOMAINS.includes(key) ? baseline : facets)[key] = number(control.input.value, .5);
        return createPersonality({ ...draftPersonality, baseline, facets,
            source: draftPersonality?.source === 'simulated' ? 'simulated' : 'manual',
            quality_flags: [...(draftPersonality?.quality_flags ?? []), 'manual-normalized-edit-original-raw-preserved'],
        });
    }
    function configPatch() {
        const patch = {};
        for (const [path, { input, kind }] of controls) {
            if (kind === 'number' && !input.checkValidity()) throw new Error(`配置超出允许范围：${path}`);
            set(patch, path, kind === 'checkbox' ? input.checked : kind === 'number' ? Number(input.value) : input.value);
        }
        if (patch.event_extraction.mode === 'llm' && view.config?.event_extraction?.mode !== 'llm' && !find('llm-consent').checked) throw new Error('启用 LLM 分析前，请勾选聊天内容发送说明。');
        return patch;
    }
    const actions = {
        'config-save': () => run(async () => { await invoke('updateConfig', configPatch()); configDirty = false; }, '全局设置已保存'),
        'export-data': () => run(async () => download(await invoke('exportData'), 'psyche-engine-backup.json'), '已导出备份'),
        'import-data': () => run(async () => { await invoke('importData', find('backup-input').value); configDirty = false; personalityDirty = false; }, '备份已校验并导入'),
        'reset-chat': () => run(async () => { if (!find('reset-confirm').checked) throw new Error('请先勾选重置当前聊天状态。'); await invoke('resetChat'); find('reset-confirm').checked = false; }, '当前聊天状态已重置'),
        'personality-save': () => run(async () => { await invoke('savePersonality', formPersonality()); personalityDirty = false; }, '角色人格已保存'),
        'personality-reload': () => { loadDraft(view.personality ?? view.state?.personality); localStatus = '已恢复保存的人格'; renderStatus(); },
        'personality-neutral': () => { loadDraft(simulated(Object.fromEntries(DOMAINS.map(key => [key, .5])))); personalityDirty = true; localStatus = '已载入中性模拟人格，尚未保存'; renderStatus(); },
        preset: () => { loadDraft(simulated(PRESETS[find('preset').value].scores)); personalityDirty = true; localStatus = '已载入模拟预设，尚未保存'; renderStatus(); },
        'personality-random': () => { const values = new Uint32Array(5); globalThis.crypto.getRandomValues(values); loadDraft(simulated(Object.fromEntries(DOMAINS.map((key, i) => [key, Math.round((.1 + values[i] / 4294967295 * .8) * 100) / 100])))); personalityDirty = true; localStatus = '已生成模拟人格，尚未保存'; renderStatus(); },
        'personality-import': () => run(async () => { await invoke('importPersonality', find('personality-input').value, find('personality-format').value); personalityDirty = false; }, '人格数据已校验并导入'),
        'personality-export': () => run(() => download(view.personality ?? view.state?.personality, 'psyche-engine-personality.json'), '已导出当前已保存人格'),
        'personality-adapt': () => run(async () => {
            if (!view.config?.personality?.adaptive_personality) throw new Error('请先在设置中启用缓慢人格适应');
            const domain = find('adaptation-domain').value, delta = Number(find('adaptation-delta').value), rate = number(view.config.personality.adaptation_rate, .002), reason = find('adaptation-reason').value.trim();
            if (!DOMAINS.includes(domain) || !Number.isFinite(delta) || delta === 0 || Math.abs(delta) > rate) throw new Error(`本次偏移必须在 ±${rate} 内且不为零`);
            if (!reason) throw new Error('请填写人格适应的修改原因');
            await invoke('addManualEvent', { type: 'personality_adaptation', offsets: { [domain]: delta }, reason, confirmed: true });
            find('adaptation-reason').value = '';
        }, '适应偏移已记录；基础人格保持稳定'),
        'emotion-set': () => run(() => invoke('resetEmotion', Object.fromEntries([...emotionControls].map(([key, { input }]) => [key, Number(input.value)]))), '手动情绪已保存'),
        'emotion-reset': () => run(() => invoke('resetEmotion'), '情绪已恢复基线'),
        'story-time': () => run(() => { const input = find('story-time'); if (!input.checkValidity()) throw new Error('剧情分钟必须是非负整数'); return invoke('setStoryTime', Number(input.value)); }, '剧情时间已更新'),
        rebuild: () => run(() => invoke('rebuild'), '已从有效事件重建状态'),
        'memory-more': () => { memoryLimit += 60; renderMemories(); },
        'manual-event': () => run(async () => {
            const actor = find('manual-actor').value.trim(), evidence = find('manual-evidence').value.trim(), input = find('manual-intensity');
            if (!actor || !evidence || !input.checkValidity()) throw new Error('请填写对象、事实说明与有效强度');
            await invoke('addManualEvent', { type: find('manual-type').value, actor, target: 'character', intensity: Number(input.value), confidence: 1, evidence, summary: evidence, modality: 'fact', confirmed: true });
            find('manual-evidence').value = '';
        }, '已添加确认事件'),
        preview: () => run(async () => { const prompt = await invoke('previewPrompt'); if (prompt != null) find('prompt').textContent = readable(prompt, 20000); }, 'Prompt 预览已刷新'),
    };
    for (const node of root.querySelectorAll('[data-action]')) listen(node, 'click', () => { try { actions[node.dataset.action]?.(); } catch (error) { errorStatus(error); renderStatus(); } });
    listen(find('memory-search'), 'input', () => { memoryLimit = 60; renderMemories(); });
    async function readFile(input, target, personality = false) {
        const file = input.files?.[0]; if (!file) return;
        if (file.size > 10 * 1024 * 1024) throw new Error('文件超过 10 MB，请使用更小的导出文件');
        target.value = await file.text(); if (personality) find('personality-format').value = /\.csv$/i.test(file.name) ? 'csv' : 'json';
        localStatus = `已读取 ${file.name}，等待校验导入`; localError = false;
    }
    listen(find('personality-file'), 'change', () => run(() => readFile(find('personality-file'), find('personality-input'), true), '已读取人格文件，点击校验并导入'));
    listen(find('backup-file'), 'change', () => run(() => readFile(find('backup-file'), find('backup-input')), '已读取备份文件，点击导入备份'));

    function renderStatus() {
        const enabled = view.config?.enabled;
        find('badge').textContent = enabled ? '已启用' : '已停用';
        find('status').textContent = localStatus || view.status || '请选择角色与聊天。修改配置后点击保存。';
        find('status').dataset.error = String(localError);
        for (const node of root.querySelectorAll('button[data-action]')) node.disabled = busy;
    }
    function renderConfig() {
        if (!configDirty) for (const [path, { input, kind }] of controls) {
            const value = get(view.config, path);
            if (kind === 'checkbox') input.checked = Boolean(value); else if (value !== undefined) input.value = String(value);
        }
        find('capabilities').textContent = readable(view.capabilities ?? '环境能力尚未报告');
        const capabilities = view.capabilities ?? {}, names = array(capabilities.registered_tools).filter(name => typeof name === 'string').slice(0, 20);
        const toolsEnabled = view.config?.tools?.enabled === true;
        find('tools-status').textContent = !toolsEnabled ? '模型工具已停用。'
            : capabilities.tool_registration !== true ? '当前宿主未报告可用的工具注册接口；心理状态 Prompt 可继续按设置工作。'
                : capabilities.tool_calling !== true ? '工具接口可用；当前连接尚未启用 Function Calling，或当前模型不支持。请检查聊天补全设置。'
                    : names.length ? '工具已注册，当前连接支持 Function Calling；模型可自动选择调用。'
                        : '当前连接支持 Function Calling，尚未报告已注册工具。请检查角色聊天与启用状态。';
        find('registered-tools').textContent = `当前已注册工具：${names.length ? names.join('、') : '暂无'}`;
    }
    function renderPersonality() {
        const profile = view.personality ?? view.state?.personality;
        if (!personalityDirty) loadDraft(profile);
        find('personality-source').textContent = `来源：${profile?.source ?? '未配置'} · ${profile?.instrument ?? 'IPIP-NEO 分面模拟'} · 版本 ${profile?.instrument_version ?? profile?.version ?? 1}`;
        find('personality-raw').textContent = readable({ source: profile?.source, instrument: profile?.instrument, instrument_version: profile?.instrument_version, scoring: profile?.scoring, raw_scores: profile?.raw_scores, quality_flags: profile?.quality_flags, adaptive_offsets: view.state?.adaptive_offsets ?? profile?.adaptive_offsets });
        const enabled = view.config?.personality?.adaptive_personality === true, rate = number(view.config?.personality?.adaptation_rate, .002), limit = number(view.config?.personality?.adaptation_limit, .1);
        find('adaptation-note').textContent = `${enabled ? '已启用' : '当前关闭，请在设置中启用'} · 单次变化上限 ±${rate} · 累计偏移上限 ±${limit}`;
        find('adaptation-delta').min = String(-rate); find('adaptation-delta').max = String(rate);
        root.querySelector('[data-action="personality-adapt"]').disabled = busy || !enabled;
        find('adaptation-offsets').textContent = `当前适应偏移\n${readable(view.state?.adaptive_offsets ?? {})}`;
        const history = array(view.state?.adaptation_history).slice(-10).reverse().map(item => {
            const card = element('article', null, 'pe-card'); card.append(element('p', item.reason ?? '人格适应'), note(`事件 ${item.event_id ?? item.id ?? ''} · ${readable(item.before, 500)} → ${readable(item.after, 500)}`));
            if (item.event_id ?? item.id) card.append(action('撤销本次适应', () => run(() => invoke('revokeEvent', item.event_id ?? item.id), '适应事件已撤销并重新计算'), true));
            return card;
        });
        find('adaptation-history').replaceChildren(...(history.length ? history : [note('暂无适应历史。')]));
    }
    function renderEmotion() {
        const emotion = view.state?.emotion ?? {}, current = emotion.current ?? {};
        const block = element('div', null, 'pe-metrics');
        for (const [key, title] of Object.entries(PAD)) block.append(element('span', `${title}：${number(current[key]).toFixed(2)}`));
        block.append(element('span', `强度：${number(emotion.intensity).toFixed(2)}`)); find('emotion-values').replaceChildren(block);
        const labels = { calm: '平静', joy: '开心', excitement: '兴奋', disappointment: '失望', anger: '愤怒', anxiety: '焦虑', shame: '羞愧', loneliness: '孤独', warmth: '温暖', complex: '复杂情绪' };
        find('emotion-labels').textContent = `当前标签：${array(emotion.labels).map(label => labels[label] ?? label).join('、') || '平静'} · 有效轮次：${number(view.state?.turn)}`;
        if (!root.contains(doc.activeElement) || !find('emotion-sliders').contains(doc.activeElement)) for (const [key, control] of emotionControls) writeSlider(control, clamp(current[key], -1, 1));
        if (doc.activeElement !== find('story-time')) find('story-time').value = String(number(view.state?.story_time));
        const chart = find('emotion-chart'); const history = [...array(emotion.history).slice(-59), { current }]; chart.replaceChildren();
        const svg = (tag, attributes) => { const node = doc.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value)); return node; };
        for (const y of [10, 50, 90]) chart.append(svg('line', { x1: 5, x2: 315, y1: y, y2: y, stroke: 'currentColor', opacity: '.15' }));
        Object.keys(PAD).forEach((key, index) => chart.append(svg('polyline', { points: history.map((entry, i) => `${5 + i / Math.max(1, history.length - 1) * 310},${50 - clamp((entry.current ?? entry.pad ?? entry)[key], -1, 1) * 40}`).join(' '), fill: 'none', stroke: ['#75b3a5', '#d8af6d', '#9f9cdd'][index], 'stroke-width': 2 })));
    }
    function historyList(history) {
        const list = element('ul', null, 'pe-history');
        for (const item of array(history).slice(-8).reverse()) list.append(element('li', typeof item === 'string' ? item : `${EVENT_NAMES[item.type] ?? item.type ?? item.reason ?? '状态变化'} · ${readable(item.deltas ?? item.effects ?? item.delta ?? item.relationship_effects ?? item.reason ?? item, 700)}`));
        return list;
    }
    function renderRelationships() {
        const cards = [];
        for (const [actor, relation] of Object.entries(view.state?.relationships ?? {})) {
            const card = element('article', null, 'pe-card'); card.append(element('h4', actor));
            for (const [key, title] of Object.entries(RELATIONS)) {
                const value = clamp(relation[key], 0, 100); const row = element('div', null, 'pe-field'); const meter = element('meter'); meter.min = 0; meter.max = 100; meter.value = value; meter.setAttribute('aria-label', `${actor} ${title} ${value.toFixed(1)}`);
                row.append(element('span', `${title} ${value.toFixed(1)}`), meter); card.append(row);
            }
            if (array(relation.history).length) { const detail = element('details'); detail.append(element('summary', '最近关系变化与原因'), historyList(relation.history)); card.append(detail); }
            cards.push(card);
        }
        find('relationships').replaceChildren(...(cards.length ? cards : [element('p', '尚无已确认的对象关系事件。', 'pe-empty')]));
    }
    function memoryCard(memory, pending = false) {
        const card = element('article', null, 'pe-card');
        const statuses = { active: '有效', revoked: '已撤销', corrected: '已修正', pending: '等待确认', superseded: '已替代' };
        card.append(element('h4', `${EVENT_NAMES[memory.type] ?? memory.type ?? '事件'} · ${pending ? '等待确认' : statuses[memory.status ?? 'active'] ?? memory.status}`));
        card.append(element('p', memory.summary ?? memory.evidence ?? '无摘要'));
        card.append(note(`重要程度 ${number(memory.importance ?? memory.intensity).toFixed(2)} · 置信度 ${number(memory.confidence).toFixed(2)} · ${array(memory.actors).join('、') || memory.actor || '未指定对象'}`));
        card.append(element('p', `来源：${array(memory.source_message_ids).join('，') || memory.source_message_id || '手动或待提交事件'} · ${memory.id ?? ''}`, 'pe-source'));
        const buttons = element('div', null, 'pe-actions');
        if (pending) buttons.append(action('确认高影响事件', () => run(() => invoke('confirmEvent', memory.id), '事件已确认并重新计算')));
        if (memory.status !== 'revoked') buttons.append(action(pending ? '拒绝事件' : '撤销事件及影响', () => run(() => invoke('revokeEvent', memory.id), '事件已撤销'), true));
        card.append(buttons);
        if (!pending) {
            const detail = element('details'); detail.append(element('summary', '修正记忆 / 澄清误解'));
            const field = element('textarea'); field.value = memory.summary ?? memory.evidence ?? ''; field.maxLength = 1000; field.setAttribute('aria-label', '修正后的事实摘要');
            detail.append(field, note('修改摘要不会改变事件类型。若原事件并未发生，请撤销事件后添加正确事实。'), action('保存修正', () => run(() => { if (!field.value.trim()) throw new Error('摘要不能为空'); return invoke('correctEvent', memory.id, { summary: field.value.trim() }); }, '记忆已修正'))); card.append(detail);
        }
        return card;
    }
    function renderMemories() {
        const state = view.state ?? {}; const query = find('memory-search').value.trim().toLocaleLowerCase();
        const pending = array(state.pending_events).length ? state.pending_events
            : array(state.memories).some(memory => memory.pending_confirmation) ? state.memories.filter(memory => memory.pending_confirmation)
                : array(state.events ?? state.event_log).filter(event => event.status === 'pending');
        find('pending-events').replaceChildren(...(pending.length ? [note('以下候选事件影响较高，尚未修改持久化状态。'), ...pending.slice(0, 30).map(event => memoryCard(event, true))] : []));
        const memories = array(state.memories).filter(memory => !memory.pending_confirmation && (!query || `${memory.summary} ${memory.type} ${memory.evidence} ${array(memory.actors).join(' ')}`.toLocaleLowerCase().includes(query)));
        find('memories').replaceChildren(...(memories.length ? memories.slice().reverse().slice(0, memoryLimit).map(memory => memoryCard(memory)) : [element('p', query ? '没有匹配的事件记忆。' : '暂无重要事件记忆。系统不会把不确定的聊天自动当成事实。', 'pe-empty')]));
        root.querySelector('[data-action="memory-more"]').hidden = memories.length <= memoryLimit;
    }
    function renderDebug() {
        find('prompt').textContent = readable(view.prompt ?? '', 20000);
        const debug = view.debug ?? {};
        const fields = [['最近一次事件提取', debug.extraction ?? debug.last_extraction], ['心理评价', debug.appraisal ?? debug.last_appraisal ?? view.state?.last_appraisals], ['状态变更前后', debug.diff ?? debug.last_diff], ['提交与回滚日志', array(debug.logs ?? debug.log).slice(-30)], ['错误信息', array(debug.errors).slice(-10)]];
        const blocks = fields.map(([title, value]) => { const detail = element('details'); detail.append(element('summary', title), element('pre', readable(value))); return detail; });
        find('debug-details').replaceChildren(...blocks);
    }
    function render() {
        if (destroyed) return;
        try { view = controller.getView() ?? {}; } catch (error) { errorStatus(error); renderStatus(); return; }
        renderStatus(); renderConfig(); renderPersonality(); renderEmotion(); renderRelationships();
        // Keep an open correction field intact when a chat event refreshes the panel.
        if (!find('memories').contains(doc.activeElement)) renderMemories();
        if (!find('debug-details').contains(doc.activeElement)) renderDebug();
    }
    render();
    return { render, destroy() { if (destroyed) return; destroyed = true; for (const dispose of disposers) dispose(); root.remove(); } };
}
