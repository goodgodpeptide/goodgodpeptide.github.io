import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineNotice } from '../offline_notice.js';

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.hidden = false; }
  appendChild(child) { child.remove(); this.children.push(child); child.parent = this; return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  setAttribute(name, value) { this.attributes[name] = value; }
}
function fixture(shared = new Map()) {
  let user = { uid: 'one' }, calls = 0;
  const root = new Element('main');
  const storage = { getItem: key => shared.get(key), setItem: (key, value) => shared.set(key, value) };
  const notice = createOfflineNotice({ document: { createElement: tag => new Element(tag) }, storage, getUser: () => user, place: panel => { if (panel.parent !== root) root.appendChild(panel); } });
  const model = { uid: 'one', revision: 7, kind: 'reviewed', title: '기기에 저장됨 · 서버 저장 대기', description: '원본 유지', actions: [{ label: '서버 저장 재시도', run: async () => { calls++; return { status: 'reviewed' }; } }] };
  return { notice, model, root, shared, get calls() { return calls; }, set user(value) { user = value; } };
}
const parts = f => {
  const panel = f.root.children[0], details = panel.children[1];
  return { panel, details, toggle: panel.children[0].children[1], action: details.children[1].children[0], feedback: details.children[2] };
};

test('재대조 안내는 처음부터 접혀 있으며 자동 표시만으로 저장하지 않는다', () => {
  const f = fixture(); f.notice.show(f.model);
  assert.equal(parts(f).details.hidden, true);
  assert.equal(parts(f).toggle.textContent, '자세히');
  for (let generation = 1; generation < 12; generation++) f.notice.show({ ...f.model, generation });
  assert.equal(f.root.children.length, 1);
  assert.equal(parts(f).details.hidden, true);
  assert.equal(f.calls, 0);
});

test('자동 갱신은 펼친 화면을 다시 만들지 않고 접힘 선택은 재시작 후에도 유지한다', () => {
  const f = fixture(); f.notice.show(f.model);
  const panel = parts(f).panel;
  parts(f).toggle.onclick();
  f.notice.show({ ...f.model, generation: 2 });
  assert.equal(parts(f).panel, panel);
  assert.equal(parts(f).details.hidden, false);
  parts(f).toggle.onclick();
  const restarted = fixture(f.shared); restarted.notice.show(restarted.model);
  assert.equal(parts(restarted).details.hidden, true);
  assert.equal(f.calls + restarted.calls, 0);
});

test('계정이 바뀌면 이전 계정의 펼치기와 저장 버튼은 작동하지 않는다', async () => {
  const f = fixture(); f.notice.show(f.model); const old = parts(f);
  f.user = { uid: 'two' };
  old.toggle.onclick(); await old.action.onclick();
  assert.equal(f.calls, 0);
  assert.equal(old.details.hidden, true);
  f.notice.clear(); f.notice.show(f.model);
  assert.equal(f.root.children.length, 0);
});

test('저장 성공 상태를 받아 해제하면 예전 저장 버튼도 다시 실행되지 않는다', async () => {
  const f = fixture(); f.notice.show(f.model); const old = parts(f).action;
  f.notice.clear(); await old.onclick();
  assert.equal(f.root.children.length, 0);
  assert.equal(f.calls, 0);
});

test('실패와 오프라인은 안내 안에서 표시하고 명시적인 재시도만 실행한다', async () => {
  const f = fixture(); let calls = 0;
  f.model.actions[0].run = async () => { calls++; if (calls === 1) throw Error('offline'); return { status: 'offline' }; };
  f.notice.show(f.model); parts(f).toggle.onclick();
  await parts(f).action.onclick();
  assert.match(parts(f).feedback.textContent, /기기 기록은 유지/);
  assert.equal(parts(f).action.disabled, false);
  await parts(f).action.onclick();
  assert.match(parts(f).feedback.textContent, /연결과 계정 확인/);
  assert.equal(calls, 2);
});

test('저장 중 반복 클릭은 중복 쓰기를 요청하지 않는다', async () => {
  const f = fixture(); let release, calls = 0;
  f.model.actions[0].run = async () => { calls++; await new Promise(resolve => { release = resolve; }); };
  f.notice.show(f.model); parts(f).toggle.onclick();
  const first = parts(f).action.onclick();
  await parts(f).action.onclick();
  assert.equal(calls, 1);
  assert.equal(parts(f).action.disabled, true);
  release(); await first;
  assert.equal(parts(f).action.disabled, false);
});

test('실제 충돌은 재대조 완료 안내와 구분하고 이전 UI 상태를 가져오지 않는다', () => {
  const f = fixture(); f.notice.show(f.model); parts(f).toggle.onclick();
  f.notice.show({ ...f.model, kind: 'conflict', title: '기기에 보존됨 · 충돌 2건 확인 필요', paths: ['records.1', 'records.2'] });
  assert.match(parts(f).panel.className, /--conflict/);
  assert.match(parts(f).panel.children[0].children[0].textContent, /충돌 2건/);
  assert.equal(parts(f).details.hidden, true);
  assert.equal(f.calls, 0);
});
