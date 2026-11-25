const ext = globalThis.browser ?? globalThis.chrome;
const core = globalThis.DiffstatCore;
const $ = (id) => document.getElementById(id);

function flash(el, text, cls) {
  el.textContent = text;
  el.className = cls || '';
}

function addOwnerRow(owner = '', token = '') {
  const row = document.createElement('div');
  row.className = 'owner-row';

  const ownerInput = document.createElement('input');
  ownerInput.type = 'text';
  ownerInput.className = 'owner';
  ownerInput.placeholder = 'organization or user';
  ownerInput.autocomplete = 'off';
  ownerInput.spellcheck = false;
  ownerInput.value = owner;

  const tokenInput = document.createElement('input');
  tokenInput.type = 'password';
  tokenInput.className = 'token';
  tokenInput.placeholder = 'github_pat_…';
  tokenInput.autocomplete = 'off';
  tokenInput.spellcheck = false;
  tokenInput.value = token;

  const remove = document.createElement('button');
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => row.remove());

  row.append(ownerInput, tokenInput, remove);
  $('owner-tokens').append(row);
  return row;
}

// Reads the rows as [{ owner, token }], skipping empty ones. Throws on a half-filled row or an
// owner listed twice, so that a token is never silently dropped.
function readOwnerTokens() {
  const entries = [];
  const seen = new Set();
  for (const row of $('owner-tokens').querySelectorAll('.owner-row')) {
    const rawOwner = row.querySelector('.owner').value.trim();
    const token = row.querySelector('.token').value.trim();
    if (!rawOwner && !token) continue;
    const owner = core.normalizeOwner(rawOwner);
    if (!owner) throw new Error(rawOwner ? `"${rawOwner}" is not an organization or user name.` : 'A token has no organization next to it.');
    if (!token) throw new Error(`${owner} has no token.`);
    if (seen.has(owner)) throw new Error(`${owner} is listed twice.`);
    seen.add(owner);
    entries.push({ owner, token });
  }
  return entries;
}

async function load() {
  const { patterns, showViewed } = await ext.storage.sync.get({ patterns: core.DEFAULT_PATTERNS, showViewed: true });
  const { token, ownerTokens } = await ext.storage.local.get({ token: '', ownerTokens: [] });
  $('show-viewed').checked = showViewed;
  $('patterns').value = patterns;
  $('token').value = token;
  for (const e of Array.isArray(ownerTokens) ? ownerTokens : []) addOwnerRow(e.owner, e.token);
}

$('add-owner').addEventListener('click', () => addOwnerRow().querySelector('.owner').focus());

$('save').addEventListener('click', async () => {
  let ownerTokens;
  try {
    ownerTokens = readOwnerTokens();
  } catch (e) {
    return flash($('status'), `Not saved: ${e.message}`, 'bad');
  }
  await ext.storage.sync.set({ patterns: $('patterns').value, showViewed: $('show-viewed').checked });
  await ext.storage.local.set({ token: $('token').value.trim(), ownerTokens });
  flash($('status'), `Saved (${core.parsePatterns($('patterns').value).length} patterns).`, 'ok');
});

$('reset').addEventListener('click', () => {
  $('patterns').value = core.DEFAULT_PATTERNS;
  flash($('status'), 'Defaults restored. Save to apply.');
});

// Resolves to { ok, text } for one token ('' checks the anonymous limit).
async function checkToken(token) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    // /rate_limit does not count against the limit.
    const res = await fetch('https://api.github.com/rate_limit', { headers });
    if (res.status === 401) return { ok: false, text: 'Token rejected (401).' };
    const { resources: { core: rl } } = await res.json();
    const who = token ? 'Token OK' : 'No token';
    return { ok: Boolean(token), text: `${who}: ${rl.remaining}/${rl.limit} requests left this hour.` };
  } catch (e) {
    return { ok: false, bad: true, text: `Request failed: ${e.message}` };
  }
}

$('check').addEventListener('click', async () => {
  let ownerTokens;
  try {
    ownerTokens = readOwnerTokens();
  } catch (e) {
    return flash($('token-status'), e.message, 'bad');
  }
  const token = $('token').value.trim();
  flash($('token-status'), 'Checking…');
  const results = await Promise.all([token, ...ownerTokens.map((e) => e.token)].map(checkToken));
  if (ownerTokens.length === 0) {
    const r = results[0];
    return flash($('token-status'), r.text, r.ok ? 'ok' : token || r.bad ? 'bad' : '');
  }
  const labels = ['Default', ...ownerTokens.map((e) => e.owner)];
  const failed = results.some((r, i) => !r.ok && (i > 0 || token || r.bad));
  flash($('token-status'), results.map((r, i) => `${labels[i]}: ${r.text}`).join('\n'), failed ? 'bad' : 'ok');
});

load();
