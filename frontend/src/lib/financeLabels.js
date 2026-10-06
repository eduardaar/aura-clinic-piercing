export const FINANCE_ENTRY_LABELS = Object.freeze({
  payable: "Conta a pagar", receivable: "Conta a receber", expense: "Despesa", income: "Receita",
  service_execution: "Atendimento", sales_order: "Venda", payment: "Pagamento", appointment: "Agendamento",
  manual: "Lançamento manual", manual_entry: "Lançamento manual", purchase_order: "Compra", recurrence: "Recorrência",
  sinal: "Sinal", restante: "Restante", total: "Total", pago: "Pago", confirmado: "Confirmado", pendente: "Pendente", cancelado: "Cancelado", credito_aplicado: "Crédito aplicado",
});

export const FINANCE_STATUS_LABELS = Object.freeze({
  pending: "Pendente", partially_paid: "Parcialmente pago", paid: "Pago", overdue: "Vencido",
  canceled: "Cancelado", refunded: "Estornado", active: "Ativo", test: "Teste", cancel: "Cancelado administrativamente",
});

export const financeLabel = (value) => FINANCE_ENTRY_LABELS[value] || FINANCE_STATUS_LABELS[value] || value || "Não informado";
