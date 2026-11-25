const CORE_COLLECTIONS = ['records', 'weightRecords'];

function itemKey(collectionName, item, index) {
  if (item && item.id !== undefined && item.id !== null && item.id !== '') {
    return `${collectionName}:id:${String(item.id)}`;
  }
  if (item && item.time !== undefined && item.time !== null && item.time !== '') {
    return `${collectionName}:time:${String(item.time)}`;
  }
  return `${collectionName}:index:${index}:${JSON.stringify(item ?? null)}`;
}

function collectCoreItems(data) {
  return CORE_COLLECTIONS.flatMap(collectionName => {
    const rows = Array.isArray(data?.[collectionName]) ? data[collectionName] : [];
    let distinct = rows;
    try { distinct = uniqueCoreRows(collectionName, rows); } catch { /* 충돌 원본은 아래에서 수동 대조 대상으로 유지한다. */ }
    return distinct.map((item, index) => ({
      collectionName,
      item,
      key: itemKey(collectionName, item, index),
    }));
  });
}

function latestCoreTime(items) {
  return items.reduce((latest, row) => {
    const value = Number(row.item?.time || 0);
    return Number.isFinite(value) ? Math.max(latest, value) : latest;
  }, 0);
}

function uniqueCoreRows(collectionName, rows) {
  const byKey = new Map();
  for (const [index, row] of rows.entries()) {
    const key = itemKey(collectionName, row, index);
    if (byKey.has(key)) {
      // 원본은 보존하며 서로 다른 중복값 중 어느 것도 임의로 선택하지 않는다.
      if (JSON.stringify(byKey.get(key)) !== JSON.stringify(row)) throw new Error('복구 원본에 값이 다른 동일 ID 기록이 있습니다. 원본 대조가 필요합니다.');
      continue;
    }
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

function mergeCoreRows(collectionName, serverData, backupData) {
  const serverRows = uniqueCoreRows(collectionName, Array.isArray(serverData?.[collectionName])
    ? serverData[collectionName]
    : []);
  const backupRows = uniqueCoreRows(collectionName, Array.isArray(backupData?.[collectionName])
    ? backupData[collectionName]
    : []);
  const serverByKey = new Map(
    serverRows.map((item, index) => [itemKey(collectionName, item, index), item]),
  );
  // 같은 기록의 수정된 값은 서버가 정답이며, 백업에서는 누락 기록만 가져온다.
  const merged = backupRows.map((item, index) => (
    serverByKey.get(itemKey(collectionName, item, index)) ?? item
  ));
  const mergedKeys = new Set(
    backupRows.map((item, index) => itemKey(collectionName, item, index)),
  );

  serverRows.forEach((item, index) => {
    const key = itemKey(collectionName, item, index);
    if (!mergedKeys.has(key)) {
      merged.push(item);
      mergedKeys.add(key);
    }
  });
  return merged;
}

function reconKey(vial) {
  if (!vial?.drug || vial.id === undefined || vial.id === null || vial.id === '') {
    return null;
  }
  // 재고 계산(buildReconBatchRows)과 같은 배치 식별 기준을 사용한다.
  return `${vial.drug}\u0000${String(vial.id)}`;
}

function mergeReconCollections(serverData, backupData) {
  const names = ['reconVialsArchive', 'reconVials'];
  const merged = Object.fromEntries(names.map(name => [
    name, Array.isArray(serverData?.[name]) ? [...serverData[name]] : [],
  ]));
  const knownKeys = new Set(names.flatMap(name => merged[name].map(reconKey)));

  // 서버의 활성/보관 상태를 함께 보존한다. 백업 내부에서도 보관 이력을 우선해
  // 같은 배치가 활성 재고로 부활하지 않게 하고, 식별 가능한 누락분만 추가한다.
  for (const name of names) {
    const backupRows = Array.isArray(backupData?.[name]) ? backupData[name] : [];
    for (const vial of backupRows) {
      const key = reconKey(vial);
      if (key === null || knownKeys.has(key)) continue;
      merged[name].push(vial);
      knownKeys.add(key);
    }
  }
  return merged;
}

export function analyzeRecoveryCandidate(serverData, backupData) {
  let ambiguous = false;
  try {
    for (const name of CORE_COLLECTIONS) {
      uniqueCoreRows(name, Array.isArray(serverData?.[name]) ? serverData[name] : []);
      uniqueCoreRows(name, Array.isArray(backupData?.[name]) ? backupData[name] : []);
    }
  } catch { ambiguous = true; }
  const serverItems = collectCoreItems(serverData);
  const backupItems = collectCoreItems(backupData);
  const backupKeys = new Set(backupItems.map(row => row.key));
  const serverKeys = new Set(serverItems.map(row => row.key));
  const serverIsContained = serverItems.every(row => backupKeys.has(row.key));
  const serverCount = serverItems.length;
  const backupCount = backupItems.length;
  const serverLatestTime = latestCoreTime(serverItems);
  const backupLatestTime = latestCoreTime(backupItems);
  const backupMissingFromServer = backupItems.filter(
    row => !serverKeys.has(row.key),
  ).length;
  const serverMissingFromBackup = serverItems.filter(
    row => !backupKeys.has(row.key),
  ).length;
  const mergedCount = serverCount + backupMissingFromServer;
  const knownOlder = (Number(backupData?.updatedAt) > 0 && Number(serverData?.updatedAt) > Number(backupData.updatedAt))
    || (Number.isSafeInteger(backupData?.syncRevision) && Number.isSafeInteger(serverData?.syncRevision)
      && backupData.syncRevision < serverData.syncRevision);

  return {
    shouldRecover:
      !ambiguous && backupMissingFromServer > 0 &&
      backupLatestTime >= serverLatestTime && !(knownOlder && backupLatestTime === serverLatestTime),
    serverIsContained,
    serverCount,
    backupCount,
    backupMissingFromServer,
    serverMissingFromBackup,
    mergedCount,
    missingCount: backupMissingFromServer,
    serverLatestTime,
    backupLatestTime,
  };
}

export function buildRecoveryData(serverData, backupData) {
  return {
    ...backupData,
    ...serverData,
    records: mergeCoreRows('records', serverData, backupData),
    weightRecords: mergeCoreRows('weightRecords', serverData, backupData),
    ...mergeReconCollections(serverData, backupData),
  };
}
