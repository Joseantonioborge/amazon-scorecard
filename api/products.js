// api/products.js — CRUD de productos con creación automática de fases
const { getDb } = require('../lib/mongo');
const { validateSession } = require('../lib/session');
const { ObjectId } = require('mongodb');

const PHASES = ['investigacion', 'validacion', 'sourcing', 'logistica', 'listing', 'lanzamiento', 'analisis'];

const PHASE_CHECKLIST = {
  investigacion: [
    'Definir nicho y categoría objetivo',
    'BSR del top seller < 10.000 en la categoría',
    'Ventas estimadas > 300 unidades/mes',
    'Análisis de competencia (reviews, ratings, antigüedad)',
    'Búsqueda con Helium10 Black Box',
    'Análisis de keywords principales (Magnet/Cerebro)',
    'Estimación del precio de venta',
    'Margen bruto preliminar > 30%'
  ],
  validacion: [
    'Verificar restricciones de categoría en Amazon',
    'Analizar tendencias (Google Trends / Trendster)',
    'Validar estacionalidad del producto',
    'Revisar patents y marcas registradas',
    'Verificar regulaciones CE / FDA / RoHS',
    'Calcular ROI esperado',
    'Score validación ≥ 70%',
    'Decisión final: GO ✅ / NO-GO ❌'
  ],
  sourcing: [
    'Búsqueda en Alibaba / 1688 (≥ 10 proveedores)',
    'Preselección de ≥ 3 proveedores',
    'Solicitar muestras a proveedores seleccionados',
    'Evaluar calidad de muestras recibidas',
    'Negociar precio y MOQ',
    'Solicitar certificados (CE, RoHS, etc.)',
    'Negociar condiciones de pago',
    'Firmar NDA / acuerdo de confidencialidad',
    'Realizar pedido inicial'
  ],
  logistica: [
    'Elegir método de envío (aéreo / marítimo / express)',
    'Cotizar con ≥ 3 freight forwarders',
    'Contratar agente de aduanas',
    'Preparar documentación aduanera (factura, packing list)',
    'Crear envío FBA en Seller Central',
    'Definir etiquetado (FNSKU, cajas maestras)',
    'Preparar y etiquetar cajas para FBA',
    'Trackear envío hasta almacén FBA',
    'Confirmar recepción en almacén Amazon'
  ],
  listing: [
    'Keyword research final con Cerebro / Magnet',
    'Redactar título optimizado (≤ 200 caracteres)',
    'Redactar 5 bullet points optimizados',
    'Redactar descripción y A+ Content',
    'Brief fotográfico (mínimo 7 imágenes)',
    'Sesión fotográfica profesional',
    'Crear infografías (beneficios, dimensiones)',
    'Subir imágenes al listing',
    'Configurar precio y variaciones en Seller Central',
    'Revisar y activar listing'
  ],
  lanzamiento: [
    'Verificar Buy Box y disponibilidad del listing',
    'Crear campaña PPC Auto (fase 1)',
    'Crear campaña PPC Manual por palabras clave',
    'Establecer presupuesto diario PPC',
    'Activar cupones de lanzamiento (10-20%)',
    'Inscribirse en Amazon Vine (si aplica)',
    'Solicitar reviews a primeros compradores',
    'Monitorear ranking de keywords principales',
    'Ajustar precio competitivo diariamente (primeros 7 días)'
  ],
  analisis: [
    'Analizar ACoS y TACoS semanalmente',
    'Optimizar palabras clave negativas en PPC',
    'Revisar y responder reviews recibidas',
    'Analizar tasa de conversión (CVR)',
    'Calcular margen real vs margen proyectado',
    'Identificar oportunidades de mejora en listing',
    'Implementar test A/B en título / imágenes',
    'Revisar nivel de inventario (punto de reorden)',
    'Evaluar expansión a otros marketplaces europeos'
  ]
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const currentUser = await validateSession(token);
    if (!currentUser) return res.status(401).json({ error: 'Sesión inválida' });

    const db = await getDb();
    const isAdmin = currentUser.role === 'admin';

    // GET /api/products
    if (req.method === 'GET') {
      const products = await db.collection('products')
        .find({})
        .sort({ created_at: -1 })
        .toArray();
      return res.json(products);
    }

    // POST /api/products — crear producto (admin)
    if (req.method === 'POST') {
      if (!isAdmin) return res.status(403).json({ error: 'Solo administradores pueden crear productos' });
      const { name, category, target_price, target_margin, notes } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Nombre del producto requerido' });

      const product = {
        name,
        category: category || '',
        asin: '',
        status: 'pipeline',
        current_phase: 'investigacion',
        target_price: parseFloat(target_price) || 0,
        target_margin: parseFloat(target_margin) || 30,
        notes: notes || '',
        created_by: currentUser._id,
        created_at: new Date(),
        updated_at: new Date()
      };
      const result = await db.collection('products').insertOne(product);

      // Crear registros de fase para este producto
      const phaseInserts = PHASES.map((phase, idx) => ({
        product_id: result.insertedId,
        phase,
        status: idx === 0 ? 'in_progress' : 'pending',
        responsible_email: '',
        checklist: PHASE_CHECKLIST[phase].map(item => ({ item, completed: false })),
        notes: '',
        started_at: idx === 0 ? new Date() : null,
        completed_at: null,
        updated_at: new Date()
      }));
      await db.collection('phases').insertMany(phaseInserts);

      return res.status(201).json({ _id: result.insertedId, ...product });
    }

    // PUT /api/products?id=xxx — actualizar producto
    if (req.method === 'PUT') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID requerido' });

      const { name, category, asin, status, current_phase, target_price, target_margin, notes } = req.body || {};
      const update = { updated_at: new Date() };
      if (name)                    update.name = name;
      if (category !== undefined)  update.category = category;
      if (asin !== undefined)      update.asin = asin;
      if (status)                  update.status = status;
      if (current_phase)           update.current_phase = current_phase;
      if (target_price !== undefined) update.target_price = parseFloat(target_price);
      if (target_margin !== undefined) update.target_margin = parseFloat(target_margin);
      if (notes !== undefined)     update.notes = notes;

      await db.collection('products').updateOne({ _id: new ObjectId(id) }, { $set: update });
      return res.json({ ok: true });
    }

    // DELETE /api/products?id=xxx — eliminar producto (admin)
    if (req.method === 'DELETE') {
      if (!isAdmin) return res.status(403).json({ error: 'Solo administradores' });
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'ID requerido' });

      const oid = new ObjectId(id);
      await db.collection('products').deleteOne({ _id: oid });
      await db.collection('phases').deleteMany({ product_id: oid });
      await db.collection('costs').deleteMany({ product_id: oid });
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
