// api/costs.js — registro y consulta de costes por fase y producto
const { getDb } = require('../lib/mongo');
const { validateSession } = require('../lib/session');
const { ObjectId } = require('mongodb');

const COST_CATEGORIES = {
  investigacion: ['Suscripción Helium10', 'Otras herramientas', 'Consultoría', 'Otros'],
  validacion:    ['Muestras de mercado', 'Testing', 'Asesoría legal / marcas', 'Otros'],
  sourcing:      ['Muestras proveedor', 'Envío de muestras', 'Agente de sourcing', 'Pedido inicial', 'Otros'],
  logistica:     ['Flete marítimo', 'Flete aéreo', 'Agente aduanas', 'Aranceles / IVA importación', 'Preparación FBA', 'Etiquetado', 'Almacenaje', 'Otros'],
  listing:       ['Fotografía profesional', 'Infografías / diseño', 'Copywriting', 'Traducción', 'A+ Content', 'Otros'],
  lanzamiento:   ['Presupuesto PPC', 'Cupones / descuentos', 'Amazon Vine', 'Promociones', 'Influencers', 'Otros'],
  analisis:      ['Herramientas de análisis', 'Consultoría', 'Test A/B', 'Otros']
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const currentUser = await validateSession(token);
    if (!currentUser) return res.status(401).json({ error: 'Sesión inválida' });

    const db = await getDb();
    const isAdmin = currentUser.role === 'admin';

    // GET /api/costs?categories=1
    if (req.method === 'GET' && req.query.categories) {
      return res.json(COST_CATEGORIES);
    }

    // GET /api/costs[?product_id=xxx][&phase=xxx]
    if (req.method === 'GET') {
      const filter = {};
      if (req.query.product_id) filter.product_id = new ObjectId(req.query.product_id);
      if (req.query.phase)      filter.phase = req.query.phase;
      if (!isAdmin)             filter.phase = { $in: currentUser.phase_access };

      const costs = await db.collection('costs')
        .find(filter)
        .sort({ date: -1 })
        .toArray();
      return res.json(costs);
    }

    // POST /api/costs — registrar coste
    if (req.method === 'POST') {
      const { product_id, phase, category, amount, currency, description, date } = req.body || {};
      if (!product_id || !phase || amount === undefined)
        return res.status(400).json({ error: 'product_id, phase y amount requeridos' });

      if (!isAdmin && !currentUser.phase_access.includes(phase))
        return res.status(403).json({ error: 'Sin acceso a esta fase' });

      const cost = {
        product_id:  new ObjectId(product_id),
        phase,
        category:    category || 'Otros',
        amount:      parseFloat(amount),
        currency:    currency || 'EUR',
        description: description || '',
        date:        date ? new Date(date) : new Date(),
        created_by:  currentUser._id,
        created_at:  new Date()
      };
      const result = await db.collection('costs').insertOne(cost);
      return res.status(201).json({ _id: result.insertedId, ...cost });
    }

    // DELETE /api/costs?id=xxx
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID requerido' });

      const cost = await db.collection('costs').findOne({ _id: new ObjectId(id) });
      if (!cost) return res.status(404).json({ error: 'Coste no encontrado' });

      if (!isAdmin && cost.created_by.toString() !== currentUser._id.toString())
        return res.status(403).json({ error: 'Sin permiso para eliminar este coste' });

      await db.collection('costs').deleteOne({ _id: new ObjectId(id) });
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
