---
name: game-systems-design
description: Design or balance rules, combat loops, opponent AI, abilities, rewards, and progression for this browser game. Use for game-system proposals or balance analysis, not for routine code edits.
---

# Game Systems Design

Use this workflow when shaping or evaluating game rules before implementation.

1. Read the existing game rules and state transitions before proposing new mechanics. Record current behavior that the proposal must preserve.
2. State the player decision, intended feeling, match length, and success condition the mechanic should support.
3. Model outcomes with explicit assumptions. Use payoff tables, probability calculations, or a small reproducible simulation when balance depends on repeated random events.
4. Check dominant strategies, edge states, snowballing, comeback potential, fairness between player and opponent, and how the mechanic affects round duration.
5. For opponent AI, define observable policies and difficulty changes. Do not grant hidden information or outcome control to the opponent.
6. Present the smallest viable alternatives with player impact, implementation cost, risks, and a recommended evaluation metric.
7. Do not change rules or implement a proposal until the user approves its scope.

For future online play, keep the game result independent of untrusted client claims. A multiplayer proposal must cover server authority, move validation, state synchronization, reconnection, timing, and cheating prevention before implementation.
