// Keep portal downloads tied to the exact signed APKs that passed testing.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = JSON.parse(await readFile(path.join(root, 'mobile-release.json'), 'utf8'));
const folder = path.join(root, 'public', 'downloads');
await mkdir(folder, { recursive: true });
const prefix = 'https://github.com/umerayaz334-ux/Hisbenew-Industries-ERP/releases/download/';
for (const asset of release.assets) {
  if (!/^[a-zA-Z0-9_.-]+\.apk$/.test(asset.file) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !asset.url.startsWith(prefix) || /[\s\r\n]/.test(asset.url)) {
    throw new Error('Invalid signed APK release manifest');
  }
}
const primary = release.assets.find(asset => asset.file === release.defaultFile);
if (!primary) throw new Error('Default APK missing from release manifest');
// The existing CI workflow generates an APK with an ephemeral signing key.
// Replace that generated file with a redirect to the tested, consistently signed release.
await rm(path.join(folder, 'hisbenew-factory-erp.apk'), { force: true });
const redirects = [
  `Redirect 302 /downloads/hisbenew-factory-erp.apk ${primary.url}`,
  ...release.assets.map(asset => `Redirect 302 /downloads/${asset.file} ${asset.url}`),
];
await writeFile(path.join(folder, '.htaccess'), `${redirects.join('\n')}\n`);
await writeFile(path.join(folder, 'release.json'), JSON.stringify(release, null, 2));
console.log(`Portal download pinned to Android ${release.version}, build ${release.build}`);
