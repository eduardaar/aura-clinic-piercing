// Famílias oferecidas pelo editor: fontes locais e substitutas explícitas.
// Uma família ausente nunca deve fazer o texto da loja cair na fonte serifada
// padrão do navegador.
export function catalogFontStack(value, role = "body") {
  const families = {
    "Inter": '"Inter", "Plus Jakarta Sans", Arial, sans-serif',
    "Plus Jakarta Sans": '"Plus Jakarta Sans", Arial, sans-serif',
    "Cormorant Garamond": '"Cormorant Garamond", Georgia, serif',
    "Playfair Display": '"Playfair Display", Georgia, serif',
    "Arial": 'Arial, Helvetica, sans-serif',
    "Verdana": 'Verdana, Arial, sans-serif',
    "Georgia": 'Georgia, "Times New Roman", serif'
  };
  return families[String(value || "").trim()] || (role === "title" ? families["Cormorant Garamond"] : families["Plus Jakarta Sans"]);
}
