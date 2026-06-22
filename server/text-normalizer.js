const MOJIBAKE_REPLACEMENTS = [
  ["Ã¡", "á"],
  ["Ã¢", "â"],
  ["Ã£", "ã"],
  ["Ã¤", "ä"],
  ["Ã¥", "å"],
  ["Ã§", "ç"],
  ["Ã¨", "è"],
  ["Ã©", "é"],
  ["Ãª", "ê"],
  ["Ã«", "ë"],
  ["Ã¬", "ì"],
  ["Ã­", "í"],
  ["Ã®", "î"],
  ["Ã¯", "ï"],
  ["Ã³", "ó"],
  ["Ã´", "ô"],
  ["Ãµ", "õ"],
  ["Ã¶", "ö"],
  ["Ã¹", "ù"],
  ["Ãº", "ú"],
  ["Ã»", "û"],
  ["Ã¼", "ü"],
  ["Ã±", "ñ"],
  ["Ã€", "À"],
  ["Ã", "Á"],
  ["Ã‚", "Â"],
  ["Ãƒ", "Ã"],
  ["Ã„", "Ä"],
  ["Ã…", "Å"],
  ["Ã‡", "Ç"],
  ["Ãˆ", "È"],
  ["Ã‰", "É"],
  ["ÃŠ", "Ê"],
  ["Ã‹", "Ë"],
  ["ÃŒ", "Ì"],
  ["Ã", "Í"],
  ["ÃŽ", "Î"],
  ["Ã", "Ï"],
  ["Ã’", "Ò"],
  ["Ã“", "Ó"],
  ["Ã”", "Ô"],
  ["Ã•", "Õ"],
  ["Ã–", "Ö"],
  ["Ã™", "Ù"],
  ["Ãš", "Ú"],
  ["Ã›", "Û"],
  ["Ãœ", "Ü"],
  ["Ã‘", "Ñ"],
  ["â†’", "→"],
  ["â†", "←"],
  ["â†‘", "↑"],
  ["â†“", "↓"],
  ["â€“", "–"],
  ["â€”", "—"],
  ["â€œ", "“"],
  ["â€", "”"],
  ["â€˜", "‘"],
  ["â€™", "’"],
  ["Â·", "·"],
  ["Â°", "°"],
  ["Âº", "º"],
  ["Âª", "ª"],
  ["Â ", " "]
];

const QUESTION_MARK_REPLACEMENTS = [
  ["tit?nio", "titânio"],
  ["tit�nio", "titânio"],
  ["Tit�nio", "Titânio"],
  ["Titanio", "Titânio"],
  ["titanio", "titânio"],
  ["zirc?nia", "zircônia"],
  ["a?o", "aço"],
  ["Sem informa??o", "Sem informação"],
  ["Zirconia", "Zircônia"],
  ["zirconia", "zircônia"],
  ["cl?nica", "clínica"],
  ["cl?nicas", "clínicas"],
  ["f?sico", "físico"],
  ["hist?rico", "histórico"],
  ["sa?de", "saúde"],
  ["autoriza??o", "autorização"],
  ["Endere?o", "Endereço"],
  ["agendamento(s)", "agendamento(s)"],
  ["Anivers?rio", "Aniversário"],
  ["Perfura??es", "Perfurações"],
  ["Perfura??o", "Perfuração"],
  ["Regi?o", "Região"],
  ["Respons?vel", "Responsável"],
  ["Informa??es", "Informações"],
  ["Observa??o", "Observação"],
  ["observa??es", "observações"],
  ["orienta??es", "orientações"],
  ["intercorr?ncias", "intercorrências"],
  ["cicatriza??o", "cicatrização"],
  ["higieniza??o", "higienização"],
  ["ap?s", "após"],
  ["poss?vel", "possível"],
  ["necess?rio", "necessário"],
  ["obrigat?ria", "obrigatória"],
  ["obrigat?rios", "obrigatórios"],
  ["prontu?rio", "prontuário"],
  ["sa?da", "saída"],
  ["Declara??o", "Declaração"],
  ["Aplica??o", "Aplicação"],
  ["Dispon?veis", "Disponíveis"],
  ["cl?nico", "clínico"],
  ["cl?nica", "clínica"],
  ["N?o", "Não"],
  ["s?o", "são"],
  ["Ãšltimas", "Últimas"],
  ["Ãšltimo", "Último"],
  ["Ã©", "é"]
];

function normalizeCommonText(text) {
  if (typeof text !== "string") return text;

  let normalized = text;

  for (const [from, to] of MOJIBAKE_REPLACEMENTS) {
    normalized = normalized.split(from).join(to);
  }

  if (/[ÃÂâ]/.test(normalized)) {
    try {
      const roundTrip = Buffer.from(normalized, "latin1").toString("utf8");
      if (roundTrip && roundTrip !== normalized) {
        const beforeScore = mojibakeScore(normalized);
        const afterScore = mojibakeScore(roundTrip);
        if (afterScore <= beforeScore) normalized = roundTrip;
      }
    } catch {
      // Mantém o texto original se a conversão não for segura.
    }
  }

  for (const [from, to] of QUESTION_MARK_REPLACEMENTS) {
    normalized = normalized.split(from).join(to);
  }

  return normalized;
}

function normalizeDbValue(value) {
  if (Array.isArray(value)) return value.map(normalizeDbValue);
  if (value && typeof value === "object" && Object.prototype.toString.call(value) === "[object Object]") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeDbValue(entry)]));
  }
  return normalizeCommonText(value);
}

function mojibakeScore(value) {
  if (typeof value !== "string") return 0;
  const matches = value.match(/[ÃÂâ�]/g);
  return matches ? matches.length : 0;
}

export { normalizeCommonText, normalizeDbValue };
