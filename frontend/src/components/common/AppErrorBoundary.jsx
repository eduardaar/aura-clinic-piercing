import React from "react";

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Aura Clinic runtime error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="runtime-error-page">
          <section className="panel">
            <span className="eyebrow">Aura Clinic</span>
            <h1>Erro ao carregar esta área</h1>
            <p>Os dados ainda podem estar sendo preparados. Volte ao início e tente novamente.</p>
            <button type="button" className="primary-button" onClick={() => { window.location.href = "/"; }}>Voltar ao início</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
