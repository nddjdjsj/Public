import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonality, effectivePersonality } from '../core/personality.js';
import { createEmotion } from '../core/emotion.js';
import { behavioralPolicy } from '../core/decision.js';

test('fixed-seed experiments show different behavioral distributions across personality profiles', () => {
    const outgoing = effectivePersonality(createPersonality({ baseline: { O:.6,C:.5,E:.95,A:.6,N:.2 } }));
    const reserved = effectivePersonality(createPersonality({ baseline: { O:.6,C:.5,E:.05,A:.6,N:.8 } }));
    const relation = { trust:45,conflict:25,closeness:30 };
    const emotion = createEmotion(effectivePersonality(createPersonality()));
    const counts = p => {
        const result = { engage:0,withdraw:0 };
        for (let i = 0; i < 1000; i++) {
            const choice = behavioralPolicy(p,emotion,relation,[],{seed:`experiment-${i}`}).selected;
            if (choice in result) result[choice]++;
        }
        return result;
    };
    const a = counts(outgoing), b = counts(reserved);
    assert.ok(a.engage > b.engage + 70, JSON.stringify({ a,b }));
    assert.ok(b.withdraw > a.withdraw + 70, JSON.stringify({ a,b }));
    assert.deepEqual(counts(outgoing),a);
});
