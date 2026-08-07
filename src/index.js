import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { MongoClient } from 'mongodb';
import { formatRankingText, getUserUpdateForMessage, getWeekKey } from './rankingLogic.js';
import { formatProfileText } from './profileLogic.js';
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

const token = process.env.TELEGRAM_BOT_TOKEN;
const mongoUri = process.env.MONGODB_URI || (process.env.NODE_ENV === 'development' ? 'mongodb://127.0.0.1:27017' : null);
const dbName = process.env.MONGODB_DB_NAME || 'chatfight';
const loggerChatId = getLoggerChatId(process.env);
const publicGroupLink = process.env.PUBLIC_GROUP_LINK || '';
const ownerId = process.env.OWNER_ID || '';

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}

if (!mongoUri) {
  console.error('MONGODB_URI is required in production to preserve rankings across deploys.');
  process.exit(1);
}

const bot = new Telegraf(token);
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
}

const MILESTONES = [500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000];
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
  return [
    `<b>ChatFight - Blocked</b>`,
    '',
    `You have been blocked from the bot for <b>20 minutes</b> due to repeated fast messages in the group.`,
    `Your block expires in <b>${formatRemainingTime(blockedUntil)}</b>.`,
    'During this time, messages will not count toward rankings and bot commands are disabled.',
  ].join('\n');
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
  const groupStats = database.collection('group_stats');
  const result = await groupStats.findOneAndUpdate(
    { groupId },
    { $inc: { totalMessageCount: 1 }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true, returnDocument: 'after' },
  );

  const total = result?.totalMessageCount || 0;
  if (MILESTONES.includes(total)) {
    const groupName = ctx.chat?.title || ctx.chat?.username || 'this group';
    await ctx.reply(`🎉 ${groupName} has crossed ${total} total bot-tracked messages! Keep the fight going!`);
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

  if (spamCount >= RULE_5_MESSAGE_LIMIT) {
    const blockedUntil = getRule5BlockUntil(now);
    const globalBlock = await applyRule5Block(userId, blockedUntil);
    if (!globalBlock) return;

    await statuses.updateOne(
      { userId, groupId },
      { $set: { spamCount: 0, lastMessageAt: now, updatedAt: new Date() } },
    );

    const blockText = [
      `<b>ChatFight - User blocked in this group</b>`,
      '',
      `${escapeHtml(displayName)} has been blocked from the bot for <b>20 minutes</b> after sending ${RULE_5_MESSAGE_LIMIT} messages with less than 3 seconds between each message.`,
      'Blocked users do not earn ranking points and cannot use bot commands until the block expires. The group itself is not muted.',
    ].join('\n');

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
  const dayKey = now.toISOString().slice(0, 10);
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
  const dayKey = now.toISOString().slice(0, 10);
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
  const dayKey = now.toISOString().slice(0, 10);
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
  return ownerId && String(userId) === String(ownerId);
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

async function sendWelcomeMessage(ctx, targetChatId = null) {
  const keyboardButtons = [
    [{ text: '📊 Rankings', callback_data: 'welcome:rankings' }, { text: '👤 Profile', callback_data: 'welcome:profile' }],
  ];

  if (publicGroupLink) {
    keyboardButtons.push([{ text: '🚀 Join Public Group', url: publicGroupLink }]);
  }

  const keyboard = {
    inline_keyboard: keyboardButtons,
  };

  const message = 'Welcome to ChatFight! Use the buttons below to explore the bot.';

  if (targetChatId) {
    await ctx.telegram.sendMessage(targetChatId, message, { reply_markup: keyboard });
    return;
  }

  await ctx.reply(message, { reply_markup: keyboard });
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

function buildRankingKeyboard(prefix = 'rankings') {
  return {
    inline_keyboard: [
      [{ text: '📈 Total', callback_data: `${prefix}:total` }],
      [
        { text: '📅 Today', callback_data: `${prefix}:today` },
        { text: '🗓️ Weekly', callback_data: `${prefix}:weekly` },
      ],
    ],
  };
}

async function sendOrEditMessage(ctx, text, options = {}) {
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
          await ctx.answerCbQuery();
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
    await sendOrEditMessage(ctx, 'No activity yet in this group.', { reply_markup: buildRankingKeyboard() });
    return;
  }

  const message = formatRankingText(topUsers, totalValue, mode, contextName);
  await sendOrEditMessage(ctx, message, { reply_markup: buildRankingKeyboard() });
}

bot.command(['rankings', 'ranking'], async (ctx) => {
  if (await maybeRejectUser(ctx, ctx.chat?.type === 'private' ? null : ctx.chat.id.toString())) return;
  await sendRankingReply(ctx, 'today');
});

bot.command('topuser', async (ctx) => {
  if (await maybeRejectUser(ctx, ctx.chat.id.toString())) return;
  const entries = await getGlobalUsers('today');
  const contextName = ctx.chat?.title || ctx.chat?.username || 'this chat';
  const message = formatGlobalUsersText(entries, 'today', contextName);
  await sendOrEditMessage(ctx, message, { reply_markup: buildRankingKeyboard('topuser') });
});

bot.command('topgroups', async (ctx) => {
  if (await maybeRejectUser(ctx, ctx.chat.id.toString())) return;
  const entries = await getGlobalGroups('today');
  const contextName = ctx.chat?.title || ctx.chat?.username || 'this chat';
  const message = formatGlobalGroupsText(entries, 'today', contextName);
  await sendOrEditMessage(ctx, message, { reply_markup: buildRankingKeyboard('topgroups') });
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
  await sendOrEditMessage(ctx, message);
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
  await ctx.answerCbQuery();
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
  await ctx.answerCbQuery();
  if (await maybeRejectUser(ctx, ctx.chat?.type === 'private' ? null : ctx.chat?.id?.toString())) return;
  await sendRankingReply(ctx, 'today');
});

bot.action('welcome:profile', async (ctx) => {
  await ctx.answerCbQuery();
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
  await sendOrEditMessage(ctx, message);
});

bot.action(/rankings:(today|total|weekly)/, async (ctx) => {
  await ctx.answerCbQuery();
  if (await maybeRejectUser(ctx, ctx.chat.id.toString())) return;
  const mode = ctx.match[1];
  await sendRankingReply(ctx, mode);
});

bot.action(/topuser:(today|total|weekly)/, async (ctx) => {
  await ctx.answerCbQuery();
  if (await maybeRejectUser(ctx, ctx.chat.id.toString())) return;
  const mode = ctx.match[1];
  const contextName = ctx.chat?.title || ctx.chat?.username || 'this chat';
  const entries = await getGlobalUsers(mode);
  const message = formatGlobalUsersText(entries, mode, contextName);
  await sendOrEditMessage(ctx, message, { reply_markup: buildRankingKeyboard('topuser') });
});

bot.action(/topgroups:(today|total|weekly)/, async (ctx) => {
  await ctx.answerCbQuery();
  if (await maybeRejectUser(ctx, ctx.chat.id.toString())) return;
  const mode = ctx.match[1];
  const contextName = ctx.chat?.title || ctx.chat?.username || 'this chat';
  const entries = await getGlobalGroups(mode);
  const message = formatGlobalGroupsText(entries, mode, contextName);
  await sendOrEditMessage(ctx, message, { reply_markup: buildRankingKeyboard('topgroups') });
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
    await sendWelcomeMessage(ctx, member.chat.id);
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

  await checkSpamAndCount(ctx);
});

async function start() {
  const healthServer = createHealthServer();
  const healthPort = process.env.PORT || process.env.HEALTH_PORT || 3001;
  healthServer.listen(healthPort, '0.0.0.0', () => {
    console.log('Health server listening');
  });

  await ensureIndexes();
  await bot.launch();
  console.log('Bot started');
}

start().catch((error) => {
  console.error('Failed to start bot', error);
  process.exit(1);
});

process.once('SIGINT', () => client.close());
process.once('SIGTERM', () => client.close());
