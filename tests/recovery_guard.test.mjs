import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeRecoveryCandidate,
  buildRecoveryData,
} from '../recovery_guard.js';

const injection = (id, time) => ({ id, time, dose: 1 });
const weight = (id, time) => ({ id, time, weight: 80 });

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
