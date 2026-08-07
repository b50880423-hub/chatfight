function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeDisplayName(value = '') {
  const raw = String(value).trim();
  if (!raw) return raw;
  const stripped = raw.startsWith('@') ? raw.slice(1) : raw;
  return stripped.replace(/_/g, ' ');
}

export function formatGlobalUsersText(entries, mode = 'today', contextName = 'this chat') {
  const title = mode === 'total' ? 'Top 10 global users overall:' : mode === 'weekly' ? 'Top 10 global users this week:' : 'Top 10 global users today:';
  const totalLabel = mode === 'total' ? 'All-time total' : mode === 'weekly' ? 'Week total' : 'Today total';
  const lines = entries.map((entry, index) => {
    const name = escapeHtml(normalizeDisplayName(entry.userName || `User ${entry.userId}`));
    return `<b>${index + 1}.</b> <b>${name}</b> — ${entry.value}`;
  });

  return [
    '<b>ChatFight - Top Users</b>',
    `<b>Group:</b> ${escapeHtml(contextName)}`,
    '<b>Mode:</b> Total | Today | Weekly',
    '',
    `<b>${title}</b>`,
    ...lines,
    '',
    `<b>${totalLabel}:</b> ${entries[0]?.totalValue || 0}`,
  ].join('\n');
}

export function formatGlobalGroupsText(entries, mode = 'today', contextName = 'this chat') {
  const title = mode === 'total' ? 'Top 10 groups overall:' : mode === 'weekly' ? 'Top 10 groups this week:' : 'Top 10 groups today:';
  const totalLabel = mode === 'total' ? 'All-time total' : mode === 'weekly' ? 'Week total' : 'Today total';
  const lines = entries.map((entry, index) => {
    const name = escapeHtml(entry.groupName || entry.groupId);
    return `<b>${index + 1}.</b> <b>${name}</b> — ${entry.value}`;
  });

  return [
    '<b>ChatFight - Top Groups</b>',
    `<b>Group:</b> ${escapeHtml(contextName)}`,
    '<b>Mode:</b> Total | Today | Weekly',
    '',
    `<b>${title}</b>`,
    ...lines,
    '',
    `<b>${totalLabel}:</b> ${entries[0]?.totalValue || 0}`,
  ].join('\n');
}
