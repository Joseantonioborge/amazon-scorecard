// api/phases.js — lectura y actualización de fases y sus checklists
const { getDb } = require('../lib/mongo');
const { validateSession } = require('../lib/session');
const { ObjectId } = require('mongodb');

const PHASE_ORDER = ['investigacion', 'validacion', 'sourcing', 'logistica', 'listing', 'lanzamiento', 'analisis'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const currentUser = await validateSession(token);
    if (!currentUser) return res.status(401).json({ error: 'Sesión inválida' });

    const db = await getDb();
    const isAdmin = currentUser.role === 'admin';

    // GET /api/phases?product_id=xxx
    if (req.method === 'GET') {
      const { product_id } = req.query;
      if (!product_id) return res.status(400).json({ error: 'product_id requerido' });

      const phases = await db.collection('phases')
        .find({ product_id: new ObjectId(product_id) })
        .toArray();

      // Ordenar según PHASE_ORDER
      phases.sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));
      return res.json(phases);
    }

    // PUT /api/phases?product_id=xxx&phase=xxx — actualizar fase
    if (req.method === 'PUT') {
      const { product_id, phase } = req.query;
      if (!product_id || !phase) return res.status(400).json({ error: 'product_id y phase requeridos' });

      if (!isAdmin && !currentUser.phase_access.includes(phase))
        return res.status(403).json({ error: 'Sin acceso a esta fase' });

      const { status, responsible_email, notes, checklist, doc_url } = req.body || {};
      const update = { updated_at: new Date() };

      if (status) {
        update.status = status;
        if (status === 'completed') {
          update.completed_at = new Date();
          // Avanzar la fase actual del producto al siguiente
          const nextPhase = PHASE_ORDER[PHASE_ORDER.indexOf(phase) + 1];
          if (nextPhase) {
            await db.collection('products').updateOne(
              { _id: new ObjectId(product_id) },
              { $set: { current_phase: nextPhase, updated_at: new Date() } }
            );
            // Marcar siguiente fase como in_progress
            await db.collection('phases').updateOne(
              { product_id: new ObjectId(product_id), phase: nextPhase },
              { $set: { status: 'in_progress', started_at: new Date(), updated_at: new Date() } }
            );
          } else {
            // Última fase completada → producto lanzado
            await db.collection('products').updateOne(
              { _id: new ObjectId(product_id) },
              { $set: { status: 'launched', updated_at: new Date() } }
            );
          }
        }
        if (status === 'in_progress' && !update.started_at) update.started_at = new Date();
      }

      if (responsible_email !== undefined) update.responsible_email = responsible_email;
      if (notes !== undefined)             update.notes = notes;
      if (checklist)                       update.checklist = checklist;
      if (doc_url !== undefined)           update.doc_url = doc_url;

      await db.collection('phases').updateOne(
        { product_id: new ObjectId(product_id), phase },
        { $set: update }
      );
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
