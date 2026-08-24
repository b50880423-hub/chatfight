import { Input } from 'telegraf';
import sharp from 'sharp';

const GAME_INTERVAL_MS = 60 * 60 * 1000;
const GAME_DURATION_MS = 10 * 60 * 1000;
const SEND_RETRY_MS = 60 * 1000;

const GAME_THEMES = [
  { bg: '#0f172a', panel: '#1e293b', accent: '#38bdf8', glow: '#7dd3fc' },
  { bg: '#1a1025', panel: '#3b1f4a', accent: '#e879f9', glow: '#f0abfc' },
  { bg: '#081c15', panel: '#14532d', accent: '#4ade80', glow: '#86efac' },
  { bg: '#1c1917', panel: '#451a03', accent: '#fb923c', glow: '#fdba74' },
  { bg: '#172554', panel: '#1e3a8a', accent: '#818cf8', glow: '#c7d2fe' },
  { bg: '#2e1065', panel: '#581c87', accent: '#c084fc', glow: '#e9d5ff' },
];

const WORDS = [
  'RECEPTION','ADVENTURE','BEAUTIFUL','CHALLENGE','COMPUTER','DREAMER','ELEPHANT','FREEDOM',
  'HAPPINESS','JOURNEY','KNOWLEDGE','LANGUAGE','MYSTERY','MOUNTAIN','NOTEBOOK','PHOENIX',
  'RAINBOW','SUNSHINE','TREASURE','UNIVERSE','VICTORY','WONDERFUL','CAPTAIN','DIAMOND',
  'GALAXY','MIDNIGHT','PARADISE','THUNDER','WHISPER','DESTINY','CARNIVAL','KINGDOM',
  'MAGICIAN','OCEAN','PENGUIN','ROCKET','STARDUST','TORNADO','VELVET','WARRIOR',
];


const COUNTRIES = [
  { name: 'Spain', flag: '🇪🇸', code: 'es' }, { name: 'India', flag: '🇮🇳', code: 'in' },
  { name: 'Japan', flag: '🇯🇵', code: 'jp' }, { name: 'Brazil', flag: '🇧🇷', code: 'br' },
  { name: 'Canada', flag: '🇨🇦', code: 'ca' }, { name: 'Germany', flag: '🇩🇪', code: 'de' },
  { name: 'France', flag: '🇫🇷', code: 'fr' }, { name: 'Italy', flag: '🇮🇹', code: 'it' },
  { name: 'Australia', flag: '🇦🇺', code: 'au' }, { name: 'Mexico', flag: '🇲🇽', code: 'mx' },
  { name: 'Argentina', flag: '🇦🇷', code: 'ar' }, { name: 'South Korea', flag: '🇰🇷', code: 'kr' },
  { name: 'United Kingdom', flag: '🇬🇧', code: 'gb' }, { name: 'United States', flag: '🇺🇸', code: 'us' },
  { name: 'Portugal', flag: '🇵🇹', code: 'pt' }, { name: 'Thailand', flag: '🇹🇭', code: 'th' },
];

const EMOJI_GUESSES = [
  { clue: '🍎📱', answer: 'Apple' }, { clue: '🦁👑', answer: 'Lion King' },
  { clue: '🌍🌙', answer: 'Earth Moon' }, { clue: '🚗💨', answer: 'Racing' },
  { clue: '🔥🧊', answer: 'Fire and Ice' }, { clue: '🌧️☀️', answer: 'Rainbow' },
  { clue: '🐼🎋', answer: 'Panda' }, { clue: '🚀🌌', answer: 'Space' },
  { clue: '⚽🏆', answer: 'Football' }, { clue: '🎸🎵', answer: 'Music' },
  { clue: '👑💎', answer: 'Royalty' }, { clue: '🍕🇮🇹', answer: 'Italy' },
];

const EMOJI_OPTION_POOL = [...new Set(EMOJI_GUESSES.map((game) => game.answer))];

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildOptions(answer, pool, count) {
  const wrong = shuffle(pool.filter((item) => item !== answer)).slice(0, count - 1);
  return shuffle([answer, ...wrong]);
}

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

// Linux/Heroku does not reliably provide a color emoji font, so emoji can
// appear as empty boxes when Sharp renders SVG text. Use real PNG assets for
// both country flags and emoji clues instead of depending on server fonts.
const flagImageCache = new Map();
const emojiImageCache = new Map();

async function fetchImage(url, cache, cacheKey) {
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
    const image = Buffer.from(await response.arrayBuffer());
    cache.set(cacheKey, image);
    return image;
  } catch (error) {
    console.warn(`[MiniGame] Could not load image ${cacheKey}:`, error?.message || error);
    return null;
  }
}

async function getFlagImage(countryCode) {
  const code = String(countryCode || '').toLowerCase();
  if (!code) return null;
  return fetchImage(`https://flagcdn.com/w320/${code}.png`, flagImageCache, code);
}

function splitEmojiGraphemes(value = '') {
  if (typeof Intl?.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(String(value))]
      .map((item) => item.segment)
      .filter(Boolean);
  }
  return Array.from(String(value));
}

function emojiCodepointName(emoji) {
  // Twemoji filenames omit variation selectors but preserve ZWJ sequences.
  return Array.from(String(emoji))
    .map((char) => char.codePointAt(0).toString(16))
    .filter((code) => code !== 'fe0f')
    .join('-');
}

async function getEmojiImage(emoji) {
  const code = emojiCodepointName(emoji);
  if (!code) return null;
  return fetchImage(
    `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.1.2/72x72/${code}.png`,
    emojiImageCache,
    code,
  );
}

async function renderGameImage(clue, type = 'word', flagCode = '') {
  const safe = escapeHtml(clue);
  const instruction = type === 'flag' ? 'GUESS THE COUNTRY' : type === 'emoji' ? 'GUESS THE EMOJIS' : 'TYPE THE WORD';
  const theme = GAME_THEMES[Math.floor(Math.random() * GAME_THEMES.length)];
  const clueMarkup = (type === 'flag' || type === 'emoji')
    ? ''
    : `<text x="500" y="330" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="92" font-weight="900" fill="white" letter-spacing="8" filter="url(#glow)">${safe}</text>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg width="1000" height="650" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="50%" cy="35%" r="80%"><stop offset="0%" stop-color="${theme.panel}"/><stop offset="100%" stop-color="${theme.bg}"/></radialGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="12" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="1000" height="650" rx="42" fill="url(#bg)"/>
    <circle cx="110" cy="90" r="70" fill="${theme.accent}" opacity="0.12"/>
    <circle cx="900" cy="560" r="110" fill="${theme.glow}" opacity="0.10"/>
    <rect x="35" y="35" width="930" height="580" rx="38" fill="none" stroke="${theme.accent}" stroke-width="3" opacity="0.8"/>
    <text x="500" y="105" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="${theme.glow}" letter-spacing="6">CHATFIGHT • MINI GAME</text>
    ${clueMarkup}
    <text x="500" y="535" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="${theme.glow}" letter-spacing="3">${instruction}</text>
  </svg>`;

  const base = sharp(Buffer.from(svg)).png();
  if (type === 'word') return base.toBuffer();

  if (type === 'flag') {
    const flagImage = await getFlagImage(flagCode);
    if (!flagImage) {
      // Last-resort fallback if the image host is unavailable.
      return sharp(Buffer.from(svg.replace(clueMarkup, `<text x="500" y="330" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="92" font-weight="900" fill="white">${safe}</text>`))).png().toBuffer();
    }

    const resizedFlag = await sharp(flagImage)
      .resize({ width: 300, height: 210, fit: 'contain', withoutEnlargement: true })
      .png()
      .toBuffer();

    return base.composite([{ input: resizedFlag, left: 350, top: 220 }]).png().toBuffer();
  }

  const emojiParts = splitEmojiGraphemes(clue);
  const emojiImages = await Promise.all(emojiParts.map((emoji) => getEmojiImage(emoji)));
  const validImages = emojiImages.filter(Boolean);

  if (!validImages.length) {
    return sharp(Buffer.from(svg.replace(clueMarkup, `<text x="500" y="330" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="92" font-weight="900" fill="white">${safe}</text>`))).png().toBuffer();
  }

  const size = Math.min(150, Math.max(90, Math.floor(520 / validImages.length)));
  const gap = 28;
  const totalWidth = validImages.length * size + (validImages.length - 1) * gap;
  let left = Math.round((1000 - totalWidth) / 2);
  const composites = [];

  for (const image of validImages) {
    const resized = await sharp(image).resize({ width: size, height: size, fit: 'contain' }).png().toBuffer();
    composites.push({ input: resized, left, top: Math.round(330 - size / 2) });
    left += size + gap;
  }

  return base.composite(composites).png().toBuffer();
}

function nextExactHour(now = new Date()) {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

function nextHourFrom(now) {
  // Keep every round aligned to an exact clock hour (HH:00), not one hour
  // from the moment the bot happened to start.
  return nextExactHour(now);
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
      $setOnInsert: { groupId, nextGameAt: nextExactHour(now), activeRound: null, createdAt: now },
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

function chooseRound(previousRound = null) {
  const previousType = previousRound?.type || '';
  const types = ['word', 'flag', 'emoji'];
  // Use a guaranteed rotation so every game type appears regularly.
  // This avoids several Word games appearing while the random generator is unlucky.
  const previousIndex = types.indexOf(previousType);
  const type = types[(previousIndex + 1 + types.length) % types.length];

  if (type === 'flag') {
    const country = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
    return {
      type,
      clue: country.flag,
      answer: country.name,
      flagCode: country.code,
      options: buildOptions(country.name, COUNTRIES.map((item) => item.name), 4),
    };
  }

  if (type === 'emoji') {
    const game = EMOJI_GUESSES[Math.floor(Math.random() * EMOJI_GUESSES.length)];
    return {
      type,
      clue: game.clue,
      answer: game.answer,
      options: buildOptions(game.answer, EMOJI_OPTION_POOL, 9),
    };
  }

  const word = chooseWord(previousRound?.answer || '');
  return { type: 'word', clue: word, answer: word, options: [] };
}

function miniGameKeyboard(round) {
  if (round.type === 'flag') {
    return {
      inline_keyboard: [
        round.options.slice(0, 2).map((text, index) => ({ text, callback_data: `mg:${new Date(round.startedAt).getTime().toString(36)}:${index}` })),
        round.options.slice(2, 4).map((text, index) => ({ text, callback_data: `mg:${new Date(round.startedAt).getTime().toString(36)}:${index + 2}` })),
      ],
    };
  }

  if (round.type === 'emoji') {
    return {
      inline_keyboard: [0, 1, 2].map((row) => round.options.slice(row * 3, row * 3 + 3).map((text, column) => ({
        text,
        callback_data: `mg:${new Date(round.startedAt).getTime().toString(36)}:${row * 3 + column}`,
      }))),
    };
  }

  return undefined;
}

function roundCaption(round) {
  if (round.type === 'flag') {
    return `🌍 <b>GUESS THE COUNTRY FROM ITS FLAG AND SELECT THE CORRECT OPTION!</b>

⏱️ <b>Time remaining: 10 minutes</b>`;
  }
  if (round.type === 'emoji') {
    return `🤔 <b>GUESS THE ANSWER FROM THE EMOJIS AND SELECT THE CORRECT OPTION!</b>

⏱️ <b>Time remaining: 10 minutes</b>`;
  }
  return `⚡ Be the first to write the word shown in the photo to climb the mini-game leaderboard.

⏱️ <b>Time remaining: 10 minutes</b>`;
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
    const chosen = chooseRound(game.lastRound || null);
    const round = {
      ...chosen,
      startedAt: now,
      expiresAt: new Date(now.getTime() + GAME_DURATION_MS),
    };
    const claimed = await games.findOneAndUpdate(
      { _id: game._id, activeRound: null, nextGameAt: { $lte: now } },
      { $set: { activeRound: round, lastRound: { type: round.type, answer: round.answer }, nextGameAt: nextExactHour(now), updatedAt: now } },
      { returnDocument: 'after' },
    );
    if (!claimed?.activeRound) continue;

    const activeRound = claimed.activeRound;
    const caption = roundCaption(activeRound);
    try {
      const image = await renderGameImage(
        activeRound.clue || activeRound.answer,
        activeRound.type || 'word',
        activeRound.flagCode || '',
      );
      await telegram.sendPhoto(claimed.groupId, Input.fromBuffer(image, 'chatfight-game.png'), {
        caption,
        parse_mode: 'HTML',
        reply_markup: miniGameKeyboard(activeRound),
        has_spoiler: true,
      });
    } catch (error) {
      const description = error?.response?.description || error?.message || error;
      const descriptionText = String(description);

      // If the bot is not allowed to send photos, keep the mini-game alive
      // by sending the same round as text instead of retrying forever.
      if (descriptionText.toLowerCase().includes('not enough rights to send photos')) {
        try {
          await telegram.sendMessage(claimed.groupId, `${caption}\n\n<b>${escapeHtml(activeRound.clue || activeRound.answer)}</b>`, { parse_mode: 'HTML', reply_markup: miniGameKeyboard(activeRound) });
          await games.updateOne(
            { _id: claimed._id },
            { $set: { lastSendError: null } },
          );
          logger.warn?.(`Mini-game photo permission missing for ${claimed.groupId}; sent text fallback.`);
          continue;
        } catch (fallbackError) {
          const fallbackDescription = fallbackError?.response?.description || fallbackError?.message || fallbackError;
          logger.error?.(`Mini-game text fallback failed for ${claimed.groupId}; retrying in 60 seconds:`, fallbackDescription);
        }
      }

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

  // Typed answers are only for the original word game. Flag and emoji games
  // are answered through their inline buttons.
  if (round.type && round.type !== 'word') return false;
  if (normalizeAnswer(message.text) !== normalizeAnswer(round.answer || round.word)) return false;

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

  // Automatically react to the FIRST correct answer message.
  // The atomic database claim above guarantees only the first correct
  // answer reaches this point, so later correct answers cannot receive it.
  try {
    await ctx.telegram.callApi('setMessageReaction', {
      chat_id: chat.id,
      message_id: message.message_id,
      reaction: [{
              type: 'emoji',
              emoji: ['👀', '⚡️', '🌝', '🥰', '😘', '💘'][
                Math.floor(Math.random() * 6)
              ],
            }],
    });
  } catch (reactionError) {
    console.warn(
      '[MiniGame] Could not react to winner message:',
      reactionError?.description || reactionError?.message || reactionError,
    );
  }

  const seconds = Math.floor(elapsedMs / 1000);
  await ctx.reply(
    `🏆 ${userLink(message.from)} was the fastest!\n\n` +
    `⚡ Answered in <b>${seconds}s</b>\n` +
    `🎯 Earned <b>${points} points</b>`,
    { parse_mode: 'HTML', reply_to_message_id: message.message_id },
  );
  return true;
}


export async function handleMiniGameButtonAnswer({ db, ctx }) {
  const chat = ctx.chat;
  const callback = ctx.callbackQuery;
  if (!chat || chat.type === 'private' || !callback?.data || !ctx.from) return false;

  const match = /^mg:([0-9a-z]+):(\d+)$/.exec(callback.data);
  if (!match) return false;

  const startedAtMs = parseInt(match[1], 36);
  const optionIndex = Number(match[2]);
  if (!Number.isFinite(startedAtMs) || !Number.isInteger(optionIndex)) return false;

  const games = db.collection('mini_game_groups');
  const game = await games.findOne({ groupId: chat.id.toString(), activeRound: { $ne: null } });
  const round = game?.activeRound;
  if (!round || new Date(round.startedAt).getTime() !== startedAtMs) return false;

  const now = new Date();
  if (now >= new Date(round.expiresAt)) return false;
  if (!Array.isArray(round.options) || optionIndex < 0 || optionIndex >= round.options.length) return false;

  const selected = round.options[optionIndex];
  if (normalizeAnswer(selected) !== normalizeAnswer(round.answer)) {
    try { await ctx.answerCbQuery('❌ Wrong answer, try again!'); } catch {}
    return true;
  }

  const claimed = await games.findOneAndUpdate(
    { _id: game._id, 'activeRound.startedAt': round.startedAt },
    { $set: { activeRound: null, lastWinnerAt: now, updatedAt: now } },
    { returnDocument: 'before' },
  );
  if (!claimed?.activeRound) return true;

  const elapsedMs = Math.max(0, now.getTime() - new Date(round.startedAt).getTime());
  const points = pointsForElapsedMs(elapsedMs);
  const scores = db.collection('mini_game_scores');
  const userId = ctx.from.id.toString();
  const groupId = chat.id.toString();
  const name = displayName(ctx.from);
  const username = ctx.from.username || '';

  await scores.updateOne(
    { groupId, userId },
    {
      $inc: { points, wins: 1 },
      $set: { displayName: name, username, updatedAt: now },
      $setOnInsert: { groupId, userId, createdAt: now },
    },
    { upsert: true },
  );

  try { await ctx.answerCbQuery('🏆 Correct! You were the fastest!'); } catch {}
  const seconds = Math.floor(elapsedMs / 1000);
  await ctx.reply(
    `🏆 ${userLink(ctx.from)} was the fastest!\n\n` +
    `⚡ Answered in <b>${seconds}s</b>\n` +
    `🎯 Earned <b>${points} points</b>`,
    { parse_mode: 'HTML' },
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
    // Mini-game leaderboard text uses Telegram usernames instead of display names.
    // Fall back to the display name when the user has no Telegram username.
    const username = String(entry.username || '').trim().replace(/^@+/, '');
    const rawName = username ? `@${username}` : (entry.displayName || `User ${entry.userId}`);
    const cleanName = String(rawName).replace(/[\uD800-\uDFFF]/g, '');
    const shortName = Array.from(cleanName).length > 30 ? `${Array.from(cleanName).slice(0, 30).join('')}...` : cleanName;
    const formattedPoints = Math.trunc(Number(entry.points || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const name = escapeHtml(shortName);
    const link = `<a href="tg://user?id=${entry.userId}">${name}</a>`;
    return `<b>${index + 1}.</b> ${link} — <b>${formattedPoints}</b> pts`;
  });
  return [`<b>${title}</b>`, '', ...lines].join('\n');
}

export function miniGameLeaderboardKeyboard(activeScope = null) {
  return {
    inline_keyboard: [[
      { text: `💬 This Chat${activeScope === 'chat' ? ' ✓' : ''}`, callback_data: 'minigame_lb:chat' },
      { text: `🌍 Global${activeScope === 'global' ? ' ✓' : ''}`, callback_data: 'minigame_lb:global' },
    ]],
  };
}
