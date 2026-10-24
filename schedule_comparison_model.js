const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function finitePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${label}은 0보다 커야 합니다.`);
  return number;
}

function validTime(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 8.64e15) {
    throw new RangeError(`${label}이 유효하지 않습니다.`);
  }
  return number;
}

function defaultContribution(dose, elapsedHours, config) {
  if (elapsedHours < 0) return 0;
  const halfLifeDays = finitePositive(config?.halfLifeDays, "반감기");
  return dose * (0.5 ** (elapsedHours / (halfLifeDays * 24)));
}

function normalizeHistory(records, drug, now, warnings) {
  if (!Array.isArray(records)) throw new TypeError("records는 배열이어야 합니다.");
  return records
    .filter((record) => record?.drug === drug)
    .map((record) => {
      const time = validTime(record.time, "실제 투약시각");
      const doseMg = finitePositive(record.dose, "실제 투약량");
      return { time, doseMg, isOverride: Boolean(record.isOverride), source: "actual" };
    })
    .filter((event) => {
      if (event.time <= now) return true;
      warnings.push(`미래 실제기록 제외: ${new Date(event.time).toISOString()}`);
      return false;
    })
    .sort((a, b) => a.time - b.time);
}

function recurringEvents(firstTime, intervalMs, endTime, source) {
  const events = [];
  for (let time = firstTime; time <= endTime; time += intervalMs) {
    events.push({ time, source });
  }
  return events;
}

function uniqueSortedTimes(values, start, end) {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value >= start && value <= end))]
    .sort((a, b) => a - b);
}

function exposureAt(time, history, scenario, doseMg, config, contribution) {
  let total = 0;
  for (const event of history) {
    if (event.time > time) break;
    total += contribution(event.doseMg, (time - event.time) / HOUR_MS, config, event.isOverride);
  }
  for (const event of scenario) {
    if (event.time > time) break;
    total += contribution(doseMg, (time - event.time) / HOUR_MS, config, false);
  }
  return total;
}

export function compareDoseTiming({
  records,
  drug,
  config,
  doseMg,
  plannedTime,
  changedTime,
  intervalDays = 7,
  nextMode = "original",
  now = Date.now(),
  horizonDays = 14,
  contribution = defaultContribution,
}) {
  if (!Array.isArray(records)) throw new TypeError("records는 배열이어야 합니다.");
  if (typeof drug !== "string" || !drug.trim()) throw new TypeError("drug가 필요합니다.");
  if (!config || typeof config !== "object") throw new TypeError("config가 필요합니다.");
  finitePositive(config.halfLifeDays, "반감기");
  const dose = finitePositive(doseMg, "동일 투약량");
  const planned = validTime(plannedTime, "원 예정시각");
  const changed = validTime(changedTime, "변경시각");
  const current = validTime(now, "기준시각");
  const interval = finitePositive(intervalDays, "투약간격");
  const horizon = finitePositive(horizonDays, "비교기간");
  if (interval < 0.25 || interval > 30) throw new RangeError("투약간격은 0.25~30일 범위여야 합니다.");
  if (horizon > 60) throw new RangeError("비교기간은 최대 60일입니다.");
  if (Math.abs(changed - planned) > 60 * DAY_MS) throw new RangeError("일정 변경 폭은 최대 60일입니다.");
  if (!["original", "shifted"].includes(nextMode)) throw new RangeError("nextMode가 유효하지 않습니다.");
  if (typeof contribution !== "function") throw new TypeError("contribution은 함수여야 합니다.");

  const warnings = [];
  const history = normalizeHistory(records.map((record) => ({ ...record })), drug, current, warnings);
  const lastActualTime = history.at(-1)?.time ?? null;
  if (lastActualTime !== null && changed <= lastActualTime) {
    throw new RangeError("변경시각은 마지막 실제 투약 이후여야 합니다.");
  }
  const firstScenarioTime = Math.min(planned, changed);
  if (history.some((event) => event.time >= firstScenarioTime)) {
    throw new RangeError("예정시각 이후 실제 투약기록이 있어 가상 투약을 중복 추가할 수 없습니다.");
  }

  const intervalMs = interval * DAY_MS;
  const start = firstScenarioTime - DAY_MS;
  const end = Math.max(planned, changed) + horizon * DAY_MS;
  if (end - start > 90 * DAY_MS) throw new RangeError("전체 비교범위가 너무 깁니다.");

  const baselineEvents = recurringEvents(planned, intervalMs, end, "baseline")
    .map((event) => ({ ...event, doseMg: dose, isOverride: false }));
  let changedNextTime;
  if (nextMode === "shifted") {
    changedNextTime = changed + intervalMs;
  } else {
    // 변경시각은 이번 예정 1회의 이동이다. 앞당겼더라도 원래 이번 회차를
    // 다시 추가하지 않고, 원 일정의 다음 회차부터 복귀한다.
    changedNextTime = planned + intervalMs;
    while (changedNextTime <= changed) changedNextTime += intervalMs;
  }
  const changedEvents = [
    { time: changed, doseMg: dose, isOverride: false, source: "changed" },
    ...recurringEvents(changedNextTime, intervalMs, end, "changed")
      .map((event) => ({ ...event, doseMg: dose, isOverride: false })),
  ].filter((event, index, all) => index === all.findIndex((other) => other.time === event.time));

  const skipped = changed > planned ? Math.floor((changed - planned) / intervalMs) : 0;
  if (nextMode === "original" && skipped > 0) {
    warnings.push(`원 일정 복귀 전 ${skipped}회 예정시각을 건너뜁니다.`);
  }

  const tmaxHours = Number(config.tmaxHours);
  const special = [];
  for (const event of [...baselineEvents, ...changedEvents]) {
    special.push(event.time - 1, event.time);
    if (Number.isFinite(tmaxHours) && tmaxHours >= 0) special.push(event.time + tmaxHours * HOUR_MS);
  }
  const grid = [];
  const stepMs = 3 * HOUR_MS;
  for (let time = start; time <= end; time += stepMs) grid.push(time);
  grid.push(start, end, changed, changed + DAY_MS, changed + 3 * DAY_MS);
  if (current >= start && current <= end) grid.push(current);
  const points = uniqueSortedTimes([...grid, ...special], start, end).map((time) => {
    const baselineMg = exposureAt(time, history, baselineEvents, dose, config, contribution);
    const changedMg = exposureAt(time, history, changedEvents, dose, config, contribution);
    return { time, baselineMg, changedMg, deltaMg: changedMg - baselineMg };
  });
  const atChangePoint = points.find((point) => point.time === changed);

  return {
    points,
    baselineEvents,
    changedEvents,
    historyCount: history.length,
    lastActualTime,
    plannedTime: planned,
    changedTime: changed,
    baselineNextTime: planned + intervalMs,
    changedNextTime,
    delayHours: (changed - planned) / HOUR_MS,
    previousGapHours: lastActualTime === null ? null : (changed - lastActualTime) / HOUR_MS,
    nextGapHours: (changedNextTime - changed) / HOUR_MS,
    skippedCount: skipped,
    atChange: {
      baselineMg: atChangePoint.baselineMg,
      changedMg: atChangePoint.changedMg,
      deltaMg: atChangePoint.deltaMg,
    },
    peak: {
      baselineMg: Math.max(...points.map((point) => point.baselineMg)),
      changedMg: Math.max(...points.map((point) => point.changedMg)),
    },
    warnings,
  };
}
