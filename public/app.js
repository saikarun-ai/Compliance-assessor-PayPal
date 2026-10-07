'use strict';

/* Compliance Assessor UI. Vanilla JS, no build step, no web fonts (DESIGN.md). */

const chat = document.getElementById('chat');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const amountInput = document.getElementById('amount');
const sendButton = document.getElementById('send');
const userTypeSelect = document.getElementById('user-type');
const modeBadge = document.getElementById('mode-badge');
const healthLabel = document.getElementById('health');
const trendForm = document.getElementById('trend-form');
const nicheInput = document.getElementById('niche');
const trendButton = document.getElementById('trend-send');
const trendOutput = document.getElementById('trend-output');

let paypalReady = false;

const esc = (value) => String(value === null || value === undefined ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Defence in depth: the server already allowlists PayPal hosts, but this value
// becomes an href, so a non-http scheme must never survive to the DOM.
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)paypal\.com$/i.test(url.hostname) ? url.href : null;
  } catch (err) {
    return null;
  }
};

const api = async (path, body) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);
  return data.data;
};

const scrollToEnd = () => { chat.scrollTop = chat.scrollHeight; };

const addUserMessage = (text) => {
  const wrap = document.createElement('div');
  wrap.className = 'message message-user';
  wrap.innerHTML = `<div class="bubble">${esc(text)}</div>`;
  chat.appendChild(wrap);
  scrollToEnd();
};

const addLoading = () => {
  const wrap = document.createElement('div');
  wrap.className = 'message message-agent';
  wrap.innerHTML = '<div class="card spinner">Classifying with llama.cpp + rule engine…</div>';
  chat.appendChild(wrap);
  scrollToEnd();
  return wrap;
};

const removeLoading = (node) => node && node.remove();

const renderError = (node, message) => {
  if (!node) {
    const wrap = document.createElement('div');
    wrap.className = 'message message-agent';
    chat.appendChild(wrap);
    node = wrap;
  }
  node.innerHTML = `<div class="card"><span class="badge badge-error">error</span> ${esc(message)}</div>`;
  scrollToEnd();
};

const edfBadge = (result) => {
  if (!result.edf_required) {
    return '<span class="badge badge-info">no EDF — non-export</span>';
  }
  const soon = result.edf_deadline_type === 'on-or-before-payment-receipt';
  return `<span class="badge ${soon ? 'badge-warning' : 'badge-success'}">EDF due ${esc(result.edf_deadline)}</span>`;
};

const invoiceBlock = (result) => {
  if (result.purpose_code === 'NON_EXPORT') {
    return '<p class="muted">Platform income — no cross-border invoice required.</p>';
  }
  if (!paypalReady) {
    return '<p class="muted">PayPal Sandbox credentials not configured. '
      + 'Use <code>POST /api/invoice/preview</code> to inspect the payload.</p>';
  }
  const amount = amountInput.value || '0';
  return `<div class="actions">
    <button type="button" class="primary" data-invoice="${esc(result.purpose_code)}"
      data-amount="${esc(amount)}">Create PayPal Invoice</button>
  </div>`;
};

const renderResult = (node, result) => {
  const sources = result.llm.used
    ? `rules + llama.cpp (${result.llm.used === true ? result.decided_by : 'n/a'})`
    : 'rules only (llama.cpp down)';
  node.innerHTML = `<div class="card">
    <h3>Purpose Code</h3>
    <div class="code">${esc(result.purpose_code)}</div>
    <p>${esc(result.purpose_label)} ${edfBadge(result)}</p>
    <p class="muted">${esc(result.purpose_description)}</p>
    <dl class="kv">
      <dt>EDF required</dt><dd>${result.edf_required ? 'Yes' : 'No'}</dd>
      <dt>Deadline type</dt><dd>${esc(result.edf_deadline_type || 'n/a')}</dd>
      <dt>EDF deadline</dt><dd>${esc(result.edf_deadline || 'n/a')}</dd>
      <dt>Rule</dt><dd>${esc(result.edf_rule)}</dd>
      <dt>Confidence</dt><dd>${esc(result.confidence)}${result.ambiguous ? ' (ambiguous)' : ''}</dd>
      <dt>Decided by</dt><dd>${esc(sources)}</dd>
      <dt>Rationale</dt><dd>${esc(result.rationale)}</dd>
    </dl>
    ${invoiceBlock(result)}
  </div>`;
  const button = node.querySelector('[data-invoice]');
  if (button) button.addEventListener('click', () => createInvoice(button, result.id));
  scrollToEnd();
};

const renderInvoice = (node, invoice) => {
  const approval = safeUrl(invoice.approval_url);
  node.innerHTML = `<div class="card">
    <h3>PayPal Sandbox invoice</h3>
    <dl class="kv">
      <dt>Invoice ID</dt><dd>${esc(invoice.id)}</dd>
      <dt>Invoice number</dt><dd>${esc(invoice.invoice_number)}</dd>
      <dt>Status</dt><dd>${esc(invoice.status)}</dd>
      <dt>Amount</dt><dd>${esc(invoice.currency)} ${esc(invoice.amount)}</dd>
      <dt>Purpose code</dt><dd>${esc(invoice.purpose_code)} (encoded in invoice_number)</dd>
    </dl>
    ${approval ? `<p><a href="${esc(approval)}" target="_blank"
      rel="noopener noreferrer">Open approval link</a></p>` : '<p class="muted">No approval link returned.</p>'}
  </div>`;
  scrollToEnd();
};

const createInvoice = async (button, recordId) => {
  button.disabled = true;
  button.textContent = 'Creating…';
  try {
    const invoice = await api('/api/invoice', {
      purposeCode: button.dataset.invoice,
      amount: Number(button.dataset.amount) || 0,
      recordId,
    });
    renderInvoice(button.closest('.card').parentNode, invoice);
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Create PayPal Invoice';
    const card = button.closest('.card');
    const note = document.createElement('p');
    note.className = 'muted';
    note.innerHTML = `<span class="badge badge-error">error</span> ${esc(err.message)}`;
    card.appendChild(note);
  }
};

const submitDescription = async (event) => {
  event.preventDefault();
  const description = input.value.trim();
  if (!description) return;

  addUserMessage(description);
  input.value = '';
  sendButton.disabled = true;
  const loading = addLoading();

  try {
    const result = await api('/api/classify', {
      description,
      userType: userTypeSelect.value,
    });
    removeLoading(loading);
    const wrap = document.createElement('div');
    wrap.className = 'message message-agent';
    chat.appendChild(wrap);
    renderResult(wrap, result);
  } catch (err) {
    renderError(loading, err.message);
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
};

const formatViews = (value) => Number(value || 0).toLocaleString('en-IN');

const renderTrend = (report) => {
  const skipped = report.sources.skipped.length
    ? `<p class="muted">Skipped: ${report.sources.skipped.map(esc).join('; ')}</p>`
    : '';
  const rows = report.top_videos.map((video) => `<tr>
    <td>${esc(video.title)}</td>
    <td>${esc(video.channel)}</td>
    <td>${formatViews(video.views)}</td>
  </tr>`).join('');

  trendOutput.innerHTML = `<div class="card">
    <h3>${esc(report.niche)} ${report.cached ? '<span class="badge badge-info">cached</span>' : ''}</h3>
    <p>${esc(report.trend_summary)}</p>
    <dl class="kv">
      <dt>Platforms</dt><dd>${esc(report.top_platforms)}</dd>
      <dt>Sentiment</dt><dd>${esc(report.sentiment)}
        <span class="badge badge-info">score ${esc(report.sentiment_detail.score)}</span></dd>
      <dt>Content angle</dt><dd>${esc(report.content_angle)}</dd>
      <dt>Engagement</dt><dd>top quartile = ${esc(report.engagement_rate)}% of views
        (${esc(report.view_multiplier)}x median of ${formatViews(report.median_views)})</dd>
      <dt>Sponsor CTA</dt><dd>${esc(report.call_to_action || 'n/a')}</dd>
    </dl>
    <p>Brand deal band: <span class="band">${esc(report.pricing_band)}</span></p>
    <p class="muted">${esc(report.pricing_band_usd.basis)}</p>
    <p class="muted">Sources: ${report.sources.youtube} YouTube, ${report.sources.rss} RSS,
      ${report.sources.exa} Exa, ${report.sources.transcripts} transcripts ·
      ${report.duration_ms} ms · llm ${report.llm_used ? 'used' : 'skipped'}</p>
    ${skipped}
    ${rows ? `<table><thead><tr><th>Title</th><th>Channel</th><th>Views</th></tr></thead>
      <tbody>${rows}</tbody></table>` : ''}
  </div>`;
};

const submitTrend = async (event) => {
  event.preventDefault();
  const niche = nicheInput.value.trim();
  if (!niche) return;

  trendButton.disabled = true;
  trendOutput.innerHTML = '<div class="card spinner">Searching YouTube via Agent Reach…</div>';
  try {
    const report = await api('/api/trends', { niche });
    renderTrend(report);
  } catch (err) {
    trendOutput.innerHTML = `<div class="card"><span class="badge badge-error">error</span> ${esc(err.message)}</div>`;
  } finally {
    trendButton.disabled = false;
  }
};

const refreshHealth = async () => {
  try {
    const res = await fetch('/api/health');
    const { data } = await res.json();
    modeBadge.textContent = data.mode;
    modeBadge.className = `badge ${data.mode === 'llm+rules' ? 'badge-success' : 'badge-warning'}`;
    paypalReady = data.paypal.configured;
    healthLabel.textContent = `llm ${data.llama.available ? 'up' : 'down'} · `
      + `paypal ${paypalReady ? 'ready' : 'no creds'} · `
      + data.agent_reach.channels.map((channel) => `${channel.channel}:${channel.ok ? 'ok' : 'missing'}`).join(' ');
  } catch (err) {
    modeBadge.textContent = 'server offline';
    modeBadge.className = 'badge badge-error';
    healthLabel.textContent = err.message;
  }
};

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    input.value = chip.dataset.sample;
    input.focus();
  });
});

composer.addEventListener('submit', submitDescription);
trendForm.addEventListener('submit', submitTrend);
amountInput.value = '2000';

refreshHealth();
setInterval(refreshHealth, 30000);
input.focus();
