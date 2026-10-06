'use strict';

const { admin } = require('../config/firebase');
const logger = require('../config/logger');

const PRAYER_CHANNEL_ID = 'daily_bread_prayer';

/**
 * Prayer notifications are an EXPIRING real-time event, not a queued message.
 *
 * Android : ttl = 0 ms  -> FCM must deliver immediately or discard. Never queued.
 * Web Push: TTL = 0     -> same semantics.
 * APNs    : apns-expiration = 0 -> deliver once, do not store.
 *
 * Top-level `notification` + `android.notification`:
 * Ensures the Android system tray reliably shows the notification and plays the
 * bundled `res/raw/church_bell.mp3` sound on the `daily_bread_prayer` channel even
 * when the app is in the background or killed.
 * In the foreground, MyFirebaseMessagingService.onMessageReceived displays the
 * in-app notification with church bell audio and prayer banner.
 */
const buildPrayerMessage = (token, title, body, dataStrings) => ({
  token,
  notification: { title, body },
  data: {
    ...(title ? { title: String(title) } : {}),
    ...(body ? { body: String(body) } : {}),
    ...dataStrings,
  },
  android: {
    priority: 'high',
    ttl: 0,
    collapseKey: PRAYER_CHANNEL_ID,
    notification: {
      channelId: PRAYER_CHANNEL_ID,
      sound: 'church_bell',
      defaultSound: false,
      priority: 'max',
      visibility: 'public',
      notificationPriority: 'PRIORITY_MAX',
    },
  },
  webpush: {
    headers: {
      Urgency: 'high',
      TTL: '0',
    },
    notification: {
      title,
      body,
      icon: '/assets/icon-192.png',
      badge: '/assets/badge-72.png',
      sound: '/assets/church_bell.mp3',
      tag: PRAYER_CHANNEL_ID,
    },
    fcmOptions: { link: '/' },
  },
  apns: {
    headers: {
      'apns-priority': '10',
      'apns-expiration': '0',
      'apns-collapse-id': PRAYER_CHANNEL_ID,
    },
    payload: {
      aps: {
        alert: { title, body },
        sound: 'church_bell.mp3',
      },
    },
  },
});

/**
 * Non-prayer messages keep the original notification-style payload.
 */
const buildGenericMessage = (token, title, body, dataStrings) => ({
  token,
  notification: { title, body },
  data: dataStrings,
  webpush: {
    headers: { Urgency: 'high' },
    notification: {
      title,
      body,
      icon: '/assets/icon-192.png',
      badge: '/assets/badge-72.png',
      sound: '/assets/church_bell.mp3',
    },
    fcmOptions: { link: '/' },
  },
  android: {
    priority: 'high',
    notification: {
      channelId: PRAYER_CHANNEL_ID,
      sound: 'church_bell',
    },
  },
  apns: {
    payload: {
      aps: {
        sound: 'church_bell.mp3',
      },
    },
  },
});

/**
 * Silent data-only sync message to notify active devices of schedule changes.
 * No visual notification banner is displayed.
 */
const buildSyncMessage = (token, dataStrings) => ({
  token,
  data: dataStrings,
  android: {
    priority: 'high',
    ttl: 300,
  },
  webpush: {
    headers: {
      Urgency: 'high',
      TTL: '300',
    },
  },
  apns: {
    headers: {
      'apns-priority': '5',
      'apns-push-type': 'background',
    },
    payload: {
      aps: {
        'content-available': 1,
      },
    },
  },
});

const toDataStrings = (data = {}) =>
  Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));

const buildMessage = (token, title, body, data = {}) => {
  const dataStrings = toDataStrings(data);
  if (dataStrings.type === 'prayer') {
    return buildPrayerMessage(token, title, body, dataStrings);
  }
  if (
    dataStrings.type === 'schedules_changed' ||
    dataStrings.type === 'sync' ||
    dataStrings.type === 'schedule_update'
  ) {
    return buildSyncMessage(token, dataStrings);
  }
  return buildGenericMessage(token, title, body, dataStrings);
};

/**
 * Send a push notification to a single FCM token.
 */
const sendToToken = async (token, title, body, data = {}) => {
  if (!admin || !admin.apps.length) {
    logger.warn('FCM not initialized — skipping single notification');
    return { success: false, error: 'FCM not initialized' };
  }

  try {
    const response = await admin.messaging().send(buildMessage(token, title, body, data));
    return { success: true, messageId: response };
  } catch (err) {
    logger.error(`FCM sendToToken error: ${err.message}`);
    return { success: false, error: err.message };
  }
};

/**
 * Send push notifications to multiple FCM tokens in batches of 500.
 * Returns aggregated results.
 */
const sendBulk = async (tokens, title, body, data = {}) => {
  if (!tokens || tokens.length === 0) return [];
  if (!admin || !admin.apps.length) {
    logger.warn('FCM not initialized — skipping bulk notification');
    return [];
  }

  const results = [];
  const BATCH_SIZE = 500;

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    const messages = batch.map(token => buildMessage(token, title, body, data));

    try {
      const batchResponse = await admin.messaging().sendEach(messages);
      const batchResult = {
        total: batch.length,
        success: batchResponse.successCount,
        failed: batchResponse.failureCount,
      };
      results.push(batchResult);
      logger.info(
        `FCM batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchResponse.successCount}/${batch.length} delivered`
      );

      // Log and clean up failed tokens
      if (batchResponse.failureCount > 0) {
        const { getDb } = require('../config/firebase');
        const db = getDb();
        batchResponse.responses.forEach(async (resp, idx) => {
          if (!resp.success) {
            const failedToken = batch[idx];
            logger.warn(`FCM token failed (${resp.error?.code}): ${failedToken.slice(0, 20)}...`);
            if (db && resp.error?.code && (
              resp.error.code === 'messaging/registration-token-not-registered' ||
              resp.error.code === 'messaging/invalid-registration-token'
            )) {
              try {
                // Check both field names (spec: 'token', legacy: 'fcm_token')
                let snap = await db.collection('device_tokens').where('token', '==', failedToken).get();
                if (snap.empty) snap = await db.collection('device_tokens').where('fcm_token', '==', failedToken).get();
                snap.forEach(d => d.ref.update({ is_active: false }));
              } catch (cleanErr) {
                logger.warn(`Failed to deactivate stale token: ${cleanErr.message}`);
              }
            }
          }
        });
      }
    } catch (err) {
      logger.error(`FCM batch send error: ${err.message}`);
      results.push({ total: batch.length, success: 0, failed: batch.length, error: err.message });
    }
  }

  return results;
};

module.exports = { sendToToken, sendBulk, buildMessage };
