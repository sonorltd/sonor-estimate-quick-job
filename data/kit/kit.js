// Sonor Kit loader — ONE line in every app:  <script type="module" src="https://apps.sonor.co.uk/sonor-kit/v1/kit.js"></script>
// (B-485 Spine v1.4: shared code is SERVED, not copied.) Loads the kit CSS into the `sonor-kit` cascade layer (the app's own
// unlayered rules always win), then the modules in dependency order as classic scripts (they are IIFE masters that define
// window globals), and exposes window.SonorKit = { version, base, ready }. Local dev: ?kit=local on the page URL, or
// <script … data-kit-base="../sonor-kit/v1/">, points at the workspace folder instead of the channel.
const here = new URL(import.meta.url);
const params = new URLSearchParams(location.search);
const scriptEl = document.currentScript || Array.from(document.scripts).find((s) => /kit\.js(\?|$)/.test(s.src));
let base = (scriptEl && scriptEl.dataset && scriptEl.dataset.kitBase) || here.href.replace(/kit\.js(\?.*)?$/, '');
if (params.get('kit') === 'local') base = new URL('../../sonor-kit/v1/', location.href).href;
const manifest = await (await fetch(base + 'manifest.json', { cache: 'no-cache' })).json();
const style = document.createElement('style'); style.id = 'sonor-kit-css';
style.textContent = `@import url("${base}kit.css") layer(sonor-kit);`;
document.head.appendChild(style);
const load = (src) => new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.async = false; s.onload = res; s.onerror = () => rej(new Error('kit: failed ' + src)); document.head.appendChild(s); });
const ready = (async () => { for (const m of manifest.modules) await load(base + 'modules/' + m); return manifest; })();
window.SonorKit = { version: manifest.version, base, modules: manifest.modules, ready };
document.dispatchEvent(new CustomEvent('sonor:kit-loading', { detail: { version: manifest.version, base } }));
ready.then(() => document.dispatchEvent(new CustomEvent('sonor:kit-ready', { detail: { version: manifest.version, base } })));
export default window.SonorKit;
