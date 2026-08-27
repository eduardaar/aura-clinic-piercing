// Homologacao destrutiva somente em tenant QA criado por este script.
// Todas as escritas de negocio passam pelos endpoints HTTP; o banco e usado
// apenas para reconciliacao final. O tenant e preservado para inspecao visual.
import { req } from "../tests/helpers.mjs";
import { withTenantSchema } from "../src/db/tenantSession.js";
import { pool } from "../src/database/connection.js";

const run = Date.now().toString(36);
const password = "AuraQA!44953695";
const adminEmail = `qa.admin.${run}@aurora-teste.local`;
const clinicName = `QA Estudio Aurora ${run}`;
const results = [];
const ids = {};
const roleTokens = {};
let slug = "";
let tenant = null;
let token = "";

function items(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : [];
}

function check(caseId, description, condition, detail = null) {
  results.push({ case: caseId, description, ok: Boolean(condition), detail });
  return Boolean(condition);
}

function money(value) {
  return Math.round(Number(value || 0) * 100);
}

async function call(path, options = {}) {
  return req(path, { tenant: slug, token, ...options });
}

async function expect(caseId, description, path, options, expected = [200, 201]) {
  const response = await call(path, options);
  check(caseId, description, expected.includes(response.status), {
    status: response.status,
    error: response.json?.error || null,
  });
  return response;
}

function nextWeekday(weekday, offset = 7) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  while (date.getDay() !== weekday) date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function stage(name, fn) {
  try {
    await fn();
  } catch (error) {
    check(name, `Etapa interrompida: ${name}`, false, { error: error.message });
  }
}

await stage("H-00", async () => {
  const legal = await req("/legal-documents");
  const legalAcceptances = Object.fromEntries((legal.json?.documents || [])
    .filter((doc) => ["terms_of_use", "privacy_policy"].includes(doc.key))
    .map((doc) => [doc.key, doc.version]));
  const availability = await req(`/signup/availability?name=${encodeURIComponent(clinicName)}&email=${encodeURIComponent(adminEmail)}`);
  check("H-00.1", "Nome e e-mail novos estao disponiveis antes do aceite", availability.status === 200 && availability.json?.available !== false, availability.json);
  const signup = await req("/signup", { method: "POST", body: {
    name: clinicName, admin_name: "Marina QA Souza", admin_email: adminEmail,
    admin_password: password, phone: "77990000001", city: "Vitoria da Conquista",
    state: "BA", plan: "profissional", legal_acceptances: legalAcceptances,
  }});
  if (signup.status !== 201) throw new Error(`Signup falhou: ${signup.status} ${JSON.stringify(signup.json)}`);
  tenant = signup.json.tenant;
  slug = tenant.slug;
  token = signup.json.token;
  check("H-00.2", "Signup cria tenant e login automatico", Boolean(tenant.id && slug && token), { tenant_id: tenant.id, slug });
  const login = await req("/login", { method: "POST", tenant: slug, body: { email: adminEmail, password } });
  check("H-00.3", "Segundo login funciona", login.status === 200 && login.json?.user?.role === "admin", { status: login.status, role: login.json?.user?.role });
  if (login.json?.token) token = login.json.token;
  const empty = await Promise.all(["/clients", "/appointments", "/jewelry", "/purchases", "/sales-orders", "/finance/ledger"].map((path) => call(path)));
  check("H-00.4", "Tenant inicia sem dados operacionais de outra clinica", empty.every((response) => response.status === 200 && items(response.json).length === 0), empty.map((response) => ({ status: response.status, count: items(response.json).length })));
  const duplicateAvailability = await req(`/signup/availability?email=${encodeURIComponent(adminEmail)}`);
  check("H-00.5", "E-mail passa a ser recusado logo na verificacao", duplicateAvailability.status === 200 && duplicateAvailability.json?.email?.available === false, duplicateAvailability.json);
});

await stage("H-01/H-05", async () => {
  const identity = await expect("H-01.1", "Atualiza identidade da clinica", "/store-identity", { method: "PATCH", body: {
    store_name: clinicName, short_name: "Aurora QA", responsible_name: "Marina QA Souza",
    phone: "77990000001", whatsapp: "77990000001", city: "Vitoria da Conquista", state: "BA",
    address: "Rua da Homologacao, 100 - Centro", primary_color: "#6D3B73",
    description: "Estudio QA de body piercing", welcome_text: "Bem-vindo ao Aurora QA",
  }});
  check("H-01.2", "Identidade gravada e relida", identity.status === 200 && (await call("/store-identity")).json?.identity?.primary_color === "#6D3B73");
  for (const name of ["Servicos de piercing", "Venda de joias", "Materiais de consumo", "Compra para revenda", "Estornos e reembolsos"]) {
    await expect("H-05.1", `Cria categoria financeira ${name}`, "/finance/categories", { method: "POST", body: { name } });
  }
  for (const name of ["QA Atendimento", "QA Estoque Loja", "QA Administracao"]) {
    const center = await expect("H-05.2", `Cria centro ${name}`, "/finance/cost-centers", { method: "POST", body: { name } });
    if (name === "QA Estoque Loja") ids.costCenter = center.json?.id;
  }
  for (const supplier of [
    ["QA Titanium Brasil Ltda", "12345678000190"],
    ["QA Medical Supply Ltda", "22345678000190"],
    ["QA Agua Serra Azul", "32345678000190"],
  ]) {
    const response = await expect("H-05.3", `Cria fornecedor ${supplier[0]}`, "/finance/suppliers", { method: "POST", body: { name: supplier[0], person_type: "PJ", document: supplier[1] } });
    if (supplier[0].includes("Titanium")) ids.supplierProduct = response.json?.id;
    if (supplier[0].includes("Medical")) ids.supplierMaterial = response.json?.id;
  }
});

await stage("H-02/H-04", async () => {
  for (const professional of [
    { key: "marina", name: "QA Marina Piercer", commission_percentage: 40, whatsapp: "5577990000011" },
    { key: "rafael", name: "QA Rafael Piercer", commission_percentage: 35, whatsapp: "5577990000012" },
  ]) {
    const response = await expect("H-02.1", `Cria profissional ${professional.name}`, "/professionals", { method: "POST", body: { ...professional, specialty: "Body piercing", phone: professional.whatsapp } });
    ids[professional.key] = response.json?.id;
  }
  for (const service of [
    { key: "helix", name: "QA Perfuracao helix", duration_minutes: 45, price: 120, deposit_value: 40 },
    { key: "nostril", name: "QA Perfuracao nostril", duration_minutes: 45, price: 140, deposit_value: 50 },
    { key: "troca", name: "QA Troca de joia", duration_minutes: 20, price: 35, deposit_value: 0 },
  ]) {
    const response = await expect("H-03.1", `Cria servico ${service.name}`, "/services", { method: "POST", body: service });
    ids[service.key] = response.json?.id;
  }
  const procedure = await expect("H-03.4", "Cria procedimento Helix vinculado ao servico", "/procedures", { method: "POST", body: {
    service_id: ids.helix, name: "QA Helix simples", body_area: "Helix", price: 120, duration_minutes: 45,
    aftercare_instructions: "Higienizar com soro fisiologico e nao manipular a joia.",
  }});
  ids.procedure = procedure.json?.id;
  await expect("H-03.2", "Helix fica vinculado apenas a Marina", `/professionals/${ids.marina}`, { method: "PATCH", body: { service_ids: [ids.helix, ids.nostril, ids.troca], active: true } });
  await expect("H-03.3", "Rafael nao recebe Helix", `/professionals/${ids.rafael}`, { method: "PATCH", body: { service_ids: [ids.nostril, ids.troca], active: true } });
  for (const professionalId of [ids.marina, ids.rafael]) {
    await expect("H-02.2", "Gera disponibilidade semanal", "/availability/generate-weekly", { method: "POST", body: {
      professional_id: professionalId, weekdays: [2, 3, 4, 5, 6], start_time: professionalId === ids.marina ? "10:00" : "12:00",
      end_time: "19:00", lunch_start: "14:00", lunch_end: "15:00", duration_minutes: 30, buffer_minutes: 10,
    }});
  }
  const blockedDate = nextWeekday(2, 21);
  ids.blockedDate = blockedDate;
  await expect("H-01.3", "Cria bloqueio de agenda", "/schedule-blocks", { method: "POST", body: {
    professional_id: ids.marina, block_type: "unavailable", reason: "QA-Bloqueio limpeza",
    start_datetime: `${blockedDate}T10:00`, end_datetime: `${blockedDate}T13:00`,
  }});
  const blockedSlots = await call(`/booking/slots?service_id=${ids.helix}&professional_id=${ids.marina}&date=${blockedDate}`);
  check("H-01.4", "Bloqueio remove os horarios publicos", blockedSlots.status === 200 && !blockedSlots.json?.slots?.some((slot) => slot.time >= "10:00" && slot.time < "13:00"), blockedSlots.json);

  for (const user of [
    { key: "reception", name: "QA Recepcao", email: `qa.recepcao.${run}@aurora-teste.local`, role: "reception" },
    { key: "finance", name: "QA Financeiro", email: `qa.financeiro.${run}@aurora-teste.local`, role: "finance" },
    { key: "piercer", name: "QA Piercer", email: `qa.piercer.${run}@aurora-teste.local`, role: "piercer" },
  ]) {
    const response = await expect("H-04.1", `Cria usuario ${user.role}`, "/users", { method: "POST", body: { ...user, password } });
    ids[`${user.key}User`] = response.json?.id;
    const login = await req("/login", { method: "POST", tenant: slug, body: { email: user.email, password } });
    roleTokens[user.key] = login.json?.token;
    check("H-04.2", `Login ${user.role}`, login.status === 200 && login.json?.user?.role === user.role, { status: login.status });
  }
  const forbidden = await req("/users", { tenant: slug, token: roleTokens.piercer });
  check("H-04.3", "Piercer nao lista usuarios por URL direta", forbidden.status === 403, { status: forbidden.status, error: forbidden.json?.error });
});

await stage("H-06/H-12", async () => {
  const category = await expect("H-06.1", "Cria categoria canonica QA Labrets", "/inventory-categories", { method: "POST", body: { name: "QA Labrets" } });
  ids.category = category.json?.id;
  const product = await expect("H-07.1", "Cria produto pai com duas variacoes e saldo zero", "/jewelry", { method: "POST", body: {
    name: "QA Labret haste reta titanio", category_id: ids.category, category: "QA Labrets", material: "Titanio", color: "Natural",
    is_catalog_active: true, is_published: true, virtual_store_active: true,
    images: [{ image_url: "/uploads/qa-labret.png", is_primary: true }],
    variants: [
      { sku: `QA-LAB-08-NAT-${run}`, variation_name: "8 mm Natural", material: "Titanio", color: "Natural", length: "8mm", thickness: "1.2mm", quantity: 0, cost_value: 0, sale_value: 60, price_manually_overridden: true },
      { sku: `QA-LAB-08-DOR-${run}`, variation_name: "8 mm Dourado", material: "Titanio", color: "Dourado", length: "8mm", thickness: "1.2mm", quantity: 0, cost_value: 0, sale_value: 65, price_manually_overridden: true },
    ],
  }});
  ids.product = product.json?.id;
  ids.variant = product.json?.variants?.[0]?.id;
  ids.variantSku = product.json?.variants?.[0]?.sku;
  check("H-07.2", "Saldo pai e soma das variacoes iniciam em zero", money(product.json?.quantity) === 0 && product.json?.variants?.every((variant) => Number(variant.quantity) === 0), product.json?.variants);
  const duplicateSku = await call("/jewelry", { method: "POST", body: {
    name: "QA Produto SKU duplicado", category_id: ids.category, category: "QA Labrets", material: "Titanio", color: "Natural",
    variants: [{ sku: ids.variantSku, sku_manually_edited: true, material: "Titanio", color: "Natural", quantity: 0, sale_value: 10 }],
  }});
  check("H-07.3", "SKU manual duplicado e recusado", duplicateSku.status === 409, { status: duplicateSku.status, error: duplicateSku.json?.error });

  for (const material of [
    { key: "glove", name: "QA Luva nitrilica preta P", unit: "caixa", minimum_quantity: 2, cost_value: 42 },
    { key: "needle", name: "QA Agulha descartavel 18G", unit: "unidade", minimum_quantity: 20, cost_value: 3.5 },
    { key: "water", name: "QA Agua mineral 500 ml", unit: "unidade", minimum_quantity: 12, cost_value: 3 },
  ]) {
    const response = await expect("H-09.1", `Cria material ${material.name}`, "/consumables", { method: "POST", body: { ...material, quantity: 0 } });
    ids[material.key] = response.json?.id;
  }
  const productPurchaseBody = {
    supplier_id: ids.supplierProduct, purchase_date: new Date().toISOString().slice(0, 10), first_due_date: nextWeekday(1, 10),
    installment_count: 2, payment_method: "Pix", cost_center_id: ids.costCenter, category: "Compra para revenda",
    items: [{ product_id: ids.product, product_variant_id: ids.variant, quantity: 10, unit_cost: 22 }],
  };
  const purchase = await expect("H-10.1", "Compra de revenda confirma estoque e pagar", "/purchases", { method: "POST", headers: { "Idempotency-Key": `qa-product-${run}` }, body: productPurchaseBody });
  ids.productPurchase = purchase.json?.id;
  check("H-10.2", "Compra gera duas parcelas que fecham o total", purchase.json?.payables?.length === 2 && money(purchase.json.payables.reduce((sum, entry) => sum + Number(entry.amount), 0)) === 22000, purchase.json?.payables);
  const repeated = await call("/purchases", { method: "POST", headers: { "Idempotency-Key": `qa-product-${run}` }, body: productPurchaseBody });
  check("H-10.3", "Reenvio da compra e idempotente", repeated.status === 200 && repeated.json?.id === ids.productPurchase && repeated.json?.idempotent === true, { status: repeated.status, id: repeated.json?.id });

  const consumablePurchase = await expect("H-11.1", "Compra de consumo atualiza somente materiais", "/purchases", { method: "POST", headers: { "Idempotency-Key": `qa-material-${run}` }, body: {
    supplier_id: ids.supplierMaterial, purchase_date: new Date().toISOString().slice(0, 10), first_due_date: nextWeekday(1, 15),
    installment_count: 2, payment_method: "Boleto", cost_center_id: ids.costCenter, category: "Materiais de consumo",
    items: [
      { item_type: "consumable", consumable_id: ids.glove, quantity: 4, unit_cost: 42, batch_code: `LUV-${run}`, expiry_date: "2028-12-31" },
      { item_type: "consumable", consumable_id: ids.needle, quantity: 50, unit_cost: 3.5, batch_code: `AGU-${run}`, expiry_date: "2029-06-30" },
      { item_type: "consumable", consumable_id: ids.water, quantity: 24, unit_cost: 3 },
    ],
  }});
  ids.materialPurchase = consumablePurchase.json?.id;
  check("H-11.2", "Compra de materiais gera duas parcelas e lotes", consumablePurchase.json?.payables?.length === 2 && consumablePurchase.json?.items?.every((item) => item.item_type === "consumable"), consumablePurchase.json?.items);
  await expect("H-12.1", "Saida manual valida material", `/consumables/${ids.water}/movements`, { method: "POST", body: { movement_type: "Saida", quantity: 3, notes: "QA recepcao" } });
  const excessive = await call(`/consumables/${ids.water}/movements`, { method: "POST", body: { movement_type: "Saida", quantity: 999, notes: "QA excesso" } });
  check("H-12.2", "Material nao permite saldo negativo", excessive.status === 400, { status: excessive.status, error: excessive.json?.error });
  const lotA = await expect("H-12.3", "Vincula primeiro lote ao saldo historico", `/consumables/${ids.water}/lots`, { method: "POST", body: {
    batch_code: `AGUA-A-${run}`, quantity: 10, expiry_date: "2028-01-31", increase_stock: false,
  }});
  const lotB = await expect("H-12.4", "Vincula segundo lote somente ao saldo ainda sem lote", `/consumables/${ids.water}/lots`, { method: "POST", body: {
    batch_code: `AGUA-B-${run}`, quantity: 10, expiry_date: "2028-06-30", increase_stock: false,
  }});
  const excessiveLot = await call(`/consumables/${ids.water}/lots`, { method: "POST", body: {
    batch_code: `AGUA-C-${run}`, quantity: 2, expiry_date: "2029-01-31", increase_stock: false,
  }});
  check("H-12.5", "Soma dos lotes nao pode superar o saldo do material", excessiveLot.status === 400, { status: excessiveLot.status, error: excessiveLot.json?.error });
  await expect("H-12.6", "Saida manual reduz primeiro o lote com validade mais proxima", `/consumables/${ids.water}/movements`, { method: "POST", body: { movement_type: "Saida", quantity: 4, notes: "QA baixa FEFO" } });
  const lotsAfterOutput = await call(`/consumables/${ids.water}/lots`);
  check("H-12.7", "Baixa FEFO preserva lote posterior", Number(lotsAfterOutput.json?.find((item) => item.id === lotA.json?.id)?.remaining_quantity) === 6 && Number(lotsAfterOutput.json?.find((item) => item.id === lotB.json?.id)?.remaining_quantity) === 10, lotsAfterOutput.json);
  await expect("H-09.2", "Configura receita de consumo do Helix", `/services/${ids.helix}/consumables`, { method: "PUT", body: { items: [
    { consumable_id: ids.glove, quantity: 1 }, { consumable_id: ids.needle, quantity: 1 },
  ] }});
});

await stage("H-13/H-17", async () => {
  const client = await expect("H-13.1", "Cria cliente completo", "/clients", { method: "POST", body: {
    full_name: "QA Camila Santos", whatsapp: "5577991112233", phone: "77991112233", instagram: "@qa.camila",
    email: `qa.camila.${run}@teste.local`, birth_date: "1997-05-14", cpf: "52998224725", notes: "QA sem dados reais",
  }});
  ids.client = client.json?.id;
  await expect("H-15.1", "Cria prontuario", `/clients/${ids.client}/medical-records`, { method: "POST", body: {
    record_date: new Date().toISOString().slice(0, 10), piercing_history: "Helix anterior", jewelry_used: "Labret titanio",
    allergies_notes: "Nega alergias", guidance: "Higienizar com soro", healing_evolution: "Registro inicial QA",
  }});
  const appointmentDate = nextWeekday(3, 7);
  const appointment = await expect("H-14.1", "Cria agenda com sinal pago, servico e variacao", "/appointments", { method: "POST", body: {
    client_id: ids.client, full_name: "QA Camila Santos", whatsapp: "5577991112233", professional_id: ids.marina,
    service_id: ids.helix, procedure: "QA Helix simples", piercing_region: "Helix", appointment_date: appointmentDate,
    appointment_time: "10:00", jewelry_id: ids.product, jewelry_variant_id: ids.variant, total_value: 180,
    deposit_value: 40, deposit_status: "pago", deposit_payment_method: "Pix", remaining_payment_method: "Cartao", status: "confirmado",
  }});
  ids.appointment = appointment.json?.id;
  check("H-14.2", "Total da agenda soma servico e produto", money(appointment.json?.total_value) === 18000 && money(appointment.json?.remaining_value) === 14000, { total: appointment.json?.total_value, remaining: appointment.json?.remaining_value });
  const duplicate = await call("/appointments", { method: "POST", body: {
    full_name: "QA Conflito", whatsapp: "5577991112244", professional_id: ids.marina, service_id: ids.helix,
    procedure: "QA Conflito", piercing_region: "Helix", appointment_date: appointmentDate, appointment_time: "10:00",
  }});
  check("H-14.3", "Conflito do mesmo profissional e horario e recusado", duplicate.status === 409, { status: duplicate.status, error: duplicate.json?.error });
  await expect("H-15.2", "Cria termo assinado vinculado", "/digital-terms", { method: "POST", body: {
    appointment_id: ids.appointment, client_id: ids.client, full_name: "QA Camila Santos", document_number: "52998224725",
    birth_date: "1997-05-14", whatsapp: "5577991112233", procedure: "QA Helix simples", piercing_region: "Helix",
    orientations_confirmed: true, health_declaration: "Nega comorbidades", form_data: { qa: true },
    signature_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGPgEpHjEpFjgFAABk4A8Z5vd+AAAAAASUVORK5CYII=",
  }});
  const completed = await expect("H-16.1", "Conclui atendimento com pagamento parcial e receber parcelado", `/appointments/${ids.appointment}/complete`, { method: "POST", body: {
    payments: [{ amount: 60, method: "Pix", status: "pago" }], installment_count: 2,
    first_due_date: nextWeekday(5, 10), payment_method: "Cartao",
  }});
  check("H-16.2", "Agenda fica atendida", completed.json?.status === "atendido", completed.json);
  const completeAgain = await call(`/appointments/${ids.appointment}/complete`, { method: "POST", body: { reason: "QA repeticao idempotente", payments: [{ amount: 60, method: "Pix", status: "pago" }], installment_count: 2, first_due_date: nextWeekday(5, 10), payment_method: "Cartao" } });
  check("R-02", "Refechamento controlado nao falha nem cria duplicidade", completeAgain.status === 200, { status: completeAgain.status, error: completeAgain.json?.error });
});

await stage("H-18 cancelamentos e creditos", async () => {
  const date = nextWeekday(4, 14);
  const cancellationAppointment = await expect("H-18.1", "Cria agenda para cancelamento com sinal", "/appointments", { method: "POST", body: {
    client_id: ids.client, full_name: "QA Camila Santos", whatsapp: "5577991112233", professional_id: ids.rafael,
    service_id: ids.nostril, procedure: "QA Nostril", piercing_region: "Nostril", appointment_date: date,
    appointment_time: "16:00", total_value: 140, deposit_value: 50, deposit_status: "pago", deposit_payment_method: "Pix", status: "confirmado",
  }});
  ids.cancelAppointment = cancellationAppointment.json?.id;
  const unsafePatch = await call(`/appointments/${ids.cancelAppointment}`, { method: "PATCH", body: { status: "cancelado" } });
  check("H-18.2", "PATCH direto de cancelamento e bloqueado", unsafePatch.status === 409, { status: unsafePatch.status, error: unsafePatch.json?.error });
  const canceled = await expect("H-18.3", "Cancelamento converte sinal em credito", `/appointments/${ids.cancelAppointment}/cancel`, { method: "POST", body: { resolution: "client_credit", reason: "QA cliente solicitou remarcacao" } });
  check("H-18.4", "Credito criado no valor do sinal", canceled.json?.resolution === "client_credit" && money(canceled.json?.deposit_amount) === 5000, canceled.json);
  const creditsBefore = await call(`/clients/${ids.client}/credits`);
  check("H-18.5", "Saldo de credito fica disponivel", money(creditsBefore.json?.open_amount) >= 5000, creditsBefore.json);
  const newAppointment = await expect("H-18.6", "Cria nova agenda para consumir credito", "/appointments", { method: "POST", body: {
    client_id: ids.client, full_name: "QA Camila Santos", whatsapp: "5577991112233", professional_id: ids.rafael,
    service_id: ids.troca, procedure: "QA Troca", piercing_region: "Orelha", appointment_date: nextWeekday(5, 16), appointment_time: "17:00",
    total_value: 35, deposit_value: 0, status: "confirmado",
  }});
  const applied = await expect("H-18.7", "Aplica automaticamente o menor valor entre credito e saldo", `/appointments/${newAppointment.json?.id}/apply-client-credit`, { method: "POST", body: {} });
  check("H-18.8", "Credito quita apenas R$35 e deixa R$15", money(applied.json?.applied_amount) === 3500 && money(applied.json?.remaining_value) === 0, applied.json);
  const creditsAfter = await call(`/clients/${ids.client}/credits`);
  check("H-18.9", "Credito remanescente e R$15", money(creditsAfter.json?.open_amount) === 1500, creditsAfter.json);
  const cancelAgain = await call(`/appointments/${ids.cancelAppointment}/cancel`, { method: "POST", body: { resolution: "client_credit", reason: "QA repetido" } });
  check("R-09", "Segundo cancelamento e recusado sem duplicar credito", cancelAgain.status === 409, { status: cancelAgain.status, error: cancelAgain.json?.error });

  const cancellationCases = [
    { key: "retain", day: 6, time: "16:00", deposit: 30, resolution: "retain_deposit", expected: "retido" },
    { key: "refund", day: 2, time: "18:00", deposit: 25, resolution: "manual_refund", expected: "estornado", refund_method: "Pix" },
    { key: "none", day: 3, time: "18:00", deposit: 0, resolution: "no_payment", expected: "cancelado" },
  ];
  for (const scenario of cancellationCases) {
    const created = await expect("H-18.10", `Cria agenda para resolucao ${scenario.resolution}`, "/appointments", { method: "POST", body: {
      client_id: ids.client, full_name: "QA Camila Santos", whatsapp: "5577991112233", professional_id: ids.rafael,
      service_id: ids.troca, procedure: "QA Troca", piercing_region: "Orelha", appointment_date: nextWeekday(scenario.day, 28),
      appointment_time: scenario.time, total_value: 35, deposit_value: scenario.deposit,
      deposit_status: scenario.deposit ? "pago" : "pendente", deposit_payment_method: "Pix", status: "confirmado",
    }});
    const resolution = await expect("H-18.11", `Executa resolucao ${scenario.resolution}`, `/appointments/${created.json?.id}/cancel`, { method: "POST", body: {
      resolution: scenario.resolution, reason: `QA ${scenario.resolution}`, refund_method: scenario.refund_method,
    }});
    check("H-18.12", `Status financeiro da resolucao ${scenario.resolution}`, resolution.json?.appointment?.deposit_status === scenario.expected, resolution.json);
  }
});

await stage("H-19/H-21 vendas e devolucoes", async () => {
  const stockBefore = (await call("/jewelry")).json.find((item) => Number(item.id) === Number(ids.product));
  const variantBefore = stockBefore?.variants?.find((variant) => Number(variant.id) === Number(ids.variant));
  const sale = await expect("H-19.1", "Venda paga baixa duas unidades e gera pagamento", "/sales-orders", { method: "POST", body: {
    client_id: ids.client, full_name: "QA Camila Santos", whatsapp: "5577991112233", order_type: "produto",
    payment_method: "Pix", status: "concluida", items: [{ item_name: "QA Labret haste reta titanio", product_id: ids.product, product_variant_id: ids.variant, quantity: 2, unit_price: 60 }],
  }});
  ids.sale = sale.json?.id;
  ids.saleItem = sale.json?.items?.[0]?.id;
  const stockAfterSale = (await call("/jewelry")).json.find((item) => Number(item.id) === Number(ids.product))?.variants?.find((variant) => Number(variant.id) === Number(ids.variant));
  check("H-19.2", "Venda baixa exatamente duas unidades", Number(stockAfterSale?.quantity) === Number(variantBefore?.quantity) - 2, { before: variantBefore?.quantity, after: stockAfterSale?.quantity });
  const overSale = await call("/sales-orders", { method: "POST", body: {
    client_id: ids.client, full_name: "QA Camila Santos", whatsapp: "5577991112233", status: "concluida", payment_method: "Pix",
    items: [{ item_name: "QA Estoque insuficiente", product_id: ids.product, product_variant_id: ids.variant, quantity: 999, unit_price: 60 }],
  }});
  check("H-21.1", "Venda acima do saldo e recusada atomicamente", overSale.status === 400, { status: overSale.status, error: overSale.json?.error });
  const returnResult = await expect("H-21.2", "Devolucao parcial gera credito e retorna estoque", `/sales-orders/${ids.sale}/returns`, { method: "POST", body: {
    reason: "QA troca de tamanho", financial_action: "client_credit", items: [{ sales_order_item_id: ids.saleItem, quantity: 1, condition: "sellable", return_to_stock: true }],
  }});
  check("H-21.3", "Devolucao registra R$60", money(returnResult.json?.total_value) === 6000 && money(returnResult.json?.financial_value) === 6000, returnResult.json);
  const stockAfterReturn = (await call("/jewelry")).json.find((item) => Number(item.id) === Number(ids.product))?.variants?.find((variant) => Number(variant.id) === Number(ids.variant));
  check("H-21.4", "Devolucao repoe uma unidade", Number(stockAfterReturn?.quantity) === Number(stockAfterSale?.quantity) + 1, { afterSale: stockAfterSale?.quantity, afterReturn: stockAfterReturn?.quantity });
  const overReturn = await call(`/sales-orders/${ids.sale}/returns`, { method: "POST", body: {
    reason: "QA excesso", financial_action: "client_credit", items: [{ sales_order_item_id: ids.saleItem, quantity: 2, condition: "sellable", return_to_stock: true }],
  }});
  check("H-21.5", "Devolucao acima do restante e recusada", overReturn.status === 409, { status: overReturn.status, error: overReturn.json?.error });

  const pendingSale = await expect("H-20.1", "Venda pendente parcelada gera contas a receber", "/sales-orders", { method: "POST", body: {
    client_id: ids.client, full_name: "QA Camila Santos", whatsapp: "5577991112233", status: "concluida", receivable_mode: "pending",
    installment_count: 3, first_due_date: nextWeekday(1, 12), payment_method: "Cartao",
    items: [{ item_name: "QA Labret parcelado", product_id: ids.product, product_variant_id: ids.variant, quantity: 1, unit_price: 60 }],
  }});
  ids.pendingSale = pendingSale.json?.id;
  const pendingReturn = await expect("H-21.6", "Devolucao de venda nao recebida reduz apenas titulos", `/sales-orders/${ids.pendingSale}/returns`, { method: "POST", body: {
    reason: "QA devolucao antes do pagamento", financial_action: "none", items: [{ sales_order_item_id: pendingSale.json?.items?.[0]?.id, quantity: 1, condition: "sellable", return_to_stock: true }],
  }});
  check("H-21.7", "Sem reembolso ou credito quando nada foi recebido", money(pendingReturn.json?.financial_value) === 0, pendingReturn.json);

  const damagedSale = await expect("H-21.8", "Cria venda para devolucao danificada", "/sales-orders", { method: "POST", body: {
    client_id: ids.client, full_name: "QA Camila Santos", whatsapp: "5577991112233", status: "concluida", payment_method: "Pix",
    items: [{ item_name: "QA Labret danificado", product_id: ids.product, product_variant_id: ids.variant, quantity: 1, unit_price: 60 }],
  }});
  const damagedStockBefore = (await call("/jewelry")).json.find((item) => Number(item.id) === Number(ids.product))?.variants?.find((variant) => Number(variant.id) === Number(ids.variant))?.quantity;
  const damagedReturn = await expect("H-21.9", "Item danificado gera reembolso sem retornar ao estoque", `/sales-orders/${damagedSale.json?.id}/returns`, { method: "POST", body: {
    reason: "QA peca danificada", financial_action: "manual_refund", refund_method: "Pix",
    items: [{ sales_order_item_id: damagedSale.json?.items?.[0]?.id, quantity: 1, condition: "damaged", return_to_stock: false }],
  }});
  const damagedStockAfter = (await call("/jewelry")).json.find((item) => Number(item.id) === Number(ids.product))?.variants?.find((variant) => Number(variant.id) === Number(ids.variant))?.quantity;
  check("H-21.10", "Devolucao danificada preserva saldo e registra reembolso", Number(damagedStockAfter) === Number(damagedStockBefore) && money(damagedReturn.json?.financial_value) === 6000, { before: damagedStockBefore, after: damagedStockAfter, returned: damagedReturn.json?.financial_value });
});

await stage("H-22/H-27 e conciliacao", async () => {
  const publicCatalog = await req(`/catalog?t=${slug}`);
  check("H-08.1", "Produto publicado aparece no catalogo sem autenticacao", publicCatalog.status === 200 && publicCatalog.json?.items?.some((item) => Number(item.id) === Number(ids.product)), { status: publicCatalog.status, count: publicCatalog.json?.items?.length });
  const readiness = await call("/booking/readiness");
  check("H-22.1", "Agendamento publico tem requisitos essenciais", readiness.status === 200 && readiness.json?.essentials_ready === true, readiness.json);
  const publicDate = nextWeekday(6, 14);
  const slots = await req(`/booking/slots?t=${slug}&service_id=${ids.nostril}&professional_id=${ids.rafael}&date=${publicDate}`);
  const firstSlot = slots.json?.slots?.[0]?.time;
  check("H-22.2", "Link publico oferece slots validos", slots.status === 200 && Boolean(firstSlot), { status: slots.status, slot: firstSlot });
  if (firstSlot) {
    const body = { service_id: ids.nostril, professional_id: ids.rafael, appointment_date: publicDate, appointment_time: firstSlot,
      full_name: "QA Cliente Publico", whatsapp: "5577992223344", idempotency_key: `qa-booking-${run}` };
    const booking = await req(`/booking/requests?t=${slug}`, { method: "POST", body });
    const repeated = await req(`/booking/requests?t=${slug}`, { method: "POST", body });
    check("H-22.3", "Agendamento publico cria solicitacao idempotente", booking.status === 201 && repeated.status === 200 && booking.json?.id === repeated.json?.id, { first: booking.status, repeated: repeated.status });
  }
  const manualEntryBody = { entry_type: "payable", description: "QA Energia", category: "Administracao", amount: 300,
    due_date: nextWeekday(1, 20), competence_date: new Date().toISOString().slice(0, 10), status: "pending", payment_method: "Pix", installment_count: 2 };
  const manual = await expect("H-24.1", "Lancamento manual parcelado", "/finance/entries", { method: "POST", headers: { "Idempotency-Key": `qa-manual-${run}` }, body: manualEntryBody });
  check("H-24.2", "Lancamento manual gera duas parcelas", Array.isArray(manual.json) && manual.json.length === 2, manual.json);
  const manualRepeat = await call("/finance/entries", { method: "POST", headers: { "Idempotency-Key": `qa-manual-${run}` }, body: manualEntryBody });
  check("H-24.3", "Lancamento manual repetido e idempotente", manualRepeat.status === 200 && manualRepeat.json?.length === 2, { status: manualRepeat.status });
  for (const type of ["financial", "sales", "stock", "services", "clients", "appointments", "cancellations", "payments"]) {
    const report = await call(`/reports/${type}`);
    check("H-25.1", `Relatorio ${type} responde`, report.status === 200, { status: report.status, error: report.json?.error });
  }
  const support = await expect("H-27.1", "Cria chamado de suporte", "/support/tickets", { method: "POST", body: { subject: "QA Homologacao", category: "problema", body: "Validacao ponta a ponta QA" } });
  check("H-27.2", "Chamado recebe identificador", Boolean(support.json?.id), support.json);
  const privacy = await call("/privacy/audit");
  check("H-27.3", "Auditoria de privacidade responde", privacy.status === 200, { status: privacy.status });
  const crossedTenant = await req("/clients", { tenant: "aura", token });
  check("R-08", "Token do tenant QA nao acessa outro tenant pelo header", [401, 403].includes(crossedTenant.status), { status: crossedTenant.status, error: crossedTenant.json?.error });
  const overMovement = await call(`/jewelry/${ids.product}/variants/${ids.variant}/movements`, { method: "POST", body: {
    movement_type: "Saida", quantity: 999, notes: "QA tentativa de saldo negativo",
  }});
  check("INV-01", "Saida manual de produto acima do saldo e recusada", [400, 409].includes(overMovement.status), { status: overMovement.status, resulting_quantity: overMovement.json?.product?.variants?.find((variant) => Number(variant.id) === Number(ids.variant))?.quantity });

  const reconciliation = await withTenantSchema(tenant.id, async (db) => ({
    counts: await db.get(`SELECT
      (SELECT COUNT(*) FROM clients) clients,
      (SELECT COUNT(*) FROM appointments) appointments,
      (SELECT COUNT(*) FROM sales_orders) orders,
      (SELECT COUNT(*) FROM financial_entries) financial_entries,
      (SELECT COUNT(*) FROM stock_movements) stock_movements,
      (SELECT COUNT(*) FROM consumable_stock_movements) consumable_movements,
      (SELECT COUNT(*) FROM client_credits) client_credits`),
    appointment: await db.get(`SELECT a.id, a.status, a.stock_deducted,
      (SELECT COUNT(*) FROM sales_orders so WHERE so.appointment_id=a.id AND so.order_type='ordem_servico') service_orders,
      (SELECT COUNT(*) FROM appointment_consumptions ac WHERE ac.appointment_id=a.id) consumptions,
      (SELECT COUNT(*) FROM post_care_followups pc WHERE pc.appointment_id=a.id) postcare
      FROM appointments a WHERE a.id=?`, [ids.appointment]),
    serviceFinance: await db.get(`SELECT
      (SELECT COUNT(*) FROM payments WHERE appointment_id=?) payments,
      (SELECT COUNT(*) FROM financial_entries WHERE source_type='sales_order' AND source_id=(SELECT id FROM sales_orders WHERE appointment_id=? AND order_type='ordem_servico') AND status!='canceled') receivables,
      (SELECT COALESCE(SUM(amount),0) FROM financial_entries WHERE source_type='sales_order' AND source_id=(SELECT id FROM sales_orders WHERE appointment_id=? AND order_type='ordem_servico') AND status!='canceled') receivable_total`, [ids.appointment, ids.appointment, ids.appointment]),
    duplicates: await db.get(`SELECT
      (SELECT COUNT(*) FROM (SELECT source_key FROM financial_entries WHERE source_key IS NOT NULL GROUP BY source_key HAVING COUNT(*)>1) x) duplicate_source_keys,
      (SELECT COUNT(*) FROM (SELECT appointment_id FROM sales_orders WHERE appointment_id IS NOT NULL AND order_type='ordem_servico' GROUP BY appointment_id HAVING COUNT(*)>1) x) duplicate_service_orders,
      (SELECT COUNT(*) FROM jewelry_variants WHERE quantity<0) negative_variant_stock,
      (SELECT COUNT(*) FROM consumables WHERE quantity<0) negative_consumable_stock,
      (SELECT COUNT(*) FROM (
        SELECT c.id FROM consumables c LEFT JOIN consumable_lots l ON l.consumable_id=c.id
        GROUP BY c.id HAVING COALESCE(SUM(l.remaining_quantity),0) > MAX(c.quantity)
      ) inconsistent_lots) lot_stock_excess`),
    credits: await db.get(`SELECT
      COALESCE((SELECT SUM(amount) FROM client_credits WHERE client_id=?),0) issued,
      COALESCE((SELECT SUM(remaining_amount) FROM client_credits WHERE client_id=?),0) remaining,
      COALESCE((SELECT SUM(u.amount) FROM client_credit_usages u JOIN client_credits c ON c.id=u.client_credit_id WHERE c.client_id=?),0) used`, [ids.client, ids.client, ids.client]),
    purchase: await db.get(`SELECT
      (SELECT COUNT(*) FROM stock_movements WHERE purchase_order_id=?) product_movements,
      (SELECT COUNT(*) FROM financial_entries WHERE source_type='purchase_order' AND source_id=?) payables`, [ids.productPurchase, ids.productPurchase]),
    refunds: await db.get(`SELECT
      (SELECT COUNT(*) FROM financial_entries WHERE source_type='appointment_cancellation' AND entry_type='expense') appointment_refunds,
      (SELECT COUNT(*) FROM financial_entries WHERE source_type='sales_return' AND entry_type='expense') sales_refunds`),
  }));
  check("DB-01", "Atendimento tem uma ordem, consumo e tres pos-atendimentos", Number(reconciliation.appointment?.service_orders) === 1 && Number(reconciliation.appointment?.consumptions) === 2 && Number(reconciliation.appointment?.postcare) === 3, reconciliation.appointment);
  check("DB-02", "Nao ha chaves duplicadas nem estoque negativo", Object.values(reconciliation.duplicates || {}).every((value) => Number(value) === 0), reconciliation.duplicates);
  check("DB-03", "Creditos emitidos fecham: emitido = usado + restante", money(reconciliation.credits?.issued) === money(Number(reconciliation.credits?.used || 0) + Number(reconciliation.credits?.remaining || 0)), reconciliation.credits);
  check("DB-04", "Compra idempotente tem um movimento e duas parcelas", Number(reconciliation.purchase?.product_movements) === 1 && Number(reconciliation.purchase?.payables) === 2, reconciliation.purchase);
  check("DB-05", "Reembolsos manuais geram despesas rastreaveis", Number(reconciliation.refunds?.appointment_refunds) === 1 && Number(reconciliation.refunds?.sales_refunds) === 1, reconciliation.refunds);
  ids.reconciliation = reconciliation;
});

const summary = {
  run,
  tenant: tenant ? { id: tenant.id, slug, name: clinicName, admin_email: adminEmail } : null,
  totals: { passed: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length, total: results.length },
  failures: results.filter((result) => !result.ok),
  results,
  ids,
};
console.log(`QA_RESULT_JSON=${JSON.stringify(summary)}`);
await pool.end();
process.exitCode = summary.totals.failed ? 2 : 0;
