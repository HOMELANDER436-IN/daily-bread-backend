'use strict';

/**
 * Prayer delivery tests (in-memory Firestore fake, mocked FCM transport).
 * These verify the BACKEND behaviour only. They do not test a real phone.
 */

jest.mock('../config/firebase', () => {
  const admin = require('firebase-admin');
  return { admin, getDb: jest.fn(), initializeFirebase: jest.fn() };
});
jest.mock('../services/fcmService', () => ({ sendBulk: jest.fn().mockResolvedValue([]) }));

const admin = require('firebase-admin');
const { getDb } = require('../config/firebase');
const { sendBulk } = require('../services/fcmService');
const scheduler = require('../services/prayerScheduler');
const { buildMessage } = jest.requireActual('../services/fcmService');

const { checkAndSendPrayerNotification, _internals } = scheduler;
const TS = admin.firestore.Timestamp;

// ─── Minimal in-memory Firestore ────────────────────────────────────────────
function makeDb(seed = {}) {
  const store = {};
  Object.entries(seed).forEach(([col, docs]) => { store[col] = { ...docs }; });
  const ensure = (c) => (store[c] = store[c] || {});

  const docRef = (col, id) => ({
    id,
    async get() {
      const data = ensure(col)[id];
      return { exists: data !== undefined, id, data: () => data, ref: docRef(col, id) };
    },
    async create(data) {
      if (ensure(col)[id] !== undefined) {
        const e = new Error('6 ALREADY_EXISTS: Document already exists'); e.code = 6; throw e;
      }
      ensure(col)[id] = data;
    },
    async update(data) { ensure(col)[id] = { ...ensure(col)[id], ...data }; },
    async set(data) { ensure(col)[id] = data; },
  });

  return {
    _store: store,
    collection(col) {
      return {
        doc: (id) => docRef(col, id),
        where(field, _op, value) {
          return {
            async get() {
              const docs = Object.entries(ensure(col))
                .filter(([, d]) => d[field] === value)
                .map(([id, d]) => ({ id, data: () => d, ref: docRef(col, id) }));
              return { empty: docs.length === 0, docs, forEach: (fn) => docs.forEach(fn) };
            },
          };
        },
      };
    },
    doc(path) { const [col, id] = path.split('/'); return docRef(col, id); },
  };
}

// 2026-10-04 21:00 IST == 15:30Z
const at = (iso) => jest.setSystemTime(new Date(iso));
const IST_2100 = '2026-10-04T15:30:00Z';
const IST_2101 = '2026-10-04T15:31:10Z';
const IST_2103 = '2026-10-04T15:33:05Z';
const BEFORE = TS.fromDate(new Date('2026-10-01T00:00:00Z'));

const sched = (over = {}) => ({
  type: 'daily', time: '21:00', daysOfWeek: [0,1,2,3,4,5,6], date: null,
  enabled: true, completed: false, createdAt: BEFORE, updatedAt: BEFORE, ...over,
});
const tokens = (n = 1) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [`d${i}`, { token: `tok${i}`, is_active: true, language: 'en' }]));

beforeEach(() => {
  jest.useFakeTimers();
  sendBulk.mockClear();
});
afterEach(() => jest.useRealTimers());

const run = async (db) => { getDb.mockReturnValue(db); await checkAndSendPrayerNotification(); };
const sentEventIds = () => sendBulk.mock.calls.map(c => c[3].event_id);

describe('Asia/Kolkata time', () => {
  test('midnight is 00:xx, never 24:xx, and date rolls in IST', () => {
    const r = _internals.getKolkataNow(new Date('2026-10-04T18:30:00Z'));
    expect(r.hhmm).toBe('00:00');
    expect(r.dateStr).toBe('2026-10-05');
    expect(_internals.getKolkataNow(new Date('2026-10-04T19:25:00Z')).hhmm).toBe('00:55');
  });
  test('21:00 IST', () => {
    expect(_internals.getKolkataNow(new Date(IST_2100)).hhmm).toBe('21:00');
  });
});

describe('Normal delivery + duplicate prevention', () => {
  test('daily schedule fires exactly once at its minute', async () => {
    const db = makeDb({ prayer_schedules: { s1: sched() }, device_tokens: tokens() });
    at(IST_2100);
    await run(db);
    expect(sendBulk).toHaveBeenCalledTimes(1);
    expect(sentEventIds()).toEqual(['s1_2026-10-04']);
    const data = sendBulk.mock.calls[0][3];
    expect(data.type).toBe('prayer');
    expect(data.schedule_id).toBe('s1');
    expect(sendBulk.mock.calls[0][1]).toBe('Daily Bread');
    expect(sendBulk.mock.calls[0][2]).toBe('It is prayer time. Take a moment to pray.');
  });

  test('repeat ticks (same minute, next minute, restart) never send again', async () => {
    const db = makeDb({ prayer_schedules: { s1: sched() }, device_tokens: tokens() });
    at(IST_2100); await run(db);
    at(IST_2100); await run(db);          // duplicate cron / retry
    at(IST_2101); await run(db);          // late tick inside grace after a "restart"
    expect(sendBulk).toHaveBeenCalledTimes(1);
  });

  test('two backend instances racing: exactly one wins the claim', async () => {
    const db = makeDb();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() =>
      _internals.claimOccurrence(db, 's1_2026-10-04', { x: 1 })));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test('same FCM token stored on two device docs receives ONE message', async () => {
    const db = makeDb({
      prayer_schedules: { s1: sched() },
      device_tokens: {
        a: { token: 'same', is_active: true, language: 'en' },
        b: { fcm_token: 'same', is_active: true, language: 'en' },
      },
    });
    at(IST_2100); await run(db);
    expect(sendBulk.mock.calls[0][0]).toEqual(['same']);
  });
});

describe('Expired events are never resurrected', () => {
  test('tick later than the grace window does not fire', async () => {
    const db = makeDb({ prayer_schedules: { s1: sched() }, device_tokens: tokens() });
    at(IST_2103); await run(db);          // 3 min late
    expect(sendBulk).not.toHaveBeenCalled();
    at('2026-10-04T17:30:00Z'); await run(db); // 23:00, hours later
    expect(sendBulk).not.toHaveBeenCalled();
  });

  test('late tick inside grace fires once if schedule predates target', async () => {
    const db = makeDb({ prayer_schedules: { s1: sched() }, device_tokens: tokens() });
    at(IST_2101); await run(db);
    expect(sendBulk).toHaveBeenCalledTimes(1);
  });

  test('schedule created AFTER its time passed does not fire immediately', async () => {
    const created = TS.fromDate(new Date('2026-10-04T15:30:30Z')); // 21:00:30 IST
    const db = makeDb({ prayer_schedules: { s1: sched({ createdAt: created, updatedAt: created }) }, device_tokens: tokens() });
    at(IST_2101); await run(db);
    expect(sendBulk).not.toHaveBeenCalled();
  });
});

describe('Schedule types / update / disable', () => {
  test('disabled schedule never fires', async () => {
    const db = makeDb({ prayer_schedules: { s1: sched({ enabled: false }) }, device_tokens: tokens() });
    at(IST_2100); await run(db);
    expect(sendBulk).not.toHaveBeenCalled();
  });

  test('weekly fires only on selected days (2026-10-04 is a Sunday = 0)', async () => {
    const mon = makeDb({ prayer_schedules: { s1: sched({ type: 'weekly', daysOfWeek: [1, 5] }) }, device_tokens: tokens() });
    at(IST_2100); await run(mon);
    expect(sendBulk).not.toHaveBeenCalled();
    const sun = makeDb({ prayer_schedules: { s2: sched({ type: 'weekly', daysOfWeek: [0] }) }, device_tokens: tokens() });
    await run(sun);
    expect(sendBulk).toHaveBeenCalledTimes(1);
  });

  test('once fires on its date, is marked completed/disabled, never again', async () => {
    const db = makeDb({ prayer_schedules: { o1: sched({ type: 'once', date: '2026-10-04' }) }, device_tokens: tokens() });
    at(IST_2100); await run(db);
    expect(sendBulk).toHaveBeenCalledTimes(1);
    expect(db._store.prayer_schedules.o1.completed).toBe(true);
    expect(db._store.prayer_schedules.o1.enabled).toBe(false);
    at(IST_2101); await run(db);
    expect(sendBulk).toHaveBeenCalledTimes(1);
  });

  test('once on another date does not fire', async () => {
    const db = makeDb({ prayer_schedules: { o1: sched({ type: 'once', date: '2026-10-05' }) }, device_tokens: tokens() });
    at(IST_2100); await run(db);
    expect(sendBulk).not.toHaveBeenCalled();
  });

  test('multiple schedules fire independently, one message each', async () => {
    const db = makeDb({
      prayer_schedules: { a: sched({ time: '21:00' }), b: sched({ time: '21:00' }), c: sched({ time: '07:00' }) },
      device_tokens: tokens(),
    });
    at(IST_2100); await run(db);
    expect(sentEventIds().sort()).toEqual(['a_2026-10-04', 'b_2026-10-04']);
  });

  test('re-timed on the same day (09:00 -> 09:30) fires the new time, not the old one twice', async () => {
    const db = makeDb({ prayer_schedules: { s1: sched({ time: '09:00' }) }, device_tokens: tokens() });
    at('2026-10-04T03:30:00Z'); await run(db);                        // 09:00 IST
    expect(sentEventIds()).toEqual(['s1_2026-10-04']);

    const edited = TS.fromDate(new Date('2026-10-04T03:31:00Z'));
    db._store.prayer_schedules.s1 = sched({ time: '09:30', updatedAt: edited, createdAt: BEFORE });
    at('2026-10-04T04:00:00Z'); await run(db);                        // 09:30 IST
    expect(sentEventIds()).toEqual(['s1_2026-10-04', 's1_2026-10-04_0930']);
    at('2026-10-04T04:01:00Z'); await run(db);
    expect(sendBulk).toHaveBeenCalledTimes(2);
  });

  test('midnight 00:55 schedule fires (no 24:55 bug)', async () => {
    const db = makeDb({ prayer_schedules: { m: sched({ time: '00:55' }) }, device_tokens: tokens() });
    at('2026-10-04T19:25:00Z'); await run(db);
    expect(sentEventIds()).toEqual(['m_2026-10-05']);
  });

  test('legacy single schedule uses id current_<date> and respects old date-keyed event', async () => {
    const legacy = { enabled: true, prayer_time: '21:00', updatedAt: BEFORE };
    const db = makeDb({ prayer_settings: { current: legacy }, device_tokens: tokens() });
    at(IST_2100); await run(db);
    expect(sentEventIds()).toEqual(['current_2026-10-04']);

    const db2 = makeDb({
      prayer_settings: { current: legacy }, device_tokens: tokens(),
      prayer_events: { '2026-10-04': { scheduled_time: '21:00' } },
    });
    await run(db2);
    expect(sendBulk).toHaveBeenCalledTimes(1); // db2 added nothing
  });
});

describe('FCM message lifespan (prayer)', () => {
  const msg = buildMessage('tok', 'Daily Bread', 'It is prayer time. Take a moment to pray.', {
    type: 'prayer', event_id: 's1_2026-10-04', schedule_id: 's1',
  });
  test('Android: TTL 0, high priority, church_bell sound and daily_bread_prayer channel', () => {
    expect(msg.android.ttl).toBe(0);
    expect(msg.android.priority).toBe('high');
    expect(msg.notification.title).toBe('Daily Bread');
    expect(msg.notification.body).toBe('It is prayer time. Take a moment to pray.');
    expect(msg.android.notification.channelId).toBe('daily_bread_prayer');
    expect(msg.android.notification.sound).toBe('church_bell');
    expect(msg.data.type).toBe('prayer');
  });
  test('Web Push and APNs also expire immediately', () => {
    expect(msg.webpush.headers.TTL).toBe('0');
    expect(msg.apns.headers['apns-expiration']).toBe('0');
  });
  test('admin SDK accepts ttl:0 (validated by real SDK validator)', () => {
    const internal = require('../../node_modules/firebase-admin/lib/messaging/messaging-internal');
    const copy = JSON.parse(JSON.stringify(msg));
    expect(() => internal.validateMessage(copy)).not.toThrow();
    expect(copy.android.ttl).toBe('0s');
  });
});

describe('FCM schedule synchronization broadcast (silent)', () => {
  const syncMsg = buildMessage('tok', '', '', { type: 'schedules_changed' });
  test('silent data-only message (no notification banner)', () => {
    expect(syncMsg.notification).toBeUndefined();
    expect(syncMsg.android.notification).toBeUndefined();
    expect(syncMsg.data.type).toBe('schedules_changed');
    expect(syncMsg.android.priority).toBe('high');
  });
});

