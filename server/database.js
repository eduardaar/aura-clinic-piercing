import sqlite3 from "sqlite3";
import { open } from "sqlite";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";

const DB_PATH = fileURLToPath(new URL("./data/aura-clinic.sqlite", import.meta.url));

export async function getDb() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export async function initDb() {
  const db = await getDb();

  // O schema fica centralizado aqui para o MVP rodar localmente sem migrações externas.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS professionals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      photo_url TEXT,
      specialty TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 40,
      price REAL NOT NULL DEFAULT 0,
      deposit_value REAL NOT NULL DEFAULT 0,
      active_online_booking INTEGER NOT NULL DEFAULT 1,
      pre_service_notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS professional_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      professional_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      UNIQUE(professional_id, service_id),
      FOREIGN KEY (professional_id) REFERENCES professionals(id),
      FOREIGN KEY (service_id) REFERENCES services(id)
    );

    CREATE TABLE IF NOT EXISTS professional_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      professional_id INTEGER NOT NULL,
      weekday INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      start_time TEXT NOT NULL DEFAULT '09:00',
      end_time TEXT NOT NULL DEFAULT '18:00',
      lunch_start TEXT,
      lunch_end TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 40,
      buffer_minutes INTEGER NOT NULL DEFAULT 10,
      FOREIGN KEY (professional_id) REFERENCES professionals(id),
      UNIQUE(professional_id, weekday)
    );

    CREATE TABLE IF NOT EXISTS schedule_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      professional_id INTEGER NOT NULL,
      start_datetime TEXT NOT NULL,
      end_datetime TEXT NOT NULL,
      reason TEXT NOT NULL,
      notes TEXT,
      is_full_day INTEGER NOT NULL DEFAULT 0,
      is_recurring INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (professional_id) REFERENCES professionals(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(type, name)
    );

    CREATE TABLE IF NOT EXISTS catalog_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS catalog_banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subtitle TEXT,
      image_url TEXT,
      button_text TEXT,
      button_link TEXT,
      banner_width INTEGER NOT NULL DEFAULT 0,
      banner_height INTEGER NOT NULL DEFAULT 340,
      banner_fit TEXT NOT NULL DEFAULT 'cover',
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS catalog_featured_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id TEXT NOT NULL,
      public_name TEXT NOT NULL,
      icon TEXT,
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS catalog_featured_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      badge TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (product_id) REFERENCES jewelry_inventory(id)
    );

    CREATE TABLE IF NOT EXISTS catalog_promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      discount_type TEXT NOT NULL DEFAULT 'percent',
      discount_value REAL NOT NULL DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      applies_to TEXT NOT NULL DEFAULT 'products',
      product_ids TEXT,
      category_ids TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS catalog_theme (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      brand_name TEXT NOT NULL DEFAULT 'Aura Clinic',
      slogan TEXT,
      logo_url TEXT,
      primary_color TEXT NOT NULL DEFAULT '#C8A96A',
      secondary_color TEXT NOT NULL DEFAULT '#D8C3A5',
      background_color TEXT NOT NULL DEFAULT '#F8F5F0',
      button_color TEXT NOT NULL DEFAULT '#C8A96A',
      title_font TEXT NOT NULL DEFAULT 'Georgia',
      body_font TEXT NOT NULL DEFAULT 'Inter',
      theme TEXT NOT NULL DEFAULT 'premium',
      show_out_of_stock INTEGER NOT NULL DEFAULT 0,
      show_stock_quantity INTEGER NOT NULL DEFAULT 0,
      stock_display_mode TEXT NOT NULL DEFAULT 'status',
      show_whatsapp_button INTEGER NOT NULL DEFAULT 1,
      show_schedule_button INTEGER NOT NULL DEFAULT 1,
      show_buy_button INTEGER NOT NULL DEFAULT 0,
      show_favorites INTEGER NOT NULL DEFAULT 1,
      footer_text TEXT
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      instagram TEXT,
      birth_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS jewelry_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      photo_url TEXT,
      gallery_urls TEXT,
      category TEXT NOT NULL,
      subcategory TEXT,
      variant_group TEXT,
      variation_label TEXT,
      material TEXT NOT NULL,
      color TEXT NOT NULL,
      stone TEXT,
      size TEXT,
      thickness TEXT,
      stem_length TEXT,
      thread_type TEXT,
      piercing_type TEXT,
      weight_grams REAL NOT NULL DEFAULT 0,
      package_length_cm REAL NOT NULL DEFAULT 0,
      package_width_cm REAL NOT NULL DEFAULT 0,
      package_height_cm REAL NOT NULL DEFAULT 0,
      package_type TEXT,
      virtual_store_active INTEGER NOT NULL DEFAULT 1,
      preparation_days INTEGER NOT NULL DEFAULT 1,
      shipping_info TEXT,
      seo_title TEXT,
      seo_description TEXT,
      freight_notes TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      cost_value REAL NOT NULL DEFAULT 0,
      sale_value REAL NOT NULL DEFAULT 0,
      supplier TEXT,
      physical_location TEXT,
      sku TEXT UNIQUE,
      is_catalog_active INTEGER NOT NULL DEFAULT 1,
      is_featured INTEGER NOT NULL DEFAULT 0,
      is_new INTEGER NOT NULL DEFAULT 0,
      is_most_wanted INTEGER NOT NULL DEFAULT 0,
      is_promotion INTEGER NOT NULL DEFAULT 0,
      is_last_units INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'disponível',
      low_stock_threshold INTEGER NOT NULL DEFAULT 5,
      critical_stock_threshold INTEGER NOT NULL DEFAULT 3
    );

    CREATE TABLE IF NOT EXISTS jewelry_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jewelry_id INTEGER NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      variation_name TEXT,
      material TEXT,
      color TEXT,
      stone_color TEXT,
      side TEXT,
      size TEXT,
      thickness TEXT,
      length TEXT,
      diameter TEXT,
      thread_type TEXT,
      supplier TEXT,
      cost_value REAL NOT NULL DEFAULT 0,
      sale_value REAL NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 0,
      low_stock_threshold INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'disponível',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (jewelry_id) REFERENCES jewelry_inventory(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jewelry_id INTEGER NOT NULL,
      variant_id INTEGER,
      movement_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      notes TEXT,
      movement_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (jewelry_id) REFERENCES jewelry_inventory(id),
      FOREIGN KEY (variant_id) REFERENCES jewelry_variants(id)
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      professional_id INTEGER NOT NULL,
      jewelry_id INTEGER,
      jewelry_variant_id INTEGER,
      procedure TEXT NOT NULL,
      description TEXT,
      piercing_region TEXT NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      total_value REAL NOT NULL DEFAULT 0,
      deposit_value REAL NOT NULL DEFAULT 0,
      remaining_value REAL NOT NULL DEFAULT 0,
      deposit_payment_method TEXT,
      remaining_payment_method TEXT,
      status TEXT NOT NULL DEFAULT 'pendente',
      notes TEXT,
      reference_photo_url TEXT,
      stock_deducted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (professional_id) REFERENCES professionals(id),
      FOREIGN KEY (jewelry_id) REFERENCES jewelry_inventory(id),
      FOREIGN KEY (jewelry_variant_id) REFERENCES jewelry_variants(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_type TEXT NOT NULL,
      method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pago',
      paid_at TEXT NOT NULL,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS sales_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      appointment_id INTEGER,
      order_type TEXT NOT NULL DEFAULT 'produto',
      source TEXT NOT NULL DEFAULT 'site',
      status TEXT NOT NULL DEFAULT 'aberta',
      payment_method TEXT,
      total_value REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (appointment_id) REFERENCES appointments(id),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sales_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_order_id INTEGER NOT NULL,
      item_type TEXT NOT NULL DEFAULT 'produto',
      product_id INTEGER,
      product_variant_id INTEGER,
      service_id INTEGER,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
      FOREIGN KEY (product_id) REFERENCES jewelry_inventory(id),
      FOREIGN KEY (product_variant_id) REFERENCES jewelry_variants(id),
      FOREIGN KEY (service_id) REFERENCES services(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      expense_type TEXT NOT NULL CHECK(expense_type IN ('fixa', 'variavel')),
      category TEXT,
      amount REAL NOT NULL DEFAULT 0,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'paga',
      payment_method TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS client_medical_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      appointment_id INTEGER,
      record_date TEXT NOT NULL,
      piercing_history TEXT,
      jewelry_used TEXT,
      before_photo_url TEXT,
      after_photo_url TEXT,
      occurrences TEXT,
      guidance TEXT,
      allergies_notes TEXT,
      healing_evolution TEXT,
      returns_done TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (appointment_id) REFERENCES appointments(id)
    );

    CREATE TABLE IF NOT EXISTS digital_terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      social_name TEXT,
      document_number TEXT,
      birth_date TEXT,
      whatsapp TEXT,
      instagram TEXT,
      address TEXT,
      procedure TEXT,
      piercing_region TEXT,
      orientations_confirmed INTEGER NOT NULL DEFAULT 0,
      health_declaration TEXT,
      form_data TEXT NOT NULL DEFAULT '',
      signature_data_url TEXT NOT NULL,
      pdf_url TEXT,
      signed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS post_care_followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      reminder_day INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      care_message TEXT NOT NULL,
      healing_status TEXT NOT NULL DEFAULT 'aguardando retorno',
      client_photo_url TEXT,
      client_notes TEXT,
      status TEXT NOT NULL DEFAULT 'pendente',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(appointment_id, reminder_day),
      FOREIGN KEY (appointment_id) REFERENCES appointments(id),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS loyalty_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      appointment_id INTEGER,
      points INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(appointment_id, event_type),
      FOREIGN KEY (client_id) REFERENCES clients(id),
      FOREIGN KEY (appointment_id) REFERENCES appointments(id)
    );

    CREATE TABLE IF NOT EXISTS loyalty_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      points_used INTEGER NOT NULL,
      discount_value REAL NOT NULL DEFAULT 0,
      notes TEXT,
      redeemed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );
  `);

  await ensureColumn(db, "clients", "birth_date", "TEXT");
  await ensureColumn(db, "digital_terms", "instagram", "TEXT");
  await ensureColumn(db, "digital_terms", "social_name", "TEXT");
  await ensureColumn(db, "digital_terms", "form_data", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "jewelry_inventory", "description", "TEXT");
  await ensureColumn(db, "jewelry_inventory", "gallery_urls", "TEXT");
  await ensureColumn(db, "jewelry_inventory", "subcategory", "TEXT");
  await ensureColumn(db, "jewelry_inventory", "variant_group", "TEXT");
  await ensureColumn(db, "jewelry_inventory", "variation_label", "TEXT");
  await ensureColumn(db, "jewelry_inventory", "piercing_type", "TEXT");
  await ensureColumn(db, "jewelry_inventory", "weight_grams", "REAL NOT NULL DEFAULT 0");
  await ensureColumn(db, "jewelry_inventory", "package_length_cm", "REAL NOT NULL DEFAULT 0");
  await ensureColumn(db, "jewelry_inventory", "package_width_cm", "REAL NOT NULL DEFAULT 0");
  await ensureColumn(db, "jewelry_inventory", "package_height_cm", "REAL NOT NULL DEFAULT 0");
  await ensureColumn(db, "jewelry_inventory", "package_type", "TEXT");
  await ensureColumn(db, "jewelry_inventory", "virtual_store_active", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(db, "jewelry_inventory", "preparation_days", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(db, "jewelry_inventory", "shipping_info", "TEXT");
  await ensureColumn(db, "jewelry_inventory", "seo_title", "TEXT");
  await ensureColumn(db, "jewelry_inventory", "seo_description", "TEXT");
  await ensureColumn(db, "jewelry_inventory", "freight_notes", "TEXT");
  await ensureColumn(db, "jewelry_inventory", "physical_location", "TEXT");
  await ensureColumn(db, "jewelry_inventory", "is_catalog_active", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(db, "jewelry_inventory", "is_featured", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "jewelry_inventory", "is_new", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "jewelry_inventory", "is_most_wanted", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "jewelry_inventory", "is_promotion", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "jewelry_inventory", "is_last_units", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "jewelry_inventory", "critical_stock_threshold", "INTEGER NOT NULL DEFAULT 3");
  await ensureColumn(db, "stock_movements", "variant_id", "INTEGER");
  await ensureColumn(db, "appointments", "jewelry_variant_id", "INTEGER");
  await ensureColumn(db, "sales_order_items", "product_variant_id", "INTEGER");
  await ensureColumn(db, "jewelry_variants", "stone_color", "TEXT");
  await ensureColumn(db, "jewelry_variants", "side", "TEXT");
  await ensureColumn(db, "catalog_banners", "banner_width", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "catalog_banners", "banner_height", "INTEGER NOT NULL DEFAULT 340");
  await ensureColumn(db, "catalog_banners", "banner_fit", "TEXT NOT NULL DEFAULT 'cover'");
  await ensureColumn(db, "professionals", "photo_url", "TEXT");
  await ensureColumn(db, "appointments", "service_id", "INTEGER");
  await ensureColumn(db, "appointments", "end_time", "TEXT");
  await ensureColumn(db, "appointments", "payment_proof_url", "TEXT");
  await seedInventoryOptions(db);
  await seedCatalogSettings(db);
  await seedCatalogCustomization(db);

  const userCount = await db.get("SELECT COUNT(*) AS count FROM users");
  const isFirstRun = userCount.count === 0;
  if (isFirstRun) {
    await seed(db);
    await seedBirthdaysForDemoClients(db);
    await seedExpenses(db);
    await seedMedicalRecords(db);
  }

  // Serviços, disponibilidade e demais configurações permanecem disponíveis
  // mesmo depois que os dados de demonstração forem removidos.
  await seedBookingData(db);
  await migrateJewelryToVariants(db);
  await consolidateDuplicateJewelryProducts(db);
  await consolidateColorOnlyVariants(db);
  await enrichJewelryVariantLabels(db);
  await normalizeVariantSkuSequences(db);
  await syncCatalogJewelryCategories(db);

  await db.close();
}

async function seed(db) {
  // Dados de exemplo refletem uma rotina real da Aura: agenda, profissionais e joias premium.
  const passwordHash = await bcrypt.hash("aura123", 10);
  await db.run(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
    ["Administrador Aura", "admin@auraclinic.com", passwordHash, "admin"]
  );

  const professionals = [
    ["Bianca Araujo", "Body piercer especialista em orelha fina"],
    ["Marina Vale", "Body piercer especialista em nasal e oral"],
    ["Clara Menezes", "Curadoria de joalherias premium"]
  ];
  for (const item of professionals) {
    await db.run("INSERT INTO professionals (name, specialty) VALUES (?, ?)", item);
  }

  await seedInventoryOptions(db);

  const clients = [
    ["Livia Carvalho", "(11) 99988-2211", "@liviacarvalho", birthdayOffset(5), "Prefere joias douradas delicadas."],
    ["Camila Rocha", "(21) 98877-4400", "@cami.rocha", birthdayOffset(18), "Alergia a níquel informada."],
    ["Renata Alves", "(31) 97766-5522", "@renataalves", birthdayOffset(45), "Cliente recorrente, bom histórico de cicatrização."]
  ];
  for (const item of clients) {
    await db.run("INSERT INTO clients (full_name, whatsapp, instagram, birth_date, notes) VALUES (?, ?, ?, ?, ?)", item);
  }

  const jewelry = [
    ["Labret Aura Gold", "/placeholder-jewel-gold.svg", "labret", "titânio grau implante", "dourado", "zircônia", "2mm", "1.2mm", "8mm", "interna", 6, 48, 120, "NeoMetal", "AURA-LAB-001", "Acabamento polido premium.", "disponível", 5],
    ["Clicker Rosé Opala", "/placeholder-jewel-rose.svg", "clicker", "ouro 18k", "rosé", "opala", "8mm", "1.2mm", "", "threadless", 2, 210, 520, "BVLA", "AURA-CLK-014", "Peça para curadoria especial.", "baixo estoque", 5],
    ["Nostril Minimal Prata", "/placeholder-jewel-silver.svg", "nostril", "titânio grau implante", "prata", "sem pedra", "1.5mm", "0.8mm", "7mm", "threadless", 0, 32, 90, "Industrial Strength", "AURA-NOS-009", "Reposição pendente.", "esgotado", 5],
    ["Topo Cristal Champagne", "/placeholder-jewel-champagne.svg", "topo", "ouro 14k", "dourado", "cristal", "3mm", "1.2mm", "", "interna", 4, 98, 240, "Aura Select", "AURA-TOP-031", "Brilho suave para composições.", "disponível", 5]
  ];
  for (const item of jewelry) {
    await db.run(
      `INSERT INTO jewelry_inventory
      (name, photo_url, category, material, color, stone, size, thickness, stem_length, thread_type, quantity, cost_value, sale_value, supplier, sku, notes, status, low_stock_threshold)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item
    );
  }

  const appointments = [
    [1, 1, 1, "Helix com joia premium", "Perfuração helix com composição dourada.", "Orelha - helix", todayOffset(0), "10:00", 280, 80, 200, "Pix", "cartão de crédito", "confirmado", "Enviar orientações de cuidados.", ""],
    [2, 2, 2, "Conch com clicker", "Troca de joia e avaliação.", "Orelha - conch", todayOffset(0), "14:30", 620, 120, 500, "cartão de débito", "Pix", "pendente", "Cliente quer opala rosé.", ""],
    [3, 1, 4, "Flat com topo champagne", "Perfuração delicada em flat.", "Orelha - flat", todayOffset(1), "11:00", 360, 100, 260, "dinheiro", "cartão de crédito", "confirmado", "Chegar 10 min antes.", ""],
    [1, 3, 1, "Retorno de cicatrização", "Avaliação pós-procedimento.", "Orelha - helix", todayOffset(-2), "16:00", 80, 80, 0, "Pix", "Pix", "atendido", "Cicatrização boa.", ""]
  ];

  for (const item of appointments) {
    const result = await db.run(
      `INSERT INTO appointments
      (client_id, professional_id, jewelry_id, procedure, description, piercing_region, appointment_date, appointment_time, total_value, deposit_value, remaining_value, deposit_payment_method, remaining_payment_method, status, notes, reference_photo_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item
    );
    await db.run(
      "INSERT INTO payments (appointment_id, client_id, amount, payment_type, method, status, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [result.lastID, item[0], item[9], "sinal", item[11], "pago", `${item[6]}T${item[7]}:00`]
    );
  }
}

function todayOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function birthdayOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `1994-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function ensureColumn(db, table, column, definition) {
  const columns = await db.all(`PRAGMA table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function seedBirthdaysForDemoClients(db) {
  const demoBirthdays = [
    ["Livia Carvalho", birthdayOffset(5)],
    ["Camila Rocha", birthdayOffset(18)],
    ["Renata Alves", birthdayOffset(45)]
  ];
  for (const [name, birthDate] of demoBirthdays) {
    await db.run("UPDATE clients SET birth_date = COALESCE(birth_date, ?) WHERE full_name = ?", [birthDate, name]);
  }
}

async function seedInventoryOptions(db) {
  const options = {
    category: ["Labret", "Argolas", "Barbell Reto", "Barbell Curvo", "Nostril", "Topos", "Microdermal", "Surface", "Ouro 14k", "Ouro 18k"],
    size: ["1.5mm", "2mm", "3mm", "4mm", "6mm", "8mm", "10mm"],
    thickness: ["0.8mm", "1.0mm", "1.2mm", "1.6mm"]
  };
  for (const [type, names] of Object.entries(options)) {
    for (const name of names) {
      await db.run("INSERT OR IGNORE INTO inventory_options (type, name) VALUES (?, ?)", [type, name]);
    }
  }
}

async function migrateJewelryToVariants(db) {
  const products = await db.all("SELECT * FROM jewelry_inventory ORDER BY id");
  for (const product of products) {
    const existing = await db.get("SELECT id FROM jewelry_variants WHERE jewelry_id = ? LIMIT 1", [product.id]);
    if (existing) continue;
    let sku = product.sku || `AURA-${String(product.id).padStart(4, "0")}-01`;
    const duplicate = await db.get("SELECT id FROM jewelry_variants WHERE sku = ?", [sku]);
    if (duplicate) sku = `${sku}-${product.id}`;
    await db.run(
      `INSERT INTO jewelry_variants
      (jewelry_id, sku, variation_name, material, color, size, thickness, length, diameter, thread_type, supplier, cost_value, sale_value, quantity, low_stock_threshold, status, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        product.id,
        sku,
        product.variation_label || "Variação principal",
        product.material || "",
        product.color || "",
        product.size || "",
        product.thickness || "",
        product.stem_length || "",
        product.category === "Argolas" || String(product.category || "").toLowerCase().includes("argola") ? product.size || "" : "",
        product.thread_type || "",
        product.supplier || "",
        Number(product.cost_value || 0),
        Number(product.sale_value || 0),
        Number(product.quantity || 0),
        Number(product.low_stock_threshold || 5),
        product.status || "disponível"
      ]
    );
  }
}

async function consolidateDuplicateJewelryProducts(db) {
  const products = await db.all("SELECT * FROM jewelry_inventory ORDER BY id");
  const groups = new Map();
  for (const product of products) {
    const category = canonicalJewelryCategory(product.category, product.name);
    const subcategory = category === "Argolas"
      ? canonicalArgolaSubcategory(product.subcategory || product.category)
      : "";
    const baseName = elegantProductName(product.variant_group?.trim() || product.name
      .replace(/\b\d+(?:[.,]\d+)?\s*mm\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/[-–]\s*$/g, "")
      .trim());
    await db.run(
      "UPDATE jewelry_inventory SET name = ?, category = ?, subcategory = ? WHERE id = ?",
      [baseName || product.name, category, subcategory, product.id]
    );
    const key = `${category}|${(baseName || product.name).toLocaleLowerCase("pt-BR")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...product, name: baseName || product.name, category, subcategory });
  }

  for (const groupedProducts of groups.values()) {
    if (groupedProducts.length < 2) continue;
    const keeper = groupedProducts[0];
    for (const duplicate of groupedProducts.slice(1)) {
      await db.run("UPDATE jewelry_variants SET jewelry_id = ? WHERE jewelry_id = ?", [keeper.id, duplicate.id]);
      await db.run("UPDATE stock_movements SET jewelry_id = ? WHERE jewelry_id = ?", [keeper.id, duplicate.id]);
      await db.run("UPDATE appointments SET jewelry_id = ? WHERE jewelry_id = ?", [keeper.id, duplicate.id]);
      await db.run("UPDATE sales_order_items SET product_id = ? WHERE product_id = ?", [keeper.id, duplicate.id]);
      await db.run("UPDATE catalog_featured_products SET product_id = ? WHERE product_id = ?", [keeper.id, duplicate.id]);
      await db.run("DELETE FROM jewelry_inventory WHERE id = ?", [duplicate.id]);
    }
  }
  const remainingProducts = await db.all("SELECT id FROM jewelry_inventory");
  for (const product of remainingProducts) {
    const summary = await db.get(`
      SELECT
        COALESCE(SUM(quantity), 0) AS quantity,
        COALESCE(MIN(NULLIF(cost_value, 0)), 0) AS cost_value,
        COALESCE(MIN(NULLIF(sale_value, 0)), 0) AS sale_value
      FROM jewelry_variants
      WHERE jewelry_id = ? AND is_active = 1
    `, [product.id]);
    const status = Number(summary.quantity || 0) <= 0 ? "esgotado" : "disponível";
    await db.run(
      "UPDATE jewelry_inventory SET quantity = ?, cost_value = ?, sale_value = ?, status = ? WHERE id = ?",
      [summary.quantity, summary.cost_value, summary.sale_value, status, product.id]
    );
  }
}

function elegantProductName(value = "") {
  const smallWords = new Set(["de", "da", "do", "das", "dos", "e", "com", "para"]);
  const normalized = String(value || "")
    .replace(/tit\?nio/gi, "titânio")
    .replace(/tit�nio/gi, "titânio")
    .replace(/zirc\?nia/gi, "zircônia")
    .replace(/^Joias Premium\b/i, "Joia Premium")
    .replace(/\bTitanio\b/gi, "Titânio")
    .replace(/\bZirconia\b/gi, "Zircônia")
    .replace(/\s+/g, " ")
    .trim();
  return normalized
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((word, index) => {
      if (/^\d+(?:k|mm)?$/i.test(word)) return word.toLowerCase();
      if (index > 0 && smallWords.has(word)) return word;
      return word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1);
    })
    .join(" ");
}

function canonicalJewelryCategory(value = "", productName = "") {
  const normalized = `${value} ${productName}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("ouro 14")) return "Ouro 14k";
  if (normalized.includes("ouro 18")) return "Ouro 18k";
  if (normalized.includes("microdermal")) return "Microdermal";
  if (normalized.includes("surface")) return "Surface";
  if (normalized.includes("nostril")) return "Nostril";
  if (normalized.includes("topo") || normalized.includes("disco")) return "Topos";
  if (normalized.includes("clicker") || normalized.includes("argola") || normalized.includes("segmento") || normalized.includes("captive") || normalized.includes("d-ring")) return "Argolas";
  if (normalized.includes("curvo") || normalized.includes("banana") || normalized.includes("microbell")) return "Barbell Curvo";
  if (normalized.includes("reto") || normalized.includes("haste") || normalized.includes("barbell")) return "Barbell Reto";
  return "Labret";
}

function canonicalArgolaSubcategory(value = "") {
  const normalized = String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("clicker")) return "Clicker";
  if (normalized.includes("d-ring")) return "D-Ring";
  if (normalized.includes("captive")) return "Captive";
  if (normalized.includes("hinged")) return "Hinged Ring";
  return "Segmento";
}

async function syncCatalogJewelryCategories(db) {
  const categories = ["Todos", "Labret", "Argolas", "Barbell Reto", "Barbell Curvo", "Nostril", "Topos", "Microdermal", "Surface", "Ouro 14k", "Ouro 18k"];
  const currentSetting = await db.get("SELECT value FROM catalog_settings WHERE key = 'categories'");
  const hasLegacySetting = !currentSetting?.value || /Nariz|Orelha|Umbigo|Opalas|Lan[cç]amentos/i.test(currentSetting.value);
  if (hasLegacySetting) {
    await db.run(
      "INSERT INTO catalog_settings (key, value) VALUES ('categories', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [categories.join(",")]
    );
  }
  const currentFeatured = await db.all("SELECT category_id FROM catalog_featured_categories");
  const hasLegacyFeatured = currentFeatured.length === 0 || currentFeatured.some((item) => /Nariz|Orelha|Umbigo|Opalas|tit[aâ]nio/i.test(item.category_id));
  if (hasLegacyFeatured) {
    await db.run("DELETE FROM catalog_featured_categories");
    for (let index = 1; index < categories.length; index += 1) {
      const name = categories[index];
      await db.run(
        "INSERT INTO catalog_featured_categories (category_id, public_name, icon, image_url, is_active, sort_order) VALUES (?, ?, 'gem', '', 1, ?)",
        [name, name, index]
      );
    }
  }
}

async function enrichJewelryVariantLabels(db) {
  const variants = await db.all("SELECT * FROM jewelry_variants ORDER BY jewelry_id, id");
  for (const variant of variants) {
    const current = String(variant.variation_name || "").trim();
    const imported = String(variant.sku || "").startsWith("IMP-");
    if (!imported && current && !/^Variação principal$/i.test(current) && !/^Variação \d+$/i.test(current)) continue;
    const label = [
      variant.diameter,
      variant.length,
      variant.size,
      variant.thickness,
      variant.material,
      variant.color,
      variant.thread_type
    ].map(normalizeVariantLabelValue).filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join(" · ");
    await db.run("UPDATE jewelry_variants SET variation_name = ? WHERE id = ?", [label || `Variação ${variant.id}`, variant.id]);
  }
  await db.run(`
    UPDATE jewelry_inventory
    SET
      description = REPLACE(REPLACE(COALESCE(description, ''), ' ? ', ' · '), '??', 'ç'),
      notes = REPLACE(REPLACE(COALESCE(notes, ''), ' ? ', ' · '), '??', 'ç')
  `);
}

function normalizeVariantLabelValue(value) {
  return String(value || "")
    .replace(/tit\?nio/gi, "titânio")
    .replace(/zirc\?nia/gi, "zircônia")
    .replace(/a\?o/gi, "aço")
    .trim();
}

async function consolidateColorOnlyVariants(db) {
  const products = await db.all("SELECT id FROM jewelry_inventory ORDER BY id");
  for (const product of products) {
    const variants = await db.all("SELECT * FROM jewelry_variants WHERE jewelry_id = ? AND is_active = 1 ORDER BY id", [product.id]);
    const groups = new Map();
    for (const variant of variants) {
      const key = [
        variant.material,
        variant.size,
        variant.thickness,
        variant.length,
        variant.diameter,
        variant.thread_type,
        variant.side,
        variant.stone_color,
        variant.cost_value,
        variant.sale_value
      ].map((value) => String(value || "").trim().toLowerCase()).join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(variant);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const keeper = group[0];
      const colors = [...new Set(group.flatMap((variant) => String(variant.color || "").split(",")).map((value) => value.trim()).filter(Boolean))];
      const quantity = group.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0);
      for (const duplicate of group.slice(1)) {
        await db.run("UPDATE stock_movements SET variant_id = ? WHERE variant_id = ?", [keeper.id, duplicate.id]);
        await db.run("UPDATE appointments SET jewelry_variant_id = ? WHERE jewelry_variant_id = ?", [keeper.id, duplicate.id]);
        await db.run("UPDATE sales_order_items SET product_variant_id = ? WHERE product_variant_id = ?", [keeper.id, duplicate.id]);
        await db.run("DELETE FROM jewelry_variants WHERE id = ?", [duplicate.id]);
      }
      await db.run(
        "UPDATE jewelry_variants SET color = ?, quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [colors.join(", "), quantity, quantity <= 0 ? "esgotado" : quantity <= Number(keeper.low_stock_threshold || 5) ? "baixo estoque" : "disponível", keeper.id]
      );
    }
  }
}

async function seedCatalogSettings(db) {
  const settings = {
    title: "Escolha a joia perfeita para você",
    subtitle: "Curadoria premium da Aura Clinic Piercing",
    hero_title: "Joias de alta qualidade",
    hero_subtitle: "para realçar sua essência",
    hero_image_url: "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
    categories: "Todos,Nariz,Orelha,Umbigo,Surface,Ouro 14k,Ouro 18k,Titânio,Opalas,Lançamentos",
    whatsapp_phone: "",
    whatsapp_message: "Olá! Vim pelo catálogo online da Aura Clinic e quero ajuda para escolher uma joia.",
    company_instagram: "",
    company_email: "",
    company_address: "",
    company_hours: "",
    layout_style: "premium"
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.run("INSERT OR IGNORE INTO catalog_settings (key, value) VALUES (?, ?)", [key, value]);
  }
}

async function seedCatalogCustomization(db) {
  await db.run(
    `INSERT OR IGNORE INTO catalog_theme
    (id, brand_name, slogan, logo_url, primary_color, secondary_color, background_color, button_color, title_font, body_font, theme, footer_text)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "Aura Clinic",
      "Piercing premium e joalherias selecionadas",
      "",
      "#C8A96A",
      "#D8C3A5",
      "#F8F5F0",
      "#C8A96A",
      "Georgia",
      "Inter",
      "premium",
      "Aura Clinic Piercing. Curadoria de joias, cuidado e atendimento especializado."
    ]
  );

  const bannerCount = await db.get("SELECT COUNT(*) AS count FROM catalog_banners");
  if (bannerCount.count === 0) {
    await db.run(
      `INSERT INTO catalog_banners (title, subtitle, image_url, button_text, button_link, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
      [
        "Escolha a joia perfeita para você",
        "Joias de alta qualidade para realçar sua essência.",
        "https://images.unsplash.com/photo-1602751584552-8ba73aad10e1?auto=format&fit=crop&w=1200&q=85",
        "Ver todas as joias",
        "#catalog-products"
      ]
    );
  }

  const categoryCount = await db.get("SELECT COUNT(*) AS count FROM catalog_featured_categories");
  if (categoryCount.count === 0) {
    const categories = [
      ["nostril", "Nariz", "sparkles", "", 1],
      ["labret", "Orelha", "heart", "", 2],
      ["banana", "Umbigo", "circle", "", 3],
      ["surface", "Surface", "sparkles", "", 4],
      ["ouro 14k", "Ouro 14k", "gem", "", 5],
      ["titânio", "Titânio", "shield", "", 6],
      ["opala", "Opalas", "star", "", 7]
    ];
    for (const item of categories) {
      await db.run(
        "INSERT INTO catalog_featured_categories (category_id, public_name, icon, image_url, sort_order) VALUES (?, ?, ?, ?, ?)",
        item
      );
    }
  }
}

async function seedBookingData(db) {
  const serviceCount = await db.get("SELECT COUNT(*) AS count FROM services");
  if (serviceCount.count === 0) {
    const services = [
      ["Nostril", "Perfuração nasal com curadoria Aura.", 40, 180, 60, 1, "Chegue alimentada e evite álcool nas 24h anteriores."],
      ["Hélix", "Perfuração delicada na orelha.", 40, 180, 60, 1, "Traga referências e informe alergias."],
      ["Conch", "Perfuração em conch com orientação completa.", 50, 220, 80, 1, "Evite dormir sobre a região após o procedimento."],
      ["Umbigo", "Perfuração de umbigo com avaliação anatômica.", 50, 240, 80, 1, "Use roupa confortável no dia."],
      ["Troca de joia", "Troca assistida e avaliação da cicatrização.", 30, 80, 0, 1, "Leve a joia ou escolha uma opção no catálogo."],
      ["Laserterapia", "Sessão de laserterapia para cicatrização.", 30, 120, 40, 1, "Indicado após avaliação profissional."]
    ];
    for (const item of services) {
      await db.run(
        "INSERT INTO services (name, description, duration_minutes, price, deposit_value, active_online_booking, pre_service_notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        item
      );
    }
  }

  const professionals = await db.all("SELECT id FROM professionals WHERE active = 1");
  const services = await db.all("SELECT id FROM services");
  for (const professional of professionals) {
    for (const service of services) {
      await db.run("INSERT OR IGNORE INTO professional_services (professional_id, service_id) VALUES (?, ?)", [professional.id, service.id]);
    }
    for (const weekday of [1, 2, 3, 4, 5, 6]) {
      await db.run(
        `INSERT OR IGNORE INTO professional_availability
        (professional_id, weekday, is_active, start_time, end_time, lunch_start, lunch_end, duration_minutes, buffer_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [professional.id, weekday, weekday === 6 ? 0 : 1, "09:00", "18:00", "12:00", "13:30", 40, 10]
      );
    }
  }
}

async function seedExpenses(db) {
  const count = await db.get("SELECT COUNT(*) AS count FROM expenses");
  if (count.count > 0) return;
  const month = new Date().toISOString().slice(0, 7);
  const expenses = [
    ["Aluguel da sala", "fixa", "estrutura", 1800, `${month}-05`, "paga", "Pix", "Despesa fixa mensal"],
    ["Materiais descartáveis", "variavel", "insumos", 420, `${month}-10`, "paga", "cartão de débito", "Luvas, campos e esterilização"],
    ["Marketing Instagram", "fixa", "marketing", 350, `${month}-15`, "pendente", "cartão de crédito", "Impulsionamento mensal"]
  ];
  for (const item of expenses) {
    await db.run(
      "INSERT INTO expenses (description, expense_type, category, amount, due_date, status, payment_method, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      item
    );
  }
}

async function seedMedicalRecords(db) {
  const count = await db.get("SELECT COUNT(*) AS count FROM client_medical_records");
  if (count.count > 0) return;
  await db.run(
    `INSERT INTO client_medical_records
    (client_id, appointment_id, record_date, piercing_history, jewelry_used, occurrences, guidance, allergies_notes, healing_evolution, returns_done)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      1,
      4,
      todayOffset(-2),
      "Helix realizado com boa resposta inicial.",
      "Labret Aura Gold",
      "Sem intercorrências relatadas.",
      "Higienização com solução indicada e evitar atrito.",
      "Sem alergias relatadas.",
      "Cicatrização estável, sem edema importante.",
      "Retorno de cicatrização realizado."
    ]
  );
}

async function normalizeVariantSkuSequences(db) {
  const products = await db.all("SELECT id, sku FROM jewelry_inventory ORDER BY id");
  for (const product of products) {
    const variants = await db.all(
      "SELECT id, sku FROM jewelry_variants WHERE jewelry_id = ? ORDER BY id",
      [product.id]
    );
    if (!variants.length) continue;
    const firstSku = String(variants[0].sku || product.sku || "").trim();
    const base = firstSku.replace(/-\d{2,3}$/, "");
    if (!base) continue;

    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      const currentSku = String(variant.sku || "").trim();
      const legacyAutomatic = !currentSku || currentSku.startsWith(`AURA-${product.id}-`);
      if (!legacyAutomatic) continue;
      const nextSku = `${base}-${String(index + 1).padStart(2, "0")}`;
      const duplicate = await db.get(
        "SELECT id FROM jewelry_variants WHERE sku = ? AND id != ?",
        [nextSku, variant.id]
      );
      if (!duplicate) {
        await db.run(
          "UPDATE jewelry_variants SET sku = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [nextSku, variant.id]
        );
      }
    }
  }
}
