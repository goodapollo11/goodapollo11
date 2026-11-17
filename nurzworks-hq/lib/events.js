'use strict';
// Internal event bus. Services emit business events (job.completed, invoice.paid ...) inside their transaction;
// integrations (Slack, webhooks, Google Calendar) subscribe and only enqueue work into the outbox table,
// so delivery happens after commit, with retries, without slowing the request.
const listeners = [];
const EVENTS = [
  'customer.created', 'customer.updated',
  'request.created', 'request.converted',
  'estimate.created', 'estimate.sent', 'estimate.viewed', 'estimate.approved', 'estimate.declined', 'estimate.converted',
  'job.created', 'job.updated', 'job.status_changed', 'job.completed',
  'visit.scheduled', 'visit.updated', 'visit.status_changed', 'visit.cancelled', 'visit.deleted',
  'invoice.created', 'invoice.sent', 'invoice.viewed', 'invoice.paid', 'invoice.overdue', 'invoice.voided',
  'payment.recorded',
  'task.created', 'task.completed',
  'time.logged', 'expense.logged',
  'email.received'
];
let muted = 0;
function on(fn) { listeners.push(fn); }
function emit(event, data, ctx) {
  if (muted) return;
  for (const fn of listeners) {
    try { fn(event, data, ctx); } catch (e) { console.error(`[event ${event}]`, e); }
  }
}
// run fn without notifying integrations (used when loading sample data)
function quietly(fn) { muted++; try { return fn(); } finally { muted--; } }
module.exports = { on, emit, quietly, EVENTS };
