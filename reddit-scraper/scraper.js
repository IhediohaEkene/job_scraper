// scraper.js
// Run with: node scraper.js

const DEFAULT_SUBREDDITS = [
  'forhire',
  'remotejobs',
  'RemoteWork',
  'remotejs',
  'remotework',
  // 'NigeriaJobs',   // banned → 404
  // 'JobOpenings',   // private → 403
];

function extractPhone(text) {
  if (!text) return null;
  const match = text.match(/\+?\d[\d\s\-]{7,}/);
  return match ? match[0] : null;
}

async function postToApi(job, apiUrl) {
  const apiRes = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job),
  });

  if (!apiRes.ok) {
    const text = await apiRes.text();
    throw new Error(`API responded ${apiRes.status}: ${text}`);
  }
}

function buildKeywordMatcher(keywords) {
  const trimmed = keywords.map((word) => word.trim()).filter(Boolean);
  if (trimmed.length === 0) return null;
  const escaped = trimmed.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
}

function isRecent(createdAt, maxAgeHours) {
  if (!createdAt || !maxAgeHours) return true;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs <= maxAgeHours * 60 * 60 * 1000;
}

async function fetchSubreddit(subreddit, { apiUrl, onJob, keywordMatcher, maxAgeHours }) {
  const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=25`;
  console.log(`\n📥 Fetching ${url}`);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'job-api-reddit-scraper/1.0',
      },
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(
        `Failed to fetch r/${subreddit}: ${res.status} ${errText}`
      );
      return;
    }

    const data = await res.json();
    const posts = data.data?.children || [];
    console.log(`Found ${posts.length} posts in r/${subreddit}`);

    for (const item of posts) {
      const p = item.data;
      if (!p) continue;

      const title = p.title || '';
      const body = p.selftext || '';
      const subredditName = p.subreddit || subreddit;
      const permalink = `https://www.reddit.com${p.permalink}`;
      const urlOverridden = p.url_overridden_by_dest || permalink;
      const phone = extractPhone(title + '\n' + body);
      const createdAt = p.created_utc
        ? new Date(p.created_utc * 1000).toISOString()
        : new Date().toISOString();

      const job = {
        title,
        body,
        subreddit: subredditName,
        permalink,
        url: urlOverridden,
        phone,
        createdAt,
      };

      if (keywordMatcher && !keywordMatcher.test(`${title}\n${body}`)) {
        continue;
      }

      if (!isRecent(createdAt, maxAgeHours)) {
        continue;
      }

      // Log in terminal
      console.log(`Saved job: ${title}`);

      try {
        if (onJob) {
          await onJob(job);
        } else if (apiUrl) {
          await postToApi(job, apiUrl);
        } else {
          console.warn('No onJob handler or apiUrl configured; skipping job');
        }
      } catch (err) {
        console.error('❌ Error saving job:', err.message);
      }
    }
  } catch (err) {
    console.error(`Error fetching r/${subreddit}:`, err.message);
  }
}

async function runScraper(options = {}) {
  const subreddits = options.subreddits || DEFAULT_SUBREDDITS;
  const apiUrl = options.apiUrl || process.env.JOB_API_URL || '';
  const onJob = options.onJob;
  const keywordsRaw = options.keywords || process.env.REDDIT_KEYWORDS || 'hiring,job,opening';
  const maxAgeHours = Number(options.maxAgeHours || process.env.REDDIT_MAX_AGE_HOURS || 0);
  const keywordMatcher = buildKeywordMatcher(
    Array.isArray(keywordsRaw) ? keywordsRaw : keywordsRaw.split(',')
  );

  console.log('🚀 Starting Reddit scraper…');

  for (const sub of subreddits) {
    await fetchSubreddit(sub, { apiUrl, onJob, keywordMatcher, maxAgeHours });
  }

  console.log('\n✅ Done. Jobs should now be in your database.');
}

if (require.main === module) {
  runScraper().catch((err) => {
    console.error('Scraper failed:', err);
    process.exitCode = 1;
  });
}

module.exports = { runScraper, fetchSubreddit, extractPhone };
