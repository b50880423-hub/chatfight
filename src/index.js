import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { MongoClient } from 'mongodb';
import { formatRankingText, getUserUpdateForMessage, getWeekKey } from './rankingLogic.js';
import { formatProfileText } from './profileLogic.js';
import { formatGlobalUsersText, formatGlobalGroupsText } from './globalLogic.js';
import { buildLoggerMessage, getLoggerChatId } from './logger.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const dbName = process.env.MONGODB_DB_NAME || 'chatfight';
const loggerChatId = getLoggerChatId(process.env);

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is required');
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
}

async function getOrCreateUser(groupId, userId, userName) {
  const database = await connectDb();
  const users = database.collection('group_users');
  const now = new Date();
  const existing = await users.findOne({ groupId, userId });
  const updatePlan = getUserUpdateForMessage(existing, groupId, userId, userName, now);

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

  const topUsers = await users
    .find(query)
    .sort({ [sortField]: -1, messageCount: -1 })
    .limit(10)
    .toArray();

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
    { $group: { _id: '$userId', userName: { $first: '$userName' }, value: { $sum: valueField } } },
    { $sort: { value: -1, userName: 1 } },
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
    { $group: { _id: '$groupId', groupName: { $first: '$groupName' }, value: { $sum: valueField } } },
    { $sort: { value: -1, _id: 1 } },
    { $limit: 10 },
  ]).toArray();

  const totalResult = await users.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: valueField } } },
  ]).toArray();

  return entries.map((entry) => ({ ...entry, value: entry.value || 0, totalValue: totalResult[0]?.total || 0 }));
}

async function sendLoggerMessage(message) {
  if (!loggerChatId) return;
  try {
    await bot.telegram.sendMessage(loggerChatId, message);
  } catch (error) {
    console.error('Failed to send logger message', error);
  }
}

async function sendWelcomeMessage(ctx, targetChatId = null) {
  const keyboard = {
    inline_keyboard: [[
      { text: '📊 Rankings', callback_data: 'welcome:rankings' },
      { text: '👤 Profile', callback_data: 'welcome:profile' },
    ]],
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
  await sendWelcomeMessage(ctx);
});

function buildRankingKeyboard(prefix = 'rankings') {
  return {
    inline_keyboard: [
      [
        { text: '📅 Today', callback_data: `${prefix}:today` },
        { text: '📈 Total', callback_data: `${prefix}:total` },
        { text: '🗓️ Weekly', callback_data: `${prefix}:weekly` },
      ],
    ],
  };
}

async function sendRankingReply(ctx, mode = 'today') {
  const groupId = ctx.chat.id.toString();
  const { topUsers, totalValue } = await getTopUsers(groupId, mode);

  if (!topUsers.length) {
    await ctx.reply('No activity yet in this group.', { reply_markup: buildRankingKeyboard() });
    return;
  }

  const message = formatRankingText(topUsers, totalValue, mode);
  await ctx.reply(message, { reply_markup: buildRankingKeyboard() });
}

bot.command(['rankings', 'ranking'], async (ctx) => {
  await sendRankingReply(ctx, 'today');
});

bot.command('topuser', async (ctx) => {
  const entries = await getGlobalUsers('today');
  const message = formatGlobalUsersText(entries, 'today');
  await ctx.reply(message, { reply_markup: buildRankingKeyboard('topuser') });
});

bot.command('topgroups', async (ctx) => {
  const entries = await getGlobalGroups('today');
  const message = formatGlobalGroupsText(entries, 'today');
  await ctx.reply(message, { reply_markup: buildRankingKeyboard('topgroups') });
});

bot.command('profile', async (ctx) => {
  const groupId = ctx.chat.id.toString();
  const userId = ctx.from?.id?.toString();

  if (!userId) {
    await ctx.reply('Unable to read your profile right now.');
    return;
  }

  const profileData = await getUserProfile(groupId, userId);

  if (!profileData) {
    await ctx.reply('You have no activity in this group yet.');
    return;
  }

  const message = formatProfileText(profileData.profile, profileData.rank, profileData.totalUsers);
  await ctx.reply(message);
});

bot.action('welcome:rankings', async (ctx) => {
  await ctx.answerCbQuery();
  await sendRankingReply(ctx, 'today');
});

bot.action('welcome:profile', async (ctx) => {
  await ctx.answerCbQuery();
  const groupId = ctx.chat.id.toString();
  const userId = ctx.from?.id?.toString();

  if (!userId) {
    await ctx.reply('Unable to read your profile right now.');
    return;
  }

  const profileData = await getUserProfile(groupId, userId);
  if (!profileData) {
    await ctx.reply('You have no activity in this group yet.');
    return;
  }

  const message = formatProfileText(profileData.profile, profileData.rank, profileData.totalUsers);
  await ctx.reply(message);
});

bot.action(/rankings:(today|total|weekly)/, async (ctx) => {
  const mode = ctx.match[1];
  await ctx.answerCbQuery();
  await sendRankingReply(ctx, mode);
});

bot.action(/topuser:(today|total|weekly)/, async (ctx) => {
  const mode = ctx.match[1];
  await ctx.answerCbQuery();
  const entries = await getGlobalUsers(mode);
  const message = formatGlobalUsersText(entries, mode);
  await ctx.reply(message, { reply_markup: buildRankingKeyboard('topuser') });
});

bot.action(/topgroups:(today|total|weekly)/, async (ctx) => {
  const mode = ctx.match[1];
  await ctx.answerCbQuery();
  const entries = await getGlobalGroups(mode);
  const message = formatGlobalGroupsText(entries, mode);
  await ctx.reply(message, { reply_markup: buildRankingKeyboard('topgroups') });
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
  if (!message || message.text?.startsWith('/')) return;
  if (!ctx.chat || ctx.chat.type === 'private') return;

  const groupId = ctx.chat.id.toString();
  const userId = message.from?.id?.toString();
  const userName = message.from?.username || message.from?.first_name || 'Unknown';

  if (!userId) return;

  await getOrCreateUser(groupId, userId, userName);
});

async function start() {
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
