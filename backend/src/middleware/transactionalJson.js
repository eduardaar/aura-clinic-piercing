// Só confirma a operação ao cliente depois do COMMIT. Uma falha na gravação
// deve chegar ao handler de erro sem já ter enviado uma resposta de sucesso.
export async function transactionalJson(db, res, handler) {
  let statusCode = res.statusCode || 200;
  let payload;
  const pendingResponse = {
    status(code) {
      statusCode = code;
      return pendingResponse;
    },
    json(body) {
      payload = body;
      return pendingResponse;
    },
  };
  await db.transaction((tx) => handler(tx, pendingResponse));
  return res.status(statusCode).json(payload);
}
