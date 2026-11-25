import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const signature = between('function offlineVisibleData(', '\nfunction offlineExportOriginals(');
const apply = between('applyData:(data,state)=>', '\n onStatus:').slice('applyData:'.length).trim().replace(/,$/, '');

test('서버 저장 메타 갱신은 입력 화면을 다시 만들지 않고 실제 다른 기록은 반영한다', () => {
  let renders = 0;
  const context = { appData: { records: [{ id: 1 }], syncRevision: 1 }, dataLoaded: true, renderAll: () => renders++, offlineCacheBanner() {} };
  vm.createContext(context);
  const update = vm.runInContext(signature + ';(' + apply + ')', context);
  update({ records: [{ id: 1 }], syncRevision: 2, updatedAt: 100 }, { revision: 2 });
  assert.equal(renders, 0);
  assert.equal(context._lastSyncedRevision, 2);
  update({ records: [{ id: 1 }, { id: 2 }], syncRevision: 3 }, { revision: 3 });
  assert.equal(renders, 1);
  assert.equal(context.appData.records.length, 2);
});

test('실행을 마친 자동 저장 타이머는 화면 숨김 시 중복 저장 대상으로 남지 않는다', async () => {
  let callback, flushes = 0;
  const context = { currentUser: { uid: 'fixture' }, dataLoaded: true, _offlineLastServer: {}, saveTimer: null,
    offlineApp: { stage: () => Promise.resolve(), flush: () => { flushes++; return Promise.resolve(); } },
    clearTimeout() {}, setTimeout: value => { callback = value; return 123; }, setSaveStatus() {} };
  vm.createContext(context);
  vm.runInContext(between('function scheduleSave(){', 'window.addEventListener(\'pagehide\''), context);
  context.scheduleSave();
  assert.equal(context.saveTimer, 123);
  callback();
  assert.equal(context.saveTimer, null);
  assert.equal(flushes, 1);
});

test('상태별 짧은 문구와 상세 설명을 분리해 같은 상태 버튼을 유지한다', () => {
  const element = { textContent: '', style: {}, dataset: {}, setAttribute(key, value) { this[key] = value; } };
  const context = { document: { getElementById: () => element, body: { classList: { contains: () => false } } }, window: {}, a0_0x4109b5: () => '_saveStatus' };
  vm.createContext(context);
  vm.runInContext(between('function setSaveStatus(', 'const DRUG_CONFIG='), context);
  for (const state of ['local', 'saving', 'saved', 'offline', 'error', 'loading']) {
    context.setSaveStatus(state);
    assert.ok(element.textContent.length <= 7);
    assert.equal(element.dataset.state, state);
    assert.match(element['aria-label'], /동기화 상세 확인/);
    assert.equal(context.window._saveStatus, state);
  }
});
