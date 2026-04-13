
let vapidPublicKey = '';
let pushConfigured = false;
let currentSettings = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const promptList = $('#promptList');
const latestAlert = $('#latestAlert');
const alertBoard = $('#alertBoard');

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

function formatDays(days) {
  return days === 'daily' ? 'Daily' : days === 'weekdays' ? 'Weekdays' : days === 'weekends' ? 'Weekends' : days;
}

function switchTab(tab) {
  $$('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  $$('.screen').forEach((screen) => screen.classList.toggle('active', screen.id === `screen-${tab}`));
}

function badge(label, cls) {
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

function updatePushStatus() {
  if (!('Notification' in window)) {
    $('#pushStatus').textContent = 'Unsupported';
    $('#notificationLabel').textContent = 'Unsupported';
    return;
  }
  let status = Notification.permission === 'granted'
    ? 'Enabled'
    : Notification.permission === 'denied'
      ? 'Blocked'
      : 'Not enabled';

  if (Notification.permission === 'granted' && !pushConfigured) {
    status = 'Local only';
  }

  $('#pushStatus').textContent = status;
  $('#notificationLabel').textContent = status;

  const serverNote = $('#pushServerNote');
  if (serverNote) {
    if (pushConfigured) {
      serverNote.textContent = 'Phone push server is connected.';
    } else {
      serverNote.textContent = 'Phone push server is not connected yet. Preview and local test alerts will still work.';
    }
  }

  const pushButtons = ['#testPushBtn', '#testPushBtnTwo'];
  pushButtons.forEach((sel) => {
    const btn = $(sel);
    if (!btn) return;
    btn.disabled = !pushConfigured;
    btn.classList.toggle('disabled-btn', !pushConfigured);
    btn.title = pushConfigured ? 'Send a real push notification test.' : 'Server push is not connected yet.';
  });
}

async function showLocalNotification(title, body) {
  if (!('Notification' in window)) {
    throw new Error('Notifications are not supported on this device/browser.');
  }
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notification permission is still not enabled.');
    }
  }

  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/' }
    });
    return;
  }

  new Notification(title, { body, icon: '/icons/icon-192.png' });
}

function showInfo(message) {
  window.alert(message);
}

function fillSettings(settings) {
  currentSettings = settings;
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
  $('#nextScanLabel').textContent = `${displayTime(settings.default_scan_time || '21:00')} • ${formatDays(settings.default_days || 'daily')}`;
}

function displayTime(hhmm = '21:00') {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

function renderPrompts(prompts) {
  $('#promptCount').textContent = prompts.length;
  $('#bankerCount').textContent = prompts.filter((p) => p.banker_focus).length;
  $('#scheduleCount').textContent = prompts.reduce((sum, p) => sum + Number(p.schedule_count || 0), 0);

  if (!prompts.length) {
    promptList.innerHTML = `<div class="alert-card">No prompts added yet.</div>`;
    return;
  }

  promptList.innerHTML = prompts.map((prompt) => `
    <article class="prompt-card">
      <div class="prompt-top">
        <div>
          <h3 class="prompt-title">${escapeHtml(prompt.name)}</h3>
          <p class="subtle">${escapeHtml(prompt.body)}</p>
        </div>
      </div>
      <div class="badge-row">
        ${badge(prompt.category || 'Custom', 'green')}
        ${prompt.priority ? badge('Priority', 'gold') : ''}
        ${prompt.banker_focus ? badge('Banker alert on', 'pink') : badge('Banker alert off', 'soft')}
        ${badge(`${prompt.schedule_count} schedules`, 'blue')}
      </div>
      <div class="prompt-actions">
        <button class="switch-btn ${prompt.banker_focus ? 'on' : ''}" data-toggle-banker="${prompt.id}" data-priority="${prompt.priority ? 1 : 0}" data-banker="${prompt.banker_focus ? 1 : 0}">${prompt.banker_focus ? 'Banker alert on' : 'Turn banker on'}</button>
        <button class="mini-btn" data-toggle-priority="${prompt.id}" data-priority="${prompt.priority ? 1 : 0}" data-banker="${prompt.banker_focus ? 1 : 0}">${prompt.priority ? 'Remove priority' : 'Make priority'}</button>
        <button class="mini-btn" data-add-default="${prompt.id}">Use default time</button>
        <button class="mini-btn" data-delete-prompt="${prompt.id}">Delete</button>
      </div>
    </article>
  `).join('');
}

function renderLatestAlert(alerts) {
  if (!alerts.length) {
    latestAlert.className = 'alert-preview empty';
    latestAlert.textContent = 'No banker alert yet.';
    $('#latestPromptLabel').textContent = 'Waiting';
    alertBoard.innerHTML = '<div class="alert-card">Run a preview to see your banker notification layout.</div>';
    return;
  }

  const latest = alerts[0].payload || {};
  const bankerItems = latest.banker || [];
  const bands = latest.bands || {};
  $('#latestPromptLabel').textContent = latest.promptName || 'Manual banker scan';

  latestAlert.className = 'alert-preview';
  latestAlert.innerHTML = `
    <article class="alert-card dark">
      <h3>${escapeHtml(latest.title || '✅ Banker games ready')}</h3>
      <p class="subtle">${new Date(latest.createdAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })}</p>
      <ul>${bankerItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </article>
  `;

  alertBoard.innerHTML = `
    <article class="alert-card dark">
      <h3>✅ Cleanest banker games section</h3>
      <p class="subtle">Prompt: ${escapeHtml(latest.promptName || 'Manual banker scan')}</p>
      <ul>${bankerItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </article>
    <article class="alert-card">
      <h3>Total shots bands</h3>
      <div class="shot-band-list">
        <div class="shot-line"><span>Upper band total shots</span><strong>${escapeHtml(bands.shots_total?.upper || '-')}</strong></div>
        <div class="shot-line"><span>Lower band total shots</span><strong>${escapeHtml(bands.shots_total?.lower || '-')}</strong></div>
        <div class="shot-line"><span>Recommended banker total shots</span><strong>${escapeHtml(bands.shots_total?.recommended || '-')}</strong></div>
      </div>
    </article>
    <article class="alert-card">
      <h3>Total shots on target bands</h3>
      <div class="shot-band-list">
        <div class="shot-line"><span>Upper band total shots on target</span><strong>${escapeHtml(bands.shots_on_target?.upper || '-')}</strong></div>
        <div class="shot-line"><span>Lower band total shots on target</span><strong>${escapeHtml(bands.shots_on_target?.lower || '-')}</strong></div>
        <div class="shot-line"><span>Recommended total shots on target</span><strong>${escapeHtml(bands.shots_on_target?.recommended || '-')}</strong></div>
      </div>
    </article>
  `;
}

async function refresh() {
  const [config, prompts, alerts, settings] = await Promise.all([
    api('/api/config'),
    api('/api/prompts'),
    api('/api/alerts'),
    api('/api/settings')
  ]);
  vapidPublicKey = config.vapidPublicKey || '';
  pushConfigured = Boolean(config.pushConfigured);
  fillSettings(settings);
  renderPrompts(prompts);
  renderLatestAlert(alerts);
  updatePushStatus();
}

async function ensurePushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported on this device/browser.');
  }
  if (!vapidPublicKey) {
    throw new Error('Push notification key is missing on the server.');
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
  return subscription;
}

$$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

$('#settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const fd = new FormData(event.currentTarget);
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      defaultScanTime: fd.get('defaultScanTime'),
      defaultDays: fd.get('defaultDays'),
    }),
  });
  await refresh();
  switchTab('home');
});

$('#bandsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const fd = new FormData(event.currentTarget);
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      bands: {
        shots_total: {
          upper: fd.get('shotsUpper'),
          lower: fd.get('shotsLower'),
          recommended: fd.get('shotsRecommended'),
        },
        shots_on_target: {
          upper: fd.get('sotUpper'),
          lower: fd.get('sotLower'),
          recommended: fd.get('sotRecommended'),
        },
      },
    }),
  });
  await refresh();
  switchTab('shots');
});

$('#fillBandsBtn').addEventListener('click', () => {
  $('#shotsUpper').value = '28+';
  $('#shotsLower').value = '19+';
  $('#shotsRecommended').value = '22+';
  $('#sotUpper').value = '11+';
  $('#sotLower').value = '7+';
  $('#sotRecommended').value = '8+';
});

$('#bulkForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const fd = new FormData(event.currentTarget);
  await api('/api/prompts/bulk', {
    method: 'POST',
    body: JSON.stringify({
      text: fd.get('text'),
      category: fd.get('category'),
      priority: fd.get('priority') === 'on',
      bankerFocus: fd.get('bankerFocus') === 'on',
      autoSchedule: fd.get('autoSchedule') === 'on',
      scheduleTime: fd.get('scheduleTime'),
      days: fd.get('days'),
      notify: fd.get('notify') === 'on',
    }),
  });
  event.currentTarget.reset();
  $('#bulkScheduleTime').value = currentSettings?.default_scan_time || '21:00';
  $('#bulkDays').value = currentSettings?.default_days || 'daily';
  await refresh();
  switchTab('prompts');
});

promptList.addEventListener('click', async (event) => {
  const bankerBtn = event.target.closest('[data-toggle-banker]');
  if (bankerBtn) {
    const priority = bankerBtn.dataset.priority === '1';
    const bankerFocus = bankerBtn.dataset.banker === '1' ? false : true;
    await api(`/api/prompts/${bankerBtn.dataset.toggleBanker}/flags`, {
      method: 'PATCH',
      body: JSON.stringify({ priority, bankerFocus }),
    });
    await refresh();
    return;
  }

  const priorityBtn = event.target.closest('[data-toggle-priority]');
  if (priorityBtn) {
    const priority = priorityBtn.dataset.priority === '1' ? false : true;
    const bankerFocus = priorityBtn.dataset.banker === '1';
    await api(`/api/prompts/${priorityBtn.dataset.togglePriority}/flags`, {
      method: 'PATCH',
      body: JSON.stringify({ priority, bankerFocus }),
    });
    await refresh();
    return;
  }

  const addBtn = event.target.closest('[data-add-default]');
  if (addBtn) {
    await api('/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        promptId: addBtn.dataset.addDefault,
        time: currentSettings?.default_scan_time || '21:00',
        days: currentSettings?.default_days || 'daily',
        notify: true,
      }),
    });
    await refresh();
    return;
  }

  const delBtn = event.target.closest('[data-delete-prompt]');
  if (delBtn) {
    await api(`/api/prompts/${delBtn.dataset.deletePrompt}`, { method: 'DELETE' });
    await refresh();
  }
});

$('#applyToBankerBtn').addEventListener('click', async () => {
  await api('/api/schedules/apply-banker', {
    method: 'POST',
    body: JSON.stringify({
      time: $('#defaultScanTime').value || '21:00',
      days: $('#defaultDays').value || 'daily',
      notify: true,
    }),
  });
  await refresh();
});

async function generatePreview() {
  const output = await api('/api/alerts/generate-sample', {
    method: 'POST',
    body: JSON.stringify({ promptName: 'Manual banker scan', promptBody: 'Preview banker alert' }),
  });
  await refresh();
  switchTab('alerts');
  return output;
}

$('#generateSampleBtn').addEventListener('click', generatePreview);
$('#previewAlertBtn').addEventListener('click', generatePreview);

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showInfo('Notifications are not supported on this device/browser.');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    updatePushStatus();
    showInfo('Notification permission is not enabled yet.');
    return;
  }

  try {
    if (pushConfigured) {
      await ensurePushSubscription();
      showInfo('Notifications enabled.');
    } else {
      showInfo('Notifications are enabled on this device. Server push is not connected yet, so use Preview banker alert for now.');
    }
  } catch (error) {
    showInfo(error.message);
  } finally {
    updatePushStatus();
  }
}

$('#enablePushBtn').addEventListener('click', requestNotificationPermission);

$('#testPushBtn').addEventListener('click', async () => {
  try {
    await showLocalNotification('✅ Cleanest Top Banker Legs', 'This is a local test alert from your app.');
    showInfo('Local test alert sent.');
    updatePushStatus();
  } catch (error) {
    showInfo(error.message);
  }
});

$('#testPushBtnTwo').addEventListener('click', async () => {
  try {
    if (!pushConfigured) {
      showInfo('Server push is not connected on this Netlify app yet. Add the VAPID keys in Netlify first, then this button will send a real push alert.');
      return;
    }
    await ensurePushSubscription();
    await api('/api/notifications/test', { method: 'POST' });
    showInfo('Push test alert sent.');
  } catch (error) {
    showInfo(error.message);
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}

refresh().catch((error) => {
  console.error(error);
  latestAlert.className = 'alert-preview empty';
  latestAlert.textContent = 'Could not load app data yet.';
});
