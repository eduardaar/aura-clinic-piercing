import { inventoryIntelligence } from "./inventoryIntelligence.js";

const filter = (key, label, type = "text", options) => Object.freeze({ key, label, type, ...(options ? { options } : {}) });
const PERIOD_FILTERS = [filter("from", "De", "date"), filter("to", "Até", "date")];
const STATUS_FILTER = filter("status", "Status", "text");
const columns = (...items) => items.map(([key, label, kind]) => Object.freeze({ key, label, ...(kind ? { kind } : {}) }));

export const REPORT_CATALOG = Object.freeze([
  { type: "appointments", label: "Agendamentos", category: "Atendimento", filters: [...PERIOD_FILTERS, STATUS_FILTER, filter("professional_id", "Profissional", "professional")] },
  { type: "services", label: "Serviços executados", category: "Atendimento", filters: PERIOD_FILTERS },
  { type: "cancellations", label: "Cancelamentos e recusas", category: "Atendimento", filters: [...PERIOD_FILTERS, filter("professional_id", "Profissional", "professional")] },
  { type: "digital_terms", label: "Termos digitais", category: "Clientes e clínico", pagination: "server", filters: [...PERIOD_FILTERS, filter("procedure", "Procedimento")], columns: columns(["id", "ID"], ["signed_at", "Assinado em", "date"], ["client", "Cliente"], ["document_number", "CPF/documento"], ["procedure", "Procedimento"], ["piercing_region", "Região"], ["orientations_confirmed", "Orientações confirmadas", "boolean"], ["appointment_id", "Agendamento"]) },
  { type: "postcare", label: "Pós-atendimento", category: "Clientes e clínico", pagination: "server", filters: [...PERIOD_FILTERS, STATUS_FILTER, filter("healing_status", "Cicatrização")], columns: columns(["id", "ID"], ["due_date", "Data prevista", "date"], ["client", "Cliente"], ["reminder_day", "Dia do lembrete", "count"], ["healing_status", "Cicatrização"], ["status", "Status", "status"], ["updated_at", "Atualizado em", "date"]) },
  { type: "biosafety", label: "Biossegurança e rastreabilidade clínica", category: "Clientes e clínico", pagination: "server", filters: PERIOD_FILTERS, columns: columns(["id", "ID"], ["record_date", "Data", "date"], ["client", "Cliente"], ["appointment_id", "Agendamento"], ["jewelry_used", "Joia/material registrado"], ["before_photo", "Foto anterior", "boolean"], ["after_photo", "Foto posterior", "boolean"], ["guidance_recorded", "Orientações registradas", "boolean"], ["occurrence_recorded", "Intercorrência registrada", "boolean"]) },
  { type: "clients", label: "Clientes", category: "Clientes e clínico", filters: [] },
  { type: "sales", label: "Vendas", category: "Comercial", filters: [...PERIOD_FILTERS, STATUS_FILTER] },
  { type: "promotions", label: "Promoções", category: "Comercial", filters: PERIOD_FILTERS },
  { type: "coupons", label: "Cupons", category: "Comercial", filters: PERIOD_FILTERS },
  { type: "catalog_conversion", label: "Conversão do catálogo", category: "Comercial", filters: PERIOD_FILTERS },
  { type: "stock", label: "Posição de estoque", category: "Estoque e compras", filters: [filter("product_id", "Produto"), filter("category", "Categoria")] },
  { type: "stock_movements", label: "Movimentos de estoque", category: "Estoque e compras", pagination: "server", filters: [...PERIOD_FILTERS, filter("movement_type", "Tipo de movimento"), filter("item_type", "Tipo de item", "select", [{ value: "product", label: "Produto/joia" }, { value: "consumable", label: "Material de consumo" }])], columns: columns(["id", "ID"], ["movement_date", "Data", "date"], ["item_type", "Tipo de item"], ["item", "Item"], ["sku", "SKU"], ["movement_type", "Movimento"], ["quantity", "Quantidade", "count"], ["notes", "Observações"], ["purchase_order_id", "Compra"], ["sales_order_id", "Venda"]) },
  { type: "lots", label: "Lotes e validade", category: "Estoque e compras", pagination: "server", filters: [filter("expiry_from", "Validade de", "date"), filter("expiry_to", "Validade até", "date"), STATUS_FILTER, filter("consumable_id", "Material de consumo")], columns: columns(["id", "ID"], ["consumable", "Material de consumo"], ["batch_code", "Lote"], ["expiry_date", "Validade", "date"], ["received_quantity", "Quantidade recebida", "count"], ["remaining_quantity", "Saldo", "count"], ["unit_cost", "Custo unitário", "money"], ["status", "Status", "status"], ["purchase_order_id", "Compra"]) },
  { type: "abc", label: "Curva ABC de estoque", category: "Estoque e compras", filters: [filter("days", "Período em dias", "number")] },
  { type: "purchases", label: "Compras", category: "Estoque e compras", pagination: "server", filters: [...PERIOD_FILTERS, STATUS_FILTER, filter("supplier_id", "Fornecedor")], columns: columns(["id", "ID"], ["purchase_date", "Data da compra", "date"], ["supplier", "Fornecedor"], ["status", "Status", "status"], ["total_value", "Valor total", "money"], ["payment_method", "Forma de pagamento"], ["installment_count", "Parcelas", "count"], ["confirmed_at", "Confirmada em", "date"], ["created_by", "Criada por"]) },
  { type: "suppliers", label: "Fornecedores", category: "Estoque e compras", pagination: "server", filters: [STATUS_FILTER, filter("person_type", "Tipo de pessoa", "select", [{ value: "PJ", label: "Pessoa jurídica" }, { value: "PF", label: "Pessoa física" }]), filter("quality_status", "Homologação", "select", [{ value: "approved", label: "Aprovado" }, { value: "review", label: "Em análise" }, { value: "blocked", label: "Bloqueado" }])], columns: columns(["id", "ID"], ["name", "Fornecedor"], ["person_type", "Tipo"], ["document", "CPF/CNPJ"], ["contact_name", "Contato"], ["phone", "Telefone"], ["whatsapp", "WhatsApp"], ["email", "E-mail"], ["city", "Cidade"], ["state", "UF"], ["quality_status", "Homologação"], ["status", "Status", "status"], ["lead_time_days", "Prazo de entrega (dias)", "count"], ["minimum_order_value", "Pedido mínimo", "money"]) },
  { type: "financial", label: "Lançamentos financeiros", category: "Financeiro", filters: PERIOD_FILTERS },
  { type: "payables", label: "Contas a pagar", category: "Financeiro", pagination: "server", filters: [...PERIOD_FILTERS, STATUS_FILTER, filter("supplier_id", "Fornecedor"), filter("category", "Categoria")], columns: columns(["id", "ID"], ["due_date", "Vencimento", "date"], ["description", "Descrição"], ["supplier", "Fornecedor"], ["category", "Categoria"], ["amount", "Valor", "money"], ["paid_amount", "Valor pago", "money"], ["open_amount", "Saldo", "money"], ["status", "Status", "status"], ["payment_method", "Forma de pagamento"], ["source_type", "Origem"]) },
  { type: "receivables", label: "Contas a receber", category: "Financeiro", pagination: "server", filters: [...PERIOD_FILTERS, STATUS_FILTER, filter("category", "Categoria")], columns: columns(["id", "ID"], ["due_date", "Vencimento", "date"], ["description", "Descrição"], ["category", "Categoria"], ["amount", "Valor", "money"], ["paid_amount", "Valor recebido", "money"], ["open_amount", "Saldo", "money"], ["status", "Status", "status"], ["payment_method", "Forma de pagamento"], ["source_type", "Origem"]) },
  { type: "payments", label: "Pagamentos", category: "Financeiro", filters: [...PERIOD_FILTERS, STATUS_FILTER] },
  { type: "professionals", label: "Desempenho por profissional", category: "Gestão e auditoria", filters: [...PERIOD_FILTERS, filter("professional_id", "Profissional", "professional")] },
  { type: "commissions", label: "Comissões", category: "Gestão e auditoria", filters: [...PERIOD_FILTERS, filter("professional_id", "Profissional", "professional")] },
  { type: "users", label: "Usuários", category: "Gestão e auditoria", pagination: "server", filters: [STATUS_FILTER, filter("role", "Papel"), filter("profile_id", "Perfil")], columns: columns(["id", "ID"], ["name", "Usuário"], ["email", "E-mail"], ["role", "Papel"], ["profile", "Perfil de acesso"], ["professional", "Profissional"], ["status", "Status", "status"], ["mfa_enabled", "MFA", "boolean"], ["created_at", "Criado em", "date"]) },
  { type: "access_profiles", label: "Perfis de acesso", category: "Gestão e auditoria", pagination: "server", filters: [STATUS_FILTER, filter("base_role", "Papel-base")], columns: columns(["id", "ID"], ["name", "Perfil"], ["description", "Descrição"], ["base_role", "Papel-base"], ["permissions", "Permissões", "count"], ["users", "Usuários", "count"], ["status", "Status", "status"], ["updated_at", "Atualizado em", "date"]) },
  { type: "permissions", label: "Permissões", category: "Gestão e auditoria", pagination: "server", filters: [filter("scope", "Origem", "select", [{ value: "user", label: "Exceção do usuário" }, { value: "profile", label: "Perfil de acesso" }]), filter("allowed", "Decisão", "select", [{ value: "true", label: "Permitida" }, { value: "false", label: "Negada" }]), filter("permission", "Permissão")], columns: columns(["id", "ID"], ["scope", "Origem"], ["owner", "Usuário/perfil"], ["permission", "Permissão"], ["allowed", "Permitida", "boolean"], ["updated_at", "Atualizada em", "date"]) },
  { type: "audit", label: "Auditoria", category: "Gestão e auditoria", pagination: "server", filters: [...PERIOD_FILTERS, filter("user_id", "Usuário"), filter("module", "Módulo"), filter("action", "Ação"), filter("severity", "Severidade", "select", [{ value: "info", label: "Informativa" }, { value: "warning", label: "Atenção" }, { value: "critical", label: "Crítica" }])], columns: columns(["id", "ID"], ["created_at", "Data e hora", "date"], ["actor", "Usuário"], ["actor_email", "E-mail"], ["module", "Módulo"], ["action", "Ação"], ["entity_type", "Entidade"], ["entity_id", "Registro"], ["reason", "Motivo"], ["severity", "Severidade"] ) }
].map((report) => Object.freeze({ ...report, formats: ["pdf", "xlsx", "csv", "txt"] })));

const REPORT_TYPES = new Set(REPORT_CATALOG.map(({ type }) => type));

export function getReportDefinition(type) {
  return REPORT_CATALOG.find((report) => report.type === type) || null;
}

// O relatório básico abre a central; alguns tipos revelam dados ou ações de
// módulos vendidos separadamente e precisam conservar esses gates também em
// exportações assíncronas.
export const REPORT_FEATURE_REQUIREMENTS = Object.freeze({
  financial: ["basic_finance"],
  payables: ["basic_finance"],
  receivables: ["basic_finance"],
  purchases: ["basic_finance"],
  payments: ["basic_finance"],
  commissions: ["commissions", "basic_finance"],
  promotions: ["campaigns"],
  coupons: ["coupons"],
  catalog_conversion: ["catalog_analytics"]
});

export function validReportType(type) {
  return REPORT_TYPES.has(type);
}

function period(filters = {}) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    from: /^\d{4}-\d{2}-\d{2}$/.test(filters.from) ? filters.from : `${today.slice(0, 7)}-01`,
    to: /^\d{4}-\d{2}-\d{2}$/.test(filters.to) ? filters.to : today
  };
}

const toInteger = (value, fallback = 0) => Number.isInteger(Number(value)) ? Number(value) : fallback;

async function pagedQuery(db, baseSql, baseParams, filters, options) {
  const search = String(filters.search || "").trim();
  const searchColumns = options.searchColumns || [];
  const searchSql = search && searchColumns.length
    ? ` WHERE (${searchColumns.map((name) => `CAST(${name} AS TEXT) ILIKE ?`).join(" OR ")})`
    : "";
  const params = [...baseParams, ...(searchSql ? searchColumns.map(() => `%${search}%`) : [])];
  const requestedSort = String(filters.sort || "").split(":");
  const sortColumn = options.sortColumns?.[requestedSort[0]] || options.defaultSort;
  const direction = requestedSort[1] === "asc" ? "ASC" : "DESC";
  const order = `${sortColumn} ${direction}${sortColumn === "id" ? "" : ", id DESC"}`;
  const paginated = filters.paginated !== false;
  const limit = Math.min(Math.max(toInteger(filters.limit, 25), 1), 100);
  const offset = Math.max(toInteger(filters.offset, 0), 0);
  const countRow = await db.get(`SELECT COUNT(*) AS total_rows FROM (${baseSql}) report_rows${searchSql}`, params);
  const rows = await db.all(
    `SELECT * FROM (${baseSql}) report_rows${searchSql} ORDER BY ${order}${paginated ? " LIMIT ? OFFSET ?" : ""}`,
    paginated ? [...params, limit, offset] : params
  );
  return { rows, total_rows: Number(countRow?.total_rows || 0), limit: paginated ? limit : Number(countRow?.total_rows || 0), offset: paginated ? offset : 0 };
}

export async function buildReport(db, type, filters = {}) {
  if (!validReportType(type)) throw new Error("Relatório inválido.");
  const { from, to } = period(filters);
  const status = String(filters.status || "");
  const professionalId = Number(filters.professional_id || 0);
  const productId = Number(filters.product_id || 0);
  const category = String(filters.category || "");
  let rows = [];
  let pageMeta = null;
  const setPaged = async (sql, params, options) => {
    pageMeta = await pagedQuery(db, sql, params, filters, options);
    rows = pageMeta.rows;
  };
  if (type === "purchases") {
    const clauses = ["po.purchase_date BETWEEN ? AND ?"];
    const params = [from, to];
    if (status) { clauses.push("po.status=?"); params.push(status); }
    const supplierId = toInteger(filters.supplier_id);
    if (supplierId) { clauses.push("po.supplier_id=?"); params.push(supplierId); }
    await setPaged(`
      SELECT po.id,po.purchase_date,s.name AS supplier,po.status,po.total_value,po.payment_method,
        po.installment_count,po.confirmed_at,u.name AS created_by
      FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
      LEFT JOIN users u ON u.id=po.created_by_user_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["supplier", "status", "payment_method", "created_by"], sortColumns: { id: "id", purchase_date: "purchase_date", supplier: "supplier", status: "status", total_value: "total_value" }, defaultSort: "purchase_date" });
  } else if (type === "suppliers") {
    const clauses = ["1=1"];
    const params = [];
    if (status) { clauses.push("s.is_active=?"); params.push(status === "active" || status === "ativo" ? 1 : 0); }
    if (filters.person_type) { clauses.push("s.person_type=?"); params.push(String(filters.person_type)); }
    if (filters.quality_status) { clauses.push("s.quality_status=?"); params.push(String(filters.quality_status)); }
    await setPaged(`
      SELECT s.id,s.name,s.person_type,s.document,s.contact_name,s.phone,s.whatsapp,s.email,s.city,s.state,
        s.quality_status,CASE WHEN s.is_active=1 THEN 'active' ELSE 'inactive' END AS status,
        s.lead_time_days,s.minimum_order_value
      FROM suppliers s WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["name", "document", "contact_name", "phone", "whatsapp", "email", "city", "state"], sortColumns: { id: "id", name: "name", status: "status", quality_status: "quality_status", city: "city" }, defaultSort: "name" });
  } else if (type === "payables" || type === "receivables") {
    const entryType = type === "payables" ? "payable" : "receivable";
    const clauses = ["fe.entry_type=?", "fe.due_date BETWEEN ? AND ?", "fe.lifecycle_status='active'"];
    const params = [entryType, from, to];
    if (status) { clauses.push("fe.status=?"); params.push(status); }
    if (category) { clauses.push("fe.category=?"); params.push(category); }
    const supplierId = toInteger(filters.supplier_id);
    if (type === "payables" && supplierId) { clauses.push("fe.supplier_id=?"); params.push(supplierId); }
    await setPaged(`
      SELECT fe.id,fe.due_date,fe.description,s.name AS supplier,fe.category,fe.amount,fe.paid_amount,
        GREATEST(fe.amount-fe.paid_amount,0) AS open_amount,fe.status,fe.payment_method,fe.source_type
      FROM financial_entries fe LEFT JOIN suppliers s ON s.id=fe.supplier_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["description", "supplier", "category", "status", "payment_method", "source_type"], sortColumns: { id: "id", due_date: "due_date", description: "description", supplier: "supplier", amount: "amount", open_amount: "open_amount", status: "status" }, defaultSort: "due_date" });
  } else if (type === "stock_movements") {
    const movementType = String(filters.movement_type || "");
    const itemType = String(filters.item_type || "");
    const params = [from, to];
    let sql = `SELECT sm.id,sm.movement_date,
        CASE WHEN j.can_sell THEN 'product' ELSE 'consumable' END AS item_type,
        j.name AS item,COALESCE(v.sku,j.sku) AS sku,sm.movement_type,sm.quantity,
        sm.notes,sm.purchase_order_id,sm.sales_order_id
      FROM stock_movements sm JOIN jewelry_inventory j ON j.id=sm.jewelry_id
      LEFT JOIN jewelry_variants v ON v.id=sm.variant_id
      WHERE SUBSTRING(sm.movement_date,1,10) BETWEEN ? AND ?`;
    if (movementType) { sql += " AND sm.movement_type=?"; params.push(movementType); }
    if (itemType === "product") sql += " AND j.can_sell=true";
    if (itemType === "consumable") sql += " AND j.can_sell=false AND j.can_use_in_service=true";
    await setPaged(sql, params, { searchColumns: ["item", "sku", "movement_type", "notes"], sortColumns: { id: "id", movement_date: "movement_date", item: "item", item_type: "item_type", movement_type: "movement_type", quantity: "quantity" }, defaultSort: "movement_date" });
  } else if (type === "lots") {
    const clauses = ["1=1"];
    const params = [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(filters.expiry_from || "")) { clauses.push("lot.expiry_date>=?"); params.push(filters.expiry_from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(filters.expiry_to || "")) { clauses.push("lot.expiry_date<=?"); params.push(filters.expiry_to); }
    const consumableId = toInteger(filters.consumable_id);
    if (consumableId) { clauses.push("lot.inventory_item_id=?"); params.push(consumableId); }
    const lotStatus = `CASE WHEN lot.active=false THEN 'inactive' WHEN lot.remaining_quantity=0 THEN 'exhausted' WHEN lot.expiry_date<CURRENT_DATE THEN 'expired' WHEN lot.expiry_date<=CURRENT_DATE+30 THEN 'expiring' ELSE 'available' END`;
    if (status) { clauses.push(`${lotStatus}=?`); params.push(status); }
    await setPaged(`
      SELECT lot.id,item.name AS consumable,lot.batch_code,lot.expiry_date,lot.received_quantity,lot.remaining_quantity,
        lot.unit_cost,${lotStatus} AS status,lot.purchase_order_id
      FROM inventory_item_lots lot JOIN jewelry_inventory item ON item.id=lot.inventory_item_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["consumable", "batch_code", "status"], sortColumns: { id: "id", consumable: "consumable", batch_code: "batch_code", expiry_date: "expiry_date", remaining_quantity: "remaining_quantity", status: "status" }, defaultSort: "expiry_date" });
  } else if (type === "digital_terms") {
    const clauses = ["SUBSTRING(dt.signed_at,1,10) BETWEEN ? AND ?"];
    const params = [from, to];
    if (filters.procedure) { clauses.push("dt.procedure ILIKE ?"); params.push(`%${String(filters.procedure).trim()}%`); }
    await setPaged(`
      SELECT dt.id,dt.signed_at,c.full_name AS client,dt.document_number,dt.procedure,dt.piercing_region,
        CASE WHEN dt.orientations_confirmed=1 THEN true ELSE false END AS orientations_confirmed,dt.appointment_id
      FROM digital_terms dt JOIN clients c ON c.id=dt.client_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["client", "document_number", "procedure", "piercing_region"], sortColumns: { id: "id", signed_at: "signed_at", client: "client", procedure: "procedure" }, defaultSort: "signed_at" });
  } else if (type === "postcare") {
    const clauses = ["pc.due_date BETWEEN ? AND ?"];
    const params = [from, to];
    if (status) { clauses.push("pc.status=?"); params.push(status); }
    if (filters.healing_status) { clauses.push("pc.healing_status ILIKE ?"); params.push(`%${String(filters.healing_status).trim()}%`); }
    await setPaged(`
      SELECT pc.id,pc.due_date,c.full_name AS client,pc.reminder_day,pc.healing_status,pc.status,pc.updated_at
      FROM post_care_followups pc JOIN clients c ON c.id=pc.client_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["client", "healing_status", "status"], sortColumns: { id: "id", due_date: "due_date", client: "client", reminder_day: "reminder_day", status: "status", updated_at: "updated_at" }, defaultSort: "due_date" });
  } else if (type === "biosafety") {
    await setPaged(`
      SELECT mr.id,mr.record_date,c.full_name AS client,mr.appointment_id,mr.jewelry_used,
        (NULLIF(mr.before_photo_url,'') IS NOT NULL) AS before_photo,
        (NULLIF(mr.after_photo_url,'') IS NOT NULL) AS after_photo,
        (NULLIF(mr.guidance,'') IS NOT NULL) AS guidance_recorded,
        (NULLIF(mr.occurrences,'') IS NOT NULL) AS occurrence_recorded
      FROM client_medical_records mr JOIN clients c ON c.id=mr.client_id
      WHERE mr.record_date BETWEEN ? AND ?
    `, [from, to], { searchColumns: ["client", "jewelry_used"], sortColumns: { id: "id", record_date: "record_date", client: "client", appointment_id: "appointment_id" }, defaultSort: "record_date" });
  } else if (type === "users") {
    const clauses = ["1=1"];
    const params = [];
    if (status) { clauses.push("u.status=?"); params.push(status); }
    if (filters.role) { clauses.push("u.role=?"); params.push(String(filters.role)); }
    const profileId = toInteger(filters.profile_id);
    if (profileId) { clauses.push("u.access_profile_id=?"); params.push(profileId); }
    await setPaged(`
      SELECT u.id,u.name,u.email,u.role,ap.name AS profile,p.name AS professional,u.status,u.mfa_enabled,u.created_at
      FROM users u LEFT JOIN access_profiles ap ON ap.id=u.access_profile_id
      LEFT JOIN professionals p ON p.id=u.professional_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["name", "email", "role", "profile", "professional", "status"], sortColumns: { id: "id", name: "name", email: "email", role: "role", profile: "profile", status: "status", created_at: "created_at" }, defaultSort: "name" });
  } else if (type === "access_profiles") {
    const clauses = ["1=1"];
    const params = [];
    if (status) { clauses.push("ap.is_active=?"); params.push(status === "active" || status === "ativo"); }
    if (filters.base_role) { clauses.push("ap.base_role=?"); params.push(String(filters.base_role)); }
    await setPaged(`
      SELECT ap.id,ap.name,ap.description,ap.base_role,COUNT(DISTINCT app.permission) AS permissions,
        COUNT(DISTINCT u.id) AS users,CASE WHEN ap.is_active THEN 'active' ELSE 'inactive' END AS status,ap.updated_at
      FROM access_profiles ap LEFT JOIN access_profile_permissions app ON app.profile_id=ap.id AND app.allowed=true
      LEFT JOIN users u ON u.access_profile_id=ap.id WHERE ${clauses.join(" AND ")}
      GROUP BY ap.id,ap.name,ap.description,ap.base_role,ap.is_active,ap.updated_at
    `, params, { searchColumns: ["name", "description", "base_role", "status"], sortColumns: { id: "id", name: "name", base_role: "base_role", permissions: "permissions", users: "users", status: "status", updated_at: "updated_at" }, defaultSort: "name" });
  } else if (type === "permissions") {
    const permission = String(filters.permission || "").trim();
    const scope = String(filters.scope || "");
    const allowed = ["true", "false"].includes(String(filters.allowed)) ? String(filters.allowed) : "";
    const params = [];
    let sql = `SELECT * FROM (
      SELECT ('user:'||up.id::text) AS id,'user' AS scope,u.name AS owner,up.permission,up.allowed,up.updated_at
      FROM user_permissions up JOIN users u ON u.id=up.user_id
      UNION ALL
      SELECT ('profile:'||app.profile_id::text||':'||app.permission) AS id,'profile' AS scope,ap.name AS owner,app.permission,app.allowed,app.created_at AS updated_at
      FROM access_profile_permissions app JOIN access_profiles ap ON ap.id=app.profile_id
    ) permission_source WHERE 1=1`;
    if (scope) { sql += " AND scope=?"; params.push(scope); }
    if (allowed) { sql += " AND allowed=?"; params.push(allowed === "true"); }
    if (permission) { sql += " AND permission ILIKE ?"; params.push(`%${permission}%`); }
    await setPaged(sql, params, { searchColumns: ["owner", "permission", "scope"], sortColumns: { id: "id", scope: "scope", owner: "owner", permission: "permission", allowed: "allowed", updated_at: "updated_at" }, defaultSort: "updated_at" });
  } else if (type === "audit") {
    const clauses = ["ae.created_at::date BETWEEN ?::date AND ?::date"];
    const params = [from, to];
    const userId = toInteger(filters.user_id);
    if (userId) { clauses.push("ae.actor_user_id=?"); params.push(userId); }
    for (const key of ["module", "action", "severity"]) {
      if (filters[key]) { clauses.push(`ae.${key}=?`); params.push(String(filters[key])); }
    }
    await setPaged(`
      SELECT ae.id,ae.created_at,COALESCE(ae.actor_name,u.name) AS actor,COALESCE(ae.actor_email,u.email) AS actor_email,
        ae.module,ae.action,ae.entity_type,ae.entity_id,ae.reason,ae.severity
      FROM audit_events ae LEFT JOIN users u ON u.id=ae.actor_user_id WHERE ${clauses.join(" AND ")}
    `, params, { searchColumns: ["actor", "actor_email", "module", "action", "entity_type", "entity_id", "reason", "severity"], sortColumns: { id: "id", created_at: "created_at", actor: "actor", module: "module", action: "action", entity_type: "entity_type", severity: "severity" }, defaultSort: "created_at" });
  } else if (type === "financial") {
    rows = await db.all("SELECT entry_type, description, category, amount, paid_amount, due_date, status, payment_method, source_type FROM financial_entries WHERE competence_date BETWEEN ? AND ? ORDER BY due_date", [from, to]);
  } else if (type === "sales") {
    rows = await db.all(`
      SELECT so.id, c.full_name AS client, so.order_type, so.source, so.status, so.payment_method, so.total_value, so.created_at
      FROM sales_orders so JOIN clients c ON c.id=so.client_id
      WHERE SUBSTRING(so.created_at,1,10) BETWEEN ? AND ? ${status ? "AND so.status=?" : ""}
      ORDER BY so.created_at DESC
    `, status ? [from, to, status] : [from, to]);
  } else if (type === "stock") {
    const clauses = ["j.status!='arquivado'"];
    const params = [];
    if (productId) { clauses.push("j.id=?"); params.push(productId); }
    if (category) { clauses.push("j.category=?"); params.push(category); }
    rows = await db.all(`SELECT j.id, j.name, j.sku, j.category, j.material, j.color, j.quantity, j.cost_value, j.sale_value, j.status, j.supplier FROM jewelry_inventory j WHERE ${clauses.join(" AND ")} ORDER BY j.category,j.name`, params);
  } else if (type === "services") {
    const serviceParams = [from, to];
    const professionalClause = professionalId ? "AND a.professional_id=?" : "";
    if (professionalId) serviceParams.push(professionalId);
    rows = await db.all(`
      SELECT COALESCE(s.name,a.procedure) AS service, COUNT(*) AS appointments,
        COALESCE(SUM(a.total_value),0) AS revenue, COALESCE(AVG(a.total_value),0) AS average_ticket
      FROM appointments a LEFT JOIN services s ON s.id=a.service_id
      WHERE a.appointment_date BETWEEN ? AND ? AND a.status NOT IN ('cancelado','recusado','remarcado','nao_compareceu') ${professionalClause}
      GROUP BY COALESCE(s.name,a.procedure) ORDER BY revenue DESC
    `, serviceParams);
  } else if (type === "clients") {
    rows = await db.all(`
      SELECT c.id, c.full_name, c.whatsapp, c.instagram, c.birth_date, COUNT(a.id) AS appointments,
        COALESCE(SUM(CASE WHEN a.status='atendido' THEN a.total_value ELSE 0 END),0) AS lifetime_value,
        MAX(a.appointment_date) AS last_visit
      FROM clients c LEFT JOIN appointments a ON a.client_id=c.id
      GROUP BY c.id ORDER BY lifetime_value DESC
    `);
  } else if (type === "professionals" || type === "commissions") {
    rows = await db.all(`
      WITH calendar AS (
        SELECT d::date AS work_date, EXTRACT(DOW FROM d)::integer AS weekday
        FROM generate_series(?::date, ?::date, interval '1 day') d
      ), availability AS (
        SELECT pa.professional_id,
          COUNT(DISTINCT c.work_date) AS availability_days,
          COALESCE(SUM(EXTRACT(EPOCH FROM (pa.end_time::time-pa.start_time::time))/3600
            - CASE WHEN pa.lunch_start IS NOT NULL AND pa.lunch_end IS NOT NULL
              THEN EXTRACT(EPOCH FROM (pa.lunch_end::time-pa.lunch_start::time))/3600 ELSE 0 END),0) AS available_hours
        FROM professional_availability pa JOIN calendar c ON c.weekday=pa.weekday
        WHERE pa.is_active=1 GROUP BY pa.professional_id
      ), production AS (
        SELECT a.professional_id,
          COUNT(*) AS appointments,
          COUNT(*) FILTER (WHERE a.status='atendido') AS completed_appointments,
          COUNT(*) FILTER (WHERE a.status IN ('cancelado','recusado')) AS cancellations,
          COUNT(*) FILTER (WHERE a.status IN ('falta','nao_compareceu')) AS no_shows,
          COUNT(DISTINCT a.appointment_date) AS appointment_days,
          COALESCE(SUM(a.duration_minutes) FILTER (WHERE a.status='atendido'),0)/60.0 AS occupied_hours,
          COALESCE(SUM(a.service_value) FILTER (WHERE a.status='atendido'),0) AS service_revenue,
          COALESCE(SUM(a.jewelry_value) FILTER (WHERE a.status='atendido'),0) AS jewelry_revenue,
          COALESCE(SUM(a.total_value) FILTER (WHERE a.status='atendido'),0) AS revenue
        FROM appointments a WHERE a.appointment_date BETWEEN ? AND ? GROUP BY a.professional_id
      ), sold AS (
        SELECT se.professional_id,
          COALESCE(SUM(sei.quantity) FILTER (WHERE sei.item_type='product'),0) AS products_sold,
          COALESCE(SUM(sei.quantity) FILTER (WHERE sei.product_id IS NOT NULL),0) AS jewelry_sold
        FROM service_executions se
        JOIN service_execution_items sei ON sei.service_execution_id=se.id
        WHERE se.completed_at::date BETWEEN ?::date AND ?::date AND se.status='completed'
        GROUP BY se.professional_id
      )
      SELECT p.id, p.name AS professional,
        GREATEST(COALESCE(av.availability_days,0),COALESCE(pr.appointment_days,0)) AS worked_days,
        -- O ::numeric aqui NÃO é sobra da migração de dinheiro: estas duas
        -- colunas são HORAS, não reais, e continuam vindo de EXTRACT(EPOCH...),
        -- que devolve double precision no Postgres 13 e numeric a partir do 14.
        -- Como round(double precision, int) não existe, o cast é o que impede
        -- a query de quebrar conforme a versão do servidor. Mantê-lo.
        ROUND(COALESCE(av.available_hours,0)::numeric,2) AS available_hours,
        ROUND(COALESCE(pr.occupied_hours,0)::numeric,2) AS occupied_hours,
        COALESCE(pr.appointments,0) AS appointments,
        COALESCE(pr.completed_appointments,0) AS completed_appointments,
        COALESCE(pr.cancellations,0) AS cancellations, COALESCE(pr.no_shows,0) AS no_shows,
        COALESCE(s.jewelry_sold,0) AS jewelry_sold, COALESCE(s.products_sold,0) AS products_sold,
        COALESCE(pr.service_revenue,0) AS service_revenue, COALESCE(pr.jewelry_revenue,0) AS jewelry_revenue,
        COALESCE(pr.revenue,0) AS revenue,
        -- Ticket médio e comissão são DINHEIRO derivado de dinheiro. Com
        -- total_value e commission_percentage em NUMERIC, a divisão e o
        -- produto acontecem em decimal exato e o ROUND(...,2) -- que só existe
        -- para numeric, nunca para double precision -- fecha o valor em centavos
        -- aqui, em vez de deixar dízima viajar até a tela.
        CASE WHEN COALESCE(pr.completed_appointments,0)>0 THEN ROUND(pr.revenue/pr.completed_appointments,2) ELSE 0 END AS average_ticket,
        COALESCE(p.commission_percentage,0) AS commission_percentage,
        ROUND(COALESCE(pr.revenue,0)*COALESCE(p.commission_percentage,0)/100,2) AS commission,
        CASE WHEN COALESCE(av.available_hours,0)>0 THEN LEAST(100,pr.occupied_hours*100/av.available_hours) ELSE 0 END AS occupancy_rate,
        CASE WHEN COALESCE(pr.appointments,0)>0 THEN pr.completed_appointments*100.0/pr.appointments ELSE 0 END AS attendance_rate
      FROM professionals p LEFT JOIN availability av ON av.professional_id=p.id
      LEFT JOIN production pr ON pr.professional_id=p.id LEFT JOIN sold s ON s.professional_id=p.id
      ${professionalId ? "WHERE p.id=?" : ""} ORDER BY revenue DESC, p.name
    `, professionalId ? [from, to, from, to, from, to, professionalId] : [from, to, from, to, from, to]);
  } else if (type === "appointments" || type === "cancellations") {
    const clauses = ["a.appointment_date BETWEEN ? AND ?"];
    const params = [from, to];
    if (type === "cancellations") clauses.push("a.status IN ('cancelado','recusado')");
    else if (status) { clauses.push("a.status=?"); params.push(status); }
    if (professionalId) { clauses.push("a.professional_id=?"); params.push(professionalId); }
    rows = await db.all(`
      SELECT a.id, a.appointment_date, a.appointment_time, c.full_name AS client, p.name AS professional,
        a.procedure, a.status, a.source, a.total_value, a.deposit_value, a.remaining_value
      FROM appointments a JOIN clients c ON c.id=a.client_id JOIN professionals p ON p.id=a.professional_id
      WHERE ${clauses.join(" AND ")} ORDER BY a.appointment_date,a.appointment_time
    `, params);
  } else if (type === "promotions") {
    rows = await db.all(`
      SELECT p.id,p.name,p.discount_type,p.status,p.start_date,p.end_date,p.usage_limit,
        COUNT(u.id) AS uses,COALESCE(SUM(u.discount_amount),0) AS discount_total
      FROM catalog_promotions p LEFT JOIN promotion_usages u ON u.promotion_id=p.id AND SUBSTRING(CAST(u.created_at AS TEXT),1,10) BETWEEN ? AND ?
      GROUP BY p.id ORDER BY uses DESC
    `, [from, to]);
  } else if (type === "coupons") {
    rows = await db.all(`
      SELECT c.id,c.code,c.internal_name AS name,c.status,c.discount_type,c.discount_value,c.usage_limit,
        COUNT(u.id) AS uses,COALESCE(SUM(u.discount_amount),0) AS discount_total
      FROM coupons c LEFT JOIN coupon_usages u ON u.coupon_id=c.id AND SUBSTRING(CAST(u.created_at AS TEXT),1,10) BETWEEN ? AND ?
      GROUP BY c.id ORDER BY uses DESC
    `, [from, to]);
  } else if (type === "payments") {
    rows = await db.all(`
      SELECT p.id,c.full_name AS client,p.amount,p.payment_type,p.method,p.status,p.paid_at
      FROM payments p JOIN clients c ON c.id=p.client_id
      WHERE SUBSTRING(p.paid_at,1,10) BETWEEN ? AND ? ${status ? "AND p.status=?" : ""}
      ORDER BY p.paid_at DESC
    `, status ? [from, to, status] : [from, to]);
  } else if (type === "catalog_conversion") {
    rows = await db.all(`
      SELECT event_type,COUNT(*) AS events,COUNT(DISTINCT session_key) AS unique_sessions
      FROM catalog_events WHERE SUBSTRING(occurred_at,1,10) BETWEEN ? AND ?
      GROUP BY event_type ORDER BY events DESC
    `, [from, to]);
  } else if (type === "abc") {
    const days = Math.min(Math.max(Number(filters.days || 90), 1), 3650);
    const metrics = await inventoryIntelligence(db, days);
    rows = metrics.map(({ name, sku, abc_class, units_out, movement_value, daily_demand, days_to_stockout }) => ({
      name, sku, abc_class, units_out, movement_value, daily_demand, days_to_stockout
    }));
  }
  return { type, from, to, rows, total_rows: pageMeta?.total_rows ?? rows.length, ...(pageMeta ? { limit: pageMeta.limit, offset: pageMeta.offset } : {}), generated_at: new Date().toISOString() };
}
