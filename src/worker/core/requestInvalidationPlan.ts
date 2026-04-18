export type RuntimeProjectionScope =
  | "bootstrap"
  | "profile"
  | `dashboard:${string}`;

export type RequestInvalidationPlan = {
  hotCachePaths: "all" | readonly string[];
  runtimeProjectionScopes: "all" | readonly RuntimeProjectionScope[];
};

const NO_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: [],
  runtimeProjectionScopes: [],
};

const ALL_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: "all",
  runtimeProjectionScopes: "all",
};

const APP_OPEN_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: [
    "/api/reward-notifications/pending",
    "/api/achievements",
    "/api/titles",
  ],
  runtimeProjectionScopes: [],
};

const METRICS_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: ["/api/metrics/today"],
  runtimeProjectionScopes: [],
};

const FOOD_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: ["/api/food/today"],
  runtimeProjectionScopes: [],
};

const PROFILE_GOAL_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: ["/api/missions", "/api/ai/recommendations"],
  runtimeProjectionScopes: [],
};

const MISSIONS_GENERATION_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: ["/api/missions"],
  runtimeProjectionScopes: [],
};

const BENCHMARKS_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: [
    "/api/benchmarks",
    "/api/progression",
    "/api/app/bootstrap",
    "/api/ranking/global",
    "/api/ranking/friends",
  ],
  runtimeProjectionScopes: ["bootstrap", "dashboard:progression", "dashboard:benchmarks"],
};

const TRAINING_PROGRESS_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: [
    "/api/progression",
    "/api/app/bootstrap",
    "/api/ranking/global",
    "/api/ranking/friends",
    "/api/missions",
  ],
  runtimeProjectionScopes: ["bootstrap", "dashboard:progression"],
};

const TITLE_ACTIVATION_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: ["/api/titles"],
  runtimeProjectionScopes: ["bootstrap", "profile"],
};

const FRIENDS_RELATION_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: ["/api/ranking/friends"],
  runtimeProjectionScopes: ["dashboard:social-hub"],
};

const SOCIAL_HUB_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: [],
  runtimeProjectionScopes: ["dashboard:social-hub"],
};

const AVATAR_MUTATION_INVALIDATION_PLAN: RequestInvalidationPlan = {
  hotCachePaths: [
    "/api/users/me",
    "/api/app/bootstrap",
    "/api/profile",
    "/api/ranking/global",
    "/api/ranking/friends",
  ],
  runtimeProjectionScopes: ["bootstrap", "profile"],
};

type RouteInvalidationPolicy = {
  method?: string;
  pattern: string;
  plan: RequestInvalidationPlan;
};

const ROUTE_INVALIDATION_POLICIES: readonly RouteInvalidationPolicy[] = [
  {
    method: "POST",
    pattern: "/api/presence/heartbeat",
    plan: NO_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/presence/offline",
    plan: NO_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/app/open",
    plan: APP_OPEN_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/events/route-not-found",
    plan: APP_OPEN_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/reward-notifications/consume",
    plan: {
      hotCachePaths: ["/api/reward-notifications/pending"],
      runtimeProjectionScopes: [],
    },
  },
  {
    method: "POST",
    pattern: "/api/metrics/update",
    plan: METRICS_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/offline/sync",
    plan: METRICS_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/food/scan",
    plan: FOOD_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/ai/chat",
    plan: NO_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/ai/generate-missions",
    plan: NO_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/ai/analyze-food",
    plan: NO_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/feedback",
    plan: NO_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/progress/snapshot",
    plan: NO_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/profile/customization",
    plan: NO_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/profile/skill-focus",
    plan: PROFILE_GOAL_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/profile/goal",
    plan: PROFILE_GOAL_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/benchmarks",
    plan: BENCHMARKS_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/missions/complete",
    plan: TRAINING_PROGRESS_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/mini-games/:id/complete",
    plan: TRAINING_PROGRESS_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/titles/:id/activate",
    plan: TITLE_ACTIVATION_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/friends/request",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/users/me/avatar",
    plan: AVATAR_MUTATION_INVALIDATION_PLAN,
  },
  {
    method: "DELETE",
    pattern: "/api/users/me/avatar",
    plan: AVATAR_MUTATION_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/friends/reject",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/friends/accept",
    plan: FRIENDS_RELATION_INVALIDATION_PLAN,
  },
  {
    method: "DELETE",
    pattern: "/api/friends/:friendId",
    plan: FRIENDS_RELATION_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/social/conversations/direct",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/social/groups",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/social/conversations/:id/messages",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "PATCH",
    pattern: "/api/social/conversations/:id/messages/:messageId",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "DELETE",
    pattern: "/api/social/conversations/:id/messages/:messageId",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/social/conversations/:id/media",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/social/conversations/:id/read",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/social/conversations/:id/mute",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/social/preferences",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/social/users/:userId/block",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/social/notifications/consume",
    plan: SOCIAL_HUB_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/missions/generate",
    plan: MISSIONS_GENERATION_INVALIDATION_PLAN,
  },
  {
    method: "POST",
    pattern: "/api/missions/generate/ai-special",
    plan: MISSIONS_GENERATION_INVALIDATION_PLAN,
  },
];

function matchesRoutePattern(path: string, pattern: string): boolean {
  const normalizedPath = path.split("/").filter(Boolean);
  const normalizedPattern = pattern.split("/").filter(Boolean);
  if (normalizedPath.length !== normalizedPattern.length) {
    return false;
  }

  return normalizedPattern.every((segment, index) => {
    if (segment.startsWith(":")) {
      return normalizedPath[index].length > 0;
    }
    return normalizedPath[index] === segment;
  });
}

export function resolveRequestInvalidationPlan(
  method: string,
  path: string,
): RequestInvalidationPlan {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "GET" && path === "/api/logout") {
    return ALL_INVALIDATION_PLAN;
  }

  const isMutation =
    normalizedMethod !== "GET" &&
    normalizedMethod !== "HEAD" &&
    normalizedMethod !== "OPTIONS";
  if (!isMutation) {
    return NO_INVALIDATION_PLAN;
  }

  const matchedPolicy = ROUTE_INVALIDATION_POLICIES.find((policy) => {
    if (policy.method && policy.method !== normalizedMethod) {
      return false;
    }
    return matchesRoutePattern(path, policy.pattern);
  });

  return matchedPolicy?.plan ?? ALL_INVALIDATION_PLAN;
}
