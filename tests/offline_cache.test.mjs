import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../sw.js',import.meta.url),'utf8');
function fixture(fail='') {
 const events={}, entries=new Map(), deleted=[]; let waits, fetches=[];
 const cache={put:async(k,r)=>entries.set(String(k),r),match:async k=>entries.get(String(k))};
 const context={URL,Request,Promise,Set,Error,self:{registration:{scope:'https://example.test/'},location:{origin:'https://example.test'},addEventListener:(n,f)=>events[n]=f,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches:{open:async()=>cache,keys:async()=>['peptide-app-v36','another-app'],delete:async k=>deleted.push(k)},fetch:async r=>{const u=typeof r==='string'?r:r.url;fetches.push(u);if(fail&&u.includes(fail))throw Error('offline');return new Response('public',{status:200});}};
 vm.runInNewContext(source,context);
 return {events,entries,deleted,fetches,run:async n=>{events[n]({waitUntil:p=>waits=p});return waits;},request:async(url,mode)=>{let result;events.fetch({request:{url,method:'GET',mode},respondWith:p=>result=p});return result;}};
}
test('필수 공개 자산 전체 설치 및 버전 쿼리 정규화',async()=>{const f=fixture();await f.run('install');assert.ok(f.entries.has('https://example.test/offline_sync.js'));assert.ok(f.entries.has('https://example.test/peptides_v3.json'));const count=f.fetches.length;assert.equal(await (await f.request('https://example.test/display_preferences.js?v=999')).text(),'public');assert.equal(f.fetches.length,count);});
test('필수 파일 실패 시 이전 캐시 삭제 및 새 캐시 쓰기 없음',async()=>{const f=fixture('offline_sync.js');await assert.rejects(f.run('install'));assert.equal(f.entries.size,0);assert.deepEqual(f.deleted,[]);});
test('외부 인증/API와 미등록 공개요청은 SW 캐시에 접근하지 않음',async()=>{const f=fixture();await f.run('install');for(const url of ['https://identitytoolkit.googleapis.com/v1/accounts:lookup','https://firestore.googleapis.com/v1/users','https://example.test/api/private','https://example.test/unknown-public.json'])assert.equal(await f.request(url),undefined);});
test('오프라인 navigation은 설치된 HTML 사용',async()=>{const f=fixture();await f.run('install');f.entries.set('https://example.test/index.html',new Response('cached html'));const g=fixture('example.test');g.entries.set('https://example.test/index.html',new Response('cached html'));assert.equal(await(await g.request('https://example.test/','navigate')).text(),'cached html');});
test('활성화는 이 앱의 구버전 캐시만 삭제',async()=>{const f=fixture();await f.run('activate');assert.deepEqual(f.deleted,['peptide-app-v36']);});

test('온라인 502 또는 새 HTML 응답보다 활성 캐시 HTML 우선',async()=>{const f=fixture();await f.run('install');f.entries.set('https://example.test/index.html',new Response('atomic cached html'));const before=f.fetches.length;assert.equal(await(await f.request('https://example.test/','navigate')).text(),'atomic cached html');assert.equal(f.fetches.length,before);});

test('UI 준비 상태는 전체 선캐시 존재 여부로 판정',async()=>{const f=fixture();await f.run('install');let result,wait;f.events.message({data:{type:'OFFLINE_CACHE_STATUS'},ports:[{postMessage:value=>result=value}],waitUntil:p=>wait=p});await wait;assert.equal(result.ready,true);assert.equal(result.version,'peptide-app-v39');assert.equal(result.missing.length,0);f.entries.delete('https://example.test/offline_app.js');f.events.message({data:{type:'OFFLINE_CACHE_STATUS'},ports:[{postMessage:value=>result=value}],waitUntil:p=>wait=p});await wait;assert.equal(result.ready,false);assert.equal(result.missing[0],'./offline_app.js');});
