require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

async function listChannels() {
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

    console.log('Fetching your chats and channels...\n');
    
    // Get dialogs (chats, channels, groups)
    const dialogs = await client.getDialogs({ limit: 100 });
    
    let channels = [];
    
    for (const dialog of dialogs) {
      const entity = dialog.entity;
      
      // Check if it's a channel or group
      if (entity.className === 'Channel' || entity.className === 'Chat') {
        const name = entity.title || entity.username || 'Unnamed';
        const username = entity.username || 'N/A';
        const isChannel = entity.className === 'Channel';
        const type = isChannel ? 'Channel' : 'Group';
        
        channels.push({
          name,
          username,
          type,
          entity,
          dialog
        });
      }
    }

    console.log(`Found ${channels.length} channels/groups:\n`);
    
    // Show all channels
    for (let i = 0; i < channels.length; i++) {
      const ch = channels[i];
      console.log(`${i+1}. ${ch.name} (@${ch.username}) [${ch.type}]`);
      
      // Try to get recent messages
      try {
        const msgs = await client.getMessages(ch.entity, { limit: 5 });
        let jobCount = 0;
        msgs.forEach(m => {
          if (m.message && /job|hiring|position|vacancy|role|work|apply|recruitment/i.test(m.message)) {
            jobCount++;
          }
        });
        if (jobCount > 0) {
          console.log(`   📌 Job-related posts: ${jobCount}/5 recent messages`);
        }
      } catch (e) {
        // Skip if can't fetch
      }
    }

    console.log('\n✅ Done!');
    console.log('\nTo scrape from these channels, add their usernames to TELEGRAM_TARGETS in .env');
    
    await client.disconnect();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

listChannels();
