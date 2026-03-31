// Canonical auth types shared by providers, guards, and services.
export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | undefined;
  showcased_achievements?: string | null | undefined;
  onboarding_completed: number;
  plan_id: "basic" | "pro" | "annual" | "vip";
  plan_status: "pending" | "active" | "cancelled" | "failed" | "expired";
  payment_method: "none" | "card" | "pix";
}

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  checkAuth: () => Promise<void>;
  logout: () => void;
}
