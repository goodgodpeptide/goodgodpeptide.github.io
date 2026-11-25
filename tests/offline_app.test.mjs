import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineApp, createApprovalCache, createIndexedArchive } from '../offline_app.js';
import { createOfflineSync } from '../offline_sync.js';

function fixture() {
  const values = new Map(), snapshots = new Map(), queues = new Map();
  const storage = { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const locks = { request: (key, _options, callback) => { const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(callback); queues.set(key, next); return next; } };
  const archive = { put: async (key, value) => { assert.equal(snapshots.has(key), false); snapshots.set(key, structuredClone(value)); } };
  return { storage, locks, archive, values, snapshots };
}

test('원격 읽기 중 승인 철회나 같은 계정 재승인이 발생하면 이전 저장은 중단한다', async () => {
  for (const reauthorize of [false, true]) {
    const f = fixture(), user = { uid: 'one', email: 'one@example.invalid' }; let release, writes = 0;
    const state = { version: 1, uid: user.uid, base: { records: [] }, data: { records: [{ id: 1 }] }, revision: 0, generation: 1, pending: true, conflicts: [] };
    f.storage.setItem('jwbs_offline_v1:one', JSON.stringify(state));
    const app = createOfflineApp({ ...f, getUser: () => user, getData: () => state.data, applyData() {}, isOnline: () => true,
      readRemote: async () => { await new Promise(resolve => { release = resolve; }); return { data: state.base, revision: 0 }; },
      commitRemote: async () => { writes++; },
    });
    app.approvals.record(user, true); app.restore(user, { offline: true }); app.authorize(user);
    const flight = app.flush();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    app.activate(user);
    if (reauthorize) app.authorize(user); else app.approvals.record(user, false);
    release(); await assert.rejects(flight);
    assert.equal(writes, 0); assert.equal(app.engine.load(user.uid).pending, true);
  }
});

test('원본 내보내기 대기 중 계정이 바뀌면 이전 계정 파일을 반환하지 않는다', async () => {
  const f = fixture(); let user = { uid: 'one', email: 'one@example.invalid' }, release;
  f.storage.setItem('jwbs_offline_v1:one', JSON.stringify({ version: 1, uid: 'one', base: {}, data: {}, pending: false }));
  f.archive.list = async () => { await new Promise(resolve => { release = resolve; }); return [{ original: 'synthetic' }]; };
  const app = createOfflineApp({ ...f, getUser: () => user, getData: () => ({}), applyData() {}, isOnline: () => true });
  app.approvals.record(user, true); app.restore(user, { offline: true });
  const result = app.exportBundle(); user = { uid: 'two', email: 'two@example.invalid' }; app.activate(user);
  release(); await assert.rejects(result, /계정이 변경/);
});

function noticeFixture() {
  const f = fixture(), handlers = new Map();
  let user = { uid: 'one', email: 'one@example.invalid' }, data = { records: [{ id: 1 }] };
  const notices = [], conflicts = [], cleared = [];
  const state = { version: 1, uid: user.uid, base: { records: [] }, data, revision: 0, generation: 1, pending: true, conflicts: [], reviewedHold: true };
  f.storage.setItem('jwbs_offline_v1:one', JSON.stringify(state));
  const options = { ...f, getUser: () => user, getData: () => data, applyData: value => { data = value; }, isOnline: () => true,
    events: { addEventListener: (name, callback) => handlers.set(name, callback) }, onReviewed: value => notices.push(value), onConflict: (rows, value) => conflicts.push({ rows, state: value }), onNoticeCleared: value => cleared.push(value) };
  return { ...f, handlers, options, state, notices, conflicts, cleared, getData: () => data, setData: value => { data = value; }, setUser: value => { user = value; }, getUser: () => user };
}

test('다른 탭의 저장 성공은 오래된 안내만 해제하고 실제 충돌에는 원본 상태를 전달한다', () => {
  const f = noticeFixture(); let writes = 0;
  const app = createOfflineApp({ ...f.options, commitRemote: async () => { writes++; } });
  app.approvals.record(f.getUser(), true); app.restore(f.getUser(), { offline: true });
  const initial = f.cleared.length;
  const done = { ...f.state, pending: false, reviewedHold: false, revision: 1 };
  f.storage.setItem('jwbs_offline_v1:one', JSON.stringify(done));
  f.handlers.get('storage')({ key: 'jwbs_offline_v1:one' });
  assert.equal(f.cleared.length, initial + 1); assert.deepEqual(f.cleared.at(-1), done);
  const conflict = { ...done, conflicts: [{ path: 'records', local: [], remote: [{ id: 1 }] }] };
  f.storage.setItem('jwbs_offline_v1:one', JSON.stringify(conflict));
  f.handlers.get('storage')({ key: 'jwbs_offline_v1:one' });
  assert.deepEqual(f.conflicts.at(-1), { rows: conflict.conflicts, state: conflict });
  assert.equal(f.cleared.length, initial + 1); assert.equal(writes, 0);
});

test('계정 전환은 이전 안내를 해제하되 같은 계정 활성화는 hold 표시 상태를 초기화하지 않는다', () => {
  const f = noticeFixture(); const app = createOfflineApp(f.options);
  app.approvals.record(f.getUser(), true); app.restore(f.getUser(), { offline: true });
  const count = f.cleared.length;
  app.activate(f.getUser()); assert.equal(f.cleared.length, count);
  f.setUser({ uid: 'two', email: 'two@example.invalid' }); app.activate(f.getUser());
  assert.equal(f.cleared.at(-1).uid, 'two'); assert.equal(f.cleared.at(-1).reason, 'account-change');
  assert.equal(app.engine.load('one').reviewedHold, true);
});

test('hold 반복 알림과 자동 flush는 쓰기나 안내 해제를 유발하지 않는다', async () => {
  const f = noticeFixture(); let writes = 0;
  const app = createOfflineApp({ ...f.options, readRemote: async () => ({}), commitRemote: async () => { writes++; } });
  app.approvals.record(f.getUser(), true); app.restore(f.getUser(), { offline: true }); app.authorize(f.getUser());
  const clearCount = f.cleared.length;
  for (let i = 0; i < 3; i++) { assert.equal((await app.flush()).status, 'reviewed'); f.handlers.get('storage')({ key: 'jwbs_offline_v1:one' }); }
  assert.equal(writes, 0); assert.equal(f.cleared.length, clearCount);
  assert.equal(app.engine.load('one').reviewedHold, true);
});

test('변경 없는 stage와 idle flush 반복은 저장상태 전환·렌더·원본 추가·서버쓰기를 하지 않는다', async () => {
  const f = noticeFixture(); let applies = 0, reads = 0, writes = 0; const statuses = [];
  const state = { ...f.state, base: f.state.data, pending: false, reviewedHold: false };
  f.storage.setItem('jwbs_offline_v1:one', JSON.stringify(state));
  const app = createOfflineApp({ ...f.options, onStatus: value => statuses.push(value), applyData: (data, meta) => { applies++; f.options.applyData(data, meta); }, readRemote: async () => { reads++; return {}; }, commitRemote: async () => { writes++; } });
  app.approvals.record(f.getUser(), true); app.restore(f.getUser(), { offline: true }); app.authorize(f.getUser());
  const before = f.storage.getItem('jwbs_offline_v1:one'); const count = applies; statuses.length = 0;
  for (let i = 0; i < 3; i++) { await app.stage(); assert.equal((await app.flush()).status, 'idle'); f.handlers.get('storage')({ key: 'jwbs_offline_v1:one' }); }
  assert.equal(applies, count); assert.equal(reads, 0); assert.equal(writes, 0); assert.equal(f.snapshots.size, 0);
  assert.equal(f.storage.getItem('jwbs_offline_v1:one'), before);
  assert.ok(!statuses.includes('saving')); assert.ok(!statuses.includes('local'));
});

test('hold와 실제 충돌은 자동 재시도에서 저장중으로 바뀌거나 전체 렌더하지 않는다', async () => {
  for (const conflicts of [[], [{ path: 'records', base: [], local: [{ id: 1 }], remote: [{ id: 2 }] }]]) {
    const f = noticeFixture(); let applies = 0, writes = 0; const statuses = [];
    f.storage.setItem('jwbs_offline_v1:one', JSON.stringify({ ...f.state, conflicts }));
    const app = createOfflineApp({ ...f.options, onStatus: value => statuses.push(value), applyData: (data, state) => { applies++; f.options.applyData(data, state); }, commitRemote: async () => { writes++; } });
    app.approvals.record(f.getUser(), true); app.restore(f.getUser(), { offline: true }); app.authorize(f.getUser());
    const count = applies; statuses.length = 0;
    for (let i = 0; i < 3; i++) await app.flush();
    assert.equal(applies, count); assert.equal(writes, 0); assert.ok(!statuses.includes('saving'));
  }
});

test('다른 탭의 최신 기록과 화면이 달라도 무입력 stage가 그 기록을 덮지 않는다', async () => {
  const f = noticeFixture();
  const app = createOfflineApp(f.options); app.approvals.record(f.getUser(), true); app.restore(f.getUser(), { offline: true });
  const latest = { ...f.state, data: { records: [{ id: 1 }, { id: 2 }] }, generation: 2 };
  f.storage.setItem('jwbs_offline_v1:one', JSON.stringify(latest));
  await app.stage();
  assert.deepEqual(app.engine.load('one').data, latest.data); assert.equal(f.snapshots.size, 0);
  assert.equal(app.engine.load('one').generation, 2);
});

test('다른 탭 저장의 storage 이벤트를 놓쳐도 idle flush가 최신 변경만 한 번 반영한다', async () => {
  const f = noticeFixture(); let applies = 0, writes = 0;
  const initial = { ...f.state, pending: false, reviewedHold: false };
  f.storage.setItem('jwbs_offline_v1:one', JSON.stringify(initial));
  const app = createOfflineApp({ ...f.options, applyData: (data, state) => { applies++; f.options.applyData(data, state); }, commitRemote: async () => { writes++; } });
  app.approvals.record(f.getUser(), true); app.restore(f.getUser(), { offline: true }); app.authorize(f.getUser());
  const count = applies;
  const newest = { ...initial, data: { records: [{ id: 1 }, { id: 2 }], syncRevision: 2 }, revision: 2, generation: 2 };
  f.storage.setItem('jwbs_offline_v1:one', JSON.stringify(newest));
  await app.stage();
  assert.equal((await app.flush()).status, 'idle');
  assert.equal(applies, count + 1); assert.deepEqual(f.getData(), newest.data);
  await app.flush(); assert.equal(applies, count + 1); assert.equal(writes, 0);
});

test('앞선 stage 원본 보존 실패는 동일값 no-op으로 성공 처리하지 않고 재시도한다', async () => {
  const f = noticeFixture(); let fail = true;
  const put = f.archive.put; f.archive.put = async (...args) => { if (fail) throw Error('archive unavailable'); return put(...args); };
  const app = createOfflineApp(f.options); app.approvals.record(f.getUser(), true); app.restore(f.getUser(), { offline: true }); app.authorize(f.getUser());
  f.setData({ records: [{ id: 1 }, { id: 2 }] });
  await assert.rejects(app.stage());
  await assert.rejects(app.flush());
  fail = false; await app.stage();
  assert.deepEqual(app.engine.load('one').data.records.map(row => row.id), [1, 2]);
  assert.ok(f.snapshots.size > 0);
  assert.equal([...f.values.keys()].filter(key => key.includes(':journal:')).length, 0);
});

test('명시 저장 도중 새 입력이 있으면 pending과 보호 안내를 보존한다', async () => {
  const f = noticeFixture(); let release;
  const app = createOfflineApp({ ...f.options, readRemote: async () => ({ data: { records: [] }, revision: 0 }), commitRemote: async (_uid, data) => { await new Promise(resolve => { release = resolve; }); return { data: { ...data, syncRevision: 1 }, revision: 1 }; } });
  app.approvals.record(f.getUser(), true); app.restore(f.getUser(), { offline: true }); app.authorize(f.getUser());
  const clearCount = f.cleared.length;
  const flush = app.flush({ confirmReviewed: true });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  f.setData({ records: [{ id: 1 }, { id: 2 }] }); const stage = app.stage();
  release(); const result = await flush; await stage;
  assert.equal(result.status, 'pending');
  assert.deepEqual(new Set(app.engine.load('one').data.records.map(row => row.id)), new Set([1, 2]));
  assert.equal(app.engine.load('one').pending, true); assert.equal(app.engine.load('one').reviewedHold, true);
  assert.equal(f.cleared.length, clearCount);
});

test('재대조 보류 안내는 재시작과 다른 창 갱신에도 복원하고 승인 전에는 저장하지 않는다', async () => {
  const f = fixture(); const user = { uid: 'one', email: 'one@example.invalid' }; let reviewed = 0, writes = 0; const handlers = new Map();
  const state = { version: 1, uid: user.uid, base: {}, data: {}, revision: 0, generation: 1, pending: true, conflicts: [], reviewedHold: true };
  f.storage.setItem('jwbs_offline_v1:one', JSON.stringify(state));
  const options = { ...f, getUser: () => user, getData: () => ({}), applyData: () => {}, isOnline: () => true, onReviewed: value => { assert.equal(value.reviewedHold, true); reviewed++; },
    events: { addEventListener: (name, fn) => handlers.set(name, fn) }, readRemote: async () => ({}), commitRemote: async () => { writes++; } };
  const app = createOfflineApp(options); app.approvals.record(user, true);
  assert.equal(app.restore(user, { offline: true }), true); assert.equal(reviewed, 1);
  await assert.rejects(app.recheckConflicts()); assert.equal(writes, 0);
  app.authorize(user);
  handlers.get('storage')({ key: 'jwbs_offline_v1:one' }); assert.equal(reviewed, 2);
  assert.equal((await app.flush()).status, 'reviewed'); assert.equal(reviewed, 3); assert.equal(writes, 0);
});
test('승인 캐시는 UID와 이메일을 함께 확인하며 거절 시 해제한다', () => {
  const { storage } = fixture(); const cache = createApprovalCache(storage);
  const user = { uid: 'one', email: 'one@example.invalid' };
  assert.equal(cache.allows(user), false);
  cache.record(user, true);
  assert.equal(cache.allows(user), true);
  assert.equal(cache.allows({ ...user, email: 'other@example.invalid' }), false);
  assert.equal(cache.allows({ ...user, uid: 'other' }), false);
  cache.record(user, false);
  assert.equal(cache.allows(user), false);
});
test('실제 앱 어댑터는 온라인 기준본 저장→오프라인 입력→재시작→재연결 병합을 수행한다', async () => {
  const f = fixture(); let user = { uid: 'one', email: 'one@example.invalid' }, online = true;
  let data = { records: [{ id: 1 }], unknown: { flag: true } }, server = { ...structuredClone(data), syncRevision: 4 }, writes = 0;
  const options = { ...f, getUser: () => user, getData: () => data, applyData: value => { data = value; }, isOnline: () => online,
    readRemote: async () => { if (!online) throw Error('offline'); return { data: structuredClone(server), revision: server.syncRevision }; },
    commitRemote: async (_uid, value, expectedRevision) => { assert.equal(expectedRevision, server.syncRevision); writes++; server = { ...structuredClone(value), syncRevision: expectedRevision + 1 }; return { data: structuredClone(server), revision: server.syncRevision }; } };
  const app = createOfflineApp(options); app.approvals.record(user, true);
  await app.seed(user, data, server);
  assert.equal(writes, 1);
  online = false; data.records.push({ id: 2 });
  const saved = app.stage();
  assert.ok([...f.values.keys()].some(key => key.includes(':journal:')), '지연 실행 전에 동기식 원본 journal을 남긴다');
  await saved;
  const restarted = createOfflineApp(options);
  assert.equal(restarted.restore(user, { offline: true }), true);
  assert.equal(data.records.length, 2);
  online = true; server.records.push({ id: 3 }); server.syncRevision++;
  restarted.authorize(user);
  await restarted.flush();
  assert.deepEqual(new Set(server.records.map(row => row.id)), new Set([1, 2, 3]));
  assert.equal(server.unknown.flag, true);
  assert.equal(restarted.engine.load(user.uid).pending, false);
});
test('첫 오프라인과 다른 계정은 진입·동기화를 허용하지 않는다', async () => {
  const f = fixture(); let user = { uid: 'one', email: 'one@example.invalid' }; let calls = 0;
  const app = createOfflineApp({ ...f, getUser: () => user, getData: () => ({}), applyData: () => {}, isOnline: () => true, readRemote: async () => { calls++; }, commitRemote: async () => {} });
  assert.equal(app.restore(user, { offline: true }), false);
  app.activate(user);
  await app.flush(); assert.equal(calls, 0);
  app.approvals.record(user, true);
  assert.equal(app.restore(user, { offline: true }), false, '로컬 전체상태도 있어야 한다');
  user = { uid: 'two', email: 'two@example.invalid' };
  assert.equal(app.restore(user, { offline: true }), false);
});
test('늦게 도착한 이전 계정 seed는 새 계정 화면을 바꾸지 않는다', async () => {
  const f = fixture(); const oldUser = { uid: 'old', email: 'old@example.invalid' };
  const user = { uid: 'new', email: 'new@example.invalid' }; let applied = 0;
  const app = createOfflineApp({ ...f, getUser: () => user, getData: () => ({}), applyData: () => { applied++; }, isOnline: () => false, readRemote: async () => ({}), commitRemote: async () => {} });
  app.approvals.record(oldUser, true);
  await assert.rejects(app.seed(oldUser, { secret: true }, {}));
  assert.equal(applied, 0);
});
test('WiFi만 연결된 상태의 로컬 복원은 입력을 보존하되 서버 승인 재확인 전에는 전송하지 않는다', async () => {
  const f = fixture(); const user = { uid: 'one', email: 'one@example.invalid' };
  let data = { records: [{ id: 1 }] }, calls = 0;
  const app = createOfflineApp({ ...f, getUser: () => user, getData: () => data, applyData: value => { data = value; }, isOnline: () => true,
    readRemote: async () => { calls++; return { data: {}, revision: 0 }; }, commitRemote: async (_uid, value) => ({ data: { ...value, syncRevision: 1 }, revision: 1 }) });
  app.approvals.record(user, true);
  await app.engine.stage(user.uid, data, { base: {} });
  assert.equal(app.restore(user, { offline: true }), true);
  data.records.push({ id: 2 }); await app.stage();
  assert.equal((await app.flush()).status, 'offline');
  assert.equal(calls, 0);
  assert.equal(app.engine.load(user.uid).data.records.length, 2);
  app.authorize(user);
  assert.equal((await app.flush()).status, 'synced');
  assert.equal(calls, 1);
});
test('두 탭의 별도 추가를 합치고 같은 항목 수정 충돌은 서버 쓰기를 막는다', async () => {
  const f = fixture(); let writes = 0;
  const base = { records: [{ id: 1, value: 1 }], syncRevision: 1 };
  const options = { ...f, readRemote: async () => ({ data: base, revision: 1 }), commitRemote: async (_uid, data) => { writes++; return { data: { ...data, syncRevision: 2 }, revision: 2 }; } };
  const first = createOfflineSync({ ...options, writerId: 'tab-a' }), second = createOfflineSync({ ...options, writerId: 'tab-b' });
  await first.stage('one', base, { base });
  const view = structuredClone(first.load('one').data);
  await Promise.all([first.stage('one', { ...view, records: [...view.records, { id: 2 }] }, { editBase: view }), second.stage('one', { ...view, records: [...view.records, { id: 3 }] }, { editBase: view })]);
  assert.deepEqual(new Set(first.load('one').data.records.map(row => row.id)), new Set([1, 2, 3]));
  const merged = structuredClone(first.load('one').data);
  await Promise.all([first.stage('one', { ...merged, records: merged.records.map(row => row.id === 1 ? { ...row, value: 2 } : row) }, { editBase: merged }), second.stage('one', { ...merged, records: merged.records.map(row => row.id === 1 ? { ...row, value: 3 } : row) }, { editBase: merged })]);
  assert.equal((await first.flush('one')).status, 'conflict');
  assert.equal(writes, 0);
  assert.ok(f.snapshots.size > 0);
  assert.equal([...f.values.keys()].filter(key => key.includes(':snapshot:')).length, 0, '과거 원본은 localStorage에 누적하지 않는다');
});
test('원본 아카이브 실패는 journal과 기존 pending을 보존하고 서버쓰기를 차단한다', async () => {
  const f = fixture(); let calls = 0;
  const engine = createOfflineSync({ ...f, archive: { put: async () => { throw Error('quota'); } }, readRemote: async () => { calls++; }, commitRemote: async () => {} });
  await assert.rejects(engine.stage('one', { records: [{ id: 1 }] }, { base: {} }));
  assert.equal(engine.load('one').pending, true);
  await assert.rejects(engine.flush('one'));
  assert.equal(calls, 0);
  assert.ok([...f.values.keys()].some(key => key.includes(':journal:')));
});
test('IndexedDB가 없으면 원본 보존 성공으로 오인하지 않는다', async () => {
  await assert.rejects(createIndexedArchive(null).put('key', { records: [] }));
});

test('commit 이후 아카이브 대기 중 새 입력 journal을 삭제하지 않는다', async () => {
  const f = fixture(); let commitRelease, archiveRelease, archivePaused;
  const paused = new Promise(resolve => { archivePaused = resolve; });
  const originalPut = f.archive.put;
  f.archive.put = async (key, value) => {
    if (key.endsWith(':during-commit')) { archivePaused(); await new Promise(resolve => { archiveRelease = resolve; }); }
    await originalPut(key, value);
  };
  const engine = createOfflineSync({ ...f, readRemote: async () => ({ data: {}, revision: 0 }), commitRemote: async (_uid, data) => { await new Promise(resolve => { commitRelease = resolve; }); return { data: { ...data, syncRevision: 1 }, revision: 1 }; } });
  await engine.stage('one', { records: [{ id: 1 }] }, { base: {} });
  const flush = engine.flush('one');
  while (!commitRelease) await new Promise(resolve => setImmediate(resolve));
  const second = engine.stage('one', { records: [{ id: 1 }, { id: 2 }] });
  commitRelease(); await paused;
  const third = engine.stage('one', { records: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  archiveRelease(); await flush; await second; await third;
  assert.deepEqual(new Set(engine.load('one').data.records.map(row => row.id)), new Set([1, 2, 3]));
  assert.equal(engine.load('one').pending, true);
});

test('같은 밀리초에 12번 입력해도 숫자 저널 순서를 유지한다', async () => {
  const f = fixture(); let release;
  const blocking = f.locks.request('jwbs_offline_v1:one', {}, () => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const engine = createOfflineSync({ ...f, now: () => 100, writerId: 'one-tab', readRemote: async () => ({}), commitRemote: async () => {} });
  const writes = [];
  for (let value = 1; value <= 12; value++) writes.push(engine.stage('one', { value }, { base: {} }));
  assert.equal(engine.load('one').data.value, 12);
  assert.equal(engine.load('one').conflicts.length, 0);
  release(); await blocking; await Promise.all(writes);
  assert.equal(engine.load('one').data.value, 12);
  assert.equal(engine.load('one').conflicts.length, 0);
});
