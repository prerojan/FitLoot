import React, { useState } from 'react';
import { Zap, Mail, ArrowRight, Shield, Trophy, Target, Sparkles, Check } from 'lucide-react';
import { Button } from '@/react-app/components/ui/button';
import { Input } from '@/react-app/components/ui/input';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);

const handleGoogleLogin = () => {
  window.location.href = "https://fitloot-worker.suportefitloot.workers.dev/api/auth/google";
};

  const handleEmailLogin = () => {
    if (!email) return;
    setIsLoading(true);
    // Lógica de login por email
    console.log('Login with:', email);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background decorativo */}
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1920')] bg-cover bg-center opacity-5" />

      {/* Elementos decorativos flutuantes */}
      <div className="absolute top-20 left-10 w-20 h-20 bg-emerald-200 rounded-full blur-3xl opacity-50 animate-pulse" />
      <div className="absolute bottom-20 right-10 w-32 h-32 bg-teal-200 rounded-full blur-3xl opacity-50 animate-pulse" style={{ animationDelay: '700ms' }} />
      <div className="absolute top-1/2 left-1/4 w-24 h-24 bg-cyan-200 rounded-full blur-3xl opacity-50 animate-pulse" style={{ animationDelay: '1000ms' }} />

      <div className="relative w-full max-w-6xl grid md:grid-cols-2 gap-8 items-center">
        {/* Painel Esquerdo - Informações */}
        <div className="hidden md:block space-y-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Zap className="w-10 h-10 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-gray-900">
                Fit<span className="text-emerald-500">Loot</span>
              </h1>
              <p className="text-gray-600">Transforme treinos em conquistas</p>
            </div>
          </div>

          <div className="space-y-6">
            <h2 className="text-3xl font-bold text-gray-900 leading-tight">
              Entre e comece a <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-500">evoluir hoje</span>
            </h2>

            <div className="space-y-4">
              {[
                { icon: Trophy, text: 'Ganhe XP e suba de nível com cada treino' },
                { icon: Target, text: 'Complete missões e desbloqueie conquistas' },
                { icon: Sparkles, text: 'Troque pontos por cupons fitness reais' },
                { icon: Shield, text: 'Sistema anti-trapaça com validação por sensores' }
              ].map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div key={idx} className="flex items-center gap-4 p-4 bg-white/60 backdrop-blur-sm rounded-2xl border border-emerald-100 hover:shadow-lg transition-all">
                    <div className="w-12 h-12 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6 text-white" strokeWidth={2} />
                    </div>
                    <p className="text-gray-700 font-medium">{item.text}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-6">
            {[
              { value: '10K+', label: 'Usuários' },
              { value: '500K+', label: 'Missões' },
              { value: '95%', label: 'Sucesso' }
            ].map((stat, idx) => (
              <div key={idx} className="text-center p-4 bg-white/60 backdrop-blur-sm rounded-2xl border border-emerald-100">
                <div className="text-2xl font-bold text-emerald-600">{stat.value}</div>
                <div className="text-sm text-gray-600">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Painel Direito - Formulário de Login */}
        <div className="relative">
          <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl p-8 md:p-10 border border-white/20">
            {/* Logo mobile */}
            <div className="md:hidden flex items-center gap-3 mb-8 justify-center">
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
                <Zap className="w-7 h-7 text-white" strokeWidth={2.5} />
              </div>
              <h1 className="text-3xl font-bold text-gray-900">
                Fit<span className="text-emerald-500">Loot</span>
              </h1>
            </div>

            <div className="text-center mb-8">
              <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
                Bem-vindo de volta! 👋
              </h3>
              <p className="text-gray-600">
                Entre para continuar sua jornada épica
              </p>
            </div>

            {/* Botão Google */}
            <Button
              onClick={handleGoogleLogin}
              disabled={isLoading}
              className="w-full py-6 rounded-2xl font-semibold text-white mb-4 bg-white hover:bg-gray-50 text-gray-900 border-2 border-gray-200 hover:border-emerald-300 shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-3"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {isLoading ? 'Conectando...' : 'Continuar com Google'}
            </Button>

            {/* Divider */}
            <div className="flex items-center gap-4 my-6">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
              <span className="text-sm text-gray-500 font-medium">OU</span>
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
            </div>

            {/* Campo de Email */}
            <div className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <Input
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleEmailLogin()}
                  className="w-full pl-12 pr-4 py-6 rounded-2xl border-2 border-gray-200 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100 transition-all text-base"
                />
              </div>

              <Button
                onClick={handleEmailLogin}
                disabled={isLoading || !email}
                className="w-full py-6 rounded-2xl font-bold text-base bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Entrando...' : 'Continuar com Email'}
                <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </div>

            {/* Footer */}
            <div className="mt-8 text-center">
              <p className="text-sm text-gray-600">
                Não tem uma conta?{' '}
                <a href="/signup" className="font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
                  Cadastre-se grátis
                </a>
              </p>

              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-500">
                <Check className="w-4 h-4 text-emerald-500" />
                <span>7 dias grátis • Cancele quando quiser</span>
              </div>
            </div>

            {/* Trust indicators */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-center gap-6 text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <Shield className="w-4 h-4 text-emerald-500" />
                  <span>Seguro</span>
                </div>
                <div className="flex items-center gap-1">
                  <Zap className="w-4 h-4 text-emerald-500" />
                  <span>Rápido</span>
                </div>
                <div className="flex items-center gap-1">
                  <Trophy className="w-4 h-4 text-emerald-500" />
                  <span>10K+ usuários</span>
                </div>
              </div>
            </div>
          </div>

          {/* Badge flutuante */}
          <div className="absolute -top-4 -right-4 bg-gradient-to-r from-yellow-400 to-orange-500 text-white px-6 py-3 rounded-full shadow-xl transform rotate-12 hidden md:block">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              <span className="font-bold text-sm">7 dias grátis!</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}