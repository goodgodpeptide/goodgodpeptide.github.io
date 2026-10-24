import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  defaultScheduleFields,
  formatKstInput,
  installScheduleComparison,
  parseKstInput,
} from "../schedule_comparison_ui.js";

// 공개 회귀검사용 가상 날짜·용량이며 실제 사용자 투약기록이 아닙니다.
const D = 86_400_000;
const H = 3_600_000;
const NOW = Date.parse("2030-01-05T12:00:00+09:00");
const DRUG = "Tirzepatide 테스트";
const RETA = "Retatrutide 테스트";

class FakeClassList {
  contains() { return false; }
}

class FakeElement {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.doc = doc; this.children = [];
    this.style = {}; this.dataset = {}; this.classList = new FakeClassList();
    this.listeners = {}; this.hidden = false; this.value = ""; this.textContent = "";
  }
  set id(value) { this._id = value; if (value) this.doc.nodes.set(value, this); }
  get id() { return this._id || ""; }
  set innerHTML(value) {
    this._html = value;
    for (const match of value.matchAll(/<(select|input|button|div|canvas|tbody)[^>]*id="([^"]+)"[^>]*>/g)) {
      const node = new FakeElement(match[1], this.doc); node.id = match[2];
      if (match[2] === "sc-next") node.value = "original";
    }
    const drug = this.doc.getElementById("sc-drug");
    const option = value.match(/<option value="([^"]+)">/); if (drug && option) drug.value = option[1];
  }
  get innerHTML() { return this._html || ""; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type) { for (const fn of this.listeners[type] || []) fn({ target: this }); }
  appendChild(child) { this.children.push(child); }
  insertAdjacentElement(_where, child) { this.children.push(child); }
  getBoundingClientRect() { return { width: 600 }; }
  getContext() { return { setTransform(){}, fillRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fillText(){}, setLineDash(){} }; }
}

class FakeObserver {
  constructor(callback) { this.callback = callback; }
  observe() {}
}

function fixture({ records = [] } = {}) {
  const nodes = new Map();
  const doc = {
    nodes,
    body: { classList: new FakeClassList() }, head: null, documentElement: { dataset: {} },
    defaultView: { MutationObserver: FakeObserver },
    createElement(tag) { return new FakeElement(tag, this); },
    getElementById(id) { return nodes.get(id) || null; },
  };
  doc.head = new FakeElement("head", doc);
  const anchor = new FakeElement("div", doc); anchor.id = "remaining-cards";
  const targetWindow = { devicePixelRatio: 1, MutationObserver: FakeObserver, addEventListener() {} };
  const configs = {
    [DRUG]: { short: "마운자로", halfLifeDays: 5, tmaxHours: 8 },
    [RETA]: { short: "레타", halfLifeDays: 6, tmaxHours: 24 },
  };
  let currentRecords = records;
  const calls = [];
  const api = installScheduleComparison({ document: doc, targetWindow, configs,
    getRecords: () => currentRecords, getDoseCycle: () => 7, now: () => NOW,
    contribution: (...args) => { calls.push(args); return args[1] < 0 ? 0 : args[0]; },
  });
  return { doc, api, calls, setRecords(value) { currentRecords = value; } };
}

test("한국시간 입력을 엄격히 왕복하고 잘못된 날짜를 거부한다", () => {
  assert.equal(formatKstInput(NOW), "2030-01-05T12:00");
  assert.equal(parseKstInput("2030-01-05T12:00"), NOW);
  assert.ok(Number.isNaN(parseKstInput("2030-02-30T12:00")));
  assert.ok(Number.isNaN(parseKstInput("2030-01-05 12:00")));
});

test("기본 일정은 완료된 정상 기록만 사용하고 원본을 바꾸지 않는다", () => {
  const records = [
    { drug: DRUG, dose: 5, time: NOW - 9 * D },
    { drug: DRUG, dose: 99, time: NOW - D, isOverride: true },
    { drug: DRUG, dose: 8, time: NOW + D },
  ];
  const before = structuredClone(records);
  const fields = defaultScheduleFields(records, DRUG, 7, NOW);
  assert.equal(fields.dose, "5");
  assert.equal(fields.planned, "2030-01-03T12:00");
  assert.equal(fields.changed, "2030-01-05T12:00");
  assert.deepEqual(records, before);
  assert.deepEqual(defaultScheduleFields([], DRUG, 7, NOW),
    { dose: "", planned: "", changed: "", interval: 7, weekday: 4 });
});

test("인증 뒤 기록을 다시 읽고 사용자 입력으로 같은 용량 비교를 렌더한다", () => {
  const fx = fixture();
  assert.equal(fx.api.installed, true);
  assert.equal(fx.doc.getElementById("sc-result").hidden, true);
  const records = [{ drug: DRUG, dose: 5, time: NOW - 9 * D }];
  const before = structuredClone(records); fx.setRecords(records); fx.api.reload();
  assert.equal(fx.doc.getElementById("sc-dose").value, "5");
  const planned = fx.doc.getElementById("sc-planned");
  const changed = fx.doc.getElementById("sc-changed");
  planned.value = "2030-01-10T12:00"; planned.dispatch("input");
  changed.value = "2030-01-12T12:00"; changed.dispatch("input");
  assert.equal(fx.doc.getElementById("sc-result").hidden, false);
  assert.match(fx.doc.getElementById("sc-summary").textContent, /입력량 5mg 유지/);
  assert.match(fx.doc.getElementById("sc-summary").textContent, /변경일 → 다음 가상회차: 5일/);
  assert.match(fx.doc.getElementById("sc-table").innerHTML, /24시간 뒤/);
  assert.ok(fx.calls.some(([dose]) => dose === 5));
  assert.deepEqual(records, before);
});

test("주기 이동은 7일, 앞당긴 뒤 원 일정 복귀는 9일로 표시한다", () => {
  const fx = fixture({ records: [{ drug: DRUG, dose: 5, time: NOW - 9 * D }] });
  const planned = fx.doc.getElementById("sc-planned");
  const changed = fx.doc.getElementById("sc-changed");
  const next = fx.doc.getElementById("sc-next");
  planned.value = "2030-01-10T12:00"; planned.dispatch("input");
  changed.value = "2030-01-12T12:00"; changed.dispatch("input");
  next.value = "shifted"; next.dispatch("input");
  assert.match(fx.doc.getElementById("sc-summary").textContent, /다음 가상회차: 7일/);
  changed.value = "2030-01-08T12:00"; changed.dispatch("input");
  next.value = "original"; next.dispatch("input");
  assert.match(fx.doc.getElementById("sc-summary").textContent, /다음 가상회차: 9일/);
});

test("약을 바꾸면 약별 최근 기록을 읽고 돌아오면 사용자 입력을 복원한다", () => {
  const fx = fixture({ records: [
    { drug: DRUG, dose: 5, time: NOW - 9 * D },
    { drug: RETA, dose: 3, time: NOW - 6 * D },
  ] });
  const drug = fx.doc.getElementById("sc-drug");
  const dose = fx.doc.getElementById("sc-dose");
  dose.value = "6"; dose.dispatch("input");
  drug.value = RETA; drug.dispatch("change");
  assert.equal(dose.value, "3");
  drug.value = DRUG; drug.dispatch("change");
  assert.equal(dose.value, "6");
});

test("예정 이후 완료 기록은 가상기록 중복 방지 오류로 렌더를 막는다", () => {
  const fx = fixture({ records: [
    { drug: DRUG, dose: 5, time: NOW - 9 * D },
    { drug: DRUG, dose: 5, time: NOW - D },
  ] });
  const planned = fx.doc.getElementById("sc-planned");
  const changed = fx.doc.getElementById("sc-changed");
  planned.value = "2030-01-03T12:00"; planned.dispatch("input");
  changed.value = "2030-01-06T12:00"; changed.dispatch("input");
  assert.equal(fx.doc.getElementById("sc-result").hidden, true);
  assert.match(fx.doc.getElementById("sc-error").textContent, /중복 추가할 수 없습니다/);
});

test("운영 index와 service worker가 비교 UI를 연결한다", async () => {
  const [index, worker] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(index, /import \{ installScheduleComparison \} from '\.\/schedule_comparison_ui\.js\?v=31';/);
  assert.match(index, /installScheduleComparison\(\{/);
  assert.match(worker, /schedule_comparison_model\.js/);
  assert.match(worker, /schedule_comparison_ui\.js/);
});
