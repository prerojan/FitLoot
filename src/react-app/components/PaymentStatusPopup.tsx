type PaymentStatusPopupProps = {
  open: boolean;
  title: string;
  message: string;
  badge?: string | undefined;
  tone: "success" | "warning" | "error";
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

export default function PaymentStatusPopup({ open, title, message, badge, tone, onClose }: PaymentStatusPopupProps) {
  if (!open) return null;

  // Seleciona a paleta do popup de acordo com o status retornado pelo pagamento.
  const styles = TONE_STYLES[tone];

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
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-100"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
