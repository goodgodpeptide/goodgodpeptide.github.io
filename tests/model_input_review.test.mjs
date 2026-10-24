import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { buildModelInputReview } from "../model_input_review.js";

const H = 3600000;
const D = 24 * H;
const planned = Date.UTC(2030, 0, 3, 12);
const config = { halfLifeDays: 5, tmaxHours: 8 };
const linear = (dose, elapsed) => elapsed < 0 ? 0 : dose * Math.exp(-elapsed / 120);

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`), open = source.indexOf("{", start);
  let depth = 0, quote = "", escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (quote) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth += 1;
    if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} 추출 실패`);
}

async function productionPk() {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const begin = html.indexOf("const a0_0x4109b5"), end = html.indexOf("const a0_0x1a5c3c", begin);
  const script = [functionSource(html, "a0_0x74b6"), functionSource(html, "a0_0x5584"),
    html.slice(begin, end), functionSource(html, "computeKa"), functionSource(html, "pkConcentration"),
    "globalThis.pk=pkConcentration;"].join("\n");
  const context = vm.createContext({ Math });
  new vm.Script(script).runInContext(context, { timeout: 1000 });
  return context.pk;
}

function args(extra = {}) {
  return { records: [], drug: "가상약A", config, doseMg: 5, plannedTime: planned,
    changedTime: planned, intervalDays: 7, nextMode: "original", now: planned - H,
    horizonDays: 14, targetTimes: [planned + 24 * H], contribution: linear, ...extra };
}

test("같은 일정의 동일 목표시점 모델 입력값은 원 입력값이다", () => {
  const result = buildModelInputReview(args());
  assert.equal(result.rows[0].status, "review_value");
  assert.ok(Math.abs(result.rows[0].modelInputMg - 5) < 1e-9);
  assert.ok(Math.abs(result.rows[0].equalityResidual) < 1e-9);
  assert.match(result.assumptions.join(" "), /의학적 권장량.*아닌/);
});

test("지연 일정은 목표시점마다 서로 다른 모델 입력값을 낼 수 있다", () => {
  const changed = planned + 2 * D;
  const absorptionPk = (dose, elapsed) => elapsed < 0 ? 0
    : dose * (Math.exp(-elapsed / 120) - Math.exp(-elapsed / 4));
  const result = buildModelInputReview(args({ changedTime: changed,
    targetTimes: [changed + 12 * H, changed + 72 * H], contribution: absorptionPk }));
  assert.ok(result.rows.every((row) => row.status === "review_value"));
  assert.notEqual(result.rows[0].modelInputMg, result.rows[1].modelInputMg);
});

test("음수 해가 필요한 경우 양의 입력으로 불가능하다고 격리한다", () => {
  const changed = planned - 2 * D;
  const result = buildModelInputReview(args({ changedTime: changed, nextMode: "shifted",
    targetTimes: [changed + 7 * D + H] }));
  assert.equal(result.rows[0].status, "no_nonnegative_solution");
  assert.equal(result.rows[0].modelInputMg, null);
});

test("흡수 반응 0과 비선형 반응은 산출하지 않는다", () => {
  const target = planned + H;
  const zero = buildModelInputReview(args({ targetTimes: [target], contribution: () => 0 }));
  assert.equal(zero.rows[0].status, "zero_response");
  const nonlinear = buildModelInputReview(args({ targetTimes: [target],
    contribution: (dose) => dose * dose }));
  assert.equal(nonlinear.rows[0].status, "nonlinear_response");
});

test("변경시각 이전·범위 밖·손상 목표시각은 invalid_target이다", () => {
  const result = buildModelInputReview(args({ targetTimes: [planned, NaN, planned + 40 * D] }));
  assert.deepEqual(result.rows.map((row) => row.status),
    ["invalid_target", "invalid_target", "invalid_target"]);
});

test("기록 원본은 불변이고 미래기록은 비교와 history에서 제외한다", () => {
  const records = [
    { drug: "가상약A", dose: 3, time: planned - 7 * D, note: "복제확인" },
    { drug: "가상약A", dose: 3, time: planned + 30 * D },
  ];
  const before = JSON.stringify(records);
  const result = buildModelInputReview(args({ records }));
  assert.equal(JSON.stringify(records), before);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].note, "복제확인");
  assert.match(result.comparison.warnings.join(" "), /미래 실제기록 제외/);
});

test("운영 contribution 주입 없이는 silent fallback하지 않는다", () => {
  const input = args();
  delete input.contribution;
  assert.throws(() => buildModelInputReview(input), /반드시 주입/);
});

test("운영 index의 실제 PK 함수를 주입해 순방향 잔차를 검증한다", async () => {
  const pk = await productionPk();
  const changed = planned + 2 * D;
  const result = buildModelInputReview(args({ doseMg: 3, changedTime: changed,
    targetTimes: [changed + 8 * H], contribution: pk }));
  assert.equal(result.rows[0].status, "review_value");
  assert.ok(Number.isFinite(result.rows[0].modelInputMg));
  assert.ok(Math.abs(result.rows[0].equalityResidual) < 1e-8);
});

test("현재 스냅샷은 원 일정 모델값과 등록기록 모델값의 차이를 계산한다", () => {
  const now = planned + 12 * H;
  const records = [{ drug: "가상약A", dose: 3, time: planned - 7 * D }];
  const before = JSON.stringify(records);
  const result = buildModelInputReview(args({ records, now, targetTimes: [now + H] }));
  const expectedRecorded = linear(3, 7 * 24 + 12, config, false);
  const expectedScheduled = expectedRecorded + linear(5, 12, config, false);
  assert.ok(Math.abs(result.currentSnapshot.recordedModelValue - expectedRecorded) < 1e-10);
  assert.ok(Math.abs(result.currentSnapshot.scheduledModelValue - expectedScheduled) < 1e-10);
  assert.ok(Math.abs(result.currentSnapshot.differenceModelValue - linear(5, 12, config, false)) < 1e-10);
  assert.equal(JSON.stringify(records), before);
  assert.match(result.currentSnapshot.reason, /실측 농도가 아닙니다/);
});

test("운영 PK는 첫 투입 순간 반응 0이며 현재 차이가 없으면 이미 일치다", async () => {
  const pk = await productionPk();
  const result = buildModelInputReview(args({ now: planned, targetTimes: [planned + 8 * H], contribution: pk }));
  assert.equal(result.currentSnapshot.instantUnitResponse, 0);
  assert.equal(result.currentSnapshot.differenceModelValue, 0);
  assert.equal(result.currentSnapshot.instantMatchStatus, "already_equal");
});

test("운영 PK의 현재 차이가 0이 아니면 즉시 입력으로 일치시킬 수 없다", async () => {
  const pk = await productionPk();
  const result = buildModelInputReview(args({ now: planned + 8 * H,
    targetTimes: [planned + 9 * H], contribution: pk }));
  assert.ok(result.currentSnapshot.differenceModelValue > 0);
  assert.equal(result.currentSnapshot.instantUnitResponse, 0);
  assert.equal(result.currentSnapshot.instantMatchStatus, "zero_response");
  assert.equal(Object.hasOwn(result.currentSnapshot, "modelInputMg"), false);
});

test("현재시각이 모델 끝 밖이면 값은 null이고 누락을 추정하지 않는다", () => {
  const now = planned + 20 * D;
  const result = buildModelInputReview(args({ now, targetTimes: [planned + D] }));
  assert.equal(result.currentSnapshot.status, "outside_model_range");
  assert.equal(result.currentSnapshot.scheduledModelValue, null);
  assert.equal(result.currentSnapshot.recordedModelValue, null);
  assert.match(result.currentSnapshot.reason, /누락을 추정하지 않습니다/);
});

test("현재시점 비유한 PK 응답은 값 없이 격리한다", () => {
  const result = buildModelInputReview(args({ contribution: () => Number.NaN }));
  assert.equal(result.currentSnapshot.status, "nonfinite_response");
  assert.equal(result.currentSnapshot.differenceModelValue, null);
});
