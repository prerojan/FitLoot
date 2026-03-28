import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/auth/context";
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
        className="fl-theme-page"
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
        className="fl-theme-page"
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
      className="fl-theme-page"
    >
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
        {/* Inner Header (Search + Points) */}
        <header className="sticky top-0 z-10 flex h-20 items-center justify-between border-b px-4 backdrop-blur-xl sm:px-6" style={{ borderColor: "var(--fl-border-soft)", backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 82%, transparent)" }}>
          <div className="flex-1 max-w-xl">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 transition-colors" style={{ color: searchQuery ? 'var(--app-primary-color)' : 'var(--fl-color-text-muted)' }} />
              <input 
                type="text"
                placeholder="Buscar recompensas, marcas ou equipamentos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="fl-theme-input w-full rounded-xl py-2.5 pl-12 pr-4 text-sm transition-all focus:outline-none focus:ring-1 focus:ring-primary"
                style={{ borderColor: searchQuery ? 'rgba(var(--app-primary-color-rgb), 0.3)' : '' }}
              />
            </div>
          </div>
          <div className="flex items-center gap-4 ml-6">
            <div className="fl-theme-surface hidden sm:flex items-center gap-2 rounded-xl px-4 py-2 shadow-inner">
              <Coins className="w-5 h-5" style={{ color: 'var(--app-primary-color)' }} />
              <span className="font-bold tracking-tight" style={{ color: "var(--fl-color-text)" }}>{progression?.points?.toLocaleString() || 0} <span className="ml-1 text-[10px] uppercase" style={{ color: "var(--fl-color-text-muted)" }}>Pts</span></span>
            </div>
            <button className="fl-theme-surface-soft w-10 h-10 flex items-center justify-center rounded-full fl-theme-text-muted hover:text-primary transition-colors">
              <ShoppingCart className="w-5 h-5" />
            </button>
            <button className="fl-theme-surface-soft w-10 h-10 flex items-center justify-center rounded-full fl-theme-text-muted hover:text-primary transition-colors">
              <Bell className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Shop Body */}
        <div className="custom-scrollbar flex-1 overflow-y-auto p-4 pb-[98px] sm:p-6 lg:p-8 min-w-0">
          {/* Hero Promo */}
          <div className="group relative mb-6 sm:mb-8 h-44 sm:h-64 w-full overflow-hidden rounded-[1.5rem] sm:rounded-3xl border min-w-0" style={{ borderColor: "var(--fl-border-soft)" }}>
            <div className="absolute inset-0 bg-gradient-to-r from-black via-black/50 to-transparent z-10"></div>
            <img 
              src="https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&q=80" 
              alt="Promo"
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
            />
            <div className="relative z-20 h-full flex flex-col justify-center px-6 sm:px-10 min-w-0">
              <span className="mb-2 sm:mb-3 w-fit rounded-full bg-primary px-2 py-0.5 sm:px-3 sm:py-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: 'var(--app-primary-color)', color: 'var(--fl-nav-item-active-text)' }}>Tempo Limitado</span>
              <h2 className="mb-1 sm:mb-2 text-xl sm:text-4xl font-bold tracking-tight text-white truncate text-wrap">Summer Fitness Drop</h2>
              <p className="max-w-xs sm:max-w-sm text-[10px] sm:text-sm font-medium text-white/80 line-clamp-2">Ganhe 20% de desconto em equipamentos selecionados até 31 de outubro.</p>
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
              <div className="flex items-center justify-between mb-4 sm:mb-8 min-w-0">
                <h3 className="text-xl sm:text-2xl font-bold tracking-tight truncate" style={{ color: "var(--fl-color-text)" }}>Recompensas em Destaque</h3>
                <button className="text-primary text-[10px] sm:text-sm font-bold flex items-center gap-1 hover:underline shrink-0" style={{ color: 'var(--app-primary-color)' }}>
                  Ver Todos <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4" />
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
                <div className="fl-theme-surface rounded-3xl border border-dashed py-20 text-center" style={{ borderColor: "var(--fl-border-soft)" }}>
                  <Package className="mx-auto mb-4 h-16 w-16 fl-theme-text-soft" />
                  <p className="px-4 text-xs font-bold uppercase tracking-[0.2em]" style={{ color: "var(--fl-color-text-muted)" }}>Novas Recompensas em Breve</p>
                  <p className="mt-2 text-[10px] uppercase tracking-widest" style={{ color: "var(--fl-color-text-muted)" }}>Estamos preparando o melhor portal de loot para você.</p>
                </div>
              )}

              {/* Brand Partners */}
              <div className="mt-20 mb-8">
                <h3 className="mb-8 flex items-center gap-3 text-xl font-bold tracking-tight" style={{ color: "var(--fl-color-text)" }}>
                  <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                  Marcas Parceiras
                </h3>
                <div className="fl-theme-surface p-10 rounded-3xl flex flex-col items-center justify-center text-center">
                  <div className="flex gap-4 mb-4 opacity-20 grayscale">
                    <div className="h-12 w-12 rounded-xl" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 84%, transparent)" }} />
                    <div className="h-12 w-12 rounded-xl" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 84%, transparent)" }} />
                    <div className="h-12 w-12 rounded-xl" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 84%, transparent)" }} />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: "var(--fl-color-text-soft)" }}>Parcerias em breve</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-14">
              <div className="flex items-center gap-3 mb-8">
                <Ticket className="w-6 h-6" style={{ color: 'var(--app-primary-color)' }} />
                <h3 className="text-2xl font-bold tracking-tight" style={{ color: "var(--fl-color-text)" }}>Meus Cupons Ativos</h3>
              </div>
              
              {orders.length === 0 ? (
                <div className="fl-theme-surface rounded-3xl border border-dashed py-20 text-center" style={{ borderColor: "var(--fl-border-soft)" }}>
                  <Package className="mx-auto mb-4 h-16 w-16 fl-theme-text-soft" />
                  <p className="px-4 text-xs font-bold uppercase tracking-widest" style={{ color: "var(--fl-color-text-muted)" }}>Nenhum cupom adquirido ainda. Vá até a loja e use seus pontos!</p>
                  <button
                    onClick={() => setActiveTab('shop')}
                    className="fl-theme-surface-soft mt-6 rounded-full border px-8 py-3 text-xs font-bold uppercase tracking-widest transition-opacity hover:opacity-85"
                    style={{ borderColor: "var(--fl-border-soft)", color: "var(--fl-color-text)" }}
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
      className={`flex items-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-2 sm:py-2.5 rounded-full font-bold whitespace-nowrap transition-all border ${
        active 
          ? "bg-primary border-primary shadow-[0_4px_12px_rgba(57,224,121,0.2)]" 
          : "fl-theme-surface fl-theme-text-muted hover:opacity-85"
      }`}
      style={{ 
        backgroundColor: active ? 'var(--app-primary-color)' : '',
        borderColor: active ? 'var(--app-primary-color)' : '',
        color: active ? 'var(--fl-nav-item-active-text)' : undefined,
      }}
    >
      {icon}
      <span className="text-[10px] sm:text-xs uppercase tracking-wider">{label}</span>
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
    <div className="fl-theme-surface rounded-[1.5rem] sm:rounded-3xl overflow-hidden group hover:border-primary/20 transition-all flex flex-col shadow-xl min-w-0">
      <div className="h-48 relative overflow-hidden" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 70%, transparent)" }}>
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center opacity-20" style={{ color: "var(--fl-color-text)" }}>
            <ShoppingBag className="w-16 h-16" />
          </div>
        )}
        <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-xl border px-3 py-1.5 backdrop-blur-md" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 84%, transparent)", borderColor: "var(--fl-border-soft)" }}>
          <Coins className="w-3.5 h-3.5" style={{ color: 'var(--app-primary-color)' }} />
          <span className="text-[10px] font-bold" style={{ color: "var(--fl-color-text)" }}>{product.points_cost.toLocaleString()}</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4 sm:p-5 min-w-0" style={{ color: "var(--fl-color-text)" }}>
        <p className="text-[9px] sm:text-[10px] font-bold mb-1 uppercase tracking-[0.1em] sm:tracking-[0.2em] truncate" style={{ color: 'var(--app-primary-color)' }}>
          {product.partner_name || "FitLoot Partner"}
        </p>
        <h4 className="mb-2 text-base sm:text-lg font-bold leading-tight transition-colors group-hover:opacity-85 truncate text-wrap">{product.name}</h4>
        <p className="mb-4 sm:mb-6 line-clamp-2 text-[10px] sm:text-xs leading-relaxed" style={{ color: "var(--fl-color-text-muted)" }}>
          {product.description || "Resgate esta oferta exclusiva e aproveite os benefícios da sua rotina fitness."}
        </p>
        <button
          onClick={() => onPurchase(product.id)}
          disabled={!canAfford}
          className={`mt-auto w-full py-3 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-[10px] sm:text-xs uppercase tracking-[0.1em] sm:tracking-[0.2em] transition-all active:scale-95 disabled:opacity-50 disabled:grayscale ${
            canAfford ? "neon-glow" : "cursor-not-allowed border"
          }`}
          style={{
            backgroundColor: canAfford
              ? 'var(--app-primary-color)'
              : 'color-mix(in srgb, var(--fl-surface-muted) 84%, transparent)',
            color: canAfford ? 'var(--fl-nav-item-active-text)' : 'var(--fl-color-text-muted)',
            borderColor: canAfford ? 'transparent' : 'var(--fl-border-soft)',
          }}
        >
          {canAfford ? "Resgatar Loot" : "Saldo"}
        </button>
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: ShopOrderView }) {
  const isRedeemed = order.is_redeemed === 1;

  return (
    <div className={`fl-theme-surface relative rounded-3xl flex items-stretch p-2 transition-all ${isRedeemed ? 'opacity-40 grayscale pointer-events-none' : 'hover:border-primary/20 shadow-xl'}`}>
      {/* Ticket QR Section */}
      <div className="flex w-28 flex-col items-center justify-center rounded-2xl p-3 sm:w-32" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-strong) 98%, transparent)", border: "1px solid var(--fl-border-soft)" }}>
        {order.qr_code ? (
          <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 92%, transparent)" }}>
             <QrCode className="w-16 h-16" style={{ color: "var(--fl-color-text)" }} />
          </div>
        ) : (
          <div className="flex aspect-square w-full items-center justify-center rounded-lg" style={{ backgroundColor: "color-mix(in srgb, var(--fl-surface-muted) 92%, transparent)" }}>
            <Package className="w-10 h-10" style={{ color: "var(--fl-color-text-soft)" }} />
          </div>
        )}
        <p className="mt-2 text-[8px] font-mono font-bold tracking-widest" style={{ color: "var(--fl-color-text)" }}>{order.qr_code || 'PENDING'}</p>
      </div>

      {/* Ticket Details */}
      <div className="ml-2 flex flex-1 flex-col justify-center border-l border-dashed p-4 sm:p-6" style={{ borderColor: "var(--fl-border-soft)" }}>
        <div className="flex items-start justify-between" style={{ color: "var(--fl-color-text)" }}>
          <div className="flex-1">
            <h4 className="text-base font-bold leading-tight sm:text-lg">{order.product_name}</h4>
            <p className="text-[10px] font-bold mt-1 uppercase tracking-widest" style={{ color: 'var(--app-primary-color)' }}>
              {isRedeemed ? 'Resgatado em ' + (order.created_at ? new Date(order.created_at).toLocaleDateString('pt-BR') : '-') : 'Disponível para Resgate'}
            </p>
          </div>
          <span className="rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider" style={{ backgroundColor: isRedeemed ? 'color-mix(in srgb, var(--fl-surface-muted) 82%, transparent)' : 'color-mix(in srgb, var(--app-primary-color) 20%, transparent)', color: isRedeemed ? 'var(--fl-color-text-muted)' : 'var(--app-primary-color)' }}>
            {isRedeemed ? 'USADO' : 'ATIVO'}
          </span>
        </div>
        
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase leading-none tracking-widest" style={{ color: "var(--fl-color-text-muted)" }}>
            <Coins className="w-3 h-3" />
            {order.points_spent || 0} PTS UTILIZADOS
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase leading-none tracking-widest" style={{ color: "var(--fl-color-text-muted)" }}>
            <Ticket className="w-3 h-3" />
            VÁLIDO EM TODOS OS PARCEIROS
          </div>
        </div>
      </div>
    </div>
  );
}
