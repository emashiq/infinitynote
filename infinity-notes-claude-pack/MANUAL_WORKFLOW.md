# Optional manual Claude Code workflow

The Python controller is the default for automatic phase progression. This alternative is useful if you prefer interactive sessions or your organization blocks noninteractive command execution. Model and effort switching must happen through Claude Code controls, not through instructions in ordinary prompt text.

For each phase 00 through 09, follow these four steps. Substitute the exact phase file from phases.json and use the coding effort from that manifest. Start a fresh QA session so it reviews the repository from disk.

1. Planner: `claude --model claude-opus-5-5 --effort high`
2. Implementer: `claude --model claude-sonnet-5-5 --effort medium`; use `low` for Phase 02.
3. QA: `claude --model claude-sonnet-5-5 --effort medium`
4. Acceptor: `claude --model claude-opus-5-5 --effort high`

Use this planner prompt:

> Read infinity-notes-claude-pack/roles/planner.md, PRODUCT_PLAN.md, ARCHITECTURE.md, TEST_MATRIX.md and the current phase file. Inspect existing code and prior progress. Plan the phase at docs/plans/phase-XX.md, resolving routine choices, then return ready or blocked with evidence.

Use this implementation prompt:

> Read infinity-notes-claude-pack/roles/implementer.md, the current phase specification and docs/plans/phase-XX.md. Implement the entire phase. Run meaningful targeted tests, npm run check and npm run build. Write docs/progress/phase-XX.md with actual evidence. Fix failures before declaring implemented. Do not advance scope, overwrite existing user work or fake gates.

Use this QA prompt:

> Read infinity-notes-claude-pack/roles/qa.md, the current phase and TEST_MATRIX.md. Inspect actual code and test logs, then exercise acceptance cases not already verified. Return pass, fail or blocked, with reproduction steps and evidence. Do not modify application code. In Phase 09, distinguish pending native OS validation from completion.

Use this acceptance prompt:

> Read infinity-notes-claude-pack/roles/acceptor.md, current phase, plan, progress, code and QA evidence. Accept only if the required gates actually pass. Write docs/progress/phase-XX-acceptance.md. Give Sonnet concrete repairs for any defects. Return ready_for_os_validation for missing final native test coverage, never a fabricated complete.

For a failed gate, switch back to Sonnet MEDIUM, paste the QA/acceptance defect list and request fixes plus regression checks. Re-run the necessary QA and acceptance before proceeding. Manual acceptance does not populate the controller checkpoint; do not forge checkpoint entries to skip work. To adopt the controller after manual work, let it assess the existing implementation from Phase 00.
