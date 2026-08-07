import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRankingText } from '../src/rankingLogic.js';

test('formatRankingText formats today rankings', () => {
  const text = formatRankingText([
    { userName: 'Bishal', dailyMessageCount: 203 },
    { userName: 'Nina', dailyMessageCount: 185 },
  ], 3000, 'today');

  assert.equal(text, 'Top users today:\n1. Bishal — 203\n2. Nina — 185\n\nToday total: 3000');
});

test('formatRankingText formats total rankings', () => {
  const text = formatRankingText([
    { userName: 'Bishal', messageCount: 203512 },
    { userName: 'Nina', messageCount: 185010 },
  ], 3000, 'total');

  assert.equal(text, 'Top users overall:\n1. Bishal — 203512\n2. Nina — 185010\n\nAll-time total: 3000');
});
