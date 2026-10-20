import { Button, Checkbox, Input, Select, Switch } from "../../components/common/Ui";
import { asArray, asNumber } from "../../lib/utils";
import { currency } from "../shared/helpers";

export function ProcedureKitEditor({ items = [], inventoryItems = [], name = "", onNameChange, onChange }) {
  const update = (index, patch) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  let cost = 0;
  let costVisible = true;
  let complete = Infinity;
  for (const row of items) {
    const item = inventoryItems.find((item) => String(item.id) === String(row.inventory_item_id));
    const variant = asArray(item?.variants).find((variant) => String(variant.id) === String(row.inventory_variant_id));
    if (row.auto_consume === false || row.usage_stage === "reusable") continue;
    if (item && variant?.cost_value == null && item.cost_value == null) costVisible = false;
    cost += asNumber(variant?.cost_value ?? item?.cost_value) * asNumber(row.quantity);
    if (row.is_required !== false && item?.track_stock !== false)
      complete = Math.min(
        complete,
        Math.floor(asNumber(variant?.quantity ?? item?.quantity) / Math.max(1, asNumber(row.quantity))),
      );
  }
  return (
    <section className="soft-card stack" aria-label="Kit de consumo">
      <div className="section-inline-header">
        <strong>Kit de consumo · Materiais previstos</strong>
        <Button
          variant="secondary"
          onClick={() =>
            onChange([
              ...items,
              {
                inventory_item_id: "",
                inventory_variant_id: "",
                quantity: 1,
                is_required: true,
                auto_consume: true,
                usage_stage: "procedure",
                notes: "",
              },
            ])
          }
        >
          Adicionar material
        </Button>
      </div>
      <Input label="Nome do kit" value={name} onChange={onNameChange} placeholder="Ex.: Kit de perfuração de orelha" />
      <p>
        Disponibilidade estimada:{" "}
        <strong>{Number.isFinite(complete) ? Math.max(0, complete) : "Sem componentes limitantes"}</strong> kits
        completos.
        {costVisible && (
          <>
            {" "}
            Custo estimado: <strong>{currency.format(cost)}</strong>.
          </>
        )}
      </p>
      {items.map((row, index) => {
        const item = inventoryItems.find((item) => String(item.id) === String(row.inventory_item_id));
        return (
          <fieldset className="soft-card stack" key={row.inventory_item_id || `new-${index}`}>
            <legend>Material {index + 1}</legend>
            <div className="form-grid">
              <Select
                label="Item de estoque"
                value={row.inventory_item_id}
                onChange={(inventory_item_id) => update(index, { inventory_item_id, inventory_variant_id: "" })}
              >
                <option value="">Selecione</option>
                {inventoryItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              {asArray(item?.variants).length > 0 && (
                <Select
                  label="Variação do material"
                  value={row.inventory_variant_id || ""}
                  onChange={(inventory_variant_id) => update(index, { inventory_variant_id })}
                >
                  <option value="">
                    {asArray(item?.variants).length === 1 ? "Variação única" : "Selecione a variação"}
                  </option>
                  {asArray(item?.variants).map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.variation_name || variant.sku}
                    </option>
                  ))}
                </Select>
              )}
              <Input
                type="number"
                min="1"
                step="1"
                label={`Quantidade por atendimento (${item?.stock_unit || "unidade"})`}
                value={row.quantity}
                onChange={(quantity) => update(index, { quantity })}
              />
              <Select
                label="Finalidade do consumo"
                value={row.usage_stage || "procedure"}
                onChange={(usage_stage) => update(index, { usage_stage, auto_consume: usage_stage !== "reusable" })}
              >
                <option value="procedure">Procedimento</option>
                <option value="preparation">Preparação</option>
                <option value="sterilization">Embalagem ou esterilização</option>
                <option value="hygiene">Higiene e antissepsia</option>
                <option value="reusable">Reutilizável · sem baixa automática</option>
              </Select>
              <Input
                label="Observação do material"
                value={row.notes || ""}
                onChange={(notes) => update(index, { notes })}
              />
            </div>
            <Checkbox
              label="Material obrigatório"
              checked={row.is_required !== false}
              onChange={(is_required) => update(index, { is_required })}
            />
            {row.usage_stage !== "reusable" && (
              <Switch
                label="Incluir no consumo previsto"
                checked={row.auto_consume !== false}
                onChange={(auto_consume) => update(index, { auto_consume })}
              />
            )}
            <Button variant="secondary" onClick={() => onChange(items.filter((_, i) => i !== index))}>
              Remover material {index + 1}
            </Button>
          </fieldset>
        );
      })}
      <small>
        As quantidades usam a unidade de estoque cadastrada, sem criar saldo separado de kits. Ajuste a composição ao
        protocolo do estúdio e à apresentação do fabricante.{" "}
        <a
          href="https://www.gov.br/anvisa/pt-br/assuntos/servicosdesaude/saloes-tatuagens-creches/tatuagem-e-piercing"
          target="_blank"
          rel="noreferrer"
        >
          Orientações oficiais da Anvisa
        </a>
        .
      </small>
    </section>
  );
}
