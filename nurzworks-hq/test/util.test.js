'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../lib/util');

test('business time zone conversion handles DST', () => {
  // Chicago: CDT (UTC-5) in July, CST (UTC-6) in January
  assert.equal(U.zonedToUtc('2026-07-15', '09:00', 'America/Chicago').toISOString(), '2026-07-15T14:00:00.000Z');
  assert.equal(U.zonedToUtc('2026-01-15', '09:00', 'America/Chicago').toISOString(), '2026-01-15T15:00:00.000Z');
  // the morning DST begins (2:30am does not exist) still resolves to a sane instant
  assert.ok(U.zonedToUtc('2026-03-08', '09:00', 'America/Chicago') instanceof Date);
  assert.equal(U.localDate(new Date('2026-07-16T03:30:00Z'), 'America/Chicago'), '2026-07-15');
});

test('parseWhen accepts wall time, offsets and plain dates', () => {
  const tz = 'America/Chicago';
  assert.equal(U.parseWhen('2026-07-15T09:30', tz).toISOString(), '2026-07-15T14:30:00.000Z');
  assert.equal(U.parseWhen('2026-07-15 9:30', tz).toISOString(), '2026-07-15T14:30:00.000Z');
  assert.equal(U.parseWhen('2026-07-15T09:30:00-04:00', tz).toISOString(), '2026-07-15T13:30:00.000Z');
  assert.equal(U.parseWhen('2026-07-15T14:30:00Z', tz).toISOString(), '2026-07-15T14:30:00.000Z');
  assert.equal(U.parseWhen('2026-07-15', tz).toISOString(), '2026-07-15T05:00:00.000Z');
  assert.equal(U.parseWhen('next tuesday', tz), null);
  assert.equal(U.parseWhen('2026-02-30T09:00', tz), null);
});

test('addInterval clamps to month ends', () => {
  assert.equal(U.addInterval('2026-01-31', 1, 'month'), '2026-02-28');
  assert.equal(U.addInterval('2024-02-29', 1, 'year'), '2025-02-28');
  assert.equal(U.addInterval('2026-11-17', 3, 'month'), '2027-02-17');
  assert.equal(U.addInterval('2026-11-17', 2, 'week'), '2026-12-01');
  assert.equal(U.daysBetween('2026-11-01', '2026-11-17'), 16);
});

test('validator coerces query-string and AI inputs and reports clear errors', () => {
  const schema = { type: 'object', properties: { n: { type: 'integer', minimum: 1 }, b: { type: 'boolean' }, d: { type: ['string', 'null'], format: 'date' }, ids: { type: 'array', items: { type: 'integer' } }, e: { type: 'string', enum: ['a', 'b'] } }, required: ['n'] };
  assert.deepEqual(U.validate(schema, { n: '3', b: 'true', d: '', ids: '1,2' }), { n: 3, b: true, d: null, ids: [1, 2] });
  assert.throws(() => U.validate(schema, { n: 0 }), /n must be at least 1/);
  assert.throws(() => U.validate(schema, {}), /n is required/);
  assert.throws(() => U.validate(schema, { n: 1, d: '03/15/2026' }), /must be a date/);
  assert.throws(() => U.validate(schema, { n: 1, e: 'c' }), /must be one of/);
  assert.throws(() => U.validate(schema, { n: 'abc' }), /must be integer/);
});

test('CSV export neutralizes spreadsheet formulas', () => {
  const csv = U.toCsv([{ a: '=HYPERLINK("x")', b: 'plain, text', c: -5, d: '-5', e: '+1 555' }]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /"plain, text"/);
  assert.match(csv, /,-5,-5,/);
  assert.match(csv, /'\+1 555/);
});
