import { useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@getmocha/users-service/react";
import { Target, Activity, Dumbbell, User, Ruler, Weight } from "lucide-react";

export default function Onboarding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    username: "",
    full_name: "",
    weight: "",
    height: "",
    initial_conditioning: "sedentario",
    initial_pushups: "",
    initial_situps: "",
    initial_squats: "",
    injuries: "",
    equipment: "",
    main_goal: "saude_geral",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: formData.username,
          full_name: formData.full_name,
          weight: parseFloat(formData.weight),
          height: parseFloat(formData.height),
          initial_conditioning: formData.initial_conditioning,
          initial_pushups: parseInt(formData.initial_pushups) || 0,
          initial_situps: parseInt(formData.initial_situps) || 0,
          initial_squats: parseInt(formData.initial_squats) || 0,
          injuries: formData.injuries,
          equipment: formData.equipment,
          main_goal: formData.main_goal,
        }),
      });

      if (response.ok) {
        navigate("/dashboard");
      } else {
        const data = await response.json();
        setError(data.error || "Erro ao criar perfil");
      }
    } catch (err) {
      setError("Erro ao conectar com o servidor");
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    navigate("/app");
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-2xl p-8 md:p-12">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Bem-vindo ao FitLoot!</h1>
            <p className="text-gray-600">Configure seu perfil para começar</p>
          </div>

          {/* Progress Steps */}
          <div className="flex justify-center mb-12">
            <div className="flex items-center gap-4">
              <StepIndicator number={1} active={step === 1} completed={step > 1} />
              <div className="w-12 h-1 bg-gray-300 rounded" />
              <StepIndicator number={2} active={step === 2} completed={step > 2} />
              <div className="w-12 h-1 bg-gray-300 rounded" />
              <StepIndicator number={3} active={step === 3} completed={false} />
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {step === 1 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Informações Básicas</h2>
                
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <User className="w-4 h-4" />
                    Nome Completo
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-emerald-500 focus:outline-none transition-colors"
                    placeholder="Seu nome completo"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <User className="w-4 h-4" />
                    Nome de Usuário
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                    className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-emerald-500 focus:outline-none transition-colors"
                    placeholder="usuario123"
                    minLength={3}
                    maxLength={20}
                  />
                  <p className="text-xs text-gray-500 mt-1">Usado para login e ranking (apenas letras, números e _)</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                      <Weight className="w-4 h-4" />
                      Peso (kg)
                    </label>
                    <input
                      type="number"
                      required
                      step="0.1"
                      value={formData.weight}
                      onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                      className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-emerald-500 focus:outline-none transition-colors"
                      placeholder="70"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                      <Ruler className="w-4 h-4" />
                      Altura (cm)
                    </label>
                    <input
                      type="number"
                      required
                      step="0.1"
                      value={formData.height}
                      onChange={(e) => setFormData({ ...formData, height: e.target.value })}
                      className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-emerald-500 focus:outline-none transition-colors"
                      placeholder="175"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white py-4 rounded-full font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
                >
                  Continuar
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Condicionamento Atual</h2>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <Activity className="w-4 h-4" />
                    Nível de Condicionamento
                  </label>
                  <select
                    value={formData.initial_conditioning}
                    onChange={(e) => setFormData({ ...formData, initial_conditioning: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-emerald-500 focus:outline-none transition-colors"
                  >
                    <option value="sedentario">Sedentário</option>
                    <option value="iniciante">Iniciante</option>
                    <option value="intermediario">Intermediário</option>
                    <option value="avancado">Avançado</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 mb-4 block">
                    Quantas repetições você consegue fazer?
                  </label>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">Flexões</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.initial_pushups}
                        onChange={(e) => setFormData({ ...formData, initial_pushups: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 focus:border-emerald-500 focus:outline-none transition-colors"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">Abdominais</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.initial_situps}
                        onChange={(e) => setFormData({ ...formData, initial_situps: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 focus:border-emerald-500 focus:outline-none transition-colors"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 mb-1 block">Agachamentos</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.initial_squats}
                        onChange={(e) => setFormData({ ...formData, initial_squats: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border-2 border-gray-200 focus:border-emerald-500 focus:outline-none transition-colors"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex-1 bg-gray-200 text-gray-700 py-4 rounded-full font-semibold hover:bg-gray-300 transition-colors"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 text-white py-4 rounded-full font-semibold shadow-lg hover:shadow-xl transition-all duration-300"
                  >
                    Continuar
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Objetivos e Equipamentos</h2>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <Target className="w-4 h-4" />
                    Objetivo Principal
                  </label>
                  <select
                    value={formData.main_goal}
                    onChange={(e) => setFormData({ ...formData, main_goal: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-emerald-500 focus:outline-none transition-colors"
                  >
                    <option value="perder_peso">Perder Peso</option>
                    <option value="ganhar_massa">Ganhar Massa Muscular</option>
                    <option value="resistencia">Aumentar Resistência</option>
                    <option value="calistenia">Dominar Calistenia</option>
                    <option value="saude_geral">Saúde Geral</option>
                  </select>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <Dumbbell className="w-4 h-4" />
                    Equipamentos Disponíveis (opcional)
                  </label>
                  <input
                    type="text"
                    value={formData.equipment}
                    onChange={(e) => setFormData({ ...formData, equipment: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-emerald-500 focus:outline-none transition-colors"
                    placeholder="Ex: barra fixa, paralelas, faixas elásticas"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Lesões ou Limitações (opcional)
                  </label>
                  <textarea
                    value={formData.injuries}
                    onChange={(e) => setFormData({ ...formData, injuries: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl border-2 border-gray-200 focus:border-emerald-500 focus:outline-none transition-colors resize-none"
                    rows={3}
                    placeholder="Descreva qualquer lesão ou limitação física"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border-2 border-red-200 text-red-700 px-4 py-3 rounded-2xl">
                    {error}
                  </div>
                )}

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="flex-1 bg-gray-200 text-gray-700 py-4 rounded-full font-semibold hover:bg-gray-300 transition-colors"
                    disabled={loading}
                  >
                    Voltar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 text-white py-4 rounded-full font-semibold shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50"
                  >
                    {loading ? "Criando..." : "Começar Jornada!"}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ number, active, completed }: { number: number; active: boolean; completed: boolean }) {
  return (
    <div
      className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all ${
        completed
          ? "bg-emerald-500 text-white"
          : active
          ? "bg-emerald-500 text-white ring-4 ring-emerald-200"
          : "bg-gray-200 text-gray-500"
      }`}
    >
      {completed ? "✓" : number}
    </div>
  );
}
