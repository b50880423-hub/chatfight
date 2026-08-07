import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRankingText } from '../src/rankingLogic.js';

test('formatRankingText formats today rankings', () => {
  const text = formatRankingText([
    { userName: 'Bishal', userId: '1001', dailyMessageCount: 203 },
    { userName: 'Nina', userId: '1002', dailyMessageCount: 185 },
  ], 3000, 'today', 'ChatFight Group');

  assert.equal(text, '<b>ChatFight - Rankings</b>\n<b>Group:</b> ChatFight Group\n<b>Mode:</b> Today\n\n<b>Top users today:</b>\n<b>1.</b> <b><a href="tg://user?id=1001">Bishal</a></b> — 203\n<b>2.</b> <b><a href="tg://user?id=1002">Nina</a></b> — 185\n\n<b>Today total:</b> 3000');
});

test('formatRankingText formats total rankings', () => {
  const text = formatRankingText([
    { userName: 'Bishal', userId: '1001', messageCount: 203512 },
    { userName: 'Nina', userId: '1002', messageCount: 185010 },
  ], 3000, 'total', 'ChatFight Group');

  assert.equal(text, '<b>ChatFight - Rankings</b>\n<b>Group:</b> ChatFight Group\n<b>Mode:</b> Total\n\n<b>Top users overall:</b>\n<b>1.</b> <b><a href="tg://user?id=1001">Bishal</a></b> — 203512\n<b>2.</b> <b><a href="tg://user?id=1002">Nina</a></b> — 185010\n\n<b>All-time total:</b> 3000');
});
