import { bounded, clamp, clone } from './util.js';

export const RELATION_DIMENSIONS = Object.freeze(['trust','closeness','respect','attachment','conflict']);
export const createRelationship = () => ({ trust: 45, closeness: 30, respect: 50, attachment: 20, conflict: 15, history: [], counts: {} });
export function updateRelationship(current, event, appraisal, personality, emotion, config) {
    const next = clone(current || createRelationship()), effects = {};
    if (!appraisal.apply_relationship) return { relationship: next, effects };
    next.apology_trust_remaining ??= config.relationship.apology_trust_budget;
    const count = next.counts[event.type] || 0;
    const diminishing = config.relationship.diminishing_returns ? 1 / Math.sqrt(1 + count * config.engine.frequency_decay) : 1;
    for (const key of RELATION_DIMENSIONS) {
        let weight = appraisal.relation_weights[key];
        const agreeableness = key === 'conflict' ? 1 - (personality.A - .5) * config.engine.personality_relation_weight : 1 + (personality.A - .5) * config.engine.personality_relation_weight;
        const mood = 1 + (weight < 0 ? -emotion.current.pleasure : emotion.current.pleasure) * config.engine.emotion_relation_weight;
        let delta = weight * appraisal.impact * diminishing * agreeableness * mood;
        if (key === 'trust' && delta > 0) delta = Math.min(delta, config.relationship.trust_recovery_limit);
        // Accumulation slows near either bound. Attachment and trust remain independent.
        const headroom = delta > 0 ? (100 - next[key]) / 100 : next[key] / 100;
        delta *= .35 + .65 * headroom;
        delta = clamp(delta, -config.relationship.max_event_delta, config.relationship.max_event_delta);
        if (key === 'trust' && event.type === 'apology' && delta > 0) delta = Math.min(delta,next.apology_trust_remaining);
        const value = clamp(next[key] + delta, 0, 100); effects[key] = value - next[key]; next[key] = value;
        if (key === 'trust' && event.type === 'apology' && delta > 0) next.apology_trust_remaining = Math.max(0,next.apology_trust_remaining-effects[key]);
        if (key === 'trust' && effects[key] < 0) next.apology_trust_remaining = config.relationship.apology_trust_budget;
    }
    next.counts[event.type] = count + 1;
    next.history = bounded([...next.history, { event_id: event.id, type: event.type, effects, reason: appraisal.reason }], config.engine.history_limit);
    return { relationship: next, effects };
}
