import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { createHealthServer } from './health.js';

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'chatfight';
if (!mongoUri) {
  console.error('MONGODB_URI is required for the rankings website');
  process.exit(1);
}
const client = new MongoClient(mongoUri);
let db;
async function connectDb() {
  if (!db) {
    await client.connect();
    db = client.db(dbName);
    console.log(`Website connected to MongoDB database: ${dbName}`);
  }
  return db;
}
const server = createHealthServer(connectDb);
const port = Number(process.env.PORT || process.env.HEALTH_PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Rankings website listening on ${port}`));
process.once('SIGINT', async () => { await client.close(); process.exit(0); });
process.once('SIGTERM', async () => { await client.close(); process.exit(0); });
