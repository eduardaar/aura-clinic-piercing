import React, { useCallback, useEffect, useState } from "react";
import { ChevronRight, LogOut } from "lucide-react";
import { Modal, CrudHeader, DataTable } from "../../components/common/Crud";
import { API } from "../../lib/api";
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

function tenantCreatedAt(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("pt-BR");
}

export function PlatformAdmin() {
  const [session, setSession] = useState(readPlatformSession);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [tenants, setTenants] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_TENANT_FORM);
  const [createError, setCreateError] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

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

  async function removeTenant(tenant) {
    setActionError("");
    const confirmation = window.prompt(
      `Excluir a clínica "${tenant.name}" apaga todos os dados dela.\nDigite o código (${tenant.slug}) para confirmar:`
    );
    if (confirmation === null) return;
    if (confirmation.trim() !== tenant.slug) {
      setActionError("Exclusão cancelada: o código digitado não confere.");
      return;
    }
    try {
      const response = await platformFetch(`/platform/tenants/${tenant.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation: confirmation.trim() }),
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

  // Sem sessão de plataforma: formulário de login do super-admin.
  if (!token) {
    return (
      <main className="login-screen">
        <section className="login-panel">
          <header className="login-brand">
            <div className="login-monogram" aria-hidden="true">AC</div>
            <div>
              <strong>Aura Clinic</strong>
              <span>Plataforma</span>
            </div>
          </header>

          <div className="login-copy">
            <span className="login-kicker">Super-admin</span>
            <h1>Painel da plataforma</h1>
            <p>Acesso restrito à administração do SaaS: clínicas, planos e métricas.</p>
          </div>

          <form className="login-form" onSubmit={submitLogin}>
            <label>
              E-mail
              <input
                type="email"
                autoComplete="username"
                required
                value={loginForm.email}
                onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })}
                placeholder="admin@plataforma.com"
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                autoComplete="current-password"
                required
                value={loginForm.password}
                onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
                placeholder="Digite a senha"
              />
            </label>
            {loginError && <span className="form-error">{loginError}</span>}
            <button className="login-submit" disabled={loginLoading}>
              {loginLoading ? "Entrando…" : "Entrar na plataforma"} <ChevronRight size={18} />
            </button>
          </form>
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
          <button className="secondary-button" onClick={clearPlatformSession}>
            <LogOut size={16} /> Sair
          </button>
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

          {listError && <span className="form-error">{listError}</span>}
          {actionError && <span className="form-error">{actionError}</span>}

          {tenants === null && !listError ? (
            <p>Carregando clínicas…</p>
          ) : (
            <DataTable
              rows={tenantList}
              rowKey={(tenant) => tenant.id ?? tenant.slug}
              columns={[
                { key: "name", label: "Nome", render: (tenant) => tenant.name || "—" },
                { key: "slug", label: "Código", render: (tenant) => tenant.slug || "—" },
                { key: "status", label: "Status", render: (tenant) => (
                  <span className={`status-badge ${tenant.status === "suspenso" ? "status-cancelado" : "status-confirmado"}`}>
                    {tenant.status || "ativo"}
                  </span>
                ) },
                { key: "plan", label: "Plano", render: (tenant) => tenant.plan || "—" },
                { key: "created_at", label: "Criada em", render: (tenant) => tenantCreatedAt(tenant.created_at) },
              ]}
              actions={(tenant) => (
                <>
                  <button className="secondary-button" onClick={() => toggleStatus(tenant)}>
                    {tenant.status === "suspenso" ? "Reativar" : "Suspender"}
                  </button>
                  <button className="danger-button" onClick={() => removeTenant(tenant)}>Excluir</button>
                </>
              )}
              empty="Nenhuma clínica cadastrada até o momento."
            />
          )}
        </section>

        <Modal
          open={showCreate}
          title="Nova clínica"
          subtitle="Cadastro de clínica no SaaS"
          onClose={closeCreate}
          footer={(
            <>
              <button type="button" className="secondary-button" onClick={closeCreate}>Cancelar</button>
              <button type="submit" form="platform-tenant-form" className="primary-button" disabled={createLoading}>{createLoading ? "Criando…" : "Criar clínica"}</button>
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
              <span>Contagens reportadas pelo backend</span>
            </div>
            <div className="table-wrap">
              <table>
                <tbody>
                  {metricList.map((entry, index) => {
                    const row = entry && typeof entry === "object" ? entry : {};
                    const title = row.name || row.tenant_name || row.slug || row.tenant || `Clínica ${index + 1}`;
                    // Shape livre: renderizamos defensivamente todas as contagens numéricas.
                    const counts = Object.entries(row).filter(([key, value]) => typeof value === "number" && !["id", "tenant_id"].includes(key));
                    return (
                      <tr key={row.id ?? row.slug ?? index}>
                        <td><strong>{String(title)}</strong></td>
                        <td>
                          {counts.length === 0
                            ? "—"
                            : counts.map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`).join(" · ")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
