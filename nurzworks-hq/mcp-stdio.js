#!/usr/bin/env node
'use strict';
// stdio <-> HTTP bridge so desktop MCP clients that only launch local commands (e.g. Claude Desktop config files)
// can talk to NurzWorks HQ running locally or in the cloud.
//   NW_URL=https://hq.example.com NW_API_KEY=nwk_... node mcp-stdio.js
const readline = require('readline');
const BASE = (process.env.NW_URL || 'http://localhost:4200').replace(/\/+$/, '');
const KEY = process.env.NW_API_KEY || '';
if (!KEY) { process.stderr.write('NW_API_KEY is not set. Create an API key under Team & AI staff in NurzWorks HQ.\n'); process.exit(1); }

const out = obj => process.stdout.write(JSON.stringify(obj) + '\n');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = 0, closing = false;
rl.on('line', async line => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch (_) { out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  pending++;
  try {
    const res = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${KEY}` }, body: JSON.stringify(msg) });
    if (res.status === 202) return;
    const text = await res.text();
    try { const data = JSON.parse(text); (Array.isArray(data) ? data : [data]).forEach(out); }
    catch (_) { if (msg.id !== undefined) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: `HQ returned HTTP ${res.status}: ${text.slice(0, 200)}` } }); }
  } catch (e) {
    if (msg && msg.id !== undefined) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: `Cannot reach NurzWorks HQ at ${BASE}: ${e.message}` } });
  } finally { pending--; if (closing && !pending) process.exit(0); }
});
rl.on('close', () => { closing = true; if (!pending) process.exit(0); });
