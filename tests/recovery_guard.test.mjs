import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReconBatchRows } from '../recon_inventory_guard.js';

import {
  analyzeRecoveryCandidate,
  buildRecoveryData,
} from '../recovery_guard.js';

const injection = (id, time) => ({ id, time, dose: 1 });
const weight = (id, time) => ({ id, time, weight: 80 });

test('의도적 삭제와 구분할 수 없는 오래된 동일 최신시각 백업은 자동 복구하지 않는다', () => {
  const server = { updatedAt: 100, syncRevision: 3, records: [injection(2, 10)] };
  const backup = { updatedAt: 50, syncRevision: 2, records: [injection(1, 1), injection(2, 10)] };
  assert.equal(analyzeRecoveryCandidate(server, backup).shouldRecover, false);
  assert.equal(backup.records.length, 2);
});

test('복구는 완전히 같은 중복 ID를 한 번만 담고 값이 다르면 임의로 선택하지 않는다', () => {
  const server = { records: [injection(1, 10)] };
  const backup = { records: [injection(1, 10), injection(1, 10), injection(2, 20)] };
  assert.deepEqual(buildRecoveryData(server, backup).records.map(row => row.id), [1, 2]);
  const ambiguous = { records: [injection(2, 20), { ...injection(2, 20), dose: 2 }] };
  assert.equal(analyzeRecoveryCandidate(server, ambiguous).shouldRecover, false);
  assert.throws(() => buildRecoveryData(server, ambiguous), /동일 ID/);
  assert.equal(ambiguous.records.length, 2);
});

test('백업이 서버 기록을 모두 포함하고 더 최신이면 복구 후보가 된다', () => {
  const server = {
    records: [injection(1, 100), injection(2, 200)],
    weightRecords: [weight(3, 150)],
  };
  const backup = {
    records: [injection(1, 100), injection(2, 200), injection(4, 300)],
    weightRecords: [weight(3, 150), weight(5, 350)],
  };

  assert.deepEqual(analyzeRecoveryCandidate(server, backup), {
    shouldRecover: true,
    serverIsContained: true,
    serverCount: 3,
    backupCount: 5,
    backupMissingFromServer: 2,
    serverMissingFromBackup: 0,
    mergedCount: 5,
    missingCount: 2,
    serverLatestTime: 200,
    backupLatestTime: 350,
  });
});

test('서버 고유 기록은 보존하고 백업 누락분만 합친다', () => {
  const server = { records: [injection(1, 100), injection(9, 500)] };
  const backup = {
    records: [injection(1, 100), injection(2, 200), injection(3, 600)],
  };

  const result = analyzeRecoveryCandidate(server, backup);
  assert.equal(result.shouldRecover, true);
  assert.equal(result.serverIsContained, false);
  assert.equal(result.backupMissingFromServer, 2);
  assert.equal(result.serverMissingFromBackup, 1);
  assert.equal(result.mergedCount, 4);
  assert.deepEqual(
    buildRecoveryData(server, backup).records.map(row => row.id),
    [1, 2, 3, 9],
  );
});

test('백업의 최신 시각이 서버보다 오래됐으면 자동 복구하지 않는다', () => {
  const server = { records: [injection(1, 700)] };
  const backup = { records: [injection(1, 500), injection(2, 600)] };

  const result = analyzeRecoveryCandidate(server, backup);
  assert.equal(result.shouldRecover, false);
});

test('서버와 백업 건수가 같으면 복구 루프를 만들지 않는다', () => {
  const server = { records: [injection(1, 100)] };
  const backup = { records: [injection(1, 100)] };

  const result = analyzeRecoveryCandidate(server, backup);
  assert.equal(result.shouldRecover, false);
  assert.equal(result.missingCount, 0);
  assert.equal(result.mergedCount, 1);
});

const vial = (id, extra = {}) => ({
  id, drug: '시험 약물', reconDate: 100, vialMg: 10, doseMg: 1, waterMl: 1,
  ...extra,
});

test('복구 후보가 되어도 서버의 수정된 기록·설정·배치 실측값은 되돌리지 않는다', () => {
  const server = {
    syncRevision: 8, updatedAt: 800, height: '180',
    records: [{ ...injection(1, 200), drug: '시험 약물', dose: 2 }],
    weightRecords: [{ ...weight(2, 200), weight: 75 }],
    reconVials: [vial(1, { actualTotalUnits: 80, injOffset: 1 })],
    reconVialsArchive: [],
  };
  const backup = {
    syncRevision: 3, updatedAt: 300, height: '170', backupOnly: '유지',
    records: [{ ...injection(1, 200), drug: '시험 약물' }, injection(3, 900)],
    weightRecords: [weight(2, 200)],
    reconVials: [vial(1, { actualTotalUnits: 100, injOffset: 0 })],
  };
  const before = structuredClone({ server, backup });
  assert.equal(analyzeRecoveryCandidate(server, backup).shouldRecover, true);
  const recovered = buildRecoveryData(server, backup);
  assert.deepEqual(recovered.reconVials, server.reconVials);
  assert.deepEqual(recovered.records[0], server.records[0]);
  assert.deepEqual(recovered.weightRecords[0], server.weightRecords[0]);
  assert.equal(recovered.height, '180');
  assert.equal(recovered.syncRevision, 8);
  assert.equal(recovered.updatedAt, 800);
  assert.equal(recovered.backupOnly, '유지');
  assert.equal(buildReconBatchRows(recovered.reconVials, recovered.records)[0].remainingMg, 5);
  assert.deepEqual({ server, backup }, before);
  assert.equal(analyzeRecoveryCandidate(recovered, backup).shouldRecover, false);
});

test('서버의 활성·보관 상태를 보존하고 누락 배치는 약물과 ID로 한 번만 복구한다', () => {
  const server = {
    reconVials: [vial(2, { actualTotalUnits: 85 })],
    reconVialsArchive: [vial(1, { archivedAt: 300 })],
  };
  const backup = {
    reconVials: [vial('1'), vial(3), vial(3), vial(2, { drug: '다른 약물' }), vial(4)],
    reconVialsArchive: [vial('2', { archivedAt: 150 }), vial(4, { archivedAt: 200 })],
  };
  const recovered = buildRecoveryData(server, backup);
  assert.deepEqual(recovered.reconVials, [
    server.reconVials[0], vial(3), vial(2, { drug: '다른 약물' }),
  ]);
  assert.deepEqual(recovered.reconVialsArchive, [
    server.reconVialsArchive[0], vial(4, { archivedAt: 200 }),
  ]);
  assert.deepEqual(buildRecoveryData(recovered, backup), recovered);
});

test('보관 배치를 활성으로 부활시키지 않아 이후 투약은 현재 배치에서 차감한다', () => {
  const server = {
    records: [
      { id: 1, drug: '시험 약물', time: 200, dose: 10 },
      { id: 2, drug: '시험 약물', time: 400, dose: 2 },
    ],
    reconVials: [vial(2, { reconDate: 350 })],
    reconVialsArchive: [vial(1, { archivedAt: 300 })],
  };
  const recovered = buildRecoveryData(server, { reconVials: [vial(1)] });
  const rows = buildReconBatchRows(recovered.reconVials, recovered.records, recovered.reconVialsArchive);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 2);
  assert.equal(rows[0].remainingMg, 8);
});

test('이전 형식의 누락 배열은 허용하고 식별 불가능한 백업 배치는 추가하지 않는다', () => {
  const recovered = buildRecoveryData({}, {
    reconVials: [null, vial(undefined), vial('', {}), vial(0)],
    reconVialsArchive: null,
  });
  assert.deepEqual(recovered.reconVials, [vial(0)]);
  assert.deepEqual(recovered.reconVialsArchive, []);
  assert.deepEqual(recovered.records, []);
  assert.deepEqual(recovered.weightRecords, []);
});
