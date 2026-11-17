'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const { boot, owner, aiKey, mcp, futureWeekday } = require('./helpers');

let H, c, ai, readOnly;
test.before(async () => {
  H = await boot(); c = await owner(H.base);
  ai = await aiKey(c, { name: 'Ava', scopes: ['read', 'write'] });
  readOnly = await aiKey(c, { name: 'Reader', role: 'viewer', scopes: ['read'] });
});
test.after(async () => { await H.close(); });
const call = (key, name, args, id = 1) => mcp(H.base, key, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const json = r => JSON.parse(r.data.result.content[0].text);

test('initialize negotiates the protocol version and gives instructions', async () => {
  const r = await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(r.status, 200);
  assert.equal(r.data.result.protocolVersion, '2025-03-26');
  assert.ok(r.data.result.capabilities.tools);
  assert.match(r.data.result.instructions, /Ava \(AI\)/);
  const r2 = await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(r2.data.result.protocolVersion, '2025-06-18', 'falls back to the newest supported version');
  const note = await mcp(H.base, ai.key, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(note.status, 202);
  assert.deepEqual((await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 3, method: 'ping' })).data.result, {});
});

test('authentication: bearer header, secret URL, bad keys, GET not allowed', async () => {
  assert.equal((await mcp(H.base, 'nwk_nope', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 401);
  assert.equal((await mcp(H.base, null, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 401);
  const viaUrl = await mcp(H.base, null, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { path: new URL(ai.mcp_secret_url).pathname });
  assert.equal(viaUrl.status, 200);
  assert.equal((await fetch(H.base + '/mcp')).status, 405);
});

test('tools are filtered by role and key scopes', async () => {
  const office = (await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).data.result.tools.map(t => t.name);
  assert.ok(office.includes('create_customer') && office.includes('get_briefing') && office.includes('email_create_draft'));
  assert.ok(!office.includes('email_send'), 'email.send scope not granted');
  assert.ok(!office.includes('delete_customer') && !office.includes('create_api_key'), 'destructive/admin tools are never exposed');
  const ro = (await mcp(H.base, readOnly.key, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).data.result.tools;
  assert.ok(ro.every(t => t.annotations.readOnlyHint), 'read-only key sees read-only tools');
  const t = (await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).data.result.tools.find(x => x.name === 'schedule_visit');
  assert.equal(t.inputSchema.type, 'object');
  assert.deepEqual(t.inputSchema.required, ['job_id', 'start']);
  const denied = await call(readOnly.key, 'create_task', { title: 'x' });
  assert.equal(denied.data.result.isError, true);
});

test('an AI staff member can run a lead-to-schedule flow', async () => {
  const cust = json(await call(ai.key, 'create_customer', { name: 'Root River Water Utility', email: 'ops@rootriver.example', phone: '262-555-0190', address: { street: '1200 State St', city: 'Racine', state: 'WI' } }));
  assert.equal(cust.number, 'C-00001');
  assert.equal(cust.public_token, undefined, 'internal tokens are stripped from AI output');
  const job = json(await call(ai.key, 'create_job', { customer_id: cust.id, title: 'Flow meter signal dropouts', priority: 'urgent', type: 'repair' }));
  const day = futureWeekday(6);
  const slots = json(await call(ai.key, 'find_availability', { date_from: day, date_to: day, duration_minutes: 90 }));
  assert.ok(slots.slots.length > 0);
  const v = json(await call(ai.key, 'schedule_visit', { job_id: job.id, start: slots.slots[0].start, duration_minutes: 90, assignees: [slots.slots[0].user_id], notes: 'Bring loop calibrator' }));
  assert.equal(v.status, 'scheduled');
  assert.deepEqual(v.conflicts, [], 'no conflicts is reported explicitly');
  const note = json(await call(ai.key, 'add_note', { entity_type: 'customer', entity_id: cust.id, body: 'Called Linda, confirmed access', kind: 'call' }));
  assert.equal(note.author, 'Ava (AI)', 'work is attributed to the AI staff member');
  const task = json(await call(ai.key, 'create_task', { title: 'Confirm with customer', assigned_to: 'me', due_date: day }));
  const mine = json(await call(ai.key, 'list_tasks', { assigned_to: 'me' }));
  assert.ok(mine.some(t => t.id === task.id));
  const done = json(await call(ai.key, 'update_task', { id: task.id, status: 'done', result: 'Customer confirmed by email' }));
  assert.equal(done.status, 'done');
  const brief = json(await call(ai.key, 'get_briefing', {}));
  assert.ok(Array.isArray(brief.suggested_actions));
  const log = await c.get('/api/ai/activity');
  assert.ok(log.some(r => r.op === 'schedule_visit' && r.user_name === 'Ava'), 'calls are logged per AI staff member');
});

test('validation errors and unknown tools come back usefully', async () => {
  const bad = await call(ai.key, 'schedule_visit', { job_id: 1, start: 'next tuesday' });
  assert.equal(bad.data.result.isError, true);
  assert.match(bad.data.result.content[0].text, /date-time/);
  const missing = await call(ai.key, 'create_customer', {});
  assert.match(missing.data.result.content[0].text, /name is required/);
  const unknown = await call(ai.key, 'drop_database', {});
  assert.equal(unknown.data.error.code, -32602);
  const hidden = await call(ai.key, 'update_pricebook_item', { id: 1, price: 0 });
  assert.equal(hidden.data.error.code, -32602, 'curated-out tools cannot be called either');
  const m = await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 9, method: 'no/such/method' });
  assert.equal(m.data.error.code, -32601);
});

test('resources and prompts', async () => {
  const res = (await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 1, method: 'resources/list' })).data.result.resources.map(r => r.uri);
  assert.ok(res.includes('nurzworks://playbook') && res.includes('nurzworks://business/profile'));
  const pb = await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'nurzworks://playbook' } });
  assert.match(pb.data.result.contents[0].text, /Office playbook/);
  const cust = await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'nurzworks://customers/1' } });
  assert.equal(JSON.parse(cust.data.result.contents[0].text).name, 'Root River Water Utility');
  const nf = await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'nurzworks://nope' } });
  assert.equal(nf.data.error.code, -32002);
  const prompts = (await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 5, method: 'prompts/list' })).data.result.prompts.map(p => p.name);
  assert.ok(prompts.includes('daily_office_run') && prompts.includes('triage_inbox'));
  const p = await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 6, method: 'prompts/get', params: { name: 'new_lead_intake', arguments: { details: 'Jane, 262-555-0101, furnace' } } });
  assert.match(p.data.result.messages[0].content.text, /Jane, 262-555-0101/);
  const missing = await mcp(H.base, ai.key, { jsonrpc: '2.0', id: 7, method: 'prompts/get', params: { name: 'new_lead_intake', arguments: {} } });
  assert.equal(missing.data.error.code, -32602);
});

test('batch requests (older protocol versions)', async () => {
  const r = await mcp(H.base, ai.key, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  assert.equal(r.data.length, 2);
});

test('OpenAPI spec and llms.txt describe the same operations', async () => {
  const spec = await (await fetch(H.base + '/api/openapi.json')).json();
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.paths['/api/jobs/{job_id}/visits'].post.operationId, 'schedule_visit');
  assert.ok(spec.paths['/api/customers'].get.parameters.some(p => p.name === 'q' && p.in === 'query'));
  const txt = await (await fetch(H.base + '/llms.txt')).text();
  assert.match(txt, /schedule_visit/);
  assert.match(txt, /Time zone: America\/Chicago/);
});

test('stdio bridge relays MCP messages for desktop clients', async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'mcp-stdio.js')], { env: { ...process.env, NW_URL: H.base, NW_API_KEY: ai.key } });
  const lines = [];
  let buf = '';
  child.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_me', arguments: {} } }) + '\n');
  child.stdin.end();
  await new Promise(r => child.on('exit', r));
  assert.equal(lines.length, 2, 'notifications produce no output');
  assert.equal(lines[0].result.serverInfo.name, 'nurzworks-hq');
  assert.equal(JSON.parse(lines[1].result.content[0].text).name, 'Ava');
});
