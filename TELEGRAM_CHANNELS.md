# Recommended Telegram Job Channels

Based on your requirements, here are popular Telegram channels for job aggregation:

## Global Job Channels
- **@remotejobs** - Remote job opportunities worldwide
- **@devjobs** - Developer and tech jobs
- **@jobboard** - General job board
- **@hiring_channel** - Hiring announcements
- **@dev_jobs** - Developer positions
- **@python_jobs** - Python developer jobs
- **@nodejs_jobs** - Node.js developer jobs
- **@freelance_jobs** - Freelance opportunities

## Africa & Nigeria Specific
- **@nigeriatech** - Tech jobs in Nigeria
- **@africanjobs** - Jobs across Africa
- **@techHubsAfrica** - African tech hubs hiring
- **@nairobi_tech_jobs** - East Africa tech
- **@capetown_jobs** - South Africa opportunities

## To add more channels:
1. Edit `.env` file
2. Update `TELEGRAM_TARGETS` (comma-separated usernames)
3. Restart the scraper: `pkill -f telegram-scraper && node telegram-scraper.js &`

## Current Configuration
```
TELEGRAM_TARGETS=remotejobs,devjobs,jobboard,hiring_channel,dev_jobs,python_jobs,nodejs_jobs,freelance_jobs,nigeriatech,africanjobs
```

## Note
Some channels may be private or require membership. The scraper will skip channels it cannot access.
