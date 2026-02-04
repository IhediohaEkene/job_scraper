// scraper.js
// Run with: node scraper.js

const DEFAULT_SUBREDDITS = [
  // Remote & Tech
  'forhire',
  'remotejobs',
  'RemoteWork',
  'remotejs',
  'remotework',
  'HiringNow',
  'jobbit',
  
  // General Jobs
  'jobs',
  'JobFair',
  'careerguidance',
  'GetEmployed',
  'entry_level_jobs',
  
  // Part-time & Gig Work
  'WorkOnline',
  'beermoney',
  'slavelabour',
  'sideproject',
  'TaskRabbit',
  'GigWorkers',
  
  // Creative & Design
  'freelancewriters',
  'HiringWriters',
  'DesignJobs',
  'forhire',
  'Illustration',
  
  // Sales & Customer Service
  'sales',
  'SalesJobs',
  'customerservice',
  
  // Manufacturing & Skilled Trades
  'Trades',
  'electricians',
  'Plumbing',
  'HVAC',
  'Carpentry',
  
  // Healthcare
  'nursing',
  'MedicalCareers',
  'Healthcare',
  
  // Finance & Accounting
  'accounting',
  'financecareers',
  'Accounting',
  
  // Education
  'Teachers',
  'TeachersInTransition',
  'education',
  
  // Hospitality & Food Service
  'Hospitality',
  'KitchenConfidential',
  'Bartenders',
  
  // Transportation & Logistics
  'Truckers',
  'Logistics',
  'delivery',
  
  // Military & Government
  'military',
  'Veterans',
  'governmentjobs',
  
  // Seasonal & Temporary
  'TravelJobs',
  'FarmJobs',
  'SeasonalWork',
];

const JOB_STRONG_PATTERNS = [
  /\bwe(?:'re| are) hiring\b/i,
  /\bnow hiring\b/i,
  /\bjob opening\b/i,
  /\bvacanc(?:y|ies)\b/i,
  /\bposition available\b/i,
  /\brole available\b/i,
  /\bapply\b/i,
  /\brequirements?\b/i,
  /\bresponsibilities\b/i,
  /\bqualifications\b/i,
  /\bsalary\b/i,
  /\bcompensation\b/i,
  /\bbenefits?\b/i,
  /\brecruit(?:ing|ment)?\b/i,
  /\blooking for talent\b/i,
  /\bwe are building\b/i,
  /\bjoin (?:our|the) team\b/i,
  /\bwork with us\b/i,
];

const JOB_WEAK_PATTERNS = [
  /\bfull[-\s]?time\b/i,
  /\bpart[-\s]?time\b/i,
  /\bcontract\b/i,
  /\bfreelance\b/i,
  /\bintern(?:ship)?\b/i,
  /\bremote\b/i,
  /\bonsite\b/i,
  /\bhybrid\b/i,
  /\bpay\b/i,
  /\bper hour\b/i,
  /\bhourly\b/i,
  /\bexperience required\b/i,
  /\byears? (?:of|experience)\b/i,
  /\bdeveloper|engineer|designer|manager|analyst\b/i,
  /\btech stack\b/i,
];

const NON_JOB_PATTERNS = [
  /\blooking for (?:work|a job|job opportunities?)\b/i,
  /\bseeking (?:work|a job)\b/i,
  /\bopen to work\b/i,
  /\bhire me\b/i,
  /\bmy resume\b/i,
  /\bmy cv\b/i,
  /\bmy portfolio\b/i,
  /\bi am a\b/i,
  /\bi'm a\b/i,
  /\bfreelance services\b/i,
  /\bpromotion\b/i,
  /\badvert(?:ise|isement)?\b/i,
  /\bfor sale\b/i,
];

function isJobPost(text) {
  if (!text) return false;
  
  // Filter out non-job posts
  if (NON_JOB_PATTERNS.some(pattern => pattern.test(text))) return false;
  
  // Strong patterns = high confidence this is a job post
  const strongMatches = JOB_STRONG_PATTERNS.filter(pattern => pattern.test(text)).length;
  if (strongMatches > 0) return true;
  
  // Weak patterns = need multiple matches to be confident
  const weakMatches = JOB_WEAK_PATTERNS.filter(pattern => pattern.test(text)).length;
  return weakMatches >= 2;
}

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

async function fetchSubreddit(subreddit, { apiUrl, onJob, maxAgeHours }) {
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

      // Check if this looks like a job post
      if (!isJobPost(`${title}\n${body}`)) {
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
  const maxAgeHours = Number(options.maxAgeHours || process.env.REDDIT_MAX_AGE_HOURS || 0);

  console.log('🚀 Starting Reddit scraper…');
  console.log(`📌 Using intelligent pattern matching to detect job posts`);

  for (const sub of subreddits) {
    await fetchSubreddit(sub, { apiUrl, onJob, maxAgeHours });
  }

  console.log('\n✅ Done. Jobs should now be in your database.');
}

if (require.main === module) {
  runScraper().catch((err) => {
    console.error('Scraper failed:', err);
    process.exitCode = 1;
  });
}

module.exports = { runScraper, fetchSubreddit, extractPhone, isJobPost };
