import { useNavigate } from "react-router";
import { Target, ShoppingBag, Users, TrendingUp, User } from "lucide-react";

interface BottomNavProps {
  active: 'missions' | 'shop' | 'friends' | 'ranking' | 'profile';
}

export default function BottomNav({ active }: BottomNavProps) {
  const navigate = useNavigate();

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-lg border-t border-gray-200 shadow-2xl">
      <div className="max-w-screen-xl mx-auto px-4">
        <div className="flex items-center justify-around h-20">
          <NavButton
            icon={<Target className="w-6 h-6" />}
            label="Missões"
            active={active === 'missions'}
            onClick={() => navigate('/dashboard')}
          />
          <NavButton
            icon={<ShoppingBag className="w-6 h-6" />}
            label="Loja"
            active={active === 'shop'}
            onClick={() => navigate('/shop')}
          />
          <NavButton
            icon={<Users className="w-6 h-6" />}
            label="Amigos"
            active={active === 'friends'}
            onClick={() => navigate('/friends')}
          />
          <NavButton
            icon={<TrendingUp className="w-6 h-6" />}
            label="Ranking"
            active={active === 'ranking'}
            onClick={() => navigate('/ranking')}
          />
          <NavButton
            icon={<User className="w-6 h-6" />}
            label="Perfil"
            active={active === 'profile'}
            onClick={() => navigate('/profile')}
          />
        </div>
      </div>
    </div>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
        active
          ? "text-emerald-600 bg-emerald-50"
          : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
      }`}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}
