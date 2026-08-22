import { useEffect } from "react";
import { Input, PaymentSelect, Switch } from "./Ui";
import { buildInstallments, installmentSummary, moneyToCents } from "../../lib/installments";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function InstallmentGrid({
  total,
  count,
  firstDueDate,
  paymentMethod,
  installments,
  onChange,
  automatic,
  onAutomaticChange,
  title = "Parcelas",
}) {
  useEffect(() => {
    if (!automatic) return;
    onChange(buildInstallments({ total, count, firstDueDate, paymentMethod }));
  }, [automatic, count, firstDueDate, onChange, paymentMethod, total]);

  const rows = Array.isArray(installments) ? installments : [];
  const summary = installmentSummary(total, rows, count);

  function updateRow(index, field, value) {
    onAutomaticChange(false);
    onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)));
  }

  function changeAutomatic(enabled) {
    onAutomaticChange(enabled);
    if (enabled) onChange(buildInstallments({ total, count, firstDueDate, paymentMethod }));
  }

  return (
    <section className="soft-card stack installment-grid" aria-label={title}>
      <div className="section-inline-header">
        <div>
          <strong>{title}</strong>
          <span>Distribua automaticamente ou personalize cada vencimento, valor e forma.</span>
        </div>
        <Switch
          id={undefined}
          label="Distribuição automática"
          description={undefined}
          checked={automatic}
          defaultChecked={undefined}
          onChange={changeAutomatic}
        />
      </div>

      <div className="stack installment-grid-list">
        {rows.map((installment, index) => (
          <article className="soft-card" key={installment.installment_number || index + 1}>
            <div className="section-inline-header">
              <strong>Parcela {index + 1}</strong>
              <span>{money.format((moneyToCents(installment.amount) ?? 0) / 100)}</span>
            </div>
            <div className="form-grid">
              <Input
                type="date"
                label="Vencimento"
                value={installment.due_date}
                onChange={(due_date) => updateRow(index, "due_date", due_date)}
                required
              />
              <Input
                type="number"
                min="0.01"
                step="0.01"
                label="Valor"
                value={installment.amount}
                onChange={(amount) => updateRow(index, "amount", amount)}
                required
              />
              <PaymentSelect
                label="Forma de pagamento"
                value={installment.payment_method}
                onChange={(payment_method) => updateRow(index, "payment_method", payment_method)}
              />
            </div>
          </article>
        ))}
      </div>

      <div className="form-grid installment-grid-summary" aria-live="polite">
        <div>
          <small>Total da operação</small>
          <strong>{money.format(summary.expectedCents / 100)}</strong>
        </div>
        <div>
          <small>Soma das parcelas</small>
          <strong>{money.format(summary.installmentCents / 100)}</strong>
        </div>
        <div>
          <small>Divergência</small>
          <strong>{money.format(Math.abs(summary.differenceCents) / 100)}</strong>
        </div>
      </div>
      {!summary.isValid && (
        <span className="form-error">
          Revise as parcelas: a quantidade, os campos obrigatórios e a soma devem coincidir com o total da operação.
        </span>
      )}
    </section>
  );
}
