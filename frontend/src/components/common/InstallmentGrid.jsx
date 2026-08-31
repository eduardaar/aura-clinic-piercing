import { useEffect } from "react";
import { Input, PaymentSelect, Switch } from "./Ui";
import { buildInstallments, installmentSummary, moneyToCents } from "../../lib/installments";
import { ResponsiveEditableList, TransactionTotals } from "./TransactionFields";

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

      <ResponsiveEditableList
        items={rows}
        ariaLabel={title}
        getKey={(installment, index) => installment.installment_number || index + 1}
        getError={(installment) => !installment.due_date || !installment.payment_method || moneyToCents(installment.amount) <= 0 ? "Preencha vencimento, valor e forma de pagamento." : ""}
        columns={[
          { key: "number", label: "Parcela", render: (_installment, index) => index + 1 },
          { key: "due_date", label: "Vencimento", render: (installment, index) => {
            return <Input type="date" label="Vencimento" value={installment.due_date} onChange={(value) => updateRow(index, "due_date", value)} required />;
          } },
          { key: "amount", label: "Valor", render: (installment, index) => {
            return <Input type="number" min="0.01" step="0.01" label="Valor" value={installment.amount} onChange={(value) => updateRow(index, "amount", value)} required />;
          } },
          { key: "payment_method", label: "Forma", render: (installment, index) => {
            return <PaymentSelect ariaLabel={`Forma da parcela ${index + 1}`} value={installment.payment_method} onChange={(value) => updateRow(index, "payment_method", value)} />;
          } },
        ]}
      />

      <TransactionTotals rows={[
        { id: "expected", label: "Total da operação", value: money.format(summary.expectedCents / 100) },
        { id: "installments", label: "Soma das parcelas", value: money.format(summary.installmentCents / 100) },
        { id: "difference", label: "Divergência", value: money.format(Math.abs(summary.differenceCents) / 100), emphasis: true },
      ]} />
      {!summary.isValid && (
        <span className="form-error">
          Revise as parcelas: a quantidade, os campos obrigatórios e a soma devem coincidir com o total da operação.
        </span>
      )}
    </section>
  );
}
