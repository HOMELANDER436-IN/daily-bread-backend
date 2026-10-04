'use strict';

const cron        = require('node-cron');
const admin       = require('firebase-admin');
const { getDb }   = require('../config/firebase');
const { sendBulk } = require('./fcmService');

// Authoritative timezone for every prayer schedule (fixed UTC+05:30, no DST).
const TIMEZONE = 'Asia/Kolkata';
const TZ_OFFSET = '+05:30';

// A scheduler tick may be late by a moment (event-loop stall, slow Firestore call, restart
// during the minute). A due schedule is still fired if the tick is at most this many minutes
// after the scheduled minute. Delivery is idempotent, so a late tick can never duplicate.
// Anything later than this is considered EXPIRED and is never resurrected.
const GRACE_MINUTES = 2;

const EVENTS_COLLECTION = 'prayer_events';

const PRAYER_MESSAGES = {
  en: { title: 'Daily Bread', body: 'It is prayer time. Take a moment to pray.' },
  ml: { title: 'Daily Bread', body: 'ഇത് പ്രാർത്ഥന സമയമാണ്. ഒരു നിമിഷം പ്രാർത്ഥിക്കൂ.' },
};

/**
 * Get current HH:MM, yyyy-mm-dd, and dayOfWeek in Asia/Kolkata timezone.
 * Uses Intl formatToParts with an explicit 23-hour cycle (never "24:xx" at midnight)
 * and does not depend on the server's local timezone or locale string layout.
 */
function getKolkataNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find(p => p.type === type).value;

  const hour = get('hour') === '24' ? '00' : get('hour');
  const hhmm = `${hour}:${get('minute')}`;
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;

  // Determine day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' }).format(now);
  const dayMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
  const dayOfWeek = dayMap[dayName] ?? now.getDay();

  return { hhmm, dateStr, dayOfWeek, now };
}

const minutesOfDay = (hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

const tsToMillis = (ts) => {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Is `scheduleTime` (HH:MM, Asia/Kolkata) due on this tick?
 *  - exactly at its minute, or
 *  - up to GRACE_MINUTES late, but only if the schedule was not created/edited after its
 *    target moment (so creating or re-enabling a schedule for a time that has already
 *    passed never fires immediately).
 */
function isDue({ scheduleTime, nowHhmm, dateStr, changedAtMs }) {
  const target = minutesOfDay(scheduleTime);
  const current = minutesOfDay(nowHhmm);
  if (target === null || current === null) return false;

  const late = current - target;
  if (late < 0 || late > GRACE_MINUTES) return false;
  if (late === 0) return true;

  if (changedAtMs) {
    const targetMs = new Date(`${dateStr}T${scheduleTime}:00${TZ_OFFSET}`).getTime();
    if (changedAtMs > targetMs) return false;
  }
  return true;
}

/**
 * Atomically claim a prayer occurrence. Firestore `create()` fails with ALREADY_EXISTS if the
 * document exists, so exactly ONE caller can ever win a given eventId — across Render
 * restarts, overlapping cron ticks and multiple backend instances. No in-memory state needed.
 */
async function claimOccurrence(db, eventId, payload) {
  try {
    await db.collection(EVENTS_COLLECTION).doc(eventId).create(payload);
    return true;
  } catch (err) {
    if (err && (err.code === 6 || /already exists/i.test(err.message || ''))) return false;
    throw err;
  }
}

/**
 * Deterministic occurrence identity: `<scheduleId>_<yyyy-mm-dd>`.
 * This is the same id the installed Android app computes for its local alarm, so the app can
 * de-duplicate local alarm vs. FCM. If the same schedule is re-timed and fires a SECOND time
 * on the same day, the new time is appended so it is a distinct occurrence.
 * Returns null if this schedule already ran at this time today.
 */
async function resolveEventId(db, scheduleId, dateStr, scheduleTime) {
  const baseId = `${scheduleId}_${dateStr}`;
  const existing = await db.collection(EVENTS_COLLECTION).doc(baseId).get();
  if (!existing.exists) return baseId;

  const d = existing.data() || {};
  const ranAt = d.scheduled_time || d.scheduledTime;
  if (ranAt === scheduleTime) return null; // this exact occurrence was already handled
  return `${baseId}_${scheduleTime.replace(':', '')}`;
}

/**
 * Sends notifications to all active devices.
 */
async function dispatchPrayerNotification(db, { eventId, scheduleId, expiresAt }) {
  const tokensSnap = await db.collection('device_tokens')
    .where('is_active', '==', true)
    .get();

  if (tokensSnap.empty) {
    console.warn('[Prayer Scheduler] No active device tokens — notification dispatch skipped');
    return;
  }

  // A token must receive an occurrence at most once, even if it is stored on two documents.
  const seen = new Set();
  const enTokens = [];
  const mlTokens = [];

  tokensSnap.forEach(doc => {
    const data = doc.data();
    const tkn = data.token || data.fcm_token;
    if (!tkn || seen.has(tkn)) return;
    seen.add(tkn);
    if (data.language === 'ml') mlTokens.push(tkn);
    else                        enTokens.push(tkn);
  });

  const notifData = {
    type: 'prayer',
    schedule_id: scheduleId,
    event_id: eventId,
    occurrence_id: eventId,
    expires_at: expiresAt.toDate().toISOString(),
    sent_at: new Date().toISOString(),
  };

  console.info(`[Prayer Scheduler] Sending ${eventId} to ${enTokens.length} EN + ${mlTokens.length} ML devices`);

  await Promise.all([
    enTokens.length ? sendBulk(enTokens, PRAYER_MESSAGES.en.title, PRAYER_MESSAGES.en.body, notifData) : null,
    mlTokens.length ? sendBulk(mlTokens, PRAYER_MESSAGES.ml.title, PRAYER_MESSAGES.ml.body, notifData) : null,
  ].filter(Boolean));
}

/**
 * Claim then send ONE prayer occurrence. Returns true if this call sent it.
 * The claim happens BEFORE sending: if the process dies in between, the occurrence is
 * dropped (at-most-once) rather than re-sent late — the correct behaviour for an expiring event.
 */
async function fireOccurrence(db, { scheduleId, scheduleTime, dateStr, now, afterClaim }) {
  const eventId = await resolveEventId(db, scheduleId, dateStr, scheduleTime);
  if (!eventId) {
    console.info(`[Prayer Scheduler] Schedule ${scheduleId} already ran for ${dateStr} ${scheduleTime} — skipping`);
    return false;
  }

  const scheduledAt = admin.firestore.Timestamp.fromDate(now);
  const expiresAt   = admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 2 * 60 * 60 * 1000));

  const claimed = await claimOccurrence(db, eventId, {
    schedule_id:    scheduleId,
    scheduleId:     scheduleId,
    date:           dateStr,
    event_date:     dateStr,
    scheduledTime:  scheduleTime,
    scheduled_time: scheduleTime,
    scheduledAt:    scheduledAt,
    scheduled_at:   scheduledAt,
    sentAt:         scheduledAt,
    sent_at:        scheduledAt,
    expiresAt:      expiresAt,
    expires_at:     expiresAt,
    message:        PRAYER_MESSAGES.en.body,
    created_at:     scheduledAt,
  });

  if (!claimed) {
    console.info(`[Prayer Scheduler] Occurrence ${eventId} already claimed — skipping`);
    return false;
  }

  if (afterClaim) {
    try {
      await afterClaim();
    } catch (err) {
      console.warn(`[Prayer Scheduler] Post-claim update failed for ${eventId}: ${err.message}`);
    }
  }

  await dispatchPrayerNotification(db, { eventId, scheduleId, expiresAt });
  console.info(`[Prayer Scheduler] Fired ${eventId} (${scheduleTime}) on ${dateStr}`);
  return true;
}

let isChecking = false;

const checkAndSendPrayerNotification = async () => {
  if (isChecking) return;
  isChecking = true;

  const db = getDb();
  if (!db) {
    isChecking = false;
    return;
  }

  try {
    const { hhmm, dateStr, dayOfWeek, now } = getKolkataNow();

    // 1. Check all active multiple prayer schedules in `prayer_schedules`
    const schedulesSnap = await db.collection('prayer_schedules')
      .where('enabled', '==', true)
      .get();

    if (!schedulesSnap.empty) {
      for (const doc of schedulesSnap.docs) {
        const schedule = { id: doc.id, ...doc.data() };

        const changedAtMs = tsToMillis(schedule.updatedAt || schedule.updated_at || schedule.createdAt || schedule.created_at);
        if (!isDue({ scheduleTime: schedule.time, nowHhmm: hhmm, dateStr, changedAtMs })) continue;

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

        await fireOccurrence(db, {
          scheduleId: schedule.id,
          scheduleTime: schedule.time,
          dateStr,
          now,
          // If once schedule, mark completed and disabled as soon as this occurrence is claimed
          afterClaim: schedule.type === 'once'
            ? () => doc.ref.update({
                completed: true,
                enabled: false,
                updatedAt: admin.firestore.Timestamp.now(),
                updated_at: admin.firestore.Timestamp.now(),
              })
            : null,
        });
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

          const changedAtMs = tsToMillis(settings.updatedAt || settings.updated_at);
          if (targetTime && isDue({ scheduleTime: targetTime, nowHhmm: hhmm, dateStr, changedAtMs })) {
            // Older deployments stored the legacy event under the bare date as its id.
            const oldStyle = await db.collection(EVENTS_COLLECTION).doc(dateStr).get();
            const alreadyRanOldStyle = oldStyle.exists &&
              ((oldStyle.data() || {}).scheduled_time || (oldStyle.data() || {}).scheduledTime) === targetTime;

            if (!alreadyRanOldStyle) {
              // 'current' mirrors the schedule id the Android app uses for the legacy single schedule.
              await fireOccurrence(db, { scheduleId: 'current', scheduleTime: targetTime, dateStr, now });
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[Prayer Scheduler] Error:', err.message);
  } finally {
    isChecking = false;
  }
};

const startPrayerScheduler = () => {
  cron.schedule('* * * * *', checkAndSendPrayerNotification, {
    scheduled: true,
    timezone: TIMEZONE,
  });
  console.info(`[Prayer Scheduler] Started — checking every minute (${TIMEZONE})`);
};

module.exports = {
  startPrayerScheduler,
  checkAndSendPrayerNotification,
  // exported for unit tests
  _internals: { getKolkataNow, isDue, minutesOfDay, resolveEventId, claimOccurrence, GRACE_MINUTES },
};
