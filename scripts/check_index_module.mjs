import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let modules = 0, classic = 0;
for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
  if (/\bsrc\s*=/iu.test(attributes)) continue;
  const type = attributes.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu);
  const kind = (type?.[1] ?? type?.[2] ?? type?.[3] ?? '').trim().toLowerCase();
  if (kind === 'module') {
    new vm.SourceTextModule(body);
    modules++;
  } else if (!kind || ['text/javascript', 'application/javascript'].includes(kind)) {
    new vm.Script(body);
    classic++;
  }
}
if (!modules) throw new Error('index.html의 module script를 찾지 못했습니다.');
console.log(`index module syntax ok; module ${modules}개·일반 script ${classic}개 검증`);

