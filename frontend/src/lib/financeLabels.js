export const FINANCE_ENTRY_LABELS = Object.freeze({
  payable: "Conta a pagar", receivable: "Conta a receber", expense: "Despesa", income: "Receita",
});

export const FINANCE_STATUS_LABELS = Object.freeze({
  pending: "Pendente", partially_paid: "Parcialmente pago", paid: "Pago", overdue: "Vencido",
  canceled: "Cancelado", refunded: "Estornado", active: "Ativo", test: "Teste", cancel: "Cancelado administrativamente",
});

export const financeLabel = (value) => FINANCE_ENTRY_LABELS[value] || FINANCE_STATUS_LABELS[value] || value || "Não informado";
