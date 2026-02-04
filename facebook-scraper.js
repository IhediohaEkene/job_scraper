require('dotenv').config();

const FACEBOOK_ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;
const PAGE_IDS = (process.env.FACEBOOK_PAGE_IDS || '').split(',').map(id => id.trim()).filter(Boolean);

if (!FACEBOOK_ACCESS_TOKEN) {
  console.error('❌ Missing FACEBOOK_ACCESS_TOKEN in .env');
  process.exit(1);
}

if (PAGE_IDS.length === 0) {
  console.error('❌ Missing FACEBOOK_PAGE_IDS in .env');
  process.exit(1);
}

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
];

const JOB_WEAK_PATTERNS = [
  /\brecruit/i,
  /\bhire/i,
  /\bcareer/i,
  /\bopportunity/i,
];

function extractPhone(text) {
  if (!text) return null;
  const match = text.match(/\+?\d[\d\s\-()]{7,}/);
  return match ? match[0] : null;
}

function extractTitle(message) {
  const firstLine = message.split('\n').find(line => line.trim());
  return (firstLine || message).slice(0, 120);
}

function isJobPost(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  
  const strongMatch = JOB_STRONG_PATTERNS.some(pattern => pattern.test(text));
  if (strongMatch) return true;
  
  const weakMatches = JOB_WEAK_PATTERNS.filter(pattern => pattern.test(text)).length;
  return weakMatches >= 2;
}

async function fetchPagePosts(pageId, accessToken) {
  const url = `https://graph.facebook.com/v18.0/${pageId}/posts?fields=id,message,created_time,link,type,permalink_url&limit=25&access_token=${accessToken}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Facebook API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error(`❌ Error fetching posts from page ${pageId}:`, error.message);
    return [];
  }
}

async function postToApi(job, apiUrl) {
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API responded ${response.status}: ${text}`);
    }
    
    return true;
  } catch (error) {
    console.error(`❌ API Error:`, error.message);
    return false;
  }
}

async function runFacebookScraper(apiUrl = 'http://localhost:3000/api/jobs') {
  console.log('\n🔵 Starting Facebook Jobs Scraper');
  console.log(`📄 Monitoring ${PAGE_IDS.length} page(s):\n`);
  
  let totalPosted = 0;

  for (const pageId of PAGE_IDS) {
    console.log(`\n📥 Fetching posts from page: ${pageId}`);
    
    const posts = await fetchPagePosts(pageId, FACEBOOK_ACCESS_TOKEN);
    console.log(`   Found ${posts.length} posts`);

    for (const post of posts) {
      const message = post.message || '';
      
      if (!isJobPost(message)) continue;

      const job = {
        title: extractTitle(message),
        body: message,
        source: 'facebook',
        source_id: pageId,
        url: post.permalink_url || `https://facebook.com/${post.id}`,
        phone: extractPhone(message),
        createdAt: post.created_time,
      };

      console.log(`   📤 Posting: "${job.title}"`);
      
      const success = await postToApi(job, apiUrl);
      if (success) {
        totalPosted++;
      }
    }
  }

  console.log(`\n✅ Scraping complete. Posted ${totalPosted} jobs.\n`);
  return totalPosted;
}

if (require.main === module) {
  const apiUrl = process.env.API_URL || 'http://localhost:3000/api/jobs';
  runFacebookScraper(apiUrl).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runFacebookScraper };
