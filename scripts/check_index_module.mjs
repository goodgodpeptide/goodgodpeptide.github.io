import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const marker = '<script type="module">';
const start = html.indexOf(marker);
const end = html.indexOf('</script>', start);

if (start < 0 || end < 0) {
  throw new Error('index.html의 module script를 찾지 못했습니다.');
}

new vm.SourceTextModule(html.slice(start + marker.length, end));
console.log('index module syntax ok');

