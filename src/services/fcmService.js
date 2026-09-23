'use strict';

const { admin } = require('../config/firebase');
const logger = require('../config/logger');

/**
 * Send a push notification to a single FCM token.
 */
const sendToToken = async (token, title, body, data = {}) => {
  if (!admin || !admin.apps.length) {
    logger.warn('FCM not initialized — skipping single notification');
    return { success: false, error: 'FCM not initialized' };
  }

  try {
    const message = {
      token,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      webpush: {
        headers: { Urgency: 'high' },
        notification: {
          title,
          body,
          icon: '/assets/icon-192.png',
          badge: '/assets/badge-72.png',
          // Note: FCM Web Push does not support custom notification sounds—
          // the browser/OS decides the sound. Custom sounds require a native app.
        },
        fcmOptions: { link: '/' },
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'prayer_channel',
          // 'church_bell' must be bundled in the Android app as res/raw/church_bell.mp3
          sound: 'church_bell',
        },
      },
    };

    const response = await admin.messaging().send(message);
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

  const dataStrings = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  const results = [];
  const BATCH_SIZE = 500;

  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    const messages = batch.map(token => ({
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
        },
        fcmOptions: { link: '/' },
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'prayer_channel',
          sound: 'church_bell',
        },
      },
    }));

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

module.exports = { sendToToken, sendBulk };
