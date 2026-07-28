// Cache das leituras da API (TanStack Query).
//
// Antes cada tela tinha o seu próprio `useFetch` com `useState` + `useEffect`:
// sem cache, cada montagem refazia o request. Trocar de aba dentro da Agenda ou
// de Clientes desmontava os componentes e rebaixava o mesmo payload de novo.
//
// O transporte continua sendo o `apiFetch` (X-Tenant + Authorization). Aqui só
// mora a política de cache.
import { QueryClient } from "@tanstack/react-query";

// Um ERP não é um feed: o dado envelhece em minutos, não em segundos.
const STALE_TIME = 60_000; // 1 min sem refetch — cobre a troca de abas/telas
const GC_TIME = 10 * 60_000; // 10 min no cache mesmo sem ninguém montado

/**
 * @returns {QueryClient} Cliente novo — os testes criam um por caso para não
 *   vazar cache entre eles.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME,
        gcTime: GC_TIME,
        // Refetch ao focar a janela fica DESLIGADO de propósito: em tela de
        // gestão o usuário volta do WhatsApp e vê os números dançarem sem ele
        // ter feito nada — parece erro. A revalidação acontece na montagem,
        // quando o dado já passou do staleTime.
        refetchOnWindowFocus: false,
        // Voltar da rede caída é sinal legítimo de que o dado local é suspeito.
        refetchOnReconnect: true,
        // Erro de regra (400, 403, 404, 422) não melhora repetindo: só insiste
        // no que é transitório (rede fora, 5xx).
        retry: (failureCount, error) => {
          // `status` só existe nos erros criados por `fetchApiJson` (ApiError).
          // Erro de rede não tem status e cai como 0, que é justamente o caso
          // "transitório, vale repetir".
          const status = Number(/** @type {import("./api.js").ApiError} */ (error)?.status || 0);
          if (status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000)
      },
      mutations: {
        retry: false
      }
    }
  });
}

export const queryClient = createQueryClient();
