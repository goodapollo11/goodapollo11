'use strict';
// Customer-facing email templates (plain text + simple branded HTML in the NurzWorks palette).
const { escHtml, fmtMoney, fmtDate, fmtLocal } = require('./util');
const { company, currency, tz } = require('./config');

const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'there';
function signature() {
  const c = company();
  return [c.name, c.phone, c.email, c.website].filter(Boolean).join('\n');
}
function html({ heading, intro, rows = [], button, after, footnote }) {
  const c = company();
  const para = s => escHtml(s).replace(/\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef1f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#15202b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #dde3ea;border-radius:10px;overflow:hidden">
<tr><td style="background:#0f2a44;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700">${escHtml(c.name)}<span style="display:block;font-size:12px;font-weight:400;color:#9fd8cc">${escHtml(c.tagline)}</span></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px">${escHtml(heading)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${para(intro)}</p>
${rows.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;border-collapse:collapse">${rows.map(([k, v, strong]) => `<tr><td style="padding:7px 0;border-bottom:1px solid #eef1f4;color:#4a5866;font-size:14px">${escHtml(k)}</td><td style="padding:7px 0;border-bottom:1px solid #eef1f4;text-align:right;font-size:14px;${strong ? 'font-weight:700' : ''}">${escHtml(v)}</td></tr>`).join('')}</table>` : ''}
${button ? `<p style="margin:0 0 18px"><a href="${escHtml(button.url)}" style="display:inline-block;background:#1f6fd1;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:6px">${escHtml(button.label)}</a></p>` : ''}
${after ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4a5866">${para(after)}</p>` : ''}
<p style="margin:16px 0 0;font-size:14px;line-height:1.5">${para(signature())}</p>
</td></tr>
${footnote ? `<tr><td style="padding:12px 24px;background:#fafbfc;border-top:1px solid #dde3ea;font-size:12px;color:#7b8794">${para(footnote)}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}
const money = v => fmtMoney(v, currency());

function estimateEmail(e, { message, subject } = {}) {
  const c = company();
  const intro = `Hi ${firstName(e.customer_name)},\n\n${message || e.message || 'Here is your estimate.'}`;
  const rows = [['Estimate', e.number], ['For', e.title], ...(e.expiry_date ? [['Valid until', fmtDate(e.expiry_date)]] : []), ['Total', money(e.total), true]];
  return {
    subject: subject || `Estimate ${e.number} from ${c.name}: ${e.title}`,
    text: `${intro}\n\n${rows.map(r => `${r[0]}: ${r[1]}`).join('\n')}\n\nView and approve your estimate online:\n${e.public_url}\n\n${signature()}`,
    html: html({ heading: `Estimate ${e.number}`, intro, rows, button: { url: e.public_url, label: 'View & approve estimate' }, footnote: 'You can approve or decline online with one click. Reply to this email with any questions.' })
  };
}
function invoiceEmail(i, { message, subject } = {}) {
  const c = company();
  const intro = `Hi ${firstName(i.customer_name)},\n\n${message || i.message || 'Here is your invoice.'}`;
  const rows = [['Invoice', i.number], ...(i.title ? [['For', i.title]] : []), ['Due', fmtDate(i.due_date)], ['Total', money(i.total)], ...(i.amount_paid ? [['Paid', money(i.amount_paid)]] : []), ['Balance due', money(i.balance), true]];
  return {
    subject: subject || `Invoice ${i.number} from ${c.name} - ${money(i.balance)} due ${fmtDate(i.due_date)}`,
    text: `${intro}\n\n${rows.map(r => `${r[0]}: ${r[1]}`).join('\n')}\n\nView ${'and pay '}your invoice online:\n${i.public_url}\n\n${signature()}`,
    html: html({ heading: `Invoice ${i.number}`, intro, rows, button: { url: i.public_url, label: 'View invoice' }, footnote: 'Thank you for your business. Reply to this email with any questions about this invoice.' })
  };
}
function reminderEmail(i, { message, subject } = {}) {
  const c = company();
  const late = i.days_overdue > 0;
  const intro = `Hi ${firstName(i.customer_name)},\n\n${message || (late
    ? `This is a friendly reminder that invoice ${i.number} was due on ${fmtDate(i.due_date)} and still shows a balance of ${money(i.balance)}. If you've already sent payment, thank you and please disregard this note.`
    : `A friendly reminder that invoice ${i.number} for ${money(i.balance)} is due on ${fmtDate(i.due_date)}.`)}`;
  const rows = [['Invoice', i.number], ['Due', fmtDate(i.due_date)], ...(late ? [['Days past due', String(i.days_overdue)]] : []), ['Balance due', money(i.balance), true]];
  return {
    subject: subject || (late ? `Reminder: invoice ${i.number} is past due` : `Reminder: invoice ${i.number} due ${fmtDate(i.due_date)}`),
    text: `${intro}\n\n${rows.map(r => `${r[0]}: ${r[1]}`).join('\n')}\n\nView your invoice:\n${i.public_url}\n\n${signature()}`,
    html: html({ heading: `Payment reminder`, intro, rows, button: { url: i.public_url, label: 'View invoice' } })
  };
}
function visitReminderEmail(v, { message } = {}) {
  const c = company();
  const when = fmtLocal(v.start_at, tz(), { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const intro = `Hi ${firstName(v.customer_name)},\n\n${message || `This is a reminder that ${c.name} is scheduled to visit ${when}${v.address ? ` at ${v.address}` : ''} for: ${v.job_title}.`}`;
  return {
    subject: `Reminder: ${c.name} visit ${fmtLocal(v.start_at, tz(), { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`,
    text: `${intro}\n\nIf you need to reschedule, just reply to this email or call us.\n\n${signature()}`,
    html: html({ heading: 'Upcoming visit', intro, rows: [['When', when], ...(v.address ? [['Where', v.address]] : []), ['Job', `${v.job_number} ${v.job_title}`]], after: 'If you need to reschedule, just reply to this email or call us.' })
  };
}
function plainEmail(subject, body) {
  return { subject, text: `${body}`, html: html({ heading: subject, intro: body }).replace(/<p style="margin:16px 0 0;font-size:14px;line-height:1.5">[\s\S]*?<\/p>\n<\/td>/, '</td>') };
}

module.exports = { estimateEmail, invoiceEmail, reminderEmail, visitReminderEmail, plainEmail, html, signature };
