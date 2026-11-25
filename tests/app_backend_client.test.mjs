import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppBackendClient } from '../app_backend_client.js';
function setup(fetchImpl) {
  let epoch=1;const calls=[];
  const user={uid:'anonymous',getIdToken:async refresh=>{calls.push(refresh);return 'fixture-token';}};
  const client=createAppBackendClient({baseUrl:'https://fixed.invalid',getUser:()=>user,getOwner:()=>epoch,isCurrent:owner=>owner===epoch,fetchImpl});
  return {client,calls,user,change:()=>epoch++};
}
test('current Firebase token is attached and 401 refresh occurs once',async()=>{
  const requests=[];const s=setup(async(url,options)=>{requests.push({url,options});return {status:requests.length===1?401:200,json:async()=>({ok:true})};});
  assert.deepEqual(await s.client.analyze({drugs:[]}),{ok:true});assert.deepEqual(s.calls,[false,true]);
  assert.equal(requests[0].options.headers.Authorization,'Bearer fixture-token');
  assert.equal(requests[0].url,'https://fixed.invalid/weight_analysis');
});
test('account epoch change during token read prevents request',async()=>{
  let requests=0;const s=setup(async()=>{requests++;});s.user.getIdToken=async()=>{s.change();return 'fixture';};
  await assert.rejects(s.client.analyze({}));assert.equal(requests,0);
});
test('account epoch change during fetch or JSON prevents old result',async()=>{
  for(const phase of ['fetch','json']){
    const s=setup(async()=>{if(phase==='fetch')s.change();return {status:200,json:async()=>{if(phase==='json')s.change();return {ok:true,analysis:'old'};}};});
    await assert.rejects(s.client.analyze({}));
  }
});
test('cancelled and network failure do not retry paid request',async()=>{
  let requests=0;const s=setup(async()=>{requests++;throw new Error('network');});
  await assert.rejects(s.client.analyze({}));assert.equal(requests,1);
  const controller=new AbortController();controller.abort();await assert.rejects(s.client.analyze({},{signal:controller.signal}),{name:'AbortError'});assert.equal(requests,1);
});
test('HTTP errors cannot turn a JSON ok flag into successful analysis',async()=>{
  let requests=0;const s=setup(async()=>{requests++;return {status:503,json:async()=>({ok:true,analysis:'invalid success'})};});
  assert.equal((await s.client.analyze({})).ok,false);assert.equal(requests,1);
});
