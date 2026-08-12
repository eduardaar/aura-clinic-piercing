import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Eye, EyeOff, LogOut } from "lucide-react";
import { Button } from "../../components/common/Ui";
import { Modal } from "../../components/common/Crud";
import { API } from "../../lib/api";
import { BrandMark } from "../../components/common/BrandMark";
import "../../styles/platform-panel.css";
import { LandingEditor } from "./LandingEditor";
import { PlansAdmin } from "./PlansAdmin";
import { AccountsAdmin } from "./AccountsAdmin";
import { SupportInbox, SupportOpenBadge } from "./SupportInbox";
// `PlatformFinance`, e não `FinanceAdmin`: features/finance/Finance.jsx já
// exporta um `FinanceAdmin` (o financeiro da CLÍNICA). Dois nomes iguais no
// mesmo grafo de imports é convite a montar a tela errada.
import { PlatformFinance } from "./FinanceAdmin";

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

// Áreas do painel. A landing é conteúdo público da plataforma, não cadastro de
// clínica: são duas tarefas distintas e cada uma tem sua aba.
const TABS = [
  ["dashboard", "Dashboard"],
  ["contas", "Clínicas"],
  ["planos", "Planos"],
  ["suporte", "Suporte"],
  ["landing", "Landing pública"],
];

const PLATFORM_BASE_PATH = "/plataforma";
const TAB_PATHS = Object.fromEntries(TABS.map(([id]) => [id, `${PLATFORM_BASE_PATH}/${id}`]));
const TAB_BY_PATH = Object.fromEntries(Object.entries(TAB_PATHS).map(([id, path]) => [path, id]));

function tabFromLocation(pathname = window.location.pathname) {
  return TAB_BY_PATH[pathname.replace(/\/$/, "")] || "dashboard";
}

const TAB_HEADINGS = {
  dashboard: { title: "Dashboard", subtitle: "Receita, caixa, cobranças e evolução financeira da plataforma." },
  contas: { title: "Clínicas", subtitle: "Cadastro, plano, assinatura, uso e faturas de cada cliente." },
  planos: { title: "Planos", subtitle: "Preço, recursos e limites dos planos vendidos pela plataforma." },
  suporte: { title: "Suporte", subtitle: "Chamados abertos pelas clínicas." },
  landing: { title: "Landing pública", subtitle: "Edite os blocos da página inicial em /." },
};

// Abas que guardam RASCUNHO não salvo continuam montadas (só ocultas) depois de
// abertas: desmontar jogaria fora o que alguém digitou e foi conferir outra
// coisa. As demais (contas, financeiro, suporte) podem desmontar — toda escrita
// nelas é imediata e confirmada em modal, não há nada a perder.
const ABAS_COM_RASCUNHO = ["landing", "planos"];

export function PlatformAdmin() {
  const [session, setSession] = useState(readPlatformSession);
  const [tab, setTab] = useState(tabFromLocation);
  const [accountsRefresh, setAccountsRefresh] = useState(0);
  const [visitadas, setVisitadas] = useState(() => new Set(ABAS_COM_RASCUNHO.includes(tabFromLocation()) ? [tabFromLocation()] : []));
  // Recarrega o contador de chamados abertos no selo da aba depois de o
  // super-admin responder algo.
  const [supportKey, setSupportKey] = useState(0);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_TENANT_FORM);
  const [createError, setCreateError] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const token = session?.token || "";

  function clearPlatformSession() {
    localStorage.removeItem(PLATFORM_SESSION_KEY);
    setSession(null);
  }

  // Fetch da plataforma: Bearer do token de plataforma, sem X-Tenant.
  const platformFetch = useCallback(async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    // FormData fica de fora: definir o Content-Type na mão apaga o `boundary`
    // que o navegador geraria, e sem ele o multer não consegue separar as
    // partes do multipart — o upload chega ao servidor como "nenhum arquivo
    // enviado". Mesma regra do `apiFetch` em lib/api.js.
    if (
      !(options.body instanceof FormData) &&
      options.body !== undefined &&
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${API}${path}`, { ...options, headers });
    if (response.status === 401) {
      // Token de plataforma expirado/inválido: volta ao formulário de login.
      localStorage.removeItem(PLATFORM_SESSION_KEY);
      setSession(null);
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

  // A plataforma não usa um roteador externo: ela controla só o seu namespace
  // com History API. Assim cada área ganha URL, recarregamento e voltar/avançar
  // sem tocar na navegação independente do painel das clínicas.
  const navigateTo = useCallback((nextTab, { replace = false } = {}) => {
    const safeTab = TAB_PATHS[nextTab] ? nextTab : "dashboard";
    const nextPath = TAB_PATHS[safeTab];
    if (window.location.pathname !== nextPath) {
      window.history[replace ? "replaceState" : "pushState"](window.history.state, "", nextPath);
    }
    setTab(safeTab);
    if (ABAS_COM_RASCUNHO.includes(safeTab)) {
      setVisitadas((current) => new Set(current).add(safeTab));
    }
  }, []);

  useEffect(() => {
    // /plataforma permanece como link compatível, mas a URL final sempre aponta
    // para a área efetivamente aberta.
    if (window.location.pathname === PLATFORM_BASE_PATH || !TAB_BY_PATH[window.location.pathname.replace(/\/$/, "")]) {
      navigateTo("dashboard", { replace: true });
    }

    const onPopState = () => {
      const nextTab = tabFromLocation();
      setTab(nextTab);
      if (ABAS_COM_RASCUNHO.includes(nextTab)) {
        setVisitadas((current) => new Set(current).add(nextTab));
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigateTo]);

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
      setAccountsRefresh((current) => current + 1);
    } catch {
      setCreateError("Não foi possível conectar ao servidor.");
    } finally {
      setCreateLoading(false);
    }
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

  return (
    <main className="main-content">
      <header className="topbar">
        <div className="topbar-title">
          <span className="eyebrow">Aura Clinic · Plataforma</span>
          <h1>{TAB_HEADINGS[tab].title}</h1>
          <p>{TAB_HEADINGS[tab].subtitle}</p>
        </div>
        <nav className="platform-tabs" aria-label="Áreas do painel">
          {TABS.map(([id, label]) => (
            <a
              key={id}
              href={TAB_PATHS[id]}
              className={tab === id ? "active" : ""}
              aria-current={tab === id ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigateTo(id);
              }}
            >
              {label}
              {id === "suporte" && (
                <SupportOpenBadge
                  token={token}
                  onUnauthorized={clearPlatformSession}
                  refreshKey={supportKey}
                />
              )}
            </a>
          ))}
          <button type="button" className="platform-logout" onClick={clearPlatformSession}>
            <LogOut size={16} aria-hidden="true" /> Sair
          </button>
        </nav>
      </header>

      {/* `.main-content` tem height:100dvh e overflow:hidden — no app da clínica
          quem rola é o filho `.content-scroll`. O painel usava `.main-content`
          direto, sem esse filho: tudo abaixo da dobra ficava CORTADO e
          inalcançável, sem barra de rolagem. */}
      <div className="content-scroll">
        <div className="stack">

        {visitadas.has("landing") && (
          <div hidden={tab !== "landing"}>
            <LandingEditor token={token} onUnauthorized={clearPlatformSession} />
          </div>
        )}

        {visitadas.has("planos") && (
          <div hidden={tab !== "planos"}>
            <PlansAdmin token={token} onUnauthorized={clearPlatformSession} />
          </div>
        )}

        {tab === "contas" && <AccountsAdmin token={token} onUnauthorized={clearPlatformSession} onCreate={openCreate} refreshKey={accountsRefresh} />}

        {tab === "dashboard" && <PlatformFinance token={token} onUnauthorized={clearPlatformSession} />}

        {tab === "suporte" && (
          <SupportInbox
            token={token}
            onUnauthorized={clearPlatformSession}
            onChanged={() => setSupportKey((k) => k + 1)}
          />
        )}

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

        </div>
      </div>
    </main>
  );
}
