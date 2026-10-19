# Roblox Trend Radar

A free website that tracks what's trending on Roblox and Steam, compares it with Roblox's audience, and scores game ideas. It runs on GitHub Pages and updates itself every 3 hours with GitHub Actions.

## What updates by itself

- **Roblox:** the most played games, Top Trending and Up-and-Coming lists, genres and maturity ratings (Roblox's public explore and games APIs).
- **Steam:** the 60 most played games with their genres (Steam's charts API).
- **History:** the last 14 days of player counts, used for the 24h and 7-day growth and the sparklines.

## What you update by hand

TikTok/Instagram trends, Roblox's age split and your game ideas have no free API. Edit [`data/manual.json`](data/manual.json) on GitHub (open the file, click the pencil, then "Commit changes"). The site republishes within a few minutes.

## Run it on your computer

```bash
node scripts/update.mjs
node scripts/serve.mjs   # then open http://localhost:4173
```

## Notes

- To refresh now, open the **Actions** tab, pick "Update data and publish" and click **Run workflow**.
- GitHub pauses scheduled workflows after 60 days without activity in a repository. If that happens, the Actions tab shows a button to turn it back on.
- The Roblox explore API is not officially documented and could change. If an update fails, the site keeps the last good numbers and shows a notice.
