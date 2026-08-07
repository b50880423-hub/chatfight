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

export function formatProfileText(user, rank, totalUsers, contextName) {
  const name = escapeHtml(normalizeDisplayName(user.userName || `User ${user.userId}`));
  const lines = ['<b>ChatFight - Profile</b>'];

  if (contextName) {
    lines.push(`<b>Group:</b> ${escapeHtml(contextName)}`);
  }

  lines.push(
    `<b>User:</b> <b>${name}</b>`,
    '',
    `<b>Total messages:</b> ${user.messageCount || 0}`,
    `<b>Today messages:</b> ${user.dailyMessageCount || 0}`,
    `<b>This week:</b> ${user.weeklyMessageCount || 0}`,
    `<b>Overall rank:</b> #${rank} of ${totalUsers}`,
    `<b>Joined:</b> ${new Date(user.createdAt).toLocaleDateString()}`,
  );

  return lines.join('\n');
}
