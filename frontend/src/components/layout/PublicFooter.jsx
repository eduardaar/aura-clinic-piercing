import { useEffect, useState } from "react";
import { Instagram, Mail, MessageCircle } from "lucide-react";
import { API } from "../../lib/api";
import { asArray } from "../../lib/utils";
import { BrandMark } from "../common/BrandMark";

const FALLBACK = {
  footer_text: "Plataforma de gestão para estúdios de piercing.",
  contact_whatsapp: "+55 77 9863-2417",
  contact_email: "",
  contact_instagram: "https://www.instagram.com/eduarda.bodypiercer/"
};

const whatsappUrl = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
};

export function PublicFooter({ content }) {
  const [remote, setRemote] = useState(null);
  useEffect(() => {
    if (content) return undefined;
    let active = true;
    fetch(`${API}/landing`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        const closing = asArray(payload.sections).find((section) => section.section_key === "closing");
        if (active && closing?.content) setRemote(closing.content);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [content]);
  const data = { ...FALLBACK, ...(content || remote || {}) };
  const whatsapp = whatsappUrl(data.contact_whatsapp);
  return <footer className="au-public-footer">
    <div className="au-public-footer-inner">
      <div className="au-public-footer-brand"><div><BrandMark size={32} /><strong>Aura</strong></div><span>{data.footer_text}</span></div>
      <div className="au-public-footer-group au-public-footer-contact" aria-label="Canais de contato"><span>Contato</span>
        {whatsapp && <a href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden="true" /> WhatsApp</a>}
        {data.contact_email && <a href={`mailto:${data.contact_email}`}><Mail size={18} aria-hidden="true" /> E-mail</a>}
        {data.contact_instagram && <a href={data.contact_instagram} target="_blank" rel="noreferrer"><Instagram size={18} aria-hidden="true" /> Instagram</a>}
      </div>
      <div className="au-public-footer-group au-public-footer-links"><span>Legal</span><a href="/termos-de-uso">Termos de uso</a><a href="/politica-de-privacidade">Privacidade</a></div>
    </div>
  </footer>;
}
