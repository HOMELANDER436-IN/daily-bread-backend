# Daily Bread — Backend API Server

Production-grade Node.js & Express REST API for the **Daily Bread** Christian applications.

## Architecture

- **Runtime**: Node.js (>= 18.0.0)
- **Framework**: Express 4.x
- **Database**: Google Firebase Firestore
- **Push Notifications**: Firebase Admin SDK (Cloud Messaging)
- **Scheduler**: Server-side Node-Cron (Asia/Kolkata)
- **Security**: CORS, Helmet, Rate Limiting, Input Validation

## Important Notice

The Admin API endpoints (`/api/admin/*`) are intentionally implemented without authentication. They are intended for a privately distributed/unlisted Admin application. No passwords, tokens, or JWTs are required.

## Endpoints

### Public Viewer Endpoints
- `GET /health` — Health check
- `GET /api/messages` — List published messages
- `GET /api/messages/latest` — Get latest published message
- `GET /api/messages/:id/reactions` — Get reaction counts
- `POST /api/messages/:id/reaction` — Submit/toggle like or dislike
- `DELETE /api/messages/:id/reaction` — Remove reaction
- `POST /api/counselling` — Submit confidential counselling request
- `POST /api/devices/register` — Register FCM device token
- `GET /api/prayer/current` — Active 2-hour prayer event info

### Admin Endpoints (Direct Access)
- `GET /api/admin/messages` — List all messages
- `POST /api/admin/messages` — Create message
- `GET /api/admin/messages/:id` — Get single message
- `PUT /api/admin/messages/:id` — Update message
- `DELETE /api/admin/messages/:id` — Delete message
- `PATCH /api/admin/messages/:id/publish` — Toggle published state
- `GET /api/admin/counselling` — List counselling requests
- `GET /api/admin/counselling/counts` — Unread & total counts
- `GET /api/admin/counselling/:id` — Single request details
- `PATCH /api/admin/counselling/:id/viewed` — Mark request viewed
- `GET /api/admin/prayer-settings` — Get prayer settings
- `PUT /api/admin/prayer-settings` — Update prayer settings

## Environment Variables (.env)
```env
NODE_ENV=production
PORT=10000
FIREBASE_PROJECT_ID=manual-4b66a
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
ALLOWED_ORIGINS=*
PRAYER_TIMEZONE=Asia/Kolkata
```
