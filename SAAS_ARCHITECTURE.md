# Aura Clinic ERP - Arquitetura SaaS

## Objetivo

Transformar o MVP atual em uma plataforma SaaS premium para body piercers, clínicas, joalherias corporais, consultorias e cursos online.

## Stack alvo

- Frontend: React, Vite, TypeScript, TailwindCSS e Framer Motion
- Backend: Node.js, Express e TypeScript
- Banco: PostgreSQL
- Uploads: Cloudinary
- Autenticação: JWT com controle de permissões
- Modelo SaaS: multiempresa com isolamento por `tenant_id`

## Modelo multiempresa

Toda tabela operacional deve possuir `tenant_id`:

- users
- clients
- appointments
- jewelry_inventory
- payments
- professionals
- medical_records
- digital_terms
- post_care_followups
- coupons
- influencers
- courses
- content_planner
- referrals

No backend, toda consulta deve filtrar pelo `tenant_id` vindo do JWT. Administradores globais podem acessar métricas agregadas, mas usuários de estúdio só acessam seus próprios dados.

## Módulos do ERP

1. Dashboard executivo
2. Agendamentos e agenda visual
3. Clientes e CRM
4. Prontuário individual
5. Termo digital
6. Estoque de joalherias
7. Catálogo online público
8. Financeiro
9. CRM e automações
10. Aura Rewards
11. Indicações
12. Cupons
13. Influenciadores
14. Consultorias
15. Aura Academy
16. Conteúdo e calendário editorial
17. Mapa corporal
18. Administrativo e permissões
19. Relatórios
20. Configurações

## Roadmap de migração

1. Converter frontend para TypeScript.
2. Converter backend para TypeScript.
3. Migrar SQLite para PostgreSQL.
4. Criar tabela `tenants` e adicionar `tenant_id` nas tabelas.
5. Substituir sessão local por JWT.
6. Criar middleware de permissões por perfil.
7. Migrar uploads locais para Cloudinary.
8. Separar catálogo público por slug/domínio do estúdio.
9. Criar módulos comerciais: cupons, influenciadores, indicações e checkout.
10. Criar área de cursos e consultorias.

## Observação

O projeto atual já possui um MVP funcional com agenda, estoque, financeiro, clientes, prontuários, termos digitais, pós-atendimento, fidelidade e permissões. A página "Aura ERP" adicionada ao sistema funciona como central modular para guiar a evolução SaaS.
