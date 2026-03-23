// api/users.js — CRUD de usuarios (solo admin)
const { getDb } = require('../lib/mongo');
const { validateSession } = require('../lib/session');
const { ObjectId } = require('mongodb');
const crypto = require('crypto');

const PHASES = ['investigacion', 'validacion', 'sourcing', 'logistica', 'listing', 'lanzamiento', 'analisis'];

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd + 'amz_fba_salt_2026').digest('hex');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const currentUser = await validateSession(token);
    if (!currentUser) return res.status(401).json({ error: 'Sesión inválida' });
    if (currentUser.role !== 'admin') return res.status(403).json({ error: 'Solo administradores' });

    const db = await getDb();

    // GET /api/users
    if (req.method === 'GET') {
      const users = await db.collection('users')
        .find({}, { projection: { password_hash: 0 } })
        .sort({ created_at: -1 })
        .toArray();
      return res.json(users);
    }

    // POST /api/users — crear usuario
    if (req.method === 'POST') {
      const { name, email, password, role, phase_access } = req.body || {};
      if (!name || !email || !password)
        return res.status(400).json({ error: 'Nombre, email y contraseña requeridos' });

      const existing = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
      if (existing) return res.status(400).json({ error: 'Email ya registrado' });

      const user = {
        name,
        email: email.toLowerCase().trim(),
        password_hash: hashPassword(password),
        role: role || 'user',
        phase_access: role === 'admin' ? PHASES : (Array.isArray(phase_access) ? phase_access : []),
        active: true,
        created_at: new Date()
      };
      const result = await db.collection('users').insertOne(user);
      return res.status(201).json({ _id: result.insertedId, ...user, password_hash: undefined });
    }

    // PUT /api/users?id=xxx — actualizar usuario
    if (req.method === 'PUT') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID requerido' });

      const { name, email, password, role, phase_access, active } = req.body || {};
      const update = {};
      if (name)             update.name = name;
      if (email)            update.email = email.toLowerCase().trim();
      if (password)         update.password_hash = hashPassword(password);
      if (role)             update.role = role;
      if (role === 'admin') update.phase_access = PHASES;
      else if (Array.isArray(phase_access)) update.phase_access = phase_access;
      if (active !== undefined) update.active = active;

      await db.collection('users').updateOne({ _id: new ObjectId(id) }, { $set: update });
      return res.json({ ok: true });
    }

    // DELETE /api/users?id=xxx — eliminar usuario
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID requerido' });
      if (id === currentUser._id.toString())
        return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });

      await db.collection('users').deleteOne({ _id: new ObjectId(id) });
      await db.collection('sessions').deleteMany({ user_id: new ObjectId(id) });
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
