import { assert, clamp, clone, number, plain, safeData, seededRandom } from './util.js';

export const DOMAINS = Object.freeze(['O', 'C', 'E', 'A', 'N']);
const names = {
    N: [['Anxiety','焦虑'],['Anger','愤怒'],['Depression','低落'],['Self-Consciousness','自我意识'],['Immoderation','无节制'],['Vulnerability','脆弱性']],
    E: [['Friendliness','友善'],['Gregariousness','合群'],['Assertiveness','自信表达'],['Activity Level','活跃程度'],['Excitement-Seeking','寻求刺激'],['Cheerfulness','愉快']],
    O: [['Imagination','想象力'],['Artistic Interests','艺术兴趣'],['Emotionality','情感体验'],['Adventurousness','探索变化'],['Intellect','思辨兴趣'],['Liberalism','观念开放']],
    A: [['Trust','信任倾向'],['Morality','坦诚'],['Altruism','利他'],['Cooperation','合作'],['Modesty','谦逊'],['Sympathy','同情']],
    C: [['Self-Efficacy','自我效能'],['Orderliness','条理'],['Dutifulness','责任感'],['Achievement-Striving','成就追求'],['Self-Discipline','自律'],['Cautiousness','谨慎']],
};
export const FACETS = Object.freeze(DOMAINS.flatMap(domain => names[domain].map(([name, label], i) => Object.freeze({ id: `${domain}${i + 1}`, domain, name, label }))));
export const FACET_IDS = Object.freeze(FACETS.map(f => f.id));

export function createPersonality(input = {}) {
    input = safeData(input); plain(input, 'personality');
    if (input.personality) input = plain(input.personality);
    assert(input.version === undefined || input.version === 1, 'Unsupported personality version');
    const baseline = {}, facets = {}, adaptive_offsets = {};
    const flags = Array.isArray(input.quality_flags) ? input.quality_flags.filter(x => typeof x === 'string').slice(0, 100) : [];
    for (const domain of DOMAINS) baseline[domain] = number(input.baseline?.[domain] ?? 0.5, 0, 1, domain);
    for (const facet of FACETS) {
        const value = input.facets?.[facet.id]; facets[facet.id] = value === undefined ? baseline[facet.domain] : number(value, 0, 1, facet.id);
        if (value === undefined) flags.push(`imputed:${facet.id}`);
    }
    for (const [key, value] of Object.entries(input.adaptive_offsets || {})) { assert(DOMAINS.includes(key) || FACET_IDS.includes(key), 'Unknown adaptation trait'); adaptive_offsets[key] = number(value, -0.25, 0.25, 'adaptive offset'); }
    const raw_scores = { domains: {}, facets: {} };
    for (const [kind, ids, lo, hi] of [['domains', DOMAINS, 24, 120], ['facets', FACET_IDS, 4, 20]]) {
        for (const [key, value] of Object.entries(input.raw_scores?.[kind] || {})) { assert(ids.includes(key), 'Unknown raw score'); raw_scores[kind][key] = number(value, lo, hi, `raw ${key}`); }
    }
    return { version: 1, baseline, facets, adaptive_offsets,
        source: String(input.source || 'manual').slice(0, 100), instrument: String(input.instrument || 'IPIP-NEO-120').slice(0, 120),
        instrument_version: String(input.instrument_version || 'Johnson-2014').slice(0, 120), scoring: String(input.scoring || 'internal-normalization').slice(0, 160),
        raw_scores, quality_flags: [...new Set(flags)], provenance: clone(input.provenance || {}),
    };
}
export const validatePersonality = createPersonality;
export function effectivePersonality(personality, offsets = {}) {
    const p = createPersonality(personality), result = { facets: {} };
    for (const d of DOMAINS) result[d] = clamp(p.baseline[d] + (p.adaptive_offsets[d] || 0) + (offsets[d] || 0));
    for (const f of FACETS) result.facets[f.id] = clamp(p.facets[f.id] + (p.adaptive_offsets[f.id] || 0) + (offsets[f.id] || 0) + (offsets[f.domain] || 0));
    return result;
}
export function createPreset(name = 'mixed', seed = 1) {
    const presets = { extravert: { O: .65, C: .55, E: .88, A: .62, N: .3 }, introvert: { O: .72, C: .65, E: .15, A: .6, N: .45 }, agreeable: { O: .55, C: .65, E: .5, A: .9, N: .4 }, sensitive: { O: .65, C: .5, E: .35, A: .65, N: .88 }, mixed: { O: .8, C: .35, E: .4, A: .7, N: .6 } };
    assert(Object.hasOwn(presets, name) || name === 'random', 'Unknown personality preset'); const rng = seededRandom(seed);
    const baseline = name === 'random' ? Object.fromEntries(DOMAINS.map(d => [d, .1 + rng() * .8])) : presets[name];
    const facets = Object.fromEntries(FACETS.map(f => [f.id, clamp(baseline[f.domain] + (rng() - .5) * .2)]));
    return createPersonality({ baseline, facets, source: 'simulated', quality_flags: ['simulated-not-a-test-result'], provenance: { preset: name, seed } });
}
