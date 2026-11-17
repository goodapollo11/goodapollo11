// Apply the saved theme before first paint (external file because the CSP blocks inline scripts).
(function () {
  var t = 'nurzworks';
  try { t = localStorage.getItem('nw_theme') || 'nurzworks'; } catch (_) { /* private mode */ }
  document.documentElement.setAttribute('data-theme', t);
  var colors = { nurzworks: '#0f2a44', forest: '#1b3326', 'forest-night': '#0c1a12' };
  var m = document.querySelector('meta[name="theme-color"]');
  if (m && colors[t]) m.setAttribute('content', colors[t]);
})();
