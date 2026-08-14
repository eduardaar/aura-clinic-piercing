// Cofre das credenciais de gateway por clínica.
//
// A chave da API do Asaas dá poder de movimentar dinheiro na conta da clínica.
// Guardá-la em claro no banco significaria que um dump de backup, um SELECT de
// suporte ou um log de query vazariam a conta inteira. Por isso tudo que entra
// aqui é cifrado com AES-256-GCM antes de tocar o Postgres, e as rotas só
// devolvem a máscara (`secret_hint`), nunca o segredo.
//
// GCM e não CBC: além de cifrar, ele AUTENTICA. Uma linha adulterada no banco
// falha a verificação da tag em vez de decifrar para lixo silencioso.
import crypto from "crypto";
import { AUTH_SECRET } from "../../config/index.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits: tamanho canônico de nonce do GCM.
const VERSION = "v1";

// Chaves de 32 bytes derivadas uma única vez no boot.
//
// scrypt e não um hash simples: o segredo de origem é uma senha (entropia
// humana), e o custo de memória do scrypt é o que torna força bruta cara.
const derive = (secret) => crypto.scryptSync(secret, "aura-clinic-asaas-vault", 32);

// A PRIMEIRA da lista cifra; TODAS decifram.
//
// Isso existe por causa de uma armadilha de ordem que já custou sustos: sem
// `ASAAS_VAULT_KEY`, o cofre deriva do `AUTH_SECRET`. Definir a variável DEPOIS
// que uma clínica salvou a chave dela mudaria a derivação e tornaria o cofre
// inteiro ilegível — sem aviso, e o erro só apareceria na primeira cobrança.
//
// Com a lista, introduzir `ASAAS_VAULT_KEY` a qualquer momento é seguro: o que
// já estava salvo continua sendo lido pela chave legada, e `needsRewrap()` diz a
// quem tem acesso ao banco que aquela linha deve ser regravada com a chave nova.
// A migração acontece sozinha, na primeira leitura.
export const vaultKeyConfigured = Boolean(process.env.ASAAS_VAULT_KEY);

const vaultKeys = vaultKeyConfigured
  ? [derive(process.env.ASAAS_VAULT_KEY), derive(AUTH_SECRET)]
  : [derive(AUTH_SECRET)];

// Tenta cada chave e diz QUAL funcionou. Índice 0 é a chave corrente; qualquer
// outro é legado e pede regravação.
function tryDecrypt(raw) {
  const parts = String(raw ?? "").trim().split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  for (let index = 0; index < vaultKeys.length; index += 1) {
    try {
      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        vaultKeys[index],
        Buffer.from(parts[1], "base64url")
      );
      decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
      const value = Buffer.concat([
        decipher.update(Buffer.from(parts[3], "base64url")),
        decipher.final()
      ]).toString("utf8");
      return { value, index };
    } catch {
      // Chave errada: a tag do GCM não fecha. Segue para a próxima.
    }
  }
  return null;
}

// True quando o valor só abriu com uma chave legada — ou seja, está cifrado com
// a derivação antiga e deve ser regravado com a atual.
export function needsRewrap(stored) {
  const hit = tryDecrypt(stored);
  return Boolean(hit && hit.index > 0);
}

// Cifra um segredo. Devolve "v1:<iv>:<tag>:<ciphertext>", tudo em base64url.
// O prefixo de versão é o que permitirá trocar de algoritmo no futuro sem
// precisar adivinhar o formato das linhas antigas.
export function encryptSecret(plain) {
  const value = String(plain ?? "").trim();
  if (!value) return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, vaultKeys[0], iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(":");
}

// Decifra. Devolve null (em vez de lançar) quando o valor está ausente,
// malformado ou não passa na verificação de integridade — inclusive no caso
// esperado de "a chave do cofre mudou". Quem chama trata como "sem credencial"
// e a clínica recadastra; derrubar a requisição não daria informação melhor.
export function decryptSecret(stored) {
  const hit = tryDecrypt(stored);
  return hit ? hit.value : null;
}

// Máscara exibida na interface: confirma QUAL chave está salva sem revelá-la.
// As chaves do Asaas são longas e começam com "$aact_"; os últimos 4 caracteres
// bastam para o usuário reconhecer a que colou.
export function secretHint(plain) {
  const value = String(plain ?? "").trim();
  if (!value) return null;
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}

// Comparação de segredo em tempo constante.
//
// Um `===` vaza, pelo tempo de resposta, quantos caracteres iniciais batem —
// o que permite descobrir o token de webhook byte a byte. O hash intermediário
// existe para que strings de tamanhos diferentes cheguem iguais ao
// timingSafeEqual (que lança se os buffers divergem em tamanho, e essa exceção
// seria por si só um canal lateral revelando o comprimento do segredo).
export function timingSafeEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a ?? ""), "utf8").digest();
  const right = crypto.createHash("sha256").update(String(b ?? ""), "utf8").digest();
  return crypto.timingSafeEqual(left, right);
}
