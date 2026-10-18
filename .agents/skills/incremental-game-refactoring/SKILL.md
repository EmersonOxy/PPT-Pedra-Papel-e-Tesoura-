---
name: incremental-game-refactoring
description: Plan or perform a scoped refactor of the existing single-file game while preserving its rules, visuals, animation, and player-visible behavior.
---

# Incremental Game Refactoring

Use this workflow for refactoring or modularizing the existing game, not for redesigning it.

1. Inspect `Jogar-Trindade-transicao-preta.html` and identify the specific behavior and code region involved before editing.
2. Record observable behavior, inputs, outputs, state transitions, UI feedback, and assets that must remain stable.
3. Propose a small sequence of changes. Keep the file self-contained unless the user approves a structural migration.
4. Isolate pure rules from DOM updates only where it improves clarity or testability without changing outcomes. Inject randomness if deterministic reproduction is needed.
5. Preserve existing names, data shape, assets, CSS, animations, and controls outside the approved scope. Avoid formatting or reserializing the entire HTML file.
6. Validate only checks requested by the user or required by the approved acceptance criteria. If no automated test setup exists, describe a focused manual check instead of claiming tests passed.
7. Report behavior preserved, files changed, verification evidence, and any unresolved risk.
