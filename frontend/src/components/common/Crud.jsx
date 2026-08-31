// Componentes compartilhados para padronizar o CRUD do sistema:
// - Modal: janela sobreposta (formulários abrem aqui, não mais inline).
// - CrudHeader: cabeçalho de página com título e botão "Novo".
// Reaproveitam o CSS existente (.modal-backdrop, .table-wrap, .panel-heading).
import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AlertTriangle, MoreHorizontal, Plus, X } from "lucide-react";

// Primitive compartilhado para menus específicos de páginas. Assim a camada
// comum continua sendo a única dependente diretamente do Radix.
export { DropdownMenu };

/**
 * Janela sobreposta. Fecha no Esc, no clique fora e trava o scroll do body.
 * @param {object} props
 * @param {boolean} props.open
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.subtitle]
 * @param {() => void} [props.onClose]
 * @param {React.ReactNode} [props.children]
 * @param {React.ReactNode} [props.footer] Botões do rodapé.
 * @param {"sm" | "md" | "lg"} [props.size] Mantido apenas por compatibilidade; todos os modais usam largura média.
 */
export function Modal({ open, title, subtitle, onClose, children, footer }) {
  return (
    <Dialog.Root open={Boolean(open)} onOpenChange={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop">
          <Dialog.Content className="modal-card modal-md">
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
 * @param {{ label: string, icon?: React.ComponentType<{size?: number}>, onClick: () => void }[]} [props.actions]
 *   Ações secundárias, agrupadas em "Mais opções" antes do botão principal.
 * @param {string} [props.actionLabel] Padrão: "Novo".
 * @param {() => void} [props.onAction] Sem ele, o botão de ação não é renderizado.
 */
export function CrudHeader({ title, subtitle, actions, actionLabel = "Novo", onAction }) {
  const extraActions = Array.isArray(actions) ? actions.filter(Boolean) : [];
  return (
    <div className="panel-heading crud-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <span>{subtitle}</span>}
      </div>
      {(extraActions.length > 0 || onAction) && (
        <div className="crud-header-actions">
          {extraActions.length > 0 && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="secondary-button crud-more-options" aria-label="Mais opções" title="Mais opções">
                <MoreHorizontal size={17} /> Mais opções
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="crud-options-popover" align="end" sideOffset={6}>
                  {extraActions.map(({ label, icon: Icon, onClick }) => (
                    <DropdownMenu.Item key={label} onSelect={onClick}>
                      {Icon && <Icon size={16} />} {label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          {onAction && (
            <button type="button" className="primary-button crud-new-button" onClick={onAction}>
              <Plus size={16} /> {actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Ações de uma linha de listagem. O padrão é sempre o menu de três pontos: a
// célula final fica alinhada e todas as ações (editar, excluir e extras) estão
// no mesmo lugar em qualquer tela.
//
// Cada ação: { label, onClick, href, target, rel, danger, disabled, primary }.
// Itens falsos são aceitos para simplificar ações condicionais no JSX.
export function RowActions({ actions = [] }) {
  const visible = actions.filter(Boolean);
  if (!visible.length) return null;

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
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="row-actions-more" aria-label="Mais ações" title="Mais ações"><MoreHorizontal size={18} /></DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="row-actions-popover" align="end" sideOffset={6}>
            {visible.map(renderMenuAction)}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
