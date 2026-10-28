import { readFile } from 'node:fs/promises';

const base = 'https://app.hisbenew.com/';
const expected = JSON.parse(await readFile(new URL('../frontend/mobile-release.json', import.meta.url), 'utf8'));
async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Live check failed: ${response.status} ${url}`);
  return response.text();
}
const html = await fetchText(`${base}?release-check=${Date.now()}`);
const entry = html.match(/src="([^"]+\.js)"/)?.[1];
if (!entry) throw new Error('Live portal entry script missing');
const script = await fetchText(new URL(entry, base));
const modules = {};
for (const name of ['Orders', 'Shipping', 'Settings', 'ForwardOrderButton', 'WorkerForwarding']) {
  const file = script.match(new RegExp(`(?:^|[^A-Za-z0-9_])(${name}-[A-Za-z0-9_-]+\\.js)`))?.[1];
  if (!file) throw new Error(`Live ${name} module missing`);
  modules[name] = await fetchText(new URL(`assets/${file}`, base));
}
if (!modules.Orders.includes('ForwardOrderButton-') || !modules.Shipping.includes('ForwardOrderButton-') ||
    !modules.ForwardOrderButton.includes('Connected company') || !modules.ForwardOrderButton.includes('/order-forwarding/orders/') ||
    !modules.WorkerForwarding.includes('Save default worker') || !modules.Settings.includes('Order forwarding')) {
  throw new Error('Live portal is not serving the order/dispatch forwarding popup and settings');
}
const release = JSON.parse(await fetchText(`${base}downloads/release.json?release-check=${Date.now()}`));
if (release.build !== expected.build || release.defaultFile !== expected.defaultFile ||
    release.assets[0].sha256 !== expected.assets[0].sha256) {
  throw new Error('Live APK download manifest does not match the verified release');
}
const api = JSON.parse(await fetchText('https://api.hisbenew.com/openapi.json'));
for (const route of ['/order-forwarding/settings', '/order-forwarding/connections', '/order-forwarding/orders/{order_id}', '/order-forwarding/workers/{worker_id}/code']) {
  if (!api.paths[route]) throw new Error(`Live API missing ${route}`);
}
console.log(`Live forwarding controls, API and Android ${release.version} (${release.build}) download verified.`);
