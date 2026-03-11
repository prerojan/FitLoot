# Bottom Navigation Pattern

Reference source:
- `C:\Users\Teser\Downloads\stitch_fitloot_desing\arena_mobile_nav_with_loja\code.html`

Global visual standard identified from the Arena mobile panel:

1. Floating navigation shell anchored above the bottom edge instead of a full-width dock.
2. Dark glass surface with strong blur, rounded outer radius and a subtle border.
3. Five evenly distributed action slots with icon-first hierarchy.
4. Active destination rendered as a highlighted pill using the FitLoot accent gradient plus glow.
5. Inactive destinations stay muted and low-contrast until hover/tap.
6. Compact typography and spacing keep the bar readable without competing with page content.

What was applied now:

1. `BottomNav.tsx` uses the floating centered shell structure.
2. Active state now follows the Arena-style pill + glow treatment.
3. Navigation order and current route targets were preserved exactly.

What is intentionally deferred to later redesign stages:

1. Desktop/top navigation parity.
2. Screen-by-screen spacing adjustments to match each redesigned page.
3. Any route additions, icon swaps, or behavioral changes.
