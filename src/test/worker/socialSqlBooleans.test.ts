import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("social SQL boolean compatibility", () => {
  it("avoids integer fallbacks for social preference booleans", () => {
    const socialGraph = readWorkspaceFile("src/worker/services/socialGraph.ts");
    const friendsRoutes = readWorkspaceFile("src/worker/routes/friends.ts");
    const socialChatRoutes = readWorkspaceFile("src/worker/routes/socialChat.ts");

    expect(socialGraph).not.toContain("COALESCE(sup.show_online_status, 1) = 1");
    expect(friendsRoutes).not.toContain("COALESCE(sup.allow_friend_requests, 1) = 1");
    expect(socialChatRoutes).not.toContain("COALESCE(sup.allow_group_invites, 1) = 1");
    expect(socialChatRoutes).not.toContain("cm.notifications_muted = 0");
    expect(friendsRoutes).toContain("sup.allow_friend_requests IS NULL OR sup.allow_friend_requests = TRUE");
    expect(socialChatRoutes).toContain("cm.notifications_muted IS NULL OR cm.notifications_muted = FALSE");
  });
});
