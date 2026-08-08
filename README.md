# ChatFight Telegram Bot

This starter project adds a Telegram group bot with:

- a /rankings command that shows the top 10 users for the current group
- an hourly mini-game that sends a word image into each registered group
- message counting per user
- MongoDB-backed persistence so data survives redeploys
- Rule 5 anti-spam protection for rapid message bursts
- A `/healthz` endpoint for Render and uptime monitors

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

- Every non-command message from a real Telegram user in a group increments that user's count. Messages sent by Telegram bots are ignored.
- After 5 consecutive messages with less than 3 seconds between each message, the user is blocked from this bot for 20 minutes in that group. The group itself is not muted.
- While blocked, the user's messages do not increase rankings and all bot commands are disabled. The block expires automatically after 20 minutes, including after a restart.
- Rule 5 block notices are shown in the group where the violation happened. Longer manual-ban buttons are sent only to `LOGGER_GROUP_ID`, and `/banuser` and `/unbanuser` work only there for the owner.
- Only the first Rule 5 block notice is sent. Further ordinary messages are ignored silently until the 20-minute block expires; commands remain disabled.
- /rankings shows the top 10 users for the current group.
- Mini-games start automatically when the bot is deployed or added to a group, then run once per hour. Restarts and redeploys preserve the existing schedule and do not start duplicate games. Users only need to type the displayed word.
- Existing ranking, mini-game, moderation, and stats data is never reset, archived, deleted, or rewritten on startup. The bot continues counting from the current values.
- /profile shows the calling user’s total, daily, weekly, and overall rank.
- /topuser shows the top 10 global users across all groups the bot has seen.
- /topgroups shows the top 10 groups by activity.
- These views include inline buttons for Today, Total, and Weekly modes.

## Next steps

- After deploying on Render, use `https://<your-render-domain>/healthz` as the URL for your external auto-pinger. The root URL also returns the same healthy response.
