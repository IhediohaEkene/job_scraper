require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { runScraper } = require('./reddit-scraper/scraper');
const { runTelegramScraper } = require('./telegram-scraper');

const app = express();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool
  .query('SELECT 1')
  .then(() => {
    console.log('Connected to Postgres');
  })
  .catch((err) => {
    console.error('Postgres connection error:', err);
  });

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static front-end from /public
app.use(express.static(path.join(__dirname, 'public')));

function toIsoDate(value) {
  return value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

async function insertJob({ title, body, subreddit, permalink, url, phone, createdAt }) {
  const result = await pool.query(
    `INSERT INTO jobs (title, body, subreddit, permalink, url, phone, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, title, body, subreddit, permalink, url, phone, created_at`,
    [
      title || '',
      body || '',
      subreddit || '',
      permalink || '',
      url || '',
      phone || null,
      toIsoDate(createdAt),
    ]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    subreddit: row.subreddit,
    permalink: row.permalink,
    url: row.url,
    phone: row.phone,
    createdAt: row.created_at,
  };
}

// Receive a new job from the scraper
app.post('/api/jobs', async (req, res) => {
  try {
    const job = await insertJob({
      title: req.body.title,
      body: req.body.body,
      subreddit: req.body.subreddit,
      permalink: req.body.permalink,
      url: req.body.url,
      phone: req.body.phone,
      createdAt: req.body.createdAt,
    });
    res.json({ success: true, job });
  } catch (err) {
    console.error('Error saving job:', err);
    res.status(500).json({ success: false, error: 'Failed to save job' });
  }
});

// Return all jobs
app.get('/api/jobs', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, title, body, subreddit, permalink, url, phone, created_at
       FROM jobs
       ORDER BY created_at DESC`
    );
    res.json(
      result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        subreddit: row.subreddit,
        permalink: row.permalink,
        url: row.url,
        phone: row.phone,
        createdAt: row.created_at,
      }))
    );
  } catch (err) {
    console.error('Error reading jobs:', err);
    res.status(500).json({ success: false, error: 'Failed to read jobs' });
  }
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(500).json({ status: 'error' });
  }
});

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
  console.log(`Job API running on http://localhost:${PORT}`);
});

const START_REDDIT_SCRAPER = process.env.START_REDDIT_SCRAPER === 'true';
const REDDIT_SCRAPE_INTERVAL_MINUTES = Number(
  process.env.REDDIT_SCRAPE_INTERVAL_MINUTES
) || 30;

if (START_REDDIT_SCRAPER) {
  let isScraping = false;

  const scrapeOnce = async () => {
    if (isScraping) return;
    isScraping = true;
    try {
      await runScraper({
        onJob: async (job) => {
          await insertJob(job);
        },
      });
    } catch (err) {
      console.error('Reddit scraper error:', err);
    } finally {
      isScraping = false;
    }
  };

  scrapeOnce();
  setInterval(scrapeOnce, REDDIT_SCRAPE_INTERVAL_MINUTES * 60 * 1000);
}

const START_TELEGRAM_SCRAPER = process.env.START_TELEGRAM_SCRAPER === 'true';

if (START_TELEGRAM_SCRAPER) {
  runTelegramScraper({
    onJob: async (job) => {
      await insertJob(job);
    },
  }).catch((err) => {
    console.error('Telegram scraper failed:', err);
  });
}
