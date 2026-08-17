import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const projectId = 'demo-weight-sync';
let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

after(async () => {
  await environment?.cleanup();
});

test('새 사용자 문서는 syncRevision 1일 때만 생성된다', async () => {
  const owner = environment.authenticatedContext('owner-a').firestore();
  await assertFails(setDoc(doc(owner, 'users', 'owner-a'), {
    records: [],
    weightRecords: [],
  }));
  await assertSucceeds(setDoc(doc(owner, 'users', 'owner-a'), {
    records: [{ id: 'first' }],
    weightRecords: [],
    syncRevision: 1,
  }));
});

test('구버전 문서는 1로 마이그레이션되고 이후 정확히 +1만 허용된다', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'owner-b'), {
      records: [{ id: 'legacy' }],
      weightRecords: [],
    });
  });

  const owner = environment.authenticatedContext('owner-b').firestore();
  const ref = doc(owner, 'users', 'owner-b');
  await assertSucceeds(setDoc(ref, {
    records: [{ id: 'legacy' }, { id: 'new' }],
    weightRecords: [],
    syncRevision: 1,
  }));
  await assertFails(setDoc(ref, {
    records: [{ id: 'stale' }],
    weightRecords: [],
    syncRevision: 1,
  }));
  await assertFails(setDoc(ref, {
    records: [{ id: 'old-client' }],
    weightRecords: [],
  }));
  await assertSucceeds(setDoc(ref, {
    records: [{ id: 'latest' }],
    weightRecords: [],
    syncRevision: 2,
  }));

  const snapshot = await assertSucceeds(getDoc(ref));
  assert.equal(snapshot.data().records[0].id, 'latest');
});

test('다른 UID의 문서는 읽기와 쓰기 모두 차단된다', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', 'owner-c'), {
      records: [],
      weightRecords: [],
      syncRevision: 1,
    });
  });

  const stranger = environment.authenticatedContext('stranger').firestore();
  const ref = doc(stranger, 'users', 'owner-c');
  await assertFails(getDoc(ref));
  await assertFails(setDoc(ref, {
    records: [{ id: 'attack' }],
    weightRecords: [],
    syncRevision: 2,
  }));
});
