'use strict';

const cron        = require('node-cron');
const admin       = require('firebase-admin');
const { getDb }   = require('../config/firebase');
const { sendBulk } = require('./fcmService');

const TIMEZONE = 'Asia/Kolkata';

const PRAYER_MESSAGES = {
  en: { title: '🙏 Prayer Time',        body: 'Take a moment to pause, pray, and be still.' },
  ml: { title: '🙏 പ്രാർത്ഥന സമയം', body: 'അൽപ്പസമയം മാറ്റിവെച്ച് പ്രാർത്ഥിക്കൂ.' },
};

/**
 * Get current HH:MM and yyyy-mm-dd in Asia/Kolkata timezone.
 */
function getKolkataNow() {
  const now = new Date();
  const formatted = now.toLocaleString('en-IN', { timeZone: TIMEZONE, hour12: false });
  // formatted: "DD/MM/YYYY, HH:MM:SS"
  const [datePart, timePart] = formatted.split(', ');
  const [day, month, year] = datePart.split('/');
  const hhmm = timePart.substring(0, 5); // "HH:MM"
  const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return { hhmm, dateStr, now };
}

const checkAndSendPrayerNotification = async () => {
  const db = getDb();
  if (!db) return;

  try {
    // 1. Fetch prayer settings (check current, then main)
    let settingsDoc = await db.doc('prayer_settings/current').get();
    if (!settingsDoc.exists) {
      settingsDoc = await db.doc('prayer_settings/main').get();
    }
    if (!settingsDoc.exists) return;

    const settings = settingsDoc.data();
    if (!settings.enabled) return;

    // 2. Check current time in Asia/Kolkata
    const targetTime = settings.prayer_time || (
      settings.hour !== undefined && settings.minute !== undefined
        ? `${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')}`
        : null
    );
    if (!targetTime) return;

    const { hhmm, dateStr, now } = getKolkataNow();
    if (hhmm !== targetTime) return;

    console.info(`[Prayer Scheduler] Time match: ${hhmm} — checking idempotency for ${dateStr}`);

    // 3. Idempotency — one event per calendar day (doc ID = date)
    const eventRef = db.collection('prayer_events').doc(dateStr);
    const eventDoc = await eventRef.get();

    if (eventDoc.exists) {
      console.info(`[Prayer Scheduler] Event already sent for ${dateStr} — skipping`);
      return;
    }

    // 4. Create the 2-hour prayer event
    const scheduledAt = admin.firestore.Timestamp.fromDate(now);
    const expiresAt   = admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 2 * 60 * 60 * 1000));

    await eventRef.set({
      date:          dateStr,
      event_date:    dateStr,
      scheduledTime: hhmm,
      scheduled_time:hhmm,
      scheduledAt:   scheduledAt,
      scheduled_at:  scheduledAt,
      sentAt:        scheduledAt,
      sent_at:       scheduledAt,
      expiresAt:     expiresAt,
      expires_at:    expiresAt,
      message:       PRAYER_MESSAGES.en.body,
      created_at:    scheduledAt,
    });

    console.info(`[Prayer Scheduler] Event created for ${dateStr}`);

    // 5. Fetch all active FCM tokens
    const tokensSnap = await db.collection('device_tokens')
      .where('is_active', '==', true)
      .get();

    if (tokensSnap.empty) {
      console.warn('[Prayer Scheduler] No active device tokens — notifications skipped');
      return;
    }

    const enTokens = [];
    const mlTokens = [];

    tokensSnap.forEach(doc => {
      const { fcm_token, language } = doc.data();
      if (language === 'ml') mlTokens.push(fcm_token);
      else                    enTokens.push(fcm_token);
    });

    const notifData = { type: 'prayer', event_id: dateStr, expires_at: expiresAt.toDate().toISOString() };

    console.info(`[Prayer Scheduler] Sending to ${enTokens.length} EN + ${mlTokens.length} ML devices`);

    await Promise.all([
      enTokens.length ? sendBulk(enTokens, PRAYER_MESSAGES.en.title, PRAYER_MESSAGES.en.body, notifData) : null,
      mlTokens.length ? sendBulk(mlTokens, PRAYER_MESSAGES.ml.title, PRAYER_MESSAGES.ml.body, notifData) : null,
    ].filter(Boolean));

    console.info(`[Prayer Scheduler] Notifications sent for ${dateStr}`);
  } catch (err) {
    console.error('[Prayer Scheduler] Error:', err.message);
  }
};

const startPrayerScheduler = () => {
  cron.schedule('* * * * *', checkAndSendPrayerNotification, {
    scheduled: true,
    timezone: TIMEZONE,
  });
  console.info(`[Prayer Scheduler] Started — checking every minute (${TIMEZONE})`);
};

module.exports = { startPrayerScheduler, checkAndSendPrayerNotification };
