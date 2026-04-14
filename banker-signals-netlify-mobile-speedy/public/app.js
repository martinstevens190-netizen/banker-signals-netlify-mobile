const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  config: null,
  settings: null,
  prompts: [],
  alerts: [],
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

function formatDays(value = 'daily') {
  return value === 'weekdays' ? 'Weekdays' : value === 'weekends' ? 'Weekends' : 'Daily';
}

function badge(text, tone = 'soft') {
  return `<span class="badge ${tone}">${escapeHtml(text)}</span>`;
}

function switchTab(tab) {
  $$('.screen').forEach((screen) => screen.classList.toggle('active', screen.id === `screen-${tab}`));
  $$('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  window.scrollTo({ top: 0, behavior: 'auto' });
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
  $('#shotsUpper').value = settings.bands?.shots_total?.upper || '';
  $('#shotsLower').value = settings.bands?.shots_total?.lower || '';
  $('#shotsRecommended').value = settings.bands?.shots_total?.recommended || '';
  $('#sotUpper').value = settings.bands?.shots_on_target?.upper || '';
  $('#sotLower').value = settings.bands?.shots_on_target?.lower || '';
  $('#sotRecommended').value = settings.bands?.shots_on_target?.recommended || '';
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
        ${badge(prompt.banker_focus ? 'Banker alert on' : 'Banker alert off', prompt.banker_focus ? 'pink' : 'soft')}
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
}

function renderAlerts(alerts) {
  state.alerts = alerts;
  if (!alerts.length) {
    latestAlert.className = 'latest-alert empty';
    latestAlert.textContent = 'No banker alert yet.';
    $('#latestPromptLabel').textContent = 'Waiting';
    alertBoard.innerHTML = '<div class="alert-card empty">Create an alert to see banker games here.</div>';
    return;
  }

  const latest = alerts[0]?.payload || {};
  const banker = latest.banker || [];
  const bands = latest.bands || {};
  $('#latestPromptLabel').textContent = latest.promptName || 'Latest banker run';
  latestAlert.className = 'latest-alert';
  latestAlert.innerHTML = `
    <article class="alert-card dark">
      <h3>${escapeHtml(latest.title || '✅ Banker games ready')}</h3>
      <p class="subtle">${new Date(latest.createdAt || Date.now()).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })}</p>
      <ul>${banker.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </article>
  `;

  alertBoard.innerHTML = `
    <article class="alert-card dark">
      <h3>✅ Cleanest banker games</h3>
      <p class="subtle">${escapeHtml(latest.promptName || 'Latest banker run')}</p>
      <ul>${banker.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </article>
    <article class="alert-card">
      <h3>Total shots</h3>
      <div class="shot-band-list">
        <div class="shot-line"><span>Upper band total shots</span><strong>${escapeHtml(bands.shots_total?.upper || '-')}</strong></div>
        <div class="shot-line"><span>Lower band total shots</span><strong>${escapeHtml(bands.shots_total?.lower || '-')}</strong></div>
        <div class="shot-line"><span>Recommended banker total shots</span><strong>${escapeHtml(bands.shots_total?.recommended || '-')}</strong></div>
      </div>
    </article>
    <article class="alert-card">
      <h3>Total shots on target</h3>
      <div class="shot-band-list">
        <div class="shot-line"><span>Upper band total shots on target</span><strong>${escapeHtml(bands.shots_on_target?.upper || '-')}</strong></div>
        <div class="shot-line"><span>Lower band total shots on target</span><strong>${escapeHtml(bands.shots_on_target?.lower || '-')}</strong></div>
        <div class="shot-line"><span>Recommended total shots on target</span><strong>${escapeHtml(bands.shots_on_target?.recommended || '-')}</strong></div>
      </div>
    </article>
  `;
}

async function refresh() {
  const [config, settings, prompts, alerts] = await Promise.all([
    api('/api/config'),
    api('/api/settings'),
    api('/api/prompts'),
    api('/api/alerts'),
  ]);
  state.config = config;
  vapidPublicKey = config.vapidPublicKey || '';
  pushConfigured = Boolean(config.pushConfigured);
  fillSettings(settings);
  renderPrompts(prompts);
  renderAlerts(alerts);
  updatePushStatus();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function ensurePushSubscription() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
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
  if (!('Notification' in window)) {
    alert('Notifications are not supported on this device.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    updatePushStatus();
    return;
  }
  try {
    await ensurePushSubscription();
    updatePushStatus();
    alert('Notifications are enabled.');
  } catch (error) {
    alert(error.message);
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
  const form = new FormData(event.currentTarget);
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      defaultScanTime: form.get('defaultScanTime'),
      defaultDays: form.get('defaultDays'),
    }),
  });
  await refresh();
  switchTab('home');
});

$('#applyToBankerBtn').addEventListener('click', async () => {
  await api('/api/schedules/apply-banker', {
    method: 'POST',
    body: JSON.stringify({
      time: $('#defaultScanTime').value,
      days: $('#defaultDays').value,
      notify: true,
    }),
  });
  alert('Default time applied to banker prompts.');
  await refresh();
});

$('#bulkForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api('/api/prompts/bulk', {
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
  event.currentTarget.reset();
  $('#bulkScheduleTime').value = state.settings?.default_scan_time || '21:00';
  $('#bulkDays').value = state.settings?.default_days || 'daily';
  await refresh();
  switchTab('prompts');
});

$('#bandsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      bands: {
        shots_total: {
          upper: form.get('shotsUpper'),
          lower: form.get('shotsLower'),
          recommended: form.get('shotsRecommended'),
        },
        shots_on_target: {
          upper: form.get('sotUpper'),
          lower: form.get('sotLower'),
          recommended: form.get('sotRecommended'),
        },
      },
    }),
  });
  await refresh();
  switchTab('alerts');
});

$('#fillBandsBtn').addEventListener('click', () => {
  $('#shotsUpper').value = '28+';
  $('#shotsLower').value = '19+';
  $('#shotsRecommended').value = '22+';
  $('#sotUpper').value = '11+';
  $('#sotLower').value = '7+';
  $('#sotRecommended').value = '8+';
});

$('#generateSampleBtn').addEventListener('click', async () => {
  const bankerPrompt = state.prompts.find((item) => item.banker_focus) || state.prompts[0];
  await api('/api/alerts/generate-sample', {
    method: 'POST',
    body: JSON.stringify({
      promptName: bankerPrompt?.name || 'Manual banker scan',
      promptBody: bankerPrompt?.body || 'Generate banker games',
    }),
  });
  await refresh();
  switchTab('alerts');
});

$('#enablePushBtn').addEventListener('click', enableNotifications);
$('#testPushBtn').addEventListener('click', async () => {
  try {
    if (Notification.permission !== 'granted') await enableNotifications();
    await api('/api/notifications/test', { method: 'POST', body: JSON.stringify({}) });
    alert('Push test sent.');
  } catch (error) {
    alert(error.message);
  }
});

promptList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const promptId = button.dataset.id;

  if (button.dataset.action === 'banker') {
    await api(`/api/prompts/${promptId}/flags`, {
      method: 'PATCH',
      body: JSON.stringify({
        priority: button.dataset.priority === '1',
        bankerFocus: button.dataset.banker !== '1',
      }),
    });
  }

  if (button.dataset.action === 'priority') {
    await api(`/api/prompts/${promptId}/flags`, {
      method: 'PATCH',
      body: JSON.stringify({
        priority: button.dataset.priority !== '1',
        bankerFocus: button.dataset.banker === '1',
      }),
    });
  }

  if (button.dataset.action === 'schedule') {
    await api('/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        promptId,
        time: state.settings?.default_scan_time || '21:00',
        days: state.settings?.default_days || 'daily',
        notify: true,
      }),
    });
  }

  if (button.dataset.action === 'delete') {
    await api(`/api/prompts/${promptId}`, { method: 'DELETE' });
  }

  await refresh();
});

$$('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}

installZoomBlockers();
refresh().catch((error) => {
  console.error(error);
  $('#pushServerNote').textContent = 'App loaded with a connection issue. Refresh and try again.';
});
