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

function cleanUnicode(value = '') {
  return Array.from(String(value || ''))
    .filter((char) => {
      const codePoint = char.codePointAt(0);
      return codePoint < 0xD800 || codePoint > 0xDFFF;
    })
    .join('');
}

function formatNumber(value = 0) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';
  return Math.trunc(numeric).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function limitUnicodeName(value, max = 30) {
  const text = cleanUnicode(value).trim();
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), x => x.segment);
    return graphemes.length > max ? `${graphemes.slice(0, max).join('')}...` : text;
  }
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('')}...` : text;
}

function buildUserLink(user) {
  const raw = cleanUnicode(normalizeDisplayName(user.displayName || user.userName || `User ${user.userId}`));
  const name = escapeHtml(limitUnicodeName(raw, 30));
  const username = normalizeUsername(user.userName);
  const href = user.userId ? `tg://user?id=${user.userId}` : username ? `https://t.me/${username}` : null;
  return href ? `<a href="${escapeHtml(href)}">${name}</a>` : name;
}

export function formatProfileText(user, rank, totalUsers, contextName) {
  const nameLink = buildUserLink(user);
  const lines = ['<b>ChatFight - Profile</b>'];

  if (contextName) {
    lines.push(escapeHtml(limitUnicodeName(cleanUnicode(contextName), 100)));
  }

  lines.push(
    `<b>User:</b> <b>${nameLink}</b>`,
    '',
    `<b>Total messages:</b> ${formatNumber(user.messageCount || 0)}`,
    `<b>Today messages:</b> ${formatNumber(user.dailyMessageCount || 0)}`,
    `<b>This week:</b> ${formatNumber(user.weeklyMessageCount || 0)}`,
    `<b>Overall rank:</b> #${rank} of ${totalUsers}`,
    `<b>Joined:</b> ${new Date(user.createdAt).toLocaleDateString()}`,
  );

  return lines.join('\n');
}
