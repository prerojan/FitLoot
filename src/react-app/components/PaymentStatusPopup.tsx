type PaymentStatusPopupProps = {
  open: boolean;
  title: string;
  message: string;
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

export default function PaymentStatusPopup({ open, title, message, tone, onClose }: PaymentStatusPopupProps) {
  if (!open) return null;

  const styles = TONE_STYLES[tone];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 px-4">
      <div className={`w-full max-w-sm rounded-2xl border ${styles.border} ${styles.bg} p-5 shadow-2xl`}>
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
