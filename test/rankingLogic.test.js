import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRankingText, getUserUpdateForMessage } from '../src/rankingLogic.js';
import { formatGlobalGroupsText, formatGlobalUsersText } from '../src/globalLogic.js';
import { formatProfileText } from '../src/profileLogic.js';

test('formatRankingText formats the ranking output', () => {
  const text = formatRankingText([
    { userName: 'Bishal', dailyMessageCount: 203 },
    { userName: 'Nina', dailyMessageCount: 185 },
  ], 3000, 'today', 'ChatFight Group');

  assert.equal(text, '<b>ChatFight - Rankings</b>\n<b>Group:</b> ChatFight Group\n<b>Mode:</b> Today\n\n<b>Top users today:</b>\n<b>1.</b> <b>Bishal</b> — 203\n<b>2.</b> <b>Nina</b> — 185\n\n<b>Today total:</b> 3000');
});

test('formatProfileText formats the profile output in HTML', () => {
  const text = formatProfileText(
    { userName: 'Bishal', messageCount: 12541, dailyMessageCount: 203, weeklyMessageCount: 1180, createdAt: '2025-01-01T00:00:00.000Z' },
    7,
    42,
  );

  assert.equal(text, '<b>ChatFight - Profile</b>\n<b>User:</b> <b>Bishal</b>\n\n<b>Total messages:</b> 12541\n<b>Today messages:</b> 203\n<b>This week:</b> 1180\n<b>Overall rank:</b> #7 of 42\n<b>Joined:</b> 1/1/2025');
});

test('formatGlobalUsersText and formatGlobalGroupsText use HTML formatting', () => {
  const usersText = formatGlobalUsersText([
    { userName: 'Bishal', value: 12541 },
  ], 'total');
  const groupsText = formatGlobalGroupsText([
    { groupName: 'ChatFight Group', value: 12541 },
  ], 'weekly');

  assert.equal(usersText, '<b>ChatFight - Top Users</b>\n<b>Group:</b> this chat\n<b>Mode:</b> Total\n\n<b>Top 10 global users overall:</b>\n<b>1.</b> <b>Bishal</b> — 12541\n\n<b>All-time total:</b> 0');
  assert.equal(groupsText, '<b>ChatFight - Top Groups</b>\n<b>Group:</b> this chat\n<b>Mode:</b> Weekly\n\n<b>Top 10 groups this week:</b>\n<b>1.</b> <b>ChatFight Group</b> — 12541\n\n<b>Week total:</b> 0');
});

test('getUserUpdateForMessage resets daily count for a new day', () => {
  const existing = {
    dayKey: '2025-01-01',
    dailyMessageCount: 10,
  };

  const updatePlan = getUserUpdateForMessage(existing, '42', '99', 'Bishal', 'mr_obstinate', new Date('2025-01-02T10:00:00.000Z'));

  assert.equal(updatePlan.operation, 'update');
  assert.equal(updatePlan.update.$set.dailyMessageCount, 1);
  assert.equal(updatePlan.update.$set.dayKey, '2025-01-02');
});
