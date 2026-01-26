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

async function scrapeOnce({ client, targets, limit, apiUrl, onJob }) {
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
  const pollMs = Number(options.pollMs ?? process.env.TELEGRAM_POLL_MS ?? 60000);
  const runOnce = options.runOnce ?? process.env.TELEGRAM_ONCE === '1';
  const apiUrl = options.apiUrl ?? process.env.JOB_API_URL ?? '';
  const onJob = options.onJob;

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
    }).catch((err) => console.error('Telegram scrape error:', err));
  }, config.pollMs);
}

if (require.main === module) {
  runTelegramScraper().catch((err) => {
    console.error('Fatal Telegram scraper error:', err);
    process.exit(1);
  });
}

module.exports = { runTelegramScraper, extractPhone, extractTitle, normalizeTarget };
