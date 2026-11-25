import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const source=await readFile(new URL('../sw.js',import.meta.url),'utf8');
const manifest=JSON.parse(await readFile(new URL('../offline_build.json',import.meta.url),'utf8'));
const contents=new Map(await Promise.all(Object.keys(manifest.assets).map(async path=>[path,await readFile(new URL('../'+path.slice(2),import.meta.url))])));
function fixture(fail='',corrupt='',existing=false,putFail=false) {
 const events={}, entries=new Map(), deleted=[]; let waits, fetches=[];
 const cache={put:async(k,r)=>{if(putFail)throw Error('quota');entries.set(String(k),r.clone());},match:async k=>entries.get(String(k))?.clone()};
 const context={URL,Request,Promise,Set,Error,crypto:webcrypto,Uint8Array,self:{registration:{scope:'https://example.test/'},location:{origin:'https://example.test'},addEventListener:(n,f)=>events[n]=f,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches:{open:async()=>cache,keys:async()=>['peptide-app-v36','another-app',...(existing?[manifest.version]:[])],delete:async k=>deleted.push(k)},fetch:async r=>{const u=typeof r==='string'?r:r.url;fetches.push(u);if(fail&&u.includes(fail))throw Error('offline');const path='./'+new URL(u).pathname.slice(1);return new Response(corrupt&&u.includes(corrupt)?'stale content':contents.get(path),{status:200});}};
 vm.runInNewContext(source,context);
 return {events,entries,deleted,fetches,run:async n=>{events[n]({waitUntil:p=>waits=p});return waits;},request:async(url,mode)=>{let result;events.fetch({request:{url,method:'GET',mode},respondWith:p=>result=p});return result;}};
}
test('필수 공개 자산 전체 설치 및 버전 쿼리 정규화',async()=>{const f=fixture();await f.run('install');assert.ok(f.entries.has('https://example.test/offline_sync.js'));assert.ok(f.entries.has('https://example.test/peptides_v3.json'));const count=f.fetches.length;assert.equal(await (await f.request('https://example.test/display_preferences.js?v=999')).text(),contents.get('./display_preferences.js').toString());assert.equal(f.fetches.length,count);});
test('필수 파일 실패 시 이전 캐시 삭제 및 새 캐시 쓰기 없음',async()=>{const f=fixture('offline_sync.js');await assert.rejects(f.run('install'));assert.equal(f.entries.size,0);assert.deepEqual(f.deleted,[]);});

test('HTTP 200이어도 다른 배포 파일이 섞이면 설치를 거부하고 이전 캐시를 보존한다',async()=>{for(const path of ['index.html','offline_app.js','display_preferences.css']){const f=fixture('',path);await assert.rejects(f.run('install'),/Precache content mismatch/);assert.equal(f.entries.size,0);assert.deepEqual(f.deleted,[]);}});

test('복구 진입 파일과 버전 정보는 구버전 SW 캐시로 가로채지 않는다',async()=>{const f=fixture();for(const path of ['update.html','app_update.js?check=1','offline_build.json?check=1'])assert.equal(await f.request('https://example.test/'+path,'navigate'),undefined);});

test('같은 빌드 재설치의 용량 실패가 이미 활성인 앱 파일 캐시를 삭제하지 않는다',async()=>{const f=fixture('','',true,true);f.entries.set('https://example.test/index.html',new Response('existing app'));await assert.rejects(f.run('install'),/quota/);assert.deepEqual(f.deleted,[]);assert.equal(await f.entries.get('https://example.test/index.html').text(),'existing app');});
test('외부 인증/API와 미등록 공개요청은 SW 캐시에 접근하지 않음',async()=>{const f=fixture();await f.run('install');for(const url of ['https://identitytoolkit.googleapis.com/v1/accounts:lookup','https://firestore.googleapis.com/v1/users','https://example.test/api/private','https://example.test/unknown-public.json'])assert.equal(await f.request(url),undefined);});
test('오프라인 navigation은 설치된 HTML 사용',async()=>{const f=fixture();await f.run('install');f.entries.set('https://example.test/index.html',new Response('cached html'));const g=fixture('example.test');g.entries.set('https://example.test/index.html',new Response('cached html'));assert.equal(await(await g.request('https://example.test/','navigate')).text(),'cached html');});
test('활성화는 이 앱의 구버전 캐시만 삭제',async()=>{const f=fixture();await f.run('activate');assert.deepEqual(f.deleted,['peptide-app-v36']);});

test('온라인 502 또는 새 HTML 응답보다 활성 캐시 HTML 우선',async()=>{const f=fixture();await f.run('install');f.entries.set('https://example.test/index.html',new Response('atomic cached html'));const before=f.fetches.length;assert.equal(await(await f.request('https://example.test/','navigate')).text(),'atomic cached html');assert.equal(f.fetches.length,before);});

test('UI 준비 상태는 전체 선캐시 존재 여부로 판정',async()=>{const f=fixture();await f.run('install');let result,wait;f.events.message({data:{type:'OFFLINE_CACHE_STATUS'},ports:[{postMessage:value=>result=value}],waitUntil:p=>wait=p});await wait;assert.equal(result.ready,true);assert.equal(result.version,manifest.version);assert.equal(result.missing.length,0);f.entries.delete('https://example.test/offline_app.js');f.events.message({data:{type:'OFFLINE_CACHE_STATUS'},ports:[{postMessage:value=>result=value}],waitUntil:p=>wait=p});await wait;assert.equal(result.ready,false);assert.equal(result.missing[0],'./offline_app.js');});
