import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_OVERWRITE_CODE,
  SYNC_CONFLICT_CODE,
  commitUserDocument,
  normalizeSyncRevision,
} from '../sync_guard.js';

function fakeRunTransaction(serverData, onSet = () => {}) {
  return async (_db, callback) => callback({
    get: async () => ({
      exists: () => serverData !== null,
      data: () => serverData ?? {},
    }),
    set: (_ref, data) => onSet(data),
  });
}

test('영양제나 다른 기록 배열만 있는 서버도 빈 문서 덮어쓰기를 막는다', async () => {
  for (const collection of ['supplements', 'waterRecords', 'customRecords']) {
    let writes = 0;
    await assert.rejects(commitUserDocument({ db: {}, ref: {}, expectedRevision: 1, data: {},
      runTransaction: fakeRunTransaction({ syncRevision: 1, [collection]: [{ id: 1 }] }, () => { writes++; }),
    }), error => error.code === EMPTY_OVERWRITE_CODE);
    assert.equal(writes, 0);
  }
});

test('트랜잭션 읽기 대기 중 승인이 바뀌면 set 직전에 중단한다', async () => {
  let active = true, release, writes = 0;
  const result = commitUserDocument({ db: {}, ref: {}, data: { records: [{ id: 1 }] }, expectedRevision: 1,
    assertCurrent: () => { if (!active) throw Error('approval changed'); },
    runTransaction: async (_db, callback) => callback({
      get: async () => { await new Promise(resolve => { release = resolve; }); return { exists: () => true, data: () => ({ syncRevision: 1 }) }; },
      set: () => { writes++; },
    }),
  });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  active = false; release();
  await assert.rejects(result, /approval changed/); assert.equal(writes, 0);
});

test('버전이 같으면 정확히 한 단계 증가시켜 저장한다', async () => {
  let written;
  const result = await commitUserDocument({
    db: {},
    runTransaction: fakeRunTransaction(
      { syncRevision: 7, records: [{ id: 1 }] },
      (data) => { written = data; },
    ),
    ref: {},
    data: { records: [{ id: 1 }, { id: 2 }] },
    expectedRevision: 7,
    now: () => 123456,
  });

  assert.equal(result.revision, 8);
  assert.equal(written.syncRevision, 8);
  assert.equal(written.updatedAt, 123456);
  assert.equal(written.records.length, 2);
});

test('오래된 기기의 기준 버전이면 서버 쓰기를 전혀 하지 않는다', async () => {
  let writeCount = 0;
  await assert.rejects(
    commitUserDocument({
      db: {},
      runTransaction: fakeRunTransaction(
        { syncRevision: 9, records: [{ id: 'latest' }] },
        () => { writeCount += 1; },
      ),
      ref: {},
      data: { records: [{ id: 'stale' }] },
      expectedRevision: 8,
    }),
    (error) => error.code === SYNC_CONFLICT_CODE
      && error.serverRevision === 9
      && error.expectedRevision === 8,
  );
  assert.equal(writeCount, 0);
});

test('기존 문서에는 버전 1로 안전하게 마이그레이션한다', async () => {
  let written;
  const result = await commitUserDocument({
    db: {},
    runTransaction: fakeRunTransaction(
      { records: [{ id: 1 }] },
      (data) => { written = data; },
    ),
    ref: {},
    data: { records: [{ id: 1 }, { id: 2 }] },
    expectedRevision: normalizeSyncRevision(undefined),
    now: () => 100,
  });
  assert.equal(result.revision, 1);
  assert.equal(written.syncRevision, 1);
});

test('기록이 있는 서버를 빈 데이터로 덮는 것은 별도 승인 없이는 차단한다', async () => {
  await assert.rejects(
    commitUserDocument({
      db: {},
      runTransaction: fakeRunTransaction({ syncRevision: 3, records: [{ id: 1 }] }),
      ref: {},
      data: { records: [], weightRecords: [] },
      expectedRevision: 3,
    }),
    (error) => error.code === EMPTY_OVERWRITE_CODE,
  );
});

test('동시 갱신으로 트랜잭션이 재실행되면 두 번째 서버 버전에서 충돌한다', async () => {
  let readCount = 0;
  let writeCount = 0;
  const retryingTransaction = async (_db, callback) => {
    const transaction = {
      get: async () => ({
        exists: () => true,
        data: () => ({ syncRevision: readCount++ === 0 ? 4 : 5, records: [{ id: 1 }] }),
      }),
      set: () => { writeCount += 1; },
    };
    await callback(transaction);
    return callback(transaction);
  };

  await assert.rejects(
    commitUserDocument({
      db: {},
      runTransaction: retryingTransaction,
      ref: {},
      data: { records: [{ id: 1 }, { id: 2 }] },
      expectedRevision: 4,
    }),
    (error) => error.code === SYNC_CONFLICT_CODE && error.serverRevision === 5,
  );
  assert.equal(writeCount, 1);
});

for (const collectionName of ['reconVials', 'reconVialsArchive']) {
  test(`${collectionName}만 있는 서버도 빈 로컬 덮어쓰기를 차단한다`, async () => {
    let writes = 0;
    await assert.rejects(commitUserDocument({
      db: {}, ref: {}, expectedRevision: 2,
      runTransaction: fakeRunTransaction({
        syncRevision: 2, records: [], weightRecords: [],
        [collectionName]: [{ id: 1, drug: '시험 약물' }],
      }, () => { writes += 1; }),
      data: { records: [], weightRecords: [], reconVials: [], reconVialsArchive: [] },
    }), error => error.code === EMPTY_OVERWRITE_CODE
      && error.serverCount === 1 && error.localCount === 0);
    assert.equal(writes, 0);
  });

  test(`${collectionName}만 있는 정상 로컬은 빈 데이터로 오판하지 않는다`, async () => {
    const vials = [{ id: 1, drug: '시험 약물' }];
    let written;
    const result = await commitUserDocument({
      db: {}, ref: {}, expectedRevision: 2,
      runTransaction: fakeRunTransaction({
        syncRevision: 2, [collectionName]: vials,
      }, data => { written = data; }),
      data: { records: [], weightRecords: [], [collectionName]: vials },
    });
    assert.equal(result.revision, 3);
    assert.deepEqual(written[collectionName], vials);
  });
}

test('명시적인 전체 비우기와 새 빈 문서 생성은 계속 허용한다', async () => {
  for (const [server, allowEmpty] of [
    [{ syncRevision: 0, reconVialsArchive: [{ id: 1 }] }, true],
    [null, false],
  ]) {
    let writes = 0;
    await commitUserDocument({
      db: {}, ref: {}, expectedRevision: 0, allowEmpty,
      runTransaction: fakeRunTransaction(server, () => { writes += 1; }),
      data: { records: [], weightRecords: [], reconVials: [], reconVialsArchive: [] },
    });
    assert.equal(writes, 1);
  }
});
