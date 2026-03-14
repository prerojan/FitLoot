import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/contexts/auth";
import AppPageShell from "@/react-app/components/AppPageShell";
import LoadingBall from "@/react-app/components/LoadingBall";
import { ShoppingBag, Coins, QrCode, Package } from "lucide-react";
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
        className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50"
      >
        <div className="fl-app-container py-6 sm:py-10">
          <div className="fl-card p-6 flex items-center justify-center">
            <LoadingBall size="md" />
          </div>
        </div>
      </AppPageShell>
    );
  }

  if (error) {
    return (
      <AppPageShell
        bottomNavActive="shop"
        progression={progression}
        className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50"
      >
        <div className="fl-app-container py-10 text-center sm:py-12">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={() => { setLoading(true); void loadData(); }} className="fl-btn-primary rounded-xl px-4 py-2">
            Tentar novamente
          </button>
        </div>
      </AppPageShell>
    );
  }

  const categories = ["todos", "suplemento", "alimentacao", "acessorio"];
  const filteredProducts = selectedCategory === "todos"
    ? products
    : products.filter(p => p.category === selectedCategory);

  return (
    <AppPageShell
      bottomNavActive="shop"
      progression={progression}
      className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50"
    >
      <section className="fl-app-container py-4 sm:py-6">
        <div className="rounded-[1.75rem] bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-5 text-white shadow-xl sm:rounded-[2rem] sm:px-6 sm:py-6">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="fl-title-page mb-1 text-white">Loja FitLoot</h1>
              <p className="text-sm text-emerald-100 sm:text-base">Troque pontos por recompensas reais</p>
            </div>
            <div className="text-left sm:text-right">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 backdrop-blur-sm">
                <Coins className="w-5 h-5" />
                <span className="text-xl font-bold sm:text-2xl">{progression?.points?.toLocaleString() || 0}</span>
              </div>
              <p className="mt-1 text-xs text-emerald-100">pontos disponíveis</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => setActiveTab('shop')}
              className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold transition-all ${
                activeTab === 'shop'
                  ? "bg-white text-emerald-600"
                  : "bg-white/20 backdrop-blur-sm text-white"
              }`}
            >
              <ShoppingBag className="w-5 h-5" />
              Produtos
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 font-semibold transition-all ${
                activeTab === 'orders'
                  ? "bg-white text-emerald-600"
                  : "bg-white/20 backdrop-blur-sm text-white"
              }`}
            >
              <Package className="w-5 h-5" />
              Meus Cupons ({orders.length})
            </button>
          </div>
        </div>
      </section>

      {purchaseSuccess && (
        <div className="fl-app-container mt-1">
          <div className="flex items-center gap-2 rounded-2xl bg-green-500 px-4 py-3 text-white shadow-lg animate-slideDown">
            <QrCode className="w-5 h-5" />
            <span className="font-medium">Compra realizada com sucesso!</span>
          </div>
        </div>
      )}

      {activeTab === 'shop' && (
        <section className="fl-app-container py-4 sm:py-6">
          <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`min-h-11 whitespace-nowrap rounded-full px-4 py-2 font-medium transition-all ${
                  selectedCategory === cat
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md"
                    : "bg-white/80 text-gray-700 hover:bg-white"
                }`}
              >
                {cat === "todos" ? "Todos" : cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                userPoints={progression?.points || 0}
                onPurchase={handlePurchase}
              />
            ))}
          </div>
        </section>
      )}

      {activeTab === 'orders' && (
        <section className="fl-app-container space-y-4 py-4 sm:py-6">
          {orders.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">Nenhum cupom adquirido ainda</p>
              <button
                onClick={() => setActiveTab('shop')}
                className="mt-4 px-6 py-2 bg-emerald-500 text-white rounded-full font-medium hover:bg-emerald-600 transition-colors"
              >
                Ir para a Loja
              </button>
            </div>
          ) : (
            orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))
          )}
        </section>
      )}
    </AppPageShell>
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
    <div className="overflow-hidden rounded-3xl bg-white/80 shadow-lg transition-all hover:-translate-y-1 hover:shadow-xl">
      <div className="aspect-video bg-gradient-to-br from-emerald-100 to-teal-100 relative overflow-hidden">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <ShoppingBag className="w-16 h-16 text-emerald-300" />
          </div>
        )}
      </div>

      <div className="p-4 sm:p-5">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="flex-1">
            <h3 className="font-bold text-gray-900 mb-1">{product.name}</h3>
            {product.partner_name && (
              <p className="text-xs text-gray-500">{product.partner_name}</p>
            )}
          </div>
        </div>

        {product.description && (
          <p className="text-sm text-gray-600 mb-3 line-clamp-2">{product.description}</p>
        )}

        <div className="flex flex-col gap-3 border-t border-gray-200 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1 text-lg font-bold text-emerald-600">
            <Coins className="w-5 h-5" />
            <span>{product.points_cost.toLocaleString()}</span>
          </div>

          <button
            onClick={() => onPurchase(product.id)}
            disabled={!canAfford}
            className={`min-h-11 rounded-xl px-4 py-2 font-semibold transition-all sm:min-w-[124px] ${
              canAfford
                ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:shadow-lg hover:scale-105"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            {canAfford ? "Resgatar" : "Sem pontos"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: ShopOrderView }) {
  const isRedeemed = order.is_redeemed === 1;

  return (
    <div className="rounded-3xl bg-white/80 p-4 shadow-lg sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100">
          {order.image_url ? (
            <img
              src={order.image_url}
              alt={order.product_name}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Package className="w-8 h-8 text-emerald-500" />
            </div>
          )}
        </div>

        <div className="flex-1">
          <h3 className="font-bold text-gray-900 mb-1">{order.product_name}</h3>
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <Coins className="w-4 h-4" />
            <span>{order.points_spent ?? 0} pontos</span>
          </div>
          <p className="text-xs text-gray-500">
            {order.created_at ? new Date(order.created_at).toLocaleDateString('pt-BR') : '-'}
          </p>
        </div>

        <div className="flex flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-between">
          {isRedeemed ? (
            <span className="px-3 py-1 bg-gray-200 text-gray-600 rounded-full text-xs font-medium">
              Usado
            </span>
          ) : (
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
              Disponível
            </span>
          )}
          <button className="text-emerald-600 hover:text-emerald-700 transition-colors">
            <QrCode className="w-8 h-8" />
          </button>
        </div>
      </div>

      {!isRedeemed && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="bg-emerald-50 rounded-2xl p-4">
            <p className="text-xs text-gray-600 mb-2 text-center">Código do Cupom:</p>
            <p className="text-center font-mono font-bold text-emerald-700 text-lg tracking-wider">
              {order.qr_code}
            </p>
            <p className="text-xs text-gray-500 text-center mt-2">
              Mostre este código ao parceiro para resgatar
            </p>
          </div>
        </div>
      )}
    </div>
  );
}


