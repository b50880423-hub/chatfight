# Heroku deployment

Buildpack:
- heroku/nodejs

Procfile:
- web: npm run web
- worker: npm run worker

Dynos:
- Web: 1
- Worker: 1

Required Config Vars:
- TELEGRAM_BOT_TOKEN
- MONGODB_URI
- WEBSITE_URL (the public URL of this Heroku app)

Optional Config Vars:
- MONGODB_DB_NAME (defaults to chatfight)
- LOGGER_GROUP_ID
- PUBLIC_GROUP_LINK
- SUPPORT_CHAT_LINK
- OWNER_IDS
