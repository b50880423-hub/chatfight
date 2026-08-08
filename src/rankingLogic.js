function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeDisplayName(value = '') {
  return String(value || '').trim();
}

function normalizeUsername(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  const stripped = raw.startsWith('@') ? raw.slice(1) : raw;
  return stripped;
}

function buildUserLink(user) {
  const rawName = normalizeDisplayName(user.displayName || user.userName || `User ${user.userId}`);
  const cleanName = rawName.replace(/[\uD800-\uDFFF]/g, '');
  const shortName = rawName.length > 14 ? `${rawName.slice(0, 14)}...` : rawName;
  const name = escapeHtml(shortName);
  const userId = user.userId;
  const username = normalizeUsername(user.userName);
  const href = userId ? `tg://user?id=${userId}` : username ? `https://t.me/${username}` : null;
  return href ? `<a href="${escapeHtml(href)}">${name}</a>` : name;
}

export function getISTDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

export function getWeekKey(date = new Date()) {
  const dayKey = getISTDayKey(date);

  // Use the IST calendar date as the basis for Monday-Sunday week.
  const copy = new Date(`${dayKey}T00:00:00Z`);
  const day = copy.getUTCDay() || 7;

  copy.setUTCDate(copy.getUTCDate() + (1 - day));

  return `${copy.getUTCFullYear()}-${String(copy.getUTCMonth() + 1).padStart(2, '0')}-${String(copy.getUTCDate()).padStart(2, '0')}`;
}
export function formatRankingText(topUsers, totalValue, mode = 'today', contextName = 'this chat') {
  const metricKey = mode === 'total' ? 'messageCount' : mode === 'weekly' ? 'weeklyMessageCount' : 'dailyMessageCount';
  const title = mode === 'total' ? 'Top users overall:' : mode === 'weekly' ? 'Top users this week:' : 'Top users today:';
  const totalLabel = mode === 'total' ? 'All-time total' : mode === 'weekly' ? 'Week total' : 'Today total';

  const lines = topUsers.map((user, index) => {
    const nameLink = buildUserLink(user);
    return `<b>${index + 1}.</b> <b>${nameLink}</b> — ${user[metricKey] ?? 0}`;
  });

  const modeLabel = mode === 'total' ? 'Total' : mode === 'weekly' ? 'Weekly' : 'Today';

  return [
    '<b>ChatFight - Rankings</b>',
    `<b>Group:</b> ${escapeHtml(contextName)}`,
    `<b>Mode:</b> ${modeLabel}`,
    '',
    `<b>${title}</b>`,
    ...lines,
    '',
    `<b>${totalLabel}:</b> ${totalValue}`,
  ].join('\n');
}

export function getUserUpdateForMessage(existingUser, groupId, userId, displayName, userName, groupName, groupLink, now = new Date()) {
  const dayKey = getISTDayKey(now);
  const weekKey = getWeekKey(now);

  if (!existingUser) {
    return {
      operation: 'insert',
      doc: {
        groupId,
        userId,
        displayName,
        userName,
        groupName,
        groupLink,
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
        displayName,
        userName,
        groupName,
        groupLink,
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
