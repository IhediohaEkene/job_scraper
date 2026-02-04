require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

async function explore() {
  const client = new TelegramClient(
    new StringSession(process.env.TELEGRAM_SESSION),
    Number(process.env.TELEGRAM_API_ID),
    process.env.TELEGRAM_API_HASH,
    { connectionRetries: 5 }
  );

  try {
    console.log('Connecting to Telegram...');
    await client.connect();
    console.log('✓ Connected\n');

    // Check current channels
    const channels = ['remotejobs', 'devjobs', 'RemoteJobs', 'JobsBoard', 'remote_jobs_hub', 'jobzz', 'hiring_board'];
    
    for (const ch of channels) {
      try {
        const entity = await client.getEntity(ch);
        const msgs = await client.getMessages(entity, { limit: 20 });
        
        console.log(`\n📱 ${ch} (${entity.title || entity.username})`);
        console.log(`   Members: ${entity.participants_count || 'N/A'}`);
        console.log(`   Messages fetched: ${msgs.length}`);
        
        let jobCount = 0;
        msgs.slice(0, 5).forEach((m, i) => {
          const text = (m.message || '').substring(0, 50).replace(/\n/g, ' ');
          const hasJob = /job|hiring|position|vacancy|role|apply/i.test(m.message || '');
          if (hasJob) jobCount++;
          console.log(`   ${i+1}. ${text}${hasJob ? ' ✓' : ''}`);
        });
        console.log(`   Job posts in sample: ${jobCount}/5`);
      } catch (err) {
        console.log(`✗ ${ch}: ${err.message}`);
      }
    }

    await client.disconnect();
  } catch (err) {
    console.error('Fatal error:', err.message);
  }
}

explore();
