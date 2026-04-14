import { id, nowIso, APP_TIMEZONE, localDateString } from './_lib/utils.js';
import { buildScanOutput } from './_lib/scanEngine.js';
import { alertRepo, ensureSeeded, promptRepo, runRepo, scheduleRepo, settingsRepo } from './_lib/store.js';
import { getPushPublicKey, sendPushToAll, subscribe } from './_lib/notifier.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

function pathParts(req) {
  const pathname = new URL(req.url).pathname;
  const marker = '/.netlify/functions/api/';
  const altMarker = '/api/';
  const cleaned = pathname.includes(marker)
    ? pathname.split(marker)[1]
    : pathname.includes(altMarker)
      ? pathname.split(altMarker)[1]
      : '';
  return cleaned.split('/').filter(Boolean);
}

export default async (req) => {
  await ensureSeeded();

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  }

  const parts = pathParts(req);
  const [resource, resourceId, extra] = parts;

  if (req.method === 'GET' && resource === 'health') return json({ ok: true, timezone: APP_TIMEZONE, now: nowIso(), localDate: localDateString() });
  if (req.method === 'GET' && resource === 'config') return json({ timezone: APP_TIMEZONE, vapidPublicKey: getPushPublicKey(), pushConfigured: Boolean(getPushPublicKey()) });
  if (req.method === 'GET' && resource === 'settings') return json(await settingsRepo.get());

  if (req.method === 'PATCH' && resource === 'settings') {
    const payload = await body(req);
    return json(await settingsRepo.update({
      default_scan_time: payload.defaultScanTime,
      default_days: payload.defaultDays,
      bands: payload.bands,
    }));
  }

  if (req.method === 'GET' && resource === 'prompts') return json(await promptRepo.all());

  if (req.method === 'POST' && resource === 'prompts' && !resourceId) {
    const payload = await body(req);
    if (!payload.name || !payload.body) return json({ error: 'name and body are required' }, 400);
    const created = await promptRepo.insert({
      id: id(),
      name: payload.name,
      category: payload.category || 'Custom',
      body: payload.body,
      priority: payload.priority ? 1 : 0,
      banker_focus: payload.bankerFocus ? 1 : 0,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    return json(created, 201);
  }

  if (req.method === 'POST' && resource === 'prompts' && resourceId === 'bulk') {
    const payload = await body(req);
    if (!payload.text || !String(payload.text).trim()) return json({ error: 'bulk text is required' }, 400);
    const sections = String(payload.text)
      .split(/\n---+\n/)
      .map((section) => section.trim())
      .filter(Boolean);
    const created = [];

    for (const section of sections) {
      const lines = section.split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.length < 2) continue;
      const [name, ...rest] = lines;
      const prompt = await promptRepo.insert({
        id: id(),
        name,
        category: payload.category || 'Custom',
        body: rest.join('\n'),
        priority: payload.priority ? 1 : 0,
        banker_focus: payload.bankerFocus ? 1 : 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      created.push(prompt);

      if (payload.autoSchedule) {
        await scheduleRepo.insert({
          id: id(),
          prompt_id: prompt.id,
          time_hhmm: payload.scheduleTime || '21:00',
          days: payload.days || 'daily',
          notify: payload.notify === false ? 0 : 1,
          is_enabled: 1,
          last_trigger_local_date: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
      }
    }

    return json({ createdCount: created.length, prompts: created }, 201);
  }

  if (req.method === 'PATCH' && resource === 'prompts' && extra === 'flags') {
    const payload = await body(req);
    const updated = await promptRepo.updateFlags(resourceId, {
      priority: payload.priority ? 1 : 0,
      banker_focus: payload.bankerFocus ? 1 : 0,
      updated_at: nowIso(),
    });
    if (!updated) return json({ error: 'Prompt not found' }, 404);
    return json(updated);
  }

  if (req.method === 'DELETE' && resource === 'prompts' && resourceId) {
    await promptRepo.delete(resourceId);
    return json({ ok: true });
  }

  if (req.method === 'GET' && resource === 'schedules') return json(await scheduleRepo.all());

  if (req.method === 'POST' && resource === 'schedules' && !resourceId) {
    const payload = await body(req);
    if (!payload.promptId) return json({ error: 'promptId is required' }, 400);
    const created = await scheduleRepo.insert({
      id: id(),
      prompt_id: payload.promptId,
      time_hhmm: payload.time || '21:00',
      days: payload.days || 'daily',
      notify: payload.notify === false ? 0 : 1,
      is_enabled: 1,
      last_trigger_local_date: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    return json(created, 201);
  }

  if (req.method === 'POST' && resource === 'schedules' && resourceId === 'apply-banker') {
    const payload = await body(req);
    const prompts = await promptRepo.all();
    const targetIds = prompts.filter((p) => p.banker_focus).map((p) => p.id);
    const created = await scheduleRepo.applyToPromptIds(targetIds.length ? targetIds : prompts.map((p) => p.id), {
      time_hhmm: payload.time || '21:00',
      days: payload.days || 'daily',
      notify: payload.notify === false ? 0 : 1,
    });
    return json({ ok: true, createdCount: created.length, schedules: created }, 201);
  }

  if (req.method === 'DELETE' && resource === 'schedules' && resourceId) {
    await scheduleRepo.delete(resourceId);
    return json({ ok: true });
  }

  if (req.method === 'GET' && resource === 'alerts') return json(await alertRepo.all());
  if (req.method === 'GET' && resource === 'runs') return json(await runRepo.all());

  if (req.method === 'POST' && resource === 'alerts' && resourceId === 'generate-sample') {
    const payload = await body(req);
    const settings = await settingsRepo.get();
    const output = await buildScanOutput({
      promptName: payload?.promptName || 'Manual banker scan',
      promptBody: payload?.promptBody || 'Generate banker-first preview',
      settings,
    });
    const saved = { id: id(), title: output.title, payload: output, created_at: nowIso(), source: 'manual-sample' };
    await alertRepo.insert(saved);
    await runRepo.insert({ id: id(), run_name: output.promptName, status: 'Completed', summary: 'Manual sample alert generated.', created_at: nowIso() });
    return json(saved, 201);
  }

  if (req.method === 'POST' && resource === 'notifications' && resourceId === 'subscribe') {
    const payload = await body(req);
    try { return json(await subscribe(payload), 201); } catch (error) { return json({ error: error.message }, 400); }
  }

  if (req.method === 'POST' && resource === 'notifications' && resourceId === 'test') {
    return json(await sendPushToAll({ title: '✅ Cleanest Top Banker Legs', body: 'Your banker games notification is ready.', url: '/#alerts' }));
  }

  return json({ error: 'Not found' }, 404);
};
