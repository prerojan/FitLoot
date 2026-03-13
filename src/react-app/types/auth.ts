export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | undefined;
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
