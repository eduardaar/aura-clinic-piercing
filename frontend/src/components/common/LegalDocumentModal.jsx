import { useEffect, useState } from "react";
import { API } from "../../lib/api";
import { asArray } from "../../lib/utils";
import { Modal } from "./Crud";

/**
 * Busca os documentos legais publicados (Termos de Uso, Política de
 * Privacidade). Compartilhado entre quem só exibe o conteúdo (rodapé
 * público) e quem também precisa validar o aceite (cadastro).
 */
export function useLegalDocuments() {
  const [documents, setDocuments] = useState([]);
  useEffect(() => {
    let active = true;
    fetch(`${API}/legal-documents`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((payload) => {
        if (active) setDocuments(asArray(payload.documents));
      })
      .catch(() => {
        if (active) setDocuments([]);
      });
    return () => { active = false; };
  }, []);
  return documents;
}

/**
 * Modal padrão de documento legal — mesmo visual em toda a plataforma
 * (landing, login, cadastro): título, versão e conteúdo em parágrafos.
 * `documentKey` controla abertura ("terms_of_use" | "privacy_policy" | null).
 */
export function LegalDocumentModal({ documentKey, documents, onClose }) {
  const document = documents.find((item) => item.key === documentKey) || null;
  return (
    <Modal
      open={Boolean(documentKey)}
      title={document?.title || "Documento legal"}
      subtitle={document?.version ? `Versão ${document.version}` : undefined}
      size="lg"
      onClose={onClose}
    >
      <div className="au-a-legal-modal-content">
        {String(document?.content || "Este documento está sendo carregado. Tente novamente em instantes.")
          .split(/\n\s*\n/)
          .filter(Boolean)
          .map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>
    </Modal>
  );
}
