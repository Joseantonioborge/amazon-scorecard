// api/auth.js — login, logout, verificación de sesión y setup inicial
const { getDb } = require('../lib/mongo');
const { createSession, validateSession, deleteSession } = require('../lib/session');
const crypto = require('crypto');

const PHASES = ['investigacion', 'validacion', 'sourcing', 'logistica', 'listing', 'lanzamiento', 'analisis'];

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd + 'amz_fba_salt_2026').digest('hex');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  try {
    const db = await getDb();

    // POST /api/auth?action=login
    if (req.method === 'POST' && action === 'login') {
      const { email, password } = req.body || {};
      if (!email || !password)
        return res.status(400).json({ error: 'Email y contraseña requeridos' });

      const user = await db.collection('users').findOne({
        email: email.toLowerCase().trim(),
        active: true
      });
      if (!user || user.password_hash !== hashPassword(password))
        return res.status(401).json({ error: 'Credenciales incorrectas' });

      const token = await createSession(user._id);
      await db.collection('users').updateOne(
        { _id: user._id },
        { $set: { last_login: new Date() } }
      );
      await db.collection('access_log').insertOne({
        user_id: user._id, email: user.email, timestamp: new Date()
      });

      return res.json({
        token,
        user: { id: user._id, name: user.name, email: user.email, role: user.role, phase_access: user.phase_access }
      });
    }

    // GET /api/auth?action=me
    if (req.method === 'GET' && action === 'me') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user = await validateSession(token);
      if (!user) return res.status(401).json({ error: 'Sesión inválida o expirada' });
      return res.json({
        id: user._id, name: user.name, email: user.email,
        role: user.role, phase_access: user.phase_access
      });
    }

    // POST /api/auth?action=logout
    if (req.method === 'POST' && action === 'logout') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      await deleteSession(token);
      return res.json({ ok: true });
    }

    // POST /api/auth?action=setup — crea el primer admin si no existe ningún usuario
    if (req.method === 'POST' && action === 'setup') {
      const count = await db.collection('users').countDocuments();
      if (count > 0)
        return res.status(400).json({ error: 'Ya existen usuarios configurados' });

      const { name, email, password } = req.body || {};
      if (!name || !email || !password)
        return res.status(400).json({ error: 'Nombre, email y contraseña requeridos' });

      const newUser = {
        name,
        email: email.toLowerCase().trim(),
        password_hash: hashPassword(password),
        role: 'admin',
        phase_access: PHASES,
        active: true,
        created_at: new Date()
      };
      const result = await db.collection('users').insertOne(newUser);
      const token = await createSession(result.insertedId);

      return res.json({
        token,
        user: { id: result.insertedId, name, email: newUser.email, role: 'admin', phase_access: PHASES }
      });
    }

    // GET /api/auth?action=needs_setup
    if (req.method === 'GET' && action === 'needs_setup') {
      const count = await db.collection('users').countDocuments();
      return res.json({ needs_setup: count === 0 });
    }

    res.status(404).json({ error: 'Acción no encontrada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
