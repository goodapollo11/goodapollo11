'use strict';
// Loads the database and registers every operation (services + integrations). Used by server.js and the tests.
const D = require('./db');
D.init();
require('./services/activity');
require('./services/customers');
require('./services/pricebook');
require('./services/time');
require('./services/jobs');
require('./services/estimates');
require('./services/invoices');
require('./services/requests');
require('./services/tasks');
require('./services/plans');
require('./services/team');
require('./services/reports');
require('./services/admin');
require('./integrations');
module.exports = { D, http: require('./http'), automation: require('./automation'), ops: require('./ops') };
