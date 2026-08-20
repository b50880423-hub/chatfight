function getISTParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}

export function getISTDayKey(date = new Date()) {
  const p = getISTParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function previousISTDayKey(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

export function getPreviousISTDayKey(date = new Date()) {
  return previousISTDayKey(getISTDayKey(date));
}

export function isISTMidnightWindow(date = new Date(), catchupMinutes = 2) {
  const p = getISTParts(date);
  return Number(p.hour) === 0 && Number(p.minute) <= catchupMinutes;
}

export function msUntilNextISTMidnight(date = new Date()) {
  const p = getISTParts(date);
  const nowMinute = Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60;
  const minutesUntil = 24 * 60 - nowMinute;
  return Math.max(1000, Math.floor(minutesUntil * 60 * 1000));
}

function cleanText(value, max = 600) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  // Free-tier friendly model. Override with GEMINI_SUMMARY_MODEL if needed.
  const model = process.env.GEMINI_SUMMARY_MODEL || 'gemini-2.5-flash-lite-preview-09-2025';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 700,
        temperature: 0.9,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Gemini ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || '')
    .join('')
    .trim();

  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

function buildPrompt({ groupName, dayKey, messages, topUsers }) {
  const transcript = messages.map((m, i) => `${i + 1}. ${m.user}: ${m.text}`).join('\n');
  const leaders = topUsers.map((u, i) => `${i + 1}. ${u.name}: ${u.count} messages`).join('\n');

  return `You are ChatFight's FUNNY and CHAOTIC daily group-summary AI. At midnight, turn the previous day's Telegram group conversation into an entertaining roast-style recap that members will actually enjoy reading.

STYLE:
- Be funny, playful, witty, dramatic, and slightly savage — like a friend roasting the whole group.
- Use natural Telegram-style language and emojis such as 😂💀🔥🤡👀😭🏆💬.
- Make jokes from things that REALLY happened in the supplied messages. Never invent events, quotes, arguments, relationships, or facts.
- You may exaggerate harmlessly for comedic effect, but never fabricate factual events.
- Do not insult protected characteristics, make sexual accusations, expose private information, or make serious allegations.
- Do not expose user IDs, phone numbers, tokens, passwords, or private credentials.
- Use display names/usernames when making jokes or giving awards.
- Ignore command spam, bot messages, meaningless repeated characters, and obvious system text.
- If the group was quiet, make THAT the joke instead of inventing activity.
- If there was an argument, describe it playfully without taking sides or claiming who was right unless the messages clearly establish it.
- Highlight funny recurring words, memes, phrases, mini-drama, game moments, unusual activity, and who was most active when supported by the data.
- Do not quote long messages. Short snippets of a few words are okay.
- Keep the whole result compact enough for one Telegram message.

Return ONLY these sections, with no introduction before them:
<b>🔥 TODAY'S CHAOS</b>
2-4 short funny bullet points about the day's biggest moments.

<b>😂 GROUP MOMENTS</b>
2-4 short funny observations based on actual conversation patterns/topics.

<b>🏆 TODAY'S AWARDS</b>
Give 3-5 funny awards to actual active members, such as Keyboard Warrior, Professional Yapper, Ghost of the Day, Drama Department, Meme Minister, Fastest Reply, or Why Are We Still Talking? Use different awards when the data supports them.

<b>🤡 AI'S VERDICT</b>
A 1-3 sentence funny closing roast describing the overall mood of the day.

<b>💀 CHAOS SCORE</b>
Give a playful score from 1.0/10 to 10.0/10 and one short reason.

Group: ${groupName}
Date: ${dayKey} (IST)

Most active users:
${leaders || 'No ranking data available'}

Messages:
${transcript}`;
}

function chunkMessages(messages, size = 350) {
  const chunks = [];
  for (let i = 0; i < messages.length; i += size) chunks.push(messages.slice(i, i + size));
  return chunks;
}

async function summarizeMessages(groupName, dayKey, messages, topUsers) {
  if (!messages.length) return null;

  const chunks = chunkMessages(messages);
  let source = messages;

  if (chunks.length > 1) {
    const chunkSummaries = [];
    for (const chunk of chunks) {
      const text = await callGemini(buildPrompt({ groupName, dayKey, messages: chunk, topUsers }));
      chunkSummaries.push({ user: 'AI', text });
    }
    source = chunkSummaries;
  }

  return callGemini(buildPrompt({ groupName, dayKey, messages: source, topUsers }));
}

export async function recordDailyMessage(db, ctx) {
  const message = ctx?.message;
  if (!message?.from || !ctx.chat || ctx.chat.type === 'private') return;
  const text = typeof message.text === 'string' ? message.text.trim() : typeof message.caption === 'string' ? message.caption.trim() : '';
  if (!text || text.startsWith('/')) return;

  const dayKey = getISTDayKey(new Date());
  await db.collection('chat_daily_messages').insertOne({
    groupId: ctx.chat.id.toString(),
    groupName: ctx.chat.title || ctx.chat.username || `Group ${ctx.chat.id}`,
    dayKey,
    userId: message.from.id.toString(),
    user: cleanText([message.from.first_name, message.from.last_name].filter(Boolean).join(' ') || message.from.username || `User ${message.from.id}`, 80),
    username: message.from.username || null,
    text: cleanText(text),
    createdAt: new Date(),
  });
}

export async function ensureAISummaryIndexes(db) {
  const messages = db.collection('chat_daily_messages');
  await messages.createIndex({ groupId: 1, dayKey: 1, createdAt: 1 });
  await messages.createIndex({ dayKey: 1 });
  await messages.createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });

  const summaries = db.collection('chat_daily_summaries');
  await summaries.createIndex({ groupId: 1, dayKey: 1 }, { unique: true });
}

export async function runDueDailyAISummaries({ db, telegram, logger = console }) {
  const today = getISTDayKey(new Date());
  const messagesCollection = db.collection('chat_daily_messages');
  const summaries = db.collection('chat_daily_summaries');

  const dayKeys = await messagesCollection.distinct('dayKey', { dayKey: { $lt: today } });
  for (const dayKey of dayKeys.sort()) {
    const groupIds = await messagesCollection.distinct('groupId', { dayKey });
    for (const groupId of groupIds) {
      const already = await summaries.findOne({ groupId, dayKey });
      if (already) continue;

      const messages = await messagesCollection.find({ groupId, dayKey }, { projection: { _id: 0, user: 1, text: 1, createdAt: 1, groupName: 1 } })
        .sort({ createdAt: 1 })
        .limit(5000)
        .toArray();
      if (!messages.length) continue;

      const groupName = messages[0].groupName || `Group ${groupId}`;
      const topUsers = await messagesCollection.aggregate([
        { $match: { groupId, dayKey } },
        { $group: { _id: '$userId', name: { $first: '$user' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]).toArray();

      try {
        const summary = await summarizeMessages(groupName, dayKey, messages, topUsers);
        if (!summary) continue;

        const safeSummary = escapeHtml(summary)
          .replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
        const text = `🌙 <b>ChatFight Daily AI Summary</b>\n<b>${escapeHtml(groupName)}</b>\n📅 ${dayKey} (IST)\n\n${safeSummary}`;

        await telegram.sendMessage(groupId, text, { parse_mode: 'HTML' });
        await summaries.insertOne({ groupId, dayKey, summary, messageCount: messages.length, createdAt: new Date() });
        logger.log?.(`[AI Summary] Sent ${groupId} for ${dayKey} (${messages.length} messages)`);
      } catch (error) {
        logger.error?.(`[AI Summary] Failed for ${groupId}/${dayKey}:`, error?.message || error);
      }
    }
  }
}
