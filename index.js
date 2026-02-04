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

// Clean up jobs older than 7 days
async function cleanupOldJobs() {
  try {
    const result = await pool.query(
      `DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '7 days'`
    );
    console.log(`🧹 Cleaned up ${result.rowCount} jobs older than 7 days`);
  } catch (err) {
    console.error('Error cleaning up old jobs:', err);
  }
}

async function insertJob({ title, body, subreddit, permalink, url, phone, createdAt, source, source_id }) {
  const result = await pool.query(
    `INSERT INTO jobs (title, body, subreddit, permalink, url, phone, created_at, source, source_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, title, body, subreddit, permalink, url, phone, created_at, source, source_id`,
    [
      title || '',
      body || '',
      subreddit || '',
      permalink || '',
      url || '',
      phone || null,
      toIsoDate(createdAt),
      source || 'reddit',
      source_id || null,
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
    source: row.source,
    source_id: row.source_id,
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
      source: req.body.source,
      source_id: req.body.source_id,
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

if (START_REDDIT_SCRAPER) {
  let isScraping = false;

  const scrapeOnce = async () => {
    if (isScraping) return;
    isScraping = true;
    try {
      console.log('\n📅 Starting scrape cycle...');
      await cleanupOldJobs();
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

  console.log('🚀 Reddit scraper enabled - running every hour');
  scrapeOnce();
  setInterval(scrapeOnce, 60 * 60 * 1000); // 1 hour = 3600000 ms
}

const START_TELEGRAM_SCRAPER = process.env.START_TELEGRAM_SCRAPER === 'true';

if (START_TELEGRAM_SCRAPER) {
  let isScrapingTelegram = false;

  const telegramScrapeOnce = async () => {
    if (isScrapingTelegram) return;
    isScrapingTelegram = true;
    try {
      console.log('\n📅 Starting Telegram scrape cycle...');
      await cleanupOldJobs();
      await runTelegramScraper({
        onJob: async (job) => {
          await insertJob(job);
        },
      });
    } catch (err) {
      console.error('Telegram scraper error:', err);
    } finally {
      isScrapingTelegram = false;
    }
  };

  console.log('🚀 Telegram scraper enabled - running every hour');
  telegramScrapeOnce();
  setInterval(telegramScrapeOnce, 60 * 60 * 1000); // 1 hour
}

// Facebook Scraper (if enabled)
const START_FACEBOOK_SCRAPER = process.env.START_FACEBOOK_SCRAPER === 'true';

if (START_FACEBOOK_SCRAPER) {
  const { runFacebookScraper } = require('./facebook-scraper');
  let isScrapingFacebook = false;

  const facebookScrapeOnce = async () => {
    if (isScrapingFacebook) return;
    isScrapingFacebook = true;
    try {
      console.log('\n📅 Starting Facebook scrape cycle...');
      await cleanupOldJobs();
      await runFacebookScraper('http://localhost:3000/api/jobs');
    } catch (err) {
      console.error('Facebook scraper error:', err);
    } finally {
      isScrapingFacebook = false;
    }
  };

  console.log('🚀 Facebook scraper enabled - running every hour');
  facebookScrapeOnce();
  setInterval(facebookScrapeOnce, 60 * 60 * 1000); // 1 hour
}
