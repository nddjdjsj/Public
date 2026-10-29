import { assert, bounded, clamp, clone, hash, number, plain, safeData } from './util.js';
import { validateConfig } from './config.js';
import { createPersonality, DOMAINS, effectivePersonality, FACET_IDS } from './personality.js';
import { appraiseEvent, EVENT_REGISTRY } from './appraisal.js';
import { createEmotion, PAD_KEYS, recoverEmotion, updateEmotion, emotionLabels } from './emotion.js';
import { createRelationship, updateRelationship } from './relationship.js';
import { createMemory, MemoryIndex, retrieveMemories } from './memory.js';
import { behavioralPolicy } from './decision.js';

export const DATA_VERSION = 1;
const CONTROL_TYPES = ['time_passed', 'emotion_override', 'personality_adaptation'];
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value!=='prototype' && !Object.hasOwn(Object.prototype,value);
const NEUTRAL_PERSONALITY=effectivePersonality(createPersonality());
const enabledPersonality=(personality,offsets,config)=>config.personality.enabled?effectivePersonality(personality,offsets):NEUTRAL_PERSONALITY;

export function normalizeEvent(input, config = validateConfig()) {
    const event = safeData(input); plain(event, 'event');
    assert(Object.hasOwn(EVENT_REGISTRY, event.type) || CONTROL_TYPES.includes(event.type), 'Unknown event type');
    const control = CONTROL_TYPES.includes(event.type);
    assert(!control || event.confirmed === true, 'Manual control events require confirmation');
    assert(identity(event.actor ?? 'user') && identity(event.target ?? 'character'), 'Invalid actor/target identity');
    const actor = event.actor ?? 'user', target = event.target ?? 'character';
    assert(control || actor !== target, 'Actor and target must differ');
    const intensity = number(event.intensity ?? (control ? 0 : .5), 0, 1, 'event intensity');
    const confidence = number(event.confidence ?? (control ? 1 : 0), 0, 1, 'event confidence');
    const modality = event.modality || 'fact'; assert(['fact','perception'].includes(modality), 'Hypothetical, quoted and recalled events cannot be committed');
    assert(Array.isArray(event.source_message_ids || []), 'source_message_ids must be an array');
    const sources = [...new Set(event.source_message_ids || [])]; assert(sources.length <= 20 && sources.every(identity), 'Invalid message sources');
    assert(control || sources.length > 0 || event.confirmed === true, 'Unconfirmed events need traceable message sources');
    plain(event.source_revisions || {}); for (const [source, revision] of Object.entries(event.source_revisions || {})) assert(sources.includes(source) && typeof revision === 'string' && revision.length <= 200, 'Invalid source revision');
    const id = event.id || `event_${hash([event.type,actor,target,sources,event.source_revisions || {},event.evidence || ''])}`;
    assert(identity(id), 'Invalid event ID');
    const out = { id, type:event.type, actor, target, intensity, confidence, modality,
        evidence: String(event.evidence || '').slice(0, 1000), summary: String(event.summary || '').slice(0,500),
        source_message_ids:sources, source_revisions:clone(event.source_revisions || {}), confirmed:event.confirmed === true, requires_confirmation:event.requires_confirmation === true,
        status:event.status === 'revoked' ? 'revoked' : 'active', revocation_reason:String(event.revocation_reason || '').slice(0,200),
        story_time:event.story_time === undefined || event.story_time === null ? null : number(event.story_time, 0, 1e9, 'story_time'),
        created_at:typeof event.created_at === 'string' ? event.created_at.slice(0, 100) : null,
        correction_history:Array.isArray(event.correction_history) ? clone(event.correction_history).slice(-50) : [],
    };
    if(event.source_order!==undefined)out.source_order=number(event.source_order,0,1e9,'source_order');
    assert(out.source_order===undefined || Number.isInteger(out.source_order),'source_order must be an integer');
    if (control && event.type === 'time_passed') { out.amount = number(event.amount ?? 1, 0, 10000, 'time amount'); out.unit = event.unit || 'story'; assert(['story','turn'].includes(out.unit), 'Invalid time unit'); }
    if (event.type === 'emotion_override') { plain(event.pad); out.pad = Object.fromEntries(PAD_KEYS.map(k => [k, number(event.pad[k], -1, 1, k)])); }
    if (event.type === 'personality_adaptation') {
        plain(event.offsets); assert(typeof event.reason === 'string' && event.reason.trim(), 'Adaptation requires reason'); out.reason = event.reason.slice(0,500); out.offsets = {};
        for (const [key,value] of Object.entries(event.offsets)) { assert(DOMAINS.includes(key) || FACET_IDS.includes(key), 'Unknown adaptation trait'); out.offsets[key] = number(value, -config.personality.adaptation_rate, config.personality.adaptation_rate, 'adaptation rate'); }
    }
    return out;
}

function createState(personality, config) {
    const effective = enabledPersonality(personality,{},config);
    return { version:DATA_VERSION, personality:clone(personality), emotion:createEmotion(effective), relationships:{}, memories:[], working_memory:[], memory_counts:{},
        adaptive_offsets:{}, adaptation_history:[], policies:behavioralPolicy(effective, createEmotion(effective)), last_appraisals:[], turn:0, story_time:0, processed_events:0 };
}
function countMemory(state,memory,change) {
    if(memory.pending_confirmation)return;
    for(const actor of memory.actors){state.memory_counts[actor]??={};state.memory_counts[actor][memory.type]=Math.max(0,(state.memory_counts[actor][memory.type]||0)+change);}
}
function runtimeFor(state,config,base=null){return {base,local:new MemoryIndex(base?[]:state.memories,{candidateLimit:config.memory.retrieval_candidates}),added:[],removed:new Set()};}
function reduceEvent(state, event, personality, config, runtime) {
    if (event.status !== 'active' || (!CONTROL_TYPES.includes(event.type) && event.confidence < config.event_extraction.minimum_confidence)) return state;
    const next = state; const effective = enabledPersonality(personality, next.adaptive_offsets,config);let pending=false;
    if (event.type === 'time_passed') {
        if (event.unit === 'turn') next.turn += event.amount; else next.story_time += event.amount;
        if (config.emotion.enabled && config.emotion.recovery_mode === event.unit) next.emotion = recoverEmotion(next.emotion, event.amount, config);
    } else if (event.type === 'emotion_override') {
        next.emotion.current = clone(event.pad); next.emotion.labels = emotionLabels(event.pad); next.emotion.intensity = clamp(PAD_KEYS.reduce((sum,k) => sum + Math.abs(event.pad[k] - next.emotion.baseline[k]),0)/3);
        next.emotion.history = bounded([...next.emotion.history, {event_id:event.id,current:clone(event.pad),labels:[...next.emotion.labels]}],config.engine.history_limit);
    } else if (event.type === 'personality_adaptation') {
        if (config.personality.enabled && config.personality.adaptive_personality) {
            const before = clone(next.adaptive_offsets);
            for (const [key,value] of Object.entries(event.offsets)) next.adaptive_offsets[key] = clamp((next.adaptive_offsets[key] || 0) + value, -config.personality.adaptation_limit, config.personality.adaptation_limit);
            next.adaptation_history = bounded([...next.adaptation_history,{event_id:event.id,before,after:clone(next.adaptive_offsets),reason:event.reason}],config.engine.history_limit);
        }
    } else {
        const appraisal = appraiseEvent(event, effective, next, config);pending=appraisal.requires_confirmation;let effects = {};
        if (!appraisal.requires_confirmation) {
            if (config.emotion.enabled) next.emotion = updateEmotion(next.emotion, appraisal, config);
            if (config.relationship.enabled) {
                const result = updateRelationship(next.relationships[appraisal.relation_key] || createRelationship(), event, appraisal, effective, next.emotion, config);
                next.relationships[appraisal.relation_key] = result.relationship; effects = result.effects;
            }
        }
        if (config.memory.enabled) {
            const memory = createMemory(event, appraisal, effects);
            memory.story_time = event.story_time ?? next.story_time;
            if (memory.importance < config.memory.importance_threshold) memory.layer = 'working';
            next.memories.push(memory);countMemory(next,memory,1);runtime.local.add(memory);runtime.added.push(memory);
            if(memory.layer==='working') {
                next.working_memory.push(memory.id);
                if(next.working_memory.length>config.memory.working_limit){const removeId=next.working_memory.shift();
                    for(let i=next.memories.length-1;i>=0;i--)if(next.memories[i].id===removeId){countMemory(next,next.memories[i],-1);next.memories.splice(i,1);break;}
                    runtime.removed.add(removeId);runtime.local.remove(removeId);
                }
            }
        }
        next.last_appraisals = bounded([...next.last_appraisals, appraisal],config.engine.history_limit);
    }
    next.processed_events++;
    if(pending)return next;
    const relation = next.relationships[event.actor === 'character' ? event.target : event.actor];
    const retrieval={actor:event.actor,limit:config.memory.max_retrieved_events,emotion_tags:next.emotion.labels,story_time:next.story_time,conflict:relation?.conflict};
    // Policy uses a deterministic bounded recent window. Indexed long-term retrieval
    // is available to prompt compilation; index approximation never changes replayed state.
    const memories = retrieveMemories(next.memories.slice(-config.memory.retrieval_candidates),event.evidence,retrieval);
    next.policies = behavioralPolicy(enabledPersonality(personality,next.adaptive_offsets,config), next.emotion, relation, next.last_appraisals.filter(a=>!a.requires_confirmation).slice(-1), {config,seed:event.id,memories});
    return next;
}

/** Event log is authoritative. Snapshots are verified caches, never trusted imported state. */
export class StateManager {
    constructor({ personality = {}, config = {}, data = null, scope = 'default' } = {}) {
        this.personality = createPersonality(personality); this.config = validateConfig(config); assert(identity(scope), 'Invalid state scope'); this.scope = scope;
        this.events = []; this.snapshots = []; this.logs = []; this.recovery = null;
        if (data) {
            try {
                const clean = safeData(data); plain(clean); assert(clean.version === undefined || clean.version === 0 || clean.version === DATA_VERSION, 'Unsupported data version');
                const log = clean.events || clean.log; assert(Array.isArray(log) && log.length <= this.config.engine.max_events, 'Invalid event log');
                const ids = new Set(); this.events = log.map(event => { const valid = normalizeEvent(event,this.config); assert(!ids.has(valid.id), 'Duplicate stored event ID'); ids.add(valid.id); return valid; });
                this.parent_scope = clean.scope !== scope ? clean.scope || null : clean.parent_scope || null;
                this.recovery = clean.version !== DATA_VERSION ? 'migrated legacy event log to version 1' : null;
            } catch (error) { this.events = []; this.recovery = `Corrupt data isolated: ${error.message}`; try { this.rejected_data = clone(data); } catch { this.rejected_data = {error:'Original data was not serializable'}; } }
        }
        this._indexEvents();this.rebuild();
    }
    get state() { return clone(this._state); }
    retrieve(query='',options={}) {const context={limit:this.config.memory.max_retrieved_events,story_time:this._state.story_time,emotion_tags:this._state.emotion.labels,...options};return retrieveMemories(this.memoryIndex.candidates(query,context),query,context);}
    _log(action, detail) { if (this.config.debug) this.logs = bounded([...this.logs,{action,detail}],this.config.engine.history_limit); }
    _canonical(events) { assert(Array.isArray(events), 'events must be array'); return events.map(e => normalizeEvent(e,this.config)); }
    _indexEvents(){this.eventIndex=new Map();this.sourceLastIndex=new Map();this.orderedSources=[];for(let i=0;i<this.events.length;i++){const event=this.events[i];this.eventIndex.set(event.id,i);for(const id of event.source_message_ids)this.sourceLastIndex.set(id,i);if(event.source_order!==undefined)this.orderedSources.push({order:event.source_order,index:i});}this.orderedSources.sort((a,b)=>a.order-b.order||a.index-b.index);}
    _orderAnchor(order){let lo=0,hi=this.orderedSources.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.orderedSources[mid].order<=order)lo=mid+1;else hi=mid;}return lo?this.orderedSources[lo-1].index:-1;}
    _merge(incoming) {
        const additions = [], updates = new Map(), seen = new Set(), insertions=new Map(); let changed = false, appendOnly = true,dirty=this.events.length;
        for (const event of incoming) {
            if (seen.has(event.id)) continue; seen.add(event.id);
            const at = this.eventIndex.get(event.id);
            if (at === undefined) {
                assert(this.events.length + additions.length < this.config.engine.max_events, 'Event capacity reached; export before starting a new chat');additions.push(event);changed=true;
                const anchors=event.source_message_ids.map(id=>this.sourceLastIndex.get(id)).filter(i=>i!==undefined);
                const anchor=event.source_order!==undefined && this.orderedSources.length?this._orderAnchor(event.source_order):anchors.length?Math.max(...anchors):this.events.length-1;
                if(anchor<this.events.length-1){const group=insertions.get(anchor)||[];group.push(event);insertions.set(anchor,group);appendOnly=false;dirty=Math.min(dirty,anchor+1);}
            }
            else if (this.events[at].status === 'revoked' && this.events[at].revocation_reason.startsWith('source_')) { updates.set(at,event); changed = true; appendOnly = false;dirty=Math.min(dirty,at); }
        }
        let timeline=null;
        if(!appendOnly){const inserted=new Set([...insertions.values()].flat().map(e=>e.id));timeline=[...(insertions.get(-1)||[])];for(let i=0;i<this.events.length;i++){timeline.push(updates.get(i)||this.events[i]);if(insertions.has(i))timeline.push(...insertions.get(i));}for(const event of additions)if(!inserted.has(event.id))timeline.push(event);}
        return { additions, updates, changed, appendOnly, timeline, dirty };
    }
    preview(events = []) {
        const candidate = this._merge(this._canonical(events));
        if(!candidate.changed)return this.state;
        if(!candidate.appendOnly)return clone(this._replay(candidate.timeline,candidate.dirty).state);
        const state=clone(this._state),runtime=runtimeFor(state,this.config,this.memoryIndex);
        for(const event of candidate.additions)reduceEvent(state,event,this.personality,this.config,runtime);
        return clone(state);
    }
    commit(events = []) {
        // Validate every event before any mutation: failed batches are atomic.
        const incoming = this._canonical(events), candidate = this._merge(incoming); if (!candidate.changed) return this.state;
        const previousLength=this.events.length;
        if(candidate.appendOnly){const next=clone(this._state),runtime=runtimeFor(next,this.config,this.memoryIndex);
            for(const event of candidate.additions)reduceEvent(next,event,this.personality,this.config,runtime);
            for(const event of candidate.additions){this.eventIndex.set(event.id,this.events.length);for(const id of event.source_message_ids)this.sourceLastIndex.set(id,this.events.length);if(event.source_order!==undefined)this.orderedSources.push({order:event.source_order,index:this.events.length});this.events.push(event);}
            for(const id of runtime.removed)this.memoryIndex.remove(id);for(const memory of runtime.added)if(!runtime.removed.has(memory.id))this.memoryIndex.add(memory);this._state=next;
        }else{const rebuilt=this._replay(candidate.timeline,candidate.dirty);this.events=candidate.timeline;this._state=rebuilt.state;this.memoryIndex=rebuilt.runtime.local;this._indexEvents();this.snapshots=this.snapshots.filter(s=>s.event_count<=candidate.dirty);}
        if (Math.floor(previousLength/this.config.engine.snapshot_interval) !== Math.floor(this.events.length/this.config.engine.snapshot_interval)) this._snapshot();
        this._log('commit',{ids:incoming.map(e=>e.id),count:this.events.length}); return this.state;
    }
    _snapshot() { const state=clone(this._state);this.snapshots = bounded([...this.snapshots,{event_count:this.events.length,fingerprint:hash(this.events),model_fingerprint:hash([this.personality,this.config]),state_fingerprint:hash(state),state}],this.config.engine.max_snapshots); }
    _replay(events=this.events,dirty=events.length){
        let state=createState(this.personality,this.config),start=0;
        for(const snapshot of [...this.snapshots].reverse())if(snapshot.event_count<=dirty && snapshot.event_count<=events.length && snapshot.model_fingerprint===hash([this.personality,this.config]) && snapshot.fingerprint===hash(events.slice(0,snapshot.event_count)) && snapshot.state_fingerprint===hash(snapshot.state)){state=clone(snapshot.state);start=snapshot.event_count;break;}
        const runtime=runtimeFor(state,this.config);
        for(let i=start;i<events.length;i++)reduceEvent(state,events[i],this.personality,this.config,runtime);
        return {state,runtime,start};
    }
    rebuild() {
        const rebuilt=this._replay();this._state=rebuilt.state;this.memoryIndex=rebuilt.runtime.local;
        this.last_replay_from=rebuilt.start;this._log('rebuild',{events:this.events.length,from:rebuilt.start});return this.state;
    }
    reconcile(validSources,options={}) {
        let revisions;
        if (validSources instanceof Map) revisions = validSources;
        else if (validSources instanceof Set) revisions = new Map([...validSources].map(id=>[id,null]));
        else if (Array.isArray(validSources)) revisions = new Map(validSources.map(source=>typeof source === 'string' ? [source,null] : [source.id,source.revision ?? null]));
        else { plain(validSources); revisions = new Map(Object.entries(validSources)); }
        const orders=options.sourceOrder;if(orders!==undefined){assert(orders instanceof Map,'sourceOrder must be a Map');for(const [id,order]of orders){assert(identity(id),'Invalid sourceOrder identity');number(order,0,1e9,'sourceOrder');assert(Number.isInteger(order),'sourceOrder must be integer');}}
        let changed = false,hintsChanged=false,dirty=this.events.length;
        for (let i=0;i<this.events.length;i++){const event=this.events[i];
            if(orders){const source=event.source_message_ids.find(id=>orders.has(id));if(source!==undefined && event.source_order!==orders.get(source)){event.source_order=orders.get(source);hintsChanged=true;}}
            if (event.status === 'active') {
            const missing = event.source_message_ids.some(id=>!revisions.has(id));
            const stale = event.source_message_ids.some(id=>revisions.has(id) && revisions.get(id) !== null && event.source_revisions[id] !== undefined && event.source_revisions[id] !== revisions.get(id));
            if (missing || stale) { event.status = 'revoked'; event.revocation_reason = missing ? 'source_missing' : 'source_revision_changed'; changed = true;dirty=Math.min(dirty,i); }
        }}
        if(hintsChanged){let prior=-1;const ordered=this.events.map((event,index)=>{if(event.source_order!==undefined)prior=event.source_order;return{event,index,order:event.source_order??prior};}).sort((a,b)=>a.order-b.order||a.index-b.index).map(({event})=>event);
            const first=ordered.findIndex((event,i)=>event.id!==this.events[i].id);if(first>=0){changed=true;dirty=Math.min(dirty,first);this.events=ordered;}this._indexEvents();this.snapshots=[];
        }
        if (changed) { this.snapshots=this.snapshots.filter(s=>s.event_count<=dirty);this._log('reconcile', 'source-dependent events revoked');return this.rebuild(); }
        return this.state;
    }
    revoke(id, reason = 'manual') { const at=this.eventIndex.get(id),event=this.events[at];assert(event,'Unknown event ID');event.status='revoked';event.revocation_reason=String(reason).slice(0,200);this.snapshots=this.snapshots.filter(s=>s.event_count<=at);this._log('revoke',id);return this.rebuild(); }
    correct(id, patch) {
        const at = this.events.findIndex(e=>e.id === id); assert(at >= 0,'Unknown event ID'); patch = safeData(patch); plain(patch);
        assert(Object.keys(patch).every(key=>['type','intensity','confidence','evidence','summary','modality','confirmed','status'].includes(key)),'Unsupported correction field');
        const current = this.events[at], updated = normalizeEvent({...current,...patch,id:current.id},this.config);
        updated.correction_history = bounded([...current.correction_history,{before:{type:current.type,intensity:current.intensity,confidence:current.confidence,summary:current.summary,confirmed:current.confirmed},after:clone(patch)}],50);
        this.events[at] = updated;this.snapshots=this.snapshots.filter(s=>s.event_count<=at);this._log('correct',id);return this.rebuild();
    }
    confirm(id) { return this.correct(id,{confirmed:true}); }
    export() { return clone({version:DATA_VERSION,scope:this.scope,parent_scope:this.parent_scope || null,events:this.events,snapshots:this.snapshots}); }
    reset() { this.events = [];this._indexEvents(); this.snapshots = []; this.logs = []; return this.rebuild(); }
}
