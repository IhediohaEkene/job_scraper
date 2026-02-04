require('dotenv').config();

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs/promises');
const path = require('path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

const STATE_PATH = path.join(__dirname, 'telegram_state.json');

async function prompt(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

function normalizeTarget(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/t\.me\/([^/]+)/i);
  return match ? match[1] : trimmed;
}

function extractTitle(message) {
  const firstLine = message.split('\n').find((line) => line.trim());
  return (firstLine || message).slice(0, 120);
}

function extractPhone(message) {
  const match = message.match(/\+?\d[\d\s\-]{7,}/);
  return match ? match[0] : null;
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
];

const NON_JOB_STRONG_PATTERNS = [
  /\blooking for (?:work|a job|job opportunities?)\b/i,
  /\bseeking (?:work|a job)\b/i,
  /\bopen to work\b/i,
  /\bhire me\b/i,
  /\bmy resume\b/i,
  /\bmy cv\b/i,
  /\bmy portfolio\b/i,
];

const NON_JOB_WEAK_PATTERNS = [
  /\bi am a\b/i,
  /\bi'm a\b/i,
  /\bi’m a\b/i,
  /\bavailable for\b/i,
  /\bfreelance services\b/i,
  /\bconsulting\b/i,
  /\bpromotion\b/i,
  /\badvert(?:ise|isement)?\b/i,
  /\bfor sale\b/i,
  /\bwebinar\b/i,
  /\bcourse\b/i,
  /\btraining\b/i,
];

function isLikelyEnglish(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 5) return false;

  const asciiLetters = (text.match(/[A-Za-z]/g) || []).length;
  const nonLatinLetters = (text.match(
    /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u1100-\u11FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g
  ) || []).length;

  if (asciiLetters < 15 && nonLatinLetters > 0) return false;
  if (nonLatinLetters > asciiLetters * 0.5) return false;

  return asciiLetters > 0;
}

function isLikelyJobPost(text) {
  const normalized = text.toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount < 6) return false;

  let score = 0;
  let hasStrongJobSignal = false;

  for (const pattern of JOB_STRONG_PATTERNS) {
    if (pattern.test(normalized)) {
      score += 2;
      hasStrongJobSignal = true;
    }
  }

  for (const pattern of JOB_WEAK_PATTERNS) {
    if (pattern.test(normalized)) {
      score += 1;
    }
  }

  for (const pattern of NON_JOB_STRONG_PATTERNS) {
    if (pattern.test(normalized)) {
      score -= 3;
    }
  }

  for (const pattern of NON_JOB_WEAK_PATTERNS) {
    if (pattern.test(normalized)) {
      score -= 1;
    }
  }

  if (hasStrongJobSignal && score >= 1) return true;
  return score >= 3;
}

function isRecent(dateValue, maxAgeHours) {
  if (!maxAgeHours) return true;
  const timestamp = dateValue ? new Date(dateValue).getTime() : Date.now();
  if (Number.isNaN(timestamp)) return true;
  return Date.now() - timestamp <= maxAgeHours * 60 * 60 * 1000;
}

function buildPermalink(entity, messageId) {
  if (entity?.username) {
    return `https://t.me/${entity.username}/${messageId}`;
  }
  const id = String(entity?.id || '');
  if (id.startsWith('-100')) {
    return `https://t.me/c/${id.slice(4)}/${messageId}`;
  }
  return '';
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveState(state) {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

async function sendJob(payload, { apiUrl, onJob }) {
  if (onJob) {
    await onJob(payload);
    return;
  }

  if (!apiUrl) {
    throw new Error('Missing job API URL');
  }

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Job API error ${res.status}: ${text}`);
  }
}

async function scrapeOnce({ client, targets, limit, apiUrl, onJob, maxAgeHours }) {
  const state = await loadState();

  for (const target of targets) {
    const entity = await client.getEntity(target);
    const lastId = state[entity.id] || 0;
    const messages = await client.getMessages(entity, { limit });

    const fresh = messages.filter((msg) => msg?.id && msg.id > lastId && msg.message);
    fresh.sort((a, b) => a.id - b.id);

    let newestId = lastId;
    for (const msg of fresh) {
      newestId = Math.max(newestId, msg.id);
      const text = msg.message.trim();
      if (!text) continue;
      if (!isRecent(msg.date, maxAgeHours)) continue;
      if (!isLikelyEnglish(text)) continue;
      if (!isLikelyJobPost(text)) continue;

      const permalink = buildPermalink(entity, msg.id);
      const subredditLabel = entity.username || entity.title || String(entity.id);

      await sendJob(
        {
          title: extractTitle(text),
          body: text,
          subreddit: `telegram/${subredditLabel}`,
          permalink,
          url: permalink,
          phone: extractPhone(text),
          createdAt: msg.date ? new Date(msg.date).toISOString() : undefined,
        },
        { apiUrl, onJob }
      );

      console.log(`Sent Telegram job from ${subredditLabel}: ${extractTitle(text)}`);
    }

    if (newestId > lastId) {
      state[entity.id] = newestId;
    }
  }

  await saveState(state);
}

function resolveConfig(options = {}) {
  const apiId = Number(options.apiId ?? process.env.TELEGRAM_API_ID ?? 0);
  const apiHash = options.apiHash ?? process.env.TELEGRAM_API_HASH ?? '';
  const session = options.session ?? process.env.TELEGRAM_SESSION ?? '';
  const targets = (options.targets ?? process.env.TELEGRAM_TARGETS ?? '')
    .split(',')
    .map((target) => normalizeTarget(target))
    .filter(Boolean);
  const limit = Number(options.limit ?? process.env.TELEGRAM_LIMIT ?? 50);
  const pollMs = Number(options.pollMs ?? process.env.TELEGRAM_POLL_MS ?? 1800000);
  const runOnce = options.runOnce ?? process.env.TELEGRAM_ONCE === '1';
  const apiUrl = options.apiUrl ?? process.env.JOB_API_URL ?? '';
  const onJob = options.onJob;
  const maxAgeHours = Number(
    options.maxAgeHours ?? process.env.TELEGRAM_MAX_AGE_HOURS ?? 0
  );

  return {
    apiId,
    apiHash,
    session,
    targets,
    limit,
    pollMs,
    runOnce,
    apiUrl,
    onJob,
    maxAgeHours,
  };
}

function validateConfig(config) {
  if (!config.apiId || !config.apiHash) {
    throw new Error('Missing TELEGRAM_API_ID or TELEGRAM_API_HASH.');
  }

  if (config.targets.length === 0) {
    throw new Error('Missing TELEGRAM_TARGETS (comma-separated usernames or public links).');
  }
}

async function runTelegramScraper(options = {}) {
  const config = resolveConfig(options);
  validateConfig(config);

  const client = new TelegramClient(
    new StringSession(config.session),
    config.apiId,
    config.apiHash,
    { connectionRetries: 5 }
  );

  await client.start({
    phoneNumber: async () =>
      process.env.TELEGRAM_PHONE || (await prompt('Telegram phone number: ')),
    password: async () =>
      process.env.TELEGRAM_PASSWORD || (await prompt('Telegram 2FA password (if any): ')),
    phoneCode: async () => process.env.TELEGRAM_CODE || (await prompt('Telegram code: ')),
    onError: (err) => console.error('Telegram login error:', err),
  });

  if (!config.session) {
    console.log('Save this TELEGRAM_SESSION for future runs:');
    console.log(client.session.save());
  }

  console.log(`Watching Telegram targets: ${config.targets.join(', ')}`);

  await scrapeOnce({
    client,
    targets: config.targets,
    limit: config.limit,
    apiUrl: config.apiUrl,
    onJob: config.onJob,
    maxAgeHours: config.maxAgeHours,
  });
  if (config.runOnce) {
    await client.disconnect();
    return;
  }

  setInterval(() => {
    scrapeOnce({
      client,
      targets: config.targets,
      limit: config.limit,
      apiUrl: config.apiUrl,
      onJob: config.onJob,
      maxAgeHours: config.maxAgeHours,
    }).catch((err) => console.error('Telegram scrape error:', err));
  }, config.pollMs);
}

if (require.main === module) {
  runTelegramScraper().catch((err) => {
    console.error('Fatal Telegram scraper error:', err);
    process.exit(1);
  });
}

module.exports = {
  runTelegramScraper,
  extractPhone,
  extractTitle,
  normalizeTarget,
  isLikelyEnglish,
  isLikelyJobPost,
};
