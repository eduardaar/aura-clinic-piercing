INSERT INTO communication_templates (template_key, name, channel, subject, body) VALUES
  ('booking_confirmed', 'Agendamento confirmado', 'whatsapp', 'Seu agendamento foi confirmado', 'Olá, {{cliente}}. Seu agendamento no {{estudio}} está confirmado para {{data}} às {{horario}} com {{profissional}}.'),
  ('booking_rescheduled', 'Reagendamento', 'whatsapp', 'Seu agendamento foi reagendado', 'Olá, {{cliente}}. Seu atendimento foi reagendado para {{data}} às {{horario}}.'),
  ('booking_cancelled', 'Cancelamento', 'whatsapp', 'Seu agendamento foi cancelado', 'Olá, {{cliente}}. Seu agendamento de {{data}} às {{horario}} foi cancelado.'),
  ('postcare', 'Pós-atendimento', 'whatsapp', 'Como está sua recuperação?', 'Olá, {{cliente}}. Como está sua evolução após o atendimento? Se precisar, fale com o {{estudio}}.'),
  ('payment_pending', 'Pagamento pendente', 'whatsapp', 'Pagamento pendente do seu agendamento', 'Olá, {{cliente}}. O sinal de {{sinal}} do protocolo {{protocolo}} ainda está pendente.')
ON CONFLICT (template_key) DO UPDATE
SET subject = COALESCE(communication_templates.subject, EXCLUDED.subject);

INSERT INTO automation_rules (rule_key, name, event_type, template_key, offset_minutes, is_active) VALUES
  ('booking_confirmed', 'Agendamento confirmado', 'appointment_confirmed', 'booking_confirmed', 0, 1),
  ('booking_rescheduled', 'Agendamento reagendado', 'appointment_rescheduled', 'booking_rescheduled', 0, 1),
  ('booking_cancelled', 'Agendamento cancelado', 'appointment_cancelled', 'booking_cancelled', 0, 1)
ON CONFLICT (rule_key) DO NOTHING;
