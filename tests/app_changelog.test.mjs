import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("누락된 사용자 기능과 백과 갱신이 앱 변경이력 최신 영역에 기록된다", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const start = html.indexOf("const APP_CHANGELOG=[");
  const end = html.indexOf("];", start);
  assert.ok(start >= 0 && end > start, "APP_CHANGELOG 데이터가 있어야 함");
  const changelog = html.slice(start, end);
  const encyclopedia = changelog.indexOf("2026-10-26");
  const date = changelog.indexOf("2026-10-24");
  assert.ok(encyclopedia >= 0 && encyclopedia < date);
  const september = changelog.indexOf("2026-09-01");
  const august = changelog.indexOf("2026-08-27");
  const previous = changelog.indexOf("2026-08-18");
  assert.ok(date >= 0 && date < september && september < august && august < previous,
    "누락된 변경이력이 날짜 내림차순으로 기존 항목 앞에 있어야 함");
  for (const text of [
    "투약일 변경 비교",
    "의사 검토용 수학 역산표",
    "현재 시각 기준 자동 계산",
    "투약 그래프와 투약 이력을 먼저 확인",
    "실제 투약량 권장이나 기록 자동 적용 기능은 아닙니다",
    "조제 랏 실측 총유닛과 마지막 골든도즈 기록",
    "마지막 투약량이 현재 배치에서 다시 차감",
    "기존 잔량과 새 배치를 함께 표시",
    "오래된 잔량부터 차감",
    "취소한 편집이 새 배치를 덮어쓰지 않도록 보호",
  ]) assert.match(changelog, new RegExp(text));
});
