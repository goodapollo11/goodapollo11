'use strict';
// Model Context Protocol server (Streamable HTTP, stateless, JSON responses) so AI staff - Claude, ChatGPT,
// or any MCP client - can run the office: every allowed operation is a tool, plus resources and workflow prompts.
const { OPS, BY_NAME, execute, permitted } = require('./ops');
const { HttpError } = require('./util');
const { company, tz, baseUrl } = require('./config');
const { setting } = require('./db');

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const VERSION = require('../package.json').version;
const OPEN_WORLD = new Set(['send_estimate', 'send_invoice', 'send_payment_reminder', 'email_send', 'email_create_draft', 'slack_post', 'calendar_sync_now']);
const DESTRUCTIVE = new Set(['void_invoice', 'delete_visit', 'set_job_status', 'email_modify', 'set_estimate_status']);
// Curated AI surface: these stay in the web app / REST API but are left out of the MCP tool list to keep the
// model's context small and keep price, timer and correction work with people.
const HIDDEN = new Set(['list_attachments', 'create_pricebook_item', 'update_pricebook_item', 'update_time_entry', 'update_expense', 'get_running_timers', 'get_visit',
  'get_task', 'get_service_plan', 'generate_plan_job', 'calendar_sync_now', 'set_checklist_item', 'delete_visit', 'start_timer', 'stop_timer']);
const exposed = o => !!o && o.mcp && !o.public && !HIDDEN.has(o.name);

const tools = ctx => OPS.filter(o => exposed(o) && permitted(o, ctx)).map(o => ({
  name: o.name, title: o.title || o.name, description: o.description || o.title || o.name,
  inputSchema: { type: 'object', ...o.input },
  annotations: {
    title: o.title || o.name, readOnlyHint: o.method === 'GET',
    destructiveHint: o.method === 'GET' ? false : (o.method === 'DELETE' || DESTRUCTIVE.has(o.name)),
    idempotentHint: o.method === 'GET' || o.method === 'PUT', openWorldHint: OPEN_WORLD.has(o.name)
  }
}));

// Drop nulls, empty strings and internal tokens to keep tool results compact for the model.
// Empty arrays are kept: "no conflicts" / "nothing to do" is information the model needs.
function compact(v) {
  if (Array.isArray(v)) return v.map(compact);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === '' || k === 'public_token' || k === 'portal_token' || k === 'password_hash' || k === 'is_demo') continue;
      o[k] = compact(x);
    }
    return o;
  }
  return v;
}
const text = obj => [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(compact(obj)) }];

// ---------------- resources ----------------
const RESOURCES = [
  { uri: 'nurzworks://business/profile', name: 'business-profile', title: 'Business profile', description: 'Company details, hours, service area, terms, services & prices, team, playbook.', mimeType: 'application/json', op: 'get_business_profile' },
  { uri: 'nurzworks://playbook', name: 'playbook', title: 'Office playbook', description: 'Standing instructions for AI office staff.', mimeType: 'text/markdown', op: 'get_playbook', pick: r => r.playbook },
  { uri: 'nurzworks://briefing/today', name: 'briefing', title: "Today's briefing", description: 'What needs attention today.', mimeType: 'application/json', op: 'get_briefing' },
  { uri: 'nurzworks://pricebook', name: 'pricebook', title: 'Price book', description: 'Services, labor, materials and fees with prices.', mimeType: 'text/markdown', op: 'list_pricebook',
    pick: rows => `| id | code | name | kind | unit | price |\n|---|---|---|---|---|---|\n${rows.map(r => `| ${r.id} | ${r.code} | ${r.name} | ${r.kind} | ${r.unit} | ${r.price.toFixed(2)} |`).join('\n')}` },
  { uri: 'nurzworks://team', name: 'team', title: 'Team', description: 'People and AI staff with ids and roles.', mimeType: 'application/json', op: 'list_team' }
];
const TEMPLATES = [
  { uriTemplate: 'nurzworks://customers/{id}', name: 'customer', title: 'Customer', description: 'A customer with contacts, locations, jobs, invoices and history.', mimeType: 'application/json', op: 'get_customer' },
  { uriTemplate: 'nurzworks://jobs/{id}', name: 'job', title: 'Job', description: 'A job with visits, items, time, costs and history.', mimeType: 'application/json', op: 'get_job' },
  { uriTemplate: 'nurzworks://estimates/{id}', name: 'estimate', title: 'Estimate', mimeType: 'application/json', op: 'get_estimate' },
  { uriTemplate: 'nurzworks://invoices/{id}', name: 'invoice', title: 'Invoice', mimeType: 'application/json', op: 'get_invoice' }
];
async function readResource(uri, ctx) {
  const fixed = RESOURCES.find(r => r.uri === uri);
  if (fixed) {
    const out = await execute(BY_NAME.get(fixed.op), {}, ctx);
    const body = fixed.pick ? fixed.pick(out) : out;
    return { contents: [{ uri, mimeType: fixed.mimeType, text: typeof body === 'string' ? body : JSON.stringify(compact(body)) }] };
  }
  const m = String(uri).match(/^nurzworks:\/\/(customers|jobs|estimates|invoices)\/(\d+)$/);
  if (m) {
    const t = TEMPLATES.find(x => x.uriTemplate.startsWith(`nurzworks://${m[1]}/`));
    const out = await execute(BY_NAME.get(t.op), { id: Number(m[2]) }, ctx);
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(compact(out)) }] };
  }
  throw rpcError(-32002, `Resource not found: ${uri}`);
}

// ---------------- prompts (repeatable office workflows) ----------------
const PROMPTS = [
  { name: 'daily_office_run', title: 'Run the daily office routine', description: 'Morning routine: briefing, your task queue, suggested actions, then a summary to Slack.', arguments: [],
    text: () => `Run today's office routine for ${company().name}.\n1. Call get_me and get_playbook and follow the playbook.\n2. Call get_briefing. Work through suggested_actions from the top, using the tool named on each.\n3. Call list_tasks with assigned_to="me"; complete what you can (update_task status="done" with a result).\n4. Do not send customer emails directly unless your instructions allow it - create drafts with email_create_draft.\n5. Finish with a short summary of what you did and what needs the owner, posted with slack_post (if Slack is connected) and returned to me.` },
  { name: 'triage_inbox', title: 'Triage the business inbox', description: 'Read unread email, link it to customers, turn requests into leads/jobs, draft replies.', arguments: [{ name: 'max', description: 'How many threads to review (default 20)', required: false }],
    text: a => `Triage the business Gmail inbox.\n1. email_list with label="UNREAD" (max ${Number(a.max) || 20}).\n2. For each thread: email_get_thread. Identify the sender; if they are a customer, email_link it (search with list_customers if not auto-matched).\n3. Classify: new work request, scheduling, billing/payment, question, vendor, or junk.\n   - New work: create_request (source "email"), then convert_request when it is clear.\n   - Scheduling: check list_visits / find_availability and propose times.\n   - Billing: check get_invoice / get_ar_aging.\n4. Draft a reply for anything that needs one with email_create_draft (thread_id = the thread). Never invent prices; use list_pricebook.\n5. email_modify read=true for threads you handled; leave anything that needs the owner unread and create a task assigned to the owner.\n6. Report a table: sender, topic, what you did, what is waiting on the owner.` },
  { name: 'schedule_unscheduled_jobs', title: 'Schedule unscheduled jobs', description: 'Book visits for jobs waiting to be scheduled.', arguments: [{ name: 'days', description: 'How far ahead to look (default 7)', required: false }],
    text: a => `Schedule the jobs that are waiting.\n1. list_jobs status="unscheduled" (urgent and high priority first).\n2. For each, get_job to see the address, scope and any preferred date in the description.\n3. find_availability for the next ${Number(a.days) || 7} days with a sensible duration (default visit length unless the scope says otherwise).\n4. schedule_visit in the best slot (group nearby addresses on the same day when you can). Check the returned conflicts.\n5. Draft a confirmation email to each customer with email_create_draft.\n6. Summarize the new schedule.` },
  { name: 'invoice_completed_jobs', title: 'Invoice completed jobs', description: 'Create and send invoices for finished work.', arguments: [],
    text: () => `Invoice completed work.\n1. list_jobs status="to_invoice".\n2. For each: get_job and review items, time and expenses. If something looks missing (no items and no time), create a task for the owner instead.\n3. create_invoice with job_id. Review the totals.\n4. send_invoice if your instructions allow sending; otherwise leave it as a draft and list it for the owner.\n5. Report invoice numbers and totals.` },
  { name: 'collect_overdue_invoices', title: 'Follow up on overdue invoices', description: 'Polite payment reminders and escalation.', arguments: [],
    text: () => `Follow up on unpaid invoices.\n1. get_ar_aging.\n2. For each overdue invoice: if no reminder in the last 7 days, send_payment_reminder (or draft a personal note with email_create_draft for long-standing customers).\n3. More than 60 days late: create_task for the owner with the history.\n4. add_note on the customer for each follow-up.\n5. Report who owes what and what you did.` },
  { name: 'new_lead_intake', title: 'Take in a new lead', description: 'Turn a lead description (call notes, email, voicemail) into a request, customer and next step.', arguments: [{ name: 'details', description: 'Everything known about the lead', required: true }],
    text: a => `New lead:\n"""\n${a.details || ''}\n"""\n1. list_customers to check whether they already exist (search by phone, email and name).\n2. create_request with source and details, then convert_request (to "estimate" if they need a price, "job" for straightforward service).\n3. If it is a job, find_availability and propose two times. If it is an estimate, build it from list_pricebook with create_estimate (leave as draft).\n4. Draft a friendly reply with email_create_draft if we have their email.\n5. Summarize next steps.` },
  { name: 'weekly_review', title: 'Weekly business review', description: 'Numbers, pipeline and team utilization with recommendations.', arguments: [],
    text: () => `Prepare the weekly business review for ${company().name}.\nUse get_report kind="summary" for the last 7 days and month to date, kind="pipeline", kind="team", and get_ar_aging.\nWrite: headline numbers (revenue, collected, receivables, jobs completed, billable %), what changed vs last week, top 3 risks, top 3 opportunities, and concrete actions for next week. Post a short version with slack_post.` }
];

// ---------------- JSON-RPC dispatch ----------------
function rpcError(code, message, data) { const e = new Error(message); e.rpc = { code, message, ...(data ? { data } : {}) }; return e; }
function instructions(ctx) {
  return `NurzWorks HQ - the business system for ${company().name} (mobile service & consulting). You are signed in as ${ctx.actor} (role ${ctx.user.role}; scopes ${ctx.scopes.join(', ')}).
Time zone: ${tz()}. Date-times without an offset are read in that zone. Money is in ${setting('currency') || 'USD'}.
Start each session with get_me, get_playbook and get_briefing. Search before creating (list_customers, search). Record calls and decisions with add_note. Your work queue is list_tasks(assigned_to="me").
Prefer email_create_draft over email_send unless your instructions allow sending. Customer links: estimates and invoices include public_url. App: ${baseUrl()}`;
}
async function handleOne(msg, ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    if (msg && msg.jsonrpc === '2.0' && (msg.result !== undefined || msg.error !== undefined)) return null; // client response to us: ignore
    return { jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const isNote = msg.id === undefined || msg.id === null;
  try {
    const result = await dispatch(msg.method, msg.params || {}, ctx);
    return isNote ? null : { jsonrpc: '2.0', id: msg.id, result };
  } catch (e) {
    if (isNote) return null;
    if (e.rpc) return { jsonrpc: '2.0', id: msg.id, error: e.rpc };
    console.error('[mcp]', e);
    return { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: 'Internal error' } };
  }
}
async function dispatch(method, params, ctx) {
  switch (method) {
    case 'initialize': {
      const v = SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0];
      return { protocolVersion: v, capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false }, logging: {} },
        serverInfo: { name: 'nurzworks-hq', title: `${company().name} HQ`, version: VERSION }, instructions: instructions(ctx) };
    }
    case 'ping': return {};
    case 'logging/setLevel': return {};
    case 'tools/list': return { tools: tools(ctx) };
    case 'tools/call': {
      const o = BY_NAME.get(params.name);
      if (!exposed(o)) throw rpcError(-32602, `Unknown tool: ${params.name}`);
      if (!permitted(o, ctx)) return { content: text(`Not allowed: your role/scopes do not permit ${o.name}.`), isError: true };
      try {
        const out = await execute(o, params.arguments || {}, ctx);
        return { content: text(out === undefined ? { ok: true } : out), isError: false };
      } catch (e) {
        if (e instanceof HttpError) return { content: text(`Error: ${e.message}`), isError: true };
        console.error(`[mcp tool ${o.name}]`, e);
        return { content: text(`Error: ${e.message || 'Server error'}`), isError: true };
      }
    }
    case 'resources/list': return { resources: RESOURCES.filter(r => permitted(BY_NAME.get(r.op), ctx)).map(({ op, pick, ...r }) => r) };
    case 'resources/templates/list': return { resourceTemplates: TEMPLATES.filter(r => permitted(BY_NAME.get(r.op), ctx)).map(({ op, ...r }) => r) };
    case 'resources/read': {
      try { return await readResource(params.uri, ctx); }
      catch (e) { if (e.rpc) throw e; throw rpcError(e.status === 404 ? -32002 : -32603, e.message); }
    }
    case 'prompts/list': return { prompts: PROMPTS.map(p => ({ name: p.name, title: p.title, description: p.description, arguments: p.arguments })) };
    case 'prompts/get': {
      const p = PROMPTS.find(x => x.name === params.name);
      if (!p) throw rpcError(-32602, `Unknown prompt: ${params.name}`);
      for (const a of p.arguments) if (a.required && !(params.arguments && params.arguments[a.name])) throw rpcError(-32602, `Missing argument: ${a.name}`);
      return { description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.text(params.arguments || {}) } }] };
    }
    case 'completion/complete': return { completion: { values: [], total: 0, hasMore: false } };
    default:
      if (method.startsWith('notifications/')) return {};
      throw rpcError(-32601, `Method not found: ${method}`);
  }
}
// body may be a single message or (older protocol versions) a batch array
async function handle(body, ctx) {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => handleOne(m, ctx)))).filter(Boolean);
    return out.length ? out : null;
  }
  return handleOne(body, ctx);
}

module.exports = { handle, tools, exposed, PROMPTS, RESOURCES, TEMPLATES, compact, SUPPORTED, HIDDEN };
