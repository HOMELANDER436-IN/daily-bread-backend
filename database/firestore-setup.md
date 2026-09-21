# Daily Bread — Firestore Database Setup

No SQL schema needed — Firestore is a NoSQL document database.
Collections are created automatically when the first document is written.

---

## Collections Structure

```
firestore/
├── admin_users/
│   └── {auto-id}
│       ├── email: string
│       ├── password_hash: string
│       └── created_at: timestamp
│
├── messages/
│   └── {auto-id}
│       ├── title: string | null
│       ├── content: string
│       ├── reference: string | null
│       ├── image_url: string | null
│       ├── language: 'en' | 'ml'
│       ├── is_published: boolean
│       ├── deleted_at: null | timestamp
│       ├── created_at: timestamp
│       └── updated_at: timestamp
│
│   └── {messageId}/reactions/    ← SUBCOLLECTION
│       └── {device_id}           ← Doc ID = device_id (upsert)
│           ├── reaction: 'like' | 'dislike'
│           ├── device_id: string
│           ├── created_at: timestamp
│           └── updated_at: timestamp
│
├── counselling_requests/
│   └── {auto-id}
│       ├── full_name: string
│       ├── contact_number: string
│       ├── comment: string | null
│       ├── is_viewed: boolean
│       ├── viewed_at: null | timestamp
│       └── created_at: timestamp
│
├── prayer_settings/
│   └── main                      ← Fixed single doc
│       ├── prayer_time: string   (HH:MM 24h, e.g. "21:00")
│       ├── timezone: string      (e.g. "Asia/Kolkata")
│       ├── enabled: boolean
│       └── updated_at: timestamp
│
├── prayer_events/
│   └── {yyyy-mm-dd}              ← Doc ID = date (idempotency key)
│       ├── scheduled_at: timestamp
│       ├── expires_at: timestamp  (scheduled_at + 2 hours)
│       ├── message: string
│       ├── event_date: string
│       └── created_at: timestamp
│
└── device_tokens/
    └── {device_id}               ← Doc ID = device_id (upsert)
        ├── device_id: string
        ├── fcm_token: string
        ├── platform: 'web' | 'android' | 'ios'
        ├── language: 'en' | 'ml'
        ├── is_active: boolean
        ├── created_at: timestamp
        └── updated_at: timestamp
```

---

## Required Firestore Indexes

Firestore will show you a link to create these automatically when the
first query runs. You can also create them manually:

Go to: **Firebase Console → Firestore → Indexes → Composite**

### 1. Messages — published list
| Collection | Field | Order |
|---|---|---|
| messages | is_published | Ascending |
| messages | created_at | Descending |

Filter: `deleted_at == null` (handled in app code with `where('deleted_at', '==', null)`)

### 2. Messages — admin list
| Collection | Field | Order |
|---|---|---|
| messages | deleted_at | Ascending |
| messages | created_at | Descending |

### 3. Counselling — unread filter
| Collection | Field | Order |
|---|---|---|
| counselling_requests | is_viewed | Ascending |
| counselling_requests | created_at | Descending |

### 4. Prayer Events — active window
| Collection | Field | Order |
|---|---|---|
| prayer_events | expires_at | Ascending |

---

## Security Rules

Go to: **Firebase Console → Firestore → Rules**

Paste the following:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Block all public reads/writes by default
    match /{document=**} {
      allow read, write: if false;
    }

    // Only backend (Admin SDK) accesses these — Admin SDK bypasses all rules
    // These rules apply to client SDK access (not your backend)
  }
}
```

> Your Node.js backend uses the **Firebase Admin SDK** which bypasses
> all security rules. Rules are only relevant if you ever add client-side
> Firebase SDK access (not needed for this project).

---

## Initial Data

The admin user is seeded automatically when you start the server with
`ADMIN_EMAIL` and `ADMIN_PASSWORD` set in your `.env`.

The `prayer_settings/main` document is created on first call to the
prayer settings API if it doesn't exist yet.

No manual data entry required.
