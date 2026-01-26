import { Devvit } from '@devvit/public-api';

Devvit.addTrigger({
  event: "PostSubmit",
  async onEvent(event, context) {
    const targetSubreddit =
      (await context.settings.get('target_subreddit'))?.toString() || 'forhire';

    if (context.subredditName !== targetSubreddit) return;

    const post = event.post;

    const title = post?.title ?? "";
    const body = post?.selftext ?? "";
    const subreddit = context.subredditName;
    const permalink = `https://reddit.com${post?.permalink}`;
    const url = permalink;

    // Attempt to extract phone numbers
    const phoneMatch = body.match(/\+?\d[\d\s\-]{7,}/);
    const phone = phoneMatch ? phoneMatch[0] : null;

    const apiUrl =
      (await context.settings.get('job_api_url'))?.toString() ||
      'http://localhost:5000/api/jobs';

    // Send scraped data to your API
    try {
      await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          subreddit,
          permalink,
          url,
          phone,
        }),
      });

      console.log(`Job sent to API: ${title}`);
    } catch (err) {
      console.error("Failed to send job to local API:", err);
    }
  },
});

export default Devvit;
