// Componentes compartilhados para padronizar o CRUD do sistema:
// - Modal: janela sobreposta (formulários abrem aqui, não mais inline).
// - DataTable: lista/tabela padrão de registros, com ações por linha.
// - CrudHeader: cabeçalho de página com título e botão "Novo".
// Reaproveitam o CSS existente (.modal-backdrop, .table-wrap, .panel-heading).
import React, { useEffect, useState } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";

/**
 * Janela sobreposta. Fecha no Esc, no clique fora e trava o scroll do body.
 * @param {object} props
 * @param {boolean} props.open
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.subtitle]
 * @param {() => void} [props.onClose]
 * @param {React.ReactNode} [props.children]
 * @param {React.ReactNode} [props.footer] Botões do rodapé.
 * @param {"sm" | "md" | "lg"} [props.size] Padrão: "md".
 */
export function Modal({ open, title, subtitle, onClose, children, footer, size = "md" }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal-card modal-${size}`}
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <button type="button" className="modal-close" aria-label="Fechar" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}

// Modal de confirmação de exclusão: o usuário precisa DIGITAR a palavra de
// confirmação (padrão "sim") para habilitar o botão Excluir. Use em TODA exclusão.
// Uso típico:
//   const [deleting, setDeleting] = useState(null); // { message, run }
//   // no botão: onClick={() => setDeleting({ message: "Excluir X?", run: () => remove(x) })}
//   <ConfirmDeleteModal open={!!deleting} message={deleting?.message}
//     onClose={() => setDeleting(null)}
//     onConfirm={async () => { await deleting.run(); setDeleting(null); }} />
/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} [props.onClose]
 * @param {() => void | Promise<void>} props.onConfirm
 * @param {string} [props.title]
 * @param {React.ReactNode} [props.message]
 * @param {string} [props.confirmWord] Palavra que o usuário precisa digitar. Padrão: "sim".
 * @param {boolean} [props.loading] Estado de carregamento controlado por fora.
 */
export function ConfirmDeleteModal({
  open,
  onClose,
  onConfirm,
  title = "Confirmar exclusão",
  message,
  confirmWord = "sim",
  loading = false,
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setText(""); setBusy(false); } }, [open]);

  const canConfirm = text.trim().toLowerCase() === String(confirmWord).toLowerCase();
  const isLoading = loading || busy;

  async function confirm() {
    if (!canConfirm || isLoading) return;
    try {
      setBusy(true);
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      size="sm"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={isLoading}>Cancelar</button>
          <button type="button" className="danger-button" disabled={!canConfirm || isLoading} onClick={confirm}>
            {isLoading ? "Excluindo…" : "Excluir"}
          </button>
        </>
      )}
    >
      <div className="confirm-delete-body">
        <span className="confirm-delete-icon" aria-hidden="true"><AlertTriangle size={22} /></span>
        <p className="confirm-delete-message">{message || "Esta ação é permanente e não pode ser desfeita."}</p>
      </div>
      <label className="confirm-delete-field">
        Digite <strong>{confirmWord}</strong> para confirmar
        <input
          type="text"
          value={text}
          autoFocus
          autoComplete="off"
          placeholder={confirmWord}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") confirm(); }}
        />
      </label>
    </Modal>
  );
}

/**
 * @param {object} props
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.subtitle]
 * @param {string} [props.actionLabel] Padrão: "Novo".
 * @param {() => void} [props.onAction] Sem ele, o botão de ação não é renderizado.
 */
export function CrudHeader({ title, subtitle, actionLabel = "Novo", onAction }) {
  return (
    <div className="panel-heading crud-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <span>{subtitle}</span>}
      </div>
      {onAction && (
        <button type="button" className="primary-button crud-new-button" onClick={onAction}>
          <Plus size={16} /> {actionLabel}
        </button>
      )}
    </div>
  );
}

// Tabela nua, sem busca/filtro/ordenação/paginação. Para listagem nova prefira
// o `DataView` — este componente permanece para as telas ainda não migradas.
/**
 * @param {object} props
 * @param {Array<Pick<import("./DataView.jsx").ColumnDef, "key" | "label" | "render" | "align">>} props.columns
 *   Só estas quatro chaves têm efeito aqui: sem ordenação e sem busca, `value`,
 *   `sortable` e `searchable` do `DataView` seriam ignorados em silêncio.
 * @param {import("./DataView.jsx").Row[]} [props.rows]
 * @param {(row: import("./DataView.jsx").Row) => React.ReactNode} [props.actions]
 * @param {(row: import("./DataView.jsx").Row) => React.Key} [props.rowKey] Padrão: `row.id`.
 * @param {string} [props.empty]
 */
export function DataTable({ columns, rows = [], actions, rowKey = (row) => row.id, empty = "Nenhum registro cadastrado ainda." }) {
  if (!rows || rows.length === 0) {
    return <div className="data-empty">{empty}</div>;
  }
  return (
    <div className="table-wrap data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.align ? { textAlign: col.align } : undefined}>{col.label}</th>
            ))}
            {actions && <th className="data-table-actions-head" aria-label="Ações" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.key} data-label={col.label} style={col.align ? { textAlign: col.align } : undefined}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
              {actions && <td className="table-actions" data-label="Ações">{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
