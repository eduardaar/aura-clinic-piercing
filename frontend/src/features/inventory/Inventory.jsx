// Feature extraída de main.jsx durante a modularização. Comportamento preservado.
import React, { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Gem, ImageIcon, LayoutGrid, ListFilter, Pencil, Search, ShoppingCart, SlidersHorizontal, Sparkles, Table2, Trash2, X } from "lucide-react";
import { Button, Input, Metric, Select, StatusBadge } from "../../components/common/Ui";
import { Modal, CrudHeader, DataTable, ConfirmDeleteModal } from "../../components/common/Crud";
import { asArray, asObject, formatDate, removeAccents } from "../../lib/utils";
import { apiFetch, useFetch } from "../../lib/api";
import { ANODIZATION_COLOR_OPTIONS, JEWELRY_CATEGORY_OPTIONS, JEWELRY_LENGTH_OPTIONS, JEWELRY_THICKNESS_OPTIONS, JEWELRY_THREAD_OPTIONS, PRICE_MULTIPLIER_OPTIONS, PRICE_ROUNDING_OPTIONS, calculateVariantPricing, centsToMoney, defaultJewelry, defaultJewelryVariant, normalizeJewelryForm, parseGalleryUrls } from "../../lib/defaultForms";
import { catalogFilterOptions, cleanDisplayText, elegantProductName, splitColorOptions } from "../../features/catalog/catalogUtils";
import { catalogImageUrl, currency, inventoryStatusClass, inventoryStatusLabel, inventoryStockState, jewelrySkuBase } from "../../features/shared/helpers";
import { CatalogCustomization, Toggle } from "../../pages/CatalogCustomization";

export function CatalogWorkspace() {
  const [tab, setTab] = useState("inicio");
  const tabs = [
    { id: "estoque", title: "Estoque", description: "Abra o controle administrativo completo das joias.", icon: Gem },
    { id: "personalizacao", title: "Personalização", description: "Configure banners, cores, textos, categorias e destaques do catálogo.", icon: Sparkles },
    { id: "público", title: "Catálogo público", description: "Abra a vitrine que o cliente visualiza.", icon: ShoppingCart }
  ];
  if (tab !== "inicio") {
    return (
      <section className="workspace-page workspace-subpage">
        <Button variant="secondary" className="workspace-back-button" onClick={() => setTab("inicio")}>
          <ChevronLeft size={16} />
          Voltar para Catálogo
        </Button>
        {tab === "estoque" && <Inventory2 compact />}
        {tab === "personalizacao" && <CatalogCustomization />}
      </section>
    );
  }
  return (
    <section className="workspace-page">
      <div className="workspace-intro panel">
        <div>
          <span className="eyebrow">Catálogo e estoque</span>
          <h2>Organize a vitrine pública e o controle interno em áreas separadas.</h2>
          <p>Escolha Estoque para cadastrar uma nova joalheria, ajustar quantidades, medidas, valores e dados de envio. O catálogo público atualiza automaticamente.</p>
        </div>
      </div>
      <div className="workspace-hub">
        {tabs.map(({ id, title, description, icon: Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => id === "público" ? window.open("/catalogo", "_blank", "noopener,noreferrer") : setTab(id)}>
            <Icon size={20} />
            <span><strong>{title}</strong><small>{description}</small></span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
    </section>
  );
}

export function Inventory() {
  const [view, setView] = useState("cards");
  const [filters, setFilters] = useState({ search: "", material: "", color: "", stone: "", status: "" });
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))).toString();
  const { data } = useFetch(`/jewelry?${query}`);
  const items = data || [];
  return (
    <section className="stack">
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input placeholder="Buscar por nome, observação de cor, tamanho, espessura ou categoria" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
        </label>
        <Select label="Material" value={filters.material} onChange={(v) => setFilters({ ...filters, material: v })}>
          <option value="">Todos</option>
          <option>titânio grau implante</option><option>ouro 14k</option><option>ouro 18k</option><option>aço</option><option>outro</option>
        </Select>
        <Select label="Status" value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })}>
          <option value="">Todos</option>
          <option>disponível</option><option>baixo estoque</option><option>esgotado</option>
        </Select>
        <div className="icon-toggle">
          <button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")} aria-label="Cards"><LayoutGrid size={18} /></button>
          <button className={view === "table" ? "active" : ""} onClick={() => setView("table")} aria-label="Tabela"><Table2 size={18} /></button>
        </div>
      </div>
      {view === "cards" ? <JewelryCards items={items} /> : <JewelryTable items={items} />}
    </section>
  );
}

export function JewelryCards({ items, onOpen, onEdit, onMovement, onArchive }) {
  const safeItems = asArray(items);
  return (
    <div className="inventory-product-list">
      {safeItems.map((item) => (
        <article
          className="inventory-product-row clickable"
          key={item.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpen?.(item)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onOpen?.(item);
          }}
        >
          <img src={catalogImageUrl(item.photo_url)} alt={elegantProductName(item.name)} />
          <div>
            <StatusBadge status={inventoryStatusLabel(item)} className={`pill ${inventoryStatusClass(item)}`} />
            <h2>{elegantProductName(item.name)}</h2>
            <p>{[item.category, item.subcategory].map(cleanDisplayText).filter(Boolean).join(" · ")}</p>
            <div className="inventory-inline-meta">
              <span className="stock-chip">{item.quantity} em estoque</span>
              <span className="inventory-visual-tag">{item.variant_count || item.variants?.length || 0} variações</span>
              <strong>A partir de {currency.format(item.sale_value || 0)}</strong>
            </div>
            <div className="card-actions">
              {onMovement && <button type="button" onClick={(event) => { event.stopPropagation(); onMovement(item, "Entrada"); }}>Entrada</button>}
              {onMovement && <button type="button" onClick={(event) => { event.stopPropagation(); onMovement(item, "Saída"); }}>Saída</button>}
              <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(item); }}>Editar</button>
              {onArchive && <button type="button" onClick={(event) => { event.stopPropagation(); onArchive(item); }}>Arquivar</button>}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function Inventory2() {
  const [view, setView] = useState("table");
  const [sectionTab, setSectionTab] = useState("produtos");
  const [inventoryMode, setInventoryMode] = useState("internal");
  const [editingJewelry, setEditingJewelry] = useState(null);
  const [movementTarget, setMovementTarget] = useState(null);
  const [filters, setFilters] = useState({ search: "", category: "", subcategory: "", material: "", color: "", size: "", thickness: "", length: "", diameter: "", thread_type: "", supplier: "", physical_location: "", status: "" });
  const [statusTab, setStatusTab] = useState("todos");
  const [badgeTab, setBadgeTab] = useState("todos");
  const [showEditor, setShowEditor] = useState(false);
  const [showManagement, setShowManagement] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [pricingSaving, setPricingSaving] = useState(false);
  const { data: options, refresh: refreshOptions } = useFetch("/options");
  const { status: _statusFilter, ...queryFilters } = filters;
  const query = new URLSearchParams(Object.fromEntries(Object.entries(queryFilters).filter(([, value]) => value))).toString();
  const { data, refresh: refreshJewelry } = useFetch(`/jewelry?${query}`);
  const apiItems = asArray(data);
  const items = apiItems;
  const safeOptions = asObject(options);
  const rawInventoryOptions = asObject(safeOptions.inventoryOptions);
  const pricingSettings = asObject(safeOptions.pricingSettings);
  const inventoryOptions = {
    category: asArray(rawInventoryOptions.category),
    size: asArray(rawInventoryOptions.size),
    thickness: asArray(rawInventoryOptions.thickness)
  };
const optionJewelry = asArray(safeOptions.jewelry);
const safeOptionJewelry = asArray(optionJewelry);
const inventoryJewelry = asArray(safeOptions.inventoryJewelry || []);
const catalogJewelry = asArray(safeOptions.catalogJewelry || []);
const safeInventoryJewelry = asArray(inventoryJewelry);
const safeCatalogJewelry = asArray(catalogJewelry);

const fallbackJewelry = [...safeInventoryJewelry, ...safeCatalogJewelry];
const allJewelry = safeOptionJewelry.length
    ? safeOptionJewelry
    : fallbackJewelry.length
      ? fallbackJewelry
      : items;

const allVariants = asArray(allJewelry).flatMap((item) =>
  asArray(item?.variants)
);
  const variantOptions = (field) => [...new Set(allVariants.map((variant) => variant[field]).filter(Boolean))].sort();
  async function savePricingSettings(patch) {
    setPricingSaving(true);
    const response = await apiFetch("/pricing-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...pricingSettings, ...patch })
    });
    setPricingSaving(false);
    if (response.ok) refreshOptions();
  }
  const filteredItems = items.filter((item) => {
    if (inventoryMode === "virtual") {
      if (badgeTab === "todos") return true;
      if (badgeTab === "lancamentos") return Boolean(Number(item.is_new));
      if (badgeTab === "promocoes") return Boolean(Number(item.is_promotion));
      if (badgeTab === "mais-desejados") return Boolean(Number(item.is_most_wanted));
      if (badgeTab === "ultimas-unidades") return Boolean(Number(item.is_last_units));
      if (badgeTab === "destaques") return Boolean(Number(item.is_featured));
      return true;
    }
    const effectiveStatus = statusTab !== "todos" ? statusTab : filters.status;
    if (!effectiveStatus || effectiveStatus === "todos") return true;
    if (effectiveStatus === "ativos") return inventoryStockState(item) === "active";
    if (effectiveStatus === "critico" || effectiveStatus === "crítico") return inventoryStockState(item) === "critical";
    if (effectiveStatus === "esgotados" || effectiveStatus === "esgotado") return inventoryStockState(item) === "sold-out";
    return true;
  });
  const displayItems = filteredItems.filter((item) => inventoryMode === "virtual" ? Boolean(Number(item.is_catalog_active)) : true);
  const stockSummary = {
    totalProducts: allJewelry.length,
    totalPieces: allJewelry.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    active: allJewelry.filter((item) => inventoryStockState(item) === "active").length,
    critical: allJewelry.filter((item) => inventoryStockState(item) === "critical").length,
    soldOut: allJewelry.filter((item) => inventoryStockState(item) === "sold-out").length,
    invested: allJewelry.reduce((sum, item) => sum + Number(item.cost_value || 0) * Number(item.quantity || 0), 0),
    potential: allJewelry.reduce((sum, item) => sum + Number(item.sale_value || 0) * Number(item.quantity || 0), 0)
  };
  const criticalStockItems = allJewelry.filter((item) => inventoryStockState(item) === "critical");
  const lowStockItems = criticalStockItems;
  const reorderItems = criticalStockItems;
  const soldOutItems = allJewelry.filter((item) => inventoryStockState(item) === "sold-out");
  const topValueItems = [...allJewelry].sort((a, b) => (Number(b.sale_value || 0) * Number(b.quantity || 0)) - (Number(a.sale_value || 0) * Number(a.quantity || 0))).slice(0, 8);
  const mainTabs = [
    { id: "produtos", label: "Lista de Produtos", icon: LayoutGrid },
    { id: "categorias", label: "Categorias", icon: ListFilter }
  ];

  useEffect(() => {
    setStatusTab("todos");
    setBadgeTab("todos");
  }, [inventoryMode]);

  async function archiveJewelry(item) {
    const response = await apiFetch(`/jewelry/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "arquivado", is_catalog_active: 0 })
    });
    if (response.ok) {
      refreshJewelry();
      refreshOptions();
    }
  }

  function openMovement(item, movement_type) {
    setMovementTarget({ ...item, movement_type });
  }

  async function handleMovementSave(payload) {
    if (!movementTarget) return;
    const selectedVariantId = payload.variant_id || movementTarget.variants?.[0]?.id;
    const endpoint = selectedVariantId
      ? `/jewelry/${movementTarget.id}/variants/${selectedVariantId}/movements`
      : `/jewelry/${movementTarget.id}/movements`;
    const response = await apiFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      setMovementTarget(null);
      refreshJewelry();
      refreshOptions();
    }
  }

  function openProduct(item) {
    setEditingJewelry(item);
    setShowEditor(true);
  }

  function openNewProduct() {
    setEditingJewelry(null);
    setShowEditor(true);
    setSectionTab("produtos");
  }

  function closeProduct({ keepCategory = true } = {}) {
    const category = editingJewelry?.category;
    setEditingJewelry(null);
    setShowEditor(false);
    if (keepCategory && category) {
      setFilters((current) => ({ ...current, category }));
    }
  }

  if (showEditor) {
    const productCategory = editingJewelry?.category || filters.category;
    return (
      <section className="inventory-studio inventory-product-page">
        <div className="inventory-main">
          <nav className="inventory-breadcrumb" aria-label="Navegação do estoque">
            <button type="button" onClick={() => closeProduct({ keepCategory: false })}>Estoque</button>
            {productCategory && (
              <>
                <ChevronRight size={14} />
                <button type="button" onClick={() => closeProduct({ keepCategory: true })}>{productCategory}</button>
              </>
            )}
            <ChevronRight size={14} />
            <strong>{editingJewelry ? elegantProductName(editingJewelry.name) : "Novo Produto"}</strong>
          </nav>

          <div className="inventory-product-navigation">
            <Button variant="secondary" onClick={() => closeProduct({ keepCategory: false })}>
              <ArrowLeft size={16} /> Voltar para Estoque
            </Button>
            {productCategory && (
              <Button variant="secondary" onClick={() => closeProduct({ keepCategory: true })}>
                <ArrowLeft size={16} /> Voltar para {productCategory}
              </Button>
            )}
          </div>

          <JewelryEditor
            options={inventoryOptions}
            pricingSettings={safeOptions.pricingSettings}
            editing={editingJewelry}
            onMovementOpen={openMovement}
            onCancel={() => closeProduct({ keepCategory: Boolean(productCategory) })}
            onSaved={() => {
              closeProduct({ keepCategory: Boolean(productCategory) });
              refreshJewelry();
              refreshOptions();
            }}
          />
        </div>
        {movementTarget && <StockMovementModal item={movementTarget} initialType={movementTarget.movement_type} onClose={() => setMovementTarget(null)} onSave={handleMovementSave} />}
      </section>
    );
  }

  return (
    <section className="inventory-studio">
      <div className="inventory-main">
        <header className="inventory-hero">
          <div>
            <span className="eyebrow">Aura Clinic / Estoque</span>
            <h2>Estoque</h2>
            <p>Produtos, variações e movimentações em uma navegação simples.</p>
          </div>
          <div className="inventory-hero-actions">
            <Button variant="primary" onClick={openNewProduct}><Gem size={16} /> Nova Joia</Button>
          </div>
        </header>

        <nav className="inventory-module-tabs" aria-label="Módulos do estoque">
          {mainTabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={sectionTab === id ? "active" : ""} onClick={() => setSectionTab(id)}>
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="inventory-panel-shell">
          {sectionTab === "produtos" && (
            <>
              <nav className="inventory-list-breadcrumb" aria-label="Navegação por categoria">
                <button
                  type="button"
                  className={!filters.category ? "active" : ""}
                  onClick={() => setFilters((current) => ({ ...current, category: "" }))}
                >
                  Estoque
                </button>
                {filters.category && (
                  <>
                    <ChevronRight size={14} />
                    <strong>{filters.category}</strong>
                  </>
                )}
              </nav>

              <div className="inventory-category-strip" aria-label="Categorias principais">
                {JEWELRY_CATEGORY_OPTIONS.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={filters.category === category ? "active" : ""}
                    onClick={() => setFilters((current) => ({ ...current, category: current.category === category ? "" : category }))}
                  >
                    {category}
                  </button>
                ))}
              </div>

              <section className="panel pricing-settings-panel">
                <div>
                  <strong>Precificação padrão</strong>
                  <small>Usada como base para novas joias e variações. O preço final ainda pode ser ajustado manualmente.</small>
                </div>
                <Select label="Multiplicador padrão" value={pricingSettings.default_price_multiplier || 3} onChange={(value) => savePricingSettings({ default_price_multiplier: Number(value) })}>
                  {PRICE_MULTIPLIER_OPTIONS.map((option) => <option key={option} value={option}>{option}x</option>)}
                </Select>
                <Select label="Arredondamento" value={pricingSettings.price_rounding_mode || "exact"} onChange={(value) => savePricingSettings({ price_rounding_mode: value })}>
                  {PRICE_ROUNDING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
                {pricingSaving && <span className="form-success">Salvando...</span>}
              </section>

              <div className="inventory-filter-row simplified">
                <label className="search-field">
                  <Search size={17} />
                  <input placeholder="Buscar joia, SKU ou variação..." value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
                </label>
                <Select label="Categoria" value={filters.category} onChange={(value) => setFilters({ ...filters, category: value })}>
                  <option value="">Categoria</option>
                  {catalogFilterOptions(allJewelry).categories.map((option) => <option key={option}>{option}</option>)}
                </Select>
                <Select label="Status" value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })}>
                  <option value="">Status</option>
                  <option value="ativos">Ativos</option>
                  <option value="critico">Crítico</option>
                  <option value="esgotados">Esgotados</option>
                </Select>
                <button type="button" className={`advanced-filter-toggle ${showAdvancedFilters ? "active" : ""}`} onClick={() => setShowAdvancedFilters((value) => !value)}>
                  <SlidersHorizontal size={17} /> Filtros Avançados
                </button>
                <div className="icon-toggle">
                  <button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")} aria-label="Cards"><LayoutGrid size={18} /></button>
                  <button className={view === "table" ? "active" : ""} onClick={() => setView("table")} aria-label="Tabela"><Table2 size={18} /></button>
                </div>
              </div>

              {showAdvancedFilters && (
                <div className="inventory-advanced-filters">
                  <Select label="Material" value={filters.material} onChange={(value) => setFilters({ ...filters, material: value })}>
                    <option value="">Todos os Materiais</option>
                    {variantOptions("material").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                  <Select label="Observação de Cor" value={filters.color} onChange={(value) => setFilters({ ...filters, color: value })}>
                    <option value="">Todas</option>
                    {variantOptions("color").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                  <Select label="Tipo de Rosca" value={filters.thread_type} onChange={(value) => setFilters({ ...filters, thread_type: value })}>
                    <option value="">Todos</option>
                    {variantOptions("thread_type").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                  <Select label="Espessura" value={filters.thickness} onChange={(value) => setFilters({ ...filters, thickness: value })}>
                    <option value="">Todas</option>
                    {variantOptions("thickness").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                  <Select label="Comprimento" value={filters.length} onChange={(value) => setFilters({ ...filters, length: value })}>
                    <option value="">Todos</option>
                    {variantOptions("length").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                  <Select label="Diâmetro" value={filters.diameter} onChange={(value) => setFilters({ ...filters, diameter: value })}>
                    <option value="">Todos</option>
                    {variantOptions("diameter").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                  <Select label="Fornecedor" value={filters.supplier} onChange={(value) => setFilters({ ...filters, supplier: value })}>
                    <option value="">Todos</option>
                    {variantOptions("supplier").map((option) => <option key={option}>{option}</option>)}
                  </Select>
                </div>
              )}

              {!displayItems.length ? (
                <div className="inventory-empty-state">
                  <Gem size={28} />
                  <strong>Nenhuma joia cadastrada ainda.</strong>
                  <span>Cadastre uma nova joia ou ajuste os filtros para continuar.</span>
                </div>
              ) : view === "cards" ? (
                <JewelryCards items={displayItems} onOpen={openProduct} onEdit={openProduct} onMovement={openMovement} onArchive={archiveJewelry} />
              ) : (
                <JewelryTable items={displayItems} onOpen={openProduct} onEdit={openProduct} onMovement={openMovement} onArchive={archiveJewelry} />
              )}
            </>
          )}

          {sectionTab === "categorias" && (
            <div className="inventory-section-card">
              <div className="panel-heading">
                <div>
                  <h2>Categorias e cadastros auxiliares</h2>
                  <span>Organize categorias, tamanhos, espessuras e profissionais sem sair desta página.</span>
                </div>
                <Button variant="secondary" onClick={() => setShowManagement((value) => !value)}>
                  {showManagement ? "Ocultar cadastros" : "Abrir cadastros"}
                </Button>
              </div>
              <div className="inventory-summary-grid compact">
                <Metric label="Categorias" value={String(inventoryOptions.category?.length || 0)} />
                <Metric label="Tamanhos" value={String(inventoryOptions.size?.length || 0)} />
                <Metric label="Espessuras" value={String(inventoryOptions.thickness?.length || 0)} />
                <Metric label="Profissionais" value={String(asArray(safeOptions.professionals).length)} />
              </div>
              {showManagement && <InventoryManagement options={inventoryOptions} professionals={asArray(safeOptions.professionals)} onChanged={refreshOptions} />}
            </div>
          )}

          {sectionTab === "unidades" && (
            <div className="inventory-section-card">
              <div className="panel-heading">
                <div>
                  <h2>Unidades e visão rápida</h2>
                  <span>Resumo por peça com foco no que importa primeiro.</span>
                </div>
              </div>
              <div className="inventory-summary-grid compact">
                <Metric label="Total de peças" value={String(stockSummary.totalPieces)} />
                <Metric label="Total de produtos" value={String(stockSummary.totalProducts)} />
                <Metric label="Críticas" value={String(stockSummary.critical)} />
                <Metric label="Esgotados" value={String(stockSummary.soldOut)} />
                <Metric label="Valor investido" value={currency.format(stockSummary.invested)} />
                <Metric label="Venda potencial" value={currency.format(stockSummary.potential)} />
                <Metric label="Lucro potencial" value={currency.format(stockSummary.potential - stockSummary.invested)} />
              </div>
              <div className="inventory-quick-flags">
                <span><strong>Ativos no Catálogo</strong><small>{allJewelry.filter((item) => Boolean(Number(item.is_catalog_active))).length} peças visíveis na vitrine</small></span>
                <span><strong>Destaques Comerciais</strong><small>Lançamentos, promoções e últimas unidades ficam na Loja Virtual</small></span>
                <span><strong>Alertas</strong><small>Criticidade e reposição continuam no fluxo interno</small></span>
              </div>
              <div className="inventory-mini-list">
                {allJewelry.slice(0, 6).map((item) => (
                  <div key={item.id} className="inventory-mini-row">
                    <img src={catalogImageUrl(item.photo_url)} alt={item.name} />
                    <div>
                      <strong>{item.name}</strong>
                      <small>{[item.category, item.material].filter(Boolean).join(" · ")}</small>
                    </div>
                    <span>{item.quantity} un</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sectionTab === "abc" && (
            <div className="inventory-section-card">
              <div className="panel-heading">
                <div>
                  <h2>Curva ABC</h2>
                  <span>Peças com maior valor total em estoque.</span>
                </div>
              </div>
              <div className="inventory-abc-list">
                {topValueItems.map((item, index) => (
                  <div key={item.id}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{item.name}</strong>
                      <small>{currency.format(Number(item.sale_value || 0) * Number(item.quantity || 0))}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {movementTarget && <StockMovementModal item={movementTarget} initialType={movementTarget.movement_type} onClose={() => setMovementTarget(null)} onSave={handleMovementSave} />}
    </section>
  );
}

function ProductGalleryManager({ images = [], productName = "", onChange }) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [url, setUrl] = useState("");
  const safeImages = asArray(images);

  function normalizeList(list) {
    const seen = new Set();
    const normalized = asArray(list)
      .map((image, index) => ({
        image_url: image.image_url || image.url || "",
        alt_text: image.alt_text || productName || "",
        sort_order: index + 1,
        is_primary: Boolean(image.is_primary)
      }))
      .filter((image) => {
        if (!image.image_url || seen.has(image.image_url)) return false;
        seen.add(image.image_url);
        return true;
      })
      .map((image, index) => ({ ...image, sort_order: index + 1 }));
    const primaryIndex = Math.max(0, normalized.findIndex((image) => image.is_primary));
    return normalized.map((image, index) => ({ ...image, is_primary: index === primaryIndex }));
  }

  function emit(list) {
    const normalized = normalizeList(list);
    onChange(normalized.map((image, index) => ({ ...image, sort_order: index + 1 })));
  }

  async function uploadFiles(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        if (file.size > 6 * 1024 * 1024) continue;
        const body = new FormData();
        body.append("file", file);
        const response = await apiFetch("/uploads", { method: "POST", body });
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload.url) uploaded.push({ image_url: payload.url, alt_text: productName });
      }
      emit([...safeImages, ...uploaded]);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  function move(index, direction) {
    const next = [...safeImages];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    emit(next);
  }

  function remove(index) {
    if (!window.confirm("Remover esta imagem da galeria?")) return;
    emit(safeImages.filter((_, itemIndex) => itemIndex !== index));
  }

  function setPrimary(index) {
    emit(safeImages.map((image, itemIndex) => ({ ...image, is_primary: itemIndex === index })));
  }

  function addUrl() {
    const clean = url.trim();
    if (!clean) return;
    emit([...safeImages, { image_url: clean, alt_text: productName }]);
    setUrl("");
  }

  return (
    <section className="product-gallery-manager">
      <div className="product-gallery-head">
        <div>
          <strong>Galeria do produto</strong>
          <small>Adicione várias fotos, escolha a principal e organize a ordem do catálogo.</small>
        </div>
        <label className="secondary-button gallery-upload-button">
          <ImageIcon size={16} />
          Enviar imagens
          <input type="file" accept="image/*" multiple onChange={uploadFiles} />
        </label>
      </div>
      <div className="gallery-url-row">
        <Input label="URL da imagem" value={url} onChange={setUrl} placeholder="https://..." />
        <Button variant="secondary" onClick={addUrl}>Adicionar URL</Button>
      </div>
      {uploading && <small className="form-success">Enviando imagens...</small>}
      <div className="product-gallery-grid">
        {safeImages.map((image, index) => (
          <article key={`${image.image_url}-${index}`} className={image.is_primary ? "primary" : ""}>
            <button type="button" className="gallery-thumb" onClick={() => setPreview(image.image_url)}>
              <img src={catalogImageUrl(image.image_url)} alt={image.alt_text || productName || "Joia"} />
            </button>
            <div>
              <strong>{image.is_primary ? "Principal" : `Imagem ${index + 1}`}</strong>
              <small>{image.image_url}</small>
            </div>
            <div className="gallery-actions">
              <button type="button" onClick={() => setPrimary(index)}>Principal</button>
              <button type="button" onClick={() => move(index, -1)}>Subir</button>
              <button type="button" onClick={() => move(index, 1)}>Descer</button>
              <button type="button" onClick={() => remove(index)}>Remover</button>
            </div>
          </article>
        ))}
        {!safeImages.length && <p className="empty-state">Nenhuma imagem cadastrada. O catálogo usará a imagem padrão até você enviar uma foto.</p>}
      </div>
      {preview && (
        <div className="gallery-preview-modal" onClick={() => setPreview(null)}>
          <img src={catalogImageUrl(preview)} alt="Pré-visualização" />
        </div>
      )}
    </section>
  );
}

export function JewelryEditor({ options, pricingSettings = {}, editing, onSaved, onCancel, onMovementOpen }) {
  const [form, setForm] = useState(defaultJewelry());
  const [error, setError] = useState("");
  const [editorTab, setEditorTab] = useState("dados");
  const [editingVariantIndex, setEditingVariantIndex] = useState(null);

  useEffect(() => {
    setForm(editing ? normalizeJewelryForm(editing) : defaultJewelry());
    setError("");
    setEditorTab("dados");
    setEditingVariantIndex(null);
  }, [editing?.id]);

  useEffect(() => {
    if (!form.name) return;
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, index) => (
        variant.sku ? variant : { ...variant, sku: `${jewelrySkuBase(current)}-${String(index + 1).padStart(2, "0")}` }
      ))
    }));
  }, [form.name, form.category]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    const pricedVariants = form.variants.map((variant) => ({
      ...variant,
      ...calculateVariantPricing(variant, pricingSettings)
    }));
    const saleValues = pricedVariants.map((variant) => Number(variant.sale_value || 0)).filter((value) => value > 0);
    const payload = {
      ...form,
      variants: pricedVariants,
      images: form.images,
      gallery_urls: form.images?.length ? form.images.map((image) => image.image_url) : parseGalleryUrls(form.gallery_urls),
      material: pricedVariants[0]?.material || "",
      color: pricedVariants[0]?.color || "",
      size: pricedVariants[0]?.size || "",
      thickness: pricedVariants[0]?.thickness || "",
      stem_length: pricedVariants[0]?.length || "",
      thread_type: pricedVariants[0]?.thread_type || "",
      supplier: pricedVariants[0]?.supplier || "",
      sku: form.sku || "",
      quantity: pricedVariants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0),
      cost_value: Math.min(...pricedVariants.map((variant) => Number(variant.cost_value || 0))),
      sale_value: saleValues.length ? Math.min(...saleValues) : 0,
      virtual_store_active: Boolean(form.virtual_store_active),
      is_catalog_active: Boolean(form.is_catalog_active),
      is_published: Boolean(form.is_published),
      is_featured: Boolean(form.is_featured),
      is_new: Boolean(form.is_new),
      is_most_wanted: Boolean(form.is_most_wanted),
      is_promotion: Boolean(form.is_promotion),
      is_last_units: Boolean(form.is_last_units),
      image_url: form.images?.find((image) => image.is_primary)?.image_url || form.images?.[0]?.image_url || form.image_url
    };
    const response = await apiFetch(`/jewelry${editing ? `/${editing.id}` : ""}`, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return setError(json.message || json.error || "Não foi possível salvar a joia.");
    setForm(defaultJewelry());
    onSaved(json);
  }

  const potentialProfit = form.variants.reduce(
    (sum, variant) => sum + Math.max(0, Number(variant.sale_value || 0) - Number(variant.cost_value || 0)) * Number(variant.quantity || 0),
    0
  );

  function updateVariant(index, patch) {
    const pricingFields = ["cost_value", "purchase_cost", "allocated_freight", "additional_cost", "price_multiplier", "price_rounding_mode", "price_manually_overridden", "sale_value"];
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, variantIndex) => {
        if (variantIndex !== index) return variant;
        const nextVariant = { ...variant, ...patch };
        return pricingFields.some((field) => Object.prototype.hasOwnProperty.call(patch, field))
          ? { ...nextVariant, ...calculateVariantPricing(nextVariant, pricingSettings) }
          : nextVariant;
      })
    }));
  }

  function applyPricingToAll() {
    if (!form.variants.length) return;
    if (!window.confirm("Aplicar custo, frete, multiplicador e arredondamento da primeira variação para todas as variações? Preços finais manuais serão recalculados.")) return;
    const source = form.variants[0];
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant) => {
        const nextVariant = {
          ...variant,
          purchase_cost: source.purchase_cost,
          allocated_freight: source.allocated_freight,
          additional_cost: source.additional_cost,
          price_multiplier: source.price_multiplier,
          price_rounding_mode: source.price_rounding_mode,
          price_manually_overridden: false
        };
        return { ...nextVariant, ...calculateVariantPricing(nextVariant, pricingSettings) };
      })
    }));
  }

  function addVariant() {
    setForm((current) => {
      const nextIndex = current.variants.length + 1;
      return {
        ...current,
        variants: [
          ...current.variants,
          {
            ...defaultJewelryVariant(nextIndex),
            sku: `${jewelrySkuBase(current)}-${String(nextIndex).padStart(2, "0")}`
          }
        ]
      };
    });
    setEditorTab("variacoes");
    setEditingVariantIndex(form.variants.length);
  }

  function removeVariant(index) {
    if (form.variants.length === 1) return setError("O produto precisa ter ao menos uma variação.");
    setForm((current) => ({ ...current, variants: current.variants.filter((_, variantIndex) => variantIndex !== index) }));
  }

  return (
    <form className="panel jewelry-editor stock-editor" onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Categoria → Produto → Variações</span>
          <h2>{editing ? "Editar Produto" : "Novo Produto"}</h2>
          <span>Cadastre a joia uma vez e controle cada medida separadamente.</span>
        </div>
      </div>

      <nav className="editor-tabs">
        {[
          ["dados", "Dados"],
          ["variacoes", `Variações (${form.variants.length})`],
          ["movimentacao", "Movimentação"],
          ["comercial", "Comercial"],
          ["virtual", "Catálogo"]
        ].map(([id, label]) => (
          <button key={id} type="button" className={editorTab === id ? "active" : ""} onClick={() => setEditorTab(id)}>{label}</button>
        ))}
      </nav>

      {editorTab === "dados" && (
        <div className="editor-section">
          <div className="form-grid">
            <Input label="Nome do Produto" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
            <Select label="Categoria" value={form.category} onChange={(value) => setForm({ ...form, category: value })} required>
              <option value="">Selecione</option>
              {JEWELRY_CATEGORY_OPTIONS.map((item) => <option key={item}>{item}</option>)}
            </Select>
            {form.category === "Argolas" && (
              <Select label="Subcategoria" value={form.subcategory} onChange={(value) => setForm({ ...form, subcategory: value })}>
                <option value="">Selecione</option>
                {["Segmento", "Clicker", "D-Ring", "Captive", "Hinged Ring"].map((item) => <option key={item}>{item}</option>)}
              </Select>
            )}
            <ProductGalleryManager
              images={form.images}
              productName={form.name}
              onChange={(images) => setForm({
                ...form,
                images,
                photo_url: images.find((image) => image.is_primary)?.image_url || images[0]?.image_url || form.photo_url,
                image_url: images.find((image) => image.is_primary)?.image_url || images[0]?.image_url || form.image_url
              })}
            />
          </div>
          <div className="form-grid">
            <Input label="Pedra" value={form.stone} onChange={(value) => setForm({ ...form, stone: value })} />
            <Input label="Indicação de Uso" value={form.piercing_type} onChange={(value) => setForm({ ...form, piercing_type: value })} />
          </div>
          <label>Descrição curta
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <label>Observações internas
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
        </div>
      )}

      {editorTab === "variacoes" && (
        <div className="editor-section">
          <div className="variant-editor-heading">
            <div>
              <h3>Variações do Produto</h3>
              <p>Cada combinação possui SKU, preço e estoque próprios.</p>
            </div>
            <div className="product-movement-actions">
              <Button variant="secondary" onClick={applyPricingToAll}>Aplicar custo e multiplicador a todas</Button>
              <Button variant="primary" onClick={addVariant}>+ Nova Variação</Button>
            </div>
          </div>
          <div className="variant-editor-list">
            {form.variants.map((variant, index) => {
              const measure = variant.diameter
                ? `Diâmetro ${variant.diameter}`
                : variant.length
                  ? `Comprimento ${variant.length}`
                  : variant.size
                    ? `Tamanho ${variant.size}`
                    : variant.variation_name || `Variação ${index + 1}`;
              const specifications = [
                variant.thickness && `${variant.thickness}`,
                variant.material && elegantProductName(variant.material),
                variant.thread_type && `Rosca ${elegantProductName(variant.thread_type)}`
              ].filter(Boolean);
              return (
                <article className="variant-editor-card compact" key={variant.id || index}>
                  <div className="variant-card-measure">
                    <strong>{measure}</strong>
                    {variant.variation_name && !measure.toLocaleLowerCase("pt-BR").includes(String(variant.variation_name).toLocaleLowerCase("pt-BR")) && <small>{variant.variation_name}</small>}
                  </div>
                  <div className="variant-card-specs">
                    {specifications.length
                      ? specifications.map((specification) => <span key={specification}>{specification}</span>)
                      : <span>Configure as especificações</span>}
                  </div>
                  <div className="variant-card-business">
                    <span><small>Estoque</small><strong>{Number(variant.quantity || 0)} un</strong></span>
                    <span><small>Preço</small><strong>{currency.format(variant.sale_value || 0)}</strong></span>
                    <span><small>SKU</small><strong>{variant.sku || "Não informado"}</strong></span>
                  </div>
                  <div className="variant-card-actions">
                    <button type="button" aria-label="Editar Variação" title="Editar Variação" onClick={() => setEditingVariantIndex(index)}><Pencil size={16} /></button>
                    <button type="button" aria-label="Excluir Variação" title="Excluir Variação" onClick={() => removeVariant(index)}><Trash2 size={16} /></button>
                  </div>
                </article>
              );
            })}
          </div>
          {editingVariantIndex !== null && form.variants[editingVariantIndex] && (
            <VariantEditModal
              category={form.category}
              variant={form.variants[editingVariantIndex]}
              pricingSettings={pricingSettings}
              onChange={(patch) => updateVariant(editingVariantIndex, patch)}
              onClose={() => setEditingVariantIndex(null)}
            />
          )}
        </div>
      )}

      {editorTab === "movimentacao" && (
        <div className="editor-section">
          <div className="variant-editor-heading">
            <div>
              <h3>Movimentação de Estoque</h3>
              <p>Registre entradas e saídas sem misturar o histórico com o cadastro das variações.</p>
            </div>
            {editing?.id && (
              <div className="product-movement-actions">
                <Button variant="secondary" onClick={() => onMovementOpen?.(editing, "Entrada")}>Registrar Entrada</Button>
                <Button variant="secondary" onClick={() => onMovementOpen?.(editing, "Saída")}>Registrar Saída</Button>
              </div>
            )}
          </div>
          {editing?.id
            ? <StockMovementHistory jewelryId={editing.id} />
            : <p className="empty-state">Salve o produto antes de registrar movimentações.</p>}
        </div>
      )}

      {editorTab === "comercial" && (
        <div className="editor-section">
          <div className="form-grid">
            <Input label="Localização Física" value={form.physical_location} onChange={(value) => setForm({ ...form, physical_location: value })} />
          </div>
          <div className="inventory-stat-box">
            <div><span>Variações Ativas</span><strong>{form.variants.length}</strong></div>
            <div><span>Total de Peças</span><strong>{form.variants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0)}</strong></div>
            <div><span>Lucro Potencial</span><strong>{currency.format(potentialProfit)}</strong></div>
          </div>
          <div className="chip-toggle-grid">
            <ToggleChip label="Ativo no catálogo" checked={form.is_catalog_active} onChange={(value) => setForm({ ...form, is_catalog_active: value })} />
            <ToggleChip label="Destaque" checked={form.is_featured} onChange={(value) => setForm({ ...form, is_featured: value })} />
            <ToggleChip label="Promoção" checked={form.is_promotion} onChange={(value) => setForm({ ...form, is_promotion: value })} />
            <ToggleChip label="Lançamento" checked={form.is_new} onChange={(value) => setForm({ ...form, is_new: value })} />
            <ToggleChip label="Mais desejado" checked={form.is_most_wanted} onChange={(value) => setForm({ ...form, is_most_wanted: value })} />
            <ToggleChip label="Últimas unidades" checked={form.is_last_units} onChange={(value) => setForm({ ...form, is_last_units: value })} />
          </div>
        </div>
      )}

      {editorTab === "virtual" && (
        <div className="editor-section">
          <div className="form-grid">
            <Toggle label="Loja virtual ativa" checked={form.virtual_store_active} onChange={(value) => setForm({ ...form, virtual_store_active: value })} />
            <Toggle label="Publicar no catálogo público" checked={form.is_published} onChange={(value) => setForm({ ...form, is_published: value })} />
          </div>
          {Boolean(form.virtual_store_active) && (
            <>
              <div className="form-grid">
                <Input label="URL da imagem (para catálogo)" value={form.image_url} onChange={(value) => setForm({ ...form, image_url: value })} placeholder="https://..." />
                <Input type="number" label="Peso para envio (g)" value={form.weight_grams} onChange={(value) => setForm({ ...form, weight_grams: value })} />
                <Input type="number" label="Comprimento da embalagem (cm)" value={form.package_length_cm} onChange={(value) => setForm({ ...form, package_length_cm: value })} />
                <Input type="number" label="Largura da embalagem (cm)" value={form.package_width_cm} onChange={(value) => setForm({ ...form, package_width_cm: value })} />
                <Input type="number" label="Altura da embalagem (cm)" value={form.package_height_cm} onChange={(value) => setForm({ ...form, package_height_cm: value })} />
                <Input label="Tipo de embalagem" value={form.package_type} onChange={(value) => setForm({ ...form, package_type: value })} />
                <Input type="number" label="Prazo de preparação (dias)" value={form.preparation_days} onChange={(value) => setForm({ ...form, preparation_days: value })} />
              </div>
              <label>Informações de frete / envio
                <textarea value={form.shipping_info} onChange={(event) => setForm({ ...form, shipping_info: event.target.value })} placeholder="Ex.: Envio para todo o Brasil, cálculo por Correios ou transportadora, embalagem protegida." />
              </label>
              <label>Observações de frete e envio
                <textarea value={form.freight_notes} onChange={(event) => setForm({ ...form, freight_notes: event.target.value })} placeholder="Ex.: proteger pedra ou opala, usar caixa pequena, separar por variações." />
              </label>
              <div className="form-grid">
                <Input label="SEO título" value={form.seo_title} onChange={(value) => setForm({ ...form, seo_title: value })} />
                <Input label="SEO descrição" value={form.seo_description} onChange={(value) => setForm({ ...form, seo_description: value })} />
              </div>
            </>
          )}
        </div>
      )}

      {error && <span className="form-error">{error}</span>}
      <div className="modal-actions">
        {editing && <Button variant="secondary" onClick={onCancel}>Cancelar edição</Button>}
        <Button variant="primary" type="submit">{editing ? "Salvar joia" : "Cadastrar joia"}</Button>
      </div>
    </form>
  );
}

export function VariantEditModal({ category, variant, pricingSettings = {}, onChange, onClose }) {
  const normalizedCategory = removeAccents(String(category || "").toLowerCase());
  const usesDiameter = normalizedCategory.includes("argola");
  const usesLength = ["labret", "barbell reto", "barbell curvo", "nostril", "surface"].some((name) => normalizedCategory.includes(name));
  const usesSize = normalizedCategory.includes("topos") || normalizedCategory.includes("microdermal") || normalizedCategory.includes("ouro");
  const usesThickness = !normalizedCategory.includes("topos") && !normalizedCategory.includes("microdermal");
  const usesThread = ["labret", "barbell", "nostril", "topos", "ouro"].some((name) => normalizedCategory.includes(name));
  const selectedColors = splitColorOptions(variant.color);
  const pricing = calculateVariantPricing(variant, pricingSettings);
  const priceAdjusted = Math.abs(Number(variant.sale_value || 0) - centsToMoney(pricing.suggested_price_cents)) > 0.009;
  const margin = pricing.sale_price_cents ? Math.max(0, Math.round(((pricing.sale_price_cents - pricing.total_cost_cents) / pricing.sale_price_cents) * 100)) : 0;

  function updatePricing(patch) {
    const nextVariant = { ...variant, ...patch };
    onChange({ ...patch, ...calculateVariantPricing(nextVariant, pricingSettings) });
  }

  function estimateCostFromSale() {
    updatePricing({ estimate_cost_from_sale: true, price_manually_overridden: true });
  }

  function toggleColor(color) {
    const nextColors = selectedColors.includes(color)
      ? selectedColors.filter((item) => item !== color)
      : [...selectedColors, color];
    onChange({ color: nextColors.join(", ") });
  }

  return (
    <div className="modal-backdrop variant-modal-backdrop" onClick={onClose}>
      <section className="panel variant-edit-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><h2>Editar Variação</h2><p>Configure apenas as especificações necessárias para {category || "esta categoria"}.</p></div>
          <button type="button" aria-label="Fechar" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="variant-modal-fields">
          <Input label="Nome da Variação" value={variant.variation_name} onChange={(value) => onChange({ variation_name: value })} />
          {usesSize && <Input label="Tamanho / Medida" value={variant.size} onChange={(value) => onChange({ size: value })} />}
          {usesDiameter && <Input label="Diâmetro" value={variant.diameter} onChange={(value) => onChange({ diameter: value })} />}
          {usesLength && (
            <Select label="Comprimento" value={variant.length} onChange={(value) => onChange({ length: value })}>
              <option value="">Selecione</option>
              {JEWELRY_LENGTH_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </Select>
          )}
          {usesThickness && (
            <Select label="Espessura" value={variant.thickness} onChange={(value) => onChange({ thickness: value })}>
              <option value="">Selecione</option>
              {JEWELRY_THICKNESS_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </Select>
          )}
          <Select label="Material" value={variant.material} onChange={(value) => onChange({ material: value })}>
            <option>Titânio ASTM F136</option><option>Ouro 14k</option><option>Ouro 18k</option><option>Aço</option><option>Outro</option>
          </Select>
          <fieldset className="anodization-fieldset">
            <legend>Observações de Cor / Anodização</legend>
            <p>Selecione todas as cores que o cliente poderá solicitar para esta mesma joia.</p>
            <div className="anodization-color-grid">
              {ANODIZATION_COLOR_OPTIONS.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  className={selectedColors.includes(option.name) ? "active" : ""}
                  onClick={() => toggleColor(option.name)}
                >
                  <span style={{ backgroundColor: option.color }} />
                  {option.name}
                  {selectedColors.includes(option.name) && <CheckCircle2 size={15} />}
                </button>
              ))}
            </div>
          </fieldset>
          <Select label="Lado" value={variant.side} onChange={(value) => onChange({ side: value })}>
            <option value="">Não se aplica</option><option>Direito</option><option>Esquerdo</option><option>Universal</option>
          </Select>
          <Input label="Cor da Pedraria" value={variant.stone_color} onChange={(value) => onChange({ stone_color: value })} />
          {usesThread && (
            <Select label="Tipo de Rosca" value={variant.thread_type} onChange={(value) => onChange({ thread_type: value })}>
              <option value="">Sem Rosca</option>
              {JEWELRY_THREAD_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </Select>
          )}
          <Input label="SKU" value={variant.sku} onChange={(value) => onChange({ sku: value, sku_manually_edited: true })} required />
          <Input label="Fornecedor" value={variant.supplier} onChange={(value) => onChange({ supplier: value })} />
          <ProductGalleryManager
            images={variant.images || []}
            productName={variant.variation_name || variant.sku || "VariaÃ§Ã£o"}
            onChange={(images) => onChange({ images })}
          />
          {!(variant.images || []).length && <small className="pricing-note">Sem imagens prÃ³prias: esta variaÃ§Ã£o herdarÃ¡ a galeria do produto principal no catÃ¡logo.</small>}
          <section className="pricing-builder price-formation">
            <div className="price-formation-head">
              <div>
                <span className="eyebrow">Formação de preço</span>
                <h3>Custos, estratégia e preço final</h3>
                <p>Calcule do custo para o preço ou estime o custo a partir do preço final informado.</p>
              </div>
              <span className={`price-state ${variant.cost_estimated || pricing.cost_estimated ? "estimated" : priceAdjusted ? "manual" : "auto"}`}>
                {variant.cost_estimated || pricing.cost_estimated ? "Custo estimado" : priceAdjusted ? "Preço ajustado manualmente" : "Preço automático"}
              </span>
            </div>
            <div className="price-formation-grid">
              <div className="price-box">
                <strong>Custos</strong>
                <div className="form-grid">
                  <Input type="number" label="Custo da Joia" value={variant.purchase_cost || variant.cost_value} onChange={(value) => updatePricing({ purchase_cost: value, cost_value: value, price_manually_overridden: false, cost_estimated: false })} />
                  <Input type="number" label="Frete Rateado" value={variant.allocated_freight} onChange={(value) => updatePricing({ allocated_freight: value, price_manually_overridden: false })} />
                  <Input type="number" label="Outros Custos" value={variant.additional_cost} onChange={(value) => updatePricing({ additional_cost: value, price_manually_overridden: false })} />
                  <div className="money-readout"><small>Custo total</small><b>{currency.format(centsToMoney(pricing.total_cost_cents))}</b></div>
                </div>
              </div>
              <div className="price-box">
                <strong>Estratégia de preço</strong>
                <div className="form-grid">
                  <Select label="Multiplicador" value={variant.price_multiplier || pricingSettings.default_price_multiplier || 3} onChange={(value) => updatePricing({ price_multiplier: Number(value), price_manually_overridden: false })}>
                    {PRICE_MULTIPLIER_OPTIONS.map((option) => <option key={option} value={option}>{option}x</option>)}
                  </Select>
                  <Select label="Arredondamento" value={variant.price_rounding_mode || pricingSettings.price_rounding_mode || "exact"} onChange={(value) => updatePricing({ price_rounding_mode: value, price_manually_overridden: false })}>
                    {PRICE_ROUNDING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                  <Input type="number" label="Preço Final de Venda" value={variant.sale_value} onChange={(value) => updatePricing({ sale_value: value, price_manually_overridden: true })} required />
                  <div className="pricing-actions-inline">
                    <Button variant="secondary" onClick={() => updatePricing({ sale_value: centsToMoney(pricing.suggested_price_cents), price_manually_overridden: false, cost_estimated: false })}>Usar preço sugerido</Button>
                    <Button variant="secondary" onClick={estimateCostFromSale}>Calcular custo pelo preço final</Button>
                  </div>
                </div>
              </div>
            </div>
            <div className="pricing-preview price-summary-cards">
              <span><small>Custo Total</small><strong>{currency.format(centsToMoney(pricing.total_cost_cents))}</strong></span>
              <span><small>Multiplicador</small><strong>{pricing.price_multiplier}x</strong></span>
              <span><small>Preço Sugerido</small><strong>{currency.format(centsToMoney(pricing.suggested_price_cents))}</strong></span>
              <span><small>Preço Final</small><strong>{currency.format(centsToMoney(pricing.sale_price_cents))}</strong></span>
              <span><small>Margem estimada</small><strong>{margin}%</strong></span>
            </div>
            {(variant.cost_estimated || pricing.cost_estimated) && <small className="pricing-note">Custo estimado a partir do preço final. Revise o custo real quando tiver a nota ou custo de compra.</small>}
          </section>
          <div className="form-grid">
            <Input type="number" label="Estoque Atual" value={variant.quantity} onChange={(value) => onChange({ quantity: value })} required />
            <Input type="number" label="Estoque Mínimo" value={variant.low_stock_threshold} onChange={(value) => onChange({ low_stock_threshold: value })} />
          </div>
          <Toggle label="Variação Ativa" checked={variant.is_active} onChange={(value) => onChange({ is_active: value })} />
        </div>
        <footer><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={onClose}>Salvar Variação</Button></footer>
      </section>
    </div>
  );
}

export function StockMovementHistory({ jewelryId }) {
  const { data } = useFetch(`/jewelry/${jewelryId}/movements`);
  const movements = data || [];
  return (
    <div className="movement-history">
      <h3>Histórico de movimentação</h3>
      <div className="movement-history-list">
        {movements.slice(0, 6).map((movement) => (
          <div key={movement.id}>
            <strong>{movement.movement_type}</strong>
            <span>{movement.quantity} un · {formatDate(movement.movement_date)}</span>
            {movement.notes && <small>{movement.notes}</small>}
          </div>
        ))}
        {!movements.length && <p className="empty-state">Nenhuma movimentação registrada.</p>}
      </div>
    </div>
  );
}

export function ToggleChip({ label, checked, onChange }) {
  return (
    <button type="button" className={`toggle-chip ${checked ? "active" : ""}`} onClick={() => onChange(!checked)}>
      {label}
    </button>
  );
}

export function StockMovementModal({ item, initialType = "Entrada", onClose, onSave }) {
  const [form, setForm] = useState({
    quantity: 1,
    movement_type: initialType,
    variant_id: item?.variants?.[0]?.id || "",
    notes: ""
  });

  useEffect(() => {
    setForm({
      quantity: 1,
      movement_type: initialType,
      variant_id: item?.variants?.[0]?.id || "",
      notes: ""
    });
  }, [item?.id, initialType]);

  if (!item) return null;

  async function submit(event) {
    event.preventDefault();
    await onSave({
      quantity: Math.max(1, Number(form.quantity || 0)),
      movement_type: form.movement_type,
      variant_id: form.variant_id,
      notes: form.notes,
      movement_date: new Date().toISOString().slice(0, 10)
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="panel stock-movement-modal" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <div className="panel-heading">
          <h2>{item.name}</h2>
          <span>{initialType === "Saída" ? "Saída rápida" : "Entrada rápida"}</span>
        </div>
        <div className="form-grid">
          <Select label="Variação" value={form.variant_id} onChange={(value) => setForm({ ...form, variant_id: value })} required>
            {(item.variants || []).map((variant) => (
              <option key={variant.id} value={variant.id}>{variant.variation_name || variant.sku} · {variant.quantity} un</option>
            ))}
          </Select>
          <Input type="number" label="Quantidade" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} required />
          <Select label="Tipo" value={form.movement_type} onChange={(value) => setForm({ ...form, movement_type: value })} required>
            <option>Entrada</option>
            <option>Saída</option>
            <option>Venda</option>
            <option>Ajuste</option>
            <option>Perda</option>
          </Select>
        </div>
        <label>Observação
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
        <p className="movement-date-hint">Data automática: {new Date().toLocaleDateString("pt-BR")}</p>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit">Salvar movimentação</Button>
        </div>
      </form>
    </div>
  );
}

export function InventoryManagement({ options, professionals, onChanged }) {
  return (
    <div className="management-grid">
      <article className="manager-card">
        <h3>Categorias Principais</h3>
        <p className="manager-help">Estrutura fixa para evitar produtos duplicados e manter o catálogo organizado.</p>
        <div className="manager-list fixed-category-list">
          {JEWELRY_CATEGORY_OPTIONS.map((category) => <div key={category}><span>{category}</span></div>)}
        </div>
      </article>
      <OptionManager title="Tamanhos" type="size" items={options.size} onChanged={onChanged} placeholder="Ex.: 12mm" />
      <OptionManager title="Espessuras" type="thickness" items={options.thickness} onChanged={onChanged} placeholder="Ex.: 2.0mm" />
      <ProfessionalManager professionals={professionals} onChanged={onChanged} />
    </div>
  );
}

export function OptionManager({ title, type, items = [], onChanged, placeholder }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
  const formId = `option-${type}-form`;

  function openNew() {
    setEditing(null);
    setName("");
    setError("");
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setName(item.name);
    setError("");
    setModalOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(`/inventory-options${editing ? `/${editing.id}` : ""}`, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, name })
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar.");
    setName("");
    setEditing(null);
    setModalOpen(false);
    onChanged();
  }

  function remove(item) {
    setDeleting({
      message: `Remover ${item.name}?`,
      run: async () => {
        setError("");
        const response = await apiFetch(`/inventory-options/${item.id}`, { method: "DELETE" });
        if (!response.ok) return setError((await response.json()).error || "Não foi possível apagar.");
        onChanged();
      }
    });
  }

  return (
    <article className="manager-card">
      <CrudHeader title={title} actionLabel="Novo" onAction={openNew} />
      {error && !modalOpen && <span className="form-error">{error}</span>}
      <DataTable
        rows={asArray(items)}
        columns={[{ key: "name", label: "Nome" }]}
        actions={(item) => (
          <>
            <button type="button" onClick={() => openEdit(item)}>Editar</button>
            <button type="button" onClick={() => remove(item)}>Apagar</button>
          </>
        )}
        empty="Nenhum registro cadastrado ainda."
      />
      <Modal
        open={modalOpen}
        title={editing ? `Editar ${title.toLowerCase()}` : `Novo em ${title.toLowerCase()}`}
        onClose={() => setModalOpen(false)}
        footer={(
          <>
            <button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>Cancelar</button>
            <button type="submit" form={formId} className="primary-button">{editing ? "Salvar" : "Criar"}</button>
          </>
        )}
      >
        <form id={formId} onSubmit={save}>
          <Input label={title} value={name} onChange={setName} placeholder={placeholder} required />
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>
      <ConfirmDeleteModal
        open={!!deleting}
        message={deleting?.message}
        confirmWord={deleting?.confirmWord}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await deleting.run(); setDeleting(null); }}
      />
    </article>
  );
}

export function ProfessionalManager({ professionals = [], onChanged }) {
  const [form, setForm] = useState({ name: "", specialty: "" });
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);

  function openNew() {
    setEditing(null);
    setForm({ name: "", specialty: "" });
    setError("");
    setModalOpen(true);
  }

  function openEdit(professional) {
    setEditing(professional);
    setForm({ name: professional.name, specialty: professional.specialty || "" });
    setError("");
    setModalOpen(true);
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    const response = await apiFetch(`/professionals${editing ? `/${editing.id}` : ""}`, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    if (!response.ok) return setError((await response.json()).error || "Não foi possível salvar.");
    setForm({ name: "", specialty: "" });
    setEditing(null);
    setModalOpen(false);
    onChanged();
  }

  function remove(professional) {
    setDeleting({
      message: `Remover ${professional.name}?`,
      run: async () => {
        setError("");
        const response = await apiFetch(`/professionals/${professional.id}`, { method: "DELETE" });
        if (!response.ok) return setError((await response.json()).error || "Não foi possível apagar.");
        onChanged();
      }
    });
  }

  return (
    <article className="manager-card professionals-manager">
      <CrudHeader title="Profissionais" actionLabel="Novo profissional" onAction={openNew} />
      {error && !modalOpen && <span className="form-error">{error}</span>}
      <DataTable
        rows={asArray(professionals)}
        columns={[
          { key: "name", label: "Nome" },
          { key: "specialty", label: "Especialidade" }
        ]}
        actions={(professional) => (
          <>
            <button type="button" onClick={() => openEdit(professional)}>Editar</button>
            <button type="button" onClick={() => remove(professional)}>Apagar</button>
          </>
        )}
        empty="Nenhum profissional cadastrado ainda."
      />
      <Modal
        open={modalOpen}
        title={editing ? "Editar profissional" : "Novo profissional"}
        onClose={() => setModalOpen(false)}
        footer={(
          <>
            <button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>Cancelar</button>
            <button type="submit" form="professional-form" className="primary-button">{editing ? "Salvar" : "Criar"}</button>
          </>
        )}
      >
        <form id="professional-form" onSubmit={save}>
          <div className="form-grid">
            <Input label="Nome" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
            <Input label="Especialidade" value={form.specialty} onChange={(value) => setForm({ ...form, specialty: value })} />
          </div>
          {error && <span className="form-error">{error}</span>}
        </form>
      </Modal>
      <ConfirmDeleteModal
        open={!!deleting}
        message={deleting?.message}
        confirmWord={deleting?.confirmWord}
        onClose={() => setDeleting(null)}
        onConfirm={async () => { await deleting.run(); setDeleting(null); }}
      />
    </article>
  );
}

export function JewelryTable({ items, onOpen, onEdit, onMovement, onArchive }) {
  const safeItems = asArray(items);
  return (
    <div className="table-wrap inventory-admin-table compact-inventory-table">
      <table>
        <thead><tr><th>Produto</th><th>Variações</th><th>Estoque Total</th><th>Status</th><th>Venda</th><th>Ações</th></tr></thead>
        <tbody>{safeItems.map((item) => (
          <tr className="clickable-product-row" key={item.id} onClick={() => onOpen?.(item)}>
            <td>
              <div className="inventory-product-cell">
                <img src={catalogImageUrl(item.photo_url)} alt={elegantProductName(item.name)} />
                <span><strong>{elegantProductName(item.name)}</strong><small>{[item.category, item.subcategory].map(cleanDisplayText).filter(Boolean).join(" · ")}</small></span>
              </div>
            </td>
            <td>{item.variant_count || item.variants?.length || 0}</td>
            <td>{item.quantity}</td>
            <td><StatusBadge status={inventoryStatusLabel(item)} className={`inventory-status ${inventoryStatusClass(item)}`} /></td>
            <td>A partir de {currency.format(item.sale_value || 0)}</td>
            <td>
              <div className="table-actions">
                {onMovement && <button type="button" onClick={(event) => { event.stopPropagation(); onMovement(item, "Entrada"); }}>Entrada</button>}
                {onMovement && <button type="button" onClick={(event) => { event.stopPropagation(); onMovement(item, "Saída"); }}>Saída</button>}
                <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(item); }}>Editar</button>
                {onArchive && <button type="button" onClick={(event) => { event.stopPropagation(); onArchive(item); }}>Arquivar</button>}
              </div>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

