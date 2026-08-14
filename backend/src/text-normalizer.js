const MOJIBAKE_REPLACEMENTS = [
  ["á", "á"],
  ["â", "â"],
  ["ã", "ã"],
  ["ä", "ä"],
  ["å", "å"],
  ["ç", "ç"],
  ["è", "è"],
  ["é", "é"],
  ["ê", "ê"],
  ["ë", "ë"],
  ["ì", "ì"],
  ["í", "í"],
  ["î", "î"],
  ["ï", "ï"],
  ["ó", "ó"],
  ["ô", "ô"],
  ["õ", "õ"],
  ["ö", "ö"],
  ["ù", "ù"],
  ["ú", "ú"],
  ["û", "û"],
  ["ü", "ü"],
  ["ñ", "ñ"],
  ["À", "À"],
  ["Á", "Á"],
  ["Â", "Â"],
  ["Ã", "Ã"],
  ["Ä", "Ä"],
  ["Å", "Å"],
  ["Ç", "Ç"],
  ["È", "È"],
  ["É", "É"],
  ["Ê", "Ê"],
  ["Ë", "Ë"],
  ["Ì", "Ì"],
  ["Í", "Í"],
  ["Î", "Î"],
  ["Ï", "Ï"],
  ["Ò", "Ò"],
  ["Ó", "Ó"],
  ["Ô", "Ô"],
  ["Õ", "Õ"],
  ["Ö", "Ö"],
  ["Ù", "Ù"],
  ["Ú", "Ú"],
  ["Û", "Û"],
  ["Ü", "Ü"],
  ["Ñ", "Ñ"],
  ["→", "→"],
  ["←", "←"],
  ["↑", "↑"],
  ["↓", "↓"],
  ["–", "–"],
  ["—", "—"],
  ["“", "“"],
  ["”", "”"],
  ["‘", "‘"],
  ["’", "’"],
  ["·", "·"],
  ["°", "°"],
  ["º", "º"],
  ["ª", "ª"],
  ["Â ", " "]
];

const QUESTION_MARK_REPLACEMENTS = [
  ["titânio", "titânio"],
  ["titânio", "titânio"],
  ["Titânio", "Titânio"],
  ["Titânio", "Titânio"],
  ["titânio", "titânio"],
  ["zircônia", "zircônia"],
  ["aço", "aço"],
  ["Sem informação", "Sem informação"],
  ["Zirconia", "Zircônia"],
  ["zirconia", "zircônia"],
  ["clínica", "clínica"],
  ["clínicas", "clínicas"],
  ["físico", "físico"],
  ["histórico", "histórico"],
  ["saúde", "saúde"],
  ["autorização", "autorização"],
  ["Endereço", "Endereço"],
  ["agendamento(s)", "agendamento(s)"],
  ["Aniversário", "Aniversário"],
  ["Perfurações", "Perfurações"],
  ["Perfuração", "Perfuração"],
  ["Região", "Região"],
  ["Responsável", "Responsável"],
  ["Informações", "Informações"],
  ["Observação", "Observação"],
  ["observações", "observações"],
  ["orientações", "orientações"],
  ["intercorrências", "intercorrências"],
  ["cicatrização", "cicatrização"],
  ["higienização", "higienização"],
  ["após", "após"],
  ["possível", "possível"],
  ["necessário", "necessário"],
  ["obrigatória", "obrigatória"],
  ["obrigatórios", "obrigatórios"],
  ["prontuário", "prontuário"],
  ["saída", "saída"],
  ["Declaração", "Declaração"],
  ["Aplicação", "Aplicação"],
  ["Disponíveis", "Disponíveis"],
  ["clínico", "clínico"],
  ["clínica", "clínica"],
  ["Não", "Não"],
  ["são", "são"],
  ["Últimas", "Últimas"],
  ["Último", "Último"],
  ["é", "é"]
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
  const matches = value.match(/[ÃÂâ]/g);
  return matches ? matches.length : 0;
}

export { normalizeCommonText, normalizeDbValue };
