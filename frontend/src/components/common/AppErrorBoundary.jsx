import React from "react";
import { isStaleChunkError, reloadOnceForStaleChunk, reportError } from "../../lib/errorReporter";

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    const message = error?.message || "Erro de renderização (React)";
    console.error("Aura Clinic runtime error:", error, info);
    reportError({
      message,
      stack: error?.stack,
      context: { componentStack: info?.componentStack, boundary: "AppErrorBoundary" }
    });
    // Chunk defasado por deploy: a tela de falha não ajuda o usuário, que só
    // precisa do index.html novo. O relato já foi enviado com keepalive.
    if (isStaleChunkError(message)) reloadOnceForStaleChunk();
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="runtime-error-page">
          <section className="panel">
            <span className="eyebrow">Aura</span>
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
