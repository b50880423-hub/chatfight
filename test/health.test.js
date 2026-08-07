import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildHealthPayload, createHealthServer } from '../src/health.js';

test('buildHealthPayload returns a healthy status payload', () => {
  const payload = buildHealthPayload();

  assert.deepEqual(payload, { status: 'ok', service: 'chatfight' });
});

test('createHealthServer responds to /healthz', async () => {
  const server = createHealthServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address();
  const response = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/healthz`, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body });
      });
    }).on('error', reject);
  });

  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, JSON.stringify({ status: 'ok', service: 'chatfight' }));
});

test('createHealthServer also responds to the root path for uptime monitors', async () => {
  const server = createHealthServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address();
  const response = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/`, (res) => {
      res.resume();
      res.on('end', () => resolve({ statusCode: res.statusCode }));
    }).on('error', reject);
  });

  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

  assert.equal(response.statusCode, 200);
});
