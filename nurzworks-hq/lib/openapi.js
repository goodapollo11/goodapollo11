'use strict';
// OpenAPI 3.1 spec and llms.txt, generated from the operation registry (so they never drift from the code).
const { OPS } = require('./ops');
const { company, tz, baseUrl } = require('./config');
const VERSION = require('../package.json').version;

function spec() {
  const paths = {};
  for (const o of OPS) {
    if (!o.path || o.public) continue;
    const p = o.path.replace(/:(\w+)/g, '{$1}');
    const props = (o.input && o.input.properties) || {};
    const required = new Set((o.input && o.input.required) || []);
    const parameters = o.keys.map(k => ({ name: k, in: 'path', required: true, schema: props[k] || { type: 'string' } }));
    const bodyProps = Object.fromEntries(Object.entries(props).filter(([k]) => !o.keys.includes(k)));
    const bodyReq = [...required].filter(k => !o.keys.includes(k));
    const op = {
      operationId: o.name, summary: o.title || o.name, description: o.description || undefined, tags: o.tags.length ? o.tags : undefined,
      security: [{ bearerAuth: [] }], 'x-required-scope': o.scope, 'x-roles': o.roles, 'x-mcp-tool': require('./mcp').exposed(o) ? o.name : undefined,
      parameters: [...parameters],
      responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: ['object', 'array'] } } } },
        400: { $ref: '#/components/responses/Error' }, 401: { $ref: '#/components/responses/Error' }, 403: { $ref: '#/components/responses/Error' }, 404: { $ref: '#/components/responses/Error' } }
    };
    if (o.method === 'GET' || o.method === 'DELETE') {
      for (const [k, s] of Object.entries(bodyProps)) op.parameters.push({ name: k, in: 'query', required: bodyReq.includes(k), schema: s, description: s.description });
    } else if (Object.keys(bodyProps).length || o.input.type === 'object') {
      op.requestBody = { required: bodyReq.length > 0, content: { 'application/json': { schema: { type: 'object', properties: bodyProps, ...(bodyReq.length ? { required: bodyReq } : {}) } } } };
    }
    if (!op.parameters.length) delete op.parameters;
    (paths[p] ||= {})[o.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: { title: `${company().name} HQ API`, version: VERSION, description: `Business API for ${company().name}: customers, jobs, scheduling, estimates, invoices, time, tasks, email and calendar. Authenticate with an API key (Team & AI staff page): Authorization: Bearer nwk_... Date-times without an offset are in ${tz()}.` },
    servers: [{ url: baseUrl() }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'API key created under Team & AI staff' } },
      responses: { Error: { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } } }
    },
    paths
  };
}

function llmsTxt() {
  const groups = {};
  const { exposed } = require('./mcp');
  for (const o of OPS) if (exposed(o)) (groups[o.tags[0] || 'Other'] ||= []).push(o);
  const c = company();
  return `# ${c.name} HQ

> Business system for ${c.name}, a mobile service and consulting business: customers (CRM), service requests, estimates,
> jobs and scheduled visits, field status with GPS, time and expenses, invoices and payments, service plans, tasks for
> people and AI staff, the business Gmail inbox, Google Calendar and Slack.

AI staff connect through MCP (preferred) or the REST API. Both expose the same operations and permissions.

- MCP endpoint (Streamable HTTP): ${baseUrl()}/mcp  - send \`Authorization: Bearer <API key>\`, or use the secret URL ${baseUrl()}/mcp/<API key>
- REST API: ${baseUrl()}/api/... with the same bearer key. OpenAPI 3.1 spec: ${baseUrl()}/api/openapi.json
- API keys are created by an admin under Team & AI staff. Each key acts as one team member (person or AI) and is limited by
  that member's role (owner/admin/office/field/viewer) and the key's scopes (read, write, email.send, admin).

## Conventions
- Time zone: ${tz()}. Dates are YYYY-MM-DD. Date-times without an offset (2026-03-15T09:30) are business-local; ISO 8601 with an offset is also accepted.
- Records have numeric ids and human numbers: C-00001 customers, REQ-, EST-, JOB-, INV-, PLAN-.
- Everything you do is attributed to your team member and appears on record timelines. Add notes with add_note.
- Start each session: get_me, get_playbook (the owner's standing instructions), get_briefing (today's priorities + suggested_actions).
- Your work queue: list_tasks assigned_to="me" -> do it -> update_task status="done" with a result.
- Prefer email_create_draft (a person reviews it in Gmail) over email_send unless told otherwise.

## Typical flows
- Lead -> create_request -> convert_request (job or estimate) -> create_estimate -> send_estimate -> customer approves online -> job is created automatically.
- Job -> find_availability -> schedule_visit -> field crew: set_visit_status en_route / on_site / completed -> set_job_status completed.
- Billing -> create_invoice(job_id) pulls items, billable time and expenses -> send_invoice -> record_payment; overdue: send_payment_reminder.

## Tools
${Object.entries(groups).map(([g, ops]) => `### ${g}\n${ops.map(o => `- ${o.name} (${o.method} ${o.path}): ${(o.description || o.title || '').split('. ')[0]}`).join('\n')}`).join('\n\n')}
`;
}

module.exports = { spec, llmsTxt };
