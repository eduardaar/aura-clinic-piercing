-- Previsão e recebimento são datas distintas. Um pagamento pendente não tem
-- paid_at; a data passa a existir somente após sua confirmação/baixa.
-- Preserva datas e histórico dos pagamentos já registrados.
ALTER TABLE payments ALTER COLUMN paid_at DROP NOT NULL;
