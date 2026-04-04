export type PaymentStatusPopupConfig = {
  title: string;
  message: string;
  badge?: string | undefined;
  tone: "success" | "warning" | "error";
  actionLabel?: string | undefined;
  onAction?: (() => void) | undefined;
  downloadLabel?: string | undefined;
  downloadHref?: string | undefined;
  downloadFileName?: string | undefined;
  closeLabel?: string | undefined;
};

type PaymentStatusPopupProps = PaymentStatusPopupConfig & {
  open: boolean;
  onClose: () => void;
};

const TONE_STYLES: Record<PaymentStatusPopupProps["tone"], { border: string; bg: string; title: string }> = {
  success: {
    border: "border-emerald-200",
    bg: "bg-emerald-50",
    title: "text-emerald-700",
  },
  warning: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    title: "text-amber-700",
  },
  error: {
    border: "border-red-200",
    bg: "bg-red-50",
    title: "text-red-700",
  },
};

export default function PaymentStatusPopup({
  open,
  title,
  message,
  badge,
  tone,
  actionLabel,
  onAction,
  downloadLabel,
  downloadHref,
  downloadFileName,
  closeLabel,
  onClose,
}: PaymentStatusPopupProps) {
  if (!open) return null;

  // Seleciona a paleta do popup de acordo com o status retornado pelo pagamento.
  const styles = TONE_STYLES[tone];
  const shouldRenderPrimaryDownload = Boolean(downloadHref && downloadLabel);

  return (
    <div className="fl-z-toast fixed inset-0 flex items-center justify-center bg-black/35 px-4">
      {/* Modal leve para feedback de checkout sem sair do fluxo atual. */}
      <div className={`w-full max-w-sm rounded-2xl border ${styles.border} ${styles.bg} p-5 shadow-2xl`}>
        {badge ? (
          <span className="inline-flex rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-700">
            {badge}
          </span>
        ) : null}
        <h3 className={`text-lg font-bold ${styles.title}`}>{title}</h3>
        <p className="mt-2 text-sm text-gray-700">{message}</p>
        {downloadHref && downloadLabel ? (
          <a
            href={downloadHref}
            download={downloadFileName}
            className="mt-4 flex w-full items-center justify-center rounded-xl bg-[var(--app-primary-color)] px-3 py-2 text-sm font-semibold text-black shadow-sm hover:brightness-105"
          >
            {downloadLabel}
          </a>
        ) : null}
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className={`mt-4 w-full rounded-xl px-3 py-2 text-sm font-semibold shadow-sm ${
              shouldRenderPrimaryDownload
                ? "border border-[var(--fl-auth-card-border,#d1d5db)] bg-white text-gray-700 hover:bg-gray-100"
                : "bg-[var(--app-primary-color)] text-black hover:brightness-105"
            }`}
          >
            {actionLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-100"
        >
          {closeLabel ?? "Fechar"}
        </button>
      </div>
    </div>
  );
}
