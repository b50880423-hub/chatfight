import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RULE_5_BLOCK_MS,
  getNextSpamCount,
  getRule5BlockUntil,
  isBotCommandMessage,
  isCountableHumanMessage,
} from '../src/antiSpamLogic.js';

test('counts only human non-command messages', () => {
  assert.equal(isCountableHumanMessage({ from: { id: 10, is_bot: false }, text: 'hello' }), true);
  assert.equal(isCountableHumanMessage({ from: { id: 11, is_bot: true }, text: 'hello' }), false);
  assert.equal(isCountableHumanMessage({ from: { id: 12, is_bot: false }, text: '/rankings' }), false);
  assert.equal(isBotCommandMessage({
    from: { id: 12, is_bot: false },
    text: '/rankings',
    entities: [{ type: 'bot_command', offset: 0, length: 9 }],
  }), true);
});

test('resets the quick-message sequence after a two-second gap', () => {
  const now = new Date('2026-08-07T12:00:10.000Z');

  assert.equal(getNextSpamCount(new Date('2026-08-07T12:00:08.500Z'), 3, now), 4);
  assert.equal(getNextSpamCount(new Date('2026-08-07T12:00:07.000Z'), 3, now), 1);
});

test('creates a block that lasts exactly twenty minutes', () => {
  const now = new Date('2026-08-07T12:00:00.000Z');
  assert.equal(getRule5BlockUntil(now).valueOf(), now.valueOf() + RULE_5_BLOCK_MS);
});