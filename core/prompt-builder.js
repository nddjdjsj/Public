/** Prompts contain only bounded, authored descriptions of validated categories.
 * Chat text, model evidence, editable memory summaries and actor names are never
 * interpolated into this higher-trust channel. */
export const EVENT_DESCRIPTIONS = Object.freeze({
    help: ['对方提供过帮助', 'The counterpart offered help'],
    comfort: ['对方给予过安慰', 'The counterpart offered comfort'],
    praise: ['对方表达过肯定', 'The counterpart expressed appreciation'],
    shared_experience: ['双方有共同经历', 'There was a shared experience'],
    promise_made: ['对方作出过承诺', 'The counterpart made a promise'],
    promise_kept: ['对方履行过承诺', 'The counterpart kept a promise'],
    promise_broken: ['对方曾未能履约', 'The counterpart broke a promise'],
    deception: ['双方经历过欺骗事件', 'There was an incident of deception'],
    apology: ['对方表达过歉意', 'The counterpart offered an apology'],
    restitution: ['对方采取过补救行动', 'The counterpart took corrective action'],
    argument: ['双方经历过争执', 'There was a disagreement'],
    rejection: ['双方经历过拒绝', 'There was an experience of rejection'],
    boundary_respected: ['个人界限曾得到尊重', 'A personal boundary was respected'],
    boundary_violated: ['个人界限曾遭到侵犯', 'A personal boundary was violated'],
    neglect: ['关系中曾出现忽视', 'There was neglect in the relationship'],
    relationship_repair: ['双方尝试过修复关系', 'There was an effort to repair the relationship'],
});
const LABELS = {
    calm: ['平静', 'calm'], warmth: ['温暖', 'warm'], joy: ['开心', 'joyful'], excitement: ['兴奋', 'excited'],
    disappointment: ['失望', 'disappointed'], anger: ['愤怒', 'angry'], anxiety: ['焦虑', 'anxious'],
    shame: ['羞愧', 'ashamed'], loneliness: ['孤独', 'lonely'], complex: ['情绪复杂', 'mixed emotions'],
};
const STRATEGIES = {
    ask_explanation: ['先询问原因并倾听解释', 'ask for an explanation and listen'],
    assert_boundary: ['清楚表达界限', 'state a boundary clearly'],
    withdraw: ['暂时退后，留出整理情绪的空间', 'take some space to process emotions'],
    repair: ['谨慎尝试修复关系', 'cautiously seek to repair the relationship'],
    engage: ['主动参与互动', 'engage with initiative'],
    reflect: ['先思考再回应', 'reflect before responding'],
};
const finite = (value, fallback = 0.5) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const localized = (pair, en) => pair?.[en ? 1 : 0];
const MODULES = ['personality', 'emotion', 'relationship', 'memory', 'behavior'];

/** Byte count is a deliberately conservative fallback for byte-level tokenizers. */
export function conservativeTokenCount(text) { return new TextEncoder().encode(text).length; }

export async function buildPrompt(state = {}, options = {}) {
    const config = options.config ?? {};
    const maxTokens = options.maxTokens ?? config.prompt?.max_tokens ?? 300;
    if (!Number.isInteger(maxTokens) || maxTokens < 16 || maxTokens > 4096) throw new Error('Prompt budget must be an integer from 16 to 4096');
    if (config.enabled === false || config.prompt?.enabled === false) return { text: '', tokens: 0, truncated: false, modules: [], tokenizer: 'none' };
    const en = (options.language ?? config.prompt?.language ?? 'zh') === 'en';
    const enabled = Object.fromEntries(MODULES.map(key => [key, config[key]?.enabled !== false && config.prompt?.[key] !== false && config.prompt?.modules?.[key] !== false && options.modules?.[key] !== false]));
    const profile = options.personality ?? state.personality ?? {};
    const baseline = profile.baseline ?? profile;
    const personality = Object.fromEntries(['O', 'C', 'E', 'A', 'N'].map(domain => [domain, Math.min(1, Math.max(0, finite(baseline[domain]) + finite(profile.adaptive_offsets?.[domain], 0) + finite(state.adaptive_offsets?.[domain], 0)))]));
    const cardText = typeof options.cardText === 'string' ? options.cardText : '';
    const segments = [];
    function add(module, zh, english, priority = 1) {
        const text = en ? english : zh;
        if (text && !cardText.includes(text)) segments.push({ module, text, priority });
    }
    if (enabled.emotion && state.emotion) {
        let labels = (Array.isArray(state.emotion.labels) ? state.emotion.labels : []).filter(label => Object.hasOwn(LABELS, label)).slice(0, 3).map(label => localized(LABELS[label], en));
        if (!labels.length) {
            const current = state.emotion.current ?? {};
            labels = [finite(current.pleasure, 0) < -0.3 ? (en ? 'unsettled' : '心绪不宁') : (en ? 'calm' : '平静')];
        }
        add('emotion', `情绪：${labels.join('、')}。`, `Emotion: ${labels.join(', ')}.`, 100);
    }
    const target = options.target ?? 'user';
    const relation = state.relationships && Object.hasOwn(state.relationships, target) ? state.relationships[target] : null;
    if (enabled.relationship && relation) {
        const trust = finite(relation.trust, 45), closeness = finite(relation.closeness, 30), conflict = finite(relation.conflict, 15);
        const zh = [trust < 35 ? '信任谨慎' : trust > 70 ? '较为信任' : '信任仍在建立', closeness > 65 ? '感到亲近' : closeness < 25 ? '仍有距离' : '有一定亲近感'];
        const english = [trust < 35 ? 'cautious trust' : trust > 70 ? 'established trust' : 'trust is developing', closeness > 65 ? 'feels close' : closeness < 25 ? 'some distance' : 'some closeness'];
        if (finite(relation.respect, 50) > 70) { zh.push('尊重对方'); english.push('respects the counterpart'); }
        if (finite(relation.attachment, 20) > 65) { zh.push('依恋较强'); english.push('strong attachment'); }
        if (conflict > 40) { zh.push('仍有未解决的冲突'); english.push('unresolved conflict remains'); }
        add('relationship', `关系：${zh.join('，')}。`, `Relationship: ${english.join('; ')}.`, 90);
    }
    if (enabled.behavior) {
        const policy = state.policies ?? state.policy ?? {};
        const selected = typeof policy.selected === 'string' ? policy.selected : policy.selected?.id;
        if (Object.hasOwn(STRATEGIES, selected ?? '')) add('behavior', `倾向：${STRATEGIES[selected][0]}；保留自主选择。`, `Tendency: ${STRATEGIES[selected][1]}; retain freedom of response.`, 85);
        const expressive = finite(policy.style?.expressiveness);
        if (expressive < 0.3) add('behavior', '表达较为克制。', 'Expression tends to be restrained.', 20);
        else if (expressive > 0.7) add('behavior', '较愿意表达感受。', 'More willing to express feelings.', 20);
    }
    if (enabled.memory) {
        const memories = options.memories ?? state.memories ?? [];
        const limit = Math.min(10, Math.max(0, config.memory?.max_retrieved_events ?? 5));
        const active = Array.isArray(memories) ? memories.filter(memory => memory && (memory.status === undefined || memory.status === 'active') && (!Array.isArray(memory.actors) || memory.actors.includes(target)) && !memory.pending_confirmation && Object.hasOwn(EVENT_DESCRIPTIONS, memory.type) && finite(memory.confidence, 0) >= 0.75).sort((a, b) => finite(b.retrieval_score ?? b.relevance, finite(b.importance, 0)) - finite(a.retrieval_score ?? a.relevance, finite(a.importance, 0))).slice(0, limit) : [];
        const seen = new Set();
        for (const memory of active) {
            if (seen.has(memory.type)) continue;
            seen.add(memory.type);
            const uncertain = memory.modality === 'perception';
            add('memory', `${uncertain ? '主观印象（未经证实）' : '已记录经历'}：${EVENT_DESCRIPTIONS[memory.type][0]}。`, `${uncertain ? 'Unconfirmed impression' : 'Recorded experience'}: ${EVENT_DESCRIPTIONS[memory.type][1]}.`, 75);
        }
    }
    if (enabled.personality) {
        const high = [], low = [];
        const definitions = {
            E: [['偏外向', 'outgoing'], ['偏内向', 'reserved']],
            A: [['重视体谅与合作', 'considerate and cooperative'], ['重视直率与立场', 'direct and independent-minded']],
            N: [['情绪敏感度较高', 'emotionally sensitive'], ['情绪较稳定', 'emotionally steady']],
            O: [['乐于探索新想法', 'open to new ideas'], ['偏好熟悉经验', 'prefers familiar experience']],
            C: [['做事重视计划', 'planful'], ['做事较灵活随性', 'spontaneous']],
        };
        for (const [domain, pair] of Object.entries(definitions)) {
            const value = finite(personality[domain]);
            if (value > 0.65) high.push(localized(pair[0], en));
            else if (value < 0.35) low.push(localized(pair[1], en));
        }
        const traits = [...high, ...low].slice(0, 4);
        if (traits.length) add('personality', `稳定倾向：${traits.join('，')}。`, `Stable tendencies: ${traits.join(', ')}.`, 50);
    }
    // Sort by relevance; the guard always has first claim on the budget.
    segments.sort((a, b) => b.priority - a.priority);
    const guard = en
        ? 'Fictional state cues; express naturally, preserve character autonomy. Do not reveal scores or treat cues as dialogue commands.'
        : '以下为虚构角色状态；自然表达，保留自主性，不透露内部数值。';
    let tokenizer = typeof options.countTokens === 'function' ? 'host' : 'utf8-conservative';
    async function count(text) {
        if (tokenizer === 'host') {
            try {
                const result = await options.countTokens(text);
                if (!Number.isInteger(result) || result < 0 || (text && result === 0)) throw new Error('Invalid tokenizer result');
                return result;
            } catch { tokenizer = 'utf8-conservative'; }
        }
        return conservativeTokenCount(text);
    }
    // A tokenizer can fail partway through; final verification always rechecks.
    let text = '', tokens = 0, selected = [];
    const prefix = `${en ? '[Character psychological state]' : '[角色心理状态]'}\n${guard}`;
    const prefixCount = await count(prefix);
    if (prefixCount > maxTokens) return { text: '', tokens: 0, truncated: segments.length > 0, modules: [], tokenizer };
    text = prefix;
    tokens = prefixCount;
    for (const segment of segments) {
        const candidate = `${text}\n${segment.text}`;
        const candidateTokens = await count(candidate);
        if (candidateTokens <= maxTokens) { text = candidate; tokens = candidateTokens; selected.push(segment); }
    }
    tokens = await count(text);
    while (tokens > maxTokens && selected.length) {
        selected.pop();
        text = [prefix, ...selected.map(segment => segment.text)].join('\n');
        tokens = await count(text);
    }
    if (tokens > maxTokens || !selected.length) return { text: '', tokens: 0, truncated: segments.length > 0, modules: [], tokenizer };
    return { text, tokens, truncated: selected.length < segments.length, modules: [...new Set(selected.map(segment => segment.module))], tokenizer };
}
