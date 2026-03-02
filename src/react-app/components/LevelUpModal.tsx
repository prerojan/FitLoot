import { Trophy, Sparkles, X } from "lucide-react";

interface LevelUpModalProps {
  level: number;
  onClose: () => void;
}

export default function LevelUpModal({ level, onClose }: LevelUpModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-3xl p-8 max-w-md w-full shadow-2xl text-white relative animate-scaleIn">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="text-center">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-white/20 backdrop-blur-sm rounded-full mb-6 animate-bounce">
            <Trophy className="w-12 h-12" />
          </div>

          <h2 className="text-4xl font-bold mb-2">NOVO NÍVEL!</h2>
          
          <div className="flex items-center justify-center gap-2 mb-6">
            <Sparkles className="w-6 h-6" />
            <span className="text-6xl font-bold">{level}</span>
            <Sparkles className="w-6 h-6" />
          </div>

          <p className="text-xl mb-8 text-emerald-50">
            Você subiu de nível e ganhou 100 pontos extras!
          </p>

          <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-4 mb-6">
            <h3 className="font-semibold mb-2">Recompensas Desbloqueadas:</h3>
            <ul className="text-sm space-y-1 text-emerald-50">
              <li>✓ Novas habilidades disponíveis</li>
              <li>✓ +100 pontos para a loja</li>
              <li>✓ Possível novo título desbloqueado</li>
            </ul>
          </div>

          <button
            onClick={onClose}
            className="w-full bg-white text-emerald-600 py-4 rounded-full font-bold shadow-lg hover:shadow-xl transition-all hover:scale-105"
          >
            Continuar Evoluindo
          </button>
        </div>
      </div>
    </div>
  );
}
