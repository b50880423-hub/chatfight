import sharp from 'sharp';

function cleanText(value = '') {
  return String(value ?? '')
    .replace(/[\uD800-\uDFFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function xml(value = '') {
  return cleanText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function shorten(value, max = 34) {
  const text = cleanText(value) || 'Unknown';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('de-DE');
}

const rankSymbols = ['🥇', '🥈', '🥉'];

export async function generateRankingImage(entries = [], options = {}) {
  const {
    title = 'CHATFIGHT RANKINGS',
    subtitle = '',
    nameKey = 'displayName',
    valueKey = 'value',
    valueSuffix = '',
  } = options;

  const rows = entries.slice(0, 10);
  const width = 1200;
  const height = 690;
  const rowStart = 170;
  const rowHeight = 47;

  const rowSvg = rows.map((entry, index) => {
    const y = rowStart + index * rowHeight;
    const rank = rankSymbols[index] || `${index + 1}.`;
    const name = shorten(entry[nameKey] || entry.userName || entry.username || entry.groupName || entry.groupId, 34);
    const value = `${formatNumber(entry[valueKey])}${valueSuffix}`;
    const fill = index < 3 ? '#ffffff' : '#e7e9f4';

    return `
      <text x="78" y="${y}" class="rank">${xml(rank)}</text>
      <text x="150" y="${y}" class="name">${xml(name)}</text>
      <text x="1115" y="${y}" text-anchor="end" class="value" fill="${fill}">${xml(value)}</text>
      <line x1="72" y1="${y + 16}" x2="1128" y2="${y + 16}" class="line" />
    `;
  }).join('');

  const empty = rows.length === 0
    ? '<text x="600" y="380" text-anchor="middle" class="empty">No data yet</text>'
    : '';

  const svg = `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#101426"/>
        <stop offset="55%" stop-color="#202750"/>
        <stop offset="100%" stop-color="#4a2d65"/>
      </linearGradient>
      <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#7c5cff"/>
        <stop offset="100%" stop-color="#e45cff"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="8" stdDeviation="12" flood-opacity="0.35"/>
      </filter>
      <style>
        .title { font: 800 42px 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; fill: #ffffff; }
        .subtitle { font: 500 20px 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; fill: #bfc5e8; }
        .rank { font: 700 25px 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; fill: #ffffff; }
        .name { font: 650 25px 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; fill: #ffffff; }
        .value { font: 750 25px 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; }
        .line { stroke: #ffffff; stroke-opacity: .10; stroke-width: 1; }
        .empty { font: 600 28px 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; fill: #c7cbe4; }
      </style>
    </defs>
    <rect width="1200" height="690" rx="34" fill="url(#bg)"/>
    <circle cx="1050" cy="60" r="180" fill="#ffffff" opacity=".04"/>
    <circle cx="100" cy="650" r="180" fill="#e45cff" opacity=".05"/>
    <rect x="48" y="38" width="1104" height="604" rx="26" fill="#0a0d18" opacity=".30" filter="url(#shadow)"/>
    <rect x="72" y="62" width="1056" height="6" rx="3" fill="url(#bar)"/>
    <text x="72" y="112" class="title">${xml(title)}</text>
    ${subtitle ? `<text x="72" y="143" class="subtitle">${xml(subtitle)}</text>` : ''}
    ${rowSvg}
    ${empty}
    <text x="1128" y="620" text-anchor="end" class="subtitle">TOP 10</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function generateProfileImage(user, rank, totalUsers, contextName = '') {
  const width = 1200;
  const height = 570;
  const name = shorten(user?.displayName || user?.userName || `User ${user?.userId || ''}`, 34);
  const group = shorten(contextName, 48);
  const total = formatNumber(user?.messageCount);
  const today = formatNumber(user?.dailyMessageCount);
  const weekly = formatNumber(user?.weeklyMessageCount);

  const svg = `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#101426"/>
        <stop offset="55%" stop-color="#202750"/>
        <stop offset="100%" stop-color="#4a2d65"/>
      </linearGradient>
      <style>
        .title { font: 800 42px 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; fill: #ffffff; }
        .name { font: 800 32px 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; fill: #ffffff; }
        .label { font: 600 19px 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; fill: #aeb5dc; }
        .value { font: 800 30px 'Noto Sans', 'DejaVu Sans', Arial, sans-serif; fill: #ffffff; }
      </style>
    </defs>
    <rect width="1200" height="570" rx="34" fill="url(#bg)"/>
    <circle cx="1080" cy="30" r="190" fill="#ffffff" opacity=".04"/>
    <text x="72" y="80" class="title">CHATFIGHT PROFILE</text>
    <text x="72" y="125" class="name">${xml(name)}</text>
    ${group ? `<text x="72" y="157" class="label">${xml(group)}</text>` : ''}

    <rect x="72" y="205" width="330" height="155" rx="24" fill="#ffffff" opacity=".08"/>
    <rect x="435" y="205" width="330" height="155" rx="24" fill="#ffffff" opacity=".08"/>
    <rect x="798" y="205" width="330" height="155" rx="24" fill="#ffffff" opacity=".08"/>

    <text x="98" y="245" class="label">TOTAL MESSAGES</text>
    <text x="98" y="310" class="value">${xml(total)}</text>

    <text x="461" y="245" class="label">TODAY</text>
    <text x="461" y="310" class="value">${xml(today)}</text>

    <text x="824" y="245" class="label">THIS WEEK</text>
    <text x="824" y="310" class="value">${xml(weekly)}</text>

    <text x="72" y="435" class="label">OVERALL RANK</text>
    <text x="72" y="490" class="value">#${xml(rank)} / ${xml(totalUsers)}</text>
    <text x="1128" y="490" text-anchor="end" class="label">CHATFIGHT</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
