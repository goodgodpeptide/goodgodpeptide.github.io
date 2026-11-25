import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
let worker = (await readFile(new URL('sw.js', root), 'utf8')).replaceAll('\r\n', '\n');
const originalWorker = worker;
const release = worker.match(/const RELEASE_VERSION = '([^']+)'/)[1];
const paths = [...worker.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
const assets = {};
for (const path of paths) {
  const url = new URL(path, root);
  let bytes = await readFile(url);
  if (/\.(?:html|js|mjs|css|json)$/.test(path)) {
    const canonical = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
    if (!check && !bytes.equals(canonical)) await writeFile(url, canonical);
    bytes = canonical;
  }
  assets[path] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}
const fingerprint = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 12);
const version = `${release}-${fingerprint}`;
worker = worker.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = '${version}';`);
const manifest = JSON.stringify({ version, assets }, null, 2) + '\n';
const replacement = '/* BUILD_HASHES_START */ ' + JSON.stringify(assets, null, 2) + ' /* BUILD_HASHES_END */';
const expected = worker.replace(/\/\* BUILD_HASHES_START \*\/[\s\S]*?\/\* BUILD_HASHES_END \*\//, replacement);
if (check) {
  const actual = await readFile(new URL('offline_build.json', root), 'utf8');
  if (originalWorker !== expected || actual.replaceAll('\r\n', '\n') !== manifest) {
    throw new Error('배포 파일 해시가 오래됐습니다. node scripts/build_offline_manifest.mjs 실행이 필요합니다.');
  }
} else {
  await writeFile(new URL('sw.js', root), expected);
  await writeFile(new URL('offline_build.json', root), manifest);
}
console.log(`${version}: ${paths.length}개 공개 자산 해시 ${check ? '검증' : '갱신'} 완료`);
