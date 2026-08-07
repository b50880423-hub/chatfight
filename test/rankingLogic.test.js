import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRankingText, getUserUpdateForMessage } from '../src/rankingLogic.js';

test('formatRankingText formats the ranking output', () => {
  const text = formatRankingText([
    { userName: 'Bishal', dailyMessageCount: 203 },
    { userName: 'Nina', dailyMessageCount: 185 },
  ], 3000);

  assert.equal(text, 'Top users today:\n1. Bishal — 203\n2. Nina — 185\n\nToday total: 3000');
});

test('getUserUpdateForMessage resets daily count for a new day', () => {
  const existing = {
    dayKey: '2025-01-01',
    dailyMessageCount: 10,
  };

  const updatePlan = getUserUpdateForMessage(existing, '42', '99', 'Bishal', new Date('2025-01-02T10:00:00.000Z'));

  assert.equal(updatePlan.operation, 'update');
  assert.equal(updatePlan.update.$set.dailyMessageCount, 1);
  assert.equal(updatePlan.update.$set.dayKey, '2025-01-02');
});
