// api/reports.js — informes de costes, márgenes y recomendaciones por producto
const { getDb } = require('../lib/mongo');
const { validateSession } = require('../lib/session');
const { ObjectId } = require('mongodb');

const PHASE_ORDER = ['investigacion', 'validacion', 'sourcing', 'logistica', 'listing', 'lanzamiento', 'analisis'];
const PHASE_LABELS = {
  investigacion: 'Investigación',
  validacion:    'Validación',
  sourcing:      'Sourcing',
  logistica:     'Logística',
  listing:       'Listing',
  lanzamiento:   'Lanzamiento',
  analisis:      'Análisis'
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const currentUser = await validateSession(token);
    if (!currentUser) return res.status(401).json({ error: 'Sesión inválida' });

    const db = await getDb();

    // GET /api/reports?type=global — resumen de todos los productos
    if (req.query.type === 'global') {
      const products = await db.collection('products').find({}).toArray();
      const allCosts  = await db.collection('costs').find({}).toArray();
      const allPhases = await db.collection('phases').find({}).toArray();

      const summary = products.map(p => {
        const pid     = p._id.toString();
        const pCosts  = allCosts.filter(c => c.product_id.toString() === pid);
        const pPhases = allPhases.filter(ph => ph.product_id.toString() === pid);
        const totalCost = pCosts.reduce((s, c) => s + c.amount, 0);

        const costsByPhase = {};
        pCosts.forEach(c => { costsByPhase[c.phase] = (costsByPhase[c.phase] || 0) + c.amount; });

        const completedPhases = pPhases.filter(ph => ph.status === 'completed').length;
        const progress = Math.round((completedPhases / PHASE_ORDER.length) * 100);

        return { product: p, total_cost: totalCost, costs_by_phase: costsByPhase, progress };
      });

      const totalInvested = allCosts.reduce((s, c) => s + c.amount, 0);
      return res.json({
        summary,
        total_invested: totalInvested,
        product_count:  products.length,
        pipeline_count: products.filter(p => p.status === 'pipeline').length,
        launched_count: products.filter(p => p.status === 'launched').length
      });
    }

    // GET /api/reports?product_id=xxx — informe detallado por producto
    if (req.query.product_id) {
      const pid = new ObjectId(req.query.product_id);

      const product = await db.collection('products').findOne({ _id: pid });
      if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

      const phases = await db.collection('phases').find({ product_id: pid }).toArray();
      const costs  = await db.collection('costs').find({ product_id: pid }).toArray();

      phases.sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));

      const totalCost = costs.reduce((s, c) => s + c.amount, 0);

      const costsByPhase = {};
      PHASE_ORDER.forEach(ph => { costsByPhase[ph] = 0; });
      costs.forEach(c => { costsByPhase[c.phase] = (costsByPhase[c.phase] || 0) + c.amount; });

      const phaseCompletion = {};
      phases.forEach(p => {
        const total = p.checklist?.length || 0;
        const done  = p.checklist?.filter(i => i.completed).length || 0;
        phaseCompletion[p.phase] = total > 0 ? Math.round((done / total) * 100) : 0;
      });

      const costsByPhaseLabeled = {};
      Object.entries(costsByPhase).forEach(([k, v]) => {
        costsByPhaseLabeled[PHASE_LABELS[k] || k] = v;
      });

      // Cálculo de margen estimado
      // Supuesto: precio venta × 300 unidades/mes - COGS estimado (40% precio) - costes lanzamiento
      const pvp   = product.target_price || 0;
      const cogs  = pvp * 0.40; // coste de fabricación estimado: 40% del PVP
      const amazonFees = pvp * 0.15; // fees Amazon: ~15%
      const fba   = pvp * 0.10; // fulfillment FBA: ~10%
      const unitMargin = pvp - cogs - amazonFees - fba;
      const marginPct = pvp > 0 ? (unitMargin / pvp) * 100 : 0;

      const monthlyRevenue = pvp * 300;
      const monthlyProfit  = unitMargin * 300;
      const breakEven      = unitMargin > 0 ? Math.ceil(totalCost / unitMargin) : null;

      return res.json({
        product,
        phases,
        costs,
        total_cost: totalCost,
        costs_by_phase: costsByPhase,
        costs_by_phase_labeled: costsByPhaseLabeled,
        phase_completion: phaseCompletion,
        financials: {
          pvp,
          cogs_estimated: cogs,
          amazon_fees:    amazonFees,
          fba_fees:       fba,
          unit_margin:    unitMargin,
          margin_pct:     marginPct,
          monthly_revenue: monthlyRevenue,
          monthly_profit:  monthlyProfit,
          break_even_units: breakEven,
          total_invested: totalCost
        },
        recommendations: buildRecommendations(product, phases, totalCost, marginPct)
      });
    }

    res.status(400).json({ error: 'Parámetros insuficientes: product_id o type=global' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

function buildRecommendations(product, phases, totalCost, marginPct) {
  const recs = [];

  if (product.target_margin && marginPct < product.target_margin) {
    recs.push({
      type: 'warning',
      icon: '⚠️',
      title: 'Margen por debajo del objetivo',
      message: `El margen estimado (${marginPct.toFixed(1)}%) está por debajo del objetivo (${product.target_margin}%). Considera negociar mejor precio con el proveedor o aumentar el PVP.`
    });
  }

  const blocked = phases.filter(p => p.status === 'blocked');
  blocked.forEach(p => {
    recs.push({
      type: 'error',
      icon: '🔴',
      title: `Fase BLOQUEADA: ${PHASE_LABELS[p.phase]}`,
      message: `La fase "${PHASE_LABELS[p.phase]}" está bloqueada. Revisa las notas y desbloquea para continuar con el lanzamiento.`
    });
  });

  const currentPhase = phases.find(p => p.phase === product.current_phase);
  if (currentPhase) {
    const done  = currentPhase.checklist?.filter(i => i.completed).length || 0;
    const total = currentPhase.checklist?.length || 1;
    const pct   = done / total;
    if (pct < 0.8 && currentPhase.status !== 'completed') {
      recs.push({
        type: 'info',
        icon: '📋',
        title: 'Checklist incompleto',
        message: `La fase actual "${PHASE_LABELS[product.current_phase]}" tiene ${Math.round(pct*100)}% del checklist completado. Completa al menos el 80% antes de avanzar.`
      });
    }
  }

  const logisticsCost = phases.find(p => p.phase === 'logistica');
  if (logisticsCost && product.target_price > 0) {
    const logCostPct = (totalCost / (product.target_price * 300)) * 100;
    if (logCostPct > 20) {
      recs.push({
        type: 'warning',
        icon: '🚢',
        title: 'Costes logísticos elevados',
        message: 'Los costes representan más del 20% de los ingresos estimados mensuales. Considera cambiar a envío marítimo o renegociar con el freight forwarder.'
      });
    }
  }

  if (recs.length === 0) {
    recs.push({
      type: 'success',
      icon: '✅',
      title: '¡Todo en orden!',
      message: 'El producto avanza según lo planificado. Mantén el ritmo y revisa los KPIs semanalmente.'
    });
  }

  return recs;
}
