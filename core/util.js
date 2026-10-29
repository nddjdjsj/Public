/** Pure, dependency-free utilities. Never evaluate imported data. */
export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
export const clone = value => JSON.parse(JSON.stringify(value));
export function assert(condition, message) { if (!condition) throw new TypeError(message); }
export function number(value, min, max, name) { assert(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `${name} must be a finite number in [${min},${max}]`); return value; }
export function plain(value, name = 'data') { assert(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${name} must be a plain object`); return value; }
export function safeData(value, depth = 0) {
    assert(depth < 25, 'Data nesting exceeds limit');
    if (value === null || ['string', 'boolean'].includes(typeof value)) { if (typeof value === 'string') assert(value.length <= 200000, 'Text too long'); return value; }
    if (typeof value === 'number') { assert(Number.isFinite(value), 'Non-finite number'); return value; }
    if (Array.isArray(value)) { assert(value.length <= 100000, 'Array exceeds limit'); return value.map(v => safeData(v, depth + 1)); }
    plain(value); const out = {};
    for (const [key, val] of Object.entries(value)) { assert(!['__proto__', 'prototype', 'constructor'].includes(key), 'Unsafe object key'); out[key] = safeData(val, depth + 1); }
    return out;
}
export function hash(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value); let result = 2166136261;
    for (let i = 0; i < text.length; i++) result = Math.imul(result ^ text.charCodeAt(i), 16777619);
    return (result >>> 0).toString(36);
}
export function seededRandom(seed = 1) { let s = parseInt(hash(String(seed)), 36) >>> 0; return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const bounded = (items, limit = 100) => items.slice(-limit);
export const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
