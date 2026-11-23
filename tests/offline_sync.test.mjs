import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineSync as makeSync, mergeOfflineData } from '../offline_sync.js';
function memory() {
  const data = new Map();
  const snapshots = new Map(); const queues = new Map();
  return { data, snapshots, get length(){return data.size;}, key:i=>[...data.keys()][i]??null, removeItem:key=>data.delete(key), getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), archive:{put:async(k,v)=>{assert.equal(snapshots.has(k),false);snapshots.set(k,v);}}, locks:{request:(key,_options,callback)=>{const next=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(callback);queues.set(key,next);return next;}} };
}
function createOfflineSync(options){return makeSync({archive:options.storage.archive,locks:options.storage.locks,...options});}
test('별도 추가와 알려지지 않은 필드를 모두 병합하고 중복을 만들지 않는다', () => {
  const base = { records: [{ id: 1 }], extra: { a: 1 } };
  const result = mergeOfflineData(base, { ...base, records: [{ id: 1 }, { id: 2 }], custom: ['x'] }, { ...base, records: [{ id: 1 }, { id: 3 }], extra: { a: 1, b: true } });
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.data.records.map(x => x.id), [1, 3, 2]);
  assert.deepEqual(result.data.custom, ['x']);
  assert.equal(result.data.extra.b, true);
});
test('같은 항목 양쪽 수정, 삭제 대 수정, 식별자 중복은 충돌한다', () => {
  const base = { records: [{ id: 1, a: 1 }] };
  for (const local of [{ records: [] }, { records: [{ id: 1, a: 2 }] }, { records: [{ id: 1 }, { id: 1 }] }]) {
    assert.ok(mergeOfflineData(base, local, { records: [{ id: 1, a: 3 }] }).conflicts.length);
  }
});
test('약물별 조제 ID와 날짜 키가 독립적으로 병합된다', () => {
  const result = mergeOfflineData({ v: [], w: [] }, { v: [{ drug: 'a', id: 1 }], w: [{ date: 'a' }] }, { v: [{ drug: 'b', id: 1 }], w: [{ date: 'b' }] });
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.data.v.length, 2);
  assert.equal(result.data.w.length, 2);
});
test('재시작과 계정 변경 후 pending을 유지하고 재연결 때만 commit한다', async () => {
  const storage = memory(); let online = false; let calls = 0;
  const options = { storage, readRemote: async () => { if (!online) throw Error('offline'); return { data: { records: [] }, revision: 0 }; }, commitRemote: async (uid, data, revision) => { calls++; return { data: { ...data, syncRevision: revision + 1 }, revision: revision + 1 }; } };
  await createOfflineSync(options).stage('a', { records: [{ id: 1 }] }, {base:{}});
  const engine = createOfflineSync(options);
  await assert.rejects(engine.flush('a'));
  await engine.stage('b', { records: [{ id: 2 }] }, {base:{}});
  assert.equal(engine.load('a').pending, true);
  online = true;
  await Promise.all([engine.flush('a'), engine.flush('a')]);
  assert.equal(calls, 1);
  assert.equal(engine.load('a').pending, false);
  assert.equal(engine.load('b').pending, true);
});
test('용량 초과 시 서버를 쓰지 않고 이전 pending을 유지한다', async () => {
  const storage = memory(); let calls = 0;
  const engine = createOfflineSync({ storage, readRemote: async () => { calls++; return {}; }, commitRemote: async () => {} });
  await engine.stage('a', { records: [{ id: 1 }] }, {base:{}});
  storage.setItem = () => { throw Error('quota'); };
  assert.throws(() => engine.stage('a', { records: [] }));
  await assert.rejects(engine.flush('a'));
  assert.equal(calls, 0);
  assert.equal(engine.load('a').data.records.length, 1);
});
test('동기화 중 추가 입력은 pending으로 남고 충돌은 반복 서버쓰기를 차단한다', async () => {
  const storage = memory(); let release; let calls = 0;
  const engine = createOfflineSync({ storage, readRemote: async () => ({ data: { records: [] }, revision: 0 }), commitRemote: async (_uid, data) => { calls++; await new Promise(resolve => { release = resolve; }); return { data: { ...data, syncRevision: 1 }, revision: 1 }; } });
  await engine.stage('a', { records: [{ id: 1 }] }, {base:{}});
  const flight = engine.flush('a');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const edit=engine.stage('a', { records: [{ id: 1 }, { id: 2 }] });
  release();
  assert.equal((await flight).status, 'pending');
  await edit;
  assert.equal(engine.load('a').data.records.length, 2);
  assert.ok([...storage.snapshots.keys()].some(key => key.includes('remote-before-commit')));
  assert.equal(calls, 1);
});
test('충돌 원본을 보존하고 재시작 후에도 서버쓰기를 차단한다', async () => {
  const storage = memory(); let calls = 0;
  const options = { storage, readRemote: async () => ({ data: { records: [{ id: 1, v: 3 }] }, revision: 2 }), commitRemote: async () => { calls++; } };
  const engine = createOfflineSync(options);
  await engine.stage('a', { records: [{ id: 1, v: 2 }] }, { base: { records: [{ id: 1, v: 1 }] } });
  assert.equal((await engine.flush('a')).status, 'conflict');
  assert.equal((await createOfflineSync(options).flush('a')).status, 'conflict');
  assert.equal(calls, 0);
  assert.equal(engine.load('a').pending, true);
  assert.ok([...storage.snapshots.keys()].some(key => key.endsWith(':conflict')));
});
