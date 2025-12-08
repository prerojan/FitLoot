import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/react-app/App";
import BottomNav from "@/react-app/components/BottomNav";
import { ShoppingBag, Coins, QrCode, Package } from "lucide-react";
import type { UserProgression } from "@/shared/types";
import { api } from "@/react-app/utils/api";

export default function Shop() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [progression, setProgression] = useState<UserProgression | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("todos");
  const [activeTab, setActiveTab] = useState<'shop' | 'orders'>('shop');
  const [loading, setLoading] = useState(true);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate("/app");
      return;
    }
    loadData();
  }, [user, navigate]);

  const loadData = async () => {
    try {
      const [productsRes, ordersRes, progressionRes] = await Promise.all([
        api("/api/shop/products"),
        api("/api/shop/orders"),
        api("/api/progression"),
      ]);

      setProducts(await productsRes.json());
      setOrders(await ordersRes.json());
      setProgression(await progressionRes.json());
    } catch (error) {
      console.error("Error loading shop data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async (productId: number) => {
    try {
      const response = await api(`/api/shop/purchase/${productId}`, {
        method: "POST",
      });

      if (response.ok) {
        setPurchaseSuccess(true);
        setTimeout(() => setPurchaseSuccess(false), 3000);
        await loadData();
        setActiveTab('orders');
      } else {
        const data = await response.json();
        alert(data.error || "Erro ao realizar compra");
      }
    } catch (error) {
      console.error("Error purchasing:", error);
      alert("Erro ao conectar com o servidor");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center">
        <div className="text-emerald-600">Carregando...</div>
      </div>
    );
  }

  const categories = ["todos", "suplemento", "alimentacao", "acessorio"];
  const filteredProducts = selectedCategory === "todos"
    ? products
    : products.filter(p => p.category === selectedCategory);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-6 pt-8 pb-6 rounded-b-3xl shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-1">Loja FitLoot</h1>
            <p className="text-emerald-100">Troque pontos por recompensas reais</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2">
              <Coins className="w-5 h-5" />
              <span className="text-2xl font-bold">{progression?.points?.toLocaleString() || 0}</span>
            </div>
            <p className="text-xs text-emerald-100 mt-1">pontos disponíveis</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('shop')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all ${
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
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all ${
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

      {purchaseSuccess && (
        <div className="mx-6 mt-4 bg-green-500 text-white px-4 py-3 rounded-2xl shadow-lg flex items-center gap-2 animate-slideDown">
          <QrCode className="w-5 h-5" />
          <span className="font-medium">Compra realizada com sucesso!</span>
        </div>
      )}

      {/* Content */}
      {activeTab === 'shop' && (
        <div className="px-6 py-6">
          {/* Category Filter */}
          <div className="flex gap-2 overflow-x-auto pb-4 mb-6">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-full font-medium whitespace-nowrap transition-all ${
                  selectedCategory === cat
                    ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md"
                    : "bg-white/80 text-gray-700 hover:bg-white"
                }`}
              >
                {cat === "todos" ? "Todos" : cat.charAt(0).toUpperCase() + cat.slice(1)}
              </button>
            ))}
          </div>

          {/* Products Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                userPoints={progression?.points || 0}
                onPurchase={handlePurchase}
              />
            ))}
          </div>
        </div>
      )}

      {activeTab === 'orders' && (
        <div className="px-6 py-6 space-y-4">
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
        </div>
      )}

      <BottomNav active="shop" />
    </div>
  );
}

function ProductCard({
  product,
  userPoints,
  onPurchase,
}: {
  product: any;
  userPoints: number;
  onPurchase: (id: number) => void;
}) {
  const canAfford = userPoints >= product.points_cost;

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-lg overflow-hidden hover:shadow-xl transition-all hover:-translate-y-1">
      <div className="aspect-video bg-gradient-to-br from-emerald-100 to-teal-100 relative overflow-hidden">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <ShoppingBag className="w-16 h-16 text-emerald-300" />
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
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

        <div className="flex items-center justify-between pt-3 border-t border-gray-200">
          <div className="flex items-center gap-1 text-emerald-600 font-bold text-lg">
            <Coins className="w-5 h-5" />
            <span>{product.points_cost.toLocaleString()}</span>
          </div>

          <button
            onClick={() => onPurchase(product.id)}
            disabled={!canAfford}
            className={`px-4 py-2 rounded-xl font-semibold transition-all ${
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

function OrderCard({ order }: { order: any }) {
  const isRedeemed = order.is_redeemed === 1;

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-3xl p-5 shadow-lg">
      <div className="flex gap-4">
        <div className="w-20 h-20 bg-gradient-to-br from-emerald-100 to-teal-100 rounded-2xl flex-shrink-0 overflow-hidden">
          {order.image_url ? (
            <img src={order.image_url} alt={order.product_name} className="w-full h-full object-cover" />
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
            <span>{order.points_spent} pontos</span>
          </div>
          <p className="text-xs text-gray-500">
            {new Date(order.created_at).toLocaleDateString('pt-BR')}
          </p>
        </div>

        <div className="flex flex-col items-end justify-between">
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
