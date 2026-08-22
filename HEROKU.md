# Heroku deployment

Buildpack:
- heroku/nodejs

Procfile:
- worker: npm start

Dynos:
- Web: 0
- Worker: 1

Required Config Vars:
- TELEGRAM_BOT_TOKEN
- MONGODB_URI

Optional Config Vars:
- MONGODB_DB_NAME (defaults to chatfight)
- LOGGER_GROUP_ID
- PUBLIC_GROUP_LINK
- SUPPORT_CHAT_LINK
- OWNER_IDS

This deployment uses Telegram long polling and does not require a Heroku web dyno or PORT/HEALTH_PORT.
