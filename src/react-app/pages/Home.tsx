import { useEffect } from "react";
import { useAuth } from "@getmocha/users-service/react";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { user, isPending, redirectToLogin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const checkProfile = async () => {
      if (!isPending && user) {
        try {
          const response = await fetch("/api/profile");
          if (response.ok) {
            const profile = await response.json();
            if (profile) {
              navigate("/dashboard");
            } else {
              navigate("/onboarding");
            }
          } else {
            navigate("/onboarding");
          }
        } catch (error) {
          navigate("/onboarding");
        }
      }
    };

    checkProfile();
  }, [user, isPending, navigate]);

  if (isPending) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
        <div className="animate-spin">
          <Loader2 className="w-10 h-10 text-emerald-600" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-2xl p-12 max-w-md w-full mx-4">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">FitLoot</h1>
            <p className="text-gray-600">Entre para começar sua jornada</p>
          </div>
          <button
            onClick={redirectToLogin}
            className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white py-4 rounded-full font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
          >
            Entrar com Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
      <div className="animate-spin">
        <Loader2 className="w-10 h-10 text-emerald-600" />
      </div>
    </div>
  );
}
