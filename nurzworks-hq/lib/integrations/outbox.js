'use strict';
// Transactional outbox: integration work is queued in the same transaction as the business change and delivered
// in the background with retries (30s, 2m, 10m, 30m, 2h, 6h, 12h), so Slack/Google/webhook outages never lose updates.
const { all, run, insert, now } = require('../db');

const BACKOFF = [30e3, 120e3, 600e3, 1800e3, 7200e3, 21600e3, 43200e3];
const handlers = {};
function register(channel, fn) { handlers[channel] = fn; }
function enqueue(channel, payload, delayMs = 0) {
  return insert('outbox', { channel, payload: JSON.stringify(payload), attempts: 0, next_at: new Date(Date.now() + delayMs).toISOString(), status: 'pending', created_at: now(), updated_at: now() });
}
let busy = false;
async function processOutbox(limit = 25) {
  if (busy) return { busy: true };
  busy = true; let done = 0, failed = 0;
  try {
    const rows = all("SELECT * FROM outbox WHERE status='pending' AND next_at <= :t ORDER BY id LIMIT :l", { t: now(), l: limit });
    for (const r of rows) {
      const fn = handlers[r.channel];
      try {
        if (!fn) throw new Error(`No handler for ${r.channel}`);
        await fn(JSON.parse(r.payload), r);
        run("UPDATE outbox SET status='done', attempts=attempts+1, last_error='', updated_at=:t WHERE id=:id", { t: now(), id: r.id });
        done++;
      } catch (e) {
        const attempts = r.attempts + 1;
        const permanent = e.permanent || attempts >= BACKOFF.length + 1;
        run('UPDATE outbox SET attempts=:a, status=:s, last_error=:e, next_at=:n, updated_at=:t WHERE id=:id', {
          a: attempts, s: permanent ? 'failed' : 'pending', e: String(e.message || e).slice(0, 500), n: new Date(Date.now() + (BACKOFF[attempts - 1] || 0)).toISOString(), t: now(), id: r.id
        });
        failed++;
        if (permanent) console.warn(`[outbox] ${r.channel} #${r.id} failed permanently: ${e.message}`);
      }
    }
  } finally { busy = false; }
  return { done, failed };
}
function prune() { run("DELETE FROM outbox WHERE status='done' AND updated_at < :t", { t: new Date(Date.now() - 7 * 864e5).toISOString() }); }
function retry(id) { run("UPDATE outbox SET status='pending', next_at=:t, attempts=0 WHERE id=:id", { t: now(), id }); }
const stats = () => all("SELECT channel, status, COUNT(*) n FROM outbox WHERE status != 'done' OR updated_at > :t GROUP BY channel, status", { t: new Date(Date.now() - 864e5).toISOString() });

module.exports = { register, enqueue, processOutbox, prune, retry, stats };
