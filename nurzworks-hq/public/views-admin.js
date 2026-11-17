/* NurzWorks HQ - admin: team & AI staff, API keys / MCP connections, integrations, settings, profile */
'use strict';

// ======================= TEAM & AI STAFF =======================
VIEWS.team = async view => {
  const [team, keys, log] = await Promise.all([api('/api/team?include_inactive=1'), api('/api/keys'), api('/api/ai/activity?limit=60')]);
  const people = team.filter(u => u.kind === 'human'), ai = team.filter(u => u.kind === 'ai');
  view.innerHTML = `
  <div class="page-head"><div><h1>Team & AI staff</h1><div class="sub">People sign in with email and password. AI staff work through API keys (MCP or REST) and everything they do is recorded under their name.</div></div>
    <div class="actions"><button class="btn" id="addPerson">${icon('user')}Add person</button><button class="btn primary" id="addAi">${icon('ai')}Add AI staff member</button></div></div>
  <div class="card"><div class="card-h"><h2>${icon('users')} People</h2><span class="muted">${people.filter(u => u.active).length} active</span></div><div class="card-b flush" id="pplTbl">${table(people, [
    { label: 'Name', cls: 'title-cell', render: u => `${avatar(u)} ${e(u.name)} ${u.active ? '' : '<span class="tag">inactive</span>'}<div class="sub">${e(u.title || '')}</div>` },
    { label: 'Role', render: u => `<span class="tag">${e(u.role)}</span>` }, { label: 'Email', hideM: 1, render: u => e(u.email || '—') }, { label: 'Phone', hideM: 1, render: u => e(u.phone || '—') },
    { label: 'Rates', num: 1, hideM: 1, render: u => `${fmt.money(u.bill_rate)}/h <span class="sub">cost ${fmt.money(u.cost_rate)}</span>` }, { label: 'Sign-in', hideM: 1, render: u => u.has_password ? 'yes' : '<span class="muted">no password</span>' },
    { label: 'Last seen', hideM: 1, render: u => `<span class="muted">${fmt.rel(u.last_seen_at)}</span>` }
  ], { onRow: 1, compact: 1 })}</div></div>
  <div class="card mt"><div class="card-h"><h2>${icon('ai')} AI staff</h2><span class="muted">your AI office personnel</span></div><div class="card-b">${ai.length ? `<div class="grid g3">${ai.map(u => `<div class="card" style="box-shadow:none"><div class="card-b">
      <div class="row">${avatar(u, '')}<div class="grow"><b>${e(u.name)}</b> ${u.active ? '' : '<span class="tag">inactive</span>'}<div class="small muted">${e(u.title || 'AI staff')} · ${e(u.role)}</div></div></div>
      <div class="small muted mt-s" style="min-height:36px">${e((u.instructions || 'No standing instructions yet.').slice(0, 160))}</div>
      <div class="small mt-s">${u.key_count} key${u.key_count === 1 ? '' : 's'} · ${u.open_tasks} open task${u.open_tasks === 1 ? '' : 's'} · active ${fmt.rel(u.last_seen_at)}</div>
      <div class="row mt-s"><button class="btn sm primary" data-connect="${u.id}">${icon('key')}Connect an AI</button><button class="btn sm" data-edit="${u.id}">${icon('edit')}Edit</button><a class="btn sm" href="#/tasks?tab=ai">${icon('task')}Tasks</a></div></div></div>`).join('')}</div>`
    : `<div class="empty">${icon('ai')}No AI staff yet. Add one (for example "Ava - AI Office Manager"), then connect Claude or another AI with a key.</div>`}</div></div>
  <div class="card mt"><div class="card-h"><h2>${icon('key')} API keys</h2><span class="muted">each key acts as one team member</span></div><div class="card-b flush">${table(keys, [
    { label: 'Key', render: k => `<b>${e(k.name)}</b><div class="sub mono">${e(k.prefix)}…</div>` }, { label: 'Acts as', render: k => `${e(k.user_name)} ${k.user_kind === 'ai' ? '<span class="tag ai">AI</span>' : ''}` },
    { label: 'Scopes', render: k => k.scopes.split(',').map(s => `<span class="tag">${e(s)}</span>`).join(' ') }, { label: 'Last used', hideM: 1, render: k => k.last_used_at ? `${fmt.rel(k.last_used_at)} <span class="sub">(${k.use_count})</span>` : '<span class="muted">never</span>' },
    { label: 'Status', render: k => k.revoked_at ? '<span class="pill st-void">revoked</span>' : '<span class="pill st-active">active</span>' },
    { label: '', render: k => k.revoked_at ? '' : `<button class="btn sm danger" data-revoke="${k.id}">Revoke</button>` }
  ], { compact: 1, empty: 'No API keys yet.' })}</div></div>
  <div class="card mt"><div class="card-h"><h2>${icon('list')} AI & API activity</h2><span class="muted">latest calls</span></div><div class="card-b flush">${table(log, [
    { label: 'When', render: c => `<span class="nowrap muted">${fmt.dt(c.created_at)}</span>` }, { label: 'Who', render: c => `${e(c.user_name || 'system')}${c.user_kind === 'ai' ? ' <span class="tag ai">AI</span>' : ''}` },
    { label: 'Tool', render: c => `<span class="mono">${e(c.op)}</span> <span class="tag">${e(c.via)}</span>` }, { label: 'Result', render: c => c.status >= 400 ? `<span class="overdue-flag">${c.status}</span> ${e(c.summary)}` : e(c.summary || 'ok') },
    { label: 'ms', num: 1, hideM: 1, render: c => c.ms }
  ], { compact: 1, empty: 'No AI activity yet. Connect an AI staff member to get started.' })}</div></div>`;
  $('#addPerson').onclick = () => memberForm({ kind: 'human' });
  $('#addAi').onclick = () => memberForm({ kind: 'ai' });
  bindTable($('#pplTbl'), people, { onRow: u => memberForm(u) });
  $$('[data-edit]', view).forEach(b => b.onclick = () => memberForm(team.find(u => u.id === +b.dataset.edit)));
  $$('[data-connect]', view).forEach(b => b.onclick = () => createKey(team.find(u => u.id === +b.dataset.connect)));
  $$('[data-revoke]', view).forEach(b => b.onclick = async () => { if (await confirmBox('Revoke key', 'Any AI or script using this key stops working immediately.', 'Revoke', true)) { await DEL('/api/keys/' + b.dataset.revoke); toast('Key revoked'); rerender(); } });
};
async function memberForm(u) {
  const isNew = !u.id; const ai = u.kind === 'ai';
  const roles = [['owner', 'Owner - everything'], ['admin', 'Admin - everything but owner settings'], ['office', 'Office / dispatch - customers, scheduling, billing, email'], ['field', 'Field technician - own visits, time, notes, photos'], ['viewer', 'Viewer - read-only (bookkeeper)']];
  const r = await formModal({ title: isNew ? (ai ? 'Add AI staff member' : 'Add person') : `Edit ${u.name}`, size: 'wide', okLabel: isNew ? 'Add' : 'Save',
    extraFoot: !isNew && !ai ? `<button class="btn left" id="setPw">${icon('key')}Set password</button>` : '',
    fields: [{ name: 'name', label: 'Name', value: u.name, required: 1, placeholder: ai ? 'Ava' : '' }, { name: 'title', label: 'Title', value: u.title, placeholder: ai ? 'AI Office Manager' : 'Field Technician' },
      { name: 'role', label: 'Role (what they can do)', type: 'select', options: ai ? roles.filter(x => x[0] !== 'owner') : roles, value: u.role || (ai ? 'office' : 'field'), full: 1 },
      ...(ai ? [] : [{ name: 'email', label: 'Email (sign-in)', type: 'email', value: u.email }, { name: 'phone', label: 'Phone', type: 'tel', value: u.phone }]),
      ...(ai ? [] : [{ name: 'bill_rate', label: 'Billing rate ($/h)', type: 'number', step: '0.01', value: u.bill_rate ?? S.meta.settings.default_bill_rate }, { name: 'cost_rate', label: 'Cost rate ($/h)', type: 'number', step: '0.01', value: u.cost_rate ?? '' }]),
      { name: 'color', label: 'Schedule color', type: 'color', value: u.color || '#1f6fd1' }, { name: 'active', label: 'Active', type: 'checkbox', value: u.active ?? 1 },
      ...(isNew && !ai ? [{ name: 'password', label: 'Password (8+ characters)', type: 'password', hint: 'They can change it later from their profile.' }] : []),
      ...(ai ? [{ name: 'instructions', label: 'Job description & standing instructions', type: 'textarea', rows: 6, full: 1, value: u.instructions, placeholder: 'You are our AI office manager. Each morning: triage the inbox, follow up on estimates older than 3 days, invoice completed jobs, and send payment reminders for invoices more than 7 days late. Draft customer emails for review; never send pricing changes.' }] : [])],
    onMount: ctx => { const sp = $('#setPw', ctx.el); if (sp) sp.onclick = async () => { const r2 = await formModal({ title: `Set password for ${u.name}`, size: 'narrow', okLabel: 'Set password', fields: [{ name: 'password', label: 'New password', type: 'password', full: 1, required: 1 }], save: v => POST(`/api/team/${u.id}/password`, v) }); if (r2) toast('Password set'); }; },
    save: v => isNew ? POST('/api/team', { ...v, kind: u.kind }) : PUT('/api/team/' + u.id, v) });
  if (r) { toast('Saved'); await loadMeta(); rerender(); if (isNew && ai) createKey(r); }
}
async function createKey(u) {
  const r = await formModal({ title: `Connect an AI as ${u.name}`, size: 'narrow', okLabel: 'Create key',
    fields: [{ type: 'html', full: 1, html: `<div class="callout info">${icon('ai')}<div>A key lets Claude (or another AI or script) act as <b>${e(u.name)}</b> with the ${e(u.role)} role. You'll see setup steps next.</div></div>` },
      { name: 'name', label: 'Key name', value: 'Claude', full: 1 },
      { name: 'scopes', label: 'Allowed', type: 'html', full: 1, html: [['read', 'Read records', true], ['write', 'Create & update records', true], ['email.send', 'Send email & estimates/invoices directly (otherwise drafts only)', false], ['admin', 'Admin', false]]
        .map(([k, l, on]) => `<label class="check"><input type="checkbox" data-scope="${k}" ${on ? 'checked' : ''}>${e(l)}</label>`).join('') }],
    save: (v, ctx) => POST('/api/keys', { user_id: u.id, name: v.name, scopes: $$('[data-scope]:checked', ctx.el).map(c => c.dataset.scope) }) });
  if (r) { rerender(); connectInfo(r); }
}
function connectInfo(k) {
  const desktop = JSON.stringify({ mcpServers: { nurzworks: { command: 'node', args: ['/path/to/nurzworks-hq/mcp-stdio.js'], env: { NW_URL: k.api_base.replace(/\/api$/, ''), NW_API_KEY: k.key } } } }, null, 2);
  const code = `claude mcp add --transport http nurzworks ${k.mcp_url} --header "Authorization: Bearer ${k.key}"`;
  const curl = `curl -H "Authorization: Bearer ${k.key}" ${k.api_base}/briefing`;
  const local = /localhost|127\.0\.0\.1/.test(k.mcp_url);
  const box = (val, rows = 0) => `<div class="copy-box">${rows ? `<textarea readonly rows="${rows}">${e(val)}</textarea>` : `<input readonly value="${e(val)}">`}<button type="button" class="btn sm" data-copy="${e(val)}">${icon('copy')}</button></div>`;
  modal({ title: `Connect ${k.user.name}`, size: 'wide', foot: '<button class="btn primary" data-x>Done</button>', body: `
    <div class="callout">${icon('key')}<div><b>Copy this key now - it is shown only once.</b> Treat it (and the secret URL) like a password; revoke it anytime from Team & AI staff.</div></div>
    <div class="field mt"><label>API key</label>${box(k.key)}</div>
    ${local ? `<div class="callout info mt">${icon('alert')}<div>This address (${e(k.mcp_url)}) only works on this computer. Cloud AIs like Claude.ai need a public https address - see "Put HQ online" in the README (Cloudflare Tunnel or a small cloud server), set it as Base URL in Settings, then create a new key.</div></div>` : ''}
    <h3 style="margin:18px 0 6px">Claude (claude.ai, desktop & mobile apps) - custom connector</h3>
    <ol class="steps"><li>In Claude open <b>Settings → Connectors → Add custom connector</b>.</li><li>Name it "${e(S.meta.company.name)} HQ" and paste this URL:</li></ol>${box(k.mcp_secret_url)}
    <ol class="steps" start="3"><li>Enable it in a chat (the tools menu) and say: <i>"Run the daily office routine."</i> - or pick a prompt like <b>triage_inbox</b>.</li></ol>
    <h3 style="margin:18px 0 6px">Claude Code</h3>${box(code)}
    <h3 style="margin:18px 0 6px">Claude Desktop (config file) or any stdio MCP client</h3><p class="muted small" style="margin:0 0 6px">Uses the bundled bridge <code>mcp-stdio.js</code>; change the path to where HQ is installed.</p>${box(desktop, 9)}
    <h3 style="margin:18px 0 6px">ChatGPT, Zapier, scripts (REST + OpenAPI)</h3><p class="muted small" style="margin:0 0 6px">ChatGPT custom connectors accept the same MCP URL. For GPT Actions or code, import the OpenAPI spec and send the key as a Bearer token.</p>
    ${box(k.openapi_url)}<div class="mt-s">${box(curl)}</div>`,
    onMount: ctx => $$('[data-copy]', ctx.el).forEach(b => b.onclick = () => copyText(b.dataset.copy)) });
}

// ======================= INTEGRATIONS =======================
VIEWS.integrations = async (view, r) => {
  const s = await api('/api/integrations');
  const [hooks, team] = await Promise.all([api('/api/webhooks'), Promise.resolve(S.meta.team)]);
  if (r.q.google === 'connected') toast(`Google connected${r.q.email ? ' as ' + r.q.email : ''}`);
  if (r.q.google_error) toast(r.q.google_error, 'error');
  const g = s.google, sl = s.slack;
  const ok = on => on ? '<span class="pill st-active"><span class="dot"></span>Connected</span>' : '<span class="pill st-draft"><span class="dot"></span>Not connected</span>';
  const box = val => `<div class="copy-box"><input readonly value="${e(val)}"><button type="button" class="btn sm" data-copy="${e(val)}">${icon('copy')}</button></div>`;
  const manifest = JSON.stringify({ display_information: { name: `${S.meta.company.name} HQ`, description: 'Business updates and /nurz commands', background_color: '#0f2a44' },
    features: { bot_user: { display_name: `${S.meta.company.name} HQ`, always_online: true }, slash_commands: [{ command: '/nurz', url: sl.command_url, description: 'Schedule, jobs, customers, leads and tasks', usage_hint: 'today | job JOB-00012 | customer Jane | lead Name | phone | details', should_escape: false }] },
    oauth_config: { scopes: { bot: ['chat:write', 'commands', 'incoming-webhook'] } }, settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false } }, null, 2);
  const local = /localhost|127\.0\.0\.1/.test(s.base_url);
  view.innerHTML = `
  <div class="page-head"><div><h1>Integrations</h1><div class="sub">Connect your Google Workspace, Slack, AI staff and website</div></div></div>
  ${local ? `<div class="notice warn">${icon('alert')}<span>HQ is running at <b>${e(s.base_url)}</b>. Google sign-in works locally, but Slack commands, customer links in emails and cloud AIs need a public https address. See "Put HQ online" in the README, then set the Base URL in Settings.</span><a class="btn sm" href="#/settings">Settings</a></div>` : ''}
  <div class="grid g2">
    <div class="card"><div class="card-h"><h2>${icon('google')} Google Workspace (Gmail + Calendar)</h2><div class="right">${ok(g.connected)}</div></div><div class="card-b">
      ${g.connected ? `<p style="margin-top:0">Connected as <b>${e(g.email)}</b> ${fmt.rel(g.connected_at)}.</p>${g.error ? `<div class="err">${e(g.error)}</div>` : ''}
        <form class="form" id="calForm" onsubmit="return false">
          <div class="field"><label>Calendar for visits</label><select name="calendar_id" id="calSel"><option value="${e(s.calendar.calendar_id)}">${e(s.calendar.calendar_id === 'primary' ? 'Primary calendar' : s.calendar.calendar_id)}</option></select></div>
          <div class="field"><label>Whose calendar is it?</label><select name="owner_user_id">${opt(team.filter(u => u.kind === 'human').map(u => [u.id, u.name]), s.calendar.owner_user_id, '—')}</select><div class="hint">Their Google busy time blocks scheduling.</div></div>
          <div class="field"><label class="check"><input type="checkbox" name="enabled" ${s.calendar.enabled ? 'checked' : ''}>Sync visits to Google Calendar</label></div>
          <div class="field"><label class="check"><input type="checkbox" name="invite_assignees" ${s.calendar.invite_assignees ? 'checked' : ''}>Invite assigned crew (their Workspace calendars)</label></div>
          <div class="field"><label class="check"><input type="checkbox" id="gmailOn" ${s.gmail.enabled ? 'checked' : ''}>Gmail inbox in HQ</label></div>
          <div class="field"><label>Check mail every (minutes)</label><input type="number" id="gmailPoll" min="0" value="${s.gmail.poll_minutes}"></div>
          <div class="full row"><button class="btn primary" id="calSave">Save</button><button class="btn" id="calSync">${icon('refresh')}Sync now</button><span class="muted small">${s.calendar.unsynced} visit(s) waiting · last pull ${fmt.rel(s.calendar.last_pull)} · mail ${fmt.rel(s.gmail.last_sync)}</span><span style="flex:1"></span><button class="btn danger" id="gDisc">Disconnect</button></div></form>`
      : `<ol class="steps"><li>In <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a> (signed in as your Workspace admin) create a project, e.g. "${e(S.meta.company.name)} HQ".</li>
          <li>APIs & Services → <b>Enable</b> the <b>Gmail API</b> and <b>Google Calendar API</b>.</li>
          <li>OAuth consent screen → User type <b>Internal</b> (only your Workspace) - no Google review needed.</li>
          <li>Credentials → Create OAuth client ID → <b>Web application</b>. Add this <b>Authorized redirect URI</b>:</li></ol>${box(g.redirect_uri)}
        <ol class="steps" start="5"><li>Paste the client ID and secret here, save, then click <b>Connect Google</b> and sign in as your business mailbox.</li></ol>
        <form class="form mt" id="gForm" onsubmit="return false"><div class="field full"><label>Client ID</label><input name="client_id" value="${e(g.client_id)}" placeholder="…apps.googleusercontent.com"></div>
          <div class="field full"><label>Client secret</label><input name="client_secret" type="password" placeholder="${g.configured ? 'saved - leave blank to keep' : ''}"></div>
          <div class="full row"><button class="btn" id="gSave">Save credentials</button>${g.configured ? `<a class="btn primary" href="/oauth/google/start">${icon('google')}Connect Google</a>` : ''}</div></form>`}
    </div></div>

    <div class="card"><div class="card-h"><h2>${icon('slack')} Slack</h2><div class="right">${ok(sl.configured)}</div></div><div class="card-b">
      <ol class="steps"><li>Go to <a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noopener">api.slack.com/apps</a> → Create New App → <b>From an app manifest</b>, pick your workspace, paste:</li></ol>
      <div class="copy-box"><textarea readonly rows="5">${e(manifest)}</textarea><button type="button" class="btn sm" data-copy="${e(manifest)}">${icon('copy')}</button></div>
      <ol class="steps" start="2"><li>Install the app to your workspace and pick the channel for updates.</li><li>Copy the <b>Bot User OAuth Token</b> (xoxb-…) or the Incoming Webhook URL, and the <b>Signing Secret</b> (Basic Information) below.</li></ol>
      <form class="form mt" id="sForm" onsubmit="return false">
        <div class="field"><label>Bot token</label><input name="bot_token" type="password" placeholder="${sl.has_bot_token ? 'saved - leave blank to keep' : 'xoxb-…'}"></div><div class="field"><label>Channel</label><input name="channel" value="${e(sl.channel)}" placeholder="#office or channel ID"></div>
        <div class="field full"><label>…or Incoming webhook URL</label><input name="webhook_url" type="password" placeholder="${sl.has_webhook ? 'saved - leave blank to keep' : 'https://hooks.slack.com/services/…'}"></div>
        <div class="field"><label>Signing secret (for /nurz)</label><input name="signing_secret" type="password" placeholder="${sl.has_signing_secret ? 'saved - leave blank to keep' : ''}"></div><div class="field"><label>Morning digest at</label><input name="digest_time" type="time" value="${e(sl.digest_time)}"></div>
        <div class="field full"><label>Notify the channel about</label><div class="row">${Object.entries(sl.event_labels).map(([k, l]) => `<label class="chip ${sl.events[k] ? 'on' : ''}"><input type="checkbox" data-ev="${k}" ${sl.events[k] ? 'checked' : ''} hidden>${e(l)}</label>`).join('')}</div></div>
        <div class="field full"><label class="check"><input type="checkbox" name="email_all" ${sl.email_all ? 'checked' : ''}>Announce all new email, not just from customers</label></div>
        <div class="full row"><button class="btn primary" id="sSave">Save</button>${sl.configured ? `<button class="btn" id="sTest">Send test</button><button class="btn" id="sDigest">Send digest now</button>` : ''}</div></form>
      <p class="muted small">Slash command URL: <code>${e(sl.command_url)}</code></p>
    </div></div>

    <div class="card"><div class="card-h"><h2>${icon('ai')} AI staff (MCP)</h2></div><div class="card-b">
      <p style="margin-top:0">Claude, ChatGPT and other AI assistants connect through the Model Context Protocol and get tools for customers, jobs, scheduling, estimates, invoices, email, calendar, tasks and reports - limited to the role you give them.</p>
      <div class="field"><label>MCP endpoint</label>${box(s.mcp.url)}</div><div class="field mt-s"><label>OpenAPI spec</label>${box(s.mcp.openapi)}</div><div class="field mt-s"><label>Guide for AI agents (llms.txt)</label>${box(s.mcp.llms_txt)}</div>
      <div class="row mt"><a class="btn primary" href="#/team">${icon('key')}Add AI staff & create a key</a><a class="btn" href="#/settings">${icon('book')}Edit the AI playbook</a></div></div></div>

    <div class="card"><div class="card-h"><h2>${icon('inbox')} Lead capture</h2></div><div class="card-b">
      <div class="field"><label>Customer request page (share or link from your website)</label>${box(s.base_url + '/request')}</div>
      <div class="field mt"><label>Lead webhook for website forms, Zapier or Make (POST JSON or form fields: name, email, phone, address, service, message)</label>${box(s.lead_hook_url)}</div>
      <div class="row mt-s"><button class="btn sm" id="rotLead">New webhook URL</button></div></div></div>

    <div class="card"><div class="card-h"><h2>${icon('zap')} Webhooks</h2><span class="muted">push events to Zapier, Make, n8n or your own code</span><div class="right"><button class="btn sm" id="whNew">${icon('plus')}Add</button></div></div><div class="card-b flush">${table(hooks.webhooks, [
      { label: 'URL', render: h => `<span class="mono ellipsis" style="display:block;max-width:260px">${e(h.url)}</span><div class="sub">${e(h.description)}</div>` }, { label: 'Events', render: h => h.events === '*' ? 'all' : `${h.events.split(',').length} events` },
      { label: 'Last', render: h => h.last_status ? `${e(h.last_status)} <span class="sub">${fmt.rel(h.last_at)}</span>` : '—' }, { label: '', render: h => `<button class="btn sm" data-whtest="${h.id}">Test</button> <button class="btn sm danger" data-whdel="${h.id}">${icon('trash')}</button>` }
    ], { compact: 1, empty: 'No webhooks. Deliveries are signed with HMAC-SHA256 (X-NurzWorks-Signature).' })}</div></div>

    <div class="card"><div class="card-h"><h2>${icon('dollar')} Online payments (Stripe)</h2><div class="right">${ok(s.stripe.enabled)}</div></div><div class="card-b">
      <p style="margin-top:0" class="muted">Optional. Adds a "Pay online" button to customer invoice pages; paid invoices update automatically.</p>
      <form class="form" id="stForm" onsubmit="return false"><div class="field full"><label>Secret key</label><input name="secret_key" type="password" placeholder="${s.stripe.enabled ? 'saved - leave blank to keep' : 'sk_live_…'}"></div>
        <div class="field full"><label>Webhook signing secret (event: checkout.session.completed)</label><input name="webhook_secret" type="password" placeholder="${s.stripe.has_webhook_secret ? 'saved' : 'whsec_…'}"></div>
        <div class="field full"><label>Webhook URL to add in Stripe</label>${box(s.stripe.webhook_url)}</div><div class="full"><button class="btn primary" id="stSave">Save</button></div></form></div></div>
  </div>
  <div class="card mt"><div class="card-h"><h2>${icon('refresh')} Delivery log</h2><span class="muted">Slack, Google Calendar and webhook deliveries retry automatically</span></div><div class="card-b flush" id="obox"><div class="loading">…</div></div></div>`;
  $$('[data-copy]', view).forEach(b => b.onclick = () => copyText(b.dataset.copy));
  const sv = (id, fn) => { const b = $('#' + id); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); } catch (err) { toast(err.message, 'error'); } b.disabled = false; }; };
  sv('gSave', async () => { const v = readForm($('#gForm')); if (!v.client_secret) delete v.client_secret; await PUT('/api/integrations/google', v); toast('Saved'); router(); });
  sv('gDisc', async () => { if (await confirmBox('Disconnect Google', 'Stop syncing Gmail and Calendar? Existing calendar events stay.', 'Disconnect', true)) { await POST('/api/integrations/google/disconnect'); await loadMeta(); router(); } });
  sv('calSave', async () => { const v = readForm($('#calForm')); await PUT('/api/integrations/calendar', v); await PUT('/api/integrations/gmail', { enabled: $('#gmailOn').checked, poll_minutes: +$('#gmailPoll').value }); toast('Saved'); await loadMeta(); });
  sv('calSync', async () => { const r2 = await POST('/api/calendar/sync'); toast(`Pushed ${r2.pushed}, pulled ${r2.pulled}${r2.errors.length ? ` · ${r2.errors.length} errors` : ''}`, r2.errors.length ? 'error' : ''); router(); });
  const cs = $('#calSel'); if (cs) api('/api/integrations/calendar/calendars').then(list => { cs.innerHTML = list.map(c => `<option value="${e(c.primary ? 'primary' : c.id)}" ${(c.primary ? 'primary' : c.id) === s.calendar.calendar_id ? 'selected' : ''}>${e(c.summary)}${c.primary ? ' (primary)' : ''}</option>`).join(''); }).catch(() => {});
  $$('[data-ev]', view).forEach(c => c.closest('label').onclick = ev => { ev.preventDefault(); c.checked = !c.checked; c.closest('label').classList.toggle('on', c.checked); });
  sv('sSave', async () => { const v = readForm($('#sForm')); for (const k of ['bot_token', 'webhook_url', 'signing_secret']) if (!v[k]) delete v[k]; v.events = Object.fromEntries($$('[data-ev]', view).map(c => [c.dataset.ev, c.checked])); await PUT('/api/integrations/slack', v); toast('Slack saved'); await loadMeta(); router(); });
  sv('sTest', async () => { await POST('/api/integrations/slack/test'); toast('Sent to Slack'); });
  sv('sDigest', async () => { await POST('/api/integrations/slack/test', { digest: true }); toast('Digest sent'); });
  sv('rotLead', async () => { if (await confirmBox('New lead webhook URL', 'The old URL stops working. Update your website/Zapier afterwards.', 'Create new URL')) { await POST('/api/integrations/lead-hook/rotate'); router(); } });
  sv('stSave', async () => { const v = readForm($('#stForm')); for (const k of ['secret_key', 'webhook_secret']) if (!v[k]) delete v[k]; await PUT('/api/integrations/stripe', v); toast('Saved'); await loadMeta(); router(); });
  sv('whNew', async () => {
    const r2 = await formModal({ title: 'Add webhook', okLabel: 'Add', fields: [{ name: 'url', label: 'URL (https)', full: 1, required: 1 }, { name: 'description', label: 'Description', full: 1 },
      { name: 'events', label: 'Events (none checked = all)', type: 'html', full: 1, html: `<div class="row">${hooks.events.map(ev => `<label class="check small" style="width:220px"><input type="checkbox" data-whev="${ev}">${ev}</label>`).join('')}</div>` }],
      save: (v, ctx) => POST('/api/webhooks', { ...v, events: $$('[data-whev]:checked', ctx.el).map(c => c.dataset.whev) }) });
    if (r2) { await modal({ title: 'Webhook added', size: 'narrow', foot: '<button class="btn primary" data-x>Done</button>', body: `<p>Signing secret (shown once):</p><div class="copy-box"><input readonly value="${e(r2.secret)}"></div><p class="muted small">${e(r2.note)}</p>` }); router(); }
  });
  $$('[data-whtest]', view).forEach(b => b.onclick = async () => { try { const r2 = await POST(`/api/webhooks/${b.dataset.whtest}/test`); toast(`Delivered: HTTP ${r2.status}`); } catch (err) { toast(err.message, 'error'); } router(); });
  $$('[data-whdel]', view).forEach(b => b.onclick = async () => { if (await confirmBox('Delete webhook', 'Stop sending events to this URL?', 'Delete', true)) { await DEL('/api/webhooks/' + b.dataset.whdel); router(); } });
  api('/api/integrations/outbox').then(rows => { $('#obox').innerHTML = table(rows, [{ label: 'When', render: o => fmt.dt(o.created_at) }, { label: 'Channel', render: o => `<span class="tag">${e(o.channel)}</span>` }, { label: 'Status', render: o => o.status === 'failed' ? '<span class="pill st-declined">failed</span>' : o.status === 'pending' ? '<span class="pill st-on_hold">pending</span>' : '<span class="pill st-done">sent</span>' }, { label: 'Detail', render: o => `<span class="muted small">${e(o.last_error || o.payload.slice(0, 120))}</span>` }, { label: '', render: o => o.status === 'failed' ? `<button class="btn sm" data-retry="${o.id}">Retry</button>` : '' }], { compact: 1, empty: 'Nothing sent yet.' }); $$('[data-retry]').forEach(b => b.onclick = async () => { await POST(`/api/integrations/outbox/${b.dataset.retry}/retry`); router(); }); }).catch(() => {});
};

// ======================= SETTINGS =======================
VIEWS.settings = async view => {
  const [s, pb] = await Promise.all([api('/api/settings'), api('/api/playbook')]);
  const f = (name, label, opts = {}) => fieldHtml({ name, label, value: s[name], ...opts });
  view.innerHTML = `
  <div class="page-head"><div><h1>Settings</h1><div class="sub">Company, billing, scheduling, automation, appearance, AI playbook and data · v${e(s.version)}</div></div></div>
  <div class="grid g2">
    <div class="card"><div class="card-h"><h2>Company</h2></div><div class="card-b"><form class="form" data-sform onsubmit="return false">
      ${f('company_name', 'Business name', { full: 1 })}${f('company_tagline', 'Tagline', { full: 1 })}${f('company_email', 'Business email', { type: 'email' })}${f('company_phone', 'Phone', { type: 'tel' })}
      ${f('company_website', 'Website', { full: 1 })}${f('company_address', 'Address (shown on estimates & invoices)', { type: 'textarea', rows: 2, full: 1 })}
      ${f('service_area', 'Service area (for AI staff & customers)', { type: 'textarea', rows: 2, full: 1, placeholder: 'Kenosha, Racine and Milwaukee counties; travel beyond 30 miles billed per mile' })}${f('business_hours', 'Business hours', { full: 1, placeholder: 'Mon-Fri 7am-5pm, emergency service 24/7' })}
    </form></div></div>
    <div class="card"><div class="card-h"><h2>Billing defaults</h2></div><div class="card-b"><form class="form" data-sform onsubmit="return false">
      ${f('tax_rate', 'Sales tax %', { type: 'number', step: '0.001' })}${f('default_terms_days', 'Payment terms (days)', { type: 'number' })}${f('default_bill_rate', 'Default billing rate ($/h)', { type: 'number', step: '0.01' })}${f('default_cost_rate', 'Default labor cost ($/h)', { type: 'number', step: '0.01' })}
      ${f('mileage_rate', 'Mileage rate ($/mi)', { type: 'number', step: '0.01' })}${f('currency', 'Currency', { type: 'select', options: [['USD', 'USD $'], ['CAD', 'CAD $'], ['EUR', 'EUR €'], ['GBP', 'GBP £'], ['AUD', 'AUD $']] })}
      ${f('estimate_valid_days', 'Estimates valid (days)', { type: 'number' })}${f('timezone', 'Time zone', { hint: 'e.g. America/Chicago' })}
      ${f('estimate_message', 'Estimate message', { type: 'textarea', rows: 2, full: 1 })}${f('estimate_terms', 'Estimate terms', { type: 'textarea', rows: 2, full: 1 })}
      ${f('invoice_message', 'Invoice message', { type: 'textarea', rows: 2, full: 1 })}${f('invoice_terms', 'Invoice terms', { type: 'textarea', rows: 2, full: 1 })}
      ${f('payment_instructions', 'How to pay (shown on invoices)', { type: 'textarea', rows: 2, full: 1, placeholder: 'Checks payable to NurzWorks. ACH: …' })}
    </form></div></div>
    <div class="card"><div class="card-h"><h2>Scheduling & automation</h2></div><div class="card-b"><form class="form" data-sform onsubmit="return false">
      ${f('workday_start', 'Workday starts', { type: 'time' })}${f('workday_end', 'Workday ends', { type: 'time' })}${f('default_visit_minutes', 'Default visit length (min)', { type: 'number' })}${f('estimate_followup_days', 'Follow up on estimates after (days)', { type: 'number' })}
      ${f('auto_job_on_approval', 'Create the job automatically when a customer approves an estimate', { type: 'checkbox', full: 1 })}
      ${f('auto_reminders', 'Email payment reminders automatically (needs Gmail)', { type: 'checkbox', full: 1 })}${f('reminder_days', 'Remind this many days after due', { hint: 'comma-separated, e.g. 3,10,30' })}
      ${f('visit_reminders', 'Email customers a reminder the day before a visit', { type: 'checkbox', full: 1 })}${f('track_travel', 'Track travel time when a tech taps "On my way"', { type: 'checkbox', full: 1 })}
    </form></div></div>
    <div class="card"><div class="card-h"><h2>Appearance & links</h2></div><div class="card-b"><form class="form" data-sform onsubmit="return false">
      ${f('theme_default', 'Default theme for new users', { type: 'select', options: THEMES.map(([k, l]) => [k, l]), full: 1 })}
      <div class="full row">${THEMES.map(([k, l, ic]) => `<button type="button" class="btn sm" data-try="${k}">${icon(ic)}Try ${l}</button>`).join('')}</div>
      ${f('base_url', 'Public base URL', { full: 1, placeholder: 'https://hq.yourdomain.com', hint: `Used in emails, Slack and calendar links. Detected: ${s.detected_base_url}` })}
      ${f('cmms_url', 'NurzWorks CMMS address (adds a link in the sidebar)', { full: 1, placeholder: 'http://localhost:4100' })}
    </form></div></div>
  </div>
  <div class="row mt"><button class="btn primary lg" id="saveAll">${icon('check')}Save settings</button></div>
  <div class="card mt"><div class="card-h"><h2>${icon('ai')} AI staff playbook</h2><span class="muted">${pb.customized ? `edited ${fmt.rel(pb.updated_at)}` : 'default'} · AI staff read this before working</span><div class="right"><button class="btn sm" id="pbReset">Reset to default</button><button class="btn sm primary" id="pbSave">Save playbook</button></div></div>
    <div class="card-b"><textarea id="playbook" class="inp" style="height:360px;padding:12px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.5">${e(pb.playbook)}</textarea><div class="hint">Markdown. Write your policies, pricing rules, tone, what AI may send without asking, and what always needs you.</div></div></div>
  <div class="grid g2 mt">
    <div class="card"><div class="card-h"><h2>${icon('database')} Backup & export</h2></div><div class="card-b"><p class="muted" style="margin-top:0">Everything lives in one file: <code>${e(s.db_path)}</code>. Integration secrets are encrypted with a key kept outside backups.</p>
      <div class="row"><a class="btn primary" href="/api/backup">${icon('download')}Download backup</a>${['customers', 'jobs', 'invoices', 'payments', 'time', 'expenses'].map(k => `<a class="btn sm" href="/api/export/${k}.csv">${cap(k)} CSV</a>`).join('')}</div>
      <div class="small muted mt">${Object.entries(s.counts).map(([k, n]) => `${n} ${k.replace('_', ' ')}`).join(' · ')}</div></div></div>
    <div class="card"><div class="card-h"><h2>Sample data</h2></div><div class="card-b"><p class="muted" style="margin-top:0">${s.has_demo ? 'Sample data is loaded. Removing it deletes only sample records - your own stay.' : 'Load a few months of realistic sample customers, jobs, invoices, plans and AI tasks to explore. Remove it in one click.'}</p>
      ${s.has_demo ? `<button class="btn danger" id="rmDemo">${icon('trash')}Remove sample data</button>` : `<button class="btn" id="addDemo">${icon('database')}Load sample data</button>`}<button class="btn" id="kpiRe" style="margin-left:6px">${icon('chart')}Rebuild KPI history</button></div></div>
  </div>`;
  $$('[data-try]', view).forEach(b => b.onclick = () => applyTheme(b.dataset.try));
  $('#saveAll').onclick = async () => {
    const vals = Object.assign({}, ...$$('[data-sform]', view).map(readForm));
    try { await PUT('/api/settings', vals); toast('Settings saved'); refresh(); } catch (err) { toast(err.message, 'error'); }
  };
  $('#pbSave').onclick = async () => { await PUT('/api/playbook', { playbook: $('#playbook').value }); toast('Playbook saved'); };
  $('#pbReset').onclick = async () => { if (await confirmBox('Reset playbook', 'Replace your playbook with the default?', 'Reset', true)) { await PUT('/api/playbook', { reset: true }); router(); } };
  const ad = $('#addDemo'); if (ad) ad.onclick = async () => { ad.disabled = true; ad.textContent = 'Loading…'; try { await POST('/api/demo/load'); invalidateCustomers(); toast('Sample data loaded'); location.hash = '#/dashboard'; await refresh(); } catch (err) { toast(err.message, 'error'); ad.disabled = false; } };
  const rd = $('#rmDemo'); if (rd) rd.onclick = async () => { if (await confirmBox('Remove sample data', 'Delete every sample record? Your own records are kept.', 'Remove', true)) { await POST('/api/demo/remove'); invalidateCustomers(); toast('Sample data removed'); refresh(); } };
  $('#kpiRe').onclick = async () => { const r2 = await POST('/api/kpis/rebuild'); toast(`Rebuilt ${r2.generated.length} months`); };
};

// ======================= PROFILE =======================
async function profileForm() {
  const me = S.me;
  const r = await formModal({ title: 'My profile', okLabel: 'Save',
    fields: [{ name: 'name', label: 'Name', value: me.name, required: 1 }, { name: 'phone', label: 'Phone', type: 'tel', value: me.phone }, { name: 'color', label: 'My schedule color', type: 'color', value: me.color || '#1f6fd1' },
      { name: 'theme', label: 'Theme', type: 'select', options: THEMES.map(([k, l]) => [k, l]), value: document.documentElement.dataset.theme },
      { type: 'heading', label: 'Change password' }, { name: 'current_password', label: 'Current password', type: 'password' }, { name: 'new_password', label: 'New password', type: 'password' }],
    save: v => { if (!v.new_password) { delete v.new_password; delete v.current_password; } return PUT('/api/me', v); } });
  if (r) { toast('Profile saved'); if (r.theme) applyTheme(r.theme, false); await refresh(); }
}

// ======================= BOOT =======================
boot();
