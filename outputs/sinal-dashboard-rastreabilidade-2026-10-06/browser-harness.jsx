import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "./src/lib/queryClient";
import { useFetch, readStoredSession } from "./src/lib/api";
import { Reports } from "./src/features/reports/Reports";
import { AccountsReceivable } from "./src/features/finance/Receivables";
import { AppointmentQuickModal } from "./src/features/agenda/Agenda";
import { Dashboard } from "./src/features/dashboard/Dashboard";
import "./src/styles.css";
import "./src/styles/appshell.css";
import "./src/styles/operations-responsive.css";
import "./src/styles/responsive.css";
function TestApp() {
  const [page, setPage] = useState("dashboard");
  const [open, setOpen] = useState(false);
  const id = new URLSearchParams(location.search).get("appointment");
  const appointment = useFetch(`/appointments?id=${id}`);
  const services = useFetch("/services");
  const options = useFetch("/options");
  const item = (Array.isArray(appointment.data) ? appointment.data : appointment.data?.items)?.[0];
  return <main className="app-main"><nav className="toolbar"><button onClick={() => setPage("dashboard")}>Dashboard QA</button><button onClick={() => setPage("reports")}>Relatórios QA</button><button onClick={() => setPage("receivables")}>Recebíveis QA</button><button onClick={() => setOpen(true)}>Conferir atendimento QA</button></nav>
    {page === "dashboard" && <Dashboard user={readStoredSession()?.user} setPage={setPage} setAlertsOpen={() => {}} />}
    {page === "reports" && <Reports />}
    {page === "receivables" && <AccountsReceivable />}
    {open && item && <AppointmentQuickModal appointment={item} options={options.data || {}} services={Array.isArray(services.data) ? services.data : services.data?.items || []} procedures={[]} features={["basic_finance", "basic_catalog"]} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); appointment.refresh(); }} />}
  </main>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={createQueryClient()}><TestApp /></QueryClientProvider>);
