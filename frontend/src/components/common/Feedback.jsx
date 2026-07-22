import React from "react";

export function Loading() {
  return <div className="loading">Carregando...</div>;
}

export function ApiError({ message }) {
  return (
    <section className="panel erp-error">
      <span className="eyebrow">Aura</span>
      <h2>Não foi possível carregar os dados.</h2>
      <p>{message || "Tente atualizar a página ou entrar novamente."}</p>
    </section>
  );
}
