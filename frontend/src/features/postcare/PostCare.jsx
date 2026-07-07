// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useState } from "react";
import { Instagram, Search } from "lucide-react";
import { Button, Metric, Select, StatusBadge } from "../../components/common/Ui";
import { ApiError, Loading } from "../../components/common/Feedback";
import { asArray, formatDate } from "../../lib/utils";
import { API_ORIGIN, apiFetch, useFetch } from "../../lib/api";
import { personName } from "../../features/shared/helpers";

export function PostCare() {
  const { data, refresh } = useFetch("/post-care");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  if (!data) return <Loading />;
  if (data.error) return <ApiError message={data.error} />;
  const followups = asArray(data);
  const items = followups.filter((item) => {
    const text = `${personName(item)} ${item.whatsapp} ${item.procedure} ${item.piercing_region} ${item.jewelry_name} ${item.healing_status}`.toLowerCase();
    return (!search.trim() || text.includes(search.toLowerCase())) && (!status || item.status === status);
  });
  const dueCount = followups.filter((item) => item.status !== "concluido" && item.due_date <= new Date().toISOString().slice(0, 10)).length;

  return (
    <section className="stack">
      <div className="metric-grid">
        <Metric label="Lembretes totais" value={followups.length} />
        <Metric label="Pendentes ou vencidos" value={dueCount} />
        <Metric label="Fotos recebidas" value={followups.filter((item) => item.client_photo_url).length} />
      </div>
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input placeholder="Pesquisar cliente, procedimento, joia ou status" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <Select label="Status" value={status} onChange={setStatus}>
          <option value="">Todos</option>
          <option value="pendente">pendente</option>
          <option value="mensagem enviada">mensagem enviada</option>
          <option value="foto recebida">foto recebida</option>
          <option value="concluido">concluído</option>
        </Select>
      </div>
      <div className="post-care-grid">
        {items.map((item) => <PostCareCard item={item} key={item.id} onChanged={refresh} />)}
      </div>
      {!items.length && <p className="empty-state">Nenhum acompanhamento encontrado.</p>}
    </section>
  );
}

export function PostCareCard({ item, onChanged }) {
  const [form, setForm] = useState({
    care_message: item.care_message || "",
    healing_status: item.healing_status || "aguardando retorno",
    client_notes: item.client_notes || "",
    status: item.status || "pendente"
  });
  const [photo, setPhoto] = useState(null);
  const isDue = item.status !== "concluido" && item.due_date <= new Date().toISOString().slice(0, 10);

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
    <article className={`post-care-card ${isDue ? "due" : ""}`}>
      <header>
        <div>
          <span className="eyebrow">{item.reminder_day} dias</span>
          <h2>{personName(item)}</h2>
          <p>{item.whatsapp} · {item.instagram || "sem Instagram"}</p>
        </div>
        <StatusBadge tone={isDue ? "warn" : "ok"}>{formatDate(item.due_date)}</StatusBadge>
      </header>
      <dl>
        <div><dt>Procedimento</dt><dd>{item.procedure}</dd></div>
        <div><dt>Região</dt><dd>{item.piercing_region}</dd></div>
        <div><dt>Joia</dt><dd>{item.jewelry_name || "sem joia"}</dd></div>
        <div><dt>Profissional</dt><dd>{item.professional_name}</dd></div>
      </dl>
      {item.client_photo_url && <img className="post-care-photo" src={`${API_ORIGIN}${item.client_photo_url}`} alt="Foto enviada pelo cliente" />}
      <form onSubmit={save} className="post-care-form">
        <label>Mensagem personalizada de cuidados
          <textarea value={form.care_message} onChange={(event) => setForm({ ...form, care_message: event.target.value })} />
        </label>
        <div className="form-grid">
          <Select label="Status da cicatrização" value={form.healing_status} onChange={(value) => setForm({ ...form, healing_status: value })}>
            <option>aguardando retorno</option>
            <option>cicatrização normal</option>
            <option>atenção necessária</option>
            <option>intercorrência</option>
            <option>cicatrização concluída</option>
          </Select>
          <Select label="Status do lembrete" value={form.status} onChange={(value) => setForm({ ...form, status: value })}>
            <option value="pendente">pendente</option>
            <option value="mensagem enviada">mensagem enviada</option>
            <option value="foto recebida">foto recebida</option>
            <option value="concluido">concluído</option>
          </Select>
        </div>
        <label>Observações do cliente
          <textarea value={form.client_notes} onChange={(event) => setForm({ ...form, client_notes: event.target.value })} />
        </label>
        <label>Foto enviada pelo cliente
          <input type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files[0])} />
        </label>
        <Button variant="primary" type="submit">Salvar acompanhamento</Button>
      </form>
    </article>
  );
}

