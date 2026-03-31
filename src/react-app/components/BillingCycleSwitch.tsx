import type { BillingCycle } from "@/react-app/constants/checkout";

type BillingCycleSwitchProps = {
  value: BillingCycle;
  onChange: (value: BillingCycle) => void;
};

export default function BillingCycleSwitch({ value, onChange }: BillingCycleSwitchProps) {
  return (
    <div className="mx-auto inline-flex rounded-full border border-[var(--fl-auth-card-border)] bg-[var(--fl-auth-surface)] p-1 shadow-[0_18px_48px_-28px_rgba(16,185,129,0.55)]">
      {/* Alterna o ciclo de cobranca sem misturar a logica do checkout. */}
      {([
        { id: "monthly", label: "Mensal" },
        { id: "annual", label: "Anual" },
      ] as const).map((option) => {
        const active = value === option.id;

        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`min-w-[9rem] rounded-full px-5 py-3 text-sm font-semibold transition ${
              active
                ? "bg-[var(--app-primary-color)] text-black shadow-[0_12px_32px_-20px_rgba(16,185,129,0.9)]"
                : "text-[var(--fl-auth-muted)] hover:text-[var(--fl-auth-ink)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
