'use strict';
// NurzWorks HQ - business tracking for a mobile service & consulting business.
// Zero dependencies: Node.js 22.13+ (built-in SQLite). Start with: node server.js
const { D, http, automation } = require('./lib/app');
const AU = require('./lib/auth');

const args = process.argv.slice(2);
if (args[0] === 'reset-password') {
  const email = String(args[1] || '').toLowerCase();
  const u = D.get("SELECT * FROM users WHERE lower(email)=:e AND kind='human'", { e: email });
  if (!u) { console.error(`No person with email "${email}". Team members: ${D.all("SELECT email FROM users WHERE kind='human' AND email != ''").map(r => r.email).join(', ') || 'none'}`); process.exit(1); }
  const pw = require('crypto').randomBytes(9).toString('base64url');
  D.update('users', u.id, { password_hash: AU.hashPassword(pw), active: 1, updated_at: D.now() });
  AU.destroyUserSessions(u.id);
  console.log(`\n  Temporary password for ${u.name} <${u.email}>: ${pw}\n  Sign in and change it under your profile.\n`);
  process.exit(0);
}

const PORT = Number(process.env.PORT || 4200);
const HOST = process.env.NW_HOST || '0.0.0.0';
const server = http.createServer();
server.listen(PORT, HOST, () => {
  const lines = ['', '  NurzWorks HQ is running.', `  Open:            http://localhost:${PORT}`, `  Request page:    http://localhost:${PORT}/request`,
    `  AI (MCP) URL:    http://localhost:${PORT}/mcp`, `  Database:        ${D.DB_PATH}`];
  if (AU.needsSetup()) lines.push('', `  FIRST-TIME SETUP CODE:  ${AU.setupCode()}`, '  Open the app and enter this code to create the owner account.');
  lines.push('  Leave this window open while you use the app. Press Ctrl+C to stop.', '');
  console.log(lines.join('\n'));
  if (!process.env.NW_NO_AUTOMATION) automation.start();
});
const shutdown = () => { automation.stop(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
