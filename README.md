# ChatFight Telegram Bot

This starter project adds a Telegram group bot with:

- a /rankings command that shows the top 10 users for the current group
- message counting per user
- MongoDB-backed persistence so data survives redeploys

## Requirements

- Node.js 18+
- MongoDB running locally or remotely
- A Telegram bot token from BotFather

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the example environment file and fill in your values:
   ```bash
   cp .env.example .env
   ```
3. Start the bot:
   ```bash
   npm start
   ```

## Environment variables

- TELEGRAM_BOT_TOKEN: your Telegram bot token
- MONGODB_URI: MongoDB connection string (required for deploy persistence)
- MONGODB_DB_NAME: database name to use

## Persistent storage

This bot stores rankings in MongoDB. For deploys, use a remote or managed MongoDB instance so data is preserved across restarts and redeploys. A local MongoDB instance on `127.0.0.1` is only suitable for development.

## Current behavior

- Every non-command message in a group increments that user's count.
- /rankings shows the top 10 users for the current group.
- /profile shows the calling user’s total, daily, weekly, and overall rank.
- /topuser shows the top 10 global users across all groups the bot has seen.
- /topgroups shows the top 10 groups by activity.
- These views include inline buttons for Today, Total, and Weekly modes.

## Next steps

- add more commands such as /stats, /me, and /leaderboard
- add richer analytics like weekly/monthly rankings
- add admin-only features and anti-spam protections
