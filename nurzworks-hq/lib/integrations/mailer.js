'use strict';
// Outgoing email goes through the connected Google Workspace (Gmail) account, so it lands in Sent Mail
// and customer replies come back to the business inbox.
const { HttpError, str } = require('../util');
const A = require('../services/activity');

function connected() { return require('./gmail').connected(); }
async function send({ to, cc, bcc, subject, text, html, threadId, inReplyTo, references, ctx, customerId, entity }) {
  if (!connected()) throw new HttpError(409, 'Gmail is not connected. Connect Google in Integrations, or use method "mark_sent" and share the link yourself.');
  const res = await require('./gmail').sendMessage({ to, cc, bcc, subject, text, html, threadId, inReplyTo, references });
  if (customerId && !(entity && entity[0] === 'customer')) A.log('customer', customerId, `Email sent to ${to}: "${subject}"`, { ctx, kind: 'email' });
  if (res.threadId && customerId) require('./gmail').linkThread(res.threadId, { customerId, jobId: entity && entity[0] === 'job' ? entity[1] : null, by: 'auto', subject, to });
  return { ...res, to: str(to) };
}
module.exports = { send, connected };
