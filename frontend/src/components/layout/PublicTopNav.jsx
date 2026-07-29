
import { BrandMark } from "../common/BrandMark";

// Menu de topo compartilhado pelas três telas públicas: landing ("/"),
// login e cadastro. É sempre o mesmo — só o conteúdo abaixo dele muda.
//
// `current` marca a tela atual (aria-current + destaque visual), para o menu
// não parecer que oferece um caminho onde o usuário já está.
export function PublicTopNav({ current }) {
  return (
    <header className="au-nav">
      <div className="au-nav-inner">
        <a className="au-nav-brand" href="/" aria-label="Aura — página inicial">
          <BrandMark size={34} className="au-nav-mark" />
          <strong>Aura</strong>
        </a>

        {/* Âncoras absolutas ("/#..."): a partir de /login e /cadastro elas
            precisam navegar até a landing antes de rolar até a seção. */}
        <nav className="au-nav-links" aria-label="Navegação principal">
          <a className="au-nav-link" href="/#recursos">Recursos</a>
          <a className="au-nav-link" href="/#planos">Planos</a>
        </nav>

        <div className="au-nav-actions">
          <a
            className="au-nav-login"
            href="/login"
            aria-current={current === "login" ? "page" : undefined}
          >
            Entrar
          </a>
          <a
            className="au-nav-cta"
            href="/cadastro"
            aria-current={current === "signup" ? "page" : undefined}
          >
            Começar grátis
          </a>
        </div>
      </div>
    </header>
  );
}
