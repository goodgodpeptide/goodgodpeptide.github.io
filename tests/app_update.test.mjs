import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recoverApp, readWorkerStatus } from '../app_update.js';

const hash = 'a'.repeat(64), version = 'peptide-app-v42';
function fixture() {
  let clock = 0, registrations = 0, updates = 0;
  const redirects = [], requests = [], active = {}, controller = {};
  const registration = { active, update: async () => { updates++; } };
  const serviceWorker = { controller, register: async (...args) => { registrations++; requests.push(args); return registration; } };
  const good = { ready: true, version, indexSha256: hash };
  const options = { serviceWorker, fetchImpl: async (url, init) => { requests.push([url, init]); return { ok: true, json: async () => ({ version, assets: { './index.html': { sha256: hash, bytes: 123 } } }) }; },
    requestStatus: async () => good, redirect: url => redirects.push(url), now: () => clock,
    wait: async ms => { clock += ms; }, timeoutMs: 1000, pollMs: 200 };
  return { options, redirects, requests, active, controller, good, counters: () => ({ registrations, updates }) };
}

test('최신 버전·ready·index 해시가 모두 맞을 때 정확히 한 번 이동한다', async () => {
  const f = fixture(); const result = await recoverApp(f.options);
  assert.equal(result.ok, true); assert.deepEqual(f.redirects, [`./?updated=${version}`]);
  assert.deepEqual(f.counters(), { registrations: 1, updates: 1 });
  assert.match(f.requests[0][0], /^\.\/offline_build\.json\?check=/);
  assert.equal(f.requests[0][1].cache, 'no-store');
  assert.deepEqual(f.requests[1], [`./sw.js?build=${version}`, { updateViaCache: 'none' }]);
});

test('구버전 active 대신 현재 controller가 정확하면 확인 후 이동한다', async () => {
  const f = fixture(); f.options.requestStatus = async worker => worker === f.active ? { ...f.good, version: 'old' } : f.good;
  assert.equal((await recoverApp(f.options)).ok, true); assert.equal(f.redirects.length, 1);
});

test('새 active만 준비되고 controller가 구버전이거나 없으면 이동하지 않는다', async () => {
  for (const missing of [false, true]) {
    const f = fixture();
    if (missing) f.options.serviceWorker.controller = null;
    f.options.requestStatus = async worker => worker === f.active ? f.good : { ...f.good, version: 'old' };
    assert.equal((await recoverApp(f.options)).ok, false); assert.equal(f.redirects.length, 0);
  }
});

test('새 active가 실제 controller로 교체된 뒤에만 한 번 이동한다', async () => {
  const f = fixture(); const originalWait = f.options.wait; let polls = 0;
  f.options.requestStatus = async worker => worker === f.active ? f.good : { ...f.good, version: 'old' };
  f.options.wait = async ms => {
    assert.equal(f.redirects.length, 0); polls++;
    await originalWait(ms); f.options.serviceWorker.controller = f.active;
  };
  assert.equal((await recoverApp(f.options)).ok, true);
  assert.equal(polls, 1); assert.equal(f.redirects.length, 1);
});

test('상태 응답 중 controller가 바뀌면 과거 controller의 성공 응답으로 이동하지 않는다', async () => {
  const f = fixture();
  f.options.requestStatus = async () => { f.options.serviceWorker.controller = null; return f.good; };
  assert.equal((await recoverApp(f.options)).ok, false); assert.equal(f.redirects.length, 0);
});

test('ready만 맞거나 버전·해시가 틀린 상태는 시간 초과하고 이동하지 않는다', async () => {
  for (const state of [{ ready: true }, { ready: false, version, indexSha256: hash }, { ready: true, version: 'old', indexSha256: hash }, { ready: true, version, indexSha256: 'b'.repeat(64) }]) {
    const f = fixture(); f.options.requestStatus = async () => state;
    assert.equal((await recoverApp(f.options)).ok, false); assert.equal(f.redirects.length, 0);
  }
});

test('오프라인·잘못된 manifest·등록 실패는 구버전을 승격하지 않는다', async () => {
  for (const mode of ['offline', 'http', 'manifest', 'register']) {
    const f = fixture();
    if (mode === 'offline') f.options.fetchImpl = async () => { throw Error('offline'); };
    if (mode === 'http') f.options.fetchImpl = async () => ({ ok: false });
    if (mode === 'manifest') f.options.fetchImpl = async () => ({ ok: true, json: async () => ({ version, assets: { './index.html': { sha256: 'bad' } } }) });
    if (mode === 'register') f.options.serviceWorker.register = async () => { throw Error('registration failed'); };
    assert.equal((await recoverApp(f.options)).ok, false); assert.equal(f.redirects.length, 0);
    if (mode !== 'register') assert.equal(f.counters().registrations, 0);
  }
});

test('worker가 없거나 상태응답 실패면 제한 시간 내 종료한다', async () => {
  for (const missing of [false, true]) {
    const f = fixture();
    if (missing) { delete f.options.serviceWorker.controller; f.options.serviceWorker.register = async () => ({ update: async () => {} }); }
    f.options.requestStatus = async () => { throw Error('no response'); };
    assert.equal((await recoverApp(f.options)).ok, false); assert.equal(f.redirects.length, 0);
  }
});

test('네트워크가 응답하지 않아도 제한 시간 뒤 실패하고 이동하지 않는다', async () => {
  const f = fixture(); f.options.timeoutMs = 20; f.options.now = () => Date.now();
  f.options.fetchImpl = () => new Promise(() => {});
  const result = await recoverApp(f.options);
  assert.equal(result.ok, false); assert.equal(f.redirects.length, 0); assert.equal(f.counters().registrations, 0);
});

test('실제 복구 실행은 개인 저장소와 캐시 관리 객체에 접근하지 않는다', async () => {
  const names = ['localStorage', 'indexedDB', 'caches'];
  const descriptors = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  try {
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, get() { throw Error(`forbidden access: ${name}`); } });
    const f = fixture(); assert.equal((await recoverApp(f.options)).ok, true);
    f.options.requestStatus = async () => ({ ready: false });
    assert.equal((await recoverApp(f.options)).ok, false);
  } finally {
    for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});

test('MessageChannel 상태 조회는 정해진 공개 상태 메시지만 전송한다', async () => {
  let sent, closed = 0;
  class Channel {
    constructor() { this.port1 = { close: () => { closed++; } }; this.port2 = { close: () => { closed++; } }; Channel.instance = this; }
  }
  const worker = { postMessage(message, ports) { sent = message; assert.equal(ports[0], Channel.instance.port2); queueMicrotask(() => Channel.instance.port1.onmessage({ data: { ready: true } })); } };
  assert.deepEqual(await readWorkerStatus(worker, 100, Channel), { ready: true });
  assert.deepEqual(sent, { type: 'OFFLINE_CACHE_STATUS' }); assert.equal(closed, 2);
});

test('복구 경로는 개인 저장소·캐시삭제·클라우드 API를 호출하지 않는다', async () => {
  const source = await readFile(new URL('../app_update.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|indexedDB|caches\s*\.|firebase|unregister\s*\(/);
  const html = await readFile(new URL('../update.html', import.meta.url), 'utf8');
  assert.match(html, /기존 앱 열기/); assert.match(html, /retry\.addEventListener\('click',run\);run\(\)/);
  assert.match(html, /if\(busy\|\|redirected\)return/);
});
