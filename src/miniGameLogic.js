import { Input } from 'telegraf';
import sharp from 'sharp';

const GAME_INTERVAL_MS = 60 * 60 * 1000;
const GAME_DURATION_MS = 10 * 60 * 1000;
const SEND_RETRY_MS = 60 * 1000;

const WORDS = [
  'RECEPTION','ADVENTURE','BEAUTIFUL','CHALLENGE','COMPUTER','DREAMER','ELEPHANT','FREEDOM',
  'HAPPINESS','JOURNEY','KNOWLEDGE','LANGUAGE','MYSTERY','MOUNTAIN','NOTEBOOK','PHOENIX',
  'RAINBOW','SUNSHINE','TREASURE','UNIVERSE','VICTORY','WONDERFUL','CAPTAIN','DIAMOND',
  'GALAXY','MIDNIGHT','PARADISE','THUNDER','WHISPER','DESTINY','CARNIVAL','KINGDOM',
  'MAGICIAN','OCEAN','PENGUIN','ROCKET','STARDUST','TORNADO','VELVET','WARRIOR',
];

function normalizeAnswer(value = '') {
  return String(value).trim().normalize('NFKC').toLowerCase();
}

function pointsForElapsedMs(elapsedMs) {
  const minute = Math.floor(elapsedMs / 60000);
  if (minute < 1) return 6;
  if (minute < 2) return 4;
  if (minute < 3) return 3;
  if (minute < 4) return 2;
  return 1;
}

function cleanUnicode(value = '') {
  return Array.from(String(value || ''))
    .filter((char) => {
      const codePoint = char.codePointAt(0);
      return codePoint < 0xD800 || codePoint > 0xDFFF;
    })
    .join('');
}

function escapeHtml(value = '') {
  return cleanUnicode(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function displayName(from) {
  return cleanUnicode([from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || `User ${from?.id || ''}`);
}

function userLink(from) {
  const name = escapeHtml(displayName(from));
  return `<a href="tg://user?id=${from.id}">${name}</a>`;
}

async function renderGameImage(word) {
  const safe = escapeHtml(word);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg width="1000" height="650" xmlns="http://www.w3.org/2000/svg">
    <rect width="1000" height="650" fill="#111827"/>
    <rect x="35" y="35" width="930" height="580" rx="38" fill="#1f2937" stroke="#374151" stroke-width="4"/>
    <text x="500" y="325" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="92" font-weight="800" fill="white" letter-spacing="8">${safe}</text>
    <text x="500" y="535" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" fill="#9ca3af">TYPE THE WORD</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function nextHourFrom(now) {
  return new Date(now.getTime() + GAME_INTERVAL_MS);
}

export function getMiniGameConfig() {
  return { intervalMs: GAME_INTERVAL_MS, durationMs: GAME_DURATION_MS };
}

export async function ensureMiniGameIndexes(db) {
  const games = db.collection('mini_game_groups');
  await games.createIndex({ groupId: 1 }, { unique: true });
  await games.createIndex({ nextGameAt: 1 });
  await games.createIndex({ 'activeRound.expiresAt': 1 });

  const scores = db.collection('mini_game_scores');
  await scores.createIndex({ groupId: 1, userId: 1 }, { unique: true });
  await scores.createIndex({ groupId: 1, points: -1 });
  await scores.createIndex({ userId: 1, points: -1 });
}

export async function registerMiniGameGroup(db, groupId, groupName, groupLink = null) {
  const games = db.collection('mini_game_groups');
  const now = new Date();
  await games.updateOne(
    { groupId },
    {
      $set: { groupName, groupLink, enabled: true, updatedAt: now },
      // A group should see its first game as soon as it is registered. The
      // hourly delay is only used after a round has started or expired.
      $setOnInsert: { groupId, nextGameAt: now, activeRound: null, createdAt: now },
    },
    { upsert: true },
  );
}

function chooseWord(previousWord = '') {
  const previous = normalizeAnswer(previousWord);
  const available = WORDS.filter((word) => normalizeAnswer(word) !== previous);
  const pool = available.length ? available : WORDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function startDueMiniGames({ db, telegram, logger = console }) {
  console.log("[MiniGame] startDueMiniGames() CALLED");
  
  const games = db.collection('mini_game_groups');
  const now = new Date();
  const due = await games
    .find({ enabled: { $ne: false }, nextGameAt: { $lte: now }, activeRound: null })
    .sort({ nextGameAt: 1 })
    .limit(50)
    .toArray();

  console.log(`[MiniGame] Due groups: ${due.length}`);

  for (const game of due) {
    const word = chooseWord(game.lastWord || '');
    const claimed = await games.findOneAndUpdate(
      { _id: game._id, activeRound: null, nextGameAt: { $lte: now } },
      { $set: { activeRound: { word, startedAt: now, expiresAt: new Date(now.getTime() + GAME_DURATION_MS) }, lastWord: word, nextGameAt: new Date(now.getTime() + GAME_INTERVAL_MS), updatedAt: now } },
      { returnDocument: 'after' },
    );
    if (!claimed?.activeRound) continue;

    const round = claimed.activeRound;
    try {
      const image = await renderGameImage(round.word);
      const caption = '⚡ Be the first to write the word shown in the photo to climb the mini-game leaderboard.\n\n⏱️ <b>Time remaining: 10 minutes</b>';
      await telegram.sendPhoto(claimed.groupId, Input.fromBuffer(image, 'chatfight-game.png'), {
        caption,
        parse_mode: 'HTML',
        has_spoiler: true,
      });
    } catch (error) {
      const description = error?.response?.description || error?.message || error;
      logger.error?.(`Mini-game send failed for ${claimed.groupId}; retrying in 60 seconds:`, description);
      await games.updateOne(
        { _id: claimed._id },
        {
          $set: {
            activeRound: null,
            nextGameAt: new Date(Date.now() + SEND_RETRY_MS),
            lastSendError: String(description),
            updatedAt: new Date(),
          },
        },
      );
    }
  }
}

export async function expireMiniGames(db) {
  const games = db.collection('mini_game_groups');
  const now = new Date();
  const expired = await games.find({ 'activeRound.expiresAt': { $lte: now } }).toArray();
  for (const game of expired) {
    const startedAt = new Date(game.activeRound.startedAt);
    await games.updateOne(
      { _id: game._id, 'activeRound.startedAt': game.activeRound.startedAt },
      {
        $set: {
          activeRound: null,
          // Keep the one-hour schedule measured from the game's start.
          nextGameAt: new Date(startedAt.getTime() + GAME_INTERVAL_MS),
          updatedAt: now,
        },
      },
    );
  }
}

export async function handleMiniGameAnswer({ db, ctx }) {
  const chat = ctx.chat;
  const message = ctx.message;
  if (!chat || chat.type === 'private' || !message?.text || !message.from) return false;

  const games = db.collection('mini_game_groups');
  const game = await games.findOne({ groupId: chat.id.toString(), activeRound: { $ne: null } });
  if (!game?.activeRound) return false;

  const now = new Date();
  const round = game.activeRound;
  const startedAt = new Date(round.startedAt);
  const expiresAt = new Date(round.expiresAt);

  if (now >= expiresAt) {
    await games.updateOne({ _id: game._id, 'activeRound.startedAt': round.startedAt }, { $set: { activeRound: null, nextGameAt: nextHourFrom(now), updatedAt: now } });
    return false;
  }

  if (normalizeAnswer(message.text) !== normalizeAnswer(round.word)) return false;

  const claimed = await games.findOneAndUpdate(
    { _id: game._id, 'activeRound.startedAt': round.startedAt },
    { $set: { activeRound: null, lastWinnerAt: now, updatedAt: now } },
    { returnDocument: 'before' },
  );
  if (!claimed?.activeRound) return true;

  const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
  const points = pointsForElapsedMs(elapsedMs);
  const scores = db.collection('mini_game_scores');
  const userId = message.from.id.toString();
  const groupId = chat.id.toString();
  const name = displayName(message.from);
  const username = message.from.username || '';

  await scores.updateOne(
    { groupId, userId },
    {
      $inc: { points, wins: 1 },
      $set: { displayName: name, username, updatedAt: now },
      $setOnInsert: { groupId, userId, createdAt: now },
    },
    { upsert: true },
  );

  const seconds = Math.floor(elapsedMs / 1000);
  await ctx.reply(
    `🏆 ${userLink(message.from)} was the fastest!\n\n` +
    `⚡ Answered in <b>${seconds}s</b>\n` +
    `🎯 Earned <b>${points} points</b>`,
    { parse_mode: 'HTML', reply_to_message_id: message.message_id },
  );
  return true;
}

export async function getMiniGameLeaderboard(db, groupId = null, limit = 10) {
  const scores = db.collection('mini_game_scores');

  // THIS CHAT:
  // Show only scores from the current group.
  // Each user has only one record in this group.
  if (groupId) {
    return scores
      .find({ groupId })
      .sort({ points: -1, wins: -1, displayName: 1 })
      .limit(limit)
      .toArray();
  }

  // GLOBAL:
  // Combine all group scores belonging to the same user.
  // Therefore one user appears only once.
  return scores.aggregate([
    {
      $group: {
        _id: '$userId',
        userId: { $first: '$userId' },
        points: { $sum: { $ifNull: ['$points', 0] } },
        wins: { $sum: { $ifNull: ['$wins', 0] } },
        displayName: { $first: '$displayName' },
        username: { $first: '$username' },
      },
    },
    {
      $sort: {
        points: -1,
        wins: -1,
        displayName: 1,
      },
    },
    {
      $limit: limit,
    },
  ]).toArray();
}

export function formatMiniGameLeaderboard(entries, scope = 'chat') {
  const title = scope === 'global' ? '🌍 GLOBAL MINI-GAME LEADERBOARD' : '💬 THIS CHAT MINI-GAME LEADERBOARD';
  if (!entries.length) return `<b>${title}</b>\n\nNo scores yet.`;
  const lines = entries.map((entry, index) => {
    const rawName = entry.displayName || entry.username || `User ${entry.userId}`;
    const cleanName = String(rawName).replace(/[\uD800-\uDFFF]/g, '')
    const shortName = cleanName.length > 30 ? `${cleanName.slice(0, 30)}...` : cleanName;
    const name = escapeHtml(shortName);
    const link = `<a href="tg://user?id=${entry.userId}">${name}</a>`;
    return `<b>${index + 1}.</b> ${link} — <b>${Number(entry.points || 0).toLocaleString('de-DE')}</b> pts`;
  });
  return [`<b>${title}</b>`, '', ...lines].join('\n');
}

export function miniGameLeaderboardKeyboard(selectedScope = 'chat') {
  const mark = (scope) => scope === selectedScope ? ' ✅' : '';
  return {
    inline_keyboard: [[
      { text: `💬 This Chat${mark('chat')}`, callback_data: 'minigame_lb:chat' },
      { text: `🌍 Global${mark('global')}`, callback_data: 'minigame_lb:global' },
    ]],
  };
}
