import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function context() {
  const elements = [], writes = [], notices = [];
  const element = () => { const e = { style: {}, append() {}, appendChild() {}, remove() {} }; elements.push(e); return e; };
  const ctx = vm.createContext({ currentUser: { uid: 'A' }, _offlineAuthEpoch: 1, _pendingRecovery: null, _pendingAllowEmpty: false,
    pendingRestoreData: null, pendingRestoreOwner: null, saveTimer: null, _lastSyncedRevision: 0, dataLoaded: true, appData: { records: [{ id: 'A' }] },
    document: { createElement: element, body: { appendChild() {} }, getElementById: () => element() },
    removeRecoveryGate() {}, renderAll() {}, showToast: text => notices.push(text), clearTimeout() {},
  });
  for (const name of ['_captureOfflineOwner', '_offlineOwnerIsCurrent', '_offlineDocumentFingerprint', '_allowEmptyForCurrentData', '_resetAccountRecovery']) {
    const start = source.indexOf(`function ${name}(`); vm.runInContext(source.slice(start, source.indexOf('\n', start)), ctx);
  }
  const start = source.indexOf('function renderRecoveryGate(){');
  vm.runInContext(source.slice(start, source.indexOf('async function enterRecoveryGate', start)), ctx);
  ctx.saveData = async () => { writes.push({ uid: ctx.currentUser.uid, data: ctx.appData }); ctx._lastSyncedRevision++; return { status: 'synced' }; };
  return { ctx, elements, writes, notices };
}
function candidate(ctx) { return { owner: ctx._captureOfflineOwner(), date: 'synthetic', data: { records: [{ id: 'backup-A' }] }, analysis: { backupMissingFromServer: 1, serverMissingFromBackup: 0, mergedCount: 1 } }; }

test('실제 복구 gate의 이전 계정 버튼은 계정 전환 뒤 기록을 적용하거나 저장하지 않는다', async () => {
  const f = context(); f.ctx._pendingRecovery = candidate(f.ctx); f.ctx.renderRecoveryGate();
  const confirm = f.elements.find(e => e.textContent?.includes('건 복구'));
  f.ctx.currentUser = { uid: 'B' }; f.ctx._offlineAuthEpoch++;
  f.ctx._resetAccountRecovery(); f.ctx.appData = { records: [{ id: 'B' }] };
  await confirm.onclick();
  assert.equal(f.writes.length, 0); assert.equal(f.ctx.appData.records[0].id, 'B');
  assert.equal(f.ctx._pendingRecovery, null); assert.equal(f.ctx.pendingRestoreData, null);
});

test('복구 저장 대기 중 계정이 바뀌면 이전 완료 UI로 새 계정을 갱신하지 않는다', async () => {
  const f = context(); let release; f.ctx._pendingRecovery = candidate(f.ctx); f.ctx.renderRecoveryGate();
  f.ctx.saveData = async () => { await new Promise(resolve => { release = resolve; }); return { status: 'synced' }; };
  const flight = f.elements.find(e => e.textContent?.includes('건 복구')).onclick();
  f.ctx.currentUser = { uid: 'B' }; f.ctx._offlineAuthEpoch++; f.ctx._resetAccountRecovery(); f.ctx.appData = { records: [{ id: 'B' }] };
  release(); await flight;
  assert.equal(f.notices.length, 0); assert.equal(f.ctx.appData.records[0].id, 'B');
});

test('현재 계정 복구는 실제 synced 결과일 때만 완료한다', async () => {
  for (const status of ['synced', 'reviewed', 'conflict', 'error', 'offline']) {
    const f = context(); f.ctx._pendingRecovery = candidate(f.ctx); f.ctx.renderRecoveryGate();
    f.ctx.saveData = async () => { f.ctx._lastSyncedRevision += 2; return { status }; };
    await f.elements.find(e => e.textContent?.includes('건 복구')).onclick();
    assert.equal(f.ctx._pendingRecovery === null, status === 'synced');
  }
});

test('빈 문서 허용은 해당 계정·승인 epoch·삭제한 정확한 문서에만 한 번 적용한다', async () => {
  const f = context(); const calls = [];
  f.ctx.appData = { records: [], syncRevision: 1, updatedAt: 1 };
  f.ctx._pendingAllowEmpty = f.ctx._allowEmptyForCurrentData();
  f.ctx.db = {}; f.ctx.runTransaction = () => {}; f.ctx.doc = (_db,_name,uid) => ({ uid });
  f.ctx.commitUserDocument = async options => { options.assertCurrent(); calls.push(options.allowEmpty); return { revision: 2 }; };
  const start = source.indexOf('commitRemote:async('), end = source.indexOf('\n applyData:', start);
  const commit = vm.runInContext('({' + source.slice(start, end) + '}).commitRemote', f.ctx);
  await commit('A', { records: [], syncRevision: 2 }, 1); await commit('A', { records: [] }, 2);
  assert.deepEqual(calls, [true, false]);
  f.ctx._pendingAllowEmpty = f.ctx._allowEmptyForCurrentData(); f.ctx._offlineAuthEpoch++;
  await commit('A', { records: [] }, 2); assert.equal(calls.at(-1), false);
  f.ctx._pendingAllowEmpty = f.ctx._allowEmptyForCurrentData();
  await commit('A', { records: [], supplements: [] }, 2); assert.equal(calls.at(-1), false);
});

test('파일 읽기 완료가 늦게 도착해도 다른 계정의 복원 후보로 등록하지 않는다', () => {
  const f = context(); let reader;
  f.ctx.FileReader = class { constructor() { reader = this; } readAsText() {} };
  const map = { 0xc70: 'files', 0x974: 'onload', 0x46b: 'target', 0x77c: 'result', 0xd68: 'parse', 0xb45: 'data', 0x3ff: 'weightRecords', 0x459: 'getElementById', 0x468: 'warning', 0xc2a: 'display', 0xa83: 'block', 0x73e: 'readAsText', 0x231: 'value' };
  f.ctx.a0_0x4109b5 = key => map[key]; f.ctx.alert = () => {};
  const start = source.indexOf('window[a0_0x4109b5(0xa0a)]=function('), end = source.indexOf(',window[', start);
  const expression = source.slice(source.indexOf(']=', start) + 2, end);
  const onFile = vm.runInContext('(' + expression + ')', f.ctx);
  onFile({ target: { files: [{}] } });
  f.ctx.currentUser = { uid: 'B' }; f.ctx._offlineAuthEpoch++;
  reader.onload({ target: { result: JSON.stringify({ records: [{ id: 'A' }] }) } });
  assert.equal(f.ctx.pendingRestoreData, null);
});

test('이전 계정에서 만든 삭제 취소 버튼은 새 계정에 기록을 삽입하지 않는다', () => {
  const f = context(); let undo;
  f.ctx.a0_0x4109b5 = key => ({ 0xc97: 'records', 0xd4c: 'findIndex', 0x536: 'splice', 0x18b: 'min', 0x9f8: 'length' })[key];
  f.ctx.scheduleSave = () => {}; f.ctx.showToast = (_text,_ms,options) => { undo = options.onClick; };
  const start = source.indexOf('window[a0_0x4109b5(0x755)]='), end = source.indexOf(',window[', start);
  const remove = vm.runInContext('(' + source.slice(source.indexOf(']=', start) + 2, end) + ')', f.ctx);
  remove('A');
  f.ctx.currentUser = { uid: 'B' }; f.ctx._offlineAuthEpoch++; f.ctx.appData = { records: [{ id: 'B' }] };
  undo(); assert.deepEqual(f.ctx.appData.records.map(row => row.id), ['B']);
});

test('실제 JSON 복원 확정 함수는 이전 계정 후보를 적용하지 않고 실패를 완료로 알리지 않는다', async () => {
  for (const status of ['error', 'synced']) {
    const f = context(); f.ctx.pendingRestoreData = { records: [{ id: 'backup-A' }] }; f.ctx.pendingRestoreOwner = f.ctx._captureOfflineOwner();
    f.ctx.migrateData = value => value;
    const start = source.indexOf('window[a0_0x4109b5(0xb3d)]='), end = source.indexOf(',window[', start);
    const confirm = vm.runInContext('(' + source.slice(source.indexOf(']=', start) + 2, end) + ')', f.ctx);
    f.ctx.saveData = async () => ({ status });
    await confirm();
    assert.equal(f.ctx.pendingRestoreData === null, status === 'synced');
    if (status === 'error') assert.ok(!f.notices.some(text => text.includes('서버에 저장했습니다')));
    f.ctx.pendingRestoreData = { records: [{ id: 'backup-A' }] }; f.ctx.pendingRestoreOwner = { uid: 'A', epoch: 1 };
    f.ctx.currentUser = { uid: 'B' }; f.ctx._offlineAuthEpoch = 2; f.ctx.appData = { records: [{ id: 'B' }] };
    await confirm(); assert.equal(f.ctx.appData.records[0].id, 'B');
  }
});
