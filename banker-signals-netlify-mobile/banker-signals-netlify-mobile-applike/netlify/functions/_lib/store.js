import { getStore } from '@netlify/blobs';
import { id, nowIso } from './utils.js';

const store = getStore('banker-signals');
const keys = {
  prompts: 'prompts.json',
  schedules: 'schedules.json',
  alerts: 'alerts.json',
  runs: 'runs.json',
  subscriptions: 'subscriptions.json',
  settings: 'settings.json',
};

function defaultPrompts() {
  const createdAt = nowIso();
  return [
    {
      id: id(),
      name: 'Cleanest Top Banker Legs',
      category: 'Banker',
      body: 'Scan global yet-to-start fixtures in the next 12 hours and return the cleanest top banker legs of the day in Australia/Melbourne time.',
      priority: 1,
      banker_focus: 1,
      created_at: createdAt,
      updated_at: createdAt,
    },
    {
      id: id(),
      name: 'Daily 5 Odds VIP — Set A + Set B',
      category: 'Accumulator',
      body: 'Build two verified low-variance accumulators. Set A banker lean. Set B controlled mixed markets.',
      priority: 1,
      banker_focus: 1,
      created_at: createdAt,
      updated_at: createdAt,
    },
  ];
}

function defaultSchedules(prompts) {
  const createdAt = nowIso();
  return prompts.filter((p) => p.banker_focus).map((prompt) => ({
    id: id(),
    prompt_id: prompt.id,
    time_hhmm: '21:00',
    days: 'daily',
    notify: 1,
    is_enabled: 1,
    last_trigger_local_date: null,
    created_at: createdAt,
    updated_at: createdAt,
  }));
}

function defaultSettings() {
  return {
    default_scan_time: '21:00',
    default_days: 'daily',
    bands: {
      shots_total: { upper: '28+', lower: '19+', recommended: '22+' },
      shots_on_target: { upper: '11+', lower: '7+', recommended: '8+' },
    },
    updated_at: nowIso(),
  };
}

async function readJson(key, fallback) {
  const value = await store.get(key, { type: 'json' });
  return value ?? fallback;
}

async function writeJson(key, value) {
  await store.setJSON(key, value);
  return value;
}

export async function ensureSeeded() {
  let prompts = await readJson(keys.prompts, null);
  if (!prompts) {
    prompts = defaultPrompts();
    await writeJson(keys.prompts, prompts);
  }
  let schedules = await readJson(keys.schedules, null);
  if (!schedules) {
    schedules = defaultSchedules(prompts);
    await writeJson(keys.schedules, schedules);
  }
  if ((await readJson(keys.alerts, null)) === null) await writeJson(keys.alerts, []);
  if ((await readJson(keys.runs, null)) === null) await writeJson(keys.runs, []);
  if ((await readJson(keys.subscriptions, null)) === null) await writeJson(keys.subscriptions, []);
  if ((await readJson(keys.settings, null)) === null) await writeJson(keys.settings, defaultSettings());
  return { prompts, schedules };
}

export const settingsRepo = {
  async get() {
    await ensureSeeded();
    return readJson(keys.settings, defaultSettings());
  },
  async update(patch = {}) {
    const current = await this.get();
    const next = {
      ...current,
      ...(patch.default_scan_time ? { default_scan_time: patch.default_scan_time } : {}),
      ...(patch.default_days ? { default_days: patch.default_days } : {}),
      bands: {
        ...(current.bands || {}),
        shots_total: {
          ...(current.bands?.shots_total || {}),
          ...(patch.bands?.shots_total || {}),
        },
        shots_on_target: {
          ...(current.bands?.shots_on_target || {}),
          ...(patch.bands?.shots_on_target || {}),
        },
      },
      updated_at: nowIso(),
    };
    await writeJson(keys.settings, next);
    return next;
  },
};

export const promptRepo = {
  async all() {
    await ensureSeeded();
    const [prompts, schedules] = await Promise.all([readJson(keys.prompts, []), readJson(keys.schedules, [])]);
    return prompts
      .map((p) => ({ ...p, schedule_count: schedules.filter((s) => s.prompt_id === p.id).length }))
      .sort((a, b) => (b.priority - a.priority) || (b.banker_focus - a.banker_focus) || String(b.created_at).localeCompare(String(a.created_at)));
  },
  async insert(prompt) {
    const prompts = await readJson(keys.prompts, []);
    prompts.unshift(prompt);
    await writeJson(keys.prompts, prompts);
    return { ...prompt, schedule_count: 0 };
  },
  async updateFlags(idValue, fields) {
    const prompts = await readJson(keys.prompts, []);
    const idx = prompts.findIndex((p) => p.id === idValue);
    if (idx === -1) return null;
    prompts[idx] = { ...prompts[idx], ...fields };
    await writeJson(keys.prompts, prompts);
    return prompts[idx];
  },
  async delete(idValue) {
    const prompts = await readJson(keys.prompts, []);
    const schedules = await readJson(keys.schedules, []);
    await writeJson(keys.prompts, prompts.filter((p) => p.id !== idValue));
    await writeJson(keys.schedules, schedules.filter((s) => s.prompt_id !== idValue));
    return { ok: true };
  },
};

export const scheduleRepo = {
  async all() {
    await ensureSeeded();
    const [prompts, schedules] = await Promise.all([readJson(keys.prompts, []), readJson(keys.schedules, [])]);
    return schedules
      .map((s) => {
        const p = prompts.find((item) => item.id === s.prompt_id) || {};
        return { ...s, prompt_name: p.name || 'Unknown prompt', banker_focus: p.banker_focus || 0, priority: p.priority || 0 };
      })
      .sort((a, b) => String(a.time_hhmm).localeCompare(String(b.time_hhmm)) || String(b.created_at).localeCompare(String(a.created_at)));
  },
  async enabled() {
    const [prompts, schedules] = await Promise.all([readJson(keys.prompts, []), readJson(keys.schedules, [])]);
    return schedules
      .filter((s) => s.is_enabled)
      .map((s) => {
        const p = prompts.find((item) => item.id === s.prompt_id) || {};
        return { ...s, prompt_name: p.name || 'Unknown prompt', prompt_body: p.body || '', banker_focus: p.banker_focus || 0, priority: p.priority || 0 };
      });
  },
  async insert(schedule) {
    const schedules = await readJson(keys.schedules, []);
    schedules.unshift(schedule);
    await writeJson(keys.schedules, schedules);
    return schedule;
  },
  async applyToPromptIds(promptIds, options) {
    const schedules = await readJson(keys.schedules, []);
    const filtered = schedules.filter((s) => !promptIds.includes(s.prompt_id));
    const createdAt = nowIso();
    const created = promptIds.map((promptId) => ({
      id: id(),
      prompt_id: promptId,
      time_hhmm: options.time_hhmm || '21:00',
      days: options.days || 'daily',
      notify: options.notify === false ? 0 : 1,
      is_enabled: 1,
      last_trigger_local_date: null,
      created_at: createdAt,
      updated_at: createdAt,
    }));
    await writeJson(keys.schedules, [...created, ...filtered]);
    return created;
  },
  async delete(idValue) {
    const schedules = await readJson(keys.schedules, []);
    await writeJson(keys.schedules, schedules.filter((s) => s.id !== idValue));
    return { ok: true };
  },
  async markTriggered(idValue, localDate, updatedAt) {
    const schedules = await readJson(keys.schedules, []);
    const idx = schedules.findIndex((s) => s.id === idValue);
    if (idx !== -1) {
      schedules[idx] = { ...schedules[idx], last_trigger_local_date: localDate, updated_at: updatedAt };
      await writeJson(keys.schedules, schedules);
    }
  },
};

export const alertRepo = {
  async all(limit = 20) {
    const alerts = await readJson(keys.alerts, []);
    return alerts.slice(0, limit);
  },
  async insert(alert) {
    const alerts = await readJson(keys.alerts, []);
    alerts.unshift(alert);
    await writeJson(keys.alerts, alerts.slice(0, 50));
    return alert;
  },
};

export const runRepo = {
  async all(limit = 30) {
    const runs = await readJson(keys.runs, []);
    return runs.slice(0, limit);
  },
  async insert(run) {
    const runs = await readJson(keys.runs, []);
    runs.unshift(run);
    await writeJson(keys.runs, runs.slice(0, 100));
    return run;
  },
};

export const pushRepo = {
  async all() { return readJson(keys.subscriptions, []); },
  async insert(subscription) {
    const subscriptions = await readJson(keys.subscriptions, []);
    const filtered = subscriptions.filter((item) => item.endpoint !== subscription.endpoint);
    filtered.unshift(subscription);
    await writeJson(keys.subscriptions, filtered.slice(0, 200));
    return subscription;
  },
  async deleteByEndpoint(endpoint) {
    const subscriptions = await readJson(keys.subscriptions, []);
    await writeJson(keys.subscriptions, subscriptions.filter((item) => item.endpoint !== endpoint));
  },
};
