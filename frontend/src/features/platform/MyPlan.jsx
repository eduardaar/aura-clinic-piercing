import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, CreditCard, QrCode, ReceiptText, Sparkles } from "lucide-react";
import { Button, Input } from "../../components/common/Ui";
import { Modal } from "../../components/common/Crud";
import { apiFetch } from "../../lib/api";
import { asArray } from "../../lib/utils";
import "../../styles/myplan.css";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const invoiceLabels = { pendente: "A pagar", paga: "Paga", atrasada: "Em atraso", cancelada: "Cancelada", estornada: "Estornada", projetada: "Prevista" };

function displayDate(value) {
  if (!value) return "—";
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "—" : date.format(parsed);
}

const featureLabels = {
  clients: "Clientes", agenda: "Agenda", procedures: "Procedimentos", manual_reminders: "Lembretes manuais",
  basic_inventory: "Estoque simples", basic_catalog: "Catálogo simples", whatsapp_link: "Link WhatsApp",
  basic_reports: "Relatórios básicos", online_booking: "Agendamento online", anamnesis: "Anamnese digital",
  digital_terms: "Termo digital", basic_finance: "Financeiro básico", deposits: "Sinais/entradas",
  stock_alerts: "Alertas de estoque", automatic_followup: "Pós-atendimento automático",
  message_templates: "Modelos de mensagem", public_catalog_customization: "Catálogo personalizado",
  multi_user: "Multiusuários", commissions: "Comissões", monthly_reports: "Relatórios mensais",
  coupons: "Cupons", returns: "Trocas e devoluções", full_client_history: "Histórico completo do cliente",
  jewelry_sales_report: "Relatório de vendas de joias", advanced_catalog: "Catálogo avançado",
  catalog_analytics: "Google Analytics no catálogo", featured_products: "Produtos em destaque", promotional_banner: "Banner promocional", campaigns: "Campanhas",
  advanced_finance: "Financeiro avançado", variation_inventory: "Estoque por variação",
  alert_center: "Central de alertas", courses: "Cursos", priority_support: "Suporte prioritário"
};

// Tela "Meu plano": durante o trial permite experimentar outro pacote. Depois
// de contratada a assinatura, o backend exige suporte/fluxo de cobrança para
// não conceder recursos antes de confirmar a alteração financeira.
export function MyPlan({ subscription, plans, onChanged }) {
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [billing, setBilling] = useState(null);
  const [billingForm, setBillingForm] = useState({ tax_id: "", email: "", phone: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [checkingOut, setCheckingOut] = useState("");
  const [billingMethod, setBillingMethod] = useState("CREDIT_CARD");
  const [invoices, setInvoices] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [pixPayment, setPixPayment] = useState(null);
  const [loadingPix, setLoadingPix] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const list = asArray(plans);
  const currentCode = subscription?.plan_code || "";
  const daysLeft = Number(subscription?.days_left ?? 0);
  const status = String(subscription?.status || "");
  const isTrial = status === "trial_active";
  const isInactive = subscription?.access_active === false;

  const currentPlan = useMemo(() => list.find((p) => p.code === currentCode), [list, currentCode]);
  const billingProfile = billing?.billing_profile;
  const checkoutAvailable = Boolean(billing?.gateway_enabled && billingProfile?.complete && !billing?.subscription?.asaas_subscription_id);

  const loadBilling = useCallback(async () => {
    const [billingResponse, invoicesResponse, scheduleResponse] = await Promise.all([
      apiFetch("/billing/subscription"),
      apiFetch("/billing/invoices?limit=100&offset=0"),
      apiFetch("/billing/schedule")
    ]);
    if (billingResponse.ok) {
      const payload = await billingResponse.json();
      setBilling(payload);
      setBillingForm((current) => ({ ...current, email: payload?.billing_profile?.email || "", phone: payload?.billing_profile?.phone || "" }));
    }
    if (invoicesResponse.ok) {
      const payload = await invoicesResponse.json();
      setInvoices(asArray(payload?.items ?? payload));
    }
    if (scheduleResponse.ok) {
      const payload = await scheduleResponse.json();
      setSchedule(asArray(payload?.items));
    }
  }, []);

  useEffect(() => { loadBilling().catch(() => setBilling(null)); }, [loadBilling]);

  async function changePlan(code) {
    if (code === currentCode || saving) return;
    setSaving(code);
    setError("");
    try {
      const response = await apiFetch("/subscription", { method: "PATCH", body: JSON.stringify({ plan_code: code }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "Não foi possível trocar de plano.");
        return;
      }
      if (onChanged) onChanged();
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setSaving("");
    }
  }

  async function saveBillingProfile(event) {
    event.preventDefault();
    setError("");
    setSavingProfile(true);
    try {
      const response = await apiFetch("/billing/profile", {
        method: "PUT",
        body: JSON.stringify(billingForm)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error || "Não foi possível salvar os dados de cobrança.");
      setBilling((current) => current ? { ...current, billing_profile: payload } : current);
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function startCheckout(planCode) {
    if (checkingOut) return;
    if (!billing?.gateway_enabled) return setError("Pagamento online ainda não está configurado.");
    if (!billingProfile?.complete) return setError("Informe o CPF/CNPJ e o e-mail de cobrança antes de contratar.");
    setCheckingOut(planCode);
    setError("");
    try {
      const idempotencyKey = globalThis.crypto?.randomUUID?.() || `subscription-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const response = await apiFetch("/billing/checkout", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ plan_code: planCode, billing_type: billingMethod })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error || "Não foi possível iniciar a contratação.");
      if (payload.checkout_url) {
        window.location.assign(payload.checkout_url);
        return;
      }
      await loadBilling();
      if (billingMethod === "PIX") {
        const refreshed = await apiFetch("/billing/invoices?limit=1&offset=0");
        const page = refreshed.ok ? await refreshed.json() : {};
        const invoice = asArray(page?.items ?? page)[0];
        if (invoice?.id) await openPix(invoice.id);
        else setError("Assinatura PIX criada. A primeira cobrança aparecerá em instantes.");
      }
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setCheckingOut("");
    }
  }

  async function openPix(invoiceId) {
    setLoadingPix(invoiceId);
    setError("");
    try {
      const response = await apiFetch(`/billing/invoices/${invoiceId}/pix`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error || "Não foi possível gerar o PIX.");
      setPixPayment(payload);
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setLoadingPix(0);
    }
  }

  async function copyPix() {
    if (!pixPayment?.payload) return;
    await navigator.clipboard.writeText(pixPayment.payload);
  }

  async function cancelSubscription() {
    setCanceling(true);
    setError("");
    try {
      const response = await apiFetch("/billing/subscription/cancel", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error || "Não foi possível cancelar a assinatura.");
      setCancelOpen(false);
      await loadBilling();
      await onChanged?.();
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setCanceling(false);
    }
  }

  return (
    <div className="stack myplan">
      <section className="panel">
        <div className="panel-heading">
          <h2>Seu plano atual</h2>
          <span>{currentPlan ? currentPlan.name : "—"}</span>
        </div>
        <div className={`plan-status ${isInactive ? "danger" : isTrial ? "warn" : "ok"}`}>
          {isInactive
            ? "Sua assinatura está inativa. Regularize uma fatura ou contrate um plano para continuar."
            : status === "overdue"
              ? `Pagamento pendente. O acesso permanece liberado por mais ${Number(subscription?.grace_days_left || 0)} dia(s).`
            : isTrial
              ? `Teste grátis: ${daysLeft} dia(s) restante(s).`
              : "Assinatura ativa."}
        </div>
        {error && <span className="form-error">{error}</span>}
      </section>

      {billing && !billing.gateway_enabled && (
        <section className="panel myplan-billing-notice">
          <strong>Pagamento online indisponível</strong>
          <p>A cobrança automática ainda não está configurada. Fale com a Monitence para concluir a contratação.</p>
        </section>
      )}

      {billing?.gateway_enabled && !billingProfile?.complete && (
        <section className="panel myplan-billing-profile">
          <div className="panel-heading">
            <div><h2>Dados para pagamento</h2><span>O Asaas exige documento e e-mail para emitir e avisar sobre as faturas.</span></div>
          </div>
          <form className="form-grid" onSubmit={saveBillingProfile}>
            <Input label="CPF ou CNPJ" required value={billingForm.tax_id} onChange={(tax_id) => setBillingForm((current) => ({ ...current, tax_id }))} placeholder="Somente números" inputMode="numeric" />
            <Input label="E-mail para cobrança" type="email" required value={billingForm.email} onChange={(email) => setBillingForm((current) => ({ ...current, email }))} placeholder="financeiro@clinica.com" />
            <Input label="Telefone" value={billingForm.phone} onChange={(phone) => setBillingForm((current) => ({ ...current, phone }))} placeholder="(00) 00000-0000" inputMode="tel" />
            <div className="myplan-billing-action"><Button type="submit" disabled={savingProfile}>{savingProfile ? "Salvando…" : "Continuar para pagamento"}</Button></div>
          </form>
        </section>
      )}

      {billing?.gateway_enabled && billingProfile?.complete && checkoutAvailable && (
        <section className="panel myplan-payment-method">
          <div className="panel-heading">
            <div><h2>Forma de pagamento</h2><span>Boleto não é oferecido. Escolha cartão recorrente ou PIX mensal.</span></div>
          </div>
          <div className="myplan-method-grid" role="radiogroup" aria-label="Forma de pagamento">
            <Button variant={billingMethod === "CREDIT_CARD" ? "primary" : "secondary"} onClick={() => setBillingMethod("CREDIT_CARD")} aria-pressed={billingMethod === "CREDIT_CARD"}>
              <CreditCard size={18} /> Cartão recorrente
            </Button>
            <Button variant={billingMethod === "PIX" ? "primary" : "secondary"} onClick={() => setBillingMethod("PIX")} aria-pressed={billingMethod === "PIX"}>
              <QrCode size={18} /> PIX mensal
            </Button>
          </div>
          <p className="myplan-method-note">
            {billingMethod === "CREDIT_CARD"
              ? "Os dados do cartão são preenchidos no ambiente seguro do Asaas. A renovação é automática e pode ser cancelada."
              : "A cada mês o Asaas emite um novo PIX. Após o vencimento há 5 dias de carência antes do bloqueio."}
          </p>
        </section>
      )}

      <section className="panel">
        <div className="panel-heading">
          <h2><Sparkles size={16} /> Trocar de plano</h2>
          <span>{isTrial ? "Durante o teste, a troca é imediata." : "Planos contratados são alterados com apoio do suporte para ajustar a cobrança."}</span>
        </div>
        <div className="plan-grid">
          {list.map((plan) => {
            const active = plan.code === currentCode;
            return (
              <div key={plan.code} className={`plan-card ${active ? "active" : ""} ${plan.highlight || plan.is_recommended ? "recommended" : ""}`}>
                {(plan.badge || plan.is_recommended) && <span className="plan-badge">{plan.badge || "Mais recomendado"}</span>}
                <strong>{plan.name}</strong>
                <b>{currency.format(Number(plan.price_cents || 0) / 100)}<small>/mês</small></b>
                <em>{plan.audience}</em>
                <ul>{asArray(plan.features).slice(0, 8).map((feature) => (
                  <li key={feature}><CheckCircle2 size={13} /> {featureLabels[feature] || feature}</li>
                ))}</ul>
                {checkoutAvailable ? (
                  <Button disabled={checkingOut === plan.code} onClick={() => startCheckout(plan.code)}>
                    {checkingOut === plan.code ? "Abrindo pagamento…" : active ? "Contratar agora" : "Contratar este plano"}
                  </Button>
                ) : (
                  <Button
                    variant={active ? "secondary" : "primary"}
                    disabled={active || saving === plan.code}
                    onClick={() => changePlan(plan.code)}
                  >
                    {active ? "Plano atual" : saving === plan.code ? "Trocando…" : "Escolher"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {billing?.subscription?.asaas_subscription_id || invoices.length ? (
        <section className="panel myplan-invoices">
          <div className="panel-heading">
            <div><h2><ReceiptText size={18} /> Faturas</h2><span>Pagas, pendentes e vencidas são sincronizadas com o Asaas.</span></div>
            {billing?.subscription?.asaas_subscription_id && billing?.subscription?.status !== "canceled" && (
              <Button variant="secondary" onClick={() => setCancelOpen(true)}>Cancelar recorrência</Button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Vencimento</th><th>Valor</th><th>Forma</th><th>Status</th><th>Ação</th></tr></thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{displayDate(invoice.due_date)}</td>
                    <td>{currency.format(Number(invoice.amount || 0))}</td>
                    <td>{invoice.billing_type === "CREDIT_CARD" ? "Cartão" : invoice.billing_type || "—"}</td>
                    <td><span className={`status-badge invoice-${invoice.status}`}>{invoiceLabels[invoice.status] || invoice.status}</span></td>
                    <td>
                      {invoice.billing_type === "PIX" && ["pendente", "atrasada"].includes(invoice.status) ? (
                        <Button variant="secondary" disabled={loadingPix === invoice.id} onClick={() => openPix(invoice.id)}>
                          <QrCode size={16} /> {loadingPix === invoice.id ? "Abrindo…" : "Pagar com PIX"}
                        </Button>
                      ) : invoice.invoice_url && ["pendente", "atrasada"].includes(invoice.status) ? (
                        <Button variant="secondary" onClick={() => window.open(invoice.invoice_url, "_blank", "noopener,noreferrer")}>Abrir no Asaas</Button>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="myplan-schedule-heading"><strong>Próximos 12 meses</strong><span>Previsão — o Asaas emite cada cobrança mais perto do vencimento.</span></div>
          <div className="myplan-schedule-grid">
            {schedule.map((item) => (
              <article key={item.id || item.due_date} className={item.kind === "actual" ? "issued" : "projected"}>
                <span>{displayDate(item.due_date)}</span>
                <strong>{currency.format(Number(item.amount || 0))}</strong>
                <small>{item.kind === "actual" ? invoiceLabels[item.status] || item.status : "Previsão"}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <Modal
        open={Boolean(pixPayment)}
        title="Pagar fatura com PIX"
        subtitle="A confirmação chega automaticamente pelo Asaas."
        onClose={() => setPixPayment(null)}
        size="sm"
        footer={<Button variant="secondary" onClick={() => setPixPayment(null)}>Fechar</Button>}
      >
        <div className="myplan-pix-modal">
          {pixPayment?.encoded_image && <img src={`data:image/png;base64,${pixPayment.encoded_image}`} alt="QR Code PIX" />}
          <strong>{currency.format(Number(pixPayment?.invoice?.amount || 0))}</strong>
          <span>Vencimento em {displayDate(pixPayment?.invoice?.due_date)}</span>
          {pixPayment?.payload && <><code>{pixPayment.payload}</code><Button onClick={copyPix}><Copy size={16} /> Copiar código PIX</Button></>}
        </div>
      </Modal>

      <Modal
        open={cancelOpen}
        title="Cancelar recorrência"
        subtitle="O Asaas deixará de emitir as próximas cobranças."
        onClose={() => setCancelOpen(false)}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={canceling}>Voltar</Button><Button variant="danger" onClick={cancelSubscription} disabled={canceling}>{canceling ? "Cancelando…" : "Confirmar cancelamento"}</Button></>}
      >
        <p>O acesso ao sistema será encerrado com o cancelamento. Faturas já emitidas permanecem no histórico.</p>
      </Modal>
    </div>
  );
}
