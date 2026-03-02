import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/react-app/utils/api";


export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 500));

        const userResponse = await api("/api/users/me");
        if (!userResponse.ok) {
          setError("Erro ao autenticar");
          setTimeout(() => navigate("/app"), 2000);
          return;
        }

        await userResponse.json();

        const profileResponse = await api("/api/profile");
        if (profileResponse.ok) {
          navigate("/dashboard");
        } else {
          navigate("/onboarding");
        }
      } catch (err) {
        console.error("[AuthCallback]", err);
        setError("Erro na autenticação");
        setTimeout(() => navigate("/app"), 2000);
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center">
      <div className="text-center">
        {error ? (
          <div className="text-red-600 text-xl">{error}</div>
        ) : (
          <>
            <div className="text-emerald-600 text-2xl mb-4">
              Autenticando...
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-3 h-3 bg-emerald-500 rounded-full animate-bounce"></div>
              <div className="w-3 h-3 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-3 h-3 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}