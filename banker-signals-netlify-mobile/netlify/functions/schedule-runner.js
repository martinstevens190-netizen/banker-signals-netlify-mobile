import { id, localDateString, localNow, nowIso, shouldTrigger } from './_lib/utils.js';
import { buildScanOutput } from './_lib/scanEngine.js';
import { alertRepo, ensureSeeded, runRepo, scheduleRepo, settingsRepo } from './_lib/store.js';
import { sendPushToAll } from './_lib/notifier.js';

export const config = { schedule: '*/15 * * * *' };

export default async () => {
  await ensureSeeded();
  const dt = localNow();
  const settings = await settingsRepo.get();
  const schedules = await scheduleRepo.enabled();
  const results = [];

  for (const schedule of schedules) {
    if (!shouldTrigger(schedule, dt)) continue;
    try {
      const output = await buildScanOutput({ promptName: schedule.prompt_name, promptBody: schedule.prompt_body, settings });
      await alertRepo.insert({ id: id(), title: output.title, payload: output, created_at: nowIso(), source: output.source || 'scheduled' });
      await runRepo.insert({ id: id(), run_name: schedule.prompt_name, status: 'Completed', summary: `Scheduled run completed for ${schedule.time_hhmm} (${schedule.days}).`, created_at: nowIso() });
      if (schedule.notify) await sendPushToAll({ title: output.notificationTitle, body: output.notificationBody, url: '/#alerts' });
      await scheduleRepo.markTriggered(schedule.id, localDateString(), nowIso());
      results.push({ prompt: schedule.prompt_name, status: 'completed' });
    } catch (error) {
      await runRepo.insert({ id: id(), run_name: schedule.prompt_name, status: 'Failed', summary: `Run failed: ${error.message}`, created_at: nowIso() });
      results.push({ prompt: schedule.prompt_name, status: 'failed', error: error.message });
    }
  }

  return new Response(JSON.stringify({ ok: true, checkedAt: nowIso(), ran: results }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
};
