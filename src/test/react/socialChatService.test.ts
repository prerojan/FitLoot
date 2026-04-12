import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();
const apiMock = vi.fn();

vi.mock("../../react-app/utils/api", () => ({
  api: (...args: Parameters<typeof apiMock>) => apiMock(...args),
  fetchJson: (...args: Parameters<typeof fetchJsonMock>) => fetchJsonMock(...args),
  isApiTimeoutError: () => false,
  isExpectedApiCancellation: () => false,
}));

import {
  clearSocialChatCache,
  fetchSocialConversationMessages,
  fetchSocialHubBundle,
} from "../../react-app/services/socialChatService";

describe("socialChatService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSocialChatCache();
  });

  it("normalizes bigint-like ids from the social hub payload", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      friends: [
        {
          id: "12",
          friend_user_id: "user-2",
          friend_username: "marvin",
          friend_full_name: "Marvin",
          friend_avatar_url: null,
          friend_level: "9",
          friend_xp: "1200",
          friend_streak: "5",
          last_heartbeat_at: null,
          is_online: true,
          direct_conversation_id: "41",
          unread_count: "3",
          last_message_preview: "Oi",
          last_message_at: "2026-04-12T15:00:00.000Z",
          notifications_muted: false,
        },
      ],
      pending_requests: [
        {
          id: "7",
          friend_user_id: "user-3",
          friend_username: "ralph",
          friend_full_name: "Ralph",
          friend_avatar_url: null,
          friend_level: "4",
          friend_xp: "340",
          friend_streak: "1",
          created_at: "2026-04-12T14:00:00.000Z",
        },
      ],
      groups: [
        {
          id: "88",
          conversation_kind: "group",
          title: "Grupo",
          display_title: "Grupo",
          avatar_url: null,
          member_count: "4",
          unread_count: "2",
          last_message_id: "155",
          last_message_preview: "Bora",
          last_message_at: "2026-04-12T16:00:00.000Z",
          created_at: "2026-04-12T13:00:00.000Z",
          updated_at: "2026-04-12T16:00:00.000Z",
          notifications_muted: false,
          participants: [],
        },
      ],
      preferences: {
        show_online_status: true,
        allow_friend_requests: true,
        allow_group_invites: true,
      },
    });

    const payload = await fetchSocialHubBundle({ forceRefresh: true });

    expect(payload.friends[0]?.id).toBe(12);
    expect(payload.friends[0]?.direct_conversation_id).toBe(41);
    expect(payload.friends[0]?.unread_count).toBe(3);
    expect(payload.pending_requests[0]?.id).toBe(7);
    expect(payload.groups[0]?.id).toBe(88);
    expect(payload.groups[0]?.last_message_id).toBe(155);
    expect(payload.groups[0]?.member_count).toBe(4);
  });

  it("normalizes conversation and message ids returned by the thread endpoint", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      conversation: {
        id: "41",
        conversation_kind: "direct",
        title: null,
        display_title: "Marvin",
        avatar_url: null,
        member_count: "2",
        unread_count: "1",
        last_message_id: "205",
        last_message_preview: "Oi",
        last_message_at: "2026-04-12T16:00:00.000Z",
        created_at: "2026-04-12T13:00:00.000Z",
        updated_at: "2026-04-12T16:00:00.000Z",
        notifications_muted: false,
        participants: [
          {
            user_id: "user-2",
            username: "marvin",
            full_name: "Marvin",
            avatar_url: null,
            is_online: true,
          },
        ],
      },
      messages: [
        {
          id: "205",
          conversation_id: "41",
          sender_user_id: "user-2",
          sender_username: "marvin",
          sender_full_name: "Marvin",
          sender_avatar_url: null,
          message_text: "Oi",
          message_kind: "text",
          media: null,
          created_at: "2026-04-12T16:00:00.000Z",
          edited_at: null,
          is_own_message: false,
        },
      ],
    });

    const payload = await fetchSocialConversationMessages(41, { limit: 40 });

    expect(payload.conversation.id).toBe(41);
    expect(payload.conversation.last_message_id).toBe(205);
    expect(payload.messages[0]?.id).toBe(205);
    expect(payload.messages[0]?.conversation_id).toBe(41);
  });
});
