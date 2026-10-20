import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function ConnectionStatus() {
  const [offline, setOffline] = useState(() => navigator.onLine === false);
  const client = useQueryClient();
  useEffect(() => {
    const disconnected = () => setOffline(true);
    const connected = () => {
      setOffline(false);
      void client.invalidateQueries();
    };
    window.addEventListener("offline", disconnected);
    window.addEventListener("online", connected);
    return () => {
      window.removeEventListener("offline", disconnected);
      window.removeEventListener("online", connected);
    };
  }, [client]);
  return offline ? (
    <div className="connection-status" role="status">
      Sem conexão. Seus dados preenchidos permanecem nesta tela. Tentaremos reconectar quando a internet voltar.
    </div>
  ) : null;
}
