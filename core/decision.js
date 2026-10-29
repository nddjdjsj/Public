import { clamp, seededRandom } from './util.js';

export function behavioralPolicy(personality, emotion, relation = {}, appraisals = [], options = {}) {
    const p = personality, e = emotion.current, r = { trust:45, conflict:15, closeness:30, ...relation };
    const w = options.config?.engine || { decision_personality_weight:1, decision_emotion_weight:.8, decision_relation_weight:1, decision_memory_weight:.3, decision_goal_weight:.5, decision_temperature:.8 };
    const pw = w.decision_personality_weight, ew = w.decision_emotion_weight, rw = w.decision_relation_weight;
    const threat = appraisals.some(a => a.pad?.pleasure < -.4) ? .7 : 0;
    const conflictMemory = (options.memories || []).filter(m => m.relationship_effects?.conflict > 0).length / Math.max(1, (options.memories || []).length);
    const scores = {
        ask_explanation: pw * (p.A + p.O * .4) + rw * (r.trust / 100) + threat,
        assert_boundary: pw * (1 - p.A + p.C * .5) + rw * r.conflict / 100 + ew * Math.max(0, e.arousal - e.pleasure) + threat,
        withdraw: pw * (1 - p.E + p.N * .5) + ew * Math.max(0, -e.pleasure - e.dominance) + rw * (1 - r.trust / 100),
        repair: pw * (p.A + p.C * .3) + rw * r.closeness / 100 + ew * Math.max(0, e.pleasure) - threat * .3,
        engage: pw * (p.E + p.O * .3) + ew * Math.max(0, e.pleasure + e.arousal) + rw * r.trust / 100,
        reflect: pw * (p.C * .7 + 1 - p.E) + ew * Math.max(0, -e.arousal),
    };
    scores.assert_boundary += conflictMemory * w.decision_memory_weight;
    for (const [key, value] of Object.entries(options.goals || {})) if (Object.hasOwn(scores, key) && Number.isFinite(value)) scores[key] += clamp(value, -1, 1) * w.decision_goal_weight;
    if (options.constraints?.no_withdrawal) scores.withdraw -= 2;
    const max = Math.max(...Object.values(scores)), exp = Object.fromEntries(Object.entries(scores).map(([k,v]) => [k, Math.exp((v - max) / w.decision_temperature)])); const total = Object.values(exp).reduce((a,b)=>a+b,0);
    const strategies = Object.entries(scores).map(([id, score]) => ({ id, score, probability: exp[id] / total })).sort((a,b) => b.score-a.score);
    const rng = seededRandom(options.seed || 'psyche'), sample = rng(); let cumulative = 0, selected = strategies[0].id;
    for (const item of strategies) { cumulative += item.probability; if (sample <= cumulative) { selected = item.id; break; } }
    return { strategies, selected, style: { initiative: clamp(p.E * .6 + (e.arousal + 1) * .2), expressiveness: clamp(p.E * .4 + p.facets.O3 * .3 + emotion.intensity * .3), openness: clamp(p.O * .5 + r.trust / 200), caution: clamp(p.C * .35 + p.N * .25 + (100-r.trust)/250) }, rationale: { personality: { O:p.O,C:p.C,E:p.E,A:p.A,N:p.N }, mood:e, relationship:{trust:r.trust,conflict:r.conflict}, threat, conflict_memory:conflictMemory }, constraints: options.constraints || {} };
}
