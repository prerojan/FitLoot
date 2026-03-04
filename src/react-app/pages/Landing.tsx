import React from 'react';
import { useNavigate } from 'react-router';
import { Zap, Trophy, Target, Gamepad2, Heart, Brain, TrendingUp, Shield, Award, Star, ChevronRight, Dumbbell, Apple, Smartphone, Users, Swords, Clock, CheckCircle2, Flame, DollarSign, Sparkles, Crown, ShoppingBag } from 'lucide-react';
import { Button } from '@/react-app/components/ui/button';
import { Input } from '@/react-app/components/ui/input';
import { Card } from '@/react-app/components/ui/card';
export default function Landing() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState('');
  const features = [{
    icon: Gamepad2,
    title: 'Gamificação Real',
    description: 'Transforme exercícios em conquistas épicas com XP, níveis e recompensas reais'
  }, {
    icon: Target,
    title: 'Missões Personalizadas',
    description: 'Desafios diários, semanais e mensais adaptados ao seu nível fitness'
  }, {
    icon: Trophy,
    title: 'Títulos & Conquistas',
    description: 'Desbloqueie títulos raros e mostre suas conquistas para o mundo'
  }, {
    icon: Brain,
    title: 'IA Personalizada',
    description: 'Recomendações inteligentes de treinos e nutrição baseadas na sua evolução'
  }, {
    icon: Apple,
    title: 'Scanner Nutricional',
    description: 'Tire uma foto da comida e receba análise nutricional completa instantaneamente'
  }, {
    icon: Shield,
    title: 'Sistema Anti-Trapaça',
    description: 'Validação por sensores garante que você realmente está treinando'
  }, {
    icon: Award,
    title: 'Loja de Recompensas',
    description: 'Troque seus pontos por cupons de whey, creatina e equipamentos fitness'
  }, {
    icon: Smartphone,
    title: 'Google Fit & Apple Health',
    description: 'Sincronização automática com seus apps de saúde favoritos'
  }];
  const stats = [{
    value: '10K+',
    label: 'Usuários Ativos'
  }, {
    value: '2M+',
    label: 'Calorias Queimadas'
  }, {
    value: '500K+',
    label: 'Missões Completas'
  }, {
    value: '95%',
    label: 'Taxa de Sucesso'
  }];
  const costComparison = [{
    service: 'Academia',
    monthly: 'R$ 265',
    yearly: 'R$ 3.180',
    icon: Dumbbell
  }, {
    service: 'Personal Trainer',
    monthly: 'R$ 900',
    yearly: 'R$ 10.800',
    icon: Users
  }, {
    service: 'Nutricionista',
    monthly: 'R$ 300',
    yearly: 'R$ 3.600',
    icon: Apple
  }, {
    service: 'Apps de Treino/Nutrição',
    monthly: 'R$ 50',
    yearly: 'R$ 600',
    icon: Smartphone
  }, {
    service: 'Total Tradicional',
    monthly: 'R$ 1.515',
    yearly: 'R$ 18.180',
    icon: DollarSign,
    highlight: true
  }, {
    service: 'FitLoot Premium',
    monthly: 'R$ 99',
    yearly: 'R$ 990',
    icon: Zap,
    fitloot: true
  }];
  const plans = [{
    name: 'Básico',
    price: 'R$ 49',
    yearlyPrice: 'R$ 490',
    savings: '',
    features: ['Missões diárias', 'Evolução de atributos (FOR, CON, VIT, DES, FOCO)', 'Sistema de XP e níveis', 'Streaks e multiplicadores', 'Ranking básico'],
    icon: Target,
    color: 'from-gray-400 to-gray-500'
  }, {
    name: 'Premium',
    price: 'R$ 99',
    yearlyPrice: 'R$ 990',
    savings: '2 meses grátis',
    features: ['Tudo do Básico', 'Missões semanais e mensais', 'Scanner de alimentos com IA', 'Ranking global e local', 'Loja de cupons fitness', 'Sistema de amigos', 'Mini-games e desafios'],
    icon: Crown,
    color: 'from-emerald-500 to-teal-600',
    popular: true
  }, {
    name: 'Elite',
    price: 'R$ 149',
    yearlyPrice: 'R$ 1.490',
    savings: '2 meses grátis',
    features: ['Tudo do Premium', 'Planos personalizados de treino', 'Planos personalizados de nutrição', 'Habilidades avançadas de calistenia', 'Animações "novo nível" premium', 'Suporte VIP prioritário', 'Personalização total do perfil'],
    icon: Sparkles,
    color: 'from-purple-500 to-pink-600'
  }];
  const testimonials = [{
    name: 'Carlos Silva',
    role: 'Atleta Amador',
    content: 'FitLoot mudou completamente minha relação com exercícios. Em 3 meses perdi 12kg e ganhei músculos que nunca imaginei!',
    rating: 5,
    avatar: '👨',
    stats: 'Nível 28 • 45 dias de streak'
  }, {
    name: 'Marina Costa',
    role: 'Personal Trainer',
    content: 'Recomendo para todos os meus alunos. A gamificação mantém a motivação lá em cima. Resultados surpreendentes!',
    rating: 5,
    avatar: '👩',
    stats: 'Nível 42 • 120 dias de streak'
  }, {
    name: 'Rafael Mendes',
    role: 'Desenvolvedor',
    content: 'Trabalho sentado o dia todo, mas com FitLoot consegui criar o hábito de me exercitar. As missões são viciantes!',
    rating: 5,
    avatar: '👨‍💻',
    stats: 'Nível 19 • 30 dias de streak'
  }];
  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert(`Obrigado! Enviaremos novidades para ${email}`);
    setEmail('');
  };

  const handleGetStarted = () => {
    navigate('/app');
  };

  return <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1920')] bg-cover bg-center opacity-5" />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 mb-6">
              <Zap className="w-12 h-12 text-emerald-500" strokeWidth={2.5} />
              <h1 className="fl-title-page text-5xl md:text-7xl">
                Fit<span className="text-emerald-500">Loot</span>
              </h1>
            </div>
            
            <h2 className="fl-title-page md:text-5xl mb-6 leading-tight">
              Transforme Sua Vida<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-500">
                Em Um Grande Jogo
              </span>
            </h2>
            
            <p className="text-xl md:text-2xl text-gray-600 mb-10 max-w-3xl mx-auto leading-relaxed">
              Ganhe XP, suba de nível, desbloqueie habilidades e evolua seus atributos enquanto melhora sua saúde na vida real
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
                <Button onClick={handleGetStarted} size="lg" className="fl-btn-primary px-8 py-6 text-lg rounded-full shadow-lg hover:shadow-xl">
                  Começar Teste Grátis de 7 Dias
                  <ChevronRight className="ml-2 w-5 h-5" />
                </Button>
              
              <Button variant="outline" size="lg" className="border-2 border-emerald-500 text-emerald-600 hover:bg-emerald-50 px-8 py-6 text-lg rounded-full" onClick={() => document.getElementById('como-funciona')?.scrollIntoView({
              behavior: 'smooth'
            })}>
                Ver Como Funciona
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
              {stats.map((stat, idx) => <Card key={idx} className="fl-card-soft p-6 rounded-3xl hover:shadow-lg transition-shadow">
                  <div className="text-3xl md:text-4xl font-bold text-emerald-600 mb-2">
                    {stat.value}
                  </div>
                  <div className="text-sm md:text-base text-gray-600">
                    {stat.label}
                  </div>
                </Card>)}
            </div>
          </div>
        </div>
      </div>

      {/* Avatar Evolution Section */}
      <div className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h3 className="fl-title-page md:text-5xl mb-6">
                Evolua Seus Atributos <span className="text-emerald-500">RPG Style</span>
              </h3>
              <p className="text-xl text-gray-600 mb-8 leading-relaxed">
                Cada treino evolui seus atributos físicos. Acompanhe seu progresso em tempo real e veja sua transformação!
              </p>
              
              <div className="space-y-4">
                {[{
                name: 'FOR (Força)',
                value: 85,
                color: 'bg-red-500'
              }, {
                name: 'CON (Constituição)',
                value: 72,
                color: 'bg-orange-500'
              }, {
                name: 'VIT (Vitalidade)',
                value: 68,
                color: 'bg-green-500'
              }, {
                name: 'DES (Destreza)',
                value: 90,
                color: 'bg-blue-500'
              }, {
                name: 'FOCO',
                value: 76,
                color: 'bg-purple-500'
              }].map((attr, idx) => <div key={idx}>
                    <div className="flex justify-between mb-2">
                      <span className="font-semibold text-gray-700">{attr.name}</span>
                      <span className="font-bold text-gray-900">{attr.value}/100</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                      <div className={`${attr.color} h-full rounded-full transition-all duration-500`} style={{
                    width: `${attr.value}%`
                  }} />
                    </div>
                  </div>)}
              </div>
            </div>
            
            <div className="relative">
              <div className="bg-gradient-to-br from-emerald-100 to-teal-100 rounded-3xl p-8 shadow-2xl">
                <img src="https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=600&h=600&fit=crop" alt="Avatar fitness" className="w-full h-auto rounded-2xl shadow-lg" />
                <div className="absolute -top-4 -right-4 bg-white rounded-full p-4 shadow-xl">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-emerald-600">42</div>
                    <div className="text-xs text-gray-600">NÍVEL</div>
                  </div>
                </div>
                <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-yellow-400 to-orange-500 text-white px-6 py-3 rounded-full shadow-xl flex items-center gap-2">
                  <Trophy className="w-5 h-5" />
                  <span className="font-bold">Mestre da Calistenia</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cost Comparison Section */}
      <div className="py-20 bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h3 className="fl-title-page md:text-5xl mb-4">Quanto Você Economiza com FitLoot?</h3>
            <p className="text-xl text-gray-600">
              Compare os custos tradicionais com nossa solução completa
            </p>
          </div>

          <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-gray-800 to-gray-900 text-white">
                  <tr>
                    <th className="px-6 py-4 text-left text-lg font-bold">Serviço</th>
                    <th className="px-6 py-4 text-center text-lg font-bold">Gasto Mensal</th>
                    <th className="px-6 py-4 text-center text-lg font-bold">Gasto Anual</th>
                  </tr>
                </thead>
                <tbody>
                  {costComparison.map((item, idx) => {
                  const Icon = item.icon;
                  return <tr key={idx} className={`border-b border-gray-200 ${item.fitloot ? 'bg-gradient-to-r from-emerald-50 to-teal-50' : item.highlight ? 'bg-red-50 font-bold' : 'hover:bg-gray-50'}`}>
                        <td className="px-6 py-4 flex items-center gap-3">
                          <Icon className={`w-6 h-6 ${item.fitloot ? 'text-emerald-600' : 'text-gray-600'}`} />
                          <span className={`text-lg ${item.fitloot ? 'font-bold text-emerald-900' : ''}`}>
                            {item.service}
                          </span>
                        </td>
                        <td className={`px-6 py-4 text-center text-lg ${item.fitloot ? 'font-bold text-emerald-600' : ''}`}>
                          {item.monthly}
                        </td>
                        <td className={`px-6 py-4 text-center text-lg ${item.fitloot ? 'font-bold text-emerald-600' : ''}`}>
                          {item.yearly}
                        </td>
                      </tr>;
                })}
                </tbody>
              </table>
            </div>
            
            <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white p-6 text-center">
              <div className="flex items-center justify-center gap-3 mb-2">
                <Sparkles className="w-6 h-6" />
                <p className="text-2xl font-bold">Economia de 93% ao ano!</p>
                <Sparkles className="w-6 h-6" />
              </div>
              <p className="text-lg opacity-90">
                FitLoot Premium substitui todos esses gastos com uma solução completa e gamificada
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Gamified Features Section */}
      <div id="como-funciona" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h3 className="fl-title-page md:text-5xl mb-4">Mais Que Um Treino 
Transforme Hábitos em XP!</h3>
            <p className="text-xl text-gray-600">
              Sistema de gamificação completo que torna exercícios viciantes
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
            {[{
            icon: Target,
            title: 'Missões Diárias',
            description: 'Complete desafios personalizados e ganhe XP e pontos',
            example: '"Caminhe 5.000 passos" • 50 XP • 10 Pontos'
          }, {
            icon: Flame,
            title: 'Sistema de Streak',
            description: 'Mantenha sequências diárias e ganhe multiplicadores de XP',
            example: '30 dias consecutivos = +3.0x XP!'
          }, {
            icon: TrendingUp,
            title: 'Evolução de Atributos',
            description: 'Cada exercício evolui FOR, CON, VIT, DES e FOCO',
            example: '100 flexões = +5 FOR, +3 CON'
          }, {
            icon: Award,
            title: 'Conquistas Raras',
            description: 'Desbloqueie títulos e conquistas épicas',
            example: 'Lendário: "Dragão de Ferro" 🐉'
          }, {
            icon: Swords,
            title: 'Mini-Games PvP',
            description: 'Desafie amigos em percursos de treino cronometrados',
            example: 'Vencedor: 100 XP | Perdedor: 50 XP'
          }, {
            icon: ShoppingBag,
            title: 'Loja de Recompensas',
            description: 'Troque pontos por cupons fitness reais',
            example: '500 pts = 15% OFF em Whey Protein'
          }].map((feature, idx) => {
            const Icon = feature.icon;
            return <Card key={idx} className="p-8 hover:shadow-xl transition-all border-emerald-100 rounded-3xl">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-6">
                    <Icon className="w-8 h-8 text-white" strokeWidth={2} />
                  </div>
                  <h4 className="text-xl font-bold text-gray-900 mb-3">
                    {feature.title}
                  </h4>
                  <p className="text-gray-600 mb-4 leading-relaxed">
                    {feature.description}
                  </p>
                  <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-200">
                    <p className="text-sm text-emerald-700 font-medium">
                      💡 {feature.example}
                    </p>
                  </div>
                </Card>;
          })}
          </div>

          {/* Smartphone mockup */}
          <div className="text-center">
            <img src="https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=800&h=600&fit=crop" alt="App Interface" className="mx-auto rounded-3xl shadow-2xl max-w-2xl w-full" />
          </div>
        </div>
      </div>

      {/* Plans Section */}
      <div className="py-20 bg-gradient-to-br from-emerald-50 to-teal-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h3 className="fl-title-page md:text-5xl mb-4">
              🏆 Escolha Seu Plano FitLoot
            </h3>
            <p className="text-xl text-gray-600">
              Teste grátis por 7 dias • Cancele quando quiser
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {plans.map((plan, idx) => {
            const Icon = plan.icon;
            return <Card key={idx} className={`relative rounded-3xl overflow-hidden ${plan.popular ? 'ring-4 ring-emerald-500 shadow-2xl scale-105' : 'shadow-lg'}`}>
                  {plan.popular && <div className="absolute top-0 right-0 bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 py-2 rounded-bl-3xl font-bold">
                      MAIS POPULAR
                    </div>}
                  
                  <div className="p-8">
                    <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${plan.color} flex items-center justify-center mb-6`}>
                      <Icon className="w-8 h-8 text-white" strokeWidth={2} />
                    </div>
                    
                    <h4 className="fl-title-section mb-2">{plan.name}</h4>
                    <div className="mb-4">
                      <span className="text-4xl font-bold text-gray-900">{plan.price}</span>
                      <span className="text-gray-600">/mês</span>
                    </div>
                    <p className="text-emerald-600 font-semibold mb-6">
                      {plan.yearlyPrice}/ano {plan.savings && `• ${plan.savings}`}
                    </p>
                    
                    <ul className="space-y-3 mb-8">
                      {plan.features.map((feature, fIdx) => <li key={fIdx} className="flex items-start gap-2">
                          <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                          <span className="text-gray-700">{feature}</span>
                        </li>)}
                    </ul>
                    

                      <Button onClick={handleGetStarted} className={`w-full py-6 rounded-full text-lg ${plan.popular ? 'fl-btn-primary shadow-lg' : 'bg-gray-200 hover:bg-gray-300 text-gray-900 font-semibold'}`}>
                        Começar Teste Grátis
                      </Button>

                  </div>
                </Card>;
          })}
          </div>
          
          <p className="text-center text-gray-600 mt-8 text-lg">
            <Clock className="inline w-5 h-5 mr-2" />
            7 dias grátis • Sem compromisso • Cancele quando quiser
          </p>
        </div>
      </div>

      {/* Testimonials */}
      <div className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h3 className="fl-title-page md:text-5xl mb-4">
              O Que Dizem Nossos Usuários
            </h3>
            <p className="text-xl text-gray-600">
              Milhares já transformaram suas vidas com FitLoot
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {testimonials.map((testimonial, idx) => <Card key={idx} className="p-8 border-gray-100 rounded-3xl hover:shadow-xl transition-shadow">
                <div className="flex gap-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => <Star key={i} className="w-5 h-5 fill-yellow-400 text-yellow-400" />)}
                </div>
                <p className="text-gray-700 mb-6 leading-relaxed text-lg">
                  "{testimonial.content}"
                </p>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center text-2xl">
                    {testimonial.avatar}
                  </div>
                  <div>
                    <div className="font-bold text-gray-900">
                      {testimonial.name}
                    </div>
                    <div className="text-sm text-gray-500">
                      {testimonial.role}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-emerald-600 font-semibold">
                  <TrendingUp className="w-4 h-4" />
                  {testimonial.stats}
                </div>
              </Card>)}
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="py-20 bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h3 className="fl-title-page md:text-5xl mb-4">
              Funcionalidades Completas
            </h3>
            <p className="text-xl text-gray-600">
              Tudo que você precisa em um só lugar
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature, idx) => {
            const Icon = feature.icon;
            return <Card key={idx} className="p-8 hover:shadow-xl transition-all border-gray-100 rounded-3xl group cursor-pointer">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <Icon className="w-8 h-8 text-emerald-600" strokeWidth={2} />
                  </div>
                  <h4 className="text-xl font-bold text-gray-900 mb-3">
                    {feature.title}
                  </h4>
                  <p className="text-gray-600 leading-relaxed">
                    {feature.description}
                  </p>
                </Card>;
          })}
          </div>
        </div>
      </div>

      {/* Extra Benefits */}
      <div className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h3 className="fl-title-page md:text-5xl mb-4">
              ✨ Benefícios Exclusivos
            </h3>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {[{
            icon: Shield,
            title: 'Evolução Real Validada por Sensores',
            description: 'Tecnologia anti-trapaça garante que você realmente está treinando'
          }, {
            icon: TrendingUp,
            title: 'Ranking Local e Global',
            description: 'Compete com amigos e atletas do mundo todo'
          }, {
            icon: ShoppingBag,
            title: 'Loja de Cupons Fitness Reais',
            description: 'Troque pontos por descontos em produtos reais'
          }, {
            icon: Sparkles,
            title: 'Personalização Completa',
            description: 'Customize cores, fontes, imagens e bordas do seu perfil'
          }, {
            icon: Users,
            title: 'Sistema de Amigos',
            description: 'Adicione amigos e acompanhe o progresso deles'
          }, {
            icon: Swords,
            title: 'Desafios PvP',
            description: 'Crie mini-games e desafie outros usuários em percursos de treino'
          }].map((benefit, idx) => {
            const Icon = benefit.icon;
            return <div key={idx} className="flex gap-4 items-start">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-gray-900 mb-2">{benefit.title}</h4>
                    <p className="text-gray-600">{benefit.description}</p>
                  </div>
                </div>;
          })}
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div className="py-20 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Dumbbell className="w-16 h-16 text-white mx-auto mb-6" strokeWidth={2} />
          <h3 className="text-4xl md:text-5xl font-bold text-white mb-6">
            💥 Pronto Para Começar Sua Jornada?
          </h3>
          <p className="text-xl text-white/90 mb-10">
            Junte-se a milhares de pessoas que já estão transformando suas vidas com FitLoot
          </p>
          
          <form onSubmit={handleEmailSubmit} className="max-w-md mx-auto mb-8">
            <div className="flex gap-3">
              <Input type="email" placeholder="Seu melhor e-mail" value={email} onChange={e => setEmail(e.target.value)} className="flex-1 py-6 px-6 rounded-full text-lg bg-white/95" required />
              <Button type="submit" size="lg" className="bg-gray-900 hover:bg-gray-800 text-white px-8 rounded-full">
                Enviar
              </Button>
            </div>
          </form>

            <Button onClick={handleGetStarted} size="lg" className="bg-white text-emerald-600 hover:bg-gray-50 px-12 py-6 text-lg rounded-full shadow-xl hover:shadow-2xl transition-all">
              Começar Teste Grátis de 7 Dias
              <Heart className="ml-2 w-5 h-5" />
            </Button>
          
          <p className="text-white/80 mt-6 text-sm">
            Sem cartão de crédito necessário • Cancele quando quiser
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="py-12 bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2">
              <Zap className="w-8 h-8 text-emerald-400" />
              <span className="text-2xl font-bold">FitLoot</span>
            </div>
            <div className="text-center text-gray-400">
              © 2024 FitLoot. Todos os direitos reservados.
            </div>
            <div className="flex gap-6 text-gray-400">
              <a href="#" className="hover:text-white transition-colors">Termos</a>
              <a href="#" className="hover:text-white transition-colors">Privacidade</a>
              <a href="#" className="hover:text-white transition-colors">Contato</a>
            </div>
          </div>
        </div>
      </div>
    </div>;
}