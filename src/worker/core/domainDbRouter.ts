export type DatabaseDomain =
  | "runtime"
  | "core"
  | "social"
  | "catalog"
  | "billing"
  | "missions"
  | "gameplay"
  | "telemetry"
  | "unknown";

export type RoutedDbTarget = "runtime" | "supabase_read" | "supabase_write";

export type DomainRouteDecision = {
  domain: DatabaseDomain;
  target: RoutedDbTarget;
  readOnly: boolean;
  tables: string[];
};

type DomainDbRouterOptions = {
  enableReadPath: boolean;
};

const TABLE_DOMAIN_MAP: Readonly<Record<string, DatabaseDomain>> = {
  users: "core",
  sessions: "core",
  user_sessions: "core",
  magic_link_tokens: "core",
  user_profiles: "core",
  user_attributes: "core",
  user_progression: "core",
  user_training_plans: "core",

  missions: "missions",
  mission_subtasks: "missions",
  mission_generation_jobs: "missions",

  skills: "catalog",
  skill_stages: "catalog",
  titles: "catalog",
  achievements: "catalog",
  promo_codes: "catalog",
  shop_partners: "catalog",
  shop_products: "catalog",

  user_skills: "gameplay",
  user_achievements: "gameplay",
  user_titles: "gameplay",
  user_event_counters: "gameplay",
  user_event_log: "gameplay",
  user_goal_stats: "gameplay",
  user_monthly_counters: "gameplay",
  user_reward_notifications: "gameplay",
  mini_games: "gameplay",
  coupon_orders: "gameplay",

  subscriptions: "billing",
  promo_code_usages: "billing",
  cakto_webhook_events: "billing",

  friendships: "social",
  friend_requests: "social",
  user_presence: "social",
  friend_activity_events: "social",
  friend_online_presence: "social",

  daily_metrics: "telemetry",
  food_diary: "telemetry",
  progress_snapshots: "telemetry",
  physical_benchmarks: "telemetry",
  app_state: "telemetry",
};

const RUNTIME_TABLES = new Set<string>([
  "runtime_friend_snapshots",
  "runtime_dashboard_projection",
  "runtime_profile_projection",
  "runtime_bootstrap_projection",
]);

function stripCommentsPrefix(sql: string): string {
  return sql
    .replace(/^\s*--.*$/gmu, "")
    .replace(/^\s*\/\*[\s\S]*?\*\//u, "")
    .trim();
}

function normalizeSqlIdentifier(value: string): string {
  const trimmed = value
    .trim()
    .replace(/[),;]+$/gu, "")
    .replace(/^["'`]+|["'`]+$/gu, "")
    .toLowerCase();

  if (!trimmed) return "";

  const dotParts = trimmed.split(".");
  const tableName = dotParts[dotParts.length - 1] ?? "";
  return tableName.replace(/^["'`]+|["'`]+$/gu, "").trim();
}

function extractSqlTableNames(sql: string): string[] {
  const patterns = [
    /\bfrom\s+([^\s,()]+)/giu,
    /\bjoin\s+([^\s,()]+)/giu,
    /\bupdate\s+([^\s,()]+)/giu,
    /\binsert\s+into\s+([^\s,()]+)/giu,
    /\bdelete\s+from\s+([^\s,()]+)/giu,
    /\btruncate\s+(?:table\s+)?([^\s,()]+)/giu,
  ];

  const tables = new Set<string>();
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    do {
      match = pattern.exec(sql);
      if (!match?.[1]) continue;
      const normalized = normalizeSqlIdentifier(match[1]);
      if (normalized) {
        tables.add(normalized);
      }
    } while (match);
  }

  return Array.from(tables);
}

export function isReadOnlySql(sql: string): boolean {
  const normalized = stripCommentsPrefix(sql).toLowerCase();
  if (!normalized) return true;

  if (/^(select|show|explain|pragma)\b/u.test(normalized)) return true;
  if (/^with\b/u.test(normalized)) {
    return !/\b(insert|update|delete|merge|create|alter|drop|truncate)\b/u.test(
      normalized,
    );
  }

  return false;
}

function tableDomain(table: string): DatabaseDomain {
  if (table.startsWith("runtime_") || RUNTIME_TABLES.has(table)) {
    return "runtime";
  }
  return TABLE_DOMAIN_MAP[table] ?? "unknown";
}

function resolveDomainFromTables(tables: string[]): DatabaseDomain {
  if (tables.length === 0) return "unknown";

  const domains = new Set<DatabaseDomain>(tables.map(tableDomain));
  if (domains.size === 1) {
    return domains.values().next().value ?? "unknown";
  }

  if (domains.has("runtime")) {
    return "unknown";
  }

  const firstNonUnknown = Array.from(domains).find((domain) => domain !== "unknown");
  return firstNonUnknown ?? "unknown";
}

export class DomainDbRouter {
  private readonly enableReadPath: boolean;

  constructor(options: DomainDbRouterOptions) {
    this.enableReadPath = options.enableReadPath;
  }

  resolve(
    sql: string,
    options: {
      inTransaction: boolean;
    },
  ): DomainRouteDecision {
    const readOnly = isReadOnlySql(sql);
    const tables = extractSqlTableNames(sql);
    const domain = resolveDomainFromTables(tables);

    if (options.inTransaction) {
      return {
        domain,
        target: "supabase_write",
        readOnly,
        tables,
      };
    }

    if (domain === "runtime") {
      return {
        domain,
        target: "runtime",
        readOnly,
        tables,
      };
    }

    if (readOnly && this.enableReadPath) {
      return {
        domain,
        target: "supabase_read",
        readOnly,
        tables,
      };
    }

    return {
      domain,
      target: "supabase_write",
      readOnly,
      tables,
    };
  }
}

