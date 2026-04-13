import { describe, expect, it } from "vitest";

import {
  qualifyUnqualifiedTablesForTests,
  rewriteScalarMaxForTests,
} from "../../worker/core/supabaseCompatDb";

describe("supabaseCompatDb scalar MAX rewrite", () => {
  it("rewrites two-argument MAX into GREATEST", () => {
    const sql = "UPDATE user_progression SET best_streak = MAX(best_streak, ?) WHERE user_id = ?";
    const rewritten = rewriteScalarMaxForTests(sql);

    expect(rewritten).toContain("best_streak = GREATEST(best_streak, ?)");
    expect(rewritten).not.toContain("MAX(best_streak, ?)");
  });

  it("rewrites nested expressions with COALESCE", () => {
    const sql = `
      UPDATE user_achievements
      SET progress_current = MAX(COALESCE(progress_current, 0), ?),
          progress_required = MAX(COALESCE(progress_required, 0), ?)
      WHERE id = ?
    `;
    const rewritten = rewriteScalarMaxForTests(sql);

    expect(rewritten).toContain(
      "progress_current = GREATEST(COALESCE(progress_current, 0), ?)",
    );
    expect(rewritten).toContain(
      "progress_required = GREATEST(COALESCE(progress_required, 0), ?)",
    );
  });

  it("does not rewrite aggregate MAX calls", () => {
    const sql = "SELECT MAX(id) AS last_id FROM user_reward_notifications WHERE user_id = ?";
    const rewritten = rewriteScalarMaxForTests(sql);

    expect(rewritten).toContain("SELECT MAX(id) AS last_id");
    expect(rewritten).not.toContain("GREATEST(");
  });

  it("does not rewrite inside quoted literals", () => {
    const sql = "SELECT 'MAX(COALESCE(progress_current, 0), ?)' AS sample";
    const rewritten = rewriteScalarMaxForTests(sql);

    expect(rewritten).toBe(sql);
  });

  it("does not rewrite inside comments", () => {
    const sql = `
      -- MAX(COALESCE(progress_current, 0), ?)
      UPDATE user_progression
      SET best_streak = MAX(best_streak, ?)
      WHERE user_id = ?
    `;
    const rewritten = rewriteScalarMaxForTests(sql);

    expect(rewritten).toContain("-- MAX(COALESCE(progress_current, 0), ?)");
    expect(rewritten).toContain("best_streak = GREATEST(best_streak, ?)");
  });
});

describe("supabaseCompatDb table qualification", () => {
  it("qualifies social views that are missing from the default Postgres search_path", () => {
    const sql = `
      SELECT fp.is_online
      FROM friendships f
      LEFT JOIN friend_online_presence fp
        ON fp.user_id = f.user_id
    `;

    const rewritten = qualifyUnqualifiedTablesForTests(sql);

    expect(rewritten).toContain("FROM social.friendships f");
    expect(rewritten).toContain("LEFT JOIN social.friend_online_presence fp");
  });

  it("qualifies the social user preferences table", () => {
    const sql = `
      SELECT allow_group_invites
      FROM social_user_preferences
      WHERE user_id = ?
    `;

    const rewritten = qualifyUnqualifiedTablesForTests(sql);

    expect(rewritten).toContain("FROM social.social_user_preferences");
  });

  it("qualifies social message queries to the canonical social/core schemas", () => {
    const sql = `
      SELECT
        m.id,
        up.username,
        u.avatar_url
      FROM conversation_messages m
      INNER JOIN conversation_members cm
        ON cm.conversation_id = m.conversation_id
      INNER JOIN user_profiles up
        ON up.user_id = m.sender_user_id
      LEFT JOIN users u
        ON u.id = m.sender_user_id
      WHERE m.conversation_id = ?
    `;

    const rewritten = qualifyUnqualifiedTablesForTests(sql);

    expect(rewritten).toContain("FROM social.conversation_messages m");
    expect(rewritten).toContain("INNER JOIN social.conversation_members cm");
    expect(rewritten).toContain("INNER JOIN core.user_profiles up");
    expect(rewritten).toContain("LEFT JOIN core.users u");
  });
});
