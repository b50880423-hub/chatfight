export function getWeekKey(date) {
  const copy = new Date(date);
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + (1 - day));
  return `${copy.getUTCFullYear()}-${String(copy.getUTCMonth() + 1).padStart(2, '0')}-${String(copy.getUTCDate()).padStart(2, '0')}`;
}

export function formatRankingText(topUsers, totalValue, mode = 'today') {
  const metricKey = mode === 'total' ? 'messageCount' : mode === 'weekly' ? 'weeklyMessageCount' : 'dailyMessageCount';
  const title = mode === 'total' ? 'Top users overall:' : mode === 'weekly' ? 'Top users this week:' : 'Top users today:';
  const totalLabel = mode === 'total' ? 'All-time total' : mode === 'weekly' ? 'Week total' : 'Today total';

  const lines = topUsers.map((user, index) => `${index + 1}. ${user.userName || `User ${user.userId}`} — ${user[metricKey] ?? 0}`);
  return [
    title,
    ...lines,
    '',
    `${totalLabel}: ${totalValue}`,
  ].join('\n');
}

export function getUserUpdateForMessage(existingUser, groupId, userId, userName, now = new Date()) {
  const dayKey = now.toISOString().slice(0, 10);
  const weekKey = getWeekKey(now);

  if (!existingUser) {
    return {
      operation: 'insert',
      doc: {
        groupId,
        userId,
        userName,
        messageCount: 1,
        dailyMessageCount: 1,
        weeklyMessageCount: 1,
        dayKey,
        weekKey,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  const dailyMessageCount = existingUser.dayKey === dayKey
    ? (existingUser.dailyMessageCount || 0) + 1
    : 1;

  const weeklyMessageCount = existingUser.weekKey === weekKey
    ? (existingUser.weeklyMessageCount || 0) + 1
    : 1;

  return {
    operation: 'update',
    update: {
      $set: {
        userName,
        dayKey,
        weekKey,
        dailyMessageCount,
        weeklyMessageCount,
        updatedAt: now,
      },
      $inc: {
        messageCount: 1,
      },
    },
  };
}
