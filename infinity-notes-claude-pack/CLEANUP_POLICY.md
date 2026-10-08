# Final autonomous organization and cleanup

Run only after implementation, testing and native OS release gates have all passed. Keep the active pack/checkpoint in place while anything is blocked or ready_for_os_validation. This prevents premature cleanup from breaking resume or deleting test evidence.

Final repository layout:

| Path | Contents |
| --- | --- |
| README.md | Concise application setup/use, linked to docs/INDEX.md |
| CLAUDE.md | Active repository instructions, retained at root with updated archive links |
| docs/INDEX.md | Navigation to product, architecture, user guide, validation and development history |
| docs/development/claude-pack/ | Archived complete prompt pack, reference screenshot and controllers |
| docs/development/plans/ | Accepted phase plans |
| docs/development/progress/ | Phase progress/acceptance reports |
| docs/development/run-evidence/ | Private raw command/model logs and final checkpoint |
| docs/FINAL_REPORT.md | What was delivered, actual tests and measured limitations |
| docs/NATIVE_OS_MATRIX.md | Native host/version/pass/fail evidence |
| docs/RELEASE_CHECKLIST.md | Package/install verification and remaining distribution steps |

Keep documentation outside the table (product/UX/architecture/user guides) under docs/ with useful links; do not create duplicate root copies. The final agent checks that instructions match actual package scripts and artifacts. Source and runnable tests retain their normal application locations. Packaged installers retain the generated project's documented output directory.

finalize_docs.py moves only the owned prompt pack, docs/plans, docs/progress and .infinity-work. It rewrites known moved path prefixes in maintained Markdown and the checkpoint, preserves raw logs as originally recorded, and writes an explicit old-to-new mapping. It removes the archived pack's Python bytecode cache and its controller-owned status.json.tmp, if present. Other temporary samples/screenshots may be removed only if the agent records their ownership and purpose and confirms they are not tests, fixtures, evidence or user data.

Never delete a user notebook, attachment, SQLite database/backup, source, regression test, fixture, lockfile or installer as cleanup. Avoid blanket rm -rf commands and do not overwrite an existing destination. A destination conflict stops organization with a concrete report. Append ignore entries for private run evidence; don't remove unrelated ignore rules. Root CLAUDE.md remains discoverable by Claude Code. Raw logs may contain development content, so run-evidence remains excluded from git by default.

The final organizer writes docs/development/cleanup-manifest.json with moves/removals and completion state. docs/INDEX.md uses a delimited owned section so existing unrelated documentation remains intact. Native-agent and Python-controller workflows both invoke the same finalizer. No phase approval prompts are introduced by cleanup.
