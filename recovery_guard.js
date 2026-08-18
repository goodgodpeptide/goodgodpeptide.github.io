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
    return rows.map((item, index) => ({
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

function mergeCoreRows(collectionName, serverData, backupData) {
  const serverRows = Array.isArray(serverData?.[collectionName])
    ? serverData[collectionName]
    : [];
  const backupRows = Array.isArray(backupData?.[collectionName])
    ? backupData[collectionName]
    : [];
  const merged = [...backupRows];
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

export function analyzeRecoveryCandidate(serverData, backupData) {
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

  return {
    shouldRecover:
      backupMissingFromServer > 0 &&
      backupLatestTime >= serverLatestTime,
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
    ...serverData,
    ...backupData,
    records: mergeCoreRows('records', serverData, backupData),
    weightRecords: mergeCoreRows('weightRecords', serverData, backupData),
  };
}
