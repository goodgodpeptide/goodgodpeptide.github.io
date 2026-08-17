export const SYNC_CONFLICT_CODE = 'jwbs/stale-data';
export const EMPTY_OVERWRITE_CODE = 'jwbs/empty-overwrite';

export function normalizeSyncRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function countPrimaryRecords(data) {
  return (Array.isArray(data?.records) ? data.records.length : 0)
    + (Array.isArray(data?.weightRecords) ? data.weightRecords.length : 0);
}

function syncError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

/**
 * 사용자 문서 전체 저장을 서버 버전 기반 트랜잭션으로 처리한다.
 * expectedRevision과 서버 버전이 다르면 어떤 데이터도 쓰지 않는다.
 */
export async function commitUserDocument({
  db,
  runTransaction,
  ref,
  data,
  expectedRevision,
  allowEmpty = false,
  now = () => Date.now(),
}) {
  const expected = normalizeSyncRevision(expectedRevision);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const serverData = snapshot.exists() ? snapshot.data() : {};
    const serverRevision = normalizeSyncRevision(serverData.syncRevision);

    if (serverRevision !== expected) {
      throw syncError(
        SYNC_CONFLICT_CODE,
        `서버 버전 ${serverRevision}과 이 기기의 기준 버전 ${expected}이 다릅니다.`,
        { serverRevision, expectedRevision: expected },
      );
    }

    const localCount = countPrimaryRecords(data);
    const serverCount = countPrimaryRecords(serverData);
    if (!allowEmpty && localCount === 0 && serverCount > 0) {
      throw syncError(
        EMPTY_OVERWRITE_CODE,
        '기록이 있는 서버 문서를 빈 로컬 데이터로 덮어쓸 수 없습니다.',
        { localCount, serverCount },
      );
    }

    const updatedAt = now();
    const revision = serverRevision + 1;
    const nextData = { ...data, updatedAt, syncRevision: revision };
    transaction.set(ref, nextData);

    return { data: nextData, revision, updatedAt };
  });
}

export function isSyncConflict(error) {
  return error?.code === SYNC_CONFLICT_CODE;
}
