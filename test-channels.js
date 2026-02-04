require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

async function test() {
  const client = new TelegramClient(
    new StringSession(process.env.TELEGRAM_SESSION),
    Number(process.env.TELEGRAM_API_ID),
    process.env.TELEGRAM_API_HASH,
    { connectionRetries: 3 }
  );

  try {
    await client.connect();
    console.log('Connected to Telegram\n');

    const targets = ['remotejobs', 'devjobs'];
    
    for (const target of targets) {
      try {
        const entity = await client.getEntity(target);
        const msgs = await client.getMessages(entity, { limit: 10 });
        console.log(`\n📱 Channel: ${target}`);
        console.log(`   Messages: ${msgs.length}`);
        msgs.slice(0, 3).forEach((m, i) => {
          const preview = (m.message || '').substring(0, 40).replace(/\n/g, ' ');
          console.log(`   ${i+1}. ${preview}...`);
        });
      } catch (err) {
        console.log(`\n✗ ${target}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('Connection error:', err.message);
  } finally {
    await client.disconnect();
  }
}

test().catch(console.error);
