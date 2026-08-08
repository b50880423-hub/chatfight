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
  const name = escapeHtml(normalizeDisplayName(user.displayName || user.userName || `User ${user.userId}`));
  const username = normalizeUsername(user.userName);
  const href = user.userId ? `tg://user?id=${user.userId}` : username ? `https://t.me/${username}` : null;
  return href ? `<a href="${escapeHtml(href)}">${name}</a>` : name;
}

export function formatProfileText(user, rank, totalUsers, contextName) {
  const nameLink = buildUserLink(user);
  const lines = ['<b>ChatFight - Profile</b>'];

  if (contextName) {
    lines.push(`<b>Group:</b> ${escapeHtml(contextName)}`);
  }

  lines.push(
    `<b>User:</b> <b>${nameLink}</b>`,
    '',
    `<b>Total messages:</b> ${Number(user.messageCount || 0).toLocaleString('de-DE')}`,
    `<b>Today messages:</b> ${Number(user.dailyMessageCount || 0).toLocaleString('de-DE')}`,
    `<b>This week:</b> ${Number(user.weeklyMessageCount || 0).toLocaleString('de-DE')}`,
    `<b>Overall rank:</b> #${rank} of ${totalUsers}`,
    `<b>Joined:</b> ${new Date(user.createdAt).toLocaleDateString()}`,
  );

  return lines.join('\n');
}
