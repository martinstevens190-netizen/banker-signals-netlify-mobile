import webpush from 'web-push';
import { id, nowIso } from './utils.js';
import { pushRepo } from './store.js';

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:you@example.com';
const pushReady = Boolean(vapidPublicKey && vapidPrivateKey);

if (pushReady) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export function getPushPublicKey() {
  return vapidPublicKey;
}

export async function subscribe(subscription) {
  if (!subscription?.endpoint) throw new Error('Valid subscription required');
  await pushRepo.insert({
    id: id(),
    endpoint: subscription.endpoint,
    subscription_json: JSON.stringify(subscription),
    created_at: nowIso(),
  });
  return { ok: true };
}

export async function sendPushToAll({ title, body, url = '/#alerts', alertId = '' }) {
  if (!pushReady) {
    return { sent: 0, skipped: true, reason: 'VAPID keys missing' };
  }
  const payload = JSON.stringify({ title, body, url, alertId });
  const subs = await pushRepo.all();
  let sent = 0;
  for (const row of subs) {
    try {
      const subscription = JSON.parse(row.subscription_json);
      await webpush.sendNotification(subscription, payload);
      sent += 1;
    } catch (error) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await pushRepo.deleteByEndpoint(row.endpoint);
      }
    }
  }
  return { sent, skipped: false };
}
