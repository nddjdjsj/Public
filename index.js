import { SillyTavernAdapter, onHostReady } from './adapters/sillytavern.js';
import { mountPanel } from './ui/panel.js';

let adapter, panel, generation = 0, renderFrame;
function scheduleRender() {
    if (renderFrame !== undefined) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = undefined; panel?.render(); });
}
async function start() {
    const token = ++generation;
    // Replacing a previous instance also unregisters every business event listener.
    globalThis.__psycheEngine?.destroy?.(); panel?.destroy();
    adapter = new SillyTavernAdapter({ onChange: scheduleRender });
    globalThis.__psycheEngine = adapter;
    await adapter.initialize();
    if (token !== generation) return;
    const container = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    if (container) panel = mountPanel({ container, controller: adapter });
}
// All SillyTavern access, including startup, is isolated in the adapter.
const cancelStartup = onHostReady(() => start().catch(() => console.warn('[PsycheEngine] Initialization unavailable')));

export async function onDisable() { generation++; cancelStartup(); adapter?.destroy(); panel?.destroy(); panel = null; if (renderFrame !== undefined) cancelAnimationFrame(renderFrame); renderFrame = undefined; }
export async function onEnable() { await start(); }
