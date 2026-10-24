import assert from "node:assert/strict";
import test from "node:test";
import { compareDoseTiming } from "../schedule_comparison_model.js";

// 공개 회귀검사용 가상 날짜·용량이며 실제 사용자 투약기록이 아닙니다.
const D = 86400000;
const H = 3600000;
const base = Date.UTC(2030, 0, 3, 12); // 목요일
const tirzep = { halfLifeDays: 5, tmaxHours: 8 };
const reta = { halfLifeDays: 6, tmaxHours: 24 };

function args(extra = {}) {
  return { records: [], drug: "마운자로", config: tirzep, doseMg: 5,
    plannedTime: base, changedTime: base, now: base - H, ...extra };
}

test("같은 일정은 원안과 변경안 곡선이 완전히 같다", () => {
  const result = compareDoseTiming(args());
  assert.ok(result.points.length > 100);
  assert.ok(result.points.every((p) => p.baselineMg === p.changedMg && p.deltaMg === 0));
});

test("2일 지연 뒤 원 목요일 복귀는 다음 간격이 5일이다", () => {
  const result = compareDoseTiming(args({ changedTime: base + 2 * D, nextMode: "original" }));
  assert.equal(result.delayHours, 48);
  assert.equal(result.nextGapHours, 5 * 24);
  assert.equal(result.changedNextTime, base + 7 * D);
});

test("2일 지연 뒤 주기 이동은 다음 간격이 7일이다", () => {
  const result = compareDoseTiming(args({ changedTime: base + 2 * D, nextMode: "shifted" }));
  assert.equal(result.nextGapHours, 7 * 24);
  assert.equal(result.changedNextTime, base + 9 * D);
});

test("레타 일요일 일정과 앞당김을 별도로 계산한다", () => {
  const sunday = base + 3 * D;
  const result = compareDoseTiming(args({ drug: "레타", config: reta,
    plannedTime: sunday, changedTime: sunday - 2 * D, nextMode: "original" }));
  assert.equal(result.delayHours, -48);
  assert.equal(result.changedNextTime, sunday + 7 * D);
  assert.equal(result.nextGapHours, 9 * 24);
  assert.ok(!result.changedEvents.some((event) => event.time === sunday));
});

test("실제 기록은 복사·정렬하며 입력 배열을 바꾸지 않는다", () => {
  const records = [
    { drug: "마운자로", dose: 5, time: base - 7 * D },
    { drug: "마운자로", dose: 5, time: base - 14 * D, isOverride: true },
  ];
  const before = JSON.stringify(records);
  const result = compareDoseTiming(args({ records }));
  assert.equal(result.historyCount, 2);
  assert.equal(JSON.stringify(records), before);
});

test("미래 기록은 제외하고 경고한다", () => {
  const result = compareDoseTiming(args({
    records: [{ drug: "마운자로", dose: 5, time: base + 30 * D }],
  }));
  assert.equal(result.historyCount, 0);
  assert.match(result.warnings[0], /미래 실제기록 제외/);
});

test("예정 또는 변경시각 이후 실제기록은 중복 방지 오류다", () => {
  assert.throws(() => compareDoseTiming(args({
    now: base + 4 * D, changedTime: base + 2 * D,
    records: [{ drug: "마운자로", dose: 5, time: base + D }],
  })), RangeError);
});

test("손상 입력과 과도한 범위를 거부한다", () => {
  assert.throws(() => compareDoseTiming(args({ records: {} })), TypeError);
  assert.throws(() => compareDoseTiming(args({ config: { halfLifeDays: 0 } })), RangeError);
  assert.throws(() => compareDoseTiming(args({ doseMg: 0 })), RangeError);
  assert.throws(() => compareDoseTiming(args({ intervalDays: 31 })), RangeError);
  assert.throws(() => compareDoseTiming(args({ horizonDays: 61 })), RangeError);
  assert.throws(() => compareDoseTiming(args({ changedTime: base + 61 * D })), RangeError);
  assert.throws(() => compareDoseTiming(args({ plannedTime: 8.64e15 + 1 })), RangeError);
  assert.throws(() => compareDoseTiming(args({
    records: [{ drug: "마운자로", dose: 5, time: 8.64e15 + 1 }],
  })), RangeError);
});

test("7일 이상 늦은 원 일정 복귀는 건너뛴 횟수를 경고한다", () => {
  const result = compareDoseTiming(args({ changedTime: base + 15 * D, nextMode: "original" }));
  assert.match(result.warnings.join(" "), /2회 예정시각/);
});

test("주입한 PK 기여함수를 실제 기록·가상 일정에 모두 사용한다", () => {
  const calls = [];
  const contribution = (dose, elapsed, config, isOverride) => {
    calls.push({ dose, elapsed, config, isOverride });
    return elapsed < 0 ? 0 : dose + (isOverride ? 100 : 0);
  };
  const result = compareDoseTiming(args({
    records: [{ drug: "마운자로", dose: 1, time: base - 7 * D, isOverride: true }],
    contribution,
  }));
  assert.ok(calls.some((call) => call.isOverride === true));
  assert.ok(calls.some((call) => call.dose === 5 && call.isOverride === false));
  assert.ok(result.peak.baselineMg >= 105);
});

test("정각 직전·정각·흡수피크 시각을 points에 포함한다", () => {
  const now = base - H;
  const result = compareDoseTiming(args({ now }));
  const times = new Set(result.points.map((point) => point.time));
  assert.ok(times.has(base - 1));
  assert.ok(times.has(base));
  assert.ok(times.has(base + 8 * H));
  assert.ok(times.has(base + 24 * H));
  assert.ok(times.has(base + 72 * H));
  assert.ok(times.has(now));
  assert.ok(times.has(base + 7 * D - 1));
});
