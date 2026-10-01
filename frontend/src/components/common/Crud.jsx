// Componentes compartilhados para padronizar o CRUD do sistema:
// - Modal: janela sobreposta (formulários abrem aqui, não mais inline).
// - CrudHeader: cabeçalho de página com título e botão "Novo".
// Reaproveitam o CSS existente (.modal-backdrop, .table-wrap, .panel-heading).
import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AlertTriangle, MoreHorizontal, Plus, X } from "lucide-react";

// Primitive compartilhado para menus específicos de páginas. Assim a camada
// comum continua sendo a única dependente diretamente do Radix.
export { DropdownMenu };

// Camadas flutuantes que vivem FORA do conteúdo do diálogo no DOM (portais em
// document.body), mas pertencem a ele: a lista do seletor de joias e os
// popovers do Radix. Um clique nelas era lido como "clique fora" e fechava o
// modal no meio do preenchimento — a queixa de "fecha em determinados pontos
// dentro do próprio modal".
const FLOATING_SELECTOR = ".smart-combobox-list, [data-modal-floating], [data-radix-popper-content-wrapper]";
// Botões de rodapé que descartam o formulário. Interceptados só quando há
// alteração pendente; qualquer outro rótulo (Limpar, Aplicar, Voltar de etapa)
// segue direto. `data-modal-cancel` serve para rótulos fora desta lista.
const CANCEL_LABEL = /^(cancelar|fechar)$/i;
// Radix (Select, Checkbox, Switch) espelha o valor num campo escondido e
// dispara um `change` sintético nele — inclusive quando o estado muda por
// código, ao carregar dados no modal. Só conta como edição da pessoa se houve
// um gesto (toque, clique ou tecla) dentro do modal instantes antes.
const GESTURE_WINDOW_MS = 3000;
const TOGGLE_ROLES = "[role='checkbox'], [role='switch'], [role='radio'], [role='menuitemcheckbox'], [role='menuitemradio']";

const ModalContext = createContext(/** @type {null | { requestClose: () => void, markDirty: () => void, dirty: boolean, floatingContainer: HTMLElement | null }} */ (null));

/** Acesso ao modal envolvente: fechar respeitando a guarda e marcar alteração feita por código. */
export function useModal() {
  return useContext(ModalContext);
}

function outsideTarget(event) {
  const target = event?.detail?.originalEvent?.target || event?.target;
  return target instanceof Element ? target : null;
}

/**
 * Janela sobreposta. Trava o scroll do body e NÃO fecha no clique fora: quem
 * está preenchendo um formulário e esbarra no fundo não pode perder o que
 * digitou. Fecha pelo X, pelo Esc e pelos botões do rodapé; quando há
 * alteração não salva num formulário, qualquer uma dessas saídas pede
 * confirmação (Salvar, Sair sem salvar ou Continuar editando).
 * @param {object} props
 * @param {boolean} props.open
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.subtitle]
 * @param {() => void} [props.onClose]
 * @param {React.ReactNode} [props.children]
 * @param {React.ReactNode} [props.footer] Botões do rodapé.
 * @param {"sm" | "md" | "lg" | "workspace"} [props.size] Todos os modais usam a largura média
 *   (`modal-md`), exceto `"workspace"`: área de trabalho que ocupa quase a tela inteira
 *   no desktop (agendamento e finalização). "sm"/"lg" seguem aceitos só por compatibilidade.
 * @param {boolean} [props.dismissible] Permite fechar no clique fora (só para modais sem dados a perder).
 * @param {boolean} [props.confirmClose] `false` desliga a confirmação de saída.
 * @param {boolean} [props.dirty] Estado "com alterações" controlado por fora; sem ele, o modal detecta edições nos campos.
 * @param {string} [props.formId] Formulário a enviar no "Salvar" da confirmação; sem ele, o primeiro <form> do corpo.
 */
export function Modal({ open, title, subtitle, onClose, children, footer, size, dismissible = false, confirmClose = true, dirty: dirtyProp, formId }) {
  // A padronização da largura média é deliberada (05c806e9). A única exceção
  // nomeada é a área de trabalho do agendamento, que concentra itens, joias,
  // valores e finalização e precisa da tela inteira no desktop.
  const sizeClass = size === "workspace" ? "modal-workspace" : "modal-md";
  const bodyRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const continueRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const bypassGuard = useRef(false);
  const pendingLeave = useRef(/** @type {null | (() => void)} */ (null));
  const lastGestureAt = useRef(0);
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Onde camadas flutuantes (lista de joias, folhas inferiores) devem montar
  // quando abertas de dentro do modal: DENTRO do conteúdo do diálogo. Fora
  // dele o Radix trava o foco e os eventos de ponteiro, e a lista fica surda.
  const [floatingContainer, setFloatingContainer] = useState(/** @type {HTMLElement | null} */ (null));
  const guardTitleId = useId();
  const guardTextId = useId();

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setConfirming(false);
    pendingLeave.current = null;
  }, [open]);
  useEffect(() => { if (confirming) continueRef.current?.focus(); }, [confirming]);

  const findForm = useCallback(() => {
    if (formId) return document.getElementById(formId);
    return bodyRef.current?.querySelector("form") || null;
  }, [formId]);
  const hasForm = () => Boolean(findForm());
  const isDirty = dirtyProp !== undefined ? Boolean(dirtyProp) : touched;
  const guarded = () => confirmClose && isDirty && (dirtyProp !== undefined || hasForm());

  const markDirty = useCallback(() => setTouched(true), []);
  function requestClose() {
    if (guarded()) {
      pendingLeave.current = null;
      setConfirming(true);
      return;
    }
    onClose?.();
  }

  function recordGesture() {
    lastGestureAt.current = Date.now();
  }
  // Eventos de portais sobem pela árvore do React, não pela do DOM: digitar
  // num modal aninhado (anular ajuste, cancelar) chegava aqui e marcava ESTE
  // modal como alterado. O mesmo vale para painéis que gravam na hora
  // (ajustes de valor, indicador químico, comissão), marcados com
  // `data-modal-ignore-dirty`: o que se digita neles não fica pendente no
  // formulário do modal. Listas flutuantes do próprio modal seguem contando,
  // porque montam dentro do mesmo `.modal-card`.
  function ignoresDirty(event) {
    const target = event?.target instanceof Element ? event.target : null;
    if (!target) return false;
    const ownCard = bodyRef.current?.closest(".modal-card");
    const targetCard = target.closest(".modal-card");
    if (ownCard && targetCard && targetCard !== ownCard) return true;
    return Boolean(target.closest("[data-modal-ignore-dirty]"));
  }
  function onFieldInput(event) {
    if (ignoresDirty(event)) return;
    markDirty();
  }
  function onFieldChange(event) {
    if (ignoresDirty(event)) return;
    const target = event.target instanceof Element ? event.target : null;
    const mirrored = target?.getAttribute("aria-hidden") === "true";
    if (!mirrored || Date.now() - lastGestureAt.current < GESTURE_WINDOW_MS) markDirty();
  }
  function onBodyClick(event) {
    if (ignoresDirty(event)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(TOGGLE_ROLES)) markDirty();
  }

  function preventOutsideDismiss(event) {
    const target = outsideTarget(event);
    if (!dismissible || guarded() || target?.closest(FLOATING_SELECTOR)) event.preventDefault();
  }

  function guardFooterClick(event) {
    if (bypassGuard.current || !guarded()) return;
    const button = event.target instanceof Element ? event.target.closest("button, a") : null;
    if (!button || button.getAttribute("type") === "submit") return;
    const explicit = button.hasAttribute("data-modal-cancel");
    if (!explicit && !CANCEL_LABEL.test((button.textContent || "").trim())) return;
    event.preventDefault();
    event.stopPropagation();
    pendingLeave.current = () => {
      bypassGuard.current = true;
      try { /** @type {HTMLElement} */ (button).click(); } finally { bypassGuard.current = false; }
    };
    setConfirming(true);
  }

  function leaveWithoutSaving() {
    const leave = pendingLeave.current;
    pendingLeave.current = null;
    setConfirming(false);
    if (leave) leave();
    else onClose?.();
  }

  function saveAndLeave() {
    const form = /** @type {HTMLFormElement | null} */ (findForm());
    setConfirming(false);
    if (!form) return;
    // requestSubmit respeita a validação nativa: campo obrigatório vazio mostra
    // o aviso do navegador em vez de enviar pela metade.
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }

  return (
    <ModalContext.Provider value={{ requestClose, markDirty, dirty: isDirty, floatingContainer }}>
      <Dialog.Root open={Boolean(open)} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-backdrop">
            <Dialog.Content
              className={`modal-card ${sizeClass}`}
              onPointerDownOutside={preventOutsideDismiss}
              onInteractOutside={preventOutsideDismiss}
              onEscapeKeyDown={(event) => { if (confirming) { event.preventDefault(); setConfirming(false); } }}
            >
              <div className="modal-header">
                <div>
                  <Dialog.Title>{title}</Dialog.Title>
                  {subtitle && <Dialog.Description asChild><span>{subtitle}</span></Dialog.Description>}
                </div>
                <Dialog.Close asChild>
                  <button type="button" className="modal-close" aria-label="Fechar"><X size={18} /></button>
                </Dialog.Close>
              </div>
              <div
                className="modal-body"
                ref={bodyRef}
                onPointerDownCapture={recordGesture}
                onKeyDownCapture={recordGesture}
                onInputCapture={onFieldInput}
                onChangeCapture={onFieldChange}
                onClickCapture={onBodyClick}
              >
                {children}
              </div>
              {footer && <div className="modal-actions" onClickCapture={guardFooterClick}>{footer}</div>}
              <div className="modal-floating" ref={setFloatingContainer} />
              {confirming && (
                <div className="modal-guard" role="alertdialog" aria-modal="true" aria-labelledby={guardTitleId} aria-describedby={guardTextId}>
                  <div className="modal-guard-card">
                    <span className="modal-guard-icon" aria-hidden="true"><AlertTriangle size={22} /></span>
                    <h3 id={guardTitleId}>Existem alterações não salvas</h3>
                    <p id={guardTextId}>Deseja realmente sair? O que você preencheu será perdido.</p>
                    <div className="modal-guard-actions">
                      <button type="button" className="secondary-button" onClick={leaveWithoutSaving}>Sair sem salvar</button>
                      {hasForm() && <button type="button" className="secondary-button" onClick={saveAndLeave}>Salvar</button>}
                      <button type="button" className="primary-button" ref={continueRef} onClick={() => setConfirming(false)}>Continuar editando</button>
                    </div>
                  </div>
                </div>
              )}
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    </ModalContext.Provider>
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
      // Não há preenchimento a perder: clicar fora equivale a "Cancelar".
      dismissible
      confirmClose={false}
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
 * @param {{ label: string, icon?: React.ComponentType<any>, onClick: () => void }[]} [props.actions]
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
