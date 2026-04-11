import { describe, expect, it } from "vitest";

import {
  buildDirectConversationKey,
  resolveConversationDisplay,
} from "@/worker/routes/socialChat";

describe("social chat helpers", () => {
  it("builds a stable direct conversation key regardless of user order", () => {
    expect(buildDirectConversationKey("user-b", "user-a")).toBe("user-a:user-b");
    expect(buildDirectConversationKey("user-a", "user-b")).toBe("user-a:user-b");
  });

  it("uses the other participant as the direct conversation display", () => {
    expect(
      resolveConversationDisplay(
        {
          conversation_kind: "direct",
          title: null,
        },
        [
          {
            user_id: "self",
            username: "eu",
            full_name: "Eu",
            avatar_url: null,
            is_online: true,
          },
          {
            user_id: "friend-1",
            username: "ally",
            full_name: "Ally Prime",
            avatar_url: "/avatar.png",
            is_online: false,
          },
        ],
        "self",
      ),
    ).toEqual({
      displayTitle: "Ally Prime",
      avatarUrl: "/avatar.png",
    });
  });

  it("falls back to usernames when a group has no explicit title", () => {
    expect(
      resolveConversationDisplay(
        {
          conversation_kind: "group",
          title: null,
        },
        [
          {
            user_id: "self",
            username: "eu",
            full_name: "Eu",
            avatar_url: null,
            is_online: true,
          },
          {
            user_id: "friend-1",
            username: "ally",
            full_name: "Ally Prime",
            avatar_url: null,
            is_online: false,
          },
          {
            user_id: "friend-2",
            username: "blaze",
            full_name: "Blaze",
            avatar_url: null,
            is_online: false,
          },
        ],
        "self",
      ),
    ).toEqual({
      displayTitle: "ally, blaze",
      avatarUrl: null,
    });
  });
});
