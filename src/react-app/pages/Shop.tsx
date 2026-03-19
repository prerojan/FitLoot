import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/contexts/auth";
import AppPageShell from "@/react-app/components/AppPageShell";
import LoadingBall from "@/react-app/components/LoadingBall";
import { ShoppingBag, Coins, QrCode, Package, Search, Bell, ShoppingCart, LayoutGrid, Utensils, Shirt, Smartphone, Ticket, ArrowRight, Star } from "lucide-react";
import type { UserProgression } from "@/shared/types";
import { ApiRequestError, api, fetchAndCacheJson, readCachedJson } from "@/react-app/utils/api";

type ShopProductView = {
  id: number;
  name: string;
  description: string | null;
  points_cost: number;
  image_url: string | null;
  category: string;
  partner_name?: string | undefined;
};

type ShopOrderView = {
  id: number;
  product_name: string;
  image_url: string | null;
  is_redeemed?: number | undefined;
  qr_code?: string | undefined;
  created_at?: string | undefined;
  points_spent?: number | undefined;
};

export default function Shop() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<ShopProductView[]>([]);
  const [orders, setOrders] = useState<ShopOrderView[]>([]);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("todos");
  const [activeTab, setActiveTab] = useState<'shop' | 'orders'>('shop');
  const [loading, setLoading] = useState(true);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const loadData = useCallback(async () => {
    setError(null);

    const cacheProducts = readCachedJson<ShopProductView[]>("/api/shop/products");
    const cacheOrders = readCachedJson<ShopOrderView[]>("/api/shop/orders");
    const cacheProgression = readCachedJson<UserProgression>("/api/progression");

    if (cacheProducts) setProducts(Array.isArray(cacheProducts.data) ? cacheProducts.data : []);
    if (cacheOrders) setOrders(Array.isArray(cacheOrders.data) ? cacheOrders.data : []);
    if (cacheProgression) setProgression(cacheProgression.data);

    const hasAnyCache = Boolean(cacheProducts || cacheOrders || cacheProgression);
    if (hasAnyCache) {
      setLoading(false);
    }

    const runSection = async <T,>(
      path: string,
      cacheState: { stale: boolean } | null,
      onSuccess: (value: T) => void,
    ) => {
      if (cacheState && !cacheState.stale) return;
      const payload = await fetchAndCacheJson<T>(path);
      onSuccess(payload);
    };

    try {
      await Promise.all([
        runSection<ShopProductView[]>("/api/shop/products", cacheProducts, (payload) => setProducts(Array.isArray(payload) ? payload : [])),
        runSection<ShopOrderView[]>("/api/shop/orders", cacheOrders, (payload) => setOrders(Array.isArray(payload) ? payload : [])),
        runSection<UserProgression>("/api/progression", cacheProgression, (payload) => setProgression(payload)),
      ]);
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && (loadError.status === 401 || loadError.status === 403)) {
        navigate("/app");
        return;
      }
      console.error("Error loading shop data:", loadError);
      if (!hasAnyCache) {
        setError("Não foi possível carregar a loja agora.");
      }
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
    void loadData();
  }, [user, navigate, loadData]);

  const handlePurchase = async (productId: number) => {
    try {
      const requestId = crypto.randomUUID();
      const response = await api(`/api/shop/purchase/${productId}`, {
        method: "POST",
        body: JSON.stringify({ request_id: requestId }),
      });

      if (response.status === 401 || response.status === 403) {
        navigate("/app");
        return;
      }

      if (response.ok) {
        setPurchaseSuccess(true);
        setTimeout(() => setPurchaseSuccess(false), 3000);
        await loadData();
        setActiveTab('orders');
      } else {
        const data = (await response.json().catch(() => null)) as { error?: string | undefined } | null;
        alert(data?.error || "Erro ao realizar compra");
      }
    } catch (purchaseError) {
      console.error("Error purchasing:", purchaseError);
      alert("Erro ao conectar com o servidor");
    }
  };

  if (loading) {
    return (
      <AppPageShell
        bottomNavActive="shop"
        progression={progression}
        className="bg-[#0A0A0A]"
      >
        <div className="fl-app-container py-10 flex items-center justify-center min-h-[50vh]">
          <LoadingBall size="md" />
        </div>
      </AppPageShell>
    );
  }

  if (error) {
    return (
      <AppPageShell
        bottomNavActive="shop"
        progression={progression}
        className="bg-[#0A0A0A]"
      >
        <div className="fl-app-container py-10 text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={() => { setLoading(true); void loadData(); }} className="fl-btn-primary rounded-xl px-4 py-2">
            Tentar novamente
          </button>
        </div>
      </AppPageShell>
    );
  }

  const filteredProducts = selectedCategory === "todos"
    ? products
    : products.filter(p => p.category === selectedCategory);

  const displayProducts = filteredProducts.filter(p => 
    !searchQuery || 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.partner_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AppPageShell
      bottomNavActive="shop"
      progression={progression}
      className="bg-[#0A0A0A]"
    >
      <div className="flex-1 flex flex-col overflow-hidden min-h-screen">
        {/* Inner Header (Search + Points) */}
        <header className="sticky top-0 z-30 h-20 border-b border-white/5 px-6 flex items-center justify-between bg-[#0A0A0A]/80 backdrop-blur-xl">
          <div className="flex-1 max-w-xl">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-primary transition-colors" style={{ color: searchQuery ? 'var(--app-primary-color)' : '' }} />
              <input 
                type="text"
                placeholder="Buscar recompensas, marcas ou equipamentos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#161616] border border-white/5 focus:ring-1 focus:ring-primary rounded-xl pl-12 pr-4 py-2.5 text-slate-100 placeholder:text-slate-500 text-sm focus:outline-none transition-all"
                style={{ borderColor: searchQuery ? 'rgba(var(--app-primary-color-rgb), 0.3)' : '' }}
              />
            </div>
          </div>
          <div className="flex items-center gap-4 ml-6">
            <div className="hidden sm:flex items-center gap-2 bg-[#161616] border border-white/5 rounded-xl px-4 py-2 shadow-inner">
              <Coins className="w-5 h-5" style={{ color: 'var(--app-primary-color)' }} />
              <span className="font-bold text-white tracking-tight">{progression?.points?.toLocaleString() || 0} <span className="text-[10px] text-slate-500 uppercase ml-1">Pts</span></span>
            </div>
            <button className="w-10 h-10 flex items-center justify-center rounded-full bg-[#161616] border border-white/5 text-slate-400 hover:text-primary transition-colors">
              <ShoppingCart className="w-5 h-5" />
            </button>
            <button className="w-10 h-10 flex items-center justify-center rounded-full bg-[#161616] border border-white/5 text-slate-400 hover:text-primary transition-colors">
              <Bell className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Shop Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 sm:p-8">
          {/* Hero Promo */}
          <div className="relative w-full h-52 sm:h-64 rounded-3xl overflow-hidden mb-8 group border border-white/5">
            <div className="absolute inset-0 bg-gradient-to-r from-black via-black/50 to-transparent z-10"></div>
            <img 
              src="https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&q=80" 
              alt="Promo"
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
            />
            <div className="relative z-20 h-full flex flex-col justify-center px-10">
              <span className="bg-primary text-black px-3 py-1 rounded-full text-[10px] font-bold w-fit mb-3 uppercase tracking-wider" style={{ backgroundColor: 'var(--app-primary-color)' }}>Tempo Limitado</span>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2 tracking-tight">Summer Fitness Drop</h2>
              <p className="text-slate-300 max-w-sm text-sm font-medium">Ganhe 20% de desconto em equipamentos selecionados até 31 de Outubro.</p>
            </div>
          </div>

          {/* Categories */}
          <div className="flex gap-3 mb-10 overflow-x-auto pb-4 scrollbar-hide">
            <CategoryItem 
              active={activeTab === 'shop' && selectedCategory === 'todos'} 
              onClick={() => { setActiveTab('shop'); setSelectedCategory('todos'); }}
              icon={<LayoutGrid className="w-4 h-4" />}
              label="Todos"
            />
            <CategoryItem 
              active={activeTab === 'shop' && selectedCategory === 'suplemento'} 
              onClick={() => { setActiveTab('shop'); setSelectedCategory('suplemento'); }}
              icon={<Utensils className="w-4 h-4" />}
              label="Nutrição"
            />
            <CategoryItem 
              active={activeTab === 'shop' && selectedCategory === 'acessorio'} 
              onClick={() => { setActiveTab('shop'); setSelectedCategory('acessorio'); }}
              icon={<Shirt className="w-4 h-4" />}
              label="Equipamentos"
            />
            <CategoryItem 
              active={activeTab === 'shop' && selectedCategory === 'eletronico'} 
              onClick={() => { setActiveTab('shop'); setSelectedCategory('eletronico'); }}
              icon={<Smartphone className="w-4 h-4" />}
              label="Eletrônicos"
            />
            <CategoryItem 
              active={activeTab === 'orders'} 
              onClick={() => setActiveTab('orders')}
              icon={<Ticket className="w-4 h-4" />}
              label={`Meus Cupons (${orders.length})`}
            />
          </div>

          {activeTab === 'shop' ? (
            <div className="mb-14">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-2xl font-bold tracking-tight text-white">Recompensas em Destaque</h3>
                <button className="text-primary text-sm font-bold flex items-center gap-1 hover:underline" style={{ color: 'var(--app-primary-color)' }}>
                  Ver Todos <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              {purchaseSuccess && (
                <div className="mb-6 flex items-center gap-3 rounded-2xl bg-green-500/10 border border-green-500/20 px-4 py-3 text-green-500 animate-slideDown shadow-lg shadow-green-500/5">
                  <QrCode className="w-5 h-5" />
                  <span className="font-bold text-xs uppercase tracking-widest">Resgate realizado com sucesso! Verifique seus cupons.</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {displayProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    userPoints={progression?.points || 0}
                    onPurchase={handlePurchase}
                  />
                ))}
              </div>

              {displayProducts.length === 0 && (
                <div className="text-center py-20 bg-[#161616] rounded-3xl border border-dashed border-white/10">
                  <Package className="w-16 h-16 text-white/5 mx-auto mb-4" />
                  <p className="text-slate-500 font-bold text-xs uppercase tracking-[0.2em] px-4">Novas Recompensas em Breve</p>
                  <p className="text-[10px] text-slate-700 uppercase tracking-widest mt-2">Estamos preparando o melhor portal de loot para você.</p>
                </div>
              )}

              {/* Brand Partners */}
              <div className="mt-20 mb-8">
                <h3 className="text-xl font-bold mb-8 tracking-tight flex items-center gap-3 text-white">
                  <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                  Marcas Parceiras
                </h3>
                <div className="p-10 bg-[#161616] rounded-3xl border border-white/5 flex flex-col items-center justify-center text-center">
                  <div className="flex gap-4 mb-4 opacity-20 grayscale">
                    <div className="w-12 h-12 rounded-xl bg-white/10" />
                    <div className="w-12 h-12 rounded-xl bg-white/10" />
                    <div className="w-12 h-12 rounded-xl bg-white/10" />
                  </div>
                  <span className="text-xs font-bold text-white/30 tracking-[0.3em] uppercase">Parcerias em Breve</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-14">
              <div className="flex items-center gap-3 mb-8">
                <Ticket className="w-6 h-6" style={{ color: 'var(--app-primary-color)' }} />
                <h3 className="text-2xl font-bold tracking-tight text-white">Meus Cupons Ativos</h3>
              </div>
              
              {orders.length === 0 ? (
                <div className="text-center py-20 bg-[#161616] rounded-3xl border border-dashed border-white/10 text-white">
                  <Package className="w-16 h-16 text-white/5 mx-auto mb-4" />
                  <p className="text-slate-500 font-bold text-xs uppercase tracking-widest px-4">Nenhum cupom adquirido ainda. Vá até a loja e use seus pontos!</p>
                  <button
                    onClick={() => setActiveTab('shop')}
                    className="mt-6 px-8 py-3 bg-[#0A0A0A] text-white border border-white/10 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-white/5 transition-colors"
                  >
                    Explorar Recompensas
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {orders.map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppPageShell>
  );
}

function CategoryItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-2 px-6 py-2.5 rounded-full font-bold whitespace-nowrap transition-all border ${
        active 
          ? "bg-primary text-black border-primary shadow-[0_4px_12px_rgba(57,224,121,0.2)]" 
          : "bg-[#161616] border-white/5 text-slate-400 hover:border-white/10 hover:text-white"
      }`}
      style={{ 
        backgroundColor: active ? 'var(--app-primary-color)' : '',
        borderColor: active ? 'var(--app-primary-color)' : ''
      }}
    >
      {icon}
      <span className="text-xs uppercase tracking-wider">{label}</span>
    </button>
  );
}

function ProductCard({
  product,
  userPoints,
  onPurchase,
}: {
  product: ShopProductView;
  userPoints: number;
  onPurchase: (id: number) => void;
}) {
  const canAfford = userPoints >= product.points_cost;

  return (
    <div className="bg-[#161616] border border-white/5 rounded-3xl overflow-hidden group hover:border-primary/20 transition-all flex flex-col shadow-xl">
      <div className="h-48 relative overflow-hidden bg-[#0A0A0A]">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center opacity-20 text-white">
            <ShoppingBag className="w-16 h-16" />
          </div>
        )}
        <div className="absolute top-4 right-4 bg-black/80 backdrop-blur-md px-3 py-1.5 rounded-xl flex items-center gap-1.5 border border-white/10">
          <Coins className="w-3.5 h-3.5" style={{ color: 'var(--app-primary-color)' }} />
          <span className="text-[10px] font-bold text-white">{product.points_cost.toLocaleString()}</span>
        </div>
      </div>
      <div className="p-5 flex flex-col flex-1 text-white">
        <p className="text-[10px] font-bold mb-1 uppercase tracking-[0.2em]" style={{ color: 'var(--app-primary-color)' }}>
          {product.partner_name || "FitLoot Partner"}
        </p>
        <h4 className="font-bold text-lg text-white mb-2 leading-tight group-hover:text-primary transition-colors">{product.name}</h4>
        <p className="text-xs text-slate-500 mb-6 line-clamp-2 leading-relaxed">
          {product.description || "Resgate esta oferta exclusiva e aproveite os benefícios da sua rotina fitness."}
        </p>
        <button
          onClick={() => onPurchase(product.id)}
          disabled={!canAfford}
          className={`mt-auto w-full py-4 rounded-2xl font-bold text-xs uppercase tracking-[0.2em] transition-all active:scale-95 disabled:opacity-50 disabled:grayscale ${
            canAfford ? "neon-glow text-black" : "bg-white/5 text-slate-600 border border-white/5 cursor-not-allowed"
          }`}
          style={{ backgroundColor: canAfford ? 'var(--app-primary-color)' : '' }}
        >
          {canAfford ? "Resgatar Loot" : "Saldo Insuficiente"}
        </button>
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: ShopOrderView }) {
  const isRedeemed = order.is_redeemed === 1;

  return (
    <div className={`relative bg-[#161616] border border-white/5 rounded-3xl flex items-stretch p-2 transition-all ${isRedeemed ? 'opacity-40 grayscale pointer-events-none' : 'hover:border-primary/20 shadow-xl'}`}>
      {/* Ticket QR Section */}
      <div className="w-28 sm:w-32 bg-white rounded-2xl flex flex-col items-center justify-center p-3">
        {order.qr_code ? (
          <div className="w-full aspect-square bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center">
             <QrCode className="w-16 h-16 text-slate-900" />
          </div>
        ) : (
          <div className="w-full aspect-square bg-slate-100 rounded-lg flex items-center justify-center">
            <Package className="w-10 h-10 text-slate-300" />
          </div>
        )}
        <p className="text-[8px] font-mono mt-2 text-slate-900 font-bold tracking-widest">{order.qr_code || 'PENDING'}</p>
      </div>

      {/* Ticket Details */}
      <div className="flex-1 p-4 sm:p-6 flex flex-col justify-center border-l border-dashed border-white/10 ml-2">
        <div className="flex justify-between items-start text-white">
          <div className="flex-1">
            <h4 className="font-bold text-base sm:text-lg leading-tight text-white">{order.product_name}</h4>
            <p className="text-[10px] font-bold mt-1 uppercase tracking-widest" style={{ color: 'var(--app-primary-color)' }}>
              {isRedeemed ? 'Resgatado em ' + (order.created_at ? new Date(order.created_at).toLocaleDateString('pt-BR') : '-') : 'Disponível para Resgate'}
            </p>
          </div>
          <span className={`text-[9px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${isRedeemed ? 'bg-white/5 text-slate-500' : 'bg-primary/20 text-primary'}`} style={{ backgroundColor: isRedeemed ? '' : 'color-mix(in srgb, var(--app-primary-color) 20%, transparent)', color: isRedeemed ? '' : 'var(--app-primary-color)' }}>
            {isRedeemed ? 'USADO' : 'ATIVO'}
          </span>
        </div>
        
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none">
            <Coins className="w-3 h-3" />
            {order.points_spent || 0} PTS UTILIZADOS
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none">
            <Ticket className="w-3 h-3" />
            VÁLIDO EM TODOS OS PARCEIROS
          </div>
        </div>
      </div>
    </div>
  );
}
