export type CredentialsStep = {
  email: string;
  password: string;
  confirmPassword: string;
};

export type ProfileStep = {
  username: string;
  full_name: string;
  weight: string;
  height: string;
  initial_conditioning: "sedentario" | "iniciante" | "intermediario" | "avancado";
  initial_pushups: string;
  initial_situps: string;
  initial_squats: string;
  injuries: string;
  equipment: string;
  main_goal: "perder_peso" | "ganhar_massa" | "resistencia" | "calistenia" | "saude_geral";
  gender: "homem" | "mulher" | "outro";
  age: string;
};

export type GoalValue = ProfileStep["main_goal"];

export type AvailabilityState = {
  status: "idle" | "checking" | "available" | "unavailable" | "invalid";
  message?: string | undefined;
};
