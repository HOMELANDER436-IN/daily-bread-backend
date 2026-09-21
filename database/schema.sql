-- ============================================================
-- Daily Bread — Supabase PostgreSQL Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Admin Users ──────────────────────────────────────────────────────────────
-- Single admin user. Created via backend seed (ADMIN_EMAIL / ADMIN_PASSWORD env vars).
-- No public registration path.
CREATE TABLE IF NOT EXISTS admin_users (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email        VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Messages ─────────────────────────────────────────────────────────────────
-- Biblical messages / devotionals posted by the administrator.
-- Soft-deleted via deleted_at (never permanently removed by default).
CREATE TABLE IF NOT EXISTS messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        VARCHAR(200),
  content      TEXT NOT NULL,
  reference    VARCHAR(200),
  image_url    TEXT,
  language     VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ml')),
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at   TIMESTAMPTZ DEFAULT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Message Reactions ────────────────────────────────────────────────────────
-- One reaction per device per message. UNIQUE constraint enforced at DB level.
CREATE TABLE IF NOT EXISTS message_reactions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  device_id  VARCHAR(255) NOT NULL,
  reaction   VARCHAR(10) NOT NULL CHECK (reaction IN ('like', 'dislike')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, device_id)
);

-- ─── Counselling Requests ─────────────────────────────────────────────────────
-- Submitted by viewers. Private — never exposed through public API.
CREATE TABLE IF NOT EXISTS counselling_requests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name      VARCHAR(100) NOT NULL,
  contact_number VARCHAR(20) NOT NULL,
  comment        TEXT,
  is_viewed      BOOLEAN NOT NULL DEFAULT FALSE,
  viewed_at      TIMESTAMPTZ DEFAULT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Prayer Settings ──────────────────────────────────────────────────────────
-- Single-row configuration for the daily prayer notification.
CREATE TABLE IF NOT EXISTS prayer_settings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prayer_time VARCHAR(5) NOT NULL DEFAULT '21:00',  -- HH:MM (24-hour)
  timezone    VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Prayer Events ────────────────────────────────────────────────────────────
-- One record per calendar day when notifications are sent.
-- event_date UNIQUE constraint prevents duplicate sends.
CREATE TABLE IF NOT EXISTS prayer_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scheduled_at TIMESTAMPTZ NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,  -- scheduled_at + 2 hours
  message      TEXT,
  event_date   DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_date)
);

-- ─── Device Tokens ────────────────────────────────────────────────────────────
-- FCM device/browser tokens for push notification delivery.
CREATE TABLE IF NOT EXISTS device_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id  VARCHAR(255) NOT NULL UNIQUE,
  fcm_token  TEXT NOT NULL,
  platform   VARCHAR(10) NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'android', 'ios')),
  language   VARCHAR(5) NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ml')),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
-- Messages: fast retrieval of latest published
CREATE INDEX IF NOT EXISTS idx_messages_published_created
  ON messages (is_published, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_created_at
  ON messages (created_at DESC);

-- Counselling: filter by viewed status
CREATE INDEX IF NOT EXISTS idx_counselling_is_viewed
  ON counselling_requests (is_viewed);

CREATE INDEX IF NOT EXISTS idx_counselling_created_at
  ON counselling_requests (created_at DESC);

-- Reactions: fast lookup per message + per device
CREATE INDEX IF NOT EXISTS idx_reactions_message_id
  ON message_reactions (message_id);

CREATE INDEX IF NOT EXISTS idx_reactions_device_id
  ON message_reactions (device_id);

-- Device tokens: active tokens for bulk FCM sends
CREATE INDEX IF NOT EXISTS idx_device_tokens_active
  ON device_tokens (is_active)
  WHERE is_active = TRUE;

-- Prayer events: date lookup + expiry check
CREATE INDEX IF NOT EXISTS idx_prayer_events_date
  ON prayer_events (event_date);

CREATE INDEX IF NOT EXISTS idx_prayer_events_expires
  ON prayer_events (expires_at);

-- ─── Default Data ─────────────────────────────────────────────────────────────
-- Insert default prayer settings (only if none exist)
INSERT INTO prayer_settings (prayer_time, timezone, enabled)
SELECT '21:00', 'Asia/Kolkata', FALSE
WHERE NOT EXISTS (SELECT 1 FROM prayer_settings LIMIT 1);
