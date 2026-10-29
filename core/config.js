import { assert, clone, number, plain, safeData } from './util.js';

export const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    tools: { enabled: true, allow_event_proposals: true, max_calls_per_turn: 8 },
    personality: { enabled: true, model: 'ipip_neo_30', adaptive_personality: false, adaptation_limit: 0.1, adaptation_rate: 0.002 },
    emotion: { enabled: true, sensitivity: 1, decay_speed: 1, recovery_mode: 'story', speed: 'standard' },
    relationship: { enabled: true, max_event_delta: 10, diminishing_returns: true, trust_recovery_limit: 3, apology_trust_budget: 2, high_impact_threshold: 0.85 },
    memory: { enabled: true, max_retrieved_events: 5, importance_threshold: 0.35, working_limit: 12, retrieval_candidates: 256 },
    event_extraction: { mode: 'rules', minimum_confidence: 0.75, timeout_ms: 12000, max_calls_per_turn: 1 },
    prompt: { enabled: true, max_tokens: 300, language: 'zh', personality: true, emotion: true, relationship: true, memory: true, behavior: true },
    debug: false,
    engine: {
        emotion_recovery: 0.12, event_gain: 0.32, neuroticism_gain: 0.8, extraversion_gain: 0.35,
        relation_history_weight: 0.25, memory_weight: 0.15, frequency_decay: 0.6,
        emotion_relation_weight: 0.2, personality_relation_weight: 0.3, facet_response_weight: 0.3,
        decision_personality_weight: 1, decision_emotion_weight: 0.8, decision_relation_weight: 1,
        decision_memory_weight: 0.3, decision_goal_weight: 0.5, decision_temperature: 0.8,
        snapshot_interval: 25, max_snapshots: 3, history_limit: 100, max_events: 20000,
        event_overrides: {},
    },
});
const RANGES = {
    'tools.max_calls_per_turn': [1, 20],
    'personality.adaptation_limit': [0, 0.25], 'personality.adaptation_rate': [0, 0.01],
    'emotion.sensitivity': [0, 3], 'emotion.decay_speed': [0.05, 5],
    'relationship.max_event_delta': [0, 20], 'relationship.trust_recovery_limit': [0, 10], 'relationship.apology_trust_budget': [0, 5], 'relationship.high_impact_threshold': [0.5, 1],
    'memory.max_retrieved_events': [0, 20], 'memory.importance_threshold': [0, 1], 'memory.working_limit': [1, 100], 'memory.retrieval_candidates': [32, 2048],
    'event_extraction.minimum_confidence': [0.5, 1], 'event_extraction.timeout_ms': [100, 60000], 'event_extraction.max_calls_per_turn': [0, 3],
    'prompt.max_tokens': [32, 2000],
    'engine.emotion_recovery': [0, 1], 'engine.event_gain': [0, 1], 'engine.neuroticism_gain': [0, 3], 'engine.extraversion_gain': [0, 3],
    'engine.relation_history_weight': [0, 2], 'engine.memory_weight': [0, 2], 'engine.frequency_decay': [0, 3],
    'engine.emotion_relation_weight': [0, 2], 'engine.personality_relation_weight': [0, 2], 'engine.facet_response_weight': [0, 2],
    'engine.decision_personality_weight': [0, 5], 'engine.decision_emotion_weight': [0, 5], 'engine.decision_relation_weight': [0, 5],
    'engine.decision_memory_weight': [0, 5], 'engine.decision_goal_weight': [0, 5], 'engine.decision_temperature': [0.1, 5],
    'engine.snapshot_interval': [1, 500], 'engine.max_snapshots': [1, 10], 'engine.history_limit': [10, 500], 'engine.max_events': [100, 100000],
};
const CHOICES = { 'personality.model': ['ipip_neo_30'], 'emotion.recovery_mode': ['story', 'turn', 'event'], 'emotion.speed': ['slow', 'standard', 'fast'], 'event_extraction.mode': ['rules', 'llm'], 'prompt.language': ['zh', 'en'] };
const INTEGER_OPTIONS = new Set(['tools.max_calls_per_turn','memory.max_retrieved_events','memory.working_limit','memory.retrieval_candidates','event_extraction.timeout_ms','event_extraction.max_calls_per_turn','prompt.max_tokens','engine.snapshot_interval','engine.max_snapshots','engine.history_limit','engine.max_events']);
function merge(template, input, prefix = '') {
    plain(input, prefix || 'config'); const out = clone(template);
    for (const [key, value] of Object.entries(input)) {
        assert(Object.hasOwn(template, key), `Unknown config option ${prefix}${key}`); const path = `${prefix}${key}`;
        if (path === 'engine.event_overrides') {
            plain(value); for (const [event, weights] of Object.entries(value)) { assert(/^[a-z_]{2,40}$/.test(event), 'Invalid event override'); plain(weights); for (const [dimension, weight] of Object.entries(weights)) { assert(['pleasure','arousal','dominance','trust','closeness','respect','attachment','conflict'].includes(dimension), 'Invalid override dimension'); number(weight, -20, 20, path); } }
            out[key] = clone(value);
        } else if (typeof template[key] === 'object') out[key] = merge(template[key], value, `${path}.`);
        else if (typeof template[key] === 'boolean') { assert(typeof value === 'boolean', `${path} must be boolean`); out[key] = value; }
        else if (RANGES[path]) { out[key] = number(value, ...RANGES[path], path); if (INTEGER_OPTIONS.has(path)) assert(Number.isInteger(value), `${path} must be an integer`); }
        else { assert(CHOICES[path]?.includes(value), `Invalid option ${path}`); out[key] = value; }
    }
    return out;
}
export function validateConfig(input = {}) { return merge(DEFAULT_CONFIG, safeData(input)); }
