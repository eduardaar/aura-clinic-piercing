// Rotas de vendas (pedidos).
import { Router } from "express";
import { withFeature } from "../middleware/withDb.js";
import { createSalesOrder, listSalesOrders, countSalesOrders, getSalesOrder, SalesOrderValidationError, deductSoldProductStock } from "../services/sales.js";
import { localTimestamp } from "../services/utils.js";
import { parsePaging, pageResponse } from "../services/pagination.js";
import { tenantClient } from "../services/asaas/credentials.js";
import { createSalesOrderCharge } from "../services/tenantCharges.js";
import { publicPaymentIntent } from "../services/payments.js";
import { P } from "../config/permissions.js";
import { authorizePermission } from "../middleware/requirePermission.js";
import {
  cancelSalesOrderReceivables,
  configuresReceivableSchedule,
  normalizeExplicitInstallments,
  normalizeInstallmentCount,
  normalizeReceivableMode,
  parseStoredInstallments,
  requiresBasicFinanceForSale,
  serializeInstallments,
  settleSalesOrderReceivables,
  syncSalesOrderReceivables
} from "../services/receivables.js";
import { requireFeature } from "../services/subscriptions.js";
import { createSalesReturn, listSalesReturns } from "../services/salesReturns.js";
import { applyCreditToSalesOrder } from "../services/clientCredits.js";
import { recordAudit } from "../services/audit.js";

const router = Router();

// Whitelist de ordenação: a query só escolhe a CHAVE, nunca a coluna.
const SALES_SORTABLE = {
  created_at: "so.created_at",
  total: "so.total_value",
  status: "so.status",
  client: "c.full_name"
};

router.get("/api/sales-orders", withFeature("basic_catalog", async (req, res, db) => {
  if (!authorizePermission(req, res, P.SALES_VIEW)) return;
  const clauses = [];
  const params = [];
  // Ordens geradas pela Agenda pertencem ao módulo de Serviços. Mantemos o
  // registro técnico para o financeiro, mas ele não aparece como venda avulsa.
  if (req.query.include_agenda !== "true") clauses.push("so.source <> 'agenda'");
  if (req.query.status) {
    clauses.push("so.status = ?");
    params.push(req.query.status);
  }
  if (req.query.client_id) {
    clauses.push("so.client_id = ?");
    params.push(req.query.client_id);
  }
  if (req.query.from) {
    clauses.push("so.created_at >= ?");
    params.push(req.query.from);
  }
  if (req.query.to) {
    clauses.push("so.created_at <= ?");
    params.push(`${req.query.to} 23:59:59`);
  }
  if (req.query.search) {
    clauses.push("(c.full_name ILIKE ? OR c.whatsapp ILIKE ?)");
    params.push(`%${req.query.search}%`, `%${req.query.search}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const paging = parsePaging(req.query, {
    sortable: SALES_SORTABLE,
    tieBreak: "so.id",
    defaultOrderBy: "ORDER BY so.created_at DESC, so.id DESC"
  });
  const items = await listSalesOrders(db, { where, params, paging });
  const total = paging.paginated ? await countSalesOrders(db, { where, params }) : items.length;
  res.json(pageResponse(items, total, paging));
}));

router.get("/api/sales-orders/:id", withFeature("basic_catalog", async (req, res, db) => {
  if (!authorizePermission(req, res, P.SALES_VIEW)) return;
  const order = await getSalesOrder(db, req.params.id);
  if (!order) return res.status(404).json({ error: "Venda não encontrada." });
  res.json(order);
}));

router.get("/api/sales-orders/:id/returns", withFeature("basic_catalog", async (req, res, db) => {
  if (!authorizePermission(req, res, P.SALES_VIEW)) return;
  const order = await db.get("SELECT id FROM sales_orders WHERE id=?", [req.params.id]);
  if (!order) return res.status(404).json({ error: "Venda não encontrada." });
  res.json(await listSalesReturns(db, req.params.id));
}));

// Devolução é uma operação própria: valida o limite já devolvido por item,
// devolve estoque apenas quando o item está vendável e reduz primeiro títulos
// ainda abertos. Valor já recebido precisa virar crédito ou reembolso explícito.
router.post("/api/sales-orders/:id/returns", withFeature("basic_catalog", async (req, res, db) => {
  if (!authorizePermission(req, res, P.SALES_EDIT_CLOSED)) return;
  if (["client_credit", "manual_refund"].includes(String(req.body?.financial_action || "")) && !authorizePermission(req, res, P.FINANCE_REFUND)) return;
  try {
    const result = await createSalesReturn(db, req.params.id, req.body || {}, req.user?.id || null);
    await recordAudit(db, {
      req, module: "sales", action: "return", entityType: "sales_order", entityId: req.params.id,
      reason: String(req.body?.reason || "Devolução de venda"), metadata: { return_id: result.id, financial_action: req.body?.financial_action }, severity: "critical"
    });
    res.status(201).json(result);
  } catch (error) {
    const message = error.message || "Não foi possível registrar a devolução.";
    res.status(/não encontrada|não encontrado/i.test(message) ? 404 : /supera|já recebido|só pode|usam o cancelamento/i.test(message) ? 409 : 400).json({ error: message });
  }
}));

router.post("/api/sales-orders/:id/apply-client-credit", withFeature("basic_catalog", async (req, res, db) => {
  if (!authorizePermission(req, res, P.FINANCE_EDIT)) return;
  try {
    const result = await applyCreditToSalesOrder(db, req.params.id, req.body || {}, req.user?.id || null);
    await recordAudit(db, {
      req, module: "sales", action: "apply_client_credit", entityType: "sales_order", entityId: req.params.id,
      reason: String(req.body?.reason || "Crédito do cliente aplicado"), severity: "warning"
    });
    res.json(result);
  } catch (error) {
    res.status(/não encontrada|não encontrado/i.test(error.message) ? 404 : 400).json({ error: error.message || "Não foi possível aplicar o crédito." });
  }
}));

router.post("/api/sales-orders", withFeature("basic_catalog", async (req, res, db) => {
  if (!authorizePermission(req, res, P.SALES_CREATE)) return;
  if (req.body?.appointment_id) return res.status(409).json({ error: "Atendimentos são criados e finalizados pela Agenda, não por Vendas." });
  if (configuresReceivableSchedule(req.body) && !(await requireFeature(req, res, "basic_finance"))) return;
  let order;
  try {
    order = await createSalesOrder(db, req.body || {}, req.user);
  } catch (error) {
    // Recusa de regra de negócio (estoque insuficiente, cupom inválido) é 400
    // com o motivo em texto: sem isto virava 500 e a tela só dizia "erro".
    if (error instanceof SalesOrderValidationError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  if (!order) return res.status(400).json({ error: "Não foi possível criar a venda." });
  await recordAudit(db, {
    req, module: "sales", action: "create", entityType: "sales_order", entityId: order.id,
    reason: "Venda interna criada", after: { id: order.id, client_id: order.client_id, status: order.status, total_value: order.total_value }
  });
  res.status(201).json(order);
}));

router.post("/api/sales-orders/public", withFeature("basic_catalog", async (req, res, db) => {
  if (configuresReceivableSchedule(req.body) && !(await requireFeature(req, res, "basic_finance"))) return;
  let order;
  try {
    order = await createSalesOrder(db, req.body || {}, null);
  } catch (error) {
    if (error instanceof SalesOrderValidationError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  if (!order) return res.status(400).json({ error: "Não foi possível criar a venda." });
  await recordAudit(db, {
    req, actor: null, module: "sales", action: "public_create", entityType: "sales_order", entityId: order.id,
    reason: "Pedido criado pelo catálogo público", after: { id: order.id, client_id: order.client_id, status: order.status, total_value: order.total_value }
  });

  // Cobrança online do pedido, quando a clínica tem gateway configurado.
  //
  // Fica FORA da transação de `createSalesOrder` de propósito: é uma chamada de
  // rede, e prendê-la ali seguraria o lock das reservas de estoque pelo tempo
  // do round-trip. Se o Asaas falhar, o pedido continua de pé e a clínica cobra
  // pelo caminho de sempre — o serviço devolve `online_payment_available:
  // false` em vez de lançar.
  //
  // Só pedido que ainda não está pago: venda registrada como paga (balcão) não
  // precisa de link.
  let paymentIntent = null;
  if (["pendente", "aberta"].includes(String(order.status)) && Number(order.total_value) > 0) {
    try {
      if (await tenantClient(db)) {
        paymentIntent = await createSalesOrderCharge(db, {
          salesOrderId: order.id,
          clientId: order.client_id,
          amount: order.total_value,
          description: `Pedido #${order.id}`,
          // Mesma chave do pedido: reenvio do formulário reaproveita a cobrança
          // em vez de emitir uma segunda fatura para o mesmo carrinho.
          idempotencyKey: `sales-order:${order.id}`
        });
      }
    } catch (error) {
      console.error(`[Asaas] cobrança do pedido ${order.id}: ${error.message}`);
    }
  }

  res.status(201).json({
    ...order,
    payment_intent: publicPaymentIntent(paymentIntent),
    payment_url: paymentIntent?.invoice_url || null,
    online_payment_available: Boolean(paymentIntent?.online_payment_available)
  });
}));

router.patch("/api/sales-orders/:id", withFeature("basic_catalog", async (req, res, db) => {
  const current = await db.get("SELECT * FROM sales_orders WHERE id = ?", [req.params.id]);
  if (!current) return res.status(404).json({ error: "Venda não encontrada." });
  const closed = !["pendente", "aberta"].includes(String(current.status));
  const permission = req.body.status === "cancelado" ? P.SALES_CANCEL : closed ? P.SALES_EDIT_CLOSED : P.SALES_EDIT_OPEN;
  if (!authorizePermission(req, res, permission)) return;
  if (requiresBasicFinanceForSale(req.body, current) &&
      !(await requireFeature(req, res, "basic_finance"))) return;
  try {
    await db.transaction(async (tx) => {
      const locked = await tx.get("SELECT * FROM sales_orders WHERE id = ? FOR UPDATE", [req.params.id]);
      if (!locked) throw new SalesOrderValidationError("Venda não encontrada.", 404);
      const nextStatus = String(req.body.status || locked.status);
      const receivableMode = normalizeReceivableMode(req.body.receivable_mode, locked.receivable_mode || "paid");
      const explicitConfigProvided = Array.isArray(req.body.installments)
        ? req.body.installments.length > 0
        : req.body.installments !== undefined && req.body.installments !== null;
      const automaticConfigProvided = ["installment_count", "first_due_date", "payment_method"]
        .some((key) => req.body[key] !== undefined);
      const storedInstallments = !explicitConfigProvided && !automaticConfigProvided && receivableMode === "pending"
        ? parseStoredInstallments(locked.installments_json)
        : null;
      const rawInstallments = explicitConfigProvided ? req.body.installments : storedInstallments;
      let explicitInstallments;
      try {
        explicitInstallments = normalizeExplicitInstallments(rawInstallments, {
          total: locked.total_value,
          defaultPaymentMethod: req.body.payment_method || locked.payment_method || "Pix"
        });
      } catch (error) {
        throw new SalesOrderValidationError(error.message);
      }
      if (explicitConfigProvided && receivableMode !== "pending") {
        throw new SalesOrderValidationError("Parcelas explícitas exigem recebimento pendente.");
      }
      const installmentCount = explicitInstallments?.length || normalizeInstallmentCount(req.body.installment_count ?? locked.installment_count ?? 1);
      const firstDueDate = explicitInstallments?.[0]?.dueDate || String(req.body.first_due_date || locked.first_due_date || localTimestamp().slice(0, 10));
      const nextPaymentMethod = String(req.body.payment_method || explicitInstallments?.[0]?.paymentMethod || locked.payment_method || "Pix");
      const installmentsJson = explicitInstallments ? JSON.stringify(serializeInstallments(explicitInstallments)) : null;
      const nowOperationallyClosed = ["concluida", "pago"].includes(nextStatus);
      if (locked.source === "agenda" && req.body.status && nextStatus !== locked.status) {
        throw new SalesOrderValidationError("A ordem de serviço da agenda deve ser alterada pelo próprio atendimento.", 409);
      }
      if (nextStatus === "cancelado" && Number(locked.stock_deducted || 0)) {
        throw new SalesOrderValidationError(
          "Venda com estoque já baixado não pode ser cancelada diretamente. Registre o estorno ou a devolução do estoque.",
          409
        );
      }
      if (nextStatus === "cancelado") {
        const settled = await tx.get(
          `SELECT EXISTS (
             SELECT 1 FROM payments
             WHERE sales_order_id=? AND status IN ('pago','confirmado') AND amount>0
           ) OR EXISTS (
             SELECT 1 FROM financial_entries
             WHERE source_type='sales_order' AND source_id=? AND entry_type='receivable'
               AND (status IN ('paid','refunded') OR paid_amount>0)
           ) AS value`,
          [locked.id, locked.id]
        );
        if (settled?.value) {
          throw new SalesOrderValidationError(
            "Venda com valor já recebido não pode ser cancelada diretamente. Registre o estorno financeiro.",
            409
          );
        }
      }

      await tx.run(
        `UPDATE sales_orders SET status=?, payment_method=?, receivable_mode=?, installment_count=?,
           first_due_date=?, installments_json=?, notes=? WHERE id=?`,
        [nextStatus, nextPaymentMethod, receivableMode, installmentCount, firstDueDate, installmentsJson, req.body.notes ?? locked.notes, locked.id]
      );

      if (nowOperationallyClosed && !Number(locked.stock_deducted || 0)) {
        const items = await tx.all("SELECT * FROM sales_order_items WHERE sales_order_id=? ORDER BY id", [locked.id]);
        let stockTouched = false;
        for (const item of items) {
          stockTouched = Boolean(await deductSoldProductStock(tx, item, locked.id)) || stockTouched;
        }
        if (stockTouched) await tx.run("UPDATE sales_orders SET stock_deducted=1 WHERE id=?", [locked.id]);
      }

      if (nowOperationallyClosed && Number(locked.total_value) > 0 && receivableMode === "paid") {
        const paidAt = localTimestamp();
        await tx.run(
          `INSERT INTO payments
            (appointment_id, client_id, sales_order_id, amount, payment_type, method, status, paid_at, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, 'pago', ?, ?) ON CONFLICT DO NOTHING`,
          [locked.appointment_id, locked.client_id, locked.id, locked.total_value, locked.order_type, nextPaymentMethod, paidAt, `sales-order:${locked.id}:paid`]
        );
        await settleSalesOrderReceivables(tx, locked.id, { paymentMethod: nextPaymentMethod, paidAt });
      } else if (nowOperationallyClosed && receivableMode === "pending" && Number(locked.total_value) > 0) {
        await syncSalesOrderReceivables(tx, {
          salesOrderId: locked.id,
          amount: locked.total_value,
          installmentCount,
          firstDueDate,
          paymentMethod: nextPaymentMethod,
          installments: explicitInstallments
        });
      }

      if (nextStatus === "cancelado") await cancelSalesOrderReceivables(tx, locked.id);
      await recordAudit(tx, {
        req, module: "sales", action: nextStatus === "cancelado" ? "cancel" : "update", entityType: "sales_order", entityId: locked.id,
        reason: String(req.body?.reason || (nextStatus === "cancelado" ? "Venda cancelada" : "Venda alterada")),
        before: { id: locked.id, status: locked.status, payment_method: locked.payment_method, receivable_mode: locked.receivable_mode },
        after: { id: locked.id, status: nextStatus, payment_method: nextPaymentMethod, receivable_mode: receivableMode },
        severity: nextStatus === "cancelado" ? "critical" : "warning"
      });
    });
  } catch (error) {
    if (error instanceof SalesOrderValidationError || /recebimento|parcelas|vencimento/i.test(String(error.message))) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    throw error;
  }
  res.json(await getSalesOrder(db, req.params.id));
}));

export default router;
