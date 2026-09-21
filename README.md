# Daily Bread — Backend API Server

Production-grade Node.js & Express REST API for the **Daily Bread** Christian mobile & web applications.

## Features

- 🍞 **Daily Messages**: Retrieve and publish daily verses, messages, and devotionals in English & Malayalam.
- ❤️ **Reactions**: Like and dislike tracking with device-based deduplication.
- 🕊️ **Counselling Requests**: Secure submission and status tracking (Pending, In Review, Resolved) for prayer/counselling requests.
- 🔔 **Prayer Scheduler & FCM Notifications**: Daily scheduled prayer push notifications powered by Firebase Cloud Messaging (FCM) and `node-cron`.
- 🔐 **Admin Authentication**: Secure JWT-based admin authentication with bcrypt password hashing and rate limiting.
- 🗄️ **Firebase Firestore**: Scalable NoSQL cloud database.

## Architecture & Tech Stack

- **Runtime**: Node.js (>= 18.0.0)
- **Framework**: Express 4.x
- **Database**: Google Firebase Firestore
- **Push Notifications**: Firebase Admin SDK (Cloud Messaging)
- **Security**: Helmet, CORS, Express-Rate-Limit, JWT, Bcrypt
- **Scheduler**: Node-Cron

## Deployment to Render

1. Create a **New Web Service** on [Render](https://render.com).
2. Connect this repository.
3. Configure settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Set Environment Variables:
   - `NODE_ENV`: `production`
   - `PORT`: `10000`
   - `JWT_SECRET`: Random 64-char secret
   - `JWT_EXPIRES_IN`: `7d`
   - `ADMIN_EMAIL`: Your admin email
   - `ADMIN_PASSWORD`: Your admin password
   - `FIREBASE_PROJECT_ID`: `manual-4b66a`
   - `FIREBASE_CLIENT_EMAIL`: Service account email
   - `FIREBASE_PRIVATE_KEY`: Service account private key
   - `ALLOWED_ORIGINS`: `*`
5. Health Check: `GET /health`
