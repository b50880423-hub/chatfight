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

function limitUnicodeName(value, max = 30) {
  const text = cleanUnicode(value).trim();
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), x => x.segment);
    return graphemes.length > max ? `${graphemes.slice(0, max).join('')}...` : text;
  }
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('')}...` : text;
}

function formatNumber(value = 0) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';
  return Math.trunc(numeric).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function buildUserLink(entry) {
  const rawName = normalizeDisplayName(entry.displayName || entry.userName || `User ${entry.userId}`);
  const shortName = limitUnicodeName(rawName, 30);
  const name = escapeHtml(shortName);
  const username = normalizeUsername(entry.userName);
  const href = entry.userId ? `tg://user?id=${entry.userId}` : username ? `https://t.me/${username}` : null;
  return href ? `<a href="${escapeHtml(href)}">${name}</a>` : name;
}

function buildGroupLink(entry) {
  return escapeHtml(entry.groupName || entry.groupId);
}

export function formatGlobalUsersText(entries, mode = 'today', contextName = 'this chat') {
  const title = mode === 'total' ? 'Top 10 global users overall:' : mode === 'weekly' ? 'Top 10 global users this week:' : 'Top 10 global users today:';
  const totalLabel = mode === 'total' ? 'All-time total' : mode === 'weekly' ? 'Week total' : 'Today total';
  const lines = entries.map((entry, index) => {
    const nameLink = buildUserLink(entry);
    return `<b>${index + 1}.</b> <b>${nameLink}</b> — ${formatNumber(entry.value)}`;
  });

  const modeLabel = mode === 'total' ? 'Total' : mode === 'weekly' ? 'Weekly' : 'Today';

  return [
    '<b>ChatFight - Top Users</b>',
    escapeHtml(contextName),
    '',
    `<b>${title}</b>`,
    ...lines,
    '',
    `<b>${totalLabel}:</b> ${formatNumber(entries[0]?.totalValue || 0)}`,
  ].join('\n');
}

export function formatGlobalGroupsText(entries, mode = 'today', contextName = 'this chat') {
  const title = mode === 'total' ? 'Top 10 groups overall:' : mode === 'weekly' ? 'Top 10 groups this week:' : 'Top 10 groups today:';
  const totalLabel = mode === 'total' ? 'All-time total' : mode === 'weekly' ? 'Week total' : 'Today total';
  const lines = entries.map((entry, index) => {
    const nameLink = buildGroupLink(entry);
    return `<b>${index + 1}.</b> <b>${nameLink}</b> — ${formatNumber(entry.value)}`;
  });

  const modeLabel = mode === 'total' ? 'Total' : mode === 'weekly' ? 'Weekly' : 'Today';

  return [
    '<b>ChatFight - Top Groups</b>',
    escapeHtml(contextName),
    '',
    `<b>${title}</b>`,
    ...lines,
    '',
    `<b>${totalLabel}:</b> ${formatNumber(entries[0]?.totalValue || 0)}`,
  ].join('\n');
}

export function formatMyTopGroupsText(entries, displayName) {
  const name = escapeHtml(normalizeDisplayName(displayName));
  const lines = entries.map((entry, index) => {
    const groupName = escapeHtml(entry.groupName || entry.groupId);
    const groupLink = entry.groupLink ? `<a href="${escapeHtml(entry.groupLink)}">${groupName}</a>` : groupName;
    return `<b>${index + 1}.</b> ${groupName} — ${formatNumber(entry.messageCount || 0)}`; 
  });

  return [
    '<b>ChatFight - My Top Groups</b>',
    `<b>User:</b> ${name}`,
    '',
    ...lines,
  ].join('\n');
}
