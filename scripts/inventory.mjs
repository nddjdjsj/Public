import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function scan(dir) {
    let results = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
        if ((e.name.startsWith('.') && !['.gitignore', '.gitattributes'].includes(e.name)) || e.name === 'node_modules' || e.name === 'SHA256SUMS.txt') continue;
        const path = resolve(dir, e.name);
        if (e.isDirectory()) results.push(...await scan(path)); else results.push(path);
    }
    return results;
}
const files = (await scan(root)).sort();
const lines = await Promise.all(files.map(async path => `${createHash('sha256').update(await readFile(path)).digest('hex')}  ${relative(root, path).replaceAll('\\', '/')}`));
await writeFile(resolve(root, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(`Recorded SHA-256 hashes for ${files.length} project files.`);
