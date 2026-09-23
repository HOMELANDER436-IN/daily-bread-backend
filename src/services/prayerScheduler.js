'use strict';

const cron        = require('node-cron');
const admin       = require('firebase-admin');
const { getDb }   = require('../config/firebase');
const { sendBulk } = require('./fcmService');

const TIMEZONE = 'Asia/Kolkata';

const PRAYER_MESSAGES = {
  en: { title: 'Daily Bread', body: 'It is prayer time. Take a moment to pray.' },
  ml: { title: 'Daily Bread', body: 'ഇത് പ്രാർത്ഥന സമയമാണ്. ഒരു നിമിഷം പ്രാർത്ഥിക്കൂ.' },
};

/**
 * Get current HH:MM, yyyy-mm-dd, and dayOfWeek in Asia/Kolkata timezone.
 */
function getKolkataNow() {
  const now = new Date();
  const formatted = now.toLocaleString('en-IN', { timeZone: TIMEZONE, hour12: false });
  // formatted: "DD/MM/YYYY, HH:MM:SS"
  const [datePart, timePart] = formatted.split(', ');
  const [day, month, year] = datePart.split('/');
  const hhmm = timePart.substring(0, 5); // "HH:MM"
  const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

  // Determine day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' }).format(now);
  const dayMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
  const dayOfWeek = dayMap[dayName] ?? now.getDay();

  return { hhmm, dateStr, dayOfWeek, now };
}

/**
 * Sends notifications to all active devices.
 */
async function dispatchPrayerNotification(db, eventId, expiresAt) {
  const tokensSnap = await db.collection('device_tokens')
    .where('is_active', '==', true)
    .get();

  if (tokensSnap.empty) {
    console.warn('[Prayer Scheduler] No active device tokens — notification dispatch skipped');
    return;
  }

  const enTokens = [];
  const mlTokens = [];

  tokensSnap.forEach(doc => {
    const data = doc.data();
    const tkn = data.token || data.fcm_token;
    if (!tkn) return;
    if (data.language === 'ml') mlTokens.push(tkn);
    else                        enTokens.push(tkn);
  });

  const notifData = {
    type: 'prayer',
    event_id: eventId,
    expires_at: expiresAt.toDate().toISOString(),
  };

  console.info(`[Prayer Scheduler] Sending to ${enTokens.length} EN + ${mlTokens.length} ML devices`);

  await Promise.all([
    enTokens.length ? sendBulk(enTokens, PRAYER_MESSAGES.en.title, PRAYER_MESSAGES.en.body, notifData) : null,
    mlTokens.length ? sendBulk(mlTokens, PRAYER_MESSAGES.ml.title, PRAYER_MESSAGES.ml.body, notifData) : null,
  ].filter(Boolean));
}

const checkAndSendPrayerNotification = async () => {
  const db = getDb();
  if (!db) return;

  try {
    const { hhmm, dateStr, dayOfWeek, now } = getKolkataNow();

    // 1. Check all active multiple prayer schedules in `prayer_schedules`
    const schedulesSnap = await db.collection('prayer_schedules')
      .where('enabled', '==', true)
      .get();

    if (!schedulesSnap.empty) {
      for (const doc of schedulesSnap.docs) {
        const schedule = { id: doc.id, ...doc.data() };
        if (schedule.time !== hhmm) continue;

        let shouldTrigger = false;

        if (schedule.type === 'daily') {
          shouldTrigger = true;
        } else if (schedule.type === 'weekly') {
          const days = (schedule.daysOfWeek || []).map(Number);
          shouldTrigger = days.includes(dayOfWeek);
        } else if (schedule.type === 'once') {
          shouldTrigger = (schedule.date === dateStr && !schedule.completed);
        }

        if (!shouldTrigger) continue;

        // Idempotency: Unique event identity for each schedule occurrence
        const eventDocId = `${schedule.id}_${dateStr}`;
        const eventRef = db.collection('prayer_events').doc(eventDocId);
        const eventDoc = await eventRef.get();

        if (eventDoc.exists) {
          console.info(`[Prayer Scheduler] Schedule ${schedule.id} already ran for ${dateStr} — skipping`);
          continue;
        }

        const scheduledAt = admin.firestore.Timestamp.fromDate(now);
        const expiresAt   = admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 2 * 60 * 60 * 1000));

        await eventRef.set({
          schedule_id:    schedule.id,
          scheduleId:     schedule.id,
          date:           dateStr,
          event_date:     dateStr,
          scheduledTime:  hhmm,
          scheduled_time: hhmm,
          scheduledAt:    scheduledAt,
          scheduled_at:   scheduledAt,
          sentAt:         scheduledAt,
          sent_at:        scheduledAt,
          expiresAt:      expiresAt,
          expires_at:     expiresAt,
          message:        PRAYER_MESSAGES.en.body,
          created_at:     scheduledAt,
        });

        // If once schedule, mark completed and disabled
        if (schedule.type === 'once') {
          await doc.ref.update({
            completed: true,
            enabled: false,
            updatedAt: admin.firestore.Timestamp.now(),
            updated_at: admin.firestore.Timestamp.now(),
          });
        }

        await dispatchPrayerNotification(db, eventDocId, expiresAt);
        console.info(`[Prayer Scheduler] Fired schedule ${schedule.id} (${schedule.type} at ${hhmm}) on ${dateStr}`);
      }
    }

    // 2. Legacy fallback: check prayer_settings/current if no schedules exist
    if (schedulesSnap.empty) {
      let settingsDoc = await db.doc('prayer_settings/current').get();
      if (!settingsDoc.exists) {
        settingsDoc = await db.doc('prayer_settings/main').get();
      }

      if (settingsDoc.exists) {
        const settings = settingsDoc.data();
        if (settings.enabled) {
          const targetTime = settings.prayer_time || (
            settings.hour !== undefined && settings.minute !== undefined
              ? `${String(settings.hour).padStart(2, '0')}:${String(settings.minute).padStart(2, '0')}`
              : null
          );

          if (targetTime && hhmm === targetTime) {
            const eventRef = db.collection('prayer_events').doc(dateStr);
            const eventDoc = await eventRef.get();

            if (!eventDoc.exists) {
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

              await dispatchPrayerNotification(db, dateStr, expiresAt);
              console.info(`[Prayer Scheduler] Legacy prayer notification sent for ${dateStr}`);
            }
          }
        }
      }
    }
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
