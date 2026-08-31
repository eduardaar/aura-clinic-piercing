import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { readStoredSession, tenantSlug } from "../../lib/api";
import { Button } from "./Ui";

function preferenceKey(screenId) {
  const userId = readStoredSession()?.user?.id || "user";
  return `aura:ui:indicators:${tenantSlug() || "tenant"}:${userId}:${screenId}`;
}

function readVisibility(key, defaultOpen) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? defaultOpen : stored !== "hidden";
  } catch {
    return defaultOpen;
  }
}

export function CollapsibleIndicators({ screenId, children, defaultOpen = true }) {
  const key = preferenceKey(screenId);
  const [visible, setVisible] = useState(() => readVisibility(key, defaultOpen));

  useEffect(() => setVisible(readVisibility(key, defaultOpen)), [defaultOpen, key]);

  function toggle() {
    setVisible((current) => {
      const next = !current;
      try { localStorage.setItem(key, next ? "visible" : "hidden"); } catch { /* preferência apenas local */ }
      return next;
    });
  }

  return <div className="collapsible-indicators">
    <div className="indicator-visibility-row">
      <Button variant="ghost" onClick={toggle}>
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        {visible ? "Ocultar indicadores" : "Mostrar indicadores"}
      </Button>
    </div>
    {visible && <div className="collapsible-indicators__content">{children}</div>}
  </div>;
}
