import crypto from 'crypto';
import { DateTime } from 'luxon';

export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Australia/Melbourne';

export function id() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}

export function localNow() {
  return DateTime.now().setZone(APP_TIMEZONE);
}

export function localDateString() {
  return localNow().toISODate();
}

export function isDayMatch(days, dt = localNow()) {
  if (days === 'daily') return true;
  const weekday = dt.weekday; // 1 Mon .. 7 Sun
  if (days === 'weekdays') return weekday >= 1 && weekday <= 5;
  if (days === 'weekends') return weekday === 6 || weekday === 7;
  return true;
}

export function hhmm(dt = localNow()) {
  return dt.toFormat('HH:mm');
}

export function shouldTrigger(schedule, dt = localNow()) {
  return Boolean(
    schedule?.is_enabled &&
    isDayMatch(schedule.days, dt) &&
    schedule.time_hhmm === hhmm(dt) &&
    schedule.last_trigger_local_date !== dt.toISODate()
  );
}
