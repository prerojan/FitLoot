import { Hono, type MiddlewareHandler } from "hono";

import { getErrorMessage } from "../core/errors";
import type { AppContext } from "../core/types";
import type { WithTransaction } from "./contracts";

type StreamJsonArrayResponse = (
  items: readonly unknown[],
  status?: number,
) => Response;

type ShopRouteDeps = {
  authMiddleware: MiddlewareHandler<AppContext>;
  invalidateRankingCache: () => void;
  streamJsonArrayResponse: StreamJsonArrayResponse;
  withTransaction: WithTransaction;
};

const SHOP_PRODUCTS_CACHE_TTL_MS = 2 * 60_000;
let shopProductsCacheEntry:
  | { payload: Record<string, unknown>[]; expiresAt: number }
  | null = null;

// Reaproveita a vitrine quando a consulta ainda está dentro da janela curta de cache.
function readShopProductsCache(): Record<string, unknown>[] | null {
  if (!shopProductsCacheEntry) return null;
  if (shopProductsCacheEntry.expiresAt <= Date.now()) {
    shopProductsCacheEntry = null;
    return null;
  }
  return shopProductsCacheEntry.payload;
}

// Atualiza o snapshot em memória usado pela listagem principal da loja.
function writeShopProductsCache(payload: Record<string, unknown>[]): void {
  shopProductsCacheEntry = {
    payload,
    expiresAt: Date.now() + SHOP_PRODUCTS_CACHE_TTL_MS,
  };
}

// Invalida o cache sempre que uma compra pode mudar disponibilidade ou ranking.
function invalidateShopProductsCache(): void {
  shopProductsCacheEntry = null;
}

// Registra as rotas da loja de recompensas e dos pedidos de cupons.
export function registerShopRoutes(
  app: Hono<AppContext>,
  {
    authMiddleware,
    invalidateRankingCache,
    streamJsonArrayResponse,
    withTransaction,
  }: ShopRouteDeps,
): void {
  // Lista os produtos disponíveis, priorizando o cache da vitrine quando possível.
  app.get("/api/shop/products", authMiddleware, async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 200), 1), 500);
    const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

    const cachedProducts = readShopProductsCache();
    if (cachedProducts && offset === 0 && limit >= cachedProducts.length) {
      return streamJsonArrayResponse(cachedProducts);
    }

    const products = await c.env.fitloot_db
      .prepare(
        `SELECT p.*, sp.name as partner_name, sp.logo_url as partner_logo
        FROM shop_products p
        INNER JOIN shop_partners sp ON p.partner_id = sp.id
        WHERE p.is_available = 1
        ORDER BY p.category, p.points_cost
        LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset)
      .all<Record<string, unknown>>();

    const payload = Array.isArray(products.results) ? products.results : [];
    if (offset === 0) {
      writeShopProductsCache(payload);
    }

    return streamJsonArrayResponse(payload);
  });

  // Processa a compra e reaproveita pedidos idempotentes com o mesmo request_id.
  app.post("/api/shop/purchase/:id", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const productId = parseInt(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as {
      request_id?: string | undefined;
    };
    const requestId =
      typeof body.request_id === "string" ? body.request_id.trim() : "";

    if (requestId) {
      const existingOrder = await c.env.fitloot_db
        .prepare(
          "SELECT qr_code FROM coupon_orders WHERE user_id = ? AND request_id = ? LIMIT 1",
        )
        .bind(user.id, requestId)
        .first<{ qr_code: string }>();
      if (existingOrder?.qr_code) {
        return c.json({
          success: true,
          qr_code: existingOrder.qr_code,
          reused: true,
        });
      }
    }

    const product = await c.env.fitloot_db
      .prepare("SELECT * FROM shop_products WHERE id = ? AND is_available = 1")
      .bind(productId)
      .first();

    if (!product) {
      return c.json({ error: "Product not found" }, 404);
    }

    const progression = await c.env.fitloot_db
      .prepare("SELECT points FROM user_progression WHERE user_id = ?")
      .bind(user.id)
      .first();

    if (Number(progression?.points || 0) < Number(product.points_cost || 0)) {
      return c.json({ error: "Insufficient points" }, 400);
    }

    const qrCode = `FITLOOT-${crypto.randomUUID()}`;

    try {
      await withTransaction(c.env.fitloot_db, async () => {
        const deduction = await c.env.fitloot_db
          .prepare(
            "UPDATE user_progression SET points = points - ?, updated_at = datetime('now') WHERE user_id = ? AND points >= ?",
          )
          .bind(product.points_cost, user.id, product.points_cost)
          .run();
        if (Number(deduction.meta?.changes ?? 0) === 0) {
          throw new Error("INSUFFICIENT_POINTS");
        }

        await c.env.fitloot_db
          .prepare(
            `INSERT INTO coupon_orders (user_id, product_id, points_spent, qr_code, request_id, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          )
          .bind(user.id, productId, product.points_cost, qrCode, requestId || null)
          .run();
      }, c.env);
    } catch (error) {
      const message = getErrorMessage(error).toLowerCase();
      if (message.includes("insufficient_points")) {
        return c.json({ error: "Insufficient points" }, 400);
      }
      if (
        requestId &&
        message.includes("unique") &&
        message.includes("coupon_orders.request_id")
      ) {
        const existingOrder = await c.env.fitloot_db
          .prepare(
            "SELECT qr_code FROM coupon_orders WHERE user_id = ? AND request_id = ? LIMIT 1",
          )
          .bind(user.id, requestId)
          .first<{ qr_code: string }>();
        if (existingOrder?.qr_code) {
          return c.json({
            success: true,
            qr_code: existingOrder.qr_code,
            reused: true,
          });
        }
      }
      throw error;
    }

    invalidateRankingCache();
    invalidateShopProductsCache();

    return c.json({ success: true, qr_code: qrCode });
  });

  // Retorna o histórico paginado de pedidos já emitidos para o usuário.
  app.get("/api/shop/orders", authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 80), 1), 200);
    const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

    const orders = await c.env.fitloot_db
      .prepare(
        `SELECT co.*, p.name as product_name, p.image_url
        FROM coupon_orders co
        INNER JOIN shop_products p ON co.product_id = p.id
        WHERE co.user_id = ?
        ORDER BY co.created_at DESC
        LIMIT ? OFFSET ?`,
      )
      .bind(user.id, limit, offset)
      .all();

    return c.json(orders.results);
  });
}
