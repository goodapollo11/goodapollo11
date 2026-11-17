'use strict';
// Optional sample data: a few months of a mobile controls / maintenance / consulting business in SE Wisconsin.
// Every row is tagged is_demo=1 (or belongs to a demo customer) so "Remove sample data" deletes only sample records.
const { all, get, run, insert, update, tx, now, setSetting } = require('./db');
const { addDays, zonedToUtc, round2, token, localDate } = require('./util');
const { tz, today } = require('./config');
const { ROLE_SCOPES } = require('./auth');
const { userCtx } = require('./ops');
const { quietly } = require('./events');

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

const PRICEBOOK = [
  ['TRIP', 'Service call / trip charge', 'fee', 'ea', 95, 0, 'Fees', 0], ['LABOR', 'Field labor', 'labor', 'hr', 95, 34, 'Labor', 0],
  ['ENG', 'Controls engineering & consulting', 'labor', 'hr', 135, 45, 'Labor', 0], ['AFTER-HRS', 'After-hours / emergency labor', 'labor', 'hr', 145, 45, 'Labor', 0],
  ['PLC-TS', 'PLC troubleshooting (first hour)', 'service', 'ea', 165, 34, 'Controls', 0], ['PLC-BACKUP', 'PLC program backup & documentation', 'service', 'ea', 350, 70, 'Controls', 0],
  ['VFD-INSTALL', 'VFD replacement labor (up to 10 HP)', 'service', 'ea', 425, 120, 'Drives', 0], ['PF525-2HP', 'PowerFlex 525 AC drive, 2 HP', 'material', 'ea', 612, 455, 'Drives', 1],
  ['PROX-M18', 'Inductive proximity sensor, M18', 'material', 'ea', 68, 38, 'Sensors', 1], ['PHOTO-EYE', 'Photoelectric sensor, retro-reflective', 'material', 'ea', 89, 52, 'Sensors', 1],
  ['IR-SCAN', 'Control panel inspection & infrared thermography', 'service', 'ea', 295, 60, 'Inspection', 0], ['PM-VISIT', 'Preventive maintenance visit - controls', 'service', 'visit', 240, 70, 'Maintenance', 0],
  ['SCADA-25', 'SCADA / data logging setup (per 25-tag block)', 'service', 'ea', 750, 150, 'SCADA', 0], ['WIRE', 'Wire, terminals & misc. materials', 'material', 'lot', 35, 18, 'Materials', 1],
  ['MILEAGE', 'Mileage beyond 30-mile service area', 'fee', 'mi', 1.25, 0.7, 'Fees', 0], ['GEN-SVC', 'Standby generator annual service', 'service', 'ea', 289, 85, 'Generators', 0]
];
const CUSTOMERS = [
  ['Lakeshore Plastics', 'commercial', 'Lakeshore Plastics Inc.', 'maintenance@lakeshoreplastics.example', '(262) 555-0141', '4100 52nd St', 'Kenosha', '53144', 'referral', 'manufacturing, pm-contract', [['Tom Becker', 'Maintenance Manager', 'tbecker@lakeshoreplastics.example', '(262) 555-0142']], 'Check in at shipping office, door 3. Safety glasses required.', [42.5847, -87.8789], 'active', 30],
  ['Badger State Brewing Co.', 'commercial', '', 'ops@badgerstatebrewing.example', '(262) 555-0177', '990 Washington Ave', 'Racine', '53403', 'google', 'food-bev, pm-contract', [['Kelly Ortiz', 'Operations Lead', 'kelly@badgerstatebrewing.example', '(262) 555-0178']], 'Park in back lot; brewhouse shuts down at 3pm.', [42.7212, -87.8003], 'active', 14],
  ['Kenosha Precision Machining', 'commercial', '', 'office@kpmachining.example', '(262) 555-0110', '7710 Sheridan Rd', 'Kenosha', '53143', 'repeat', 'manufacturing', [['Raj Patel', 'Plant Engineer', 'rpatel@kpmachining.example', '(262) 555-0111']], '', [42.5613, -87.8287], 'active', 30],
  ['Root River Water Utility', 'commercial', '', 'scada@rootriverwater.example', '(262) 555-0190', '1200 State St', 'Racine', '53404', 'website', 'municipal, scada', [['Linda Moore', 'Operations Supervisor', 'lmoore@rootriverwater.example', '(262) 555-0191']], 'Badge in at the gate. Call Linda on arrival.', [42.7365, -87.7935], 'active', 45],
  ['Pleasant Prairie Logistics', 'commercial', '', 'facilities@pplogistics.example', '(262) 555-0133', '9800 80th Ave', 'Pleasant Prairie', '53158', 'referral', 'warehouse', [['Greg Kowalski', 'Facilities Manager', 'gkowalski@pplogistics.example', '(262) 555-0134']], 'Use the dock 7 entrance.', [42.5306, -87.9006], 'active', 30],
  ['Harbor Foods', 'commercial', '', 'maint@harborfoods.example', '(414) 555-0166', '2250 S Kinnickinnic Ave', 'Milwaukee', '53207', 'google', 'food-bev', [['Sam Nguyen', 'Maintenance Lead', 'snguyen@harborfoods.example', '(414) 555-0167']], 'Hairnets and beard nets required in production.', [42.9989, -87.8995], 'active', 14],
  ['Great Lakes Robotics Lab', 'commercial', 'Great Lakes Robotics Lab LLC', 'hello@glrobotics.example', '(414) 555-0122', '1433 N Water St', 'Milwaukee', '53202', 'referral', 'consulting, robotics', [['Dr. Erin Walsh', 'Director', 'erin@glrobotics.example', '(414) 555-0123']], '', [43.0517, -87.9104], 'active', 30],
  ['Westgate Apartments', 'commercial', 'Westgate Property Group', 'manager@westgateapts.example', '(262) 555-0158', '3300 Westgate Dr', 'Kenosha', '53142', 'sign', 'property-mgmt', [['Carla James', 'Property Manager', 'carla@westgateapts.example', '(262) 555-0159']], 'Pick up the mechanical room key at the leasing office.', [42.5687, -87.9012], 'active', 14],
  ['Lakeview Car Wash', 'commercial', '', 'owner@lakeviewwash.example', '(262) 555-0182', '6000 75th St', 'Kenosha', '53142', 'google', 'retail', [], 'Bays close for service - call 30 minutes ahead.', [42.5402, -87.8862], 'active', null],
  ['Mike & Laura Petersen', 'residential', '', 'petersen.family@example.com', '(262) 555-0105', '2214 Lakeshore Dr', 'Kenosha', '53140', 'referral', 'generator', [], 'Friendly dog in the backyard. Generator is on the east side.', [42.6105, -87.8215], 'active', null],
  ['Ellen Brooks', 'residential', '', 'ellen.brooks@example.com', '(262) 555-0117', '815 Main St', 'Racine', '53403', 'website', 'workshop', [], 'Detached workshop behind the house.', [42.7284, -87.7836], 'active', null],
  ['Union Grove Feed & Grain', 'commercial', '', 'info@ugfeed.example', '(262) 555-0188', '1015 Main St', 'Union Grove', '53182', 'repeat', 'agriculture', [['Hank Olson', 'Owner', 'hank@ugfeed.example', '(262) 555-0189']], 'Grain dryer controls are in the north building.', [42.6881, -88.0512], 'active', 30],
  ['Sturtevant Packaging', 'commercial', '', 'purchasing@sturtevantpack.example', '(262) 555-0171', '2800 Wisconsin St', 'Sturtevant', '53177', 'website', 'manufacturing', [['Joe Lindqvist', 'Purchasing', 'jlindqvist@sturtevantpack.example', '(262) 555-0172']], '', [42.6981, -87.8946], 'lead', 30],
  ['Northpoint Dental', 'commercial', '', 'office@northpointdental.example', '(262) 555-0150', '120 N Main St', 'Racine', '53402', 'google', 'healthcare', [], '', [42.7311, -87.7826], 'lead', null]
];
const TEMPLATES = [
  { title: 'PLC fault troubleshooting - packaging line', type: 'repair', billing: 'hourly', items: [['TRIP', 1]], hours: [2, 5] },
  { title: 'VFD replacement on conveyor drive', type: 'repair', billing: 'fixed', items: [['VFD-INSTALL', 1], ['PF525-2HP', 1], ['WIRE', 1], ['TRIP', 1]], hours: [3, 5] },
  { title: 'Control panel inspection & thermography', type: 'inspection', billing: 'fixed', items: [['IR-SCAN', 1], ['TRIP', 1]], hours: [2, 3] },
  { title: 'Replace failed proximity sensors', type: 'repair', billing: 'fixed', items: [['PROX-M18', 3], ['LABOR', 1.5], ['TRIP', 1]], hours: [1, 2] },
  { title: 'PLC program backup & documentation', type: 'service', billing: 'fixed', items: [['PLC-BACKUP', 1]], hours: [2, 4] },
  { title: 'Emergency call - line down', type: 'emergency', billing: 'hourly', items: [['TRIP', 1]], hours: [2, 6] },
  { title: 'Photo-eye alignment & replacement', type: 'repair', billing: 'fixed', items: [['PHOTO-EYE', 2], ['LABOR', 1], ['TRIP', 1]], hours: [1, 2] },
  { title: 'Preventive maintenance visit - controls', type: 'maintenance', billing: 'fixed', items: [['PM-VISIT', 1]], hours: [2, 3.5] },
  { title: 'Wash bay controller repair', type: 'repair', billing: 'hourly', items: [['TRIP', 1], ['WIRE', 1]], hours: [1.5, 3] },
  { title: 'Workshop 240V circuit & subpanel', type: 'installation', billing: 'fixed', items: [['LABOR', 6], ['WIRE', 3], ['TRIP', 1]], hours: [5, 7] },
  { title: 'Standby generator annual service', type: 'maintenance', billing: 'fixed', items: [['GEN-SVC', 1]], hours: [1.5, 2.5] }
];
const FIT = { 0: [0, 1, 2, 3, 4, 6, 7], 1: [0, 5, 7, 8], 2: [0, 1, 3, 4, 6], 3: [2, 4, 7], 4: [1, 2, 3, 6], 5: [0, 1, 5, 6], 6: [4], 7: [2, 7], 8: [8], 9: [10], 10: [9], 11: [2, 7] };

function loadDemo(adminCtx) {
  if (get('SELECT id FROM customers WHERE is_demo=1 LIMIT 1')) throw Object.assign(new Error('Sample data is already loaded.'), { status: 409 });
  const J = require('./services/jobs'), E = require('./services/estimates'), INV = require('./services/invoices'), L = require('./services/pricebook');
  const T = require('./services/tasks'), P = require('./services/plans'), RQ = require('./services/requests'), A = require('./services/activity');
  const r = rng(20261117); const pick = a => a[Math.floor(r() * a.length)];
  const zone = tz(); const t0 = today();
  const at = (date, hm) => zonedToUtc(date, hm, zone).toISOString();
  const between = (a, b) => a + r() * (b - a);
  const q = h => Math.max(0.25, Math.round(h * 4) / 4);
  const nowIso = new Date().toISOString();

  quietly(() => tx(() => {
    const ts = now();
    const team = [['Dana Reyes', 'field', 'human', 'Controls Technician', '#2a9d8a', 34, 95, 'dana.reyes@example.com'], ['Marcus Hill', 'field', 'human', 'Industrial Electrician', '#eb6834', 32, 90, 'marcus.hill@example.com'],
      ['Ava', 'office', 'ai', 'AI Office Manager', '#8e5cc7', 0, 0, ''], ['Dex', 'office', 'ai', 'AI Dispatcher', '#0f7c9c', 0, 0, '']]
      .map(([name, role, kind, title, color, cost, bill, email]) => insert('users', { name, role, kind, title, color, cost_rate: cost, bill_rate: bill, email,
        instructions: kind === 'ai' ? (title.includes('Dispatcher') ? 'You schedule jobs and keep the crew calendar tidy. Use find_availability before schedule_visit and draft customer confirmations.' : 'You run the office: inbox triage, estimates, invoicing and collections. Draft customer emails for owner review.') : '',
        is_demo: 1, created_at: ts, updated_at: ts }));
    const [dana, marcus, ava, dex] = team;
    const owner = get("SELECT * FROM users WHERE role='owner' AND kind='human' ORDER BY id LIMIT 1");
    const techs = [dana, marcus];
    const userRow = id => get('SELECT * FROM users WHERE id=:id', { id });
    const ctxOf = id => userCtx(userRow(id), 'ui');
    const officeCtx = owner ? userCtx(owner, 'ui') : adminCtx;

    const pb = {};
    for (const [code, name, kind, unit, price, cost, category, taxable] of PRICEBOOK) pb[code] = insert('pricebook', { code, name, kind, unit, price, cost, category, taxable, active: 1, is_demo: 1, created_at: ts, updated_at: ts });

    const custs = CUSTOMERS.map(([name, kind, company, email, phone, street, city, zip, source, tags, contacts, access, [lat, lng], status, terms], i) => {
      const created = at(addDays(t0, -170 + i * 4), '10:00');
      const id = insert('customers', { number: require('./db').nextNumber('C', 'customers'), name, kind, company, email, phone, status, source, tags, billing_street: street, billing_city: city, billing_state: 'WI', billing_zip: zip,
        terms_days: terms, portal_token: token(18), is_demo: 1, created_by: 'Sample data', created_at: created, updated_at: created });
      insert('locations', { customer_id: id, name: kind === 'residential' ? 'Home' : 'Main site', street, city, state: 'WI', zip, lat, lng, access_notes: access, is_primary: 1, created_at: created, updated_at: created });
      contacts.forEach(([n2, role, em, ph], k) => insert('contacts', { customer_id: id, name: n2, role, email: em, phone: ph, is_primary: k === 0 ? 1 : 0, created_at: created }));
      A.log('customer', id, `Customer created (source: ${source}).`, { ctx: officeCtx, customerId: id, isDemo: 1 });
      run("UPDATE activity SET created_at=:c WHERE customer_id=:id", { c: created, id });
      return { id, i, lat, lng, name, created };
    });
    const itemsFor = tpl => tpl.items.map(([code, qty]) => ({ pricebook_id: pb[code], qty }));

    // --- past work: completed, invoiced and (mostly) paid
    const backdate = (jobId, iso) => { update('jobs', jobId, { created_at: iso, updated_at: iso }); run("UPDATE activity SET created_at=:c WHERE entity_type='job' AND entity_id=:id", { c: iso, id: jobId }); };
    let jobCount = 0;
    const jobs = [];
    for (let d = -150; d <= -2; d += 1 + Math.floor(r() * 2)) {
      const c = custs[Math.floor(r() * 12)];
      const tpl = TEMPLATES[pick(FIT[c.i] || [0])];
      const tech = c.i === 9 || c.i === 10 ? marcus : pick(techs);
      const day = addDays(t0, d);
      const wd = new Date(day + 'T12:00:00Z').getUTCDay(); if (wd === 0 || wd === 6) continue;
      const createdIso = at(addDays(day, -Math.floor(between(1, 6))), '09:15');
      const job = J.createJob({ customer_id: c.id, title: tpl.title, type: tpl.type, billing: tpl.billing, assigned_to: tech, items: itemsFor(tpl), priority: tpl.type === 'emergency' ? 'urgent' : 'normal' }, officeCtx, { isDemo: 1 });
      backdate(job.id, createdIso);
      const hours = q(between(...tpl.hours));
      const startHm = `${String(7 + Math.floor(r() * 6)).padStart(2, '0')}:${pick(['00', '30'])}`;
      const vStart = at(day, startHm), vEnd = new Date(new Date(vStart).getTime() + hours * 36e5).toISOString();
      const vid = insert('visits', { job_id: job.id, start_at: vStart, end_at: vEnd, status: 'completed', notes: '', en_route_at: new Date(new Date(vStart).getTime() - 20 * 60e3).toISOString(),
        arrived_at: vStart, completed_at: vEnd, arrive_lat: c.lat + (r() - 0.5) * 0.001, arrive_lng: c.lng + (r() - 0.5) * 0.001, complete_lat: c.lat, complete_lng: c.lng,
        completion_notes: pick(['Tested and verified with operator.', 'Replaced faulty component; line back in production.', 'Documented findings and left a copy with maintenance.', 'Customer signed off on site.']), is_demo: 1, created_at: createdIso, updated_at: vEnd });
      insert('visit_assignees', { visit_id: vid, user_id: tech });
      const tu = userRow(tech);
      insert('time_entries', { user_id: tech, job_id: job.id, visit_id: vid, work_date: day, started_at: vStart, ended_at: vEnd, hours, category: 'labor', description: 'On site',
        billable: tpl.billing === 'hourly' ? 1 : 0, bill_rate: tpl.type === 'emergency' ? 145 : tu.bill_rate, cost_rate: tu.cost_rate, start_lat: c.lat, start_lng: c.lng, end_lat: c.lat, end_lng: c.lng, is_demo: 1, created_at: vEnd, updated_at: vEnd });
      if (r() < 0.35) insert('expenses', { user_id: tech, job_id: job.id, expense_date: day, category: pick(['materials', 'fuel', 'mileage']), vendor: pick(['Grainger', 'Kenosha Electric Supply', 'Kwik Trip', 'Automation Direct']),
        description: 'Job supplies', amount: round2(between(12, 85)), miles: 0, billable: 0, is_demo: 1, created_at: vEnd, updated_at: vEnd });
      update('jobs', job.id, { status: 'completed', completed_at: vEnd, completion_notes: 'Work complete.', updated_at: vEnd });
      A.log('job', job.id, `${tu.name} completed the visit.`, { ctx: ctxOf(tech), kind: 'status', isDemo: 1 });
      run("UPDATE activity SET created_at=:c WHERE entity_type='job' AND entity_id=:id AND created_at > :c", { c: vEnd, id: job.id });
      jobs.push({ id: job.id, c, day, tpl, vEnd });
      jobCount++;
    }
    // a few larger projects (multi-day, fixed price)
    const big = [[3, 'SCADA data logging - lift stations 1-4', 'installation', [['SCADA-25', 4], ['ENG', 10], ['TRIP', 3]], -118, 3], [5, 'Packaging line conveyor automation', 'project', [['ENG', 18], ['LABOR', 32], ['PF525-2HP', 3], ['PHOTO-EYE', 8], ['WIRE', 6]], -64, 4], [0, 'Extruder line controls upgrade', 'project', [['ENG', 14], ['LABOR', 24], ['PLC-BACKUP', 1], ['PROX-M18', 6], ['WIRE', 4]], -27, 3]];
    for (const [ci, title, type, items, start, days] of big) {
      const c = custs[ci];
      const job = J.createJob({ customer_id: c.id, title, type, billing: 'fixed', assigned_to: dana, items: items.map(([code, qty]) => ({ pricebook_id: pb[code], qty })) }, officeCtx, { isDemo: 1 });
      backdate(job.id, at(addDays(t0, start - 12), '09:00'));
      let last = null;
      for (let k = 0; k < days; k++) {
        const day = addDays(t0, start + k); const s = at(day, '07:30'), e2 = at(day, '15:30'); last = e2;
        const vid = insert('visits', { job_id: job.id, start_at: s, end_at: e2, status: 'completed', arrived_at: s, completed_at: e2, arrive_lat: c.lat, arrive_lng: c.lng, is_demo: 1, created_at: s, updated_at: e2 });
        for (const tech of techs) {
          insert('visit_assignees', { visit_id: vid, user_id: tech });
          const tu = userRow(tech);
          insert('time_entries', { user_id: tech, job_id: job.id, visit_id: vid, work_date: day, started_at: s, ended_at: e2, hours: 8, category: 'labor', billable: 0, bill_rate: tu.bill_rate, cost_rate: tu.cost_rate, is_demo: 1, created_at: e2, updated_at: e2 });
        }
      }
      insert('expenses', { user_id: dana, job_id: job.id, expense_date: addDays(t0, start), category: 'materials', vendor: 'Automation Direct', description: 'Terminal blocks, DIN rail, ferrules', amount: round2(between(140, 420)), is_demo: 1, created_at: last, updated_at: last });
      update('jobs', job.id, { status: 'completed', completed_at: last, completion_notes: 'Commissioned and handed over with documentation.' });
      jobs.push({ id: job.id, c, day: addDays(t0, start + days - 1), tpl: { billing: 'fixed', title, items }, vEnd: last });
    }
    jobs.sort((a, b) => a.day.localeCompare(b.day));
    // invoice all but the most recent three completed jobs
    const toInvoice = jobs.slice(0, -3);
    toInvoice.forEach((j, k) => {
      const issue = addDays(j.day, Math.floor(between(0, 3)));
      const inv = get('SELECT * FROM invoices WHERE id=:id', { id: INV.createInvoice({ job_id: j.id, issue_date: issue }, officeCtx, { isDemo: 1 }) });
      const sentAt = at(issue, '16:00');
      update('invoices', inv.id, { status: 'sent', sent_at: sentAt, viewed_at: r() < 0.7 ? at(addDays(issue, 1), '09:00') : null, created_at: sentAt, updated_at: sentAt });
      run("UPDATE activity SET created_at=:c WHERE entity_type='invoice' AND entity_id=:id", { c: sentAt, id: inv.id });
      const age = -Math.floor((new Date(issue) - new Date(t0)) / 864e5);
      const fresh = get('SELECT * FROM invoices WHERE id=:id', { id: inv.id });
      const roll = r();
      // most older invoices paid; a few left open/overdue for realism
      if (age > 20 && roll < 0.82 || age <= 20 && roll < 0.35) {
        const paidOn = addDays(issue, Math.floor(between(3, Math.min(28, Math.max(4, age)))));
        INV.recordPayment({ invoice_id: inv.id, amount: fresh.balance, method: pick(['check', 'check', 'ach', 'card']), reference: String(1000 + Math.floor(r() * 8000)), received_on: paidOn > t0 ? t0 : paidOn }, officeCtx, { isDemo: 1 });
      } else if (age > 20 && roll < 0.9) {
        INV.recordPayment({ invoice_id: inv.id, amount: round2(fresh.balance / 2), method: 'check', reference: String(2000 + k), received_on: addDays(issue, 10) }, officeCtx, { isDemo: 1 });
      }
    });

    // --- estimates (converted for some past jobs, plus open pipeline)
    for (const j of jobs.filter(j => j.tpl.billing === 'fixed').slice(0, 6)) {
      const e = E.createEstimate({ customer_id: j.c.id, title: j.tpl.title, items: itemsFor(j.tpl) }, officeCtx, { isDemo: 1 });
      const issued = addDays(j.day, -10);
      update('estimates', e, { status: 'converted', job_id: j.id, issue_date: issued, expiry_date: addDays(issued, 30), sent_at: at(issued, '15:00'), viewed_at: at(addDays(issued, 1), '08:30'), approved_at: at(addDays(issued, 2), '11:00'), approved_name: 'Customer (online)', created_at: at(issued, '14:00') });
      update('jobs', j.id, { estimate_id: e });
      run("UPDATE activity SET created_at=:c WHERE entity_type='estimate' AND entity_id=:id", { c: at(issued, '14:00'), id: e });
    }
    const est = (cIdx, title, items, status, daysAgo, extra = {}) => {
      const id = E.createEstimate({ customer_id: custs[cIdx].id, title, items, message: 'Thanks for walking us through the line. Here is the proposed scope and pricing.' }, officeCtx, { isDemo: 1 });
      const issued = addDays(t0, -daysAgo);
      update('estimates', id, { status, issue_date: issued, expiry_date: addDays(issued, 30), sent_at: status === 'draft' ? null : at(issued, '15:30'), created_at: at(issued, '14:00'), ...extra });
      run("UPDATE activity SET created_at=:c WHERE entity_type='estimate' AND entity_id=:id", { c: at(issued, '14:00'), id });
      return id;
    };
    est(12, 'SCADA data logging for 3 packaging lines', [{ pricebook_id: pb['SCADA-25'], qty: 3 }, { pricebook_id: pb.ENG, qty: 12 }, { pricebook_id: pb.TRIP, qty: 2 }], 'sent', 5, { viewed_at: at(addDays(t0, -4), '10:12') });
    est(13, 'Compressor & vacuum pump controls upgrade', [{ pricebook_id: pb.LABOR, qty: 8 }, { pricebook_id: pb.WIRE, qty: 2 }, { name: 'Duplex alternator relay & panel', qty: 1, unit_price: 840, unit_cost: 560, taxable: true }, { pricebook_id: pb.TRIP, qty: 1 }], 'sent', 2);
    est(11, 'Grain dryer controls retrofit', [{ pricebook_id: pb.ENG, qty: 16 }, { pricebook_id: pb.LABOR, qty: 24 }, { name: 'CompactLogix controller & I/O kit', qty: 1, unit_price: 4850, unit_cost: 3720, taxable: true }, { pricebook_id: pb.WIRE, qty: 6 }], 'sent', 9);
    est(5, 'Ammonia room sensor upgrade', [{ name: 'Ammonia gas detector, industrial', qty: 4, unit_price: 685, unit_cost: 470, taxable: true }, { pricebook_id: pb.LABOR, qty: 10 }], 'declined', 26, { declined_at: at(addDays(t0, -20), '09:00'), decline_reason: 'Going with the equipment vendor this year.' });
    est(7, 'Boiler room BAS integration', [{ pricebook_id: pb.ENG, qty: 10 }, { pricebook_id: pb.LABOR, qty: 6 }], 'declined', 41, { declined_at: at(addDays(t0, -33), '13:00'), decline_reason: 'Budget pushed to next year.' });
    est(2, 'Second line PLC upgrade (draft)', [{ pricebook_id: pb.ENG, qty: 20 }, { pricebook_id: pb.LABOR, qty: 16 }], 'draft', 1);

    // --- in-progress consulting engagement with billable hours not yet invoiced
    const gl = custs[6];
    const consult = J.createJob({ customer_id: gl.id, title: 'Automation roadmap & cell design consulting', type: 'consulting', billing: 'hourly', assigned_to: owner ? owner.id : dana, budget_hours: 40,
      description: 'Assess three robotic work cells, recommend a controls architecture, and produce a phased automation roadmap.' }, officeCtx, { isDemo: 1 });
    backdate(consult.id, at(addDays(t0, -18), '10:00'));
    for (const [d, hm, hrs] of [[-14, '09:00', 4], [-7, '13:00', 3.5]]) {
      const day = addDays(t0, d); const s = at(day, hm); const e2 = new Date(new Date(s).getTime() + hrs * 36e5).toISOString();
      const vid = insert('visits', { job_id: consult.id, start_at: s, end_at: e2, status: 'completed', arrived_at: s, completed_at: e2, arrive_lat: gl.lat, arrive_lng: gl.lng, is_demo: 1, created_at: s, updated_at: e2 });
      insert('visit_assignees', { visit_id: vid, user_id: owner ? owner.id : dana });
      insert('time_entries', { user_id: owner ? owner.id : dana, job_id: consult.id, visit_id: vid, work_date: day, started_at: s, ended_at: e2, hours: hrs, category: 'consulting', description: d === -14 ? 'Site walk and cell assessment' : 'Architecture workshop with engineering', billable: 1, bill_rate: 135, cost_rate: 0, is_demo: 1, created_at: e2, updated_at: e2 });
    }
    insert('time_entries', { user_id: owner ? owner.id : dana, job_id: consult.id, work_date: addDays(t0, -5), hours: 3, category: 'consulting', description: 'Draft roadmap document', billable: 1, bill_rate: 135, cost_rate: 0, is_demo: 1, created_at: nowIso, updated_at: nowIso });
    update('jobs', consult.id, { status: 'in_progress' });
    J.createVisit(get('SELECT * FROM jobs WHERE id=:id', { id: consult.id }), { start: `${addDays(t0, 6)}T10:00`, duration_minutes: 120, assignees: [owner ? owner.id : dana], notes: 'Present roadmap to leadership.' }, officeCtx, { isDemo: 1 });

    // --- today and upcoming
    const lt = localDate(new Date(), zone);
    const curHm = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    const upcoming = [
      [0, '08:00', 120, 0, dana, 'Photo-eye alignment & replacement'], [0, '11:00', 90, 4, marcus, 'Replace failed proximity sensors'], [0, '14:00', 120, 1, dana, 'Control panel inspection & thermography'],
      [1, '09:00', 180, 2, marcus, 'VFD replacement on conveyor drive'], [2, '08:30', 120, 3, dana, 'PLC program backup & documentation'], [3, '13:00', 90, 8, marcus, 'Wash bay controller repair'],
      [5, '09:00', 240, 5, dana, 'Control panel inspection & thermography'], [8, '10:00', 120, 7, marcus, 'Preventive maintenance visit - controls']
    ];
    const weekdayOf = d => { let day = addDays(t0, d); const wd = new Date(day + 'T12:00:00Z').getUTCDay(); if (d > 0 && wd === 6) day = addDays(day, 2); if (d > 0 && wd === 0) day = addDays(day, 1); return day; };
    for (const [d, hm, mins, ci, tech, title] of upcoming) {
      const tpl = TEMPLATES.find(x => x.title === title);
      const job = J.createJob({ customer_id: custs[ci].id, title, type: tpl.type, billing: tpl.billing, assigned_to: tech, items: itemsFor(tpl) }, officeCtx, { isDemo: 1 });
      backdate(job.id, at(addDays(t0, -3 - Math.floor(r() * 6)), '11:00'));
      const vid = J.createVisit(get('SELECT * FROM jobs WHERE id=:id', { id: job.id }), { start: `${weekdayOf(d)}T${hm}`, duration_minutes: mins, assignees: [tech] }, officeCtx, { isDemo: 1 });
      if (d === 0) {
        const endHm = new Date(zonedToUtc(lt, hm, zone).getTime() + mins * 60e3);
        const v = get('SELECT * FROM visits WHERE id=:id', { id: vid });
        if (new Date() >= endHm) {
          update('visits', vid, { status: 'completed', arrived_at: v.start_at, completed_at: v.end_at, arrive_lat: custs[ci].lat, arrive_lng: custs[ci].lng, completion_notes: 'Aligned and tested all photo-eyes.' });
          insert('time_entries', { user_id: tech, job_id: job.id, visit_id: vid, work_date: lt, started_at: v.start_at, ended_at: v.end_at, hours: mins / 60, category: 'labor', billable: 0, bill_rate: 95, cost_rate: 34, is_demo: 1, created_at: nowIso, updated_at: nowIso });
          update('jobs', job.id, { status: 'completed', completed_at: v.end_at });
        } else if (curHm >= hm) {
          update('visits', vid, { status: 'on_site', arrived_at: v.start_at, arrive_lat: custs[ci].lat, arrive_lng: custs[ci].lng });
          insert('time_entries', { user_id: tech, job_id: job.id, visit_id: vid, work_date: lt, started_at: v.start_at, ended_at: null, hours: 0, category: 'labor', billable: 0, bill_rate: 95, cost_rate: 34, is_demo: 1, created_at: nowIso, updated_at: nowIso });
          update('jobs', job.id, { status: 'in_progress' });
        }
      }
    }
    // --- unscheduled, on hold
    const uns = [[3, 'Flow meter signal dropping out at lift station', 'repair', 'urgent'], [8, 'Wash bay 2 VFD tripping on overcurrent', 'repair', 'high'], [9, 'Standby generator annual service', 'maintenance', 'normal'], [4, 'Dock door interlock wiring', 'installation', 'normal']];
    for (const [ci, title, type, priority] of uns) {
      const job = J.createJob({ customer_id: custs[ci].id, title, type, priority, billing: type === 'repair' ? 'hourly' : 'fixed', items: type === 'maintenance' ? [{ pricebook_id: pb['GEN-SVC'], qty: 1 }] : [{ pricebook_id: pb.TRIP, qty: 1 }] }, officeCtx, { isDemo: 1 });
      backdate(job.id, at(addDays(t0, -Math.floor(between(0, 4))), '08:40'));
    }
    const hold = J.createJob({ customer_id: custs[2].id, title: 'Spindle drive replacement - CNC #4', type: 'repair', billing: 'fixed', assigned_to: marcus, items: [{ pricebook_id: pb['VFD-INSTALL'], qty: 1 }, { name: 'Spindle drive, 7.5 HP', qty: 1, unit_price: 2380, unit_cost: 1890, taxable: true }] }, officeCtx, { isDemo: 1 });
    update('jobs', hold.id, { status: 'on_hold', hold_reason: 'Waiting on parts - drive ships next week' });
    backdate(hold.id, at(addDays(t0, -9), '14:00'));

    // --- service plans (generate their next jobs)
    const plan = (ci, name, n, unit, due, tech, price, check) => P.createPlan({ customer_id: custs[ci].id, name, interval_value: n, interval_unit: unit, next_due: addDays(t0, due), lead_days: 14, assigned_to: tech, price, checklist: check, visit_time: '08:00', duration_minutes: 180, job_type: 'maintenance', description: 'Recurring preventive maintenance per service agreement.' }, officeCtx, { isDemo: 1 });
    plan(0, 'Quarterly controls PM', 3, 'month', 12, dana, 240, 'Back up PLC programs\nInspect panels and torque terminals\nThermal scan of drives and MCCs\nTest e-stops and safety circuits\nReview alarm history with maintenance');
    plan(1, 'Monthly brewhouse controls check', 1, 'month', 20, dana, 240, 'Check VFD fault logs\nCalibrate temperature transmitters\nTest CIP interlocks');
    plan(9, 'Generator annual service', 1, 'year', 75, marcus, 289, 'Change oil & filter\nTest transfer switch\nLoad test 30 min');
    P.generate({}, officeCtx);
    run('UPDATE jobs SET is_demo=1 WHERE plan_id IN (SELECT id FROM plans WHERE is_demo=1)');
    run('UPDATE visits SET is_demo=1 WHERE job_id IN (SELECT id FROM jobs WHERE is_demo=1)');

    // --- requests / leads
    const req = (name, data, hoursAgo, status = 'new') => {
      const id = RQ.createRequest({ name, ...data }, { ...officeCtx, actor: data.source === 'portal' ? `Web form: ${name}` : officeCtx.actor }, { isDemo: 1 });
      const c = new Date(Date.now() - hoursAgo * 36e5).toISOString();
      update('requests', id, { status, created_at: c, updated_at: c }); run("UPDATE activity SET created_at=:c WHERE entity_type='request' AND entity_id=:id", { c, id });
      return id;
    };
    req('Jordan Ellis', { company: 'Kenosha Bottling Co.', email: 'jordan.ellis@kenoshabottling.example', phone: '(262) 555-0199', address: '5200 30th Ave, Kenosha, WI 53144', service: 'PLC troubleshooting', details: 'Our capper PLC keeps faulting with a watchdog error about twice a shift. Can someone look at it this week?', source: 'portal', priority: 'high', preferred_time: 'Mornings' }, 3);
    req('Marisol Vega', { company: 'Racine Fitness Center', email: 'mvega@racinefit.example', phone: '(262) 555-0124', address: '1800 Durand Ave, Racine, WI 53403', service: 'HVAC controls', details: 'Rooftop unit controls not responding to the thermostat schedule. Emailed about a site visit.', source: 'email' }, 26);
    req('Tony Russo', { email: 'tony.russo@example.com', phone: '(262) 555-0161', address: '411 Elm St, Kenosha, WI 53140', service: 'EV charger circuit', details: 'Needs a 60A circuit for a Level 2 charger in a detached garage.', source: 'phone' }, 72, 'contacted');

    // --- tasks for people and AI staff
    const overdueInv = get("SELECT i.id, i.number, c.name FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.is_demo=1 AND i.status IN ('sent','viewed','partial') AND i.due_date < :t ORDER BY i.due_date LIMIT 1", { t: t0 });
    const sentEst = get("SELECT id, number FROM estimates WHERE is_demo=1 AND status='sent' ORDER BY sent_at LIMIT 1");
    const task = (title, data, status = 'open', result = '') => {
      const id = T.createTask({ title, ...data }, officeCtx, { isDemo: 1 });
      if (status !== 'open') update('tasks', id, { status, result, completed_at: status === 'done' ? new Date(Date.now() - 20 * 36e5).toISOString() : null });
      return id;
    };
    if (overdueInv) task(`Payment reminder for ${overdueInv.number} (${overdueInv.name})`, { assigned_to: ava, related_type: 'invoice', related_id: overdueInv.id, due_date: t0, priority: 'high', details: 'Send a friendly reminder. If over 60 days, escalate to the owner.' });
    if (sentEst) task(`Follow up on estimate ${sentEst.number}`, { assigned_to: ava, related_type: 'estimate', related_id: sentEst.id, due_date: addDays(t0, 1) });
    task('Schedule the urgent lift station flow meter call', { assigned_to: dex, due_date: t0, priority: 'urgent', related_type: 'customer', related_id: custs[3].id, details: 'Find the earliest slot for Marcus or Dana and confirm with Linda Moore.' });
    task('Draft kickoff email for the robotics roadmap project', { assigned_to: ava, related_type: 'job', related_id: consult.id }, 'done', 'Drafted in Gmail for review: agenda, site access questions and proposed workshop dates.');
    task('Order spindle drive for Kenosha Precision CNC #4', { assigned_to: owner ? owner.id : null, related_type: 'job', related_id: hold.id, due_date: addDays(t0, 1), priority: 'high' }, 'in_progress');
    task('Review Sturtevant SCADA scope before Friday', { assigned_to: owner ? owner.id : null, due_date: addDays(t0, 2), related_type: 'customer', related_id: custs[12].id });

    // --- a few office notes and an expense trail
    A.log('customer', custs[1].id, 'Call with Kelly: brewhouse shutdown scheduled for the 3rd week of next month - plan the PM around it.', { ctx: officeCtx, kind: 'call', isDemo: 1 });
    A.log('customer', custs[6].id, 'Erin wants the roadmap in two phases: quick wins this quarter, cell retrofit next fiscal year.', { ctx: officeCtx, kind: 'meeting', isDemo: 1 });
    for (let d = -140; d <= 0; d += 7) {
      insert('expenses', { user_id: pick(techs), expense_date: addDays(t0, d), category: 'fuel', vendor: 'Kwik Trip', description: 'Service van fuel', amount: round2(between(48, 92)), is_demo: 1, created_at: nowIso, updated_at: nowIso });
      if (r() < 0.4) insert('expenses', { user_id: pick(techs), expense_date: addDays(t0, d + 2), category: 'tools', vendor: pick(['Fluke via Grainger', 'Home Depot', 'Automation Direct']), description: pick(['Replacement test leads', 'Terminal crimper', 'Label printer tape', 'Safety glasses']), amount: round2(between(18, 160)), is_demo: 1, created_at: nowIso, updated_at: nowIso });
    }
  }));
  require('./services/reports').generateKpiSnapshots({ rebuild: true });
  setSetting('last_kpi_run', now());
  return { ok: true, ...countDemo() };
}
const countDemo = () => ({ customers: get('SELECT COUNT(*) n FROM customers WHERE is_demo=1').n, jobs: get('SELECT COUNT(*) n FROM jobs WHERE is_demo=1').n, invoices: get('SELECT COUNT(*) n FROM invoices WHERE is_demo=1').n });

function removeDemo() {
  tx(() => {
    const C = 'SELECT id FROM customers WHERE is_demo=1';
    for (const t of ['estimate', 'job', 'invoice']) run(`DELETE FROM line_items WHERE parent_type='${t}' AND parent_id IN (SELECT id FROM ${t}s WHERE customer_id IN (${C}) OR is_demo=1)`);
    run(`DELETE FROM calendar_events WHERE visit_id IN (SELECT v.id FROM visits v JOIN jobs j ON j.id=v.job_id WHERE j.customer_id IN (${C}))`);
    run(`UPDATE email_threads SET customer_id=NULL, job_id=NULL WHERE customer_id IN (${C})`);
    run(`DELETE FROM activity WHERE is_demo=1 OR customer_id IN (${C}) OR (entity_type='task' AND entity_id IN (SELECT id FROM tasks WHERE is_demo=1))
      OR (entity_type='request' AND entity_id IN (SELECT id FROM requests WHERE is_demo=1)) OR (entity_type='plan' AND entity_id IN (SELECT id FROM plans WHERE is_demo=1))`);
    run(`DELETE FROM time_entries WHERE is_demo=1 OR job_id IN (SELECT id FROM jobs WHERE customer_id IN (${C}))`);
    run(`DELETE FROM expenses WHERE is_demo=1 OR job_id IN (SELECT id FROM jobs WHERE customer_id IN (${C}))`);
    run(`DELETE FROM tasks WHERE is_demo=1 OR customer_id IN (${C})`);
    run(`DELETE FROM requests WHERE is_demo=1 OR customer_id IN (${C})`);
    run(`DELETE FROM customers WHERE is_demo=1`);
    run('DELETE FROM pricebook WHERE is_demo=1');
    run('DELETE FROM users WHERE is_demo=1');
    run('DELETE FROM kpi_snapshots');
    for (const [key, table] of [['customers', 'customers'], ['jobs', 'jobs'], ['estimates', 'estimates'], ['invoices', 'invoices'], ['requests', 'requests'], ['plans', 'plans']])
      if (!get(`SELECT id FROM ${table} LIMIT 1`)) setSetting('seq_' + key, null);
  });
  require('./services/reports').generateKpiSnapshots({ rebuild: true });
  return { ok: true };
}

module.exports = { loadDemo, removeDemo };
