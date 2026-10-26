import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const database = JSON.parse(await readFile(new URL('../peptides_v3.json', import.meta.url), 'utf8'));
const statusValues = new Set(['Extensively Studied', 'Well Researched', 'Clinical Research', 'Emerging Research', 'Limited Research']);
const newIds = ['aicar', 'cortagen', 'klotho', 'ptd-dbm', 'slu-pp-915'];

test('백과 검색 인덱스와 상세의 개수·용량·승인·연구 필터가 일치한다', () => {
  assert.equal(database.totalCount, database.index.length);
  assert.equal(database.totalCount, Object.keys(database.peptides).length);
  assert.equal(new Set(database.index.map(item => item.id)).size, database.totalCount);
  for (const id of [...newIds, 'epitalon', 'ghk-cu', 'mazdutide', 'sermorelin']) {
    const item = database.peptides[id];
    const index = database.index.find(row => row.id === id);
    assert.ok(item && index, id);
    for (const key of ['typicalDose', 'researchStatus', 'isApproved']) assert.equal(index[key], item[key], `${id}.${key}`);
    assert.ok(statusValues.has(item.researchStatus), `${id} UI 연구 필터 지원`);
  }
});

test('새 연구 카드가 동물·후기 용량을 사람 용법으로 표시하지 않는다', () => {
  for (const id of newIds) {
    const item = database.peptides[id];
    assert.deepEqual(item.protocols, []);
    assert.equal(item.isApproved, false);
    assert.match(item.typicalDose, /미확립/);
    assert.ok(item.descriptionKo.length > 30);
    assert.ok(item.latestResearch.length > 0);
    assert.ok(item.evidenceReview.primaryReferences.length > 0);
  }
  assert.equal(database.peptides.epitalon.isApproved, false);
  assert.match(database.peptides.epitalon.typicalDose, /미확립/);
  assert.deepEqual(database.peptides.epitalon.protocols, []);
  for (const id of ['ghk-cu', 'mazdutide', 'sermorelin']) assert.equal(database.peptides[id].isApproved, false, id);
});

test('신규 백과 항목이 사용자에게 보이는 데이터 패치노트에 연결된다', () => {
  const note = database.patchNotes.find(row => row.date === '2026-10-26');
  assert.ok(note);
  for (const id of newIds) assert.ok(note.added.some(row => row.id === id), id);
  assert.ok(note.updated.some(row => row.id === 'epitalon'));
});
