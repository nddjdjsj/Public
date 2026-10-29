import { DOMAINS, FACETS, validatePersonality } from '../core/personality.js';
import { assertSafeData, parseUntrustedJSON } from './event-extractor.js';

const TRAITS = new Set([...DOMAINS, ...FACETS.map(f => f.id)]);
const PROFILE_KEYS = new Set(['version', 'baseline', 'facets', 'adaptive_offsets', 'source', 'instrument', 'instrument_version', 'scoring', 'raw_scores', 'quality_flags', 'provenance']);
const MAX_IMPORT_LENGTH = 128000;

/** RFC 4180-style parser: quoted commas/newlines and doubled quotes supported. */
export function parseCSV(input) {
    if (typeof input !== 'string' || input.length > MAX_IMPORT_LENGTH) throw new Error('Invalid CSV size');
    const rows = [];
    let row = [], field = '', quoted = false, closed = false;
    const text = input.replace(/^\uFEFF/u, '');
    function endField() { row.push(field); field = ''; closed = false; }
    function endRow() { endField(); if (row.some(v => v !== '')) rows.push(row); row = []; }
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') { quoted = false; closed = true; }
            else field += ch;
        } else if (ch === '"') {
            if (field || closed) throw new Error('Malformed CSV quoting');
            quoted = true;
        } else if (ch === ',') endField();
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; endRow(); }
        else if (closed) throw new Error('Unexpected character after quoted CSV field');
        else field += ch;
        if (rows.length > 200 || row.length > 20 || field.length > 2000) throw new Error('CSV exceeds import limits');
    }
    if (quoted) throw new Error('Unclosed CSV quote');
    if (field || row.length || closed) endRow();
    return rows;
}

function finiteScore(value, low, high, name) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) throw new Error(`Invalid ${name} score; expected ${low}..${high}`);
    return value;
}

function normalizeProfile(input) {
    assertSafeData(input);
    if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('Expected personality object');
    if (Object.keys(input).some(key => !PROFILE_KEYS.has(key))) throw new Error('Unknown personality field; unsupported percentile or norm scores must be converted explicitly');
    if (input.scoring && !['internal-normalization', 'raw-linear-normalization', 'raw-ipip-neo-120'].includes(input.scoring)) throw new Error('Unsupported scoring method; population percentiles are not inferred');
    const profile = structuredClone(input);
    profile.baseline ??= {};
    profile.facets ??= {};
    profile.raw_scores ??= { domains: {}, facets: {} };
    profile.quality_flags ??= [];
    for (const [obj, label] of [[profile.baseline, 'baseline'], [profile.facets, 'facets'], [profile.raw_scores, 'raw_scores']]) {
        if (!obj || Array.isArray(obj) || typeof obj !== 'object') throw new Error(`Invalid ${label}`);
    }
    if (!Array.isArray(profile.quality_flags) || profile.quality_flags.some(v => typeof v !== 'string' || v.length > 200)) throw new Error('Invalid quality flags');
    if (profile.provenance !== undefined && (!profile.provenance || Array.isArray(profile.provenance) || typeof profile.provenance !== 'object')) throw new Error('Invalid provenance');
    if (Object.keys(profile.raw_scores).some(k => !['domains', 'facets'].includes(k))) throw new Error('Unknown raw score field');
    for (const [kind, ids, low, high] of [['domains', DOMAINS, 24, 120], ['facets', FACETS.map(f => f.id), 4, 20]]) {
        const values = profile.raw_scores[kind] ?? {};
        if (!values || Array.isArray(values) || typeof values !== 'object') throw new Error('Invalid raw score object');
        const normalized = kind === 'domains' ? profile.baseline : profile.facets;
        for (const [id, value] of Object.entries(values)) {
            if (!ids.includes(id)) throw new Error('Unknown raw trait');
            finiteScore(value, low, high, id);
            if (!Number.isInteger(value)) throw new Error('IPIP-NEO-120 summed raw scores must be integers');
            if (profile.instrument && profile.instrument !== 'IPIP-NEO-120') throw new Error('Raw-score normalization is only defined for IPIP-NEO-120');
            const converted = (value - low) / (high - low);
            if (normalized[id] === undefined) normalized[id] = converted;
            else if (Math.abs(finiteScore(normalized[id], 0, 1, id) - converted) > 0.011) profile.quality_flags.push(`normalized-raw-mismatch:${id}`);
        }
    }
    for (const [id, value] of Object.entries(profile.baseline)) {
        if (!DOMAINS.includes(id)) throw new Error(`Unknown domain ${id}`);
        finiteScore(value, 0, 1, id);
    }
    for (const [id, value] of Object.entries(profile.facets)) {
        if (!FACETS.some(f => f.id === id)) throw new Error(`Unknown facet ${id}`);
        finiteScore(value, 0, 1, id);
    }
    if (!Object.keys(profile.baseline).length && !Object.keys(profile.facets).length) throw new Error('No usable personality scores');
    for (const domain of DOMAINS) {
        if (profile.baseline[domain] !== undefined) continue;
        const facets = FACETS.filter(f => f.domain === domain);
        if (facets.every(f => profile.facets[f.id] !== undefined)) {
            profile.baseline[domain] = facets.reduce((sum, f) => sum + profile.facets[f.id], 0) / 6;
            profile.quality_flags.push(`domain-derived-from-facets:${domain}`);
        } else {
            profile.baseline[domain] = 0.5;
            profile.quality_flags.push(`missing-domain-default:${domain}`);
        }
    }
    profile.provenance = { ...(profile.provenance ?? {}), imported_source: String(profile.source ?? 'external').slice(0, 100) };
    profile.source = input.source === 'simulated' ? 'simulated' : 'import';
    profile.scoring = 'internal-normalization';
    profile.quality_flags.push('internal-normalization-not-population-percentile');
    return validatePersonality(profile);
}

/** Accepted JSON is the documented profile; CSV uses trait,raw,normalized. */
export function importPersonality(input, { format = 'json' } = {}) {
    if (format === 'json') {
        const parsed = typeof input === 'string' ? parseUntrustedJSON(input, MAX_IMPORT_LENGTH) : assertSafeData(input);
        if (JSON.stringify(parsed).length > MAX_IMPORT_LENGTH) throw new Error('Personality import is too large');
        return normalizeProfile(parsed);
    }
    if (format !== 'csv') throw new Error('Supported formats: json, csv');
    const rows = parseCSV(input);
    if (!rows.length || rows[0].join(',').trim().toLowerCase() !== 'trait,raw,normalized') throw new Error('CSV header must be trait,raw,normalized');
    const profile = { baseline: {}, facets: {}, raw_scores: { domains: {}, facets: {} }, quality_flags: [], instrument: 'IPIP-NEO-120' };
    const seen = new Set();
    for (const row of rows.slice(1)) {
        if (row.length !== 3) throw new Error('CSV rows must have exactly three columns');
        const [id, raw, normalized] = row.map(v => v.trim());
        if (!TRAITS.has(id) || seen.has(id)) throw new Error('Unknown or duplicate CSV trait');
        if (!raw && !normalized) throw new Error(`Missing score for ${id}`);
        seen.add(id);
        const domain = DOMAINS.includes(id);
        if (raw) profile.raw_scores[domain ? 'domains' : 'facets'][id] = parseNumber(raw);
        if (normalized) profile[domain ? 'baseline' : 'facets'][id] = parseNumber(normalized);
    }
    return normalizeProfile(profile);
}

function parseNumber(text) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(text)) throw new Error('CSV scores must be plain nonnegative decimal numbers');
    return Number(text);
}

export function exportPersonality(profile, { format = 'json' } = {}) {
    const validated = validatePersonality(assertSafeData(profile));
    if (format === 'json') return JSON.stringify(validated, null, 2);
    if (format !== 'csv') throw new Error('Supported formats: json, csv');
    return ['trait,raw,normalized', ...[...DOMAINS, ...FACETS.map(f => f.id)].map(id => {
        const domain = DOMAINS.includes(id);
        return `${id},${validated.raw_scores[domain ? 'domains' : 'facets'][id] ?? ''},${validated[domain ? 'baseline' : 'facets'][id]}`;
    })].join('\r\n');
}
