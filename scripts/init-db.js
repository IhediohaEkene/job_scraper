require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      subreddit TEXT NOT NULL,
      permalink TEXT NOT NULL,
      url TEXT NOT NULL,
      phone TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

init()
  .then(() => {
    console.log('Database initialized');
  })
  .catch((err) => {
    console.error('Database init failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
