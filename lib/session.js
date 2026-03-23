// lib/session.js — gestión de sesiones en MongoDB
const { getDb } = require('./mongo');
const crypto = require('crypto');

async function createSession(userId) {
  const db = await getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  await db.collection('sessions').insertOne({
    token,
    user_id: userId,
    expires_at,
    created_at: new Date()
  });
  return token;
}

async function validateSession(token) {
  if (!token || token.length < 10) return null;
  const db = await getDb();
  const session = await db.collection('sessions').findOne({
    token,
    expires_at: { $gt: new Date() }
  });
  if (!session) return null;
  const user = await db.collection('users').findOne({ _id: session.user_id });
  return user || null;
}

async function deleteSession(token) {
  if (!token) return;
  const db = await getDb();
  await db.collection('sessions').deleteOne({ token });
}

module.exports = { createSession, validateSession, deleteSession };
