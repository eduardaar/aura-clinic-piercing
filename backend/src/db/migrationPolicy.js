export function assertMigrationCliPolicy({ command, tenant, all, nodeEnv, allowGlobal }) {
  if (command !== "apply" || nodeEnv !== "production") return;
  if (tenant) return;
  if (all && allowGlobal === "true") return;
  throw new Error(
    "Refusing global tenant migration in production. Use --tenant=<id|slug> explicitly. " +
    "A global rollout additionally requires --all and ALLOW_GLOBAL_MIGRATIONS=true."
  );
}

export function databaseBootstrapIsDisabled(env = process.env) {
  if (env.SKIP_DATABASE_BOOTSTRAP === "true" || env.RUN_DATABASE_MIGRATIONS === "false") return true;
  // Em produção o bootstrap legado global é opt-in separado. Definir apenas
  // RUN_DATABASE_MIGRATIONS=true nunca autoriza varrer todos os tenants.
  if (env.NODE_ENV === "production" && env.ALLOW_LEGACY_GLOBAL_BOOTSTRAP !== "true") return true;
  return false;
}
