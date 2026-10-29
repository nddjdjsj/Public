import { bounded, clamp, clone, mean } from './util.js';

export const PAD_KEYS = Object.freeze(['pleasure','arousal','dominance']);
export function emotionBaseline(p) { return { pleasure: clamp((p.E - .5) * .25 + (p.A - .5) * .15 - (p.N - .5) * .25, -1, 1), arousal: clamp((p.E - .5) * .3 + (p.N - .5) * .15, -1, 1), dominance: clamp((p.C - .5) * .3 + (p.E - .5) * .15 - (p.N - .5) * .25, -1, 1) }; }
export function createEmotion(p) { const baseline = emotionBaseline(p); return { baseline, current: clone(baseline), intensity: 0, labels: ['calm'], history: [], duration: 0 }; }
export function emotionLabels(current, tags = []) {
    const { pleasure: p, arousal: a, dominance: d } = current;
    const labels = new Set();
    if (Math.abs(p) < .16 && Math.abs(a) < .2) labels.add('calm');
    if (p > .15) labels.add(a > .35 ? 'excitement' : tags.includes('warmth') ? 'warmth' : 'joy');
    if (p < -.12) {
        for (const tag of tags) if (['disappointment','anger','anxiety','shame','loneliness'].includes(tag)) labels.add(tag);
        if (!labels.size) labels.add(a > .25 && d < 0 ? 'anxiety' : 'disappointment');
    }
    if (tags.includes('complex') || labels.size > 2) labels.add('complex');
    return labels.size ? [...labels].slice(0, 4) : ['calm'];
}
export function recoverEmotion(emotion, amount, config) {
    if (!(amount > 0)) return clone(emotion);
    const speed = { slow: .5, standard: 1, fast: 2 }[config.emotion.speed];
    const decay = Math.pow(1 - config.engine.emotion_recovery, Math.min(amount, 10000) * config.emotion.decay_speed * speed);
    const current = Object.fromEntries(PAD_KEYS.map(k => [k, clamp(emotion.baseline[k] + (emotion.current[k] - emotion.baseline[k]) * decay, -1, 1)]));
    return { ...clone(emotion), current, intensity: clamp(mean(PAD_KEYS.map(k => Math.abs(current[k] - emotion.baseline[k])))), labels: emotionLabels(current), duration: emotion.duration + amount };
}
export function updateEmotion(emotion, appraisal, config) {
    const next = clone(emotion);
    // Events add to the current state; recovery runs once per explicit story-time/turn boundary.
    for (const key of PAD_KEYS) next.current[key] = clamp(next.current[key] + appraisal.pad[key] * appraisal.impact * config.emotion.sensitivity * config.engine.event_gain, -1, 1);
    next.intensity = clamp(mean(PAD_KEYS.map(k => Math.abs(next.current[k] - next.baseline[k]))));
    next.labels = emotionLabels(next.current, appraisal.tags); next.duration = 0;
    next.history = bounded([...next.history, { event_id: appraisal.event_id, current: clone(next.current), labels: [...next.labels] }], config.engine.history_limit);
    return next;
}
