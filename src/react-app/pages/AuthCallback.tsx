import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/react-app/utils/api";


export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        console.log('🔍 AuthCallback: Iniciando verificação...');
        
        // Aguarda um pouco para dar tempo do cookie ser setado
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Verifica se o usuário está autenticado
        const userResponse = await api('/api/users/me');


        console.log('👤 User response status:', userResponse.status);

        if (!userResponse.ok) {
          console.error('❌ Usuário não autenticado');
          setError('Erro ao autenticar');
          setTimeout(() => navigate('/app'), 2000);
          return;
        }

        const userData = await userResponse.json();
        console.log('✅ Usuário autenticado:', userData);

        // Verifica se o usuário já tem um perfil completo
        const profileResponse = await api('/api/profile');


        console.log('📋 Profile response status:', profileResponse.status);

        if (profileResponse.ok) {
          console.log('✅ Perfil existe, indo para dashboard');
          navigate('/dashboard');
        } else {
          console.log('⚠️ Perfil não existe, indo para onboarding');
          navigate('/onboarding');
        }
      } catch (err) {
        console.error('💥 Callback error:', err);
        setError('Erro na autenticação');
        setTimeout(() => navigate('/app'), 2000);
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