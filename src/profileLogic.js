import { getTier } from './tierLogic.js';

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

export function formatProfileText(user, rank, totalUsers, contextName, stats = {}) {
  const nameLink = buildUserLink(user);
  const tier = getTier(user.messageCount || 0);
  const local = stats.local || {
    todayRank: null,
    weeklyRank: null,
  };
  const global = stats.global || {
    messageCount: user.messageCount || 0,
    dailyMessageCount: user.dailyMessageCount || 0,
    weeklyMessageCount: user.weeklyMessageCount || 0,
    rank: null,
    totalUsers: null,
    todayRank: null,
    weeklyRank: null,
  };
  const position = (value) => value ? `#${formatNumber(value)}` : '—';
  const lines = ['<b>👤 PROFILE</b>'];

  if (contextName) lines.push(`📍 <b>${escapeHtml(limitUnicodeName(cleanUnicode(contextName), 100))}</b>`);

  lines.push(
    '',
    `👤 <b>User:</b> ${nameLink}`,
    '',
    `💬 <b>Messages sent here:</b> ${formatNumber(user.messageCount || 0)} (today: ${formatNumber(user.dailyMessageCount || 0)}, this week: ${formatNumber(user.weeklyMessageCount || 0)})`,
    `🌐 <b>Messages sent globally:</b> ${formatNumber(global.messageCount || 0)} (today: ${formatNumber(global.dailyMessageCount || 0)}, this week: ${formatNumber(global.weeklyMessageCount || 0)})`,
    '',
    `📍 <b>Position here:</b> ${position(rank)} of ${formatNumber(totalUsers)} (today: ${position(local.todayRank)}, this week: ${position(local.weeklyRank)})`,
    `🌍 <b>Global position:</b> ${position(global.rank)}${global.totalUsers ? ` of ${formatNumber(global.totalUsers)}` : ''} (today: ${position(global.todayRank)}, this week: ${position(global.weeklyRank)})`,
    '',
    `${tier.medal} <b>${escapeHtml(tier.displayTitle)}</b>`,
    `🏆 <b>Highest league reached:</b> ${tier.medal} ${escapeHtml(tier.displayTitle)}`,
    tier.nextTitle
      ? `— ${formatNumber(tier.messagesRemaining)} messages to the next league (${formatNumber(tier.nextMessages)} total)`
      : '— Highest league reached',
  );

  return lines.join('\n');
}
