import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildReconBatchRows,
  clearStaleReconEditState,
  installReconInventoryGuard,
  renderReconInventory,
} from "../recon_inventory_guard.js";

const RETA = "레타 (Retatrutide)";

test("같은 레타를 두 번 조제해도 두 배치를 모두 보존한다", () => {
  const first = { id: 1, drug: RETA, vialMg: 20, waterMl: 2, doseMg: 2, reconDate: 1000 };
  const second = { id: 2, drug: RETA, vialMg: 30, waterMl: 3, doseMg: 3, reconDate: 3000 };
  const rows = buildReconBatchRows([first, second], []);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.id), [2, 1]);
  assert.equal(rows[0].isCurrent, true);
  assert.equal(rows[1].isCurrent, false);
  assert.equal(rows[1].remainingMg, 20);
});

test("이전 배치는 다음 조제일 전 투약만 반영하고 새 배치 사용량과 섞지 않는다", () => {
  const rows = buildReconBatchRows([
    { id: 1, drug: RETA, vialMg: 20, waterMl: 2, doseMg: 2, reconDate: 1000 },
    { id: 2, drug: RETA, vialMg: 30, waterMl: 3, doseMg: 3, reconDate: 3000 },
  ], [
    { id: 11, drug: RETA, dose: 2, time: 2000 },
    { id: 12, drug: RETA, dose: 3, time: 4000 },
  ]);

  const newest = rows.find((row) => row.id === 2);
  const previous = rows.find((row) => row.id === 1);
  assert.equal(previous.usedMg, 2);
  assert.equal(previous.remainingMg, 18);
  assert.equal(newest.usedMg, 3);
  assert.equal(newest.remainingMg, 27);
});

test("수정 모달에서 남은 ID를 새 조제 전에 항상 초기화한다", () => {
  const fakeWindow = { _editingReconId: 123, _reconGuardEditingId: 123 };
  clearStaleReconEditState(fakeWindow);
  assert.equal(fakeWindow._editingReconId, null);
  assert.equal(fakeWindow._reconGuardEditingId, null);
});

test("운영 화면과 서비스워커가 조제 재고 보호 모듈을 연결한다", async () => {
  const [index, serviceWorker] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../sw.js", import.meta.url), "utf8"),
  ]);
  assert.match(index, /import \{ installReconInventoryGuard \} from '\.\/recon_inventory_guard\.js';/);
  assert.match(index, /installReconInventoryGuard\(\{/);
  assert.match(serviceWorker, /peptide-app-v26/);
  assert.match(serviceWorker, /'\.\/recon_inventory_guard\.js'/);
});

test("조제 재고 화면에 같은 약물의 현재 배치와 이전 잔량이 모두 표시된다", () => {
  const container = {
    innerHTML: "",
    querySelectorAll: () => [],
  };
  const fakeDocument = {
    body: { classList: { contains: () => false } },
    getElementById: (id) => id === "recon-section" ? container : null,
  };
  const result = renderReconInventory({
    document: fakeDocument,
    targetWindow: {},
    data: {
      reconVials: [
        { id: 1, drug: RETA, vialMg: 20, waterMl: 2, doseMg: 2, reconDate: 1000 },
        { id: 2, drug: RETA, vialMg: 30, waterMl: 3, doseMg: 3, reconDate: 3000 },
      ],
      records: [],
    },
    configs: { [RETA]: { color: "#123456", halfLifeDays: 4 } },
    formatDate: (value) => String(value),
  });

  assert.equal(result.rowCount, 2);
  assert.equal((container.innerHTML.match(/<article /g) || []).length, 2);
  assert.match(container.innerHTML, /현재 조제/);
  assert.match(container.innerHTML, /이전 잔량/);
  assert.doesNotMatch(container.innerHTML, /onclick="openReconModal/);
});

test("새 조제 버튼은 남아 있던 수정 대상을 지운 뒤 추가 모달을 연다", () => {
  let openCount = 0;
  const fakeWindow = {
    _editingReconId: 77,
    openReconModal: () => { openCount += 1; },
    openEditReconModal: () => {},
  };
  const fakeDocument = {
    body: null,
    getElementById: () => null,
  };
  const installed = installReconInventoryGuard({
    document: fakeDocument,
    targetWindow: fakeWindow,
    getData: () => ({ reconVials: [], records: [] }),
  });

  assert.equal(installed.installed, true);
  fakeWindow.openReconModal(RETA);
  assert.equal(openCount, 1);
  assert.equal(fakeWindow._editingReconId, null);
});
