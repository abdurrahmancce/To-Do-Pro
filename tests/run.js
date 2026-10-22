/* Runs the whole suite:  cd tests && npm install && npm test  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const run = require('./e2e');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain' };
const marker = { value: 0 }; // lets the service-worker test pretend a new release was published

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  let body = fs.readFileSync(file);
  if (marker.value && path.basename(file) === 'script.js') body = Buffer.concat([body, Buffer.from(`\nwindow.__marker = ${marker.value};\n`)]);
  // like GitHub Pages: files may be cached for 10 minutes unless the browser revalidates
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=600' });
  res.end(body);
});

server.listen(0, '127.0.0.1', async () => {
  const PORT = server.address().port;
  fs.mkdirSync(OUT, { recursive: true });
  let results = [];
  try { results = await run({ BASE: `http://localhost:${PORT}`, ROOT, OUT, PORT, marker }); }
  catch (e) { console.error(e); process.exitCode = 1; }
  server.close();
  const pass = results.filter((r) => r[0] === 'PASS').length;
  for (const r of results) console.log(r[0], '-', r[1], r[2] ? '-> ' + r[2] : '');
  console.log(`\n${pass}/${results.length} passed`);
  if (pass !== results.length) process.exitCode = 1;
});
