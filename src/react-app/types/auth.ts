export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  onboarding_completed: number;
}

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  checkAuth: () => Promise<void>;
  logout: () => void;
}
