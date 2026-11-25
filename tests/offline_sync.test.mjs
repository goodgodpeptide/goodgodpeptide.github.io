import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineSync as makeSync, mergeOfflineData } from '../offline_sync.js';
function memory() {
  const data = new Map();
  const snapshots = new Map(); const queues = new Map();
  return { data, snapshots, get length(){return data.size;}, key:i=>[...data.keys()][i]??null, removeItem:key=>data.delete(key), getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), archive:{put:async(k,v)=>{assert.equal(snapshots.has(k),false);snapshots.set(k,v);}}, locks:{request:(key,_options,callback)=>{const next=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(callback);queues.set(key,next);return next;}} };
}
function createOfflineSync(options){return makeSync({archive:options.storage.archive,locks:options.storage.locks,...options});}

function oldConflict(storage, { real = false, missing = false } = {}) {
  const base = { supplements: [{ id: 'sample', stock: 3, checked: false }] };
  const local = { supplements: [{ ...base.supplements[0], checked: true }] };
  const remote = { supplements: [{ checked: false, stock: real ? 2 : 3, id: 'sample' }] };
  const conflict = { path: 'supplements[["id","","sample"]]', base: base.supplements[0], local: local.supplements[0], remote: remote.supplements[0] };
  if (missing) delete conflict.remote;
  const state = { version: 1, uid: 'a', base, data: local, revision: 0, generation: 1, pending: true, conflicts: [conflict] };
  storage.setItem('jwbs_offline_v1:a', JSON.stringify(state));
  return { state, remote };
}

test('이전 오탐은 원본 보존 뒤 재대조하고 재시작·자동 flush에서도 명시 저장을 기다린다', async () => {
  const storage = memory(); const { remote } = oldConflict(storage); let commits = 0;
  const options = { storage, readRemote: async () => ({ data: remote, revision: 2 }), commitRemote: async (_uid, data, revision) => { commits++; return { data: { ...data, syncRevision: revision + 1 }, revision: revision + 1 }; } };
  const result = await createOfflineSync(options).recheck('a');
  assert.equal(result.status, 'reviewed'); assert.equal(result.cleared, 1); assert.equal(commits, 0);
  assert.equal(result.state.data.supplements[0].checked, true); assert.equal(result.state.data.supplements[0].stock, 3);
  assert.ok([...storage.snapshots.keys()].some(key => key.endsWith(':before-conflict-recheck')));
  const restarted = createOfflineSync(options);
  assert.equal((await restarted.flush('a')).status, 'reviewed'); assert.equal(commits, 0);
  assert.equal((await restarted.flush('a', { confirmReviewed: true })).status, 'synced'); assert.equal(commits, 1);
});

test('실제 변경·삭제 원본 누락 충돌은 재대조해도 유지한다', async () => {
  for (const settings of [{ real: true }, { missing: true }]) {
    const storage = memory(); const { remote } = oldConflict(storage, settings);
    const engine = createOfflineSync({ storage, readRemote: async () => ({ data: remote, revision: 2 }), commitRemote: async () => { throw Error('서버 쓰기 금지'); } });
    assert.equal((await engine.recheck('a')).status, 'conflict');
    assert.ok(engine.load('a').conflicts.length);
    assert.equal((await engine.flush('a', { confirmReviewed: true })).status, 'conflict');
  }
});

test('재대조 원본 보존 실패·계정 변경은 기존 상태를 바꾸지 않는다', async () => {
  for (const mode of ['archive', 'account']) {
    const storage = memory(); const { remote } = oldConflict(storage); const before = storage.getItem('jwbs_offline_v1:a'); let active = true;
    const engine = createOfflineSync({ storage, archive: mode === 'archive' ? { put: async () => { throw Error('quota'); } } : storage.archive, readRemote: async () => { active = false; return remote; }, commitRemote: async () => { throw Error('쓰기 금지'); } });
    await assert.rejects(engine.recheck('a', { assertCurrent: () => { if (!active) throw Error('계정 변경'); } }));
    assert.equal(storage.getItem('jwbs_offline_v1:a'), before);
  }
});

test('재대조 대기 중 다른 창의 새 저널을 덮거나 지우지 않는다', async () => {
  const storage = memory(); const { remote } = oldConflict(storage); let release;
  const engine = createOfflineSync({ storage, readRemote: async () => { await new Promise(resolve => { release = resolve; }); return remote; }, commitRemote: async () => { throw Error('쓰기 금지'); } });
  const flight = engine.recheck('a');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const other = createOfflineSync({ storage });
  const newData = other.load('a').data; newData.custom = 'new';
  const edit = other.stage('a', newData);
  release();
  assert.equal((await flight).status, 'changed'); await edit;
  assert.equal(engine.load('a').data.custom, 'new'); assert.ok(engine.load('a').conflicts.length);
});
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

test('영양제 객체 속성 순서만 다른 서버는 로컬 변경과 충돌하지 않는다', () => {
  const base = { supplements: [{ id: 'sample', name: 'demo', stock: 3, checked: false, details: { unit: 'pill', count: 1 } }] };
  const local = { supplements: [{ ...base.supplements[0], checked: true }] };
  const remote = { supplements: [{ details: { count: 1, unit: 'pill' }, checked: false, stock: 3, name: 'demo', id: 'sample' }] };
  const result = mergeOfflineData(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.data, local);
  assert.deepEqual(mergeOfflineData(base, remote, local).data, local);
});

test('JSON 값 동등성은 유지하고 배열 순서와 숫자 문자열은 구분한다', () => {
  const base = { supplements: [{ id: 'sample', absent: undefined, value: NaN, list: [undefined, 1], checked: false }] };
  const local = { supplements: [{ ...base.supplements[0], checked: true }] };
  const remote = { supplements: [{ checked: false, list: [null, 1], value: null, id: 'sample' }] };
  assert.deepEqual(mergeOfflineData(base, local, remote).conflicts, []);
  for (const list of [[1, null], [null, '1']]) {
    assert.equal(mergeOfflineData(base, local, { supplements: [{ ...remote.supplements[0], list }] }).conflicts.length, 1);
  }
  assert.equal(mergeOfflineData({ value: undefined }, { value: 1 }, { value: null }).conflicts.length, 1);
});

test('영양제 같은 행의 다른 속성 수정도 기존 충돌 정책을 유지한다', () => {
  const row = { id: 'sample', stock: 3, checked: false };
  for (const remote of [{ ...row, checked: 'different' }, { ...row, stock: 2 }]) {
    const result = mergeOfflineData({ supplements: [row] }, { supplements: [{ ...row, checked: true }] }, { supplements: [remote] });
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].path, 'supplements[["id","","sample"]]');
    assert.equal(result.data.supplements[0].stock, 3);
    assert.equal(result.conflicts[0].remote.stock, remote.stock);
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
