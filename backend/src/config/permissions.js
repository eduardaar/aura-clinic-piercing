// Catálogo único de autorização da API. Rotas nunca devem usar strings literais.
export const P = Object.freeze({
  DASHBOARD_VIEW: "dashboard.view", DASHBOARD_FINANCIAL: "dashboard.financial",
  APPOINTMENTS_VIEW: "appointments.view", APPOINTMENTS_CREATE: "appointments.create", APPOINTMENTS_EDIT: "appointments.edit",
  APPOINTMENTS_RESCHEDULE: "appointments.reschedule", APPOINTMENTS_CANCEL: "appointments.cancel", APPOINTMENTS_REVIEW: "appointments.review",
  APPOINTMENTS_FINALIZE: "appointments.finalize", APPOINTMENTS_APPLY_DISCOUNT: "appointments.apply_discount",
  APPOINTMENTS_APPLY_COUPON: "appointments.apply_coupon", APPOINTMENTS_EDIT_FINAL_VALUE: "appointments.edit_final_value",
  CLIENTS_VIEW: "clients.view", CLIENTS_CREATE: "clients.create", CLIENTS_EDIT: "clients.edit", CLIENTS_DELETE: "clients.delete",
  ANAMNESIS_VIEW: "anamnesis.view", ANAMNESIS_EDIT: "anamnesis.edit", ANAMNESIS_REVIEW: "anamnesis.review",
  CLINICAL_FILES_VIEW: "clinical_files.view", CLINICAL_FILES_EDIT: "clinical_files.edit",
  SALES_VIEW: "sales.view", SALES_CREATE: "sales.create", SALES_EDIT_OPEN: "sales.edit_open", SALES_EDIT_CLOSED: "sales.edit_closed", SALES_CANCEL: "sales.cancel",
  INVENTORY_VIEW: "inventory.view", INVENTORY_SELL: "inventory.sell", INVENTORY_ADJUST: "inventory.adjust", INVENTORY_CREATE: "inventory.create",
  INVENTORY_EDIT: "inventory.edit", INVENTORY_VIEW_COST: "inventory.view_cost", INVENTORY_DELETE: "inventory.delete",
  CASH_VIEW: "cash.view", CASH_OPEN: "cash.open", CASH_RECEIVE_PAYMENT: "cash.receive_payment", CASH_CLOSE: "cash.close", CASH_WITHDRAW: "cash.withdraw", CASH_ADJUST: "cash.adjust",
  FINANCE_VIEW: "finance.view", FINANCE_CREATE: "finance.create", FINANCE_EDIT: "finance.edit", FINANCE_CANCEL: "finance.cancel",
  FINANCE_MARK_TEST: "finance.mark_test", FINANCE_EXPENSES: "finance.expenses", FINANCE_REFUND: "finance.refund",
  REPORTS_VIEW_OWN: "reports.view_own", REPORTS_VIEW_FINANCIAL: "reports.view_financial", REPORTS_VIEW_ALL: "reports.view_all",
  COMMISSION_VIEW_OWN: "commission.view_own", COMMISSION_VIEW_ALL: "commission.view_all", COMMISSION_EDIT: "commission.edit",
  COMMUNICATION_VIEW: "communication.view", COMMUNICATION_SEND: "communication.send",
  COUPONS_VIEW: "coupons.view", COUPONS_APPLY: "coupons.apply", COUPONS_CREATE: "coupons.create", COUPONS_EDIT: "coupons.edit", COUPONS_DELETE: "coupons.delete",
  USERS_VIEW: "users.view", USERS_CREATE: "users.create", USERS_EDIT: "users.edit", USERS_DELETE: "users.delete", USERS_PERMISSIONS: "users.permissions",
  SETTINGS_VIEW: "settings.view", SETTINGS_EDIT: "settings.edit", AUDIT_VIEW: "audit.view"
});

export const ALL_PERMISSIONS = Object.freeze(Object.values(P));
export const PERMISSION_SET = new Set(ALL_PERMISSIONS);
