import { useEffect, useState } from "react";
import { Input } from "../../components/common/Ui";
import { apiFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";

export function AppointmentMaterials({ appointmentId, serviceIds = "", onChange }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setError("");
    setRows([]);
    onChange(undefined);
    (async () => {
      try {
        const response = await apiFetch(
          `/appointments/${appointmentId}/materials?service_ids=${encodeURIComponent(serviceIds)}`,
        );
        const json = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(json.error || "Não foi possível conferir os materiais.");
        const items = asArray(json.items).map((row) => ({
          ...row,
          quantity:
            row.usage_stage === "reusable" || row.auto_consume === false || row.is_required === false
              ? 0
              : row.quantity,
        }));
        setRows(items);
        onChange(items.map(({ inventory_item_id, quantity }) => ({ inventory_item_id, quantity })));
      } catch (error) {
        if (!cancelled) setError(error.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appointmentId, serviceIds, onChange]);
  function change(index, quantity) {
    const next = rows.map((row, i) => (i === index ? { ...row, quantity } : row));
    setRows(next);
    onChange(next.map(({ inventory_item_id, quantity }) => ({ inventory_item_id, quantity: Number(quantity) })));
  }
  return (
    <section className="soft-card stack" aria-label="Consumo de materiais">
      <strong>Conferir materiais do atendimento</strong>
      <small>
        Confirme as quantidades realmente usadas. Para corrigir um consumo já concluído, reabra o atendimento com
        justificativa antes de finalizar novamente.
      </small>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!error && !rows.length && <small>Sem materiais previstos no kit deste atendimento.</small>}
      {rows.map((row, index) => (
        <div className="form-grid" key={row.inventory_item_id}>
          <span>
            {row.inventory_item_name} · {row.is_required ? "Obrigatório" : "Opcional"}
            <small>
              {" "}
              · Disponível: {row.variant_quantity ?? row.available_quantity} {row.stock_unit}
            </small>
          </span>
          {row.usage_stage === "reusable" ? (
            <span>Reutilizável · sem baixa</span>
          ) : (
            <Input
              type="number"
              min={row.is_required && row.auto_consume ? 1 : 0}
              step="1"
              label={`Consumo de ${row.inventory_item_name}`}
              value={row.quantity}
              onChange={(value) => change(index, value)}
            />
          )}
        </div>
      ))}
    </section>
  );
}
