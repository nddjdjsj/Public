// Optional offline audit of downloaded official sources. No network call.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ref = resolve(root, '../reference');
const names = ['st-package.json','st-context.js','st-script.js','st-extensions.js','st-events.js','example-manifest.json','example-index.ts'];
const contents = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(resolve(ref, name), 'utf8')])));
const ctx = contents['st-context.js'], script = contents['st-script.js'], ext = contents['st-extensions.js'], events = contents['st-events.js'];
for (const name of ['eventSource','eventTypes','extensionSettings','chatMetadata','saveMetadata','saveSettingsDebounced','writeExtensionField','setExtensionPrompt','getTokenCountAsync','generateRaw']) assert.match(ctx, new RegExp(`\\b${name}\\b`), name);
for (const name of ['GENERATION_STARTED','GENERATION_ENDED','GENERATION_STOPPED','CHARACTER_MESSAGE_RENDERED','MESSAGE_SENT','MESSAGE_EDITED','MESSAGE_UPDATED','MESSAGE_DELETED','MESSAGE_SWIPED','CHAT_CHANGED']) assert.match(events, new RegExp(`\\b${name}\\s*:`), name);
assert.match(script, /IN_CHAT:\s*1/); assert.match(script, /SYSTEM:\s*0/);
assert.match(ext, /await globalThis\[interceptorKey\]\(chat, contextSize, abort, type\)/);
assert.match(script, /export async function generateRaw\(\{/);
const commit = JSON.parse(await readFile(resolve(ref, 'st-commit.json'), 'utf8'));
const result = { date: '2026-10-29', version: JSON.parse(contents['st-package.json']).version, commit: commit.sha,
    audit: 'Downloaded official source contract verified; not a running SillyTavern test',
    files: Object.fromEntries(names.map(name => [name, { bytes: Buffer.byteLength(contents[name]), sha256: createHash('sha256').update(contents[name]).digest('hex') }])) };
await writeFile(resolve(root, 'docs/upstream-audit.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`Official source contracts verified: SillyTavern ${result.version} @ ${commit.sha}`);
