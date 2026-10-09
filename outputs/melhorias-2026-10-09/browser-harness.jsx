import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "./src/lib/queryClient";
import { useFetch } from "./src/lib/api";
import "./src/styles.css";
import { AppointmentQuickModal, AgendaWorkspace } from "./src/features/agenda/Agenda";
import { ClientEditForm } from "./src/features/clients/ClientsMedical";
import "./src/styles/appshell.css";
import "./src/styles/operations-responsive.css";
import "./src/styles/responsive.css";

function TestApp() {
  const [page, setPage] = useState("agenda");
  const [open, setOpen] = useState(false);
  const id = new URLSearchParams(location.search).get("qa_appointment");
  const appointments = useFetch(`/appointments?id=${id}`);
  const services = useFetch("/services");
  const options = useFetch("/options");
  const rows = (data) => Array.isArray(data) ? data : data?.items || [];
  const item = rows(appointments.data)[0];
  const client = useFetch(item?.client_id ? `/clients/${item.client_id}` : "");
  return <main className="app-main">
    <nav className="toolbar">
      <button onClick={() => setPage("agenda")}>Agenda QA</button>
      <button onClick={() => setPage("client")}>Cliente QA</button>
      <button onClick={() => setOpen(true)}>Conferir atendimento QA</button>
    </nav>
    {page === "agenda" && <AgendaWorkspace features={["basic_finance", "basic_catalog"]} />}
    {page === "client" && client.data && <ClientEditForm client={client.data} onSaved={() => setPage("agenda")} />}
    {open && item && <AppointmentQuickModal appointment={item} options={options.data || {}} services={rows(services.data)} procedures={[]} features={["basic_finance", "basic_catalog"]} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); appointments.refresh(); }} />}
  </main>;
}
createRoot(document.getElementById("root")).render(<QueryClientProvider client={createQueryClient()}><TestApp /></QueryClientProvider>);
