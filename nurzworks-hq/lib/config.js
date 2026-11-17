'use strict';
// Business settings accessors used across services.
const { setting, setSetting } = require('./db');
const { localDate, num, zonedParts } = require('./util');

const tz = () => setting('timezone') || 'America/Chicago';
const today = () => localDate(new Date(), tz());
const nowLocal = () => zonedParts(new Date(), tz());
const n = (key, d = 0) => num(setting(key), d);
const flag = key => setting(key) === '1';
const company = () => ({
  name: setting('company_name') || 'NurzWorks', tagline: setting('company_tagline') || '', email: setting('company_email') || '',
  phone: setting('company_phone') || '', address: setting('company_address') || '', website: setting('company_website') || ''
});
// Public base URL used in emails, Slack messages, calendar events and customer links.
let detected = '';
function baseUrl() {
  return (process.env.NW_BASE_URL || setting('base_url') || detected || `http://localhost:${process.env.PORT || 4200}`).replace(/\/+$/, '');
}
function rememberBaseUrl(origin) {
  if (!origin || detected) return;
  detected = origin;
  if (!setting('base_url') && !/localhost|127\.0\.0\.1/.test(origin)) setSetting('base_url', origin);
}
const currency = () => setting('currency') || 'USD';

module.exports = { tz, today, nowLocal, n, flag, company, baseUrl, rememberBaseUrl, currency };
