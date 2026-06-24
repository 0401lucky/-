import http from 'node:http';
import { spawnSync } from 'node:child_process';

const port = Number(process.env.ADMIN_CARDS_GO_API_PROXY_PORT || 18080);
const cookie = process.env.ADMIN_CARDS_GO_API_COOKIE || '';
const origin = process.env.ADMIN_CARDS_GO_API_ORIGIN || 'http://127.0.0.1:8080';

function parseStatus(output) {
  const matches = [...output.matchAll(/HTTP\/\d(?:\.\d)?\s+(\d{3})/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : 0;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function dockerWget(method, path, body, headers) {
  const args = ['compose', 'exec', '-T', 'api', 'wget', '-S', '-O', '-'];
  for (const [key, value] of Object.entries(headers)) {
    if (value) args.push('--header', `${key}: ${value}`);
  }
  if (method === 'POST') {
    args.push('--post-data', body || '');
  }
  args.push(`http://127.0.0.1:8080${path}`);
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  const raw = `${result.stderr}\n${result.stdout}`;
  return { status: parseStatus(raw), body: result.stdout };
}

function dockerRawRequest(method, path, body, headers) {
  const bodyBytes = Buffer.byteLength(body || '');
  const requestLines = [
    `${method} ${path} HTTP/1.1`,
    'Host: 127.0.0.1:8080',
    'Connection: close',
    ...Object.entries(headers).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`),
  ];
  if (bodyBytes > 0) {
    requestLines.push(`Content-Length: ${bodyBytes}`);
  }
  requestLines.push('', body || '');

  const rawRequest = requestLines.join('\r\n');
  const command = `(printf %s ${shellQuote(rawRequest)}; sleep 1) | nc -w 5 127.0.0.1 8080`;
  const result = spawnSync('docker', ['compose', 'exec', '-T', 'api', 'sh', '-lc', command], { encoding: 'utf8' });
  const raw = `${result.stdout}\n${result.stderr}`;
  const separator = raw.indexOf('\r\n\r\n');
  const fallback = raw.indexOf('\n\n');
  const bodyStart = separator >= 0 ? separator + 4 : fallback >= 0 ? fallback + 2 : 0;
  return { status: parseStatus(raw), body: raw.slice(bodyStart).trim() };
}

function forward(method, path, body, contentType) {
  const headers = {
    Cookie: cookie,
    Origin: origin,
    'Content-Type': contentType || 'application/json',
  };
  if (method === 'PATCH') {
    return dockerRawRequest(method, path, body, headers);
  }
  return dockerWget(method, path, body, headers);
}

const server = http.createServer((request, response) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cookie, Origin',
  };
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }
  if (!request.url?.startsWith('/api/admin/cards')) {
    response.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ success: false, message: 'not proxied' }));
    return;
  }

  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const result = forward(request.method || 'GET', request.url || '/', body, request.headers['content-type']);
    response.writeHead(result.status || 502, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
    response.end(result.body || JSON.stringify({ success: false, message: 'empty proxy response' }));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`admin cards Go API proxy listening on http://127.0.0.1:${port}`);
});
