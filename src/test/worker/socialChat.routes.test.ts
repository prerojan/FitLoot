import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerSocialChatRoutes } from "../../worker/routes/socialChat";
import type { AppContext } from "../../worker/core/types";
import { createMockD1Database } from "./mockD1";
import {
  createAuthMiddleware,
  createExecutionContext,
  createTestEnv,
  TEST_USER,
} from "./testUtils";

function createSocialChatDeps() {
  return {
    authMiddleware: createAuthMiddleware(),
    withTransaction: vi.fn(async (_db: D1Database, run: () => Promise<unknown>) => await run()),
  };
}

describe("social chat routes", () => {
  it("retries transient database failures when loading conversation messages", async () => {
    let membershipReads = 0;

    const { db } = createMockD1Database([
      {
        match: (sql) =>
          sql.includes("SELECT 1") &&
          sql.includes("FROM social.conversation_members") &&
          sql.includes("WHERE conversation_id = ?") &&
          sql.includes("AND user_id = ?") &&
          sql.includes("LIMIT 1"),
        first: () => {
          membershipReads += 1;
          if (membershipReads === 1) {
            throw new Error("query read timeout");
          }
          return { 1: 1 };
        },
      },
      {
        match: (sql) =>
          sql.includes("SELECT conversation_kind") &&
          sql.includes("FROM social.conversations") &&
          sql.includes("WHERE id = ?"),
        first: () => ({ conversation_kind: "group" }),
      },
      {
        match: (sql) =>
          sql.includes("FROM social.conversation_members cm") &&
          sql.includes("INNER JOIN social.conversations c") &&
          sql.includes("last_message_preview"),
        all: () => ({
          results: [
            {
              id: 2,
              conversation_kind: "group",
              title: "Squad",
              last_message_id: 10,
              last_message_preview: "oi",
              last_message_at: "2026-04-18T12:00:00.000Z",
              created_at: "2026-04-18T10:00:00.000Z",
              updated_at: "2026-04-18T12:00:00.000Z",
              member_count: 2,
              unread_count: 0,
              notifications_muted: false,
            },
          ],
        }),
      },
      {
        match: (sql) =>
          sql.includes("FROM social.conversation_members cm") &&
          sql.includes("INNER JOIN core.user_profiles up") &&
          sql.includes("ORDER BY cm.joined_at ASC, cm.user_id ASC"),
        all: () => ({
          results: [
            {
              conversation_id: 2,
              user_id: TEST_USER.id,
              username: "self",
              full_name: "Eu",
              avatar_url: null,
              is_online: 1,
            },
            {
              conversation_id: 2,
              user_id: "friend-1",
              username: "ally",
              full_name: "Ally Prime",
              avatar_url: "/ally.png",
              is_online: 0,
            },
          ],
        }),
      },
      {
        match: (sql) =>
          sql.includes("FROM social.conversation_messages m") &&
          sql.includes("INNER JOIN social.conversation_members cm") &&
          sql.includes("ORDER BY m.id DESC"),
        all: () => ({
          results: [
            {
              id: 10,
              conversation_id: 2,
              sender_user_id: "friend-1",
              sender_username: "ally",
              sender_full_name: "Ally Prime",
              sender_avatar_url: "/ally.png",
              message_text: "oi",
              message_kind: "text",
              created_at: "2026-04-18T12:00:00.000Z",
              edited_at: null,
            },
          ],
        }),
      },
      {
        match: (sql) =>
          sql.includes("FROM social.conversation_message_media") &&
          sql.includes("WHERE message_id IN"),
        all: () => ({ results: [] }),
      },
    ]);

    const env = createTestEnv(db);
    const app = new Hono<AppContext>();
    registerSocialChatRoutes(app, createSocialChatDeps());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/social/conversations/2/messages?limit=60"),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(membershipReads).toBe(2);
    expect(payload).toMatchObject({
      conversation: expect.objectContaining({
        id: 2,
        title: "Squad",
      }),
      messages: [
        expect.objectContaining({
          id: 10,
          conversation_id: 2,
          message_text: "oi",
        }),
      ],
    });
  });

  it("keeps direct-conversation participants when preview ids arrive as strings", async () => {
    const { db } = createMockD1Database([
      {
        match: (sql) =>
          sql.includes("SELECT 1") &&
          sql.includes("FROM social.conversation_members") &&
          sql.includes("WHERE conversation_id = ?") &&
          sql.includes("AND user_id = ?") &&
          sql.includes("LIMIT 1"),
        first: () => ({ 1: 1 }),
      },
      {
        match: (sql) =>
          sql.includes("SELECT conversation_kind") &&
          sql.includes("FROM social.conversations") &&
          sql.includes("WHERE id = ?"),
        first: () => ({ conversation_kind: "direct" }),
      },
      {
        match: (sql) =>
          sql.includes("FROM social.conversation_members") &&
          sql.includes("AND user_id <> ?"),
        first: () => ({ user_id: "friend-1" }),
      },
      {
        match: (sql) =>
          sql.includes("FROM social.user_blocks") &&
          sql.includes("blocker_user_id = ?") &&
          sql.includes("blocked_user_id = ?"),
        first: () => null,
      },
      {
        match: (sql) =>
          sql.includes("FROM social.friendships") &&
          sql.includes("status = 'accepted'") &&
          sql.includes("COALESCE(friend_id, friend_user_id)"),
        first: () => ({ 1: 1 }),
      },
      {
        match: (sql) =>
          sql.includes("FROM social.conversation_members cm") &&
          sql.includes("INNER JOIN social.conversations c") &&
          sql.includes("last_message_preview"),
        all: () => ({
          results: [
            {
              id: "2",
              conversation_kind: "direct",
              title: null,
              last_message_id: 10,
              last_message_preview: "oi",
              last_message_at: "2026-04-18T12:00:00.000Z",
              created_at: "2026-04-18T10:00:00.000Z",
              updated_at: "2026-04-18T12:00:00.000Z",
              member_count: 2,
              unread_count: 0,
              notifications_muted: false,
            },
          ],
        }),
      },
      {
        match: (sql) =>
          sql.includes("FROM social.conversation_members cm") &&
          sql.includes("INNER JOIN core.user_profiles up") &&
          sql.includes("ORDER BY cm.joined_at ASC, cm.user_id ASC"),
        all: () => ({
          results: [
            {
              conversation_id: 2,
              user_id: TEST_USER.id,
              username: "self",
              full_name: "Eu",
              avatar_url: null,
              is_online: 1,
            },
            {
              conversation_id: 2,
              user_id: "friend-1",
              username: "ally",
              full_name: "Ally Prime",
              avatar_url: "/ally.png",
              is_online: 0,
            },
          ],
        }),
      },
      {
        match: (sql) =>
          sql.includes("FROM social.conversation_messages m") &&
          sql.includes("INNER JOIN social.conversation_members cm") &&
          sql.includes("ORDER BY m.id DESC"),
        all: () => ({ results: [] }),
      },
    ]);

    const env = createTestEnv(db);
    const app = new Hono<AppContext>();
    registerSocialChatRoutes(app, createSocialChatDeps());
    const { executionCtx } = createExecutionContext();

    const response = await app.fetch(
      new Request("http://localhost/api/social/conversations/2/messages?limit=60"),
      env,
      executionCtx,
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.conversation).toMatchObject({
      id: 2,
      conversation_kind: "direct",
      display_title: "Ally Prime",
      participants: [
        expect.objectContaining({ user_id: TEST_USER.id }),
        expect.objectContaining({ user_id: "friend-1" }),
      ],
    });
  });
});
