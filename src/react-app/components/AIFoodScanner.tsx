// ====================================
// src/react-app/components/AIFoodScanner.tsx
// Scanner de alimentos com análise por IA
// ====================================

import { useState, useRef } from "react";
import { Camera, Loader2, CheckCircle, Sparkles } from "lucide-react";

interface FoodData {
  food_name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  healthy_score: number;
  suggestions: string;
}

export default function AIFoodScanner({ onFoodAdded }: { onFoodAdded?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [foodData, setFoodData] = useState<FoodData | null>(null);
  const [textInput, setTextInput] = useState("");
  const [mode, setMode] = useState<"text" | "camera">("text");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyzeFood = async (description?: string, imageBase64?: string) => {
    try {
      setLoading(true);
      setFoodData(null);

      const response = await fetch("/api/ai/analyze-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          food_description: description,
          image_base64: imageBase64,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to analyze food");
      }

      const data = await response.json();
      setFoodData(data.food_data);

      // Clear input
      setTextInput("");

      // Notify parent
      setTimeout(() => {
        if (onFoodAdded) {
          onFoodAdded();
        }
      }, 2000);

    } catch (err) {
      console.error("Error analyzing food:", err);
      alert("Erro ao analisar alimento. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    analyzeFood(textInput);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Convert to base64
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      const base64Data = base64.split(",")[1]; // Remove data:image/jpeg;base64, prefix
      await analyzeFood(undefined, base64Data);
    };
    reader.readAsDataURL(file);
  };

  const getHealthScoreColor = (score: number) => {
    if (score >= 8) return "text-green-600 bg-green-100";
    if (score >= 5) return "text-yellow-600 bg-yellow-100";
    return "text-red-600 bg-red-100";
  };

  return (
    <div className="space-y-4">
      {/* Mode Selector */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode("text")}
          className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
            mode === "text"
              ? "bg-emerald-500 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Texto
        </button>
        <button
          onClick={() => setMode("camera")}
          className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
            mode === "camera"
              ? "bg-emerald-500 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <Camera className="w-4 h-4" />
            <span>Câmera</span>
          </div>
        </button>
      </div>

      {/* Text Input Mode */}
      {mode === "text" && (
        <form onSubmit={handleTextSubmit} className="space-y-3">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Ex: prato de arroz com feijão e frango"
            className="w-full px-4 py-3 rounded-lg border-2 border-emerald-200 focus:border-emerald-500 outline-none"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !textInput.trim()}
            className="w-full px-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg font-medium shadow-lg hover:shadow-xl transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Analisando...</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4" />
                <span>Analisar com IA</span>
              </div>
            )}
          </button>
        </form>
      )}

      {/* Camera Mode */}
      {mode === "camera" && (
        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleImageUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="w-full px-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg font-medium shadow-lg hover:shadow-xl transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Analisando foto...</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <Camera className="w-4 h-4" />
                <span>Tirar Foto do Alimento</span>
              </div>
            )}
          </button>
          <p className="text-xs text-gray-500 text-center">
            A IA vai identificar o alimento e calcular as informações nutricionais
          </p>
        </div>
      )}

      {/* Results */}
      {foodData && (
        <div className="bg-white rounded-2xl shadow-lg p-5 space-y-4 border-2 border-emerald-200 animate-fadeIn">
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle className="w-5 h-5" />
            <span className="font-bold">Alimento Analisado</span>
          </div>

          <div>
            <h3 className="text-xl font-bold text-gray-900 mb-1">{foodData.food_name}</h3>
            <div
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${getHealthScoreColor(
                foodData.healthy_score
              )}`}
            >
              <span>Score Saudável: {foodData.healthy_score}/10</span>
            </div>
          </div>

          {/* Macros */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-emerald-600">{foodData.calories}</div>
              <div className="text-xs text-gray-600">Calorias</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-600">{foodData.protein}g</div>
              <div className="text-xs text-gray-600">Proteína</div>
            </div>
            <div className="bg-yellow-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-yellow-600">{foodData.carbs}g</div>
              <div className="text-xs text-gray-600">Carboidratos</div>
            </div>
            <div className="bg-orange-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-orange-600">{foodData.fats}g</div>
              <div className="text-xs text-gray-600">Gorduras</div>
            </div>
          </div>

          {/* AI Suggestions */}
          {foodData.suggestions && (
            <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-purple-900 text-sm mb-1">Dica da IA</h4>
                  <p className="text-xs text-purple-700">{foodData.suggestions}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}