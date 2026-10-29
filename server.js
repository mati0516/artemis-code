// Artemis Code — a bridge screen for your Claude Code officer.
// Follows the newest Claude Code session log, shows the conversation and the tools
// at work, and sends what you type into the claude running in a tmux session.
//
//   ARTEMIS_PROJECT=/path/to/your/project  ARTEMIS_TMUX=artemis  node server.js
//
// MIT License. See LICENSE.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.ARTEMIS_PORT || 8700);
const HOST = process.env.ARTEMIS_HOST || '127.0.0.1';
const PROJECT = process.env.ARTEMIS_PROJECT || '';          // folder where claude runs ('' = any)
const TMUX = process.env.ARTEMIS_TMUX || 'artemis';         // tmux session that runs claude
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PUBLIC = path.join(__dirname, 'public');
const VOICE_DIR = path.join(__dirname, 'voice-out');        // drop WAV/MP3 here for /api/audio
const KEEP = 200;                                           // messages kept in memory

// ── where the session logs are ─────────────────────────────────────
// Claude Code names the folder after the project path with / and . turned into -.
function projectDirs() {
  const root = path.join(CLAUDE_DIR, 'projects');
  if (PROJECT) return [path.join(root, path.resolve(PROJECT).replace(/[/\\.:]/g, '-'))];
  try { return fs.readdirSync(root).map(d => path.join(root, d)); } catch { return []; }
}
function newestLog() {
  let best = null;
  for (const dir of projectDirs()) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const p = path.join(dir, n);
      try {
        const m = fs.statSync(p).mtimeMs;
        if (!best || m > best.m) best = { p, m };
      } catch {}
    }
  }
  return best && best.p;
}

// ── reading the log ────────────────────────────────────────────────
const state = { file: null, offset: 0, rest: '', chat: [], tools: new Map(), busy: false };

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => c && c.type === 'text').map(c => c.text).join('\n');
}
function brief(input) {
  if (!input || typeof input !== 'object') return '';
  const v = input.description || input.command || input.file_path || input.pattern || input.url || input.prompt || '';
  return String(v).replace(/\s+/g, ' ').slice(0, 120);
}
// Lines the harness writes into the "user" role that are not the user speaking.
function isMachineText(t) {
  return !t.trim() || /^<[a-z]+(-[a-z]+)+[ >]/.test(t.trim()) || t.startsWith('Caveat:');
}

function push(msg) {
  state.chat.push(msg);
  if (state.chat.length > KEEP) state.chat.splice(0, state.chat.length - KEEP);
  broadcast({ type: 'chat', msg });
}

function take(entry) {
  const at = entry.timestamp || new Date().toISOString();
  const m = entry.message;
  if (!m) return;
  if (entry.type === 'user') {
    if (Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c && c.type === 'tool_result' && state.tools.has(c.tool_use_id)) {
          state.tools.delete(c.tool_use_id);
          broadcast({ type: 'tooldone', id: c.tool_use_id, err: !!c.is_error });
        }
      }
    }
    const t = textOf(m.content);
    if (!entry.isMeta && !isMachineText(t)) {
      push({ role: 'user', text: t, at });
      setBusy(true);
    }
  } else if (entry.type === 'assistant') {
    for (const c of (Array.isArray(m.content) ? m.content : [])) {
      if (c.type === 'text' && c.text.trim()) push({ role: 'assistant', text: c.text, at });
      if (c.type === 'tool_use') {
        const tool = { id: c.id, name: c.name, arg: brief(c.input), at };
        state.tools.set(c.id, tool);
        broadcast({ type: 'tool', tool });
      }
    }
    if (m.stop_reason === 'end_turn') setBusy(false);
  }
}
function setBusy(b) {
  if (state.busy === b) return;
  state.busy = b;
  if (!b) state.tools.clear();
  broadcast({ type: 'turn', state: b ? 'start' : 'end' });
}

function poll() {
  const f = newestLog();
  if (f !== state.file) {               // a new conversation: start over from its beginning
    Object.assign(state, { file: f, offset: 0, rest: '', chat: [], busy: false });
    state.tools.clear();
    broadcast({ type: 'reset' });
  }
  if (!f) return;
  let size;
  try { size = fs.statSync(f).size; } catch { return; }
  if (size < state.offset) state.offset = 0;
  if (size === state.offset) return;
  const fd = fs.openSync(f, 'r');
  const buf = Buffer.alloc(size - state.offset);
  fs.readSync(fd, buf, 0, buf.length, state.offset);
  fs.closeSync(fd);
  state.offset = size;
  const lines = (state.rest + buf.toString('utf8')).split('\n');
  state.rest = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try { take(JSON.parse(line)); } catch {}
  }
}

// ── talking to claude (tmux) ───────────────────────────────────────
function send(text) {
  return new Promise((resolve) => {
    const t = String(text).replace(/\r?\n/g, ' ').slice(0, 4000);
    execFile('tmux', ['send-keys', '-t', TMUX, '-l', t], (e1) => {
      if (e1) return resolve({ ok: false, error: `tmux session "${TMUX}" not found` });
      // a short pause, then Enter on its own (sent together it may be taken as a paste)
      setTimeout(() => execFile('tmux', ['send-keys', '-t', TMUX, 'Enter'], (e2) => resolve({ ok: !e2 })), 400);
    });
  });
}

// ── http + websocket ───────────────────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

function serveFile(res, base, rel) {
  const p = path.normalize(path.join(base, rel));
  if (!p.startsWith(base)) { res.writeHead(403).end(); return; }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/api/state') {
    return json(res, 200, { chat: state.chat, tools: [...state.tools.values()], busy: state.busy, session: state.file ? path.basename(state.file, '.jsonl') : null });
  }
  if (req.method === 'POST' && url.pathname === '/api/send') {
    const b = await body(req);
    if (!b.text || !String(b.text).trim()) return json(res, 400, { ok: false });
    return json(res, 200, await send(b.text));
  }
  // Hook for a voice pipeline (see docs/VOICE.md): {url, dur}
  if (req.method === 'POST' && url.pathname === '/api/audio') {
    const b = await body(req);
    if (b.url) broadcast({ type: 'audio', url: String(b.url), dur: Number(b.dur) || 0 });
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/voice/')) return serveFile(res, VOICE_DIR, url.pathname.slice(7));
  if (req.method === 'GET') return serveFile(res, PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname);
  res.writeHead(405).end();
});

const wss = new WebSocketServer({ server, path: '/events' });
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}

setInterval(poll, 400);
poll();
server.listen(PORT, HOST, () => {
  console.log(`Artemis Code: http://${HOST}:${PORT}/`);
  console.log(`  reading : ${PROJECT ? path.resolve(PROJECT) : 'newest session of any project'}`);
  console.log(`  sending : tmux session "${TMUX}"`);
});
