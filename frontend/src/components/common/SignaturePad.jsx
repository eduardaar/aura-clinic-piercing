import React, { useEffect } from "react";
import { Button } from "./Ui";

// Assinatura desenhada no canvas (mouse, caneta ou dedo). Devolve um data URL
// PNG a cada traço e "" ao limpar. `clearKey` reinicia o quadro quando o
// contexto muda (outro agendamento, outro termo).
export function SignaturePad({ onChange, clearKey, label = "Assinatura digital" }) {
  const canvasRef = React.useRef(null);
  const drawingRef = React.useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fffdfb";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#171412";
    context.lineWidth = 2;
    context.lineCap = "round";
    onChange("");
  }, [clearKey]);

  function point(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches?.[0];
    return {
      x: ((touch?.clientX ?? event.clientX) - rect.left) * (canvas.width / rect.width),
      y: ((touch?.clientY ?? event.clientY) - rect.top) * (canvas.height / rect.height)
    };
  }

  function start(event) {
    event.preventDefault();
    drawingRef.current = true;
    const context = canvasRef.current.getContext("2d");
    const p = point(event);
    context.beginPath();
    context.moveTo(p.x, p.y);
  }

  function move(event) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = canvasRef.current.getContext("2d");
    const p = point(event);
    context.lineTo(p.x, p.y);
    context.stroke();
    onChange(canvasRef.current.toDataURL("image/png"));
  }

  function stop() {
    drawingRef.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fffdfb";
    context.fillRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return (
    <div className="signature-box">
      <div className="signature-heading">
        <span>{label}</span>
        <Button type="button" variant="secondary" onClick={clear}>Limpar</Button>
      </div>
      {/* touch-action: none — sem isso o navegador rola a página em vez de desenhar. */}
      <canvas ref={canvasRef} width="720" height="220" style={{ touchAction: "none" }} onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop} onTouchStart={start} onTouchMove={move} onTouchEnd={stop} />
    </div>
  );
}
