// Vínculos operacionais do financeiro, sem dados clínicos ou credenciais.
// Cada JOIN aponta para uma chave única: não multiplica parcelas nem totais.
export function financialOriginJoins(entry = "e") {
  return `
    LEFT JOIN service_executions origin_execution ON ${entry}.source_type='service_execution' AND origin_execution.id=${entry}.source_id
    LEFT JOIN payments origin_payment ON ${entry}.source_type='payment' AND origin_payment.id=${entry}.source_id
    LEFT JOIN sales_orders origin_sale ON origin_sale.id=CASE WHEN ${entry}.source_type='sales_order' THEN ${entry}.source_id ELSE origin_payment.sales_order_id END
    LEFT JOIN appointments origin_appointment ON origin_appointment.id=COALESCE(origin_execution.appointment_id, origin_payment.appointment_id,
      origin_sale.appointment_id, CASE WHEN ${entry}.source_type='appointment' THEN ${entry}.source_id END)
    LEFT JOIN clients origin_client ON origin_client.id=COALESCE(origin_appointment.client_id, origin_sale.client_id, origin_payment.client_id)
    LEFT JOIN professionals origin_professional ON origin_professional.id=COALESCE(origin_execution.professional_id, origin_appointment.professional_id)
  `;
}

export const FINANCIAL_ORIGIN_COLUMNS = `
  origin_client.id AS client_id, origin_client.full_name AS client_name,
  origin_appointment.id AS appointment_id, origin_execution.id AS service_execution_id,
  origin_sale.id AS sales_order_id, origin_appointment.appointment_date AS appointment_date,
  origin_sale.created_at AS origin_sale_date,
  origin_appointment.appointment_time AS appointment_time,
  origin_professional.id AS professional_id, origin_professional.name AS professional_name,
  origin_appointment.procedure AS procedure,
  COALESCE(origin_appointment.total_value, origin_sale.total_value) AS operation_total,
  COALESCE(origin_appointment.status, origin_sale.status) AS operation_status,
  CASE WHEN origin_appointment.id IS NOT NULL THEN 'Atendimento #' || origin_appointment.id
    WHEN origin_sale.id IS NOT NULL THEN 'Venda #' || origin_sale.id ELSE 'Lançamento manual' END AS origin_label
`;

export async function financialEntryOrigin(db, entry) {
  if (!entry.appointment_id && !entry.sales_order_id) return null;
  const appointment = Boolean(entry.appointment_id);
  const id = appointment ? entry.appointment_id : entry.sales_order_id;
  const payments = await db.all(`SELECT id, payment_type, method, status, amount, paid_at, financial_entry_id
    FROM payments WHERE ${appointment ? "appointment_id" : "sales_order_id"}=? ORDER BY paid_at, id`, [id]);
  // Somente títulos da origem: os espelhos de payments no ledger não são
  // recebimentos adicionais. Baixas no Financeiro continuam rastreáveis.
  const sourceType = appointment ? "service_execution" : "sales_order";
  const sourceId = appointment ? entry.service_execution_id ||
    (await db.get("SELECT id FROM service_executions WHERE appointment_id=?", [id]))?.id : id;
  const receivables = sourceId ? await db.all(`SELECT id, amount, paid_amount, status, due_date, paid_at, payment_method,
    installment_number, installment_count FROM financial_entries
    WHERE source_type=? AND source_id=? AND entry_type='receivable' ORDER BY installment_number, id`, [sourceType, sourceId]) : [];
  const snapshotItems = appointment && sourceId ? await db.all(`SELECT id,
    CASE WHEN item_type='service' THEN item_name END AS service,
    CASE WHEN item_type='product' THEN item_name END AS product, quantity
    FROM service_execution_items WHERE service_execution_id=? ORDER BY id`, [sourceId]) : [];
  const items = snapshotItems.length ? snapshotItems : appointment
    ? await db.all(`SELECT ai.id, COALESCE(s.name, pr.name) AS service,
        j.name AS product, ai.quantity, ai.region
      FROM appointment_items ai LEFT JOIN services s ON s.id=ai.service_id
      LEFT JOIN procedures pr ON pr.id=ai.procedure_id
      LEFT JOIN jewelry_inventory j ON j.id=ai.jewelry_id WHERE ai.appointment_id=? ORDER BY ai.id`, [id])
    : await db.all(`SELECT id, item_name AS product, quantity FROM sales_order_items WHERE sales_order_id=? ORDER BY id`, [id]);
  const cents = (value) => Math.round(Number(value || 0) * 100);
  const received = payments.filter((payment) => ["pago", "confirmado"].includes(payment.status));
  const deposit = received.filter((payment) => payment.payment_type === "sinal").reduce((sum, payment) => sum + cents(payment.amount), 0);
  const credit = payments.filter((payment) => payment.status === "credito_aplicado").reduce((sum, payment) => sum + cents(payment.amount), 0);
  const activeTitles = receivables.filter((title) => !["canceled", "refunded"].includes(title.status));
  const total = cents(entry.operation_total);
  const titlePaid = activeTitles.reduce((sum, title) => sum + cents(title.paid_amount), 0);
  const paymentPaid = received.reduce((sum, payment) => sum + cents(payment.amount), 0) + credit;
  // A venda quitada pode ter o mesmo recebimento nos pagamentos e nos títulos.
  // Uma redução de título por devolução não representa entrada de dinheiro.
  const linkedPaid = received.filter((payment) => payment.financial_entry_id).reduce((sum, payment) => sum + cents(payment.amount), 0);
  const paid = appointment ? paymentPaid + Math.max(0, titlePaid - linkedPaid) : Math.max(paymentPaid, titlePaid);
  const remaining = ["cancelado", "cancelada", "recusado", "nao_compareceu", "devolvida"].includes(entry.operation_status) ? 0
    : activeTitles.length ? activeTitles.reduce((sum, title) => sum + Math.max(0, cents(title.amount) - cents(title.paid_amount)), 0)
      : Math.max(0, total - paid);
  return {
    type: appointment ? "appointment" : "sales_order", id,
    label: entry.origin_label, client_id: entry.client_id, client: entry.client_name,
    date: entry.appointment_date || String(entry.origin_sale_date || "").slice(0, 10),
    time: entry.appointment_time || null, professional: entry.professional_name || null,
    procedure: entry.procedure || null, items, payments, receivables,
    total_value: total / 100, deposit_paid: deposit / 100, credit_applied: credit / 100,
    other_paid: Math.max(0, paid - deposit - credit) / 100, paid_value: paid / 100,
    remaining_value: remaining / 100,
    href: appointment ? `/app/agenda?appointment=${id}` : `/app/vendas?sale=${id}`
  };
}
