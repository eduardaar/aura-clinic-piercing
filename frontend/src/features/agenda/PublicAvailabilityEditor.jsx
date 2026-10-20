import { useEffect, useState } from "react";
import { Button, Checkbox, Input, Select, Switch } from "../../components/common/Ui";
import { apiFetch } from "../../lib/api";
import { localDateValue } from "../../lib/utils";

const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function PublicAvailabilityEditor({ professionalId }) {
  const [config, setConfig] = useState({ restricted: false, windows: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [preset, setPreset] = useState("custom");
  const [anchor, setAnchor] = useState(localDateValue(new Date()));
  const [month, setMonth] = useState(localDateValue(new Date()).slice(0, 7));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage("");
    setError("");
    setLoadFailed(false);
    if (!professionalId)
      return () => {
        cancelled = true;
      };
    (async () => {
      try {
        const response = await apiFetch(`/availability/public/${professionalId}`);
        const json = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(json.error || "Não foi possível carregar a agenda pública.");
        setConfig(json);
      } catch (error) {
        if (!cancelled) {
          setError(error.message);
          setLoadFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [professionalId]);

  function addPeriod() {
    let from = anchor;
    let to = anchor;
    if (preset === "week") {
      const start = new Date(`${anchor}T12:00:00`);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      from = localDateValue(start);
      start.setDate(start.getDate() + 6);
      to = localDateValue(start);
    } else if (preset === "month") {
      from = `${month}-01`;
      to = localDateValue(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0, 12));
    }
    if (!from || !to) return;
    setConfig((current) => ({
      restricted: true,
      windows: [
        ...current.windows,
        { from, to, weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: "09:00", end_time: "18:00" },
      ],
    }));
    setMessage("");
  }

  function update(index, patch) {
    setConfig((current) => ({
      ...current,
      windows: current.windows.map((window, i) => (i === index ? { ...window, ...patch } : window)),
    }));
    setMessage("");
  }

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch(`/availability/public/${professionalId}`, {
        method: "PUT",
        body: JSON.stringify(config),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Não foi possível salvar.");
      setConfig(json);
      setMessage("Disponibilidade do link público salva com sucesso.");
    } catch (error) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel public-availability-editor" aria-label="Disponibilidade do link público">
      <div className="panel-heading">
        <div>
          <h2>Disponibilidade do link público</h2>
          <span>Libere semanas, meses ou períodos para o profissional selecionado acima.</span>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}
      {!professionalId ? (
        <p>Selecione um profissional para configurar.</p>
      ) : loading ? (
        <p>Carregando disponibilidade...</p>
      ) : (
        <form onSubmit={save}>
          <Switch
            label="Disponibilizar somente os períodos liberados"
            checked={config.restricted}
            onChange={(restricted) => {
              setConfig({ ...config, restricted });
              setMessage("");
            }}
          />
          <p className="field-hint">
            {config.restricted
              ? "Somente os períodos abaixo aparecem no link. Sem períodos, a agenda pública fica fechada."
              : "Todos os horários livres da agenda de atendimento ficam disponíveis no link."}{" "}
            As liberações respeitam horários de atendimento, almoço, bloqueios e agendamentos existentes.
          </p>
          <div className="public-release-toolbar">
            <Select label="Liberar período" value={preset} onChange={setPreset}>
              <option value="custom">Período personalizado</option>
              <option value="week">Semana específica</option>
              <option value="month">Mês inteiro</option>
            </Select>
            {preset === "month" ? (
              <Input label="Mês a liberar" type="month" value={month} onChange={setMonth} />
            ) : (
              <Input
                label={preset === "week" ? "Uma data da semana" : "Data inicial"}
                type="date"
                value={anchor}
                onChange={setAnchor}
              />
            )}
            <Button variant="secondary" disabled={config.windows.length >= 100 || saving} onClick={addPeriod}>
              Adicionar período
            </Button>
          </div>
          <div className="public-release-list">
            {config.windows.map((window, index) => (
              <fieldset className="public-release-window" key={index} disabled={saving}>
                <legend>Período {index + 1}</legend>
                <div className="public-release-fields">
                  <Input
                    type="date"
                    label="De"
                    value={window.from}
                    onChange={(from) => update(index, { from })}
                    required
                  />
                  <Input
                    type="date"
                    label="Até"
                    value={window.to}
                    min={window.from}
                    onChange={(to) => update(index, { to })}
                    required
                  />
                  <Input
                    type="time"
                    label="A partir de"
                    value={window.start_time}
                    onChange={(start_time) => update(index, { start_time })}
                    required
                  />
                  <Input
                    type="time"
                    label="Até o horário"
                    value={window.end_time}
                    onChange={(end_time) => update(index, { end_time })}
                    required
                  />
                </div>
                <div className="public-release-weekdays">
                  {weekdays.map((label, day) => (
                    <Checkbox
                      key={day}
                      label={label}
                      checked={window.weekdays.includes(day)}
                      onChange={(checked) =>
                        update(index, {
                          weekdays: checked
                            ? [...window.weekdays, day]
                            : window.weekdays.filter((value) => value !== day),
                        })
                      }
                    />
                  ))}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => setConfig({ ...config, windows: config.windows.filter((_, i) => i !== index) })}
                >
                  Remover período {index + 1}
                </Button>
              </fieldset>
            ))}
          </div>
          <p className="field-hint">
            Para liberar manhã e tarde com horários diferentes, adicione dois períodos. Datas e horários fora das
            liberações ficam indisponíveis ao cliente.
          </p>
          <Button type="submit" disabled={saving || loadFailed}>
            {saving ? "Salvando..." : "Salvar disponibilidade pública"}
          </Button>
        </form>
      )}
    </section>
  );
}
