import { clamp, clone, hash } from './util.js';

export function createMemory(event, appraisal, effects = {}) {
    return { id: event.id, type: event.type, summary: String(event.summary || event.evidence || event.type).slice(0, 500), actors: [...new Set([event.actor, event.target])],
        importance: appraisal.importance, confidence: event.confidence, emotion_tags: [...appraisal.tags], relationship_effects: clone(effects),
        source_message_ids: [...event.source_message_ids], source_revisions: clone(event.source_revisions || {}), created_at: event.created_at || null,
        story_time: event.story_time ?? null, status: event.status === 'revoked' ? 'revoked' : 'active', modality: event.modality,
        correction_history: clone(event.correction_history || []), pending_confirmation: appraisal.requires_confirmation,
        layer: appraisal.importance >= .7 ? 'autobiographical' : appraisal.importance >= .35 ? 'important' : 'working',
    };
}
function tokens(text) { return new Set(String(text).toLowerCase().match(/[a-z0-9_]+|[\u3400-\u9fff]/g) || []); }
/** Bounded posting lists: rare scene words can retrieve old memories without scanning the chat. */
export class MemoryIndex {
    constructor(memories = [], { candidateLimit = 256, tokenLimit = 50000 } = {}) {
        this.limit = candidateLimit; this.tokenLimit = tokenLimit; this.byId = new Map(); this.byToken = new Map(); this.byActor = new Map(); this.recent = []; this.important = [];
        for (const memory of memories) this.add(memory);
    }
    add(memory) {
        if(memory.pending_confirmation || memory.status!=='active')return;
        if (this.byId.has(memory.id)) this.remove(memory.id);
        const words = [...tokens(memory.summary)].slice(0,64); this.byId.set(memory.id,{ memory,words });
        for (const word of words) {
            if (!this.byToken.has(word) && this.byToken.size >= this.tokenLimit) this.byToken.delete(this.byToken.keys().next().value);
            const ids = this.byToken.get(word) || []; ids.push(memory.id); if (ids.length > this.limit) ids.shift(); this.byToken.set(word,ids);
        }
        for (const actor of memory.actors) { const ids=this.byActor.get(actor)||[]; ids.push(memory.id); if(ids.length>this.limit)ids.shift();this.byActor.set(actor,ids); }
        this.recent.push(memory.id); if (this.recent.length>this.limit)this.recent.shift();
        this.important.push(memory.id); this.important.sort((a,b)=>this.byId.get(b).memory.importance-this.byId.get(a).memory.importance || a.localeCompare(b));
        if(this.important.length>this.limit)this.important.length=this.limit;
    }
    remove(id) {
        const record=this.byId.get(id);if(!record)return;
        for(const word of record.words){const ids=(this.byToken.get(word)||[]).filter(x=>x!==id);if(ids.length)this.byToken.set(word,ids);else this.byToken.delete(word);}
        for(const actor of record.memory.actors){const ids=(this.byActor.get(actor)||[]).filter(x=>x!==id);if(ids.length)this.byActor.set(actor,ids);else this.byActor.delete(actor);}
        this.byId.delete(id);this.recent=this.recent.filter(x=>x!==id);this.important=this.important.filter(x=>x!==id);
    }
    candidates(query='', options={}) {
        const ids=new Set(), matches=[];
        for(const word of [...tokens(query)].slice(0,64)) {
            const posting=this.byToken.get(word)||[];
            // Prefer selective words. A common term cannot displace every rare match.
            if(posting.length)matches.push(posting);
        }
        matches.sort((a,b)=>a.length-b.length);
        const insert=list=>{for(let i=list.length-1;i>=0 && ids.size<this.limit;i--)ids.add(list[i]);};
        for(const posting of matches)insert(posting);
        insert(this.byActor.get(options.actor||'user')||[]);insert(this.important);insert(this.recent);
        return [...ids].map(id=>this.byId.get(id)?.memory).filter(Boolean);
    }
}
export function retrieveMemories(memories, query = '', options = {}) {
    const q = tokens(query), limit = options.limit ?? 5;
    const mood = new Set(options.emotion_tags || []); const actor = options.actor || 'user';
    return memories.filter(m => m.status === 'active' && !m.pending_confirmation).map(m => {
        const words = tokens(m.summary); let overlap = 0; for (const word of q) if (words.has(word)) overlap++;
        const relevance = q.size ? overlap / Math.sqrt(q.size * Math.max(1, words.size)) : 0;
        const time = Math.max(0, (options.story_time ?? m.story_time ?? 0) - (m.story_time ?? 0));
        const score = relevance * .4 + m.importance * .25 + 1 / (1 + time / 24) * .1 + (m.actors.includes(actor) ? .1 : 0) + (m.emotion_tags.some(t => mood.has(t)) ? .08 : 0) + (options.conflict > 50 && m.relationship_effects.conflict > 0 ? .07 : 0);
        return { memory:m, score:clamp(score) };
    }).sort((a, b) => b.score - a.score || hash(a.memory.id).localeCompare(hash(b.memory.id))).slice(0, limit).map(({memory,score})=>({...clone(memory),retrieval_score:score}));
}
export function compactWorkingMemory(memories, workingLimit = 12) {
    const working = memories.filter(m => m.layer === 'working'); const keep = new Set(working.slice(-workingLimit).map(m => m.id));
    return memories.filter(m => m.layer !== 'working' || keep.has(m.id));
}
