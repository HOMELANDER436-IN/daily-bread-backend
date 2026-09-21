'use strict';

const { createClient } = require('@supabase/supabase-js');

const url  = process.env.SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase;

if (url && key) {
  supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
} else {
  // Lazy stub — server starts without credentials.
  // Each DB call returns a structured error so the API responds with 503
  // instead of crashing the process. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  // in your .env file to enable the database.
  const notConfigured = () =>
    Promise.resolve({
      data: null,
      error: { message: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env', code: 'NOT_CONFIGURED' },
    });

  const stubChain = () => {
    const handler = {
      get: () => new Proxy(notConfigured, handler),
      apply: () => notConfigured(),
    };
    return new Proxy(notConfigured, handler);
  };

  supabase = new Proxy({}, {
    get: () => stubChain(),
  });

  // Warn on startup so the operator knows what to do
  console.warn(
    '[Daily Bread] WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.\n' +
    '  Copy backend/.env.example to backend/.env and fill in your Supabase credentials.\n' +
    '  The server will start but all database operations will return 503 errors.'
  );
}

module.exports = supabase;
