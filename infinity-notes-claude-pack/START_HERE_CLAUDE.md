# Autonomous startup

Extract this pack into a dedicated project folder. Install/sign in to a recent Claude Code, establish workspace trust, and install compatible Node.js/npm and Python 3.10+. Run from the project root:

```bash
python infinity-notes-claude-pack/launch_autonomous.py
```

On Windows use `py -3` if needed. This launches Claude Code with an Opus HIGH coordinator plus named Opus/Sonnet agents whose model and effort are explicitly configured. It automatically supplies AUTONOMOUS_AGENT_PROMPT.md, so no phase-by-phase copying is needed. Do not run the launcher inside an existing Claude Code session. Resume by repeating the command while the active pack remains present.

For a Claude Code setup conversation, paste:

> Read infinity-notes-claude-pack/README.md and AUTONOMOUS_AGENT_PROMPT.md. Prepare the project prerequisites and preserve existing work. The authorized goal is all ten phases implemented, tested and fixed autonomously using Opus HIGH planning/acceptance and Sonnet 5.5 LOW/MEDIUM implementation. The launch_autonomous.py entry point supplies the actual named agents; do not claim ordinary prompt text switches models. After completion, finalize_docs.py organizes all workflow files under docs/development/, updates the documentation index and removes only owned temporary files. Give me the one terminal launch command after setup; do not request phase approvals.

The sequential run_phases.py controller is an alternative. Neither workflow promises unavailable account access or native OS hosts; both preserve checkpoints for genuine blockers and do not claim unrun tests passed.
