// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Metric, SecureImage, Select, StatusBadge, Textarea } from "../../components/common/Ui";
import { Modal, RowActions } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray } from "../../lib/utils";
import { apiFetch, useFetch } from "../../lib/api";
import { personName } from "../../features/shared/helpers";

const HEALING_STATUS_OPTIONS = [
  "aguardando retorno",
  "cicatrização normal",
  "atenção necessária",
  "intercorrência",
  "cicatrização concluída"
];

const REMINDER_STATUS_OPTIONS = [
  { value: "pendente", label: "pendente" },
  { value: "mensagem enviada", label: "mensagem enviada" },
  { value: "foto recebida", label: "foto recebida" },
  { value: "concluido", label: "concluído" }
];

// `formatDate` de lib/utils devolve dd/MM sem ano: lembretes de anos diferentes
// ficariam com a mesma data na coluna de vencimento.
function formatDateWithYear(date) {
  const value = String(date || "").slice(0, 10);
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("pt-BR");
}

const today = () => new Date().toISOString().slice(0, 10);
const isOverdue = (item) => item.status !== "concluido" && String(item.due_date || "") <= today();

// Opções vindas dos próprios acompanhamentos: a base tem status que não estão
// na lista fixa do formulário (ex.: "respondido", "cicatrizando bem"), e um
// filtro que não os oferece esconde registros do usuário.
const distinctOptions = (rows, pick) => [...new Set(rows.map(pick).filter(Boolean))].sort();

// Mantém no <select> o valor já gravado quando ele não está na lista canônica:
// sem isso o navegador exibe a primeira opção e salvar trocaria o dado.
const withCurrent = (options, current) =>
  current && !options.some((option) => (option.value ?? option) === current)
    ? [...options, typeof options[0] === "string" ? current : { value: current, label: current }]
    : options;

export function PostCare({ onBack }) {
  const { data, refresh } = useFetch("/post-care");
  const [editing, setEditing] = useState(null);
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const followups = asArray(data);
  const dueCount = followups.filter(isOverdue).length;

  return (
    <section className="stack postcare-page">
      <div className="module-backbar"><Button variant="secondary" onClick={onBack}><ArrowLeft size={16} /> Voltar para clientes</Button></div>
      <div className="metric-grid">
        <Metric label="Lembretes totais" value={followups.length} />
        <Metric label="Pendentes ou vencidos" value={dueCount} />
        <Metric label="Fotos recebidas" value={followups.filter((item) => item.client_photo_url).length} />
      </div>

      <div className="panel">
        <DataView
          rows={followups}
          defaultSort={{ key: "due_date", dir: "asc" }}
          searchPlaceholder="Pesquisar cliente, WhatsApp, procedimento, joia ou status"
          filters={[
            { key: "status", label: "Status do lembrete", type: "select", options: distinctOptions(followups, (item) => item.status) },
            { key: "healing_status", label: "Status da cicatrização", type: "select", options: distinctOptions(followups, (item) => item.healing_status) },
            {
              key: "from",
              label: "Vencimento a partir de",
              type: "date",
              match: (item, value) => String(item.due_date || "").slice(0, 10) >= value
            },
            {
              key: "to",
              label: "Vencimento até",
              type: "date",
              match: (item, value) => String(item.due_date || "").slice(0, 10) <= value
            }
          ]}
          columns={[
            {
              key: "full_name",
              label: "Cliente",
              value: (item) => `${personName(item)} ${item.whatsapp || ""} ${item.instagram || ""}`,
              render: (item) => (
                <div>
                  <strong>{personName(item)}</strong>
                  <br />
                  <small>{item.whatsapp} · {item.instagram || "sem Instagram"}</small>
                </div>
              )
            },
            {
              key: "procedure",
              label: "Procedimento",
              value: (item) => `${item.procedure || ""} ${item.piercing_region || ""} ${item.jewelry_name || ""}`,
              render: (item) => (
                <div>
                  <span>{item.procedure}</span>
                  <br />
                  <small>{item.piercing_region} · {item.jewelry_name || "sem joia"}</small>
                </div>
              )
            },
            {
              key: "reminder_day",
              label: "Dia do lembrete",
              align: "right",
              value: (item) => Number(item.reminder_day || 0),
              render: (item) => `${item.reminder_day} dias`
            },
            {
              key: "due_date",
              label: "Vencimento",
              value: (item) => String(item.due_date || ""),
              render: (item) => (
                <StatusBadge tone={isOverdue(item) ? "warn" : "ok"}>{formatDateWithYear(item.due_date)}</StatusBadge>
              )
            },
            { key: "healing_status", label: "Status de cicatrização", render: (item) => item.healing_status || "—" },
            {
              key: "status",
              label: "Status",
              render: (item) => <StatusBadge status={item.status}>{item.status === "concluido" ? "concluído" : item.status}</StatusBadge>
            }
          ]}
          actions={(item) => <RowActions actions={[{ label: "Editar", onClick: () => setEditing(item), primary: true }]} />}
          empty="Nenhum acompanhamento registrado ainda."
          emptyFiltered="Nenhum acompanhamento corresponde à busca ou aos filtros."
        />
      </div>

      <Modal
        open={!!editing}
        title={editing ? personName(editing) : ""}
        subtitle="Acompanhamento de cicatrização"
        size="lg"
        onClose={() => setEditing(null)}
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button type="submit" form="post-care-form" variant="primary">Salvar acompanhamento</Button>
          </>
        )}
      >
        {editing && (
          <PostCareEditor
            key={editing.id}
            item={editing}
            onChanged={() => { setEditing(null); refresh(); }}
          />
        )}
      </Modal>
    </section>
  );
}

// Edição por registro: mesmos campos do card antigo, agora dentro do modal
// aberto pela ação "Editar" da linha (não cabem numa célula de tabela).
export function PostCareEditor({ item, onChanged }) {
  const [form, setForm] = useState({
    care_message: item.care_message || "",
    healing_status: item.healing_status || "aguardando retorno",
    client_notes: item.client_notes || "",
    status: item.status || "pendente"
  });
  const [photo, setPhoto] = useState(null);

  async function save(event) {
    event.preventDefault();
    const formData = new FormData();
    Object.entries(form).forEach(([key, value]) => formData.append(key, value));
    if (photo) formData.append("client_photo", photo);
    await apiFetch(`/post-care/${item.id}`, { method: "PATCH", body: formData });
    setPhoto(null);
    onChanged();
  }

  return (
    <div className="stack">
      <dl>
        <div><dt>Procedimento</dt><dd>{item.procedure}</dd></div>
        <div><dt>Região</dt><dd>{item.piercing_region}</dd></div>
        <div><dt>Joia</dt><dd>{item.jewelry_name || "sem joia"}</dd></div>
        <div><dt>Profissional</dt><dd>{item.professional_name}</dd></div>
        <div><dt>Vencimento</dt><dd>{formatDateWithYear(item.due_date)} ({item.reminder_day} dias)</dd></div>
      </dl>
      {item.client_photo_url && <SecureImage className="post-care-photo" src={item.client_photo_url} alt="Foto enviada pelo cliente" />}
      <form id="post-care-form" onSubmit={save} className="post-care-form">
        <Textarea label="Mensagem personalizada de cuidados" value={form.care_message} onChange={(care_message) => setForm({ ...form, care_message })} />
        <div className="form-grid">
          <Select label="Status da cicatrização" value={form.healing_status} onChange={(value) => setForm({ ...form, healing_status: value })}>
            {withCurrent(HEALING_STATUS_OPTIONS, item.healing_status).map((option) => <option key={option}>{option}</option>)}
          </Select>
          <Select label="Status do lembrete" value={form.status} onChange={(value) => setForm({ ...form, status: value })}>
            {withCurrent(REMINDER_STATUS_OPTIONS, item.status).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </div>
        <Textarea label="Observações do cliente" value={form.client_notes} onChange={(client_notes) => setForm({ ...form, client_notes })} />
        <label>Foto enviada pelo cliente
          <input type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files[0])} />
        </label>
      </form>
    </div>
  );
}
