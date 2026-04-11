import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent } from "react";
import { X } from "lucide-react";

import LoadingBall from "@/react-app/components/LoadingBall";
import type { NormalizedCameraImage } from "@/react-app/services/native/cameraService";
import {
  AVATAR_CROP_MAX_ZOOM,
  AVATAR_CROP_MIN_ZOOM,
  AVATAR_CROP_VIEWPORT_PX,
  clampAvatarCrop,
  createDefaultAvatarCrop,
  getAvatarCropDisplayRect,
  loadAvatarSourceDimensions,
  type AvatarCrop,
  type AvatarSourceDimensions,
} from "@/react-app/services/avatarService";

type AvatarStatus = {
  type: "success" | "error";
  message: string;
};

type AvatarCropDialogProps = {
  image: NormalizedCameraImage | null;
  open: boolean;
  submitting: boolean;
  status: AvatarStatus | null;
  onCancel: () => void;
  onConfirm: (crop: AvatarCrop) => void | Promise<void>;
};

type DragState = {
  pointerId: number;
  originX: number;
  originY: number;
  startX: number;
  startY: number;
};

export function AvatarCropDialog({
  image,
  open,
  submitting,
  status,
  onCancel,
  onConfirm,
}: AvatarCropDialogProps) {
  const [dimensions, setDimensions] = useState<AvatarSourceDimensions | null>(null);
  const [crop, setCrop] = useState<AvatarCrop>(createDefaultAvatarCrop);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!open || !image) {
      setDimensions(null);
      setCrop(createDefaultAvatarCrop());
      setLoadError(null);
      setLoading(false);
      setDragging(false);
      dragStateRef.current = null;
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setCrop(createDefaultAvatarCrop());

    void loadAvatarSourceDimensions(image)
      .then((nextDimensions) => {
        if (cancelled) return;
        setDimensions(nextDimensions);
        setCrop(
          clampAvatarCrop(
            nextDimensions,
            createDefaultAvatarCrop(),
            AVATAR_CROP_VIEWPORT_PX,
          ),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setDimensions(null);
        setLoadError("Nao foi possivel ajustar esta foto agora.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      setDragging(false);
      dragStateRef.current = null;
    };
  }, [image, open]);

  useEffect(() => {
    if (!open || submitting) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCancel, open, submitting]);

  const displayRect = useMemo(() => {
    if (!dimensions) return null;
    return getAvatarCropDisplayRect(dimensions, crop, AVATAR_CROP_VIEWPORT_PX);
  }, [crop, dimensions]);

  if (!open || !image) return null;

  const updateCrop = (updater: (current: AvatarCrop) => AvatarCrop) => {
    if (!dimensions) return;
    setCrop((current) =>
      clampAvatarCrop(dimensions, updater(current), AVATAR_CROP_VIEWPORT_PX),
    );
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!dimensions || submitting || loading || loadError) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      originX: crop.offsetX,
      originY: crop.offsetY,
      startX: event.clientX,
      startY: event.clientY,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || !dimensions) return;

    updateCrop((current) => ({
      ...current,
      offsetX: dragState.originX + (event.clientX - dragState.startX),
      offsetY: dragState.originY + (event.clientY - dragState.startY),
    }));
  };

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleZoomChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextZoom = Number(event.target.value);
    updateCrop((current) => ({
      ...current,
      zoom: Number.isFinite(nextZoom) ? nextZoom : current.zoom,
    }));
  };

  const canConfirm = Boolean(dimensions && displayRect && !loading && !loadError && !submitting);

  return (
    <div className="fl-z-modal fixed inset-0 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-fadeIn">
      <div className="fl-theme-surface w-full max-w-xl overflow-hidden rounded-[2.5rem] shadow-2xl animate-scaleIn">
        <header
          className="flex items-center justify-between border-b px-6 py-5 sm:px-8"
          style={{ borderColor: "var(--fl-border-soft)" }}
        >
          <h2
            className="text-sm font-black uppercase tracking-[0.24em]"
            style={{ color: "var(--fl-color-text)" }}
          >
            Ajustar Foto
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="fl-theme-surface-soft flex size-10 items-center justify-center rounded-xl fl-theme-text-muted transition-opacity hover:opacity-80 disabled:opacity-50"
            aria-label="Fechar ajuste do avatar"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="space-y-5 p-6 sm:p-8">
          <div className="flex justify-center">
            <div
              className="relative overflow-hidden rounded-[2rem] bg-black/80 touch-none select-none"
              style={{
                width: `${AVATAR_CROP_VIEWPORT_PX}px`,
                height: `${AVATAR_CROP_VIEWPORT_PX}px`,
                cursor: dragging ? "grabbing" : "grab",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDragging}
              onPointerCancel={stopDragging}
            >
              {displayRect ? (
                <img
                  src={image.previewUrl}
                  alt="Preview do avatar"
                  draggable={false}
                  className="pointer-events-none absolute max-w-none select-none"
                  style={{
                    width: `${displayRect.width}px`,
                    height: `${displayRect.height}px`,
                    left: `${displayRect.left}px`,
                    top: `${displayRect.top}px`,
                    transform: "translateZ(0)",
                  }}
                />
              ) : null}

              {loading ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <LoadingBall size="sm" />
                </div>
              ) : null}

              <div
                className="pointer-events-none absolute inset-0 rounded-[2rem]"
                style={{
                  boxShadow: "inset 0 0 0 1px color-mix(in srgb, white 14%, transparent)",
                }}
              />
              <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/90 shadow-[0_0_0_999px_rgba(4,8,15,0.58)]" />
            </div>
          </div>

          <div className="space-y-3">
            <input
              type="range"
              min={AVATAR_CROP_MIN_ZOOM}
              max={AVATAR_CROP_MAX_ZOOM}
              step="0.01"
              value={crop.zoom}
              onChange={handleZoomChange}
              disabled={!dimensions || submitting || loading || Boolean(loadError)}
              aria-label="Zoom do avatar"
              className="w-full accent-[var(--app-primary-color)] disabled:opacity-50"
            />

            {loadError ? (
              <p
                className="text-center text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{ color: "#f87171" }}
              >
                {loadError}
              </p>
            ) : null}

            {status ? (
              <p
                className="text-center text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{ color: status.type === "success" ? "var(--app-primary-color)" : "#f87171" }}
              >
                {status.message}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="fl-theme-surface-soft rounded-2xl py-3 text-[10px] font-black uppercase tracking-[0.18em] fl-theme-text-muted transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                void onConfirm(crop);
              }}
              disabled={!canConfirm}
              className="rounded-2xl py-3 text-[10px] font-black uppercase tracking-[0.18em] transition-opacity hover:opacity-85 disabled:opacity-50"
              style={{
                backgroundColor: "var(--app-primary-color)",
                color: "var(--fl-nav-item-active-text)",
              }}
            >
              {submitting ? "Salvando..." : "Usar Foto"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AvatarCropDialog;
