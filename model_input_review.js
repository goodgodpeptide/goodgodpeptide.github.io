import { compareDoseTiming } from "./schedule_comparison_model.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function clone(value) {
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function sumAt(events, time, config, contribution) {
  let total = 0;
  for (const event of events) {
    if (event.time > time) continue;
    total += contribution(event.doseMg, (time - event.time) / HOUR, config, Boolean(event.isOverride));
  }
  return total;
}

function close(a, b, scale = 1) {
  return Math.abs(a - b) <= 1e-8 * Math.max(scale, Math.abs(a), Math.abs(b));
}

export function buildModelInputReview(options) {
  if (!options || typeof options !== "object") throw new TypeError("입력 객체가 필요합니다.");
  if (typeof options.contribution !== "function") {
    throw new TypeError("운영 PK contribution 함수를 반드시 주입해야 합니다.");
  }
  if (!Array.isArray(options.targetTimes)) throw new TypeError("targetTimes는 배열이어야 합니다.");
  const originalRecords = clone(options.records);
  const comparison = compareDoseTiming(options);
  const config = options.config;
  const contribution = options.contribution;
  const now = Number(options.now ?? Date.now());
  const horizonDays = Number(options.horizonDays ?? 14);
  const rangeEnd = Math.max(comparison.plannedTime, comparison.changedTime) + horizonDays * DAY;

  const history = originalRecords
    .filter((record) => record?.drug === options.drug && Number(record.time) <= now)
    .map((record) => ({ ...clone(record), time: Number(record.time), doseMg: Number(record.dose) }))
    .sort((a, b) => a.time - b.time);
  const historyEvents = history.map((record) => ({
    time: record.time, doseMg: record.doseMg, isOverride: Boolean(record.isOverride), source: "actual",
  }));
  const changedBackgroundEvents = comparison.changedEvents.filter(
    (event) => event.time !== comparison.changedTime,
  );

  const rows = options.targetTimes.map((rawTime) => {
    const time = Number(rawTime);
    const base = {
      time,
      status: "invalid_target",
      baselineModelValue: null,
      backgroundModelValue: null,
      unitResponse: null,
      modelInputMg: null,
      deltaFromReferenceMg: null,
      equalityResidual: null,
      reason: "목표시점은 변경시각 이후이며 비교범위 안의 유효한 시각이어야 합니다.",
    };
    if (!Number.isFinite(time) || time <= comparison.changedTime || time > rangeEnd || time > 8.64e15) return base;

    try {
      const baseline = sumAt([...historyEvents, ...comparison.baselineEvents], time, config, contribution);
      const background = sumAt([...historyEvents, ...changedBackgroundEvents], time, config, contribution);
      const elapsed = (time - comparison.changedTime) / HOUR;
      const response0 = contribution(0, elapsed, config, false);
      const response1 = contribution(1, elapsed, config, false);
      const response2 = contribution(2, elapsed, config, false);
      if (![baseline, background, response0, response1, response2].every(Number.isFinite)) {
        return { ...base, status: "nonfinite_response", baselineModelValue: baseline,
          backgroundModelValue: background, reason: "PK 기여함수가 유한한 값을 반환하지 않았습니다." };
      }
      const unit = response1 - response0;
      if (!close(response0, 0) || !close(response2 - response0, 2 * unit, 2 * Math.abs(unit))) {
        return { ...base, status: "nonlinear_response", baselineModelValue: baseline,
          backgroundModelValue: background, unitResponse: unit,
          reason: "0mg·1mg·2mg 순방향 검증에서 용량 선형성이 성립하지 않았습니다." };
      }
      if (unit <= 0 || !Number.isFinite(unit)) {
        return { ...base, status: "zero_response", baselineModelValue: baseline,
          backgroundModelValue: background, unitResponse: unit,
          reason: "이 목표시점에서는 변경 투약 1mg의 모델 반응이 양수가 아닙니다." };
      }
      const modelInputMg = (baseline - background) / unit;
      if (!Number.isFinite(modelInputMg)) {
        return { ...base, status: "nonfinite_solution", baselineModelValue: baseline,
          backgroundModelValue: background, unitResponse: unit,
          reason: "유한한 모델 입력값을 계산할 수 없습니다." };
      }
      if (modelInputMg < 0) {
        return { ...base, status: "no_nonnegative_solution", baselineModelValue: baseline,
          backgroundModelValue: background, unitResponse: unit,
          reason: "고정된 다른 입력을 유지하면, 이번 변경 입력값을 0 이상으로 설정하여 이 목표값에 일치시킬 수 없습니다." };
      }
      const forward = background + contribution(modelInputMg, elapsed, config, false);
      const residual = forward - baseline;
      if (!Number.isFinite(forward) || !close(forward, baseline, Math.abs(baseline))) {
        return { ...base, status: "forward_validation_failed", baselineModelValue: baseline,
          backgroundModelValue: background, unitResponse: unit, modelInputMg,
          deltaFromReferenceMg: modelInputMg - Number(options.doseMg), equalityResidual: residual,
          reason: "계산값의 순방향 재검증이 일치하지 않았습니다." };
      }
      return { ...base, status: "review_value", baselineModelValue: baseline,
        backgroundModelValue: background, unitResponse: unit, modelInputMg,
        deltaFromReferenceMg: modelInputMg - Number(options.doseMg), equalityResidual: residual,
        reason: "지정한 한 시점과 가정에서만 일치하는 의사 검토용 수학 모델 입력값입니다." };
    } catch (error) {
      return { ...base, status: "response_error", reason: `PK 기여함수 오류: ${error?.name || "Error"}` };
    }
  });

  return {
    comparison,
    rows,
    history,
    assumptions: [
      "같은 약의 첫 변경 이벤트 한 건만 미지수이며, 실제 기록과 이후 가상 투약은 원 입력값으로 고정합니다.",
      "각 결과는 표시된 목표시점 한 곳에서만 성립하며 전체 모델 곡선의 동일성을 뜻하지 않습니다.",
      "두 약은 각각 별도로 계산해야 하며 약물 간 동등용량을 뜻하지 않습니다.",
      "의학적 권장량·안전성 보장·자동 투약 적용이 아닌 의사 검토용 수학 모델 입력값입니다.",
    ],
  };
}
