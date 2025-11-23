import { useEffect } from "react";
import { useAuth } from "@getmocha/users-service/react";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const { exchangeCodeForSessionToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        await exchangeCodeForSessionToken();
        navigate("/app");
      } catch (error) {
        console.error("Error exchanging code:", error);
        navigate("/app");
      }
    };

    handleCallback();
  }, [exchangeCodeForSessionToken, navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
      <div className="animate-spin mb-4">
        <Loader2 className="w-10 h-10 text-emerald-600" />
      </div>
      <p className="text-gray-600">Autenticando...</p>
    </div>
  );
}
