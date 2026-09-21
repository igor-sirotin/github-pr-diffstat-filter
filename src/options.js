const ext = globalThis.browser ?? globalThis.chrome;
const core = globalThis.DiffstatCore;
const $ = (id) => document.getElementById(id);

function flash(el, text, cls) {
  el.textContent = text;
  el.className = cls || '';
}

async function load() {
  const { patterns } = await ext.storage.sync.get({ patterns: core.DEFAULT_PATTERNS });
  const { token } = await ext.storage.local.get({ token: '' });
  $('patterns').value = patterns;
  $('token').value = token;
}

$('save').addEventListener('click', async () => {
  await ext.storage.sync.set({ patterns: $('patterns').value });
  await ext.storage.local.set({ token: $('token').value.trim() });
  flash($('status'), `Saved (${core.parsePatterns($('patterns').value).length} patterns).`, 'ok');
});

$('reset').addEventListener('click', () => {
  $('patterns').value = core.DEFAULT_PATTERNS;
  flash($('status'), 'Defaults restored. Save to apply.');
});

$('check').addEventListener('click', async () => {
  const token = $('token').value.trim();
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  flash($('token-status'), 'Checking…');
  try {
    // /rate_limit does not count against the limit.
    const res = await fetch('https://api.github.com/rate_limit', { headers });
    if (res.status === 401) return flash($('token-status'), 'Token rejected (401).', 'bad');
    const { resources: { core: rl } } = await res.json();
    const who = token ? 'Token OK' : 'No token';
    flash($('token-status'), `${who}: ${rl.remaining}/${rl.limit} requests left this hour.`, token ? 'ok' : '');
  } catch (e) {
    flash($('token-status'), `Request failed: ${e.message}`, 'bad');
  }
});

load();
