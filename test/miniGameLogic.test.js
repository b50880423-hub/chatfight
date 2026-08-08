import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerMiniGameGroup,
  startDueMiniGames,
} from '../src/miniGameLogic.js';

function createFakeCollection(initial = []) {
  const documents = [...initial];
  return {
    documents,
    async updateOne(filter, update, options = {}) {
      let document = documents.find((candidate) => (
        (filter._id === undefined || candidate._id === filter._id)
        && (filter.groupId === undefined || candidate.groupId === filter.groupId)
      ));
      if (!document && options.upsert) {
        document = { ...update.$setOnInsert };
        documents.push(document);
      }
      if (document) Object.assign(document, update.$set || {});
      return { acknowledged: true };
    },
    find(query) {
      const matching = documents.filter((candidate) => (
        (query.enabled?.$ne !== false || candidate.enabled !== false)
        && candidate.nextGameAt <= query.nextGameAt.$lte
        && candidate.activeRound === null
      ));
      return {
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        async toArray() {
          return matching;
        },
      };
    },
    async findOneAndUpdate(filter, update) {
      const document = documents.find((candidate) => (
        (filter._id === undefined || candidate._id === filter._id)
        && (filter.groupId === undefined || candidate.groupId === filter.groupId)
        && candidate.enabled !== false
        && candidate.activeRound === null
      ));
      if (!document) return null;
      Object.assign(document, update.$set || {});
      return document;
    },
  };
}

function createFakeDb(collection) {
  return { collection: () => collection };
}

test('new groups are scheduled for an immediate first game', async () => {
  const games = createFakeCollection();
  const before = Date.now();

  await registerMiniGameGroup(createFakeDb(games), '-100', 'Test group');

  assert.equal(games.documents.length, 1);
  assert.ok(games.documents[0].nextGameAt.valueOf() >= before);
  assert.ok(games.documents[0].nextGameAt.valueOf() <= Date.now());
});

test('existing groups keep their scheduled next game time', async () => {
  const scheduledAt = new Date(Date.now() + 30 * 60 * 1000);
  const games = createFakeCollection([{
    _id: 'one',
    groupId: '-100',
    groupName: 'Existing group',
    nextGameAt: scheduledAt,
    activeRound: null,
    enabled: true,
  }]);

  await registerMiniGameGroup(createFakeDb(games), '-100', 'Existing group');

  assert.equal(games.documents[0].nextGameAt.valueOf(), scheduledAt.valueOf());
});

test('a due game sends one game to its registered group', async () => {
  const games = createFakeCollection([{
    _id: 'one',
    groupId: '-100',
    enabled: true,
    nextGameAt: new Date(0),
    activeRound: null,
  }]);
  const sent = [];
  const telegram = {
    async sendPhoto(groupId) {
      sent.push(groupId);
    },
  };

  await startDueMiniGames({
    db: createFakeDb(games),
    telegram,
  });

  assert.deepEqual(sent, ['-100']);
  assert.ok(games.documents[0].activeRound);
  assert.equal(games.documents[0].activeRound.expiresAt instanceof Date, true);
});

test('failed delivery is retried instead of being delayed for an hour', async () => {
  const games = createFakeCollection([{
    _id: 'one',
    groupId: '-100',
    enabled: true,
    nextGameAt: new Date(0),
    activeRound: null,
  }]);
  const telegram = {
    async sendPhoto() {
      throw new Error('chat unavailable');
    },
  };
  const errors = [];

  await startDueMiniGames({
    db: createFakeDb(games),
    telegram,
    logger: { error: (...args) => errors.push(args.join(' ')) },
  });

  assert.equal(games.documents[0].activeRound, null);
  assert.ok(games.documents[0].nextGameAt.valueOf() > Date.now());
  assert.match(errors[0], /retrying in 60 seconds/);
});