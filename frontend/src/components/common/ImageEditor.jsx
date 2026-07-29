import { useEffect, useMemo, useRef, useState } from "react";
import { FlipHorizontal2, Minus, Plus, RotateCcw, RotateCw, Scan, Undo2, X } from "lucide-react";

export const DEFAULT_IMAGE_TRANSFORM = {
  fitMode: "contain",
  focalPointX: 50,
  focalPointY: 50,
  zoom: 1,
  rotation: 0,
  flipHorizontal: false,
  cropX: null,
  cropY: null,
  cropWidth: null,
  cropHeight: null,
  aspectRatio: null
};

export function normalizeImageTransform(value = {}, aspectRatio = null) {
  /** @type {Record<string, any>} */
  const source = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_IMAGE_TRANSFORM,
    ...source,
    fitMode: ["contain", "cover", "custom"].includes(source.fitMode) ? source.fitMode : "contain",
    focalPointX: clamp(source.focalPointX, 0, 100, 50),
    focalPointY: clamp(source.focalPointY, 0, 100, 50),
    zoom: clamp(source.zoom, 0.5, 3, 1),
    rotation: Number(source.rotation || 0) % 360,
    flipHorizontal: Boolean(source.flipHorizontal),
    aspectRatio: source.aspectRatio || aspectRatio
  };
}

export function imageTransformStyle(transform = {}) {
  const value = normalizeImageTransform(transform);
  return {
    objectFit: value.fitMode === "custom" ? "cover" : value.fitMode,
    objectPosition: `${value.focalPointX}% ${value.focalPointY}%`,
    transform: `scale(${value.zoom}) rotate(${value.rotation}deg) scaleX(${value.flipHorizontal ? -1 : 1})`
  };
}

export function ImageEditor({ file, src, initialTransform, aspectRatio = "16/5", contextLabel = "imagem", onCancel, onConfirm }) {
  const [transform, setTransform] = useState(() => normalizeImageTransform(initialTransform, aspectRatio));
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef(null);
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : src, [file, src]);

  useEffect(() => () => {
    if (file && previewUrl) URL.revokeObjectURL(previewUrl);
  }, [file, previewUrl]);

  function patch(values) {
    setTransform((current) => normalizeImageTransform({ ...current, ...values }, aspectRatio));
  }

  function setFocalPoint(event) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    patch({
      focalPointX: ((event.clientX - rect.left) / rect.width) * 100,
      focalPointY: ((event.clientY - rect.top) / rect.height) * 100
    });
  }

  return (
    <div className="image-editor-backdrop" role="presentation">
      <section className="image-editor-modal" role="dialog" aria-modal="true" aria-labelledby="image-editor-title">
        <header>
          <div><span>Editor visual</span><h2 id="image-editor-title">Ajustar {contextLabel}</h2></div>
          <button type="button" aria-label="Fechar editor" onClick={onCancel}><X /></button>
        </header>
        <div className="image-editor-layout">
          <div>
            <div
              ref={stageRef}
              className="image-editor-stage"
              style={{ aspectRatio }}
              onPointerDown={(event) => { setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); setFocalPoint(event); }}
              onPointerMove={(event) => dragging && setFocalPoint(event)}
              onPointerUp={() => setDragging(false)}
              onPointerCancel={() => setDragging(false)}
            >
              <img src={previewUrl} alt={`Prévia de ${contextLabel}`} style={imageTransformStyle(transform)} draggable="false" />
              <span className="image-editor-safe-area">Área segura</span>
              <i style={{ left: `${transform.focalPointX}%`, top: `${transform.focalPointY}%` }} aria-hidden="true" />
            </div>
            <p className="image-editor-help">Arraste sobre a imagem para definir o ponto focal. A original será preservada.</p>
          </div>
          <div className="image-editor-controls">
            <label>Modo de exibição
              <select value={transform.fitMode} onChange={(event) => patch({ fitMode: event.target.value, zoom: 1 })}>
                <option value="contain">Mostrar imagem inteira</option>
                <option value="cover">Preencher toda a área</option>
                <option value="custom">Recorte personalizado</option>
              </select>
            </label>
            <label>Zoom <strong>{Math.round(transform.zoom * 100)}%</strong>
              <input type="range" min=".5" max="3" step=".05" value={transform.zoom} onChange={(event) => patch({ zoom: Number(event.target.value), fitMode: "custom" })} />
            </label>
            <div className="image-editor-button-grid">
              <button type="button" onClick={() => patch({ zoom: transform.zoom - .1, fitMode: "custom" })}><Minus /> Reduzir</button>
              <button type="button" onClick={() => patch({ zoom: transform.zoom + .1, fitMode: "custom" })}><Plus /> Aumentar</button>
              <button type="button" onClick={() => patch({ focalPointX: 50, focalPointY: 50 })}><Scan /> Centralizar</button>
              <button type="button" onClick={() => patch({ fitMode: "contain", zoom: 1 })}>Ajustar à área</button>
              <button type="button" onClick={() => patch({ fitMode: "cover", zoom: 1 })}>Preencher área</button>
              <button type="button" onClick={() => patch({ rotation: transform.rotation - 90 })}><RotateCcw /> Girar esquerda</button>
              <button type="button" onClick={() => patch({ rotation: transform.rotation + 90 })}><RotateCw /> Girar direita</button>
              <button type="button" onClick={() => patch({ flipHorizontal: !transform.flipHorizontal })}><FlipHorizontal2 /> Espelhar</button>
              <button type="button" onClick={() => setTransform(normalizeImageTransform({}, aspectRatio))}><Undo2 /> Restaurar original</button>
            </div>
            <div className="image-editor-coordinates">
              <label>Foco X<input type="number" min="0" max="100" value={Math.round(transform.focalPointX)} onChange={(event) => patch({ focalPointX: Number(event.target.value) })} /></label>
              <label>Foco Y<input type="number" min="0" max="100" value={Math.round(transform.focalPointY)} onChange={(event) => patch({ focalPointY: Number(event.target.value) })} /></label>
            </div>
          </div>
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onCancel}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => onConfirm(normalizeImageTransform(transform, aspectRatio))}>Confirmar edição</button>
        </footer>
      </section>
    </div>
  );
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
