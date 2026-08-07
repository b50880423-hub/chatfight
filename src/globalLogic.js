export function formatGlobalUsersText(entries, mode = 'today') {
  const title = mode === 'total' ? 'Top 10 global users overall:' : mode === 'weekly' ? 'Top 10 global users this week:' : 'Top 10 global users today:';
  const totalLabel = mode === 'total' ? 'All-time total' : mode === 'weekly' ? 'Week total' : 'Today total';
  const lines = entries.map((entry, index) => `${index + 1}. ${entry.userName || `User ${entry.userId}`} — ${entry.value}`);
  return [title, ...lines, '', `${totalLabel}: ${entries[0]?.totalValue || 0}`].join('\n');
}

export function formatGlobalGroupsText(entries, mode = 'today') {
  const title = mode === 'total' ? 'Top 10 groups overall:' : mode === 'weekly' ? 'Top 10 groups this week:' : 'Top 10 groups today:';
  const totalLabel = mode === 'total' ? 'All-time total' : mode === 'weekly' ? 'Week total' : 'Today total';
  const lines = entries.map((entry, index) => `${index + 1}. ${entry.groupName || entry.groupId} — ${entry.value}`);
  return [title, ...lines, '', `${totalLabel}: ${entries[0]?.totalValue || 0}`].join('\n');
}
