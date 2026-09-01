import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  INLINE_WEIGHT_ENTRY_CSS,
  INLINE_WEIGHT_ENTRY_MARKUP,
  kstDateTimeInputValue,
  submitInlineWeightEntry,
  validateInlineWeightEntry,
} from "../inline_weight_entry.js";

test("한국시간 날짜·시간 기본값을 datetime-local 형식으로 만든다", () => {
  assert.equal(kstDateTimeInputValue(Date.UTC(2026, 7, 24, 1, 8)), "2026-08-24T10:08");
});

test("체중과 날짜·시간을 모두 지정해야 바로 저장할 수 있다", () => {
  assert.deepEqual(validateInlineWeightEntry("89.7", "2026-08-24T10:08"), {
    valid: true,
    weight: 89.7,
    time: "2026-08-24T10:08",
  });
  assert.equal(validateInlineWeightEntry("", "2026-08-24T10:08").reason, "weight");
  assert.equal(validateInlineWeightEntry("89.7", "").reason, "time");
});

test("버튼 자리 입력 폼에 체중·날짜시간·저장 제어가 모두 있다", () => {
  assert.match(INLINE_WEIGHT_ENTRY_MARKUP, /id="inline-weight-value"/);
  assert.match(INLINE_WEIGHT_ENTRY_MARKUP, /type="datetime-local"/);
  assert.match(INLINE_WEIGHT_ENTRY_MARKUP, /type="submit">저장<\/button>/);
  assert.doesNotMatch(INLINE_WEIGHT_ENTRY_MARKUP, /openWeightModal/);
  assert.match(INLINE_WEIGHT_ENTRY_CSS, /grid-template-columns/);
  assert.match(INLINE_WEIGHT_ENTRY_CSS, /min-width:\s*0/);
  assert.match(INLINE_WEIGHT_ENTRY_CSS, /@media \(max-width: 520px\)/);
});

test("바로 저장은 기존 체중 저장 입력으로 값을 넘기고 성공 뒤 입력만 초기화한다", async () => {
  const fields = {
    "inline-weight-value": { value: "89.7", focus() {} },
    "inline-weight-time": { value: "2026-08-24T10:08", focus() {} },
    "inline-weight-save": { disabled: false },
    "inline-weight-status": { textContent: "", dataset: {} },
    "add-weight": { value: "" },
    "add-weight-time": { value: "" },
  };
  const doc = { getElementById: (id) => fields[id] || null };
  let submitted = 0;
  const result = await submitInlineWeightEntry({
    document: doc,
    now: () => Date.UTC(2026, 7, 24, 1, 9),
    submitNative: async () => {
      submitted += 1;
      assert.equal(fields["add-weight"].value, "89.7");
      assert.equal(fields["add-weight-time"].value, "2026-08-24T10:08");
    },
  });

  assert.equal(result.saved, true);
  assert.equal(submitted, 1);
  assert.equal(fields["inline-weight-value"].value, "");
  assert.equal(fields["inline-weight-time"].value, "2026-08-24T10:09");
  assert.equal(fields["inline-weight-save"].disabled, false);
  assert.match(fields["inline-weight-status"].textContent, /저장됨/);
});

test("기존 저장 경로가 실패하면 입력값을 보존하고 재시도 안내를 표시한다", async () => {
  const fields = {
    "inline-weight-value": { value: "89.7", focus() {} },
    "inline-weight-time": { value: "2026-08-24T10:08", focus() {} },
    "inline-weight-save": { disabled: false },
    "inline-weight-status": { textContent: "", dataset: {} },
    "add-weight": { value: "" },
    "add-weight-time": { value: "" },
  };
  const result = await submitInlineWeightEntry({
    document: { getElementById: (id) => fields[id] || null },
    submitNative: async () => { throw new Error("save failed"); },
  });

  assert.equal(result.saved, false);
  assert.equal(result.reason, "submit_failed");
  assert.equal(fields["inline-weight-value"].value, "89.7");
  assert.equal(fields["inline-weight-time"].value, "2026-08-24T10:08");
  assert.equal(fields["inline-weight-save"].disabled, false);
  assert.equal(fields["inline-weight-status"].dataset.error, "true");
  assert.match(fields["inline-weight-status"].textContent, /다시 시도/);
});

test("운영 화면과 서비스워커가 체중 바로 입력 모듈을 연결한다", async () => {
  const [index, serviceWorker] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(index, /import \{ installInlineWeightEntry \} from '\.\/inline_weight_entry\.js';/);
  assert.match(index, /installInlineWeightEntry\(\{/);
  assert.match(serviceWorker, /peptide-app-v29/);
  assert.match(serviceWorker, /'\.\/inline_weight_entry\.js'/);
});
