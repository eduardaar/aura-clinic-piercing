import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Eye, EyeOff, LogOut } from "lucide-react";
import { Button, StatusBadge } from "../../components/common/Ui";
import { Modal, CrudHeader, ConfirmDeleteModal } from "../../components/common/Crud";
import { DataView } from "../../components/common/DataView";
import { API } from "../../lib/api";
import { BrandMark } from "../../components/common/BrandMark";
import { asArray } from "../../lib/utils";

// Painel do super-admin da plataforma (/plataforma).
// Sessão própria em aura-platform-session (separada da aura-session das clínicas)
// e fetch próprio com o token de plataforma — sem header X-Tenant.
const PLATFORM_SESSION_KEY = "aura-platform-session";

function readPlatformSession() {
  try {
    return JSON.parse(localStorage.getItem(PLATFORM_SESSION_KEY) || "null");
  } catch {
    localStorage.removeItem(PLATFORM_SESSION_KEY);
    return null;
  }
}

const EMPTY_TENANT_FORM = { name: "", slug: "", admin_name: "", admin_email: "", admin_password: "" };

// Data com ano: `formatDate` de lib/utils devolve dd/MM, e a lista mistura
// clínicas cadastradas em anos diferentes.
function tenantCreatedAt(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("pt-BR");
}

// Códigos de plano vindos do backend. Um código desconhecido (base antiga, plano
// novo) ainda aparece, só que capitalizado — melhor do que sumir da coluna.
const PLAN_LABELS = {
  essencial: "Essencial",
  start: "Start",
  profissional: "Profissional",
  studio: "Studio",
  premium: "Premium",
  padrao: "Padrão",
};

const planLabel = (plan) => {
  const code = String(plan || "").trim();
  if (!code) return "—";
  return PLAN_LABELS[code] || code[0].toUpperCase() + code.slice(1);
};

// O backend guarda o status da assinatura em código; a coluna mostrava o código.
const SUBSCRIPTION_LABELS = {
  trial_active: "Em teste",
  trial_expired: "Teste expirado",
  active: "Ativa",
  overdue: "Em atraso",
  canceled: "Cancelada",
  suspended: "Suspensa",
};

const subscriptionLabel = (tenant) => {
  const status = tenant.subscription_status || "trial_active";
  const label = SUBSCRIPTION_LABELS[status] || status;
  return status === "trial_active" ? `${label} · ${tenant.subscription_days_left ?? 0} dia(s)` : label;
};

// Opções vindas das próprias clínicas: oferecer um plano que ninguém assina só
// produz filtro que devolve lista vazia.
const planOptions = (tenants) =>
  [...new Set(tenants.map((tenant) => tenant.plan).filter(Boolean))]
    .sort()
    .map((plan) => ({ value: plan, label: planLabel(plan) }));

export function PlatformAdmin() {
  const [session, setSession] = useState(readPlatformSession);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [tenants, setTenants] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_TENANT_FORM);
  const [createError, setCreateError] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const token = session?.token || "";

  function clearPlatformSession() {
    localStorage.removeItem(PLATFORM_SESSION_KEY);
    setSession(null);
    setTenants(null);
    setMetrics(null);
  }

  // Fetch da plataforma: Bearer do token de plataforma, sem X-Tenant.
  const platformFetch = useCallback(async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${API}${path}`, { ...options, headers });
    if (response.status === 401) {
      // Token de plataforma expirado/inválido: volta ao formulário de login.
      localStorage.removeItem(PLATFORM_SESSION_KEY);
      setSession(null);
      setTenants(null);
      setMetrics(null);
    }
    return response;
  }, [token]);

  function openCreate() {
    setCreateForm(EMPTY_TENANT_FORM);
    setCreateError("");
    setShowCreate(true);
  }

  function closeCreate() {
    setShowCreate(false);
    setCreateError("");
  }

  const loadTenants = useCallback(async () => {
    setListError("");
    try {
      const response = await platformFetch("/platform/tenants");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status !== 401) setListError(payload?.error || "Não foi possível carregar as clínicas.");
        return;
      }
      setTenants(asArray(payload));
    } catch {
      setListError("Não foi possível conectar ao servidor.");
    }
    // Métricas são opcionais: se falharem, ignoramos silenciosamente.
    try {
      const response = await platformFetch("/platform/metrics");
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        setMetrics(asArray(payload));
      }
    } catch {
      // Sem métricas disponíveis.
    }
  }, [platformFetch]);

  useEffect(() => {
    if (token) loadTenants();
  }, [token, loadTenants]);

  async function submitLogin(event) {
    event.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const response = await fetch(`${API}/platform/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginForm.email.trim(), password: loginForm.password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoginError(payload.error || "E-mail ou senha incorretos.");
        return;
      }
      const nextSession = { token: payload.token, user: payload.user };
      localStorage.setItem(PLATFORM_SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      setLoginForm({ email: "", password: "" });
    } catch {
      setLoginError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function submitCreate(event) {
    event.preventDefault();
    setCreateError("");
    const slug = createForm.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setCreateError("Código inválido: use apenas letras minúsculas, números e hífens.");
      return;
    }
    if (createForm.admin_password.length < 8) {
      setCreateError("A senha do administrador deve ter pelo menos 8 caracteres.");
      return;
    }
    setCreateLoading(true);
    try {
      const response = await platformFetch("/platform/tenants", {
        method: "POST",
        body: JSON.stringify({
          name: createForm.name.trim(),
          slug,
          admin_name: createForm.admin_name.trim() || undefined,
          admin_email: createForm.admin_email.trim(),
          admin_password: createForm.admin_password,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status !== 401) setCreateError(payload.error || "Não foi possível criar a clínica.");
        return;
      }
      setCreateForm(EMPTY_TENANT_FORM);
      setShowCreate(false);
      loadTenants();
    } catch {
      setCreateError("Não foi possível conectar ao servidor.");
    } finally {
      setCreateLoading(false);
    }
  }

  async function toggleStatus(tenant) {
    setActionError("");
    const nextStatus = tenant.status === "suspenso" ? "ativo" : "suspenso";
    try {
      const response = await platformFetch(`/platform/tenants/${tenant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status !== 401) setActionError(payload.error || "Não foi possível atualizar o status da clínica.");
        return;
      }
      loadTenants();
    } catch {
      setActionError("Não foi possível conectar ao servidor.");
    }
  }

  async function activateOrRenewTenant(tenant) {
    setActionError("");
    try {
      const response = await platformFetch(`/platform/tenants/${tenant.id}/plan`, {
        method: "PATCH",
        body: JSON.stringify({ plan_code: tenant.plan || "profissional" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status !== 401) setActionError(payload.error || "Não foi possível ativar ou renovar a clínica.");
        return;
      }
      loadTenants();
    } catch {
      setActionError("Não foi possível conectar ao servidor.");
    }
  }

  function removeTenant(tenant) {
    setActionError("");
    setDeleting({
      message: `Excluir a clínica "${tenant.name}"? Isso remove TODOS os dados dela.`,
      confirmWord: tenant.slug,
      run: async () => {
        try {
          const response = await platformFetch(`/platform/tenants/${tenant.id}`, {
            method: "DELETE",
            body: JSON.stringify({ confirmation: tenant.slug }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            if (response.status !== 401) setActionError(payload.error || "Não foi possível excluir a clínica.");
            return;
          }
          loadTenants();
        } catch {
          setActionError("Não foi possível conectar ao servidor.");
        }
      }
    });
  }

  // Sem sessão: formulário de acesso.
  //
  // A tela é deliberadamente muda sobre o que existe atrás dela. Nada de
  // "super-admin", "plataforma" ou "administração do SaaS": quem cair aqui por
  // acaso não deve descobrir que achou o painel de controle do sistema. Sem
  // link para cadastro/login de clínica também — não interligar as telas evita
  // que uma leve à outra. A proteção real é a senha forte + o limite de 10
  // tentativas a cada 15 min no backend; o silêncio aqui é só uma camada a mais.
  if (!token) {
    return (
      <main className="au-a-root au-a-restricted">
        <section className="au-a-panel">
          <div className="au-a-inner">
            <header className="au-a-restricted-brand">
              <BrandMark size={40} title="" />
            </header>

            <h1 className="au-a-title">Acesso restrito</h1>

            <form className="au-a-form" onSubmit={submitLogin}>
              <div className="au-a-field">
                <label htmlFor="au-p-email">E-mail</label>
                <input
                  id="au-p-email"
                  className="au-a-input"
                  type="email"
                  autoComplete="username"
                  required
                  value={loginForm.email}
                  onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })}
                  placeholder="seu@email.com"
                />
              </div>

              <div className="au-a-field">
                <label htmlFor="au-p-password">Senha</label>
                <div className="au-a-pass">
                  <input
                    id="au-p-password"
                    className="au-a-input"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={loginForm.password}
                    onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
                    placeholder="Digite a senha"
                  />
                  <button
                    type="button"
                    className="au-a-eye"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </div>

              {loginError && <p className="au-a-error" role="alert">{loginError}</p>}

              <button type="submit" className="au-a-submit" disabled={loginLoading}>
                {loginLoading ? "Entrando…" : "Entrar"} <ChevronRight size={18} aria-hidden="true" />
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  const tenantList = asArray(tenants);
  const metricList = asArray(metrics);

  return (
    <main className="main-content">
      <header className="topbar">
        <div className="topbar-title">
          <span className="eyebrow">Aura Clinic · Plataforma</span>
          <h1>Clínicas</h1>
          <p>Gerencie as clínicas cadastradas no SaaS.</p>
        </div>
        <div className="topbar-actions">
          <Button variant="secondary" onClick={clearPlatformSession}>
            <LogOut size={16} /> Sair
          </Button>
        </div>
      </header>

      <div className="stack">
        <section className="panel">
          <CrudHeader
            title="Clínicas cadastradas"
            subtitle="Gerencie as clínicas cadastradas no SaaS"
            actionLabel="Nova clínica"
            onAction={openCreate}
          />

          {actionError && <span className="form-error">{actionError}</span>}

          <DataView
            rows={tenantList}
            rowKey={(tenant) => tenant.id ?? tenant.slug}
            loading={tenants === null && !listError}
            error={listError}
            defaultSort={{ key: "created_at", dir: "desc" }}
            searchPlaceholder="Buscar por nome ou código"
            filters={[
              {
                key: "status",
                label: "Status",
                type: "select",
                options: [
                  { value: "ativo", label: "Ativo" },
                  { value: "suspenso", label: "Suspenso" },
                ],
                match: (tenant, value) => (tenant.status || "ativo") === value,
              },
              {
                key: "plan",
                label: "Plano",
                type: "select",
                options: planOptions(tenantList),
                match: (tenant, value) => tenant.plan === value,
              },
            ]}
            columns={[
              { key: "name", label: "Nome", value: (tenant) => tenant.name || "", render: (tenant) => tenant.name || "—" },
              { key: "slug", label: "Código", value: (tenant) => tenant.slug || "", render: (tenant) => tenant.slug || "—" },
              {
                key: "status",
                label: "Status",
                value: (tenant) => tenant.status || "ativo",
                render: (tenant) => (
                  <StatusBadge status={tenant.status || "ativo"} tone={tenant.status === "suspenso" ? "danger" : "ok"} />
                ),
              },
              { key: "plan", label: "Plano", value: (tenant) => tenant.plan || "", render: (tenant) => planLabel(tenant.plan) },
              {
                key: "subscription",
                label: "Assinatura",
                value: subscriptionLabel,
                render: (tenant) => <span>{subscriptionLabel(tenant)}</span>,
              },
              {
                key: "created_at",
                label: "Criada em",
                // Ordena pelo ISO do backend; dd/MM/aaaa ordenaria por dia.
                value: (tenant) => String(tenant.created_at || ""),
                render: (tenant) => tenantCreatedAt(tenant.created_at),
              },
            ]}
            actions={(tenant) => (
              <>
                <button type="button" onClick={() => activateOrRenewTenant(tenant)}>Ativar/Renovar</button>
                <button type="button" onClick={() => toggleStatus(tenant)}>
                  {tenant.status === "suspenso" ? "Reativar" : "Suspender"}
                </button>
                <button type="button" onClick={() => removeTenant(tenant)}>Excluir</button>
              </>
            )}
            empty="Nenhuma clínica cadastrada até o momento."
            emptyFiltered="Nenhuma clínica corresponde aos filtros aplicados."
          />
        </section>

        <Modal
          open={showCreate}
          title="Nova clínica"
          subtitle="Cadastro de clínica no SaaS"
          onClose={closeCreate}
          footer={(
            <>
              <Button type="button" variant="secondary" onClick={closeCreate}>Cancelar</Button>
              <Button type="submit" form="platform-tenant-form" variant="primary" disabled={createLoading}>{createLoading ? "Criando…" : "Criar clínica"}</Button>
            </>
          )}
        >
          <form id="platform-tenant-form" onSubmit={submitCreate}>
            <div className="form-grid">
              <label>
                Nome da clínica
                <input type="text" required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} placeholder="ex.: Aura Clinic Piercing" />
              </label>
              <label>
                Código (slug)
                <input type="text" required value={createForm.slug} onChange={(event) => setCreateForm({ ...createForm, slug: event.target.value.toLowerCase() })} placeholder="ex.: aura" />
              </label>
              <label>
                Nome do responsável (opcional)
                <input type="text" value={createForm.admin_name} onChange={(event) => setCreateForm({ ...createForm, admin_name: event.target.value })} placeholder="ex.: Eduarda Santos" />
              </label>
              <label>
                E-mail do administrador
                <input type="email" required value={createForm.admin_email} onChange={(event) => setCreateForm({ ...createForm, admin_email: event.target.value })} placeholder="admin@clinica.com" />
              </label>
              <label>
                Senha do administrador (mín. 8)
                <input type="password" required minLength={8} value={createForm.admin_password} onChange={(event) => setCreateForm({ ...createForm, admin_password: event.target.value })} placeholder="Senha inicial" />
              </label>
            </div>
            {createError && <span className="form-error">{createError}</span>}
          </form>
        </Modal>

        {metricList.length > 0 && (
          <section className="panel">
            <div className="panel-heading">
              <h2>Métricas por clínica</h2>
              <span>Contagens das clínicas ativas</span>
            </div>
            {/*
              Antes eram duas colunas sem cabeçalho, a segunda montada por
              concatenação ("clients: 12 · appointments: 30"). O endpoint
              /platform/metrics tem shape fixo — id, name, slug, clients e
              appointments —, então a defensiva contra shape livre só custava:
              mostrava o nome cru do campo em inglês e impedia ordenar pela
              contagem, que é justamente a pergunta desta lista (quais clínicas
              estão maiores ou paradas). Com colunas de verdade, ordena.
            */}
            <DataView
              rows={metricList}
              rowKey={(row) => row.id ?? row.slug}
              defaultSort={{ key: "clients", dir: "desc" }}
              searchPlaceholder="Buscar por nome ou código"
              columns={[
                { key: "name", label: "Clínica", value: (row) => row.name || "", render: (row) => row.name || "—" },
                { key: "slug", label: "Código", value: (row) => row.slug || "", render: (row) => row.slug || "—" },
                {
                  key: "clients",
                  label: "Clientes",
                  align: "right",
                  searchable: false,
                  value: (row) => Number(row.clients || 0),
                  render: (row) => Number(row.clients || 0).toLocaleString("pt-BR"),
                },
                {
                  key: "appointments",
                  label: "Agendamentos",
                  align: "right",
                  searchable: false,
                  value: (row) => Number(row.appointments || 0),
                  render: (row) => Number(row.appointments || 0).toLocaleString("pt-BR"),
                },
              ]}
              empty="Nenhuma métrica disponível."
              emptyFiltered="Nenhuma clínica corresponde à busca."
            />
          </section>
        )}

        <ConfirmDeleteModal
          open={!!deleting}
          message={deleting?.message}
          confirmWord={deleting?.confirmWord}
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await deleting.run(); setDeleting(null); }}
        />
      </div>
    </main>
  );
}
