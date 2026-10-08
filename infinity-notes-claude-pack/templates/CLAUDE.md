# Infinity Notes repository instructions

Source of truth: infinity-notes-claude-pack/PRODUCT_PLAN.md, ARCHITECTURE.md, TEST_MATRIX.md and current phase. Respect existing repository instructions and user work; merge this file, do not overwrite unrelated content.

Build one minimal offline Windows/Linux Electron app. Do not add backend/accounts/sync, collaboration or embedded AI. Notes/stickies share a document and editor; Electron main owns writes, scheduling and native windows. Keep IPC narrow and validated. Persist source and progress; no fake implementations, TODO-only completion or disabled test gates.

Model roles are configured by launch_autonomous.py native agents or enforced externally by run_phases.py: Opus HIGH plans/accepts, Sonnet 5.5 LOW handles straightforward shell UI, Sonnet 5.5 MEDIUM implements core logic, tests and repairs. Do not recursively call the runner or spawn another agent unless the active role explicitly authorizes it. Do not claim to change model through prompt wording.

Work within this repository. Preserve user files. Install required project dependencies, write migrations, run checks and package locally. Do not push, publish, send messages or install unrelated global software. Finish each phase's acceptance cases before advancing. Document external blockers precisely and continue independent work. Keep runtime private data outside git; add .infinity-work/ and generated app artifacts/userData to .gitignore.

Use durable on-disk phase plans and reports after context compaction. Read only relevant files per task after initial orientation. Record tests that actually ran and native cases not run. Never promise notifications while fully quit or guaranteed window positioning under every Wayland compositor.

The default autonomous coordinator may delegate to the five explicitly configured Infinity agents. Child role agents do not delegate again. Finish the full plan without phase approval prompts; preserve progress across context loss. Final organization follows CLEANUP_POLICY.md and uses finalize_docs.py only after all required acceptance gates pass.
