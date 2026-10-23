import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicates } from '../src/duplicates.js';

const base = { id: 'a', site: '○○ビル現場', gate: '北搬入口', start: '2026-10-24T08:30:00+09:00', status: '確定' };
const candidate = { site: '○○ビル現場', gate: '北搬入口', start: '2026-10-24T08:45:00+09:00' };

test('15分ちょうどは重複', () => {
  assert.equal(findDuplicates(candidate, [base]).length, 1);
});

test('16分離れていれば重複しない', () => {
  assert.equal(findDuplicates({ ...candidate, start: '2026-10-24T08:46:00+09:00' }, [base]).length, 0);
});

test('中止は対象外', () => {
  assert.equal(findDuplicates(candidate, [{ ...base, status: '中止' }]).length, 0);
});

test('搬入口が違えば重複しない', () => {
  assert.equal(findDuplicates(candidate, [{ ...base, gate: '南搬入口' }]).length, 0);
});

test('現場が違えば重複しない', () => {
  assert.equal(findDuplicates(candidate, [{ ...base, site: '△△現場' }]).length, 0);
});

test('変更時は自分自身を除外', () => {
  assert.equal(findDuplicates(candidate, [base], { ignoreId: 'a' }).length, 0);
});

test('搬入口が未入力ならチェックしない', () => {
  assert.equal(findDuplicates({ ...candidate, gate: '' }, [base]).length, 0);
});

test('タイムゾーン表記が違っても同じ時刻として比べる', () => {
  assert.equal(findDuplicates({ ...candidate, start: '2026-10-23T23:40:00Z' }, [base]).length, 1);
});
