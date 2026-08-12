import { useEffect, useState } from "react";
import { Check, Palette, UserRound } from "lucide-react";
import { Button, Input } from "../../components/common/Ui";
import { apiFetch } from "../../lib/api";
import { UI_THEMES } from "../../lib/uiTheme";
import { roleLabel } from "../shared/helpers";

export function Settings({ user, theme, onThemeChange, navCollapsed, onNavCollapsedChange, onUserChanged }) {
  const [profile, setProfile] = useState({ name: user?.name || "", email: user?.email || "" });
  const [password, setPassword] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setProfile({ name: user?.name || "", email: user?.email || "" }), [user?.name, user?.email]);

  async function saveProfile(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password.new_password && password.new_password !== password.confirm_password) {
      return setError("A confirmação da nova senha não confere.");
    }
    setSaving(true);
    try {
      const response = await apiFetch("/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profile.name,
          email: profile.email,
          ...(password.new_password ? { current_password: password.current_password, new_password: password.new_password } : {})
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return setError(payload.error || "Não foi possível salvar suas configurações.");
      onUserChanged?.(payload.user);
      setPassword({ current_password: "", new_password: "", confirm_password: "" });
      setMessage("Configurações da conta salvas.");
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-page stack">
      <div className="panel settings-intro">
        <span className="settings-icon"><Palette size={22} /></span>
        <div><h2>Preferências pessoais</h2><p>Estas escolhas valem somente para a sua conta e não alteram o catálogo público da clínica.</p></div>
      </div>

      <div className="panel">
        <div className="panel-heading"><div><h2>Aparência do sistema</h2><span>Escolha a paleta que fica mais confortável para o seu trabalho.</span></div></div>
        <div className="theme-choice-grid" role="radiogroup" aria-label="Tema do sistema">
          {UI_THEMES.map((item) => {
            const active = theme === item.id;
            return <button type="button" key={item.id} className={`theme-choice ${active ? "active" : ""}`} role="radio" aria-checked={active} onClick={() => onThemeChange(item.id)}>
              <span className="theme-choice-swatches" aria-hidden="true">{item.swatches.map((color) => <i key={color} style={{ background: color }} />)}</span>
              <strong>{item.name}</strong><small>{item.description}</small>
              {active && <em><Check size={15} /> Em uso</em>}
            </button>;
          })}
        </div>
        <label className="settings-toggle"><input type="checkbox" checked={navCollapsed} onChange={(event) => onNavCollapsedChange(event.target.checked)} /> <span><strong>Menu lateral compacto</strong><small>Deixa mais espaço livre para tabelas e relatórios.</small></span></label>
      </div>

      <div className="panel settings-account">
        <div className="panel-heading"><div><h2>Sua conta</h2><span>Atualize seus dados de acesso. Seu nível atual é {roleLabel(user?.role)}.</span></div><UserRound size={22} /></div>
        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-success">{message}</p>}
        <form className="settings-form" onSubmit={saveProfile}>
          <Input label="Nome" value={profile.name} required onChange={(value) => setProfile({ ...profile, name: value })} />
          <Input label="E-mail" type="email" value={profile.email} required onChange={(value) => setProfile({ ...profile, email: value })} />
          <div className="settings-form-section"><strong>Alterar senha</strong><span>Preencha apenas se quiser trocar sua senha agora.</span></div>
          <Input label="Senha atual" type="password" value={password.current_password} onChange={(value) => setPassword({ ...password, current_password: value })} />
          <Input label="Nova senha" type="password" value={password.new_password} onChange={(value) => setPassword({ ...password, new_password: value })} />
          <Input label="Confirmar nova senha" type="password" value={password.confirm_password} onChange={(value) => setPassword({ ...password, confirm_password: value })} />
          <div className="settings-form-actions"><Button type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar configurações"}</Button></div>
        </form>
      </div>
    </section>
  );
}
