export const RULE_5_MESSAGE_GAP_MS = 2 * 1000;
export const RULE_5_MESSAGE_LIMIT = 10;
export const RULE_5_BLOCK_MS = 20 * 60 * 1000;

export function isTelegramBotMessage(message) {
  return message?.from?.is_bot === true;
}

export function isBotCommandMessage(message) {
  if (!message) return false;

  const entities = [...(message.entities || []), ...(message.caption_entities || [])];
  return entities.some((entity) => entity.type === 'bot_command' && entity.offset === 0)
    || /^\/[a-z0-9_]+(?:@[a-z0-9_]+)?(?:\s|$)/i.test(message.text || message.caption || '');
}

export function isCountableHumanMessage(message) {
  return Boolean(message?.from?.id) && !isTelegramBotMessage(message);
}

export function getNextSpamCount(lastMessageAt, spamCount = 0, now = new Date()) {
  if (!lastMessageAt || now.valueOf() - new Date(lastMessageAt).valueOf() >= RULE_5_MESSAGE_GAP_MS) {
    return 1;
  }

  return Number(spamCount || 0) + 1;
}

export function getRule5BlockUntil(now = new Date()) {
  return new Date(now.valueOf() + RULE_5_BLOCK_MS);
}