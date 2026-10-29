import { useEffect, useState } from "react";
import { publicApiFetch } from "../../lib/api";
import { localDateValue } from "../../lib/utils";

/** @param {{ serviceId: any, serviceIds?: any[], professionalId: any, value: string, onChange: (date: string) => void }} props */
export function PublicBookingCalendar({ serviceId, serviceIds = [], professionalId, value, onChange }) {
  const currentMonth = localDateValue(new Date()).slice(0, 7);
  const [month, setMonth] = useState(value?.slice(0, 7) || currentMonth);
  const [result, setResult] = useState({ key: "", dates: [], error: "" });
  const selection = serviceIds.length ? serviceIds.join(",") : String(serviceId || "");
  const primaryService = serviceId || serviceIds[0];
  const key = `${selection}/${professionalId}/${month}`;
  const loading = result.key !== key;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!selection || !professionalId) {
          if (!cancelled)
            setResult({ key, dates: [], error: "Escolha o serviço e o profissional para consultar as datas." });
          return;
        }
        const params = new URLSearchParams({
          service_id: String(primaryService),
          service_ids: selection,
          professional_id: String(professionalId),
          month,
        });
        const response = await publicApiFetch(`/booking/dates?${params}`);
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || "Não foi possível carregar as datas.");
        if (!cancelled) setResult({ key, dates: Array.isArray(json.dates) ? json.dates : [], error: "" });
      } catch (error) {
        if (!cancelled) setResult({ key, dates: [], error: error.message || "Não foi possível carregar as datas." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [primaryService, selection, professionalId, month, key]);

  function moveMonth(offset) {
    const date = new Date(`${month}-01T12:00:00`);
    date.setMonth(date.getMonth() + offset);
    setMonth(localDateValue(date).slice(0, 7));
  }

  return (
    <div className="public-booking-calendar">
      <div className="public-booking-month-nav">
        <button
          type="button"
          className="secondary-button"
          aria-label="Mês anterior"
          disabled={month <= currentMonth}
          onClick={() => moveMonth(-1)}
        >
          ‹
        </button>
        <label>
          Mês do agendamento
          <input
            type="month"
            value={month}
            min={currentMonth}
            onChange={(event) => {
              if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value);
            }}
          />
        </label>
        <button type="button" className="secondary-button" aria-label="Próximo mês" onClick={() => moveMonth(1)}>
          ›
        </button>
      </div>
      {loading ? (
        <p role="status">Carregando datas disponíveis...</p>
      ) : result.error ? (
        <p className="form-error" role="alert">
          {result.error}
        </p>
      ) : (
        <>
          <div className="booking-date-strip">
            {result.dates.map((date) => {
              const parsed = new Date(`${date}T12:00:00`);
              return (
                <button
                  key={date}
                  type="button"
                  aria-label={parsed.toLocaleDateString("pt-BR", { dateStyle: "full" })}
                  className={value === date ? "active" : ""}
                  onClick={() => onChange(date)}
                >
                  <strong>{parsed.getDate()}</strong>
                  <span>{parsed.toLocaleDateString("pt-BR", { weekday: "short" })}</span>
                  <small>{parsed.toLocaleDateString("pt-BR", { month: "short" })}</small>
                </button>
              );
            })}
          </div>
          {!result.dates.length && (
            <p className="empty-state">Nenhuma data disponível neste mês. Consulte outro mês.</p>
          )}
        </>
      )}
    </div>
  );
}
