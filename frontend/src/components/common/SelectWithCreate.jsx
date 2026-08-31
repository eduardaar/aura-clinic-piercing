import { useEffect, useId, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Input, Select } from "./Ui";
import { Modal } from "./Crud";

/**
 * Select alimentado por um cadastro simples (categoria, centro de custo,
 * fornecedor...) com atalho para criar uma opção nova sem sair do formulário
 * onde ela é usada. `onCreate(name)` deve devolver o registro criado
 * (`{ id, name, ... }`); a opção nova já entra selecionada.
 */
/** @param {{ label?: React.ReactNode, value?: any, onChange?: (value: any) => any, options?: any[], emptyLabel?: string, createTitle?: string, createLabel?: string, onCreate?: (name: string) => any }} props */
export function SelectWithCreate({ label, value, onChange, options, emptyLabel = "Nenhum", createTitle, createLabel = "Nome", onCreate }) {
  const formId = useId();
  const [creating, setCreating] = useState(null);
  // A opção recém-criada ainda não chega em `options` no mesmo render (o
  // refetch da lista é assíncrono); sem isso o Select não encontra a opção
  // e o `<select>` nativo espelhado pelo Radix reverte o valor para vazio.
  const [pendingOption, setPendingOption] = useState(null);
  const mergedOptions = pendingOption && !options.some((item) => String(item.id) === String(pendingOption.id))
    ? [...options, pendingOption]
    : options;

  // O Radix Select espelha as opções num `<select>` nativo oculto e o
  // remonta quando o conjunto de opções muda; se o valor for setado no
  // mesmo commit em que a opção nova é registrada, esse remount corrige o
  // valor de volta para vazio. Por isso o `onChange` só acontece depois que
  // a opção nova já foi renderizada (efeito seguinte, após o commit).
  useEffect(() => {
    if (pendingOption) onChange(String(pendingOption.id));
  }, [pendingOption, onChange]);

  async function submit(event) {
    event.preventDefault();
    event.stopPropagation();
    const name = String(creating?.name || "").trim();
    if (!name) return;
    const created = await onCreate(name);
    setCreating(null);
    if (created?.id) setPendingOption(created);
  }

  return (
    <div className="select-with-create">
      <span className="ui-select-label">{label}</span>
      <div className="select-with-create-row">
        <Select value={value} onChange={onChange}>
          <option value="">{emptyLabel}</option>
          {mergedOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <Button type="button" variant="secondary" className="select-with-create-add" onClick={() => setCreating({ name: "" })} aria-label={createTitle}>
          <Plus size={16} aria-hidden="true" />
        </Button>
      </div>
      <Modal
        open={!!creating}
        title={createTitle}
        size="sm"
        onClose={() => setCreating(null)}
        footer={<><Button variant="secondary" onClick={() => setCreating(null)}>Cancelar</Button><Button type="submit" form={formId} variant="primary">Salvar</Button></>}
      >
        <form id={formId} onSubmit={submit}>
          <Input label={createLabel} value={creating?.name ?? ""} onChange={(name) => setCreating((current) => ({ ...current, name }))} required />
        </form>
      </Modal>
    </div>
  );
}
