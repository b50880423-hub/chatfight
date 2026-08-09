import http from 'node:http';

export function buildHealthPayload() {
  return {
    status: 'ok',
    service: 'chatfight',
  };
}

export function createHealthServer(port = process.env.HEALTH_PORT || 3001) {
  return http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildHealthPayload()));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });
}
