export function buildLoggerMessage(type, payload) {
  switch (type) {
    case 'bot-started':
      return [
        '🤖 Bot started',
        `User: ${payload.userName || payload.userId || 'unknown'}`,
        `User ID: ${payload.userId || 'unknown'}`,
      ].join('\n');
    case 'group-added':
      return [
        '🟢 Bot added to group',
        `Group name: ${payload.groupName || 'unknown'}`,
        `Group ID: ${payload.groupId || 'unknown'}`,
        `Group link: ${payload.groupLink || 'n/a'}`,
      ].join('\n');
    default:
      return 'Logger event';
  }
}

export function getLoggerChatId(env) {
  return env.LOGGER_GROUP_ID || env.LOGGER_CHAT_ID || '';
}
