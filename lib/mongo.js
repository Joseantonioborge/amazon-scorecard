// lib/mongo.js — conexión compartida y reutilizada (connection pooling)
const { MongoClient } = require('mongodb');

const URI = process.env.MONGODB_URI;
const DB  = 'amazon_fba';

let client = null;

async function getDb() {
  if (!client) {
    client = new MongoClient(URI, { maxPoolSize: 5 });
    await client.connect();
  }
  return client.db(DB);
}

module.exports = { getDb };
