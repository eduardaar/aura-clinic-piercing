// Massa de demonstração local para explorar todas as áreas da clínica.
// Uso: npm --prefix backend run seed:demo -- --tenant=aura
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { pool, query } from "../src/database/connection.js";
import { applySchemaSql, createDb } from "../src/db/postgres.js";
import { ensurePlatform } from "../src/services/tenants.js";
import { importAuraJewelry } from "../src/services/auraJewelryImport.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const inline = process.argv.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const tenantSlug = String(argValue("tenant", "aura")).trim().toLowerCase();
if (process.env.NODE_ENV === "production") {
  throw new Error("A massa de demonstração é bloqueada em produção.");
}

await ensurePlatform();
const tenantResult = await query("SELECT id, slug FROM platform.tenants WHERE slug = $1 AND status = 'ativo'", [tenantSlug]);
const tenant = tenantResult.rows[0];
if (!tenant) throw new Error(`Clínica ativa \"${tenantSlug}\" não encontrada.`);

const schema = `tenant_${Number(tenant.id)}`;
const client = await pool.connect();
let imported = {};

try {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  await applySchemaSql(client);
  await client.query(`SET search_path TO "${schema}", public`);
  const db = createDb(client);
  imported = await importAuraJewelry(db, { tenantId: tenant.id });

  await client.query("BEGIN");
  const sql = async (text, values = []) => client.query(text, values);

  // A marca facilita encontrar/remover somente esta massa de demonstração.
  const marker = "MASSA_DEMO_2026";

  await sql(`
    INSERT INTO users (name, email, password_hash, role)
    SELECT item.name, item.email, COALESCE((SELECT password_hash FROM users ORDER BY id LIMIT 1), '$2a$10$demo'), item.role
    FROM (VALUES
      ('Recepção Demonstração', 'recepcao.demo@aura.local', 'reception'),
      ('Financeiro Demonstração', 'financeiro.demo@aura.local', 'finance'),
      ('Piercer Demonstração', 'piercer.demo@aura.local', 'piercer')
    ) AS item(name, email, role)
    ON CONFLICT (email) DO NOTHING
  `);

  await sql(`
    INSERT INTO professionals (name, specialty, phone, email, whatsapp, calendar_color, commission_percentage, active)
    SELECT item.name, item.specialty, item.phone, item.email, item.phone, item.color, item.commission, 1
    FROM (VALUES
      ('Luna Martins', 'Body piercing e curadoria', '(71) 99901-1001', 'luna@aura.local', '#A86D7B', 15.00),
      ('Caio Oliveira', 'Piercing avançado', '(71) 99901-1002', 'caio@aura.local', '#4B7B8C', 12.50),
      ('Maya Costa', 'Joalheria e troca', '(71) 99901-1003', 'maya@aura.local', '#7D6AA5', 10.00)
    ) AS item(name, specialty, phone, email, color, commission)
    WHERE NOT EXISTS (SELECT 1 FROM professionals p WHERE p.email = item.email)
  `);

  await sql(`
    INSERT INTO services (name, description, duration_minutes, price, deposit_value, active_online_booking, pre_service_notes)
    SELECT item.name, item.description, item.duration, item.price, item.deposit, 1, item.notes
    FROM (VALUES
      ('Aplicação de piercing', 'Aplicação segura com joia selecionada.', 50, 120.00, 40.00, 'Documento com foto obrigatório.'),
      ('Troca de joia', 'Avaliação e troca de joia cicatrizada.', 30, 70.00, 20.00, 'Agende após o período de cicatrização.'),
      ('Curadoria de orelha', 'Planejamento estético de composição.', 60, 180.00, 60.00, 'Traga referências de estilo.'),
      ('Downsize e acompanhamento', 'Ajuste de haste e revisão de cicatrização.', 25, 45.00, 0.00, 'Informe qualquer intercorrência.')
    ) AS item(name, description, duration, price, deposit, notes)
    WHERE NOT EXISTS (SELECT 1 FROM services s WHERE s.name = item.name)
  `);

  await sql(`
    INSERT INTO procedures (service_id, name, body_area, description, price, duration_minutes, aftercare_instructions, is_active)
    SELECT s.id, s.name || ' — ' || item.region, item.region, 'Procedimento demonstrativo para testes.', item.price, item.duration, 'Higienizar com soro fisiológico e não manipular a joia.', 1
    FROM (VALUES ('Lóbulo', 120.00, 35), ('Hélix', 140.00, 50), ('Nariz', 130.00, 45), ('Umbigo', 160.00, 55)) AS item(region, price, duration)
    CROSS JOIN LATERAL (SELECT id, name FROM services ORDER BY id LIMIT 1) s
    WHERE NOT EXISTS (SELECT 1 FROM procedures p WHERE p.name = s.name || ' — ' || item.region)
  `);

  await sql(`
    INSERT INTO professional_services (professional_id, service_id)
    SELECT p.id, s.id FROM professionals p CROSS JOIN services s
    ON CONFLICT (professional_id, service_id) DO NOTHING
  `);
  await sql(`
    INSERT INTO professional_availability (professional_id, weekday, is_active, start_time, end_time, lunch_start, lunch_end, duration_minutes, buffer_minutes)
    SELECT p.id, d.weekday, CASE WHEN d.weekday = 0 THEN 0 ELSE 1 END, '09:00', CASE WHEN d.weekday = 6 THEN '14:00' ELSE '18:00' END, '12:00', '13:00', 40, 10
    FROM professionals p CROSS JOIN generate_series(0, 6) AS d(weekday)
    ON CONFLICT (professional_id, weekday) DO NOTHING
  `);

  await sql(`
    INSERT INTO clients (full_name, whatsapp, phone, instagram, email, cpf, birth_date, notes, created_at, updated_at)
    SELECT
      'Cliente Demonstração ' || lpad(g::text, 2, '0'),
      '5571999' || lpad(g::text, 7, '0'),
      '5571999' || lpad(g::text, 7, '0'),
      '@cliente.demo.' || g,
      'cliente.demo.' || g || '@aura.local',
      lpad((10000000000 + g)::text, 11, '0'),
      to_char(date '1985-01-01' + (g * 173), 'YYYY-MM-DD'),
      CASE WHEN g % 7 = 0 THEN 'Cliente com sensibilidade a níquel. ' || $1 ELSE 'Cadastro de demonstração. ' || $1 END,
      to_char(CURRENT_TIMESTAMP - (g || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS'),
      to_char(CURRENT_TIMESTAMP - (g || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS')
    FROM generate_series(1, 45) AS g
    WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.full_name = 'Cliente Demonstração ' || lpad(g::text, 2, '0'))
  `, [marker]);

  await sql(`
    UPDATE jewelry_inventory
    SET quantity = CASE WHEN id % 11 = 0 THEN 0 WHEN id % 7 = 0 THEN 2 ELSE 8 + (id % 9) END,
        cost_value = 18 + (id % 7) * 4,
        sale_value = 65 + (id % 7) * 15,
        purchase_cost_cents = (18 + (id % 7) * 4) * 100,
        total_cost_cents = (18 + (id % 7) * 4) * 100,
        suggested_price_cents = (18 + (id % 7) * 4) * 300,
        sale_price_cents = (65 + (id % 7) * 15) * 100,
        status = CASE WHEN id % 11 = 0 THEN 'esgotado' WHEN id % 7 = 0 THEN 'baixo estoque' ELSE 'disponível' END,
        is_catalog_active = 1, is_published = 1,
        is_featured = CASE WHEN id % 5 = 0 THEN 1 ELSE 0 END,
        is_new = CASE WHEN id % 6 = 0 THEN 1 ELSE 0 END,
        is_promotion = CASE WHEN id % 8 = 0 THEN 1 ELSE 0 END,
        is_last_units = CASE WHEN id % 7 = 0 THEN 1 ELSE 0 END,
        supplier = 'Fornecedor Demonstração', physical_location = 'Estoque A'
  `);
  await sql(`
    INSERT INTO product_images (product_id, image_url, alt_text, sort_order, is_primary)
    SELECT j.id, 'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=900&q=80', j.name, 0, 1
    FROM jewelry_inventory j
    WHERE NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = j.id)
  `);

  await sql(`
    INSERT INTO appointments (
      client_id, professional_id, jewelry_id, service_id, procedure, description, piercing_region,
      appointment_date, appointment_time, end_time, total_value, service_value, jewelry_value,
      subtotal_value, discount_value, deposit_value, remaining_value, deposit_payment_method,
      remaining_payment_method, deposit_status, deposit_paid_at, status, source, duration_minutes, notes, financial_notes
    )
    SELECT c.id, p.id, j.id, s.id, pr.name, 'Atendimento de demonstração completo.', pr.body_area,
      to_char(CURRENT_DATE + (g - 26), 'YYYY-MM-DD'),
      (ARRAY['09:00','10:30','14:00','15:30','17:00'])[(g % 5) + 1],
      (ARRAY['09:50','11:20','14:50','16:20','17:50'])[(g % 5) + 1],
      180 + (g % 4) * 25, 120 + (g % 4) * 10, 60 + (g % 5) * 15,
      180 + (g % 4) * 25, CASE WHEN g % 9 = 0 THEN 15 ELSE 0 END, 50, 130 + (g % 4) * 25,
      'Pix', 'Cartão', CASE WHEN g % 6 = 0 THEN 'pendente' ELSE 'pago' END,
      CASE WHEN g % 6 = 0 THEN NULL ELSE to_char(CURRENT_TIMESTAMP - (g || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS') END,
      CASE WHEN g % 8 = 0 THEN 'cancelado' WHEN g % 7 = 0 THEN 'remarcado' WHEN g % 5 = 0 THEN 'pendente' WHEN g % 4 = 0 THEN 'confirmado' WHEN g % 6 = 0 THEN 'awaiting_deposit_proof' ELSE 'atendido' END,
      CASE WHEN g % 3 = 0 THEN 'public_booking' ELSE 'manual' END, 50, $1, 'Registro financeiro de demonstração.'
    FROM generate_series(1, 48) AS g
    JOIN LATERAL (SELECT id FROM clients WHERE full_name = 'Cliente Demonstração ' || lpad((((g - 1) % 45) + 1)::text, 2, '0')) c ON true
    JOIN LATERAL (SELECT id FROM professionals WHERE active = 1 ORDER BY id OFFSET ((g - 1) % GREATEST((SELECT count(*) FROM professionals WHERE active = 1), 1)) LIMIT 1) p ON true
    JOIN LATERAL (SELECT id FROM jewelry_inventory ORDER BY id OFFSET ((g - 1) % GREATEST((SELECT count(*) FROM jewelry_inventory), 1)) LIMIT 1) j ON true
    JOIN LATERAL (SELECT id FROM services ORDER BY id OFFSET ((g - 1) % GREATEST((SELECT count(*) FROM services), 1)) LIMIT 1) s ON true
    JOIN LATERAL (SELECT name, body_area FROM procedures ORDER BY id OFFSET ((g - 1) % GREATEST((SELECT count(*) FROM procedures), 1)) LIMIT 1) pr ON true
    WHERE NOT EXISTS (SELECT 1 FROM appointments WHERE notes = $1)
  `, [marker]);

  await sql(`
    INSERT INTO appointment_items (appointment_id, procedure_id, service_id, region, jewelry_id, quantity, procedure_price, jewelry_unit_price, duration_minutes, subtotal, notes)
    SELECT a.id, pr.id, a.service_id, a.piercing_region, a.jewelry_id, 1, a.service_value, a.jewelry_value, a.duration_minutes, a.total_value, $1
    FROM appointments a JOIN LATERAL (SELECT id FROM procedures ORDER BY id LIMIT 1) pr ON true
    WHERE a.notes = $1 AND NOT EXISTS (SELECT 1 FROM appointment_items i WHERE i.appointment_id = a.id)
  `, [marker]);
  await sql(`
    INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at, installments, fee_amount, net_amount, notes, created_by_user_id)
    SELECT a.id, a.client_id, CASE WHEN a.status = 'atendido' THEN a.total_value ELSE a.deposit_value END,
      CASE WHEN a.status = 'atendido' THEN 'restante' ELSE 'sinal' END, CASE WHEN a.id % 2 = 0 THEN 'Pix' ELSE 'Cartão' END,
      CASE WHEN a.status IN ('pendente','awaiting_deposit_proof') THEN 'pendente' ELSE 'pago' END,
      to_char(CURRENT_TIMESTAMP - (a.id || ' hours')::interval, 'YYYY-MM-DD HH24:MI:SS'), CASE WHEN a.id % 2 = 0 THEN 1 ELSE 3 END,
      CASE WHEN a.id % 2 = 0 THEN 0 ELSE 5.4 END, CASE WHEN a.id % 2 = 0 THEN a.total_value ELSE a.total_value - 5.4 END, $1,
      (SELECT id FROM users ORDER BY id LIMIT 1)
    FROM appointments a WHERE a.notes = $1
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id)
  `, [marker]);

  await sql(`
    INSERT INTO client_medical_records (client_id, appointment_id, record_date, piercing_history, jewelry_used, occurrences, guidance, allergies_notes, healing_evolution, returns_done)
    SELECT a.client_id, a.id, a.appointment_date, 'Histórico de demonstração.', j.name, 'Sem intercorrências.', 'Retorno em 30 dias.', CASE WHEN a.id % 7 = 0 THEN 'Sensibilidade a níquel.' ELSE 'Nega alergias.' END, 'Evolução satisfatória.', 'Contato realizado.'
    FROM appointments a JOIN jewelry_inventory j ON j.id = a.jewelry_id
    WHERE a.notes = $1 AND a.status = 'atendido'
      AND NOT EXISTS (SELECT 1 FROM client_medical_records r WHERE r.appointment_id = a.id)
  `, [marker]);
  await sql(`
    INSERT INTO digital_terms (appointment_id, client_id, full_name, document_number, birth_date, whatsapp, procedure, piercing_region, orientations_confirmed, health_declaration, form_data, signature_data_url, signed_at)
    SELECT a.id, c.id, c.full_name, c.cpf, c.birth_date, c.whatsapp, a.procedure, a.piercing_region, 1, 'Declaração de saúde demonstrativa.', '{"demo":true}', 'data:image/png;base64,', to_char(CURRENT_TIMESTAMP - (a.id || ' days')::interval, 'YYYY-MM-DD HH24:MI:SS')
    FROM appointments a JOIN clients c ON c.id = a.client_id
    WHERE a.notes = $1 AND a.status = 'atendido'
      AND NOT EXISTS (SELECT 1 FROM digital_terms t WHERE t.appointment_id = a.id)
  `, [marker]);
  await sql(`
    INSERT INTO post_care_followups (appointment_id, client_id, reminder_day, due_date, care_message, healing_status, client_notes, status)
    SELECT a.id, a.client_id, d.day, to_char((a.appointment_date::date + d.day), 'YYYY-MM-DD'), 'Como está a cicatrização? Esta é uma mensagem de demonstração.',
      CASE WHEN d.day = 30 THEN 'cicatrizado' ELSE 'em evolução' END, 'Retorno de demonstração.', CASE WHEN d.day = 30 THEN 'concluido' ELSE 'pendente' END
    FROM appointments a CROSS JOIN (VALUES (7),(30)) AS d(day)
    WHERE a.notes = $1 AND a.status = 'atendido'
    ON CONFLICT (appointment_id, reminder_day) DO NOTHING
  `, [marker]);
  await sql(`
    INSERT INTO loyalty_points (client_id, appointment_id, points, event_type, description)
    SELECT a.client_id, a.id, 10, 'procedimento', 'Pontos de demonstração por atendimento concluído.'
    FROM appointments a WHERE a.notes = $1 AND a.status = 'atendido'
    ON CONFLICT (appointment_id, event_type) DO NOTHING
  `, [marker]);
  await sql(`
    INSERT INTO loyalty_redemptions (client_id, points_used, discount_value, notes)
    SELECT id, 20, 20.00, 'Resgate de demonstração.' FROM clients
    WHERE full_name = 'Cliente Demonstração 01'
      AND NOT EXISTS (SELECT 1 FROM loyalty_redemptions WHERE notes = 'Resgate de demonstração.')
  `);

  await sql(`
    INSERT INTO sales_orders (client_id, order_type, source, status, payment_method, total_value, subtotal_value, discount_value, fulfillment_method, customer_email, notes, created_by_user_id)
    SELECT c.id, CASE WHEN g % 3 = 0 THEN 'servico' ELSE 'produto' END, CASE WHEN g % 2 = 0 THEN 'site' ELSE 'balcao' END,
      CASE WHEN g % 5 = 0 THEN 'pendente' WHEN g % 7 = 0 THEN 'cancelada' ELSE 'concluida' END,
      CASE WHEN g % 2 = 0 THEN 'Pix' ELSE 'Cartão' END, 95 + g * 12, 105 + g * 12, 10, CASE WHEN g % 2 = 0 THEN 'delivery' ELSE 'pickup' END,
      c.email, $1, (SELECT id FROM users ORDER BY id LIMIT 1)
    FROM generate_series(1, 18) AS g
    JOIN LATERAL (SELECT id, email FROM clients WHERE full_name = 'Cliente Demonstração ' || lpad(g::text, 2, '0')) c ON true
    WHERE NOT EXISTS (SELECT 1 FROM sales_orders WHERE notes = $1)
  `, [marker]);
  await sql(`
    INSERT INTO sales_order_items (sales_order_id, item_type, product_id, service_id, item_name, quantity, unit_price, notes)
    SELECT o.id, CASE WHEN o.order_type = 'servico' THEN 'servico' ELSE 'produto' END,
      CASE WHEN o.order_type = 'servico' THEN NULL ELSE j.id END, CASE WHEN o.order_type = 'servico' THEN s.id ELSE NULL END,
      CASE WHEN o.order_type = 'servico' THEN s.name ELSE j.name END, 1, o.total_value, $1
    FROM sales_orders o
    JOIN LATERAL (SELECT id, name FROM jewelry_inventory ORDER BY id OFFSET ((o.id - 1) % GREATEST((SELECT count(*) FROM jewelry_inventory), 1)) LIMIT 1) j ON true
    JOIN LATERAL (SELECT id, name FROM services ORDER BY id LIMIT 1) s ON true
    WHERE o.notes = $1 AND NOT EXISTS (SELECT 1 FROM sales_order_items i WHERE i.sales_order_id = o.id)
  `, [marker]);

  await sql(`
    INSERT INTO expenses (description, expense_type, category, amount, due_date, status, payment_method, payment_account, paid_at, paid_by_user_id, notes)
    SELECT (ARRAY['Aluguel do estúdio','Reposição de materiais','Marketing digital','Internet e sistemas','Embalagens'])[(g % 5) + 1],
      CASE WHEN g % 2 = 0 THEN 'fixa' ELSE 'variavel' END, 'Operação', 95 + g * 73,
      to_char(CURRENT_DATE - (g * 4), 'YYYY-MM-DD'), CASE WHEN g % 4 = 0 THEN 'pendente' ELSE 'paga' END, 'Pix', 'Conta principal',
      CASE WHEN g % 4 = 0 THEN NULL ELSE to_char(CURRENT_DATE - (g * 4), 'YYYY-MM-DD') END, (SELECT id FROM users ORDER BY id LIMIT 1), $1
    FROM generate_series(1, 16) AS g
    WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE notes = $1)
  `, [marker]);
  await sql(`
    INSERT INTO financial_cost_centers (name, description) VALUES
      ('Operação', 'Custos operacionais do estúdio'), ('Marketing', 'Aquisição e relacionamento'), ('Estoque', 'Compra de joias')
    ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
  `);
  await sql(`
    INSERT INTO financial_entries (entry_type, description, category, amount, paid_amount, due_date, competence_date, status, payment_method, payment_account, paid_at, cost_center_id, responsible_user_id, notes, recurrence, source_key)
    SELECT CASE WHEN g % 2 = 0 THEN 'income' ELSE 'expense' END, 'Lançamento demonstrativo ' || g, CASE WHEN g % 2 = 0 THEN 'Atendimentos' ELSE 'Operação' END,
      150 + g * 25, CASE WHEN g % 4 = 0 THEN 0 ELSE 150 + g * 25 END, to_char(CURRENT_DATE + (g - 12), 'YYYY-MM-DD'), to_char(CURRENT_DATE + (g - 12), 'YYYY-MM-DD'),
      CASE WHEN g % 5 = 0 THEN 'overdue' WHEN g % 4 = 0 THEN 'pending' WHEN g % 7 = 0 THEN 'partially_paid' ELSE 'paid' END, 'Pix', 'Conta principal',
      CASE WHEN g % 4 = 0 THEN NULL ELSE to_char(CURRENT_DATE - g, 'YYYY-MM-DD') END, (SELECT id FROM financial_cost_centers WHERE name = CASE WHEN g % 2 = 0 THEN 'Marketing' ELSE 'Operação' END),
      (SELECT id FROM users ORDER BY id LIMIT 1), $1, CASE WHEN g % 6 = 0 THEN 'monthly' ELSE NULL END, $1 || '-financeiro-' || g
    FROM generate_series(1, 18) AS g ON CONFLICT (source_key) DO NOTHING
  `, [marker]);
  await sql(`
    INSERT INTO financial_goals (name, period_start, period_end, target_amount, goal_type)
    SELECT 'Meta mensal de demonstração', to_char(date_trunc('month', CURRENT_DATE), 'YYYY-MM-DD'), to_char((date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'), 'YYYY-MM-DD'), 18000, 'revenue'
    WHERE NOT EXISTS (SELECT 1 FROM financial_goals WHERE name = 'Meta mensal de demonstração')
  `);

  await sql(`
    INSERT INTO catalog_settings (key, value) VALUES
      ('store_name', 'Aura Clinic — Demonstração'), ('whatsapp', '5571999990000'), ('address', 'Rua Demonstração, 100 — Salvador/BA'), ('instagram', '@auraclinic.demo')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
  await sql(`
    INSERT INTO catalog_theme (id, brand_name, slogan, primary_color, secondary_color, show_buy_button, show_stock_quantity, footer_text)
    VALUES (1, 'Aura Clinic', 'Piercing autoral, seguro e com propósito.', '#A86D7B', '#E8C8B8', 1, 1, 'Dados fictícios para testes locais.')
    ON CONFLICT (id) DO UPDATE SET brand_name = EXCLUDED.brand_name, slogan = EXCLUDED.slogan, show_buy_button = EXCLUDED.show_buy_button, show_stock_quantity = EXCLUDED.show_stock_quantity, footer_text = EXCLUDED.footer_text
  `);
  await sql(`
    INSERT INTO catalog_banners (title, subtitle, image_url, alt_text, button_text, button_link, is_active, sort_order)
    SELECT 'Sua nova fase começa aqui', 'Joias e perfurações com cuidado em cada detalhe.', 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=1600&q=80', 'Joias de piercing', 'Conheça o catálogo', '/catalogo', 1, 1
    WHERE NOT EXISTS (SELECT 1 FROM catalog_banners WHERE title = 'Sua nova fase começa aqui')
  `);
  await sql(`
    INSERT INTO catalog_featured_categories (category_id, public_name, icon, image_url, description, is_active, sort_order)
    SELECT DISTINCT category, category, 'Sparkles', 'https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=600&q=80', 'Seleção de ' || category, 1, row_number() OVER (ORDER BY category)
    FROM jewelry_inventory
    WHERE NOT EXISTS (SELECT 1 FROM catalog_featured_categories c WHERE c.category_id = jewelry_inventory.category)
  `);
  await sql(`
    INSERT INTO catalog_featured_products (product_id, badge, is_active, sort_order)
    SELECT id, CASE WHEN is_new = 1 THEN 'Novidade' ELSE 'Mais desejada' END, 1, id FROM jewelry_inventory WHERE is_featured = 1
      AND NOT EXISTS (SELECT 1 FROM catalog_featured_products c WHERE c.product_id = jewelry_inventory.id)
  `);
  await sql(`
    INSERT INTO catalog_promotions (name, discount_type, discount_value, start_date, end_date, applies_to, category_ids, is_active, status, priority, badge, visible_in_catalog)
    SELECT 'Semana da Joia', 'percent', 15, to_char(CURRENT_DATE - 3, 'YYYY-MM-DD'), to_char(CURRENT_DATE + 21, 'YYYY-MM-DD'), 'categories', '["Argola","Labret"]', 1, 'active', 10, '15% OFF', 1
    WHERE NOT EXISTS (SELECT 1 FROM catalog_promotions WHERE name = 'Semana da Joia')
  `);
  await sql(`
    INSERT INTO coupons (code, internal_name, description, discount_type, discount_value, starts_at, ends_at, usage_limit, minimum_amount, status)
    VALUES ('BEMVINDA15', 'Boas-vindas', '15% na primeira experiência.', 'percent', 15, CURRENT_TIMESTAMP - interval '1 day', CURRENT_TIMESTAMP + interval '60 days', 200, 80, 'active')
    ON CONFLICT (code) DO UPDATE SET status = 'active', ends_at = EXCLUDED.ends_at
  `);

  await sql(`
    INSERT INTO inventory_suggestions (jewelry_id, suggestion_type, current_value, suggested_value, reason, confidence, status, reviewed_by)
    SELECT id, CASE WHEN id % 2 = 0 THEN 'reorder' ELSE 'price' END, quantity::text, CASE WHEN id % 2 = 0 THEN '20' ELSE (sale_value + 10)::text END, 'Sugestão gerada para massa de testes.', 0.87,
      CASE WHEN id % 3 = 0 THEN 'accepted' ELSE 'pending' END, (SELECT id FROM users ORDER BY id LIMIT 1)
    FROM jewelry_inventory WHERE id % 5 = 0
      AND NOT EXISTS (SELECT 1 FROM inventory_suggestions s WHERE s.jewelry_id = jewelry_inventory.id AND s.reason = 'Sugestão gerada para massa de testes.')
  `);
  await sql(`
    INSERT INTO inventory_counts (status, notes, created_by, completed_by, completed_at)
    SELECT 'completed', $1, (SELECT id FROM users ORDER BY id LIMIT 1), (SELECT id FROM users ORDER BY id LIMIT 1), to_char(CURRENT_TIMESTAMP - interval '2 days', 'YYYY-MM-DD HH24:MI:SS')
    WHERE NOT EXISTS (SELECT 1 FROM inventory_counts WHERE notes = $1)
  `, [marker]);
  await sql(`
    INSERT INTO inventory_count_items (count_id, jewelry_id, expected_quantity, counted_quantity, difference)
    SELECT (SELECT id FROM inventory_counts WHERE notes = $1 ORDER BY id DESC LIMIT 1), id, quantity, quantity - CASE WHEN id % 4 = 0 THEN 1 ELSE 0 END, CASE WHEN id % 4 = 0 THEN -1 ELSE 0 END
    FROM jewelry_inventory
    WHERE NOT EXISTS (SELECT 1 FROM inventory_count_items WHERE count_id = (SELECT id FROM inventory_counts WHERE notes = $1 ORDER BY id DESC LIMIT 1))
  `, [marker]);
  await sql(`
    INSERT INTO schedule_blocks (professional_id, start_datetime, end_datetime, block_type, reason, notes, is_full_day)
    SELECT id, to_char(CURRENT_DATE + 5, 'YYYY-MM-DD') || ' 12:00', to_char(CURRENT_DATE + 5, 'YYYY-MM-DD') || ' 14:00', 'block', 'Treinamento interno', $1, 0
    FROM professionals WHERE email = 'luna@aura.local'
      AND NOT EXISTS (SELECT 1 FROM schedule_blocks WHERE notes = $1)
  `, [marker]);
  await sql(`
    INSERT INTO inventory_reservations (reservation_key, appointment_id, client_id, jewelry_id, quantity, status, expires_at)
    SELECT $1 || '-reserva-' || a.id, a.id, a.client_id, a.jewelry_id, 1, 'active', CURRENT_TIMESTAMP + interval '2 days'
    FROM appointments a
    WHERE a.notes = $1 AND a.status IN ('pendente','awaiting_deposit_proof')
      AND NOT EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.reservation_key = $1 || '-reserva-' || a.id AND r.jewelry_id = a.jewelry_id)
    LIMIT 3
  `, [marker]);
  await sql(`
    INSERT INTO notification_queue (professional_id, appointment_id, client_id, channel, destination, template, payload, message, status, scheduled_at, unique_key)
    SELECT a.professional_id, a.id, a.client_id, 'whatsapp', c.whatsapp, 'reminder_24h', '{"demo":true}', 'Lembrete de demonstração.', 'pending', to_char(CURRENT_TIMESTAMP + interval '1 day', 'YYYY-MM-DD HH24:MI:SS'), $1 || '-notification-' || a.id
    FROM appointments a JOIN clients c ON c.id = a.client_id
    WHERE a.notes = $1 AND a.status = 'confirmado'
      AND NOT EXISTS (SELECT 1 FROM notification_queue n WHERE n.unique_key = $1 || '-notification-' || a.id)
    LIMIT 5
  `, [marker]);
  await sql(`
    INSERT INTO catalog_events (event_type, product_id, session_key, source, metadata, occurred_at)
    SELECT CASE WHEN g % 3 = 0 THEN 'product_view' WHEN g % 3 = 1 THEN 'catalog_view' ELSE 'checkout_started' END, j.id, $1 || '-session-' || g, 'catalog', '{"demo":true}', to_char(CURRENT_TIMESTAMP - (g || ' hours')::interval, 'YYYY-MM-DD HH24:MI:SS')
    FROM generate_series(1, 30) g JOIN LATERAL (SELECT id FROM jewelry_inventory ORDER BY id OFFSET ((g - 1) % GREATEST((SELECT count(*) FROM jewelry_inventory), 1)) LIMIT 1) j ON true
    WHERE NOT EXISTS (SELECT 1 FROM catalog_events WHERE session_key = $1 || '-session-' || g)
  `, [marker]);

  await client.query("COMMIT");
  const counts = await sql(`
    SELECT json_build_object(
      'clientes', (SELECT count(*) FROM clients), 'profissionais', (SELECT count(*) FROM professionals),
      'servicos', (SELECT count(*) FROM services), 'produtos', (SELECT count(*) FROM jewelry_inventory),
      'agendamentos', (SELECT count(*) FROM appointments), 'vendas', (SELECT count(*) FROM sales_orders),
      'lancamentos_financeiros', (SELECT count(*) FROM financial_entries)
    ) AS data
  `);
  console.log(JSON.stringify({ tenant: tenant.slug, imported, totals: counts.rows[0].data }, null, 2));
} catch (error) {
  try { await client.query("ROLLBACK"); } catch { /* sem transação aberta */ }
  throw error;
} finally {
  try { await client.query("SET search_path TO public"); } catch { /* conexão será descartada se necessário */ }
  client.release();
  await pool.end();
}
