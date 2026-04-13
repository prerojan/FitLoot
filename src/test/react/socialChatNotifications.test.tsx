import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";

const fetchPendingSocialChatNotificationsMock = vi.fn();
const fetchSocialUnreadSummaryMock = vi.fn();
const consumePendingSocialChatNotificationsMock = vi.fn();
const navigateProtectedRouteMock = vi.fn();

let mockedUser:
  | {
      id: string;
      email: string;
      name: string;
      onboarding_completed: number;
      plan_id: "basic" | "pro" | "annual" | "vip";
      plan_status: "pending" | "active" | "cancelled" | "failed" | "expired";
      payment_method: "none" | "card" | "pix";
    }
  | null = null;

vi.mock("../../react-app/auth/context", () => ({
  useAuth: () => ({
    user: mockedUser,
  }),
}));

vi.mock("../../react-app/services/runtime/hostRuntime", () => ({
  isAndroidHost: () => false,
}));

vi.mock("../../react-app/services/appNavigation", () => ({
  navigateProtectedRoute: (...args: Parameters<typeof navigateProtectedRouteMock>) =>
    navigateProtectedRouteMock(...args),
}));

vi.mock("../../react-app/utils/api", () => ({
  isExpectedApiCancellation: () => false,
}));

vi.mock("../../react-app/services/socialChatService", () => {
  class MockSocialChatApiError extends Error {
    readonly code: "UNAUTHORIZED" | "REQUEST_FAILED";
    readonly status: number;

    constructor(code: "UNAUTHORIZED" | "REQUEST_FAILED", status: number, message: string) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  return {
    fetchPendingSocialChatNotifications: (
      ...args: Parameters<typeof fetchPendingSocialChatNotificationsMock>
    ) => fetchPendingSocialChatNotificationsMock(...args),
    fetchSocialUnreadSummary: (
      ...args: Parameters<typeof fetchSocialUnreadSummaryMock>
    ) => fetchSocialUnreadSummaryMock(...args),
    consumePendingSocialChatNotifications: (
      ...args: Parameters<typeof consumePendingSocialChatNotificationsMock>
    ) => consumePendingSocialChatNotificationsMock(...args),
    SocialChatApiError: MockSocialChatApiError,
  };
});

import { SocialChatNotificationsProvider } from "../../react-app/contexts/socialChatNotifications";
import { useSocialChatNotifications } from "../../react-app/contexts/useSocialChatNotifications";

function NotificationsProbe() {
  const navigate = useNavigate();
  const {
    unreadCount,
    clearConversationUnread,
    refreshSocialChatNotifications,
  } = useSocialChatNotifications();

  return (
    <div>
      <span data-testid="unread-count">{unreadCount}</span>
      <button
        type="button"
        onClick={() => {
          void refreshSocialChatNotifications({ force: true });
        }}
      >
        refresh
      </button>
      <button
        type="button"
        onClick={() => {
          clearConversationUnread(10);
        }}
      >
        limpar ativa
      </button>
      <button
        type="button"
        onClick={() => {
          navigate("/minigames");
        }}
      >
        sair
      </button>
    </div>
  );
}

function renderProvider(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SocialChatNotificationsProvider>
        <Routes>
          <Route path="/friends" element={<NotificationsProbe />} />
          <Route path="/minigames" element={<NotificationsProbe />} />
        </Routes>
      </SocialChatNotificationsProvider>
    </MemoryRouter>,
  );
}

describe("SocialChatNotificationsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUser = {
      id: "user-1",
      email: "user@example.com",
      name: "User",
      onboarding_completed: 1,
      plan_id: "vip",
      plan_status: "active",
      payment_method: "card",
    };
  });

  it("keeps the social badge count updated inside the hub and refreshes again after leaving", async () => {
    const notifications = [
      {
        conversation_id: 10,
        conversation_title: "Chat ativo",
        message_id: 101,
        message_text: "Mensagem atual",
        sender_user_id: "friend-1",
        sender_username: "robert",
        sender_full_name: "Robert Fox",
        sender_avatar_url: null,
        created_at: "2026-04-12T18:10:00.000Z",
      },
      {
        conversation_id: 22,
        conversation_title: "Outra conversa",
        message_id: 202,
        message_text: "Mensagem pendente",
        sender_user_id: "friend-2",
        sender_username: "marvin",
        sender_full_name: "Marvin",
        sender_avatar_url: null,
        created_at: "2026-04-12T18:11:00.000Z",
      },
    ];
    const unreadSummary = {
      total_unread_count: 3,
      conversations: [
        {
          conversation_id: 10,
          unread_count: 2,
        },
        {
          conversation_id: 22,
          unread_count: 1,
        },
      ],
    };

    fetchPendingSocialChatNotificationsMock
      .mockResolvedValueOnce(notifications);
    fetchSocialUnreadSummaryMock
      .mockResolvedValueOnce(unreadSummary)
      .mockResolvedValueOnce({
        total_unread_count: 1,
        conversations: [
          {
            conversation_id: 22,
            unread_count: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        total_unread_count: 1,
        conversations: [
          {
            conversation_id: 22,
            unread_count: 1,
          },
        ],
      });
    consumePendingSocialChatNotificationsMock.mockResolvedValue(undefined);

    renderProvider("/friends?conversationId=10");

    fireEvent.click(screen.getByRole("button", { name: "refresh" }));

    await waitFor(() => {
      expect(screen.getByTestId("unread-count").textContent).toBe("1");
    });

    expect(consumePendingSocialChatNotificationsMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "limpar ativa" }));

    fireEvent.click(screen.getByRole("button", { name: "sair" }));

    await waitFor(() => {
      expect(fetchSocialUnreadSummaryMock).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByTestId("unread-count").textContent).toBe("1");
    });
  });
});
