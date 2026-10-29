import { clamp, clone, number, plain, assert } from './util.js';

// Engineering defaults; replace each event dimension with config.engine.event_overrides.
const row = (pad, relation, tags) => ({ pad: { pleasure: pad[0], arousal: pad[1], dominance: pad[2] }, relation: { trust: relation[0], closeness: relation[1], respect: relation[2], attachment: relation[3], conflict: relation[4] }, tags });
export const EVENT_REGISTRY = {
    help: row([.65,.15,.2], [4,3,3,1,-1], ['warmth']),
    comfort: row([.55,-.25,.15], [3,4,1,2,-2], ['warmth']),
    praise: row([.5,.2,.15], [1,2,2,1,0], ['joy']),
    shared_experience: row([.4,.3,.1], [2,3,2,3,-1], ['warmth']),
    promise_made: row([.2,.1,.05], [0,1,0,1,0], ['calm']),
    promise_kept: row([.6,.1,.25], [5,3,4,2,-2], ['warmth']),
    promise_broken: row([-.7,.35,-.3], [-9,-3,-4,0,6], ['disappointment']),
    deception: row([-.85,.55,-.4], [-12,-5,-7,-1,9], ['anger','disappointment']),
    apology: row([.15,-.15,.05], [.7,1,1,0,-1], ['complex']),
    restitution: row([.5,-.15,.2], [3,2,3,1,-3], ['warmth']),
    argument: row([-.5,.65,.1], [-3,-1,-2,0,6], ['anger']),
    rejection: row([-.5,.15,-.25], [-1,-2,0,-1,2], ['disappointment']),
    boundary_respected: row([.5,-.2,.4], [4,2,4,0,-2], ['calm']),
    boundary_violated: row([-.8,.7,-.6], [-10,-4,-7,-1,10], ['anger','anxiety']),
    neglect: row([-.5,-.15,-.3], [-4,-4,-1,-2,3], ['loneliness']),
    relationship_repair: row([.4,-.2,.15], [2,3,2,1,-3], ['complex']),
};
export function registerEventType(type, definition) {
    assert(/^[a-z_]{2,40}$/.test(type) && !['__proto__','constructor','prototype'].includes(type) && !Object.hasOwn(EVENT_REGISTRY, type), 'Invalid or duplicate event type'); plain(definition); plain(definition.pad); plain(definition.relation);
    for (const d of ['pleasure','arousal','dominance']) number(definition.pad[d], -1, 1, d);
    for (const d of ['trust','closeness','respect','attachment','conflict']) number(definition.relation[d], -20, 20, d);
    assert(Array.isArray(definition.tags) && definition.tags.every(t => typeof t === 'string'), 'Tags must be strings');
    EVENT_REGISTRY[type] = clone(definition);
}
export function appraiseEvent(event, personality, state, config) {
    const template = EVENT_REGISTRY[event.type]; assert(template, `Unknown event type ${event.type}`);
    const relationKey = event.actor === 'character' ? event.target : event.actor;
    const relation = state.relationships[relationKey] || { trust: 45, closeness: 30, respect: 50, attachment: 20, conflict: 15 };
    const priorCount = state.memory_counts ? state.memory_counts[relationKey]?.[event.type] || 0
        : state.memories.filter(m => m.status === 'active' && !m.pending_confirmation && m.type === event.type && m.actors.includes(relationKey)).length;
    const override = config.engine.event_overrides[event.type] || {};
    const pad = Object.fromEntries(Object.keys(template.pad).map(k => [k, clamp(override[k] ?? template.pad[k], -1, 1)]));
    const weights = Object.fromEntries(Object.keys(template.relation).map(k => [k, override[k] ?? template.relation[k]]));
    const f = personality.facets, fw = config.engine.facet_response_weight;
    if (pad.pleasure < 0) {
        pad.arousal = clamp(pad.arousal + ((f.N2 + f.N1) / 2 - .5) * fw, -1, 1);
        pad.dominance = clamp(pad.dominance - (f.N6 - .5) * fw, -1, 1);
    }
    if (event.type.startsWith('promise_')) weights.trust *= 1 + (f.C3 - .5) * fw;
    if (weights.trust > 0) weights.trust *= 1 + (f.A1 - .5) * fw;
    if (weights.conflict > 0) weights.conflict *= 1 - (f.A4 - .5) * fw;
    const sensitivity = pad.pleasure < 0 ? 1 + (personality.N - .5) * config.engine.neuroticism_gain : 1 + (personality.E - .5) * config.engine.extraversion_gain;
    const history = 1 + (relation.conflict / 100) * config.engine.relation_history_weight + Math.min(priorCount, 5) / 5 * config.engine.memory_weight;
    const impact = clamp(event.intensity * event.confidence * sensitivity * history, 0, 2);
    const shouldConfirm = (event.requires_confirmation === true || event.intensity >= config.relationship.high_impact_threshold) && !event.confirmed;
    const applicable = event.modality !== 'perception' || event.confirmed === true;
    return { event_id: event.id, type: event.type, relation_key: relationKey, pad, relation_weights: weights,
        impact, tags: [...template.tags], importance: clamp(event.intensity * event.confidence * (.65 + Math.abs(pad.pleasure) * .35)),
        apply_relationship: applicable && !shouldConfirm, requires_confirmation: shouldConfirm,
        reason: shouldConfirm ? 'high-impact event pending confirmation' : !applicable ? 'subjective perception; relationship effect withheld' : 'validated event',
    };
}
