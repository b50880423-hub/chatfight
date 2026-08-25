import 'dotenv/config';
import { Telegraf, Input } from 'telegraf';
import { MongoClient } from 'mongodb';
import {
  formatRankingText,
  getUserUpdateForMessage,
  getWeekKey,
  getISTDayKey,
} from './rankingLogic.js';
import { formatProfileText } from './profileLogic.js';
import { generateRankingImage, generateProfileImage } from './rankingImage.js';
import { formatGlobalUsersText, formatGlobalGroupsText, formatMyTopGroupsText } from './globalLogic.js';
import {
  RULE_5_MESSAGE_GAP_MS,
  RULE_5_MESSAGE_LIMIT,
  getNextSpamCount,
  getRule5BlockUntil,
  isCountableHumanMessage,
} from './antiSpamLogic.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanUnicode(value = '') {
  // Remove only invalid/unpaired UTF-16 surrogates. Keep valid Unicode
  // surrogate pairs used by emoji and many fancy Unicode name characters.
  return Array.from(String(value ?? ''))
    .filter((char) => {
      const codePoint = char.codePointAt(0);
      return codePoint < 0xD800 || codePoint > 0xDFFF;
    })
    .join('');
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
import { buildLoggerMessage, getLoggerChatId } from './logger.js';
import { createHealthServer } from './health.js';
import {
  ensureMiniGameIndexes,
  registerMiniGameGroup,
  startDueMiniGames,
  expireMiniGames,
  handleMiniGameAnswer,
  handleMiniGameButtonAnswer,
  getMiniGameLeaderboard,
  formatMiniGameLeaderboard,
  miniGameLeaderboardKeyboard,
} from './miniGameLogic.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const mongoUri = process.env.MONGODB_URI || (process.env.NODE_ENV === 'development' ? 'mongodb://127.0.0.1:27017' : null);
const dbName = process.env.MONGODB_DB_NAME || 'chatfight';
const loggerChatId = getLoggerChatId(process.env);
const publicGroupLink = process.env.PUBLIC_GROUP_LINK || '';
const supportChatLink = process.env.SUPPORT_CHAT_LINK || process.env.PUBLIC_GROUP_LINK || '';

function addTickToKeyboard(keyboard, activeCallback) {
  if (!keyboard?.inline_keyboard || !activeCallback) return keyboard;
  return {
    ...keyboard,
    inline_keyboard: keyboard.inline_keyboard.map(row => row.map(button =>
      button.callback_data === activeCallback
        ? { ...button, text: button.text.replace(/ ✓$/, '') + ' ✓' }
        : { ...button, text: button.text.replace(/ ✓$/, '') }
    )),
  };
}
const ownerIds = (process.env.OWNER_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

if (!mongoUri) {
  console.error('MONGODB_URI is required in production to preserve rankings across deploys.');
  process.exit(1);
}

const bot = new Telegraf(token);

// Telegram callback queries expire quickly. Answering an old callback can
// throw a 400 error and otherwise make the update look like an unhandled
// bot failure, so all callback handlers use this safe wrapper.
async function safeAnswerCbQuery(ctx, text) {
  try {
    return await ctx.answerCbQuery(text);
  } catch (error) {
    const description = error?.response?.description || error?.message || '';
    if (String(description).toLowerCase().includes('query is too old') ||
        String(description).toLowerCase().includes('query id is invalid') ||
        String(description).toLowerCase().includes('response timeout expired')) {
      console.warn('[Callback] Expired/invalid callback query ignored:', description);
      return null;
    }
    throw error;
  }
}
const client = new MongoClient(mongoUri);
let db;

async function connectDb() {
  if (!db) {
    await client.connect();
    db = client.db(dbName);
  }
  return db;
}

async function ensureIndexes() {
  const database = await connectDb();
  const users = database.collection('group_users');
  await users.createIndex({ groupId: 1, userId: 1 }, { unique: true });
  await users.createIndex({ groupId: 1, messageCount: -1 });
  await users.createIndex({ groupId: 1, dayKey: 1 });

  const statuses = database.collection('user_status');
  await statuses.createIndex({ userId: 1, groupId: 1 }, { unique: true });
  await statuses.createIndex({ userId: 1, banUntil: 1 });

  const groupStats = database.collection('group_stats');
  await groupStats.createIndex({ groupId: 1 }, { unique: true });
  await ensureMiniGameIndexes(database);
}

const BAN_OPTIONS = {
  '1d': { label: '1 day', days: 1 },
  '2d': { label: '2 days', days: 2 },
  '3d': { label: '3 days', days: 3 },
  '10d': { label: '10 days', days: 10 },
  '20d': { label: '20 days', days: 20 },
  '1m': { label: '1 month', days: 30 },
  '3m': { label: '3 months', days: 90 },
  '1y': { label: '1 year', days: 365 },
  perm: { label: 'Permanent', days: null },
  ignore: { label: 'Ignore', days: 0 },
};

function getBanDurationLabel(key) {
  return BAN_OPTIONS[key]?.label || 'custom';
}

function getBanUntil(key) {
  const option = BAN_OPTIONS[key];
  if (!option) return null;
  return option.days === null ? null : new Date(Date.now() + option.days * 24 * 60 * 60 * 1000);
}

function formatRemainingTime(date) {
  if (!date) return 'unknown duration';
  const remainingMs = new Date(date).valueOf() - Date.now();
  if (remainingMs <= 0) return 'expired';
  const minutes = Math.floor(remainingMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} day(s)`;
  if (hours > 0) return `${hours} hour(s)`;
  return `${minutes} minute(s)`;
}

async function getUserStatus(userId, groupId = null) {
  const database = await connectDb();
  const statuses = database.collection('user_status');
  const now = new Date();

  if (groupId) {
    // Expired rule-5 blocks are removed on the first request after the timer
    // ends. This survives bot restarts and makes the unblock persistent.
    await statuses.updateOne(
      { userId, groupId, blockedUntil: { $exists: true, $lte: now } },
      {
        $unset: { blockedUntil: '', spamCount: '', lastMessageAt: '' },
        $set: { updatedAt: now },
      },
    );
    await statuses.updateOne(
      { userId, groupId: 'global', blockedUntil: { $exists: true, $lte: now } },
      {
        $unset: { blockedUntil: '', spamCount: '', lastMessageAt: '' },
        $set: { updatedAt: now },
      },
    );

    const [groupStatus, globalStatus] = await Promise.all([
      statuses.findOne({ userId, groupId }),
      statuses.findOne({ userId, groupId: 'global' }),
    ]);
    return { groupStatus, globalStatus };
  }

  const globalStatus = await statuses.findOne({ userId, groupId: 'global' });
  return { groupStatus: null, globalStatus };
}

async function findAnyActiveGroupBlock(userId) {
  const database = await connectDb();
  const statuses = database.collection('user_status');
  return statuses.findOne({
    userId,
    groupId: { $ne: 'global' },
    blockedUntil: { $gt: new Date() },
  });
}

async function updateUserStatus(userId, groupId, update) {
  const database = await connectDb();
  const statuses = database.collection('user_status');
  const now = new Date();
  await statuses.updateOne(
    { userId, groupId },
    {
      $set: { ...update, updatedAt: now },
      $setOnInsert: { createdAt: now, userId, groupId },
    },
    { upsert: true },
  );
  return statuses.findOne({ userId, groupId });
}

function isActiveDate(value) {
  return value && new Date(value) > new Date();
}

function buildBlockMessage(displayName, blockedUntil) {
  const safeName = escapeHtml(displayName || 'This user');
  return [
    `<b>ChatFight - Rule Violation</b>`,
    '',
    `<b>${safeName}</b> has been blocked from ChatFight for <b>20 minutes</b> for breaking ChatFight rules.`,
    `Block time remaining: <b>${formatRemainingTime(blockedUntil)}</b>.`,
    'During this time, the user cannot use ChatFight commands or earn ranking points.',
  ].join('\n');
}

async function getTelegramProfilePhoto(userId) {
  try {
    const photos = await bot.telegram.getUserProfilePhotos(Number(userId), 0, 1);
    const sizes = photos?.photos?.[0];
    if (!sizes?.length) return null;
    // Telegram returns the same profile photo in several sizes. Use the largest.
    return sizes[sizes.length - 1]?.file_id || null;
  } catch (error) {
    console.warn('[Profile] Unable to load Telegram profile photo:', error?.message || error);
    return null;
  }
}

function buildBanMessage(displayName, banUntil, banReason) {
  const untilText = banUntil ? `until <b>${new Date(banUntil).toLocaleString()}</b>` : '<b>permanently</b>';
  return [
    `<b>ChatFight - Banned</b>`,
    '',
    `You are banned from the bot ${untilText}.`,
    `Reason: ${escapeHtml(banReason || 'rule violation')}`,
    'This ban means you cannot use commands or earn ranking points until the ban expires.',
  ].join('\n');
}

async function sendUserNotification(userId, text) {
  try {
    await bot.telegram.sendMessage(userId, text, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Failed to notify user', userId, error.message || error);
  }
}

async function banUser(userId, durationKey, reason) {
  const banUntil = getBanUntil(durationKey);
  const durationLabel = getBanDurationLabel(durationKey);
  const status = await updateUserStatus(userId, 'global', {
    banUntil,
    banReason: reason,
    banLabel: durationLabel,
  });

  if (!status) return null;
  if (BAN_OPTIONS[durationKey]?.days === null || BAN_OPTIONS[durationKey]?.days >= 30) {
    await resetUserRankings(userId);
  }

  await sendUserNotification(userId, buildBanMessage(status.userId || userId, banUntil, reason));

  if (BAN_OPTIONS[durationKey]?.days === null || BAN_OPTIONS[durationKey]?.days >= 30) {
    await sendLoggerMessage(`🚫 User banned for ${durationLabel}\nUser ID: ${userId}\nReason: ${reason}`);
  }

  return status;
}

async function unbanUser(userId) {
  const database = await connectDb();
  const statuses = database.collection('user_status');
  await statuses.updateOne(
    { userId, groupId: 'global' },
    { $unset: { banUntil: '', banReason: '', banLabel: '' }, $currentDate: { updatedAt: true } },
  );
}

async function resetUserRankings(userId) {
  const database = await connectDb();
  const users = database.collection('group_users');
  await users.updateMany(
    { userId },
    { $set: { messageCount: 0, dailyMessageCount: 0, weeklyMessageCount: 0 } },
  );
}

function buildBanKeyboard(userId) {
  return {
    inline_keyboard: [
      [
        { text: '1 day', callback_data: `banuser:${userId}:1d` },
        { text: '2 days', callback_data: `banuser:${userId}:2d` },
        { text: '3 days', callback_data: `banuser:${userId}:3d` },
      ],
      [
        { text: '10 days', callback_data: `banuser:${userId}:10d` },
        { text: '20 days', callback_data: `banuser:${userId}:20d` },
        { text: '1 month', callback_data: `banuser:${userId}:1m` },
      ],
      [
        { text: '3 months', callback_data: `banuser:${userId}:3m` },
        { text: '1 year', callback_data: `banuser:${userId}:1y` },
        { text: 'Permanent', callback_data: `banuser:${userId}:perm` },
      ],
      [
        { text: 'Ignore', callback_data: `banuser:${userId}:ignore` },
      ],
    ],
  };
}

async function recordGroupMilestone(groupId, ctx) {
  const database = await connectDb();
  const users = database.collection('group_users');

  const now = new Date();
  const dayKey = getISTDayKey(now);

  const result = await users.aggregate([
    {
      $match: {
        groupId,
        dayKey,
      },
    },
    {
      $group: {
        _id: null,
        todayTotal: {
          $sum: { $ifNull: ['$dailyMessageCount', 0] },
        },
      },
    },
  ]).toArray();

  const todayTotal = result[0]?.todayTotal || 0;

  // Daily milestones: 500, 1000, 1500, 2000, 2500...
  if (todayTotal > 0 && todayTotal % 500 === 0) {
    const groupName =
      ctx.chat?.title ||
      ctx.chat?.username ||
      'this group';

    await ctx.reply(
      `🎉 <b>${groupName}</b>\n\n` +
      `🔥 <b>${todayTotal.toLocaleString()}</b> messages reached today!\n` +
      `📊 Keep the chat going!`,
      { parse_mode: 'HTML' }
    );
  }
}

async function checkSpamAndCount(ctx) {
  const message = ctx.message;
  if (!isCountableHumanMessage(message)) return;

  const groupId = ctx.chat.id.toString();
  const userId = message.from?.id?.toString();
  const rawName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ');
  const usernameValue = message.from?.username || '';
  const displayName = normalizeDisplayName(rawName || usernameValue || 'Unknown');
  const userName = normalizeUsername(usernameValue);
  const groupName = ctx.chat?.title || ctx.chat?.username || `Group ${groupId}`;
  const groupLink = ctx.chat?.username ? `https://t.me/${ctx.chat.username}` : null;

  const { groupStatus } = await getUserStatus(userId, groupId);
  if (isActiveDate(groupStatus?.blockedUntil)) return;

  const database = await connectDb();
  const statuses = database.collection('user_status');
  const now = new Date();
  const threshold = new Date(now.valueOf() - RULE_5_MESSAGE_GAP_MS);

  // Atomically update lastMessageAt and spamCount based on the previous
  // message. The active-block filter prevents a concurrent message from
  // earning points after another message has triggered the block.
  const activeBlockExpression = { $gt: ['$blockedUntil', now] };
  const updatePipeline = [
    {
      $set: {
        lastMessageAt: { $cond: [activeBlockExpression, '$lastMessageAt', now] },
        spamCount: {
          $cond: [
            activeBlockExpression,
            { $ifNull: ['$spamCount', 0] },
            {
              $cond: [
                { $gt: ['$lastMessageAt', threshold] },
                { $add: [{ $ifNull: ['$spamCount', 0] }, 1] },
                1,
              ],
            },
          ],
        },
        updatedAt: { $cond: [activeBlockExpression, '$updatedAt', now] },
        createdAt: { $ifNull: ['$createdAt', now] },
        userId: userId,
        groupId: groupId,
      },
    },
  ];

  const res = await statuses.findOneAndUpdate(
    { userId, groupId },
    updatePipeline,
    { upsert: true, returnDocument: 'after' },
  );

  const newStatus = res || {};
  if (isActiveDate(newStatus.blockedUntil)) return;

  const spamCount = newStatus.spamCount || 0;
  console.log(`[Rule 5] ${userId} message count: ${spamCount}/${RULE_5_MESSAGE_LIMIT}`);

  if (spamCount >= RULE_5_MESSAGE_LIMIT) {
    const blockedUntil = getRule5BlockUntil(now);
    const globalBlock = await applyRule5Block(userId, blockedUntil);
    if (!globalBlock) return;

    await statuses.updateOne(
      { userId, groupId },
      { $set: { spamCount: 0, lastMessageAt: now, updatedAt: new Date() } },
    );

    const blockText = buildBlockMessage(displayName, blockedUntil);
    await ctx.reply(blockText, { parse_mode: 'HTML' });
    await sendLoggerModerationMessage([
      '<b>ChatFight - Rule 5 moderation</b>',
      '',
      `User: ${escapeHtml(displayName)}`,
      `User ID: <code>${escapeHtml(userId)}</code>`,
      `Group: ${escapeHtml(groupName)}`,
      `Group ID: <code>${escapeHtml(groupId)}</code>`,
      'Reason: Rule 5 rapid messages',
      '',
      'The user was automatically blocked from the bot for 20 minutes. Choose a longer ban only if needed.',
    ].join('\n'), buildBanKeyboard(userId));
    await sendUserNotification(userId, buildBlockMessage(displayName, blockedUntil));
    return;
  }

  await getOrCreateUser(groupId, userId, displayName, userName, groupName, groupLink);
  await updateGroupStats(groupId, groupName, groupLink, ctx);
  await recordGroupMilestone(groupId, ctx);
}

async function applyRule5Block(userId, blockedUntil) {
  const database = await connectDb();
  const statuses = database.collection('user_status');
  const now = new Date();

  try {
    const result = await statuses.findOneAndUpdate(
      {
        userId,
        groupId: 'global',
        $or: [
          { blockedUntil: { $exists: false } },
          { blockedUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          blockedUntil,
          blockReason: 'rule-5-rapid-messages',
          updatedAt: now,
        },
        $inc: { blockCount: 1, violationCount: 1 },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    );

    return result;
  } catch (error) {
    // Two groups can trigger Rule 5 for the same user at the same time. If
    // another request created the unique global status first, the user is
    // already blocked and this request must not send a second notification.
    if (error?.code === 11000) return null;
    throw error;
  }
}

async function fetchGroupMemberCount(telegram, chatId) {
  const count = await telegram.callApi('getChatMemberCount', { chat_id: chatId });
  const numericCount = Number(count);
  if (!Number.isFinite(numericCount) || numericCount < 0) {
    throw new Error(`Invalid getChatMemberCount response: ${String(count)}`);
  }
  return numericCount;
}

async function updateGroupStats(groupId, groupName, groupLink, ctx) {
  const database = await connectDb();
  const stats = database.collection('group_stats');
  const now = new Date();
  const existing = await stats.findOne({ groupId });
  // Keep an existing count while Telegram is temporarily unavailable.
  let memberCount = existing?.memberCount ?? null;
  const lastChecked = existing?.memberCountCheckedAt ? new Date(existing.memberCountCheckedAt) : null;
  if (!lastChecked || now - lastChecked > 6 * 60 * 60 * 1000) {
    try {
      memberCount = await fetchGroupMemberCount(ctx.telegram, ctx.chat.id);
      console.log(`[Stats] ${groupId} member count updated: ${memberCount}`);
    } catch (error) {
      console.warn('[Stats] Could not read member count:', error.message || error);
    }
  }
  await stats.updateOne(
    { groupId },
    {
      $set: {
        groupId,
        groupName,
        groupLink,
        memberCount,
        // Mark the refresh time only after Telegram actually returned a count.
        memberCountCheckedAt: memberCount !== null ? now : existing?.memberCountCheckedAt || null,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}

async function getOrCreateUser(groupId, userId, displayName, userName, groupName, groupLink) {
  const database = await connectDb();
  const users = database.collection('group_users');
  const now = new Date();
  const existing = await users.findOne({ groupId, userId });
  const updatePlan = getUserUpdateForMessage(existing, groupId, userId, displayName, userName, groupName, groupLink, now);

  if (updatePlan.operation === 'insert') {
    await users.insertOne(updatePlan.doc);
    return users.findOne({ groupId, userId });
  }

  await users.updateOne({ groupId, userId }, updatePlan.update);
  return users.findOne({ groupId, userId });
}

async function getTopUsers(groupId, mode = 'today') {
  const database = await connectDb();
  const users = database.collection('group_users');
  const now = new Date();
  const dayKey = getISTDayKey(now);
  const weekKey = getWeekKey(now);

  let query = { groupId };
  let sortField = 'dailyMessageCount';
  let totalField = '$dailyMessageCount';

  if (mode === 'weekly') {
    query.weekKey = weekKey;
    sortField = 'weeklyMessageCount';
    totalField = '$weeklyMessageCount';
  } else if (mode === 'total') {
    sortField = 'messageCount';
    totalField = '$messageCount';
  } else {
    query.dayKey = dayKey;
  }

  const topUsers = await users.aggregate([
    { $match: query },
    { $sort: { [sortField]: -1, messageCount: -1 } },
    { $limit: 10 },
    { $project: { displayName: 1, userName: 1, userId: 1, messageCount: 1, dailyMessageCount: 1, weeklyMessageCount: 1 } },
  ]).toArray();

  const totalResult = await users.aggregate([
    { $match: query },
    { $group: { _id: null, total: { $sum: totalField } } },
  ]).toArray();

  return {
    topUsers,
    totalValue: totalResult[0]?.total || 0,
  };
}

async function getUserProfile(groupId, userId) {
  const database = await connectDb();
  const users = database.collection('group_users');
  const profile = await users.findOne({ groupId, userId });

  if (!profile) {
    return null;
  }

  const totalUsers = await users.countDocuments({ groupId });
  const rankedUsers = await users
    .find({ groupId })
    .sort({ messageCount: -1, dailyMessageCount: -1 })
    .toArray();

  const rank = rankedUsers.findIndex((user) => user.userId === profile.userId) + 1;

  return {
    profile,
    rank,
    totalUsers,
  };
}

async function getGlobalUsers(mode = 'today') {
  const database = await connectDb();
  const users = database.collection('group_users');
  const now = new Date();
  const dayKey = getISTDayKey(now);
  const weekKey = getWeekKey(now);

  let match = {};
  let sortField = 'dailyMessageCount';
  let valueField = '$dailyMessageCount';

  if (mode === 'weekly') {
    match = { weekKey };
    sortField = 'weeklyMessageCount';
    valueField = '$weeklyMessageCount';
  } else if (mode === 'total') {
    sortField = 'messageCount';
    valueField = '$messageCount';
  } else {
    match = { dayKey };
  }

  const entries = await users.aggregate([
    { $match: match },
    { $group: { _id: '$userId', userName: { $first: '$userName' }, displayName: { $first: '$displayName' }, value: { $sum: valueField } } },
    { $sort: { value: -1, displayName: 1, userName: 1 } },
    { $limit: 10 },
  ]).toArray();

  const totalResult = await users.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: valueField } } },
  ]).toArray();

  return entries.map((entry) => ({ ...entry, value: entry.value || 0, totalValue: totalResult[0]?.total || 0 }));
}

async function getGlobalGroups(mode = 'today') {
  const database = await connectDb();
  const users = database.collection('group_users');
  const now = new Date();
  const dayKey = getISTDayKey(now);
  const weekKey = getWeekKey(now);

  let match = {};
  let valueField = '$dailyMessageCount';

  if (mode === 'weekly') {
    match = { weekKey };
    valueField = '$weeklyMessageCount';
  } else if (mode === 'total') {
    valueField = '$messageCount';
  } else {
    match = { dayKey };
  }

  const entries = await users.aggregate([
    { $match: match },
    { $group: {
      _id: '$groupId',
      groupName: { $first: '$groupName' },
      groupLink: { $first: '$groupLink' },
      value: { $sum: valueField },
    } },
    { $sort: { value: -1, _id: 1 } },
    { $limit: 10 },
  ]).toArray();

  const totalResult = await users.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: valueField } } },
  ]).toArray();

  return entries.map((entry) => ({ ...entry, value: entry.value || 0, totalValue: totalResult[0]?.total || 0 }));
}

async function getUserTopGroups(userId) {
  const database = await connectDb();
  const users = database.collection('group_users');
  return users.aggregate([
    { $match: { userId } },
    { $sort: { messageCount: -1 } },
    { $project: { groupId: 1, groupName: 1, groupLink: 1, messageCount: 1 } },
  ]).toArray();
}

function isOwner(userId) {
  return ownerIds.includes(String(userId));
}

async function sendLoggerMessage(message) {
  if (!loggerChatId) return;
  try {
    await bot.telegram.sendMessage(loggerChatId, message);
  } catch (error) {
    console.error('Failed to send logger message', error);
  }
}

async function sendLoggerModerationMessage(message, replyMarkup) {
  if (!loggerChatId) return;
  try {
    await bot.telegram.sendMessage(loggerChatId, message, {
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  } catch (error) {
    console.error('Failed to send logger moderation message', error.message || error);
  }
}

async function sendWelcomeMessage(ctx, targetChatId = null, activeCallback = null) {
  const keyboardButtons = [
    [{ text: '➕ Add Me', url: `https://t.me/${ctx.botInfo?.username || 'ChatFightBot'}?startgroup=true` }],
  ];
  if (supportChatLink) {
    keyboardButtons[0].unshift({ text: '💬 Support Chat', url: supportChatLink });
  }

  const keyboard = { inline_keyboard: keyboardButtons };
  const message = [
    '📊 <b>Welcome to the ChatFight Arena!</b>',
    'I track every message sent in this chat to rank the most active users. Who will claim the #1 spot?',
    '',
    '⚡ <b>Quick Commands:</b>',
    '🏆 /rankings — View the top chatters',
    '👤 /profile — Check your message count &amp; rank',
    '',
    '<i>Start chatting now to climb the leaderboard!</i>',
  ].join('\n');

  if (targetChatId) {
    await ctx.telegram.sendMessage(targetChatId, message, { parse_mode: 'HTML', reply_markup: keyboard });
    return;
  }

  await ctx.reply(message, { parse_mode: 'HTML', reply_markup: keyboard });
}

bot.start(async (ctx) => {
  const payload = {
    userId: ctx.from?.id,
    userName: ctx.from?.username || ctx.from?.first_name || 'unknown',
  };
  const message = buildLoggerMessage('bot-started', payload);
  await sendLoggerMessage(message);

  if (ctx.chat?.type === 'private' && await maybeRejectUser(ctx)) {
    return;
  }

  await sendWelcomeMessage(ctx);
});

function buildRankingKeyboard(prefix = 'rankings', activeCallback = null) {
  const rows = [
      [{ text: '📈 Total', callback_data: `${prefix}:total` }],
      [
        { text: '📅 Today', callback_data: `${prefix}:today` },
        { text: '🗓️ Weekly', callback_data: `${prefix}:weekly` },
      ],
    ];
  if (process.env.WEBSITE_URL) rows.push([{ text: '🌐 Open Full Rankings Website', url: process.env.WEBSITE_URL }]);
  return addTickToKeyboard({ inline_keyboard: rows }, activeCallback);
}

async function sendPhotoThenText(ctx, imageBuffer, text, options = {}) {
  // When a ranking/profile button is pressed, UPDATE THE EXISTING MESSAGE
  // instead of deleting it and sending another message. This prevents a
  // new ranking message from appearing every time a button is clicked.
  const cleanText = cleanUnicode(text);
  const caption = `\n\n${cleanText}`;

  if (caption.length > 1024) {
    console.warn(`[Ranking] Photo caption is ${caption.length} characters; Telegram limit is 1024.`);
  }

  if (ctx.callbackQuery?.message) {
    const message = ctx.callbackQuery.message;

    // Ranking/profile callback came from an existing photo message.
    // Edit that same photo and its caption/buttons.
    if (message.photo?.length) {
      try {
        return await ctx.editMessageMedia(
          {
            type: 'photo',
            media: typeof imageBuffer === 'string' ? Input.fromFileId(imageBuffer) : { source: imageBuffer },
            caption,
            parse_mode: 'HTML',
          },
          options,
        );
      } catch (error) {
        const description = error?.response?.description || error?.message || '';
        const lower = String(description).toLowerCase();

        if (lower.includes('message is not modified')) {
          return null;
        }

        // If Telegram refuses the new media, keep the existing message and
        // at least update its caption/buttons when possible.
        if (
          lower.includes('not enough rights to send photos') ||
          lower.includes('not enough rights to send photo') ||
          lower.includes("can't send photos") ||
          lower.includes("can't send media")
        ) {
          console.warn('[Media] Photo permission missing; updating existing ranking caption instead:', description);
          try {
            return await ctx.editMessageCaption(caption, {
              parse_mode: 'HTML',
              ...options,
            });
          } catch (_) {
            return null;
          }
        }

        throw error;
      }
    }

    // The previous message may be a text fallback because photo sending was
    // unavailable. Do not create another message; edit the existing one.
    try {
      return await ctx.editMessageText(cleanText, {
        parse_mode: 'HTML',
        ...options,
      });
    } catch (error) {
      if (
        error?.response?.error_code === 400 &&
        error?.response?.description?.includes('message is not modified')
      ) {
        return null;
      }
      throw error;
    }
  }

  // Commands such as /rankings intentionally create a new message.
  try {
    return await ctx.replyWithPhoto(
      typeof imageBuffer === 'string' ? Input.fromFileId(imageBuffer) : { source: imageBuffer },
      {
        caption,
        parse_mode: 'HTML',
        ...options,
      },
    );
  } catch (error) {
    const description = error?.response?.description || error?.message || '';
    const lower = String(description).toLowerCase();

    if (
      lower.includes('not enough rights to send photos') ||
      lower.includes('not enough rights to send photo') ||
      lower.includes("can't send photos") ||
      lower.includes("can't send media")
    ) {
      console.warn('[Media] Photo permission missing; trying text fallback:', description);
      try {
        return await ctx.reply(cleanText, {
          parse_mode: 'HTML',
          ...options,
        });
      } catch (fallbackError) {
        const fallbackDescription = fallbackError?.response?.description || fallbackError?.message || '';
        const fallbackLower = String(fallbackDescription).toLowerCase();

        // If the bot is also forbidden from sending text, do NOT let the
        // Telegram error crash Node/Render and cause the same update to be
        // delivered again. The bot simply cannot reply in this chat.
        if (
          fallbackLower.includes('not enough rights to send text messages') ||
          fallbackLower.includes("can't send messages") ||
          fallbackLower.includes('not enough rights to send messages')
        ) {
          console.warn('[Telegram] Bot has no permission to send text messages in this chat:', fallbackDescription);
          return null;
        }

        throw fallbackError;
      }
    }

    throw error;
  }
}

async function sendOrEditMessage(ctx, text, options = {}) {
  text = cleanUnicode(text);
  
  if (ctx.callbackQuery?.message) {
    try {
      return await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...options,
      });
    } catch (error) {
      // Telegram returns this when the message is already identical.
      if (
        error?.response?.error_code === 400 &&
        error?.response?.description?.includes('message is not modified')
      ) {
        // Just answer the callback instead of treating it as a bot error.
        try {
          await safeAnswerCbQuery(ctx);
        } catch (_) {}

        return null;
      }

      throw error;
    }
  }

  return ctx.reply(text, {
    parse_mode: 'HTML',
    ...options,
  });
}

async function maybeRejectUser(ctx, groupId = null, notify = true) {
  const userId = ctx.from?.id?.toString();
  if (!userId) return false;

  let groupStatus = null;
  let globalStatus = null;

  if (groupId) {
    const status = await getUserStatus(userId, groupId);
    groupStatus = status.groupStatus;
    globalStatus = status.globalStatus;
  } else {
    globalStatus = await getUserStatus(userId).then((status) => status.globalStatus);
    groupStatus = await findAnyActiveGroupBlock(userId);
  }

  const now = new Date();
  const isGloballyBanned = globalStatus?.banUntil && new Date(globalStatus.banUntil) > now;
  const isGloballyBlocked = globalStatus?.blockedUntil && new Date(globalStatus.blockedUntil) > now;
  const isGroupBlocked = groupStatus?.blockedUntil && new Date(groupStatus.blockedUntil) > now;

  if (isGloballyBanned) {
    await ctx.reply(buildBanMessage(ctx.from?.first_name || ctx.from?.username || 'You', globalStatus.banUntil, globalStatus.banReason), { parse_mode: 'HTML' });
    return true;
  }

  if (isGloballyBlocked) {
    if (notify) {
      await ctx.reply(buildBlockMessage(ctx.from?.first_name || ctx.from?.username || 'You', globalStatus.blockedUntil), { parse_mode: 'HTML' });
    }
    return true;
  }

  if (isGroupBlocked) {
    if (notify) {
      await ctx.reply(buildBlockMessage(ctx.from?.first_name || ctx.from?.username || 'You', groupStatus.blockedUntil), { parse_mode: 'HTML' });
    }
    return true;
  }

  return false;
}

async function sendRankingReply(ctx, mode = 'today') {
  const groupId = ctx.chat.id.toString();
  const contextName = ctx.chat?.title || ctx.chat?.username || 'this chat';
  const { topUsers, totalValue } = await getTopUsers(groupId, mode);

  if (!topUsers.length) {
    await sendOrEditMessage(ctx, 'No activity yet in this group.', { reply_markup: buildRankingKeyboard('rankings', `rankings:${mode}`) });
    return;
  }

  const message = formatRankingText(topUsers, totalValue, mode, contextName);
  const metricKey = mode === 'total' ? 'messageCount' : mode === 'weekly' ? 'weeklyMessageCount' : 'dailyMessageCount';
  const imageBuffer = await generateRankingImage(topUsers, {
    title: 'CHATFIGHT RANKINGS',
    subtitle: `${contextName} • ${mode === 'total' ? 'ALL TIME' : mode === 'weekly' ? 'THIS WEEK' : 'TODAY'}`,
    valueKey: metricKey,
  });
  await sendPhotoThenText(ctx, imageBuffer, message, { reply_markup: buildRankingKeyboard('rankings', `rankings:${mode}`) });
}

bot.command('leaderboard', async (ctx) => {
  const groupId = ctx.chat?.type === 'private' ? null : ctx.chat?.id?.toString();
  if (!groupId) {
    await ctx.reply('Use /leaderboard in a group.');
    return;
  }
  if (await maybeRejectUser(ctx, groupId)) return;
  const database = await connectDb();
  const entries = await getMiniGameLeaderboard(database, groupId);
  const message = formatMiniGameLeaderboard(entries, 'chat');
  const imageBuffer = await generateRankingImage(entries, {
    title: 'MINI-GAME LEADERBOARD',
    subtitle: ctx.chat?.title || 'THIS CHAT',
    nameKey: 'displayName',
    valueKey: 'points',
    valueSuffix: ' pts',
  });
  await sendPhotoThenText(ctx, imageBuffer, message, { reply_markup: miniGameLeaderboardKeyboard('chat') });
});

bot.command(['rankings', 'ranking'], async (ctx) => {
  if (await maybeRejectUser(ctx, ctx.chat?.type === 'private' ? null : ctx.chat.id.toString())) return;
  await sendRankingReply(ctx, 'today');
});

bot.command('topuser', async (ctx) => {
  if (await maybeRejectUser(ctx, ctx.chat.id.toString())) return;
  const entries = await getGlobalUsers('today');
  const contextName = ctx.chat?.title || ctx.chat?.username || 'this chat';
  const message = formatGlobalUsersText(entries, 'today', contextName);
  const imageBuffer = await generateRankingImage(entries, {
    title: 'TOP USERS',
    subtitle: 'GLOBAL • TODAY',
    nameKey: 'displayName',
    valueKey: 'value',
  });
  await sendPhotoThenText(ctx, imageBuffer, message, { reply_markup: buildRankingKeyboard('topuser') });
});

bot.command('topgroups', async (ctx) => {
  if (await maybeRejectUser(ctx, ctx.chat.id.toString())) return;
  const entries = await getGlobalGroups('today');
  const contextName = ctx.chat?.title || ctx.chat?.username || 'this chat';
  const message = formatGlobalGroupsText(entries, 'today', contextName);
  const imageBuffer = await generateRankingImage(entries, {
    title: 'TOP GROUPS',
    subtitle: 'GLOBAL • TODAY',
    nameKey: 'groupName',
    valueKey: 'value',
  });
  await sendPhotoThenText(ctx, imageBuffer, message, { reply_markup: buildRankingKeyboard('topgroups') });
});

bot.command('mytop', async (ctx) => {
  const groupId = ctx.chat?.type === 'private' ? null : ctx.chat.id.toString();
  if (await maybeRejectUser(ctx, groupId)) return;
  const userId = ctx.from?.id?.toString();
  if (!userId) {
    await sendOrEditMessage(ctx, 'Unable to read your user ID.');
    return;
  }

  const entries = await getUserTopGroups(userId);
  if (!entries.length) {
    await sendOrEditMessage(ctx, 'No ranking data found for you yet.');
    return;
  }

  const displayName = ctx.from?.first_name || ctx.from?.username || 'You';
  const message = formatMyTopGroupsText(entries, displayName);
  await sendOrEditMessage(ctx, message);
});

bot.command('inspect', async (ctx) => {
  if (!isOwner(ctx.from?.id)) {
    await ctx.reply('Only the owner can use this command.');
    return;
  }

  const database = await connectDb();
  const users = database.collection('group_users');
  const entries = await users
    .find({})
    .sort({ messageCount: -1, dailyMessageCount: -1 })
    .limit(30)
    .toArray();

  if (!entries.length) {
    await ctx.reply('No user data found yet.');
    return;
  }

  const lines = entries.map((entry, index) => `${index + 1}. ${entry.userName || `User ${entry.userId}`} | ${entry.groupId} | total=${entry.messageCount || 0} | today=${entry.dailyMessageCount || 0}`);
  await ctx.reply(['Owner inspection:', ...lines].join('\n'));
});

bot.command('profile', async (ctx) => {
  if (await maybeRejectUser(ctx, ctx.chat.id.toString())) return;
  const groupId = ctx.chat.id.toString();
  const userId = ctx.from?.id?.toString();

  if (!userId) {
    await sendOrEditMessage(ctx, 'Unable to read your profile right now.');
    return;
  }

  const profileData = await getUserProfile(groupId, userId);

  if (!profileData) {
    await sendOrEditMessage(ctx, 'You have no activity in this group yet.');
    return;
  }

  const contextName = ctx.chat?.title || ctx.chat?.username || 'this chat';
  const message = formatProfileText(profileData.profile, profileData.rank, profileData.totalUsers, contextName);
  const profilePhoto = await getTelegramProfilePhoto(userId);
  const imageBuffer = profilePhoto || await generateProfileImage(profileData.profile, profileData.rank, profileData.totalUsers, contextName);
  await sendPhotoThenText(ctx, imageBuffer, message);
});

bot.command('banuser', async (ctx) => {
  if (ctx.chat?.id?.toString() !== loggerChatId) {
    await ctx.reply('Manual ban controls are available only in the logger group.');
    return;
  }

  if (!isOwner(ctx.from?.id)) {
    await ctx.reply('Only the owner can ban users.');
    return;
  }

  const args = ctx.message.text.split(' ').slice(1).filter(Boolean);
  if (!args.length) {
    await ctx.reply('Usage: /banuser <user_id|@username> [reason]');
    return;
  }

  let targetId = args[0].replace('@', '');
  const reason = args.slice(1).join(' ') || 'rule violation';
  if (!/^[0-9]+$/.test(targetId)) {
    const database = await connectDb();
    const users = database.collection('group_users');
    const found = await users.findOne({ userName: targetId });
    if (!found) {
      await ctx.reply('Unable to locate that user. Use numeric user ID or known @username.');
      return;
    }
    targetId = found.userId;
  }

  await sendLoggerModerationMessage(
    `Ban user <b>${escapeHtml(targetId)}</b>\nReason: ${escapeHtml(reason)}\nChoose a duration:`,
    buildBanKeyboard(targetId),
  );
});

bot.command('unbanuser', async (ctx) => {
  if (ctx.chat?.id?.toString() !== loggerChatId) {
    await ctx.reply('Manual unban controls are available only in the logger group.');
    return;
  }

  if (!isOwner(ctx.from?.id)) {
    await ctx.reply('Only the owner can unban users.');
    return;
  }

  const args = ctx.message.text.split(' ').slice(1).filter(Boolean);
  if (!args.length || !/^[0-9]+$/.test(args[0])) {
    await ctx.reply('Usage: /unbanuser <user_id>');
    return;
  }

  const targetId = args[0];
  await unbanUser(targetId);
  await ctx.reply(`User ${escapeHtml(targetId)} has been unbanned.`);
});

bot.action(/banuser:(\d+):(1d|2d|3d|10d|20d|1m|3m|1y|perm|ignore)/, async (ctx) => {
  await safeAnswerCbQuery(ctx);
  if (ctx.chat?.id?.toString() !== loggerChatId) {
    await ctx.reply('Ban controls are available only in the logger group.');
    return;
  }

  if (!isOwner(ctx.from?.id)) {
    await ctx.reply('Only the owner can confirm bans.');
    return;
  }

  const [_, targetId, durationKey] = ctx.match;
  const reasonLine = ctx.callbackQuery.message?.text?.split('\n').find((line) => line.startsWith('Reason:')) || 'Reason: rule violation';
  const reason = reasonLine.replace(/^Reason:\s*/, '') || 'rule violation';

  if (durationKey === 'ignore') {
    await ctx.editMessageText(`Ban ignored for user ${escapeHtml(targetId)}.`, { parse_mode: 'HTML' });
    return;
  }

  await banUser(targetId, durationKey, reason);
  await ctx.editMessageText(`User ${escapeHtml(targetId)} has been banned for ${getBanDurationLabel(durationKey)}.`, { parse_mode: 'HTML' });
});

bot.action('welcome:rankings', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  if (await maybeRejectUser(ctx, ctx.chat?.type === 'private' ? null : ctx.chat?.id?.toString())) return;
  await sendRankingReply(ctx, 'today');
});

bot.action('welcome:profile', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  if (await maybeRejectUser(ctx, ctx.chat?.type === 'private' ? null : ctx.chat?.id?.toString())) return;
  const groupId = ctx.chat.id.toString();
  const userId = ctx.from?.id?.toString();

  if (!userId) {
    await sendOrEditMessage(ctx, 'Unable to read your profile right now.');
    return;
  }

  const profileData = await getUserProfile(groupId, userId);
  if (!profileData) {
    await sendOrEditMessage(ctx, 'You have no activity in this group yet.');
    return;
  }

  const contextName = ctx.chat?.title || ctx.chat?.username || 'this chat';
  const message = formatProfileText(profileData.profile, profileData.rank, profileData.totalUsers, contextName);
  const profilePhoto = await getTelegramProfilePhoto(userId);
  const imageBuffer = profilePhoto || await generateProfileImage(profileData.profile, profileData.rank, profileData.totalUsers, contextName);
  await sendPhotoThenText(ctx, imageBuffer, message);
});

bot.action(/^mg:[0-9a-z]+:\d+$/, async (ctx) => {
  const database = await connectDb();
  const groupId = ctx.chat?.type === 'private' ? null : ctx.chat?.id?.toString();
  if (!groupId) {
    await safeAnswerCbQuery(ctx, 'Mini-games are available in group chats.');
    return;
  }
  if (await maybeRejectUser(ctx, groupId)) return;
  await handleMiniGameButtonAnswer({ db: database, ctx });
});

bot.action(/minigame_lb:(chat|global)/, async (ctx) => {
  await safeAnswerCbQuery(ctx);
  const groupId = ctx.chat?.type === 'private' ? null : ctx.chat?.id?.toString();
  if (!groupId) return;
  if (await maybeRejectUser(ctx, groupId)) return;
  const scope = ctx.match[1];
  const database = await connectDb();
  const entries = await getMiniGameLeaderboard(database, scope === 'chat' ? groupId : null);
  const message = formatMiniGameLeaderboard(entries, scope);
  const imageBuffer = await generateRankingImage(entries, {
    title: scope === 'global' ? 'GLOBAL MINI-GAME LEADERBOARD' : 'MINI-GAME LEADERBOARD',
    subtitle: scope === 'global' ? 'GLOBAL' : (ctx.chat?.title || 'THIS CHAT'),
    nameKey: 'displayName',
    valueKey: 'points',
    valueSuffix: ' pts',
  });
  await sendPhotoThenText(ctx, imageBuffer, message, { reply_markup: miniGameLeaderboardKeyboard(scope) });
});

bot.action(/rankings:(today|total|weekly)/, async (ctx) => {
  await safeAnswerCbQuery(ctx);
  if (await maybeRejectUser(ctx, ctx.chat.id.toString())) return;
  const mode = ctx.match[1];
  await sendRankingReply(ctx, mode);
});

bot.action(/topuser:(today|total|weekly)/, async (ctx) => {
  await safeAnswerCbQuery(ctx);
  if (await maybeRejectUser(ctx, ctx.chat.id.toString())) return;
  const mode = ctx.match[1];
  const contextName = ctx.chat?.title || ctx.chat?.username || 'this chat';
  const entries = await getGlobalUsers(mode);
  const message = formatGlobalUsersText(entries, mode, contextName);
  const imageBuffer = await generateRankingImage(entries, {
    title: 'TOP USERS',
    subtitle: `GLOBAL • ${mode === 'total' ? 'ALL TIME' : mode === 'weekly' ? 'THIS WEEK' : 'TODAY'}`,
    nameKey: 'displayName',
    valueKey: 'value',
  });
  await sendPhotoThenText(ctx, imageBuffer, message, { reply_markup: buildRankingKeyboard('topuser', `topuser:${mode}`) });
});

bot.action(/topgroups:(today|total|weekly)/, async (ctx) => {
  await safeAnswerCbQuery(ctx);
  if (await maybeRejectUser(ctx, ctx.chat.id.toString())) return;
  const mode = ctx.match[1];
  const contextName = ctx.chat?.title || ctx.chat?.username || 'this chat';
  const entries = await getGlobalGroups(mode);
  const message = formatGlobalGroupsText(entries, mode, contextName);
  const imageBuffer = await generateRankingImage(entries, {
    title: 'TOP GROUPS',
    subtitle: `GLOBAL • ${mode === 'total' ? 'ALL TIME' : mode === 'weekly' ? 'THIS WEEK' : 'TODAY'}`,
    nameKey: 'groupName',
    valueKey: 'value',
  });
  await sendPhotoThenText(ctx, imageBuffer, message, { reply_markup: buildRankingKeyboard('topgroups', `topgroups:${mode}`) });
});

bot.on('my_chat_member', async (ctx) => {
  const member = ctx.myChatMember;
  if (!member || !member.chat) return;

  if (member.new_chat_member?.status === 'member' || member.new_chat_member?.status === 'administrator') {
    const payload = {
      groupName: member.chat.title || 'unknown',
      groupId: member.chat.id,
      groupLink: member.chat.username ? `https://t.me/${member.chat.username}` : 'n/a',
    };
    const message = buildLoggerMessage('group-added', payload);
    await sendLoggerMessage(message);
    const database = await connectDb();
    await registerMiniGameGroup(
      database,
      member.chat.id.toString(),
      member.chat.title || member.chat.username || `Group ${member.chat.id}`,
      member.chat.username ? `https://t.me/${member.chat.username}` : null,
    );
    await sendWelcomeMessage(ctx, member.chat.id);
    return;
  }

  if (member.new_chat_member?.status === 'left' || member.new_chat_member?.status === 'kicked') {
    const database = await connectDb();
    await database.collection('mini_game_groups').updateOne(
      { groupId: member.chat.id.toString() },
      { $set: { enabled: false, updatedAt: new Date() } },
    );
  }
});

bot.on('message', async (ctx) => {
  const message = ctx.message;
  if (!message) return;
  if (!ctx.chat || ctx.chat.type === 'private') return;

  const groupId = ctx.chat.id.toString();
  // Do not answer every ordinary message during the cooldown. The single
  // Rule 5 notice is sent when the block is created; later messages are
  // ignored silently until the block expires.
  if (await maybeRejectUser(ctx, groupId, false)) return;

  const database = await connectDb();
  await registerMiniGameGroup(
    database,
    groupId,
    ctx.chat.title || ctx.chat.username || `Group ${groupId}`,
    ctx.chat.username ? `https://t.me/${ctx.chat.username}` : null,
  );

  // Rule 5 runs first so rapid user messages cannot be skipped by another handler.
  await checkSpamAndCount(ctx);
  await handleMiniGameAnswer({ db: database, ctx });
});

async function start() {
  const healthServer = createHealthServer(connectDb);
  const healthPort = process.env.PORT || process.env.HEALTH_PORT || 3001;
  healthServer.listen(healthPort, '0.0.0.0', () => {
    console.log('Health server listening');
  });

  await ensureIndexes();

  const database = await connectDb();

  // Recover persisted hourly mini-games after restarts. Include groups that
  // were registered before any ranking row was written, otherwise a newly
  // added group can be missed forever after a restart.
  const [rankingGroups, registeredGroups] = await Promise.all([
    database.collection('group_users').distinct('groupId'),
    database.collection('mini_game_groups').distinct('groupId'),
  ]);
  const knownGroups = [...new Set([...rankingGroups, ...registeredGroups])];

  for (const groupId of knownGroups) {
    const [sample, registered] = await Promise.all([
      database.collection('group_users').findOne({ groupId }),
      database.collection('mini_game_groups').findOne({ groupId }),
    ]);

    await registerMiniGameGroup(
      database,
      groupId,
      sample?.groupName || registered?.groupName || `Group ${groupId}`,
      sample?.groupLink || registered?.groupLink || null
    );

    if (registered?.enabled === false) {
      await database.collection('mini_game_groups').updateOne(
        { groupId },
        { $set: { enabled: false, updatedAt: new Date() } },
      );
    } else {
      // Keep mini-games aligned to exact clock hours after every deployment.
      // If a round is already active, preserve it; otherwise schedule the next
      // round for the next HH:00 boundary (for example 1:37 -> 2:00).
      if (!registered?.activeRound) {
        const now = new Date();
        const nextHour = new Date(now);
        nextHour.setMinutes(0, 0, 0);
        nextHour.setHours(nextHour.getHours() + 1);
        await database.collection('mini_game_groups').updateOne(
          { groupId },
          {
            $set: {
              nextGameAt: nextHour,
              enabled: true,
              updatedAt: now,
            },
          },
        );
      } else {
        await database.collection('mini_game_groups').updateOne(
          { groupId },
          { $set: { enabled: true, updatedAt: new Date() } },
        );
      }
    }
  }

  console.log(`[MiniGame] Startup groups scheduled: ${knownGroups.length}`);

  // Refresh member counts for existing groups on every deployment. This also
  // backfills groups that were tracked before member-count tracking was added.
  for (const groupId of knownGroups) {
    try {
      const sample = await database.collection('group_users').findOne({ groupId });
      const existingStats = await database.collection('group_stats').findOne({ groupId });
      const memberCount = await fetchGroupMemberCount(bot.telegram, groupId);
      const now = new Date();
      await database.collection('group_stats').updateOne(
        { groupId },
        {
          $set: {
            groupId,
            groupName: sample?.groupName || existingStats?.groupName || `Group ${groupId}`,
            groupLink: sample?.groupLink || existingStats?.groupLink || null,
            memberCount,
            memberCountCheckedAt: now,
            updatedAt: now,
          },
          $setOnInsert: { createdAt: now },
        },
        { upsert: true },
      );
      console.log(`[Stats] Startup member count ${groupId}: ${memberCount}`);
    } catch (error) {
      console.warn(`[Stats] Startup member count failed for ${groupId}:`, error.message || error);
    }
  }

  const runMiniGames = async () => {
    try {
      await expireMiniGames(database);

      await startDueMiniGames({
        db: database,
        telegram: bot.telegram,
        logger: console,
      });
    } catch (error) {
      console.error('[MiniGame] Scheduler error:', error);
    }
  };

  // Start mini-game scheduler BEFORE Telegram polling
  await runMiniGames();
  setInterval(runMiniGames, 15000);

  console.log('[MiniGame] Scheduler started');

  await bot.launch();

  console.log('Bot started');
}

start().catch((error) => {
  console.error('Failed to start bot', error);
  process.exit(1);
});

process.once('SIGINT', () => client.close());
process.once('SIGTERM', () => client.close());
