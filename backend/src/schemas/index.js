// Schemas de validação (Zod) dos principais endpoints de escrita.
//
// Princípios:
// - PERMISSIVO: valida só presença/tipo dos campos OBRIGATÓRIOS de cada rota.
// - .passthrough() em todos os schemas: campos extras enviados pelo frontend
//   são preservados intactos (não rejeitamos payloads reais).
// - Endpoints que recebem multipart/form-data (upload) chegam com números como
//   string; por isso usamos helpers tolerantes (idLike / stringLike) que aceitam
//   string ou número para os campos obrigatórios.
import { z } from "zod";

// String não-vazia (após trim). Aceita number e converte para string.
// A mensagem única (`${label} é obrigatório.`) cobre ausência, tipo errado e vazio.
const nonEmptyString = (label) =>
  z
    .preprocess(
      (v) => (typeof v === "number" ? String(v) : v),
      z.string({ error: `${label} é obrigatório.` })
    )
    .refine((v) => v.trim().length > 0, { message: `${label} é obrigatório.` });

// Identificador obrigatório: aceita número ou string numérica não-vazia.
const requiredId = (label) =>
  z
    .preprocess((v) => (typeof v === "number" ? String(v) : v), z.string({ error: `${label} é obrigatório.` }))
    .refine((v) => v.trim().length > 0, { message: `${label} é obrigatório.` });

// ---------- Auth ----------
export const loginSchema = z
  .object({
    email: nonEmptyString("E-mail"),
    password: nonEmptyString("Senha")
  })
  .passthrough();

// ---------- Usuários ----------
const USER_ROLES = ["admin", "piercer", "reception", "finance"];

export const userCreateSchema = z
  .object({
    name: nonEmptyString("Nome"),
    email: nonEmptyString("E-mail"),
    password: z
      .string({ error: "Senha é obrigatória." })
      .min(8, { message: "A senha deve ter no mínimo 8 caracteres." }),
    role: z.enum(USER_ROLES, { message: "Nível de acesso inválido." })
  })
  .passthrough();

export const userUpdateSchema = z
  .object({
    // Todos opcionais no PATCH; quando presentes, validamos o tipo/tamanho.
    name: z.string().min(1, { message: "Nome não pode ser vazio." }).optional(),
    email: z.string().min(1, { message: "E-mail não pode ser vazio." }).optional(),
    password: z.string().min(8, { message: "A senha deve ter no mínimo 8 caracteres." }).optional(),
    role: z.enum(USER_ROLES, { message: "Nível de acesso inválido." }).optional()
  })
  .passthrough();

// ---------- Clientes ----------
export const clientCreateSchema = z
  .object({
    full_name: nonEmptyString("Nome do cliente"),
    whatsapp: nonEmptyString("WhatsApp")
  })
  .passthrough();

// No PUT o handler faz fallback para os valores atuais quando o campo vem vazio,
// então mantemos os obrigatórios opcionais aqui (apenas checagem de tipo).
export const clientUpdateSchema = z
  .object({
    full_name: z.string().optional(),
    whatsapp: z.string().optional()
  })
  .passthrough();

// ---------- Agendamentos (multipart/form-data) ----------
export const appointmentCreateSchema = z
  .object({
    professional_id: requiredId("Profissional"),
    appointment_date: nonEmptyString("Data do agendamento"),
    appointment_time: nonEmptyString("Horário do agendamento")
  })
  .passthrough();

// ---------- Serviços ----------
export const serviceCreateSchema = z
  .object({
    name: nonEmptyString("Nome do serviço")
  })
  .passthrough();

// No PATCH o handler faz fallback para os valores atuais; validamos só o tipo.
export const serviceUpdateSchema = z
  .object({
    name: z.string().optional()
  })
  .passthrough();

// ---------- Procedimentos ----------
export const procedureCreateSchema = z
  .object({
    name: nonEmptyString("Nome do procedimento"),
    service_id: requiredId("Serviço vinculado")
  })
  .passthrough();

export const procedureUpdateSchema = z
  .object({
    name: z.string().optional(),
    service_id: z.union([z.string(), z.number()]).optional()
  })
  .passthrough();

// ---------- Joalherias ----------
const JEWELRY_CATEGORIES = [
  "Labret",
  "Argolas",
  "Barbell Reto",
  "Barbell Curvo",
  "Nostril",
  "Topos",
  "Microdermal",
  "Surface",
  "Ouro 14k",
  "Ouro 18k"
];

export const jewelryCreateSchema = z
  .object({
    name: nonEmptyString("Nome do produto"),
    category: z.enum(JEWELRY_CATEGORIES, { message: "Selecione uma categoria principal válida." })
  })
  .passthrough();

// No PATCH tudo é opcional (atualização parcial por campos presentes).
export const jewelryUpdateSchema = z
  .object({
    name: z.string().optional(),
    category: z.enum(JEWELRY_CATEGORIES, { message: "Selecione uma categoria principal válida." }).optional()
  })
  .passthrough();
