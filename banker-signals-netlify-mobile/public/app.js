const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  config: null,
  settings: null,
  prompts: [],
  alerts: [],
  targetAlertId: null,
};

let vapidPublicKey = '';
let pushConfigured = false;
let permissionState = 'default';

const promptList = $('#promptList');
const latestAlert = $('#latestAlert');
const alertBoard = $('#alertBoard');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function displayTime(hhmm = '21:00') {
  const [hours, minutes] = String(hhmm).split(':').map(Number);
  const dt = new Date();
  dt.setHours(hours || 21, minutes || 0, 0, 0);
  return dt.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

function badge(text, tone = 'soft') {
  return `<span class="badge ${tone}">${escapeHtml(text)}</span>`;
}

function currentUrl() {
  return new URL(window.location.href);
}

function getTargetAlertId() {
  const url = currentUrl();
  return url.searchParams.get('alert') || '';
}

function setTargetAlertId(alertId) {
  const url = currentUrl();
  if (alertId) url.searchParams.set('alert', alertId);
  else url.searchParams.delete('alert');
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  state.targetAlertId = alertId || null;
}

function clearTargetAlertId() {
  setTargetAlertId('');
}

function focusAlertCard(alertId, { smooth = true } = {}) {
  if (!alertId) return;
  const card = document.querySelector(`[data-alert-id="${CSS.escape(alertId)}"]`);
  if (!card) return;
  document.querySelectorAll('.alert-run-card.is-target').forEach((node) => node.classList.remove('is-target'));
  card.classList.add('is-target');
  card.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}


function switchTab(tab, { updateUrl = true } = {}) {
  $$('.screen').forEach((screen) => screen.classList.toggle('active', screen.id === `screen-${tab}`));
  $$('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  if (updateUrl) {
    const url = currentUrl();
    url.hash = tab === 'home' ? '#home' : tab === 'prompts' ? '#prompts' : '#alerts';
    if (tab !== 'alerts') url.searchParams.delete('alert');
    history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    state.targetAlertId = tab === 'alerts' ? (url.searchParams.get('alert') || null) : null;
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function getInitialTab() {
  const url = currentUrl();
  if (url.searchParams.get('alert')) return 'alerts';
  const hash = (url.hash || '').replace('#', '').toLowerCase();
  if (['home', 'prompts', 'alerts'].includes(hash)) return hash;
  const tab = url.searchParams.get('tab');
  if (['home', 'prompts', 'alerts'].includes((tab || '').toLowerCase())) return tab.toLowerCase();
  return 'home';
}

function updatePushStatus() {
  permissionState = window.Notification ? Notification.permission : 'unsupported';
  const label = permissionState === 'granted'
    ? 'On'
    : permissionState === 'denied'
      ? 'Blocked'
      : permissionState === 'unsupported'
        ? 'Unsupported'
        : 'Off';
  $('#pushStatus').textContent = label;
  $('#notificationLabel').textContent = label === 'On' ? 'Enabled' : label;
  $('#pushServerNote').textContent = pushConfigured
    ? 'Push server is connected.'
    : 'Push server still needs your Netlify keys.';
}

function fillSettings(settings) {
  state.settings = settings;
  $('#defaultScanTime').value = settings.default_scan_time || '21:00';
  $('#defaultDays').value = settings.default_days || 'daily';
  $('#bulkScheduleTime').value = settings.default_scan_time || '21:00';
  $('#bulkDays').value = settings.default_days || 'daily';
  $('#nextScanLabel').textContent = `${displayTime(settings.default_scan_time || '21:00')}`;
}

function renderPrompts(prompts) {
  state.prompts = prompts;
  $('#promptCount').textContent = prompts.length;
  $('#bankerCount').textContent = prompts.filter((item) => item.banker_focus).length;

  if (!prompts.length) {
    promptList.innerHTML = '<div class="alert-card empty">No prompts added yet.</div>';
    return;
  }

  promptList.innerHTML = prompts.map((prompt) => `
    <article class="prompt-card">
      <h3 class="prompt-title">${escapeHtml(prompt.name)}</h3>
      <p class="subtle">${escapeHtml(prompt.body)}</p>
      <div class="badge-row">
        ${badge(prompt.category || 'Custom', 'green')}
        ${badge(prompt.banker_focus ? 'Banker alert on' : 'Banker alert off', prompt.banker_focus ? 'olive' : 'soft')}
        ${badge(`${prompt.schedule_count || 0} schedules`, 'blue')}
        ${prompt.priority ? badge('Priority', 'gold') : ''}
      </div>
      <div class="prompt-actions">
        <button class="switch-btn ${prompt.banker_focus ? 'on' : ''}" data-action="banker" data-id="${prompt.id}" data-priority="${prompt.priority ? 1 : 0}" data-banker="${prompt.banker_focus ? 1 : 0}">${prompt.banker_focus ? 'Banker on' : 'Turn banker on'}</button>
        <button class="mini-btn" data-action="priority" data-id="${prompt.id}" data-priority="${prompt.priority ? 1 : 0}" data-banker="${prompt.banker_focus ? 1 : 0}">${prompt.priority ? 'Remove priority' : 'Make priority'}</button>
        <button class="mini-btn" data-action="schedule" data-id="${prompt.id}">Use default time</button>
        <button class="mini-btn" data-action="delete" data-id="${prompt.id}">Delete</button>
      </div>
    </article>
  `).join('');

  const target = state.targetAlertId || getTargetAlertId();
  if (target) {
    state.targetAlertId = target;
    window.requestAnimationFrame(() => focusAlertCard(target));
  }
}

function localDateKey(value) {
  const dt = new Date(value || Date.now());
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt);
}

function formatDateLabel(value) {
  const dt = new Date(value || Date.now());
  const currentKey = localDateKey(Date.now());
  const dateKey = localDateKey(dt);
  if (dateKey === currentKey) return 'Today';

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === localDateKey(yesterday)) return 'Yesterday';

  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(dt);
}

function formatDateTime(value) {
  return new Date(value || Date.now()).toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTimeOnly(value) {
  return new Date(value || Date.now()).toLocaleTimeString('en-AU', {
    timeZone: 'Australia/Melbourne',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toneForPrompt(name = '') {
  const tones = ['tone-green', 'tone-blue', 'tone-gold', 'tone-teal', 'tone-olive'];
  let sum = 0;
  for (const char of name) sum += char.charCodeAt(0);
  return tones[sum % tones.length];
}

function slugify(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'prompt';
}

function buildAlertGroups(alerts) {
  const groups = new Map();
  alerts.forEach((entry) => {
    const payload = entry.payload || {};
    const createdAt = payload.createdAt || entry.created_at || Date.now();
    const dayKey = localDateKey(createdAt);
    const promptName = payload.promptName || 'Banker scan';
    if (!groups.has(dayKey)) {
      groups.set(dayKey, { dayKey, label: formatDateLabel(createdAt), createdAt, prompts: new Map() });
    }
    const dayGroup = groups.get(dayKey);
    if (!dayGroup.prompts.has(promptName)) {
      dayGroup.prompts.set(promptName, { promptName, tone: toneForPrompt(promptName), alerts: [] });
    }
    dayGroup.prompts.get(promptName).alerts.push({ entry, payload, createdAt });
  });

  return [...groups.values()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((group) => ({
      ...group,
      prompts: [...group.prompts.values()].sort((a, b) => new Date(b.alerts[0]?.createdAt || 0) - new Date(a.alerts[0]?.createdAt || 0)),
    }));
}

function renderAlertItems(items = []) {
  if (!items.length) return '<div class="banker-empty-row">No banker games returned.</div>';
  return items.map((item, index) => `
    <div class="banker-row">
      <span class="banker-index">${index + 1}</span>
      <div class="banker-copy">${escapeHtml(item)}</div>
    </div>
  `).join('');
}

function renderAlerts(alerts) {
  state.alerts = alerts;
  if (!alerts.length) {
    latestAlert.className = 'latest-alert empty';
    latestAlert.textContent = 'No banker alert yet.';
    $('#latestPromptLabel').textContent = 'Waiting';
    alertBoard.innerHTML = '<div class="alert-card empty">Run a banker scan to see alerts here.</div>';
    return;
  }

  const latest = alerts[0]?.payload || {};
  const banker = latest.banker || [];
  $('#latestPromptLabel').textContent = latest.promptName || 'Latest banker run';
  latestAlert.className = 'latest-alert';
  latestAlert.innerHTML = `
    <article class="latest-alert-card ${toneForPrompt(latest.promptName || 'Banker scan')}">
      <div class="latest-alert-top">
        <div>
          <span class="section-chip">Latest banker board</span>
          <h3>${escapeHtml(latest.promptName || latest.title || '✅ Banker games ready')}</h3>
        </div>
        <span class="time-chip">${formatTimeOnly(latest.createdAt || Date.now())}</span>
      </div>
      <p class="subtle latest-meta">${formatDateTime(latest.createdAt || Date.now())}</p>
      <div class="banker-list compact-list">${renderAlertItems(banker.slice(0, 4))}</div>
    </article>
  `;

  const grouped = buildAlertGroups(alerts);
  alertBoard.innerHTML = grouped.map((dayGroup) => `
    <section class="day-group">
      <div class="day-header">
        <div>
          <p class="day-label">${escapeHtml(dayGroup.label)}</p>
          <span class="day-subtle">${dayGroup.prompts.length} prompt${dayGroup.prompts.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div class="prompt-group-stack">
        ${dayGroup.prompts.map((promptGroup) => `
          <article class="prompt-group-card ${promptGroup.tone}">
            <div class="prompt-group-head">
              <div>
                <span class="prompt-group-chip">${escapeHtml(promptGroup.alerts.length)} run${promptGroup.alerts.length === 1 ? '' : 's'}</span>
                <h3>${escapeHtml(promptGroup.promptName)}</h3>
              </div>
              <span class="prompt-group-time">${formatTimeOnly(promptGroup.alerts[0]?.createdAt || Date.now())}</span>
            </div>
            <div class="alert-run-stack">
              ${promptGroup.alerts.map(({ entry, payload, createdAt }, idx) => `
                <section class="alert-run-card" id="alert-${entry.id || payload.alertId || slugify(promptGroup.promptName)}" data-alert-id="${entry.id || payload.alertId || slugify(promptGroup.promptName)}">
                  <div class="alert-run-top">
                    <span class="run-pill">Run ${promptGroup.alerts.length - idx}</span>
                    <span class="run-time">${formatDateTime(createdAt)}</span>
                  </div>
                  ${payload.title ? `<p class="alert-run-title">${escapeHtml(payload.title)}</p>` : ''}
                  <div class="banker-list">${renderAlertItems(payload.banker || [])}</div>
                </section>
              `).join('')}
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `).join('');
}

async function refresh() {
  const [config, settings, prompts, alerts] = await Promise.all([
    api('/api/config'),
    api('/api/settings'),
    api('/api/prompts'),
    api('/api/alerts'),
  ]);
  state.config = config;
  state.targetAlertId = getTargetAlertId() || state.targetAlertId;
  vapidPublicKey = config.vapidPublicKey || '';
  pushConfigured = Boolean(config.pushConfigured);
  fillSettings(settings);
  renderPrompts(prompts);
  renderAlerts(alerts);
  updatePushStatus();
}

async function refreshPrompts() {
  const prompts = await api('/api/prompts');
  renderPrompts(prompts);
  return prompts;
}

async function refreshAlerts() {
  const alerts = await api('/api/alerts');
  renderAlerts(alerts);
  return alerts;
}

function ensureToast() {
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    toast.className = 'app-toast';
    document.body.appendChild(toast);
  }
  return toast;
}

let toastTimer;
function showToast(message, tone = 'success') {
  const toast = ensureToast();
  toast.textContent = message;
  toast.className = `app-toast show ${tone}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.className = 'app-toast';
  }, 2200);
}

function setBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.classList.add('busy');
    button.textContent = busyText || 'Working…';
  } else {
    button.disabled = false;
    button.classList.remove('busy');
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

function scrollToPromptList() {
  const listPanel = document.getElementById('promptList');
  if (listPanel) listPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function ensurePushSubscription() {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error('Push notifications are not supported on this device/browser.');
  }
  if (!vapidPublicKey) {
    throw new Error('Push key is missing on the server.');
  }
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }
  await api('/api/notifications/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    showToast('Notifications are not supported on this device.', 'error');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    updatePushStatus();
    showToast('Notifications were not enabled.', 'error');
    return;
  }
  try {
    await ensurePushSubscription();
    updatePushStatus();
    showToast('Notifications are enabled.');
  } catch (error) {
    showToast(error.message || 'Could not enable notifications.', 'error');
  }
}

function installZoomBlockers() {
  document.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (event) => {
    const tag = event.target?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    const now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener('dblclick', (event) => event.preventDefault(), { passive: false });
}

$('#settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formEl = event.currentTarget;
  const button = formEl.querySelector('button[type="submit"]');
  const form = new FormData(formEl);
  try {
    setBusy(button, true, 'Saving…');
    const settings = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        defaultScanTime: form.get('defaultScanTime'),
        defaultDays: form.get('defaultDays'),
      }),
    });
    fillSettings(settings);
    showToast('Scan time saved.');
    switchTab('home');
  } catch (error) {
    showToast(error.message || 'Could not save scan time.', 'error');
  } finally {
    setBusy(button, false);
  }
});

$('#applyToBankerBtn').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  try {
    setBusy(button, true, 'Applying…');
    await api('/api/schedules/apply-banker', {
      method: 'POST',
      body: JSON.stringify({
        time: $('#defaultScanTime').value,
        days: $('#defaultDays').value,
        notify: true,
      }),
    });
    await refreshPrompts();
    showToast('Default time applied to banker prompts.');
  } catch (error) {
    showToast(error.message || 'Could not apply schedule.', 'error');
  } finally {
    setBusy(button, false);
  }
});

$('#bulkForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formEl = event.currentTarget;
  const submitButton = formEl.querySelector('button[type="submit"]');
  const form = new FormData(formEl);
  try {
    setBusy(submitButton, true, 'Importing…');
    const result = await api('/api/prompts/bulk', {
      method: 'POST',
      body: JSON.stringify({
        text: form.get('text'),
        category: form.get('category'),
        priority: form.get('priority') === 'on',
        bankerFocus: form.get('bankerFocus') === 'on',
        autoSchedule: form.get('autoSchedule') === 'on',
        scheduleTime: form.get('scheduleTime'),
        days: form.get('days'),
        notify: form.get('notify') === 'on',
      }),
    });

    formEl.reset();
    $('#bulkScheduleTime').value = state.settings?.default_scan_time || '21:00';
    $('#bulkDays').value = state.settings?.default_days || 'daily';
    await refreshPrompts();
    switchTab('prompts');
    scrollToPromptList();
    const count = Number(result.createdCount || 0);
    showToast(count ? `Saved ${count} prompt${count === 1 ? '' : 's'} to Saved prompts.` : 'Nothing was imported. Check your prompt format.');
  } catch (error) {
    showToast(error.message || 'Import failed.', 'error');
  } finally {
    setBusy(submitButton, false);
  }
});

$('#generateSampleBtn').addEventListener('click', async (event) => {
  const bankerPrompt = state.prompts.find((item) => item.banker_focus) || state.prompts[0];
  const button = event.currentTarget;
  try {
    setBusy(button, true, 'Running…');
    const created = await api('/api/alerts/generate-sample', {
      method: 'POST',
      body: JSON.stringify({
        promptName: bankerPrompt?.name || 'Manual banker scan',
        promptBody: bankerPrompt?.body || 'Generate banker games',
      }),
    });
    setTargetAlertId(created.id || created.payload?.alertId || '');
    await refreshAlerts();
    switchTab('alerts');
    showToast('Banker alert created.');
  } catch (error) {
    showToast(error.message || 'Scan failed.', 'error');
  } finally {
    setBusy(button, false);
  }
});

$('#enablePushBtn').addEventListener('click', enableNotifications);
$('#testPushBtn').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  try {
    setBusy(button, true, 'Sending…');
    if (Notification.permission !== 'granted') await enableNotifications();
    const result = await api('/api/notifications/test', { method: 'POST', body: JSON.stringify({}) });
    if (result?.url) setTargetAlertId((new URL(result.url, window.location.origin)).searchParams.get('alert') || '');
    showToast('Push test sent. Open the notification to jump straight to that alert.');
  } catch (error) {
    showToast(error.message || 'Push test failed.', 'error');
  } finally {
    setBusy(button, false);
  }
});

promptList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  const promptId = button.dataset.id;
  const action = button.dataset.action;
  const previousPrompts = [...state.prompts];

  try {
    if (action === 'delete') {
      const nextPrompts = state.prompts.filter((item) => item.id !== promptId);
      renderPrompts(nextPrompts);
      showToast('Deleting prompt…');
      await api(`/api/prompts/${promptId}`, { method: 'DELETE' });
      showToast('Prompt deleted.');
      return;
    }

    setBusy(button, true, action === 'schedule' ? 'Saving…' : 'Updating…');

    if (action === 'banker') {
      await api(`/api/prompts/${promptId}/flags`, {
        method: 'PATCH',
        body: JSON.stringify({
          priority: button.dataset.priority === '1',
          bankerFocus: button.dataset.banker !== '1',
        }),
      });
      await refreshPrompts();
      showToast(button.dataset.banker === '1' ? 'Banker alert turned off.' : 'Banker alert turned on.');
      return;
    }

    if (action === 'priority') {
      await api(`/api/prompts/${promptId}/flags`, {
        method: 'PATCH',
        body: JSON.stringify({
          priority: button.dataset.priority !== '1',
          bankerFocus: button.dataset.banker === '1',
        }),
      });
      await refreshPrompts();
      showToast(button.dataset.priority === '1' ? 'Priority removed.' : 'Priority enabled.');
      return;
    }

    if (action === 'schedule') {
      await api('/api/schedules', {
        method: 'POST',
        body: JSON.stringify({
          promptId,
          time: state.settings?.default_scan_time || '21:00',
          days: state.settings?.default_days || 'daily',
          notify: true,
        }),
      });
      await refreshPrompts();
      showToast('Default time added to this prompt.');
      return;
    }
  } catch (error) {
    renderPrompts(previousPrompts);
    showToast(error.message || 'Prompt action failed.', 'error');
  } finally {
    setBusy(button, false);
  }
});

$$('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

window.addEventListener('hashchange', () => {
  state.targetAlertId = getTargetAlertId() || null;
  switchTab(getInitialTab(), { updateUrl: false });
});


if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'OPEN_ALERT' && data.alertId) {
      setTargetAlertId(data.alertId);
      switchTab('alerts');
      window.setTimeout(() => focusAlertCard(data.alertId), 120);
    }
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}

installZoomBlockers();
state.targetAlertId = getTargetAlertId() || null;
switchTab(getInitialTab(), { updateUrl: false });
refresh().catch((error) => {
  console.error(error);
  $('#pushServerNote').textContent = 'App loaded with a connection issue. Refresh and try again.';
  showToast('Could not load the latest data.', 'error');
});
