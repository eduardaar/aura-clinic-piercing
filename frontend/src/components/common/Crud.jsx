// Componentes compartilhados para padronizar o CRUD do sistema:
// - Modal: janela sobreposta (formulários abrem aqui, não mais inline).
// - DataTable: lista/tabela padrão de registros, com ações por linha.
// - CrudHeader: cabeçalho de página com título e botão "Novo".
// Reaproveitam o CSS existente (.modal-backdrop, .table-wrap, .panel-heading).
import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AlertTriangle, MoreHorizontal, Plus, X } from "lucide-react";

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
  return (
    <Dialog.Root open={Boolean(open)} onOpenChange={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop">
          <Dialog.Content className={`modal-card modal-${size}`}>
            <div className="modal-header">
              <div>
                <Dialog.Title>{title}</Dialog.Title>
                {subtitle && <Dialog.Description asChild><span>{subtitle}</span></Dialog.Description>}
              </div>
              <Dialog.Close asChild>
                <button type="button" className="modal-close" aria-label="Fechar"><X size={18} /></button>
              </Dialog.Close>
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-actions">{footer}</div>}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Modal de confirmação de exclusão: o usuário precisa DIGITAR a palavra de
// confirmação (padrão "SIM") para habilitar o botão Excluir. Use em TODA exclusão.
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
 * @param {string} [props.confirmWord] Palavra que o usuário precisa digitar. Padrão: "SIM".
 * @param {boolean} [props.loading] Estado de carregamento controlado por fora.
 */
export function ConfirmDeleteModal({
  open,
  onClose,
  onConfirm,
  title = "Confirmar exclusão",
  message,
  confirmWord = "SIM",
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

// Ações de uma linha de listagem. A primeira ação marcada como `primary` (ou a
// primeira não destrutiva) fica visível; o restante fica no mesmo menu em todas
// as telas. Isso evita quatro botões espremidos na tabela, especialmente no
// celular, e preserva a hierarquia: editar/operar antes de excluir.
//
// Cada ação: { label, onClick, href, target, rel, danger, disabled, primary }.
// Itens falsos são aceitos para simplificar ações condicionais no JSX.
export function RowActions({ actions = [], menuOnly = false }) {
  const visible = actions.filter(Boolean);
  if (!visible.length) return null;
  const primaryIndex = visible.findIndex((action) => action.primary) >= 0
    ? visible.findIndex((action) => action.primary)
    : visible.findIndex((action) => !action.danger);
  const safePrimaryIndex = primaryIndex >= 0 ? primaryIndex : 0;
  const primary = visible[safePrimaryIndex];
  const secondary = visible.filter((_, index) => index !== safePrimaryIndex);

  const renderAction = (action, className = "") => action.href ? (
    <a key={action.label} className={className} href={action.href} target={action.target} rel={action.rel}>{action.label}</a>
  ) : (
    <button key={action.label} type="button" className={className} onClick={action.onClick} disabled={action.disabled}>{action.label}</button>
  );

  const renderMenuAction = (action) => action.href ? (
    <DropdownMenu.Item key={action.label} className={action.danger ? "danger" : ""} asChild>
      <a href={action.href} target={action.target} rel={action.rel}>{action.label}</a>
    </DropdownMenu.Item>
  ) : (
    <DropdownMenu.Item
      key={action.label}
      className={action.danger ? "danger" : ""}
      disabled={action.disabled}
      onSelect={() => action.onClick?.()}
    >
      {action.label}
    </DropdownMenu.Item>
  );

  return (
    <div className="row-actions-menu">
      {!menuOnly && renderAction(primary, "row-action-primary")}
      {(menuOnly || secondary.length > 0) && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="row-actions-more" aria-label="Mais ações" title="Mais ações"><MoreHorizontal size={18} /></DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="row-actions-popover" align="end" sideOffset={6}>
              {(menuOnly ? visible : secondary).map(renderMenuAction)}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
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
