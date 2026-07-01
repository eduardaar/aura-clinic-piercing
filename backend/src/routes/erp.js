// Rota do painel ERP (visão geral do produto/SaaS).
import { Router } from "express";
import { withDb } from "../middleware/withDb.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/api/erp", withDb(async (_req, res, db) => {
  if (!requireRole(_req, res, ["admin"])) return;
  const clientsCount = await db.get("SELECT COUNT(*) AS count FROM clients");
  const appointmentsCount = await db.get("SELECT COUNT(*) AS count FROM appointments");
  const jewelryCount = await db.get("SELECT COUNT(*) AS count FROM jewelry_inventory");
  const paid = await db.get("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'pago'");
  const catalogItems = await db.all(`
    SELECT id, name, photo_url, category, material, color, size, quantity, sale_value
    FROM jewelry_inventory
    WHERE quantity > 0
    ORDER BY name
    LIMIT 6
  `);
  const crm = await db.all(`
    SELECT stage, COUNT(*) AS total
    FROM (
      SELECT
        c.id,
        CASE
          WHEN COUNT(a.id) >= 4 THEN 'Cliente VIP'
          WHEN COUNT(a.id) >= 2 THEN 'Cliente recorrente'
          WHEN COUNT(a.id) = 1 THEN 'Cliente'
          ELSE 'Lead'
        END AS stage
      FROM clients c
      LEFT JOIN appointments a ON a.client_id = c.id
      GROUP BY c.id
    ) AS crm_stages
    GROUP BY stage
    ORDER BY total DESC
  `);
  const bodyMap = await db.all(`
    SELECT piercing_region AS region, COUNT(*) AS total
    FROM appointments
    WHERE piercing_region IS NOT NULL AND piercing_region != ''
    GROUP BY piercing_region
    ORDER BY total DESC
    LIMIT 8
  `);

  res.json({
    product: {
      name: "Aura Clinic ERP",
      positioning: "SaaS premium para body piercing, joalherias corporais, consultorias, cursos e CRM.",
      stackTarget: ["React", "Vite", "TypeScript", "TailwindCSS", "Framer Motion", "Node.js", "Express", "PostgreSQL", "Cloudinary", "JWT"],
      tenancy: "Preparado para multiempresa com separacao futura por studio_id/tenant_id."
    },
    metrics: {
      studios: 1,
      clients: clientsCount.count || 0,
      appointments: appointmentsCount.count || 0,
      jewelry: jewelryCount.count || 0,
      revenue: paid.total || 0
    },
    modules: [
      ["Dashboard", "ativo", "Indicadores, alertas, graficos e agenda do dia"],
      ["Agendamentos", "ativo", "Calendario, status, sinais, profissionais e joias"],
      ["Clientes e prontuários", "ativo", "Histórico, fotos, intercorrências, fidelidade e retornos"],
      ["Termo digital", "ativo", "Assinatura, aceite e PDF automático"],
      ["Estoque de joalherias", "ativo", "Cadastro, filtros, baixa automática e alertas"],
      ["Catalogo online", "planejado", "Vitrine publica com reserva, compra e agendamento"],
      ["Financeiro", "ativo", "Entradas, saidas, lucro e exportações"],
      ["CRM", "planejado", "Funil, automações, reativação e aniversários"],
      ["Aura Rewards", "ativo", "Pontos, niveis e resgates"],
      ["Indique e Ganhe", "planejado", "Indicacoes, beneficios e acompanhamento"],
      ["Cupons", "planejado", "Cupons fixos, percentuais, validade e limite"],
      ["Influenciadores", "planejado", "Cupons, cliques, vendas, conversoes e comissoes"],
      ["Consultorias", "planejado", "Agenda, pagamento e Google Meet"],
      ["Aura Academy", "planejado", "Cursos, videos, PDFs e certificados"],
      ["Conteúdo", "planejado", "Calendário editorial, ideias, hashtags e legendas IA"],
      ["Mapa corporal", "planejado", "Modelo anatômico com histórico de perfurações"],
      ["Administrativo", "ativo", "Permissões por perfil e usuários"],
      ["Relatorios", "ativo", "Financeiro, clientes, estoque e exportações"],
      ["Configuracoes", "planejado", "Logo, cores, horarios, profissionais e mensagens"]
    ].map(([name, status, description]) => ({ name, status, description })),
    crm,
    catalogItems,
    bodyMap,
    coupons: [
      { code: "AURA15", type: "percentual", value: 15, status: "ativo" },
      { code: "JULIA10", type: "percentual", value: 10, status: "influenciador" }
    ],
    influencers: [
      { name: "Julia Mendes", instagram: "@juliamendes", coupon: "JULIA10", conversions: 12, commission: 420 },
      { name: "Marina Glow", instagram: "@marinaglow", coupon: "GLOWAURA", conversions: 8, commission: 280 }
    ],
    consultancies: [
      { name: "Consultoria individual", price: 497, format: "Google Meet" },
      { name: "Mentoria Aura Pro", price: 1497, format: "Online ao vivo" }
    ],
    academy: [
      { name: "Biosseguranca para Body Piercer", lessons: 12, students: 34 },
      { name: "Curadoria de Joias Premium", lessons: 8, students: 19 }
    ],
    contentPlanner: [
      ["Segunda", "Reels"],
      ["Terca", "Antes e depois"],
      ["Quarta", "Mitos"],
      ["Quinta", "Bastidores"],
      ["Sexta", "Promocoes"],
      ["Sabado", "Clientes"],
      ["Domingo", "Autoridade"]
    ].map(([day, theme]) => ({ day, theme }))
  });
}));

export default router;
