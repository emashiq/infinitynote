# Documentation checked on 2026-10-08

These are engineering inputs, not promises that every OS supports every feature. Recheck dependency compatibility during setup.

- [Claude Code model configuration](https://code.claude.com/docs/en/model-config): explicit model IDs and effort. Sonnet 5.5 requires a sufficiently recent CLI; inspect account model availability. Aliases differ by provider, so this pack defaults to pinned IDs.
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference): print mode, model/effort flags, JSON schema output, turn/budget controls and tool permission rules. These form the runner interface.
- [Claude Code permissions](https://code.claude.com/docs/en/permissions): local trust and permission modes remain effective. No global bypass is configured.
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window): independent desktop windows and compositor-dependent behavior, especially programmatic placement on Wayland.
- [Electron notifications](https://www.electronjs.org/docs/latest/tutorial/notifications) and [Notification API](https://www.electronjs.org/docs/latest/api/notification): main-process notifications and platform-specific capabilities. Verify the installed app, not only development mode.
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security): isolation, constrained preload/IPC, safe navigation and current Electron dependencies.
- [Tiptap UniqueID](https://tiptap.dev/docs/editor/extensions/functionality/uniqueid): useful starting point for content block identity; implement/check copied-block ID behavior and extension license/version.
- [Chrono](https://github.com/wanasit/chrono): English date extraction with reference instant and time-zone/offset options. The application handles IANA-zone calendar conversion and its own EOD/ambiguity policy.

Design choices such as Common/project hierarchy, writer leases, confirmation-only suggestions, reminder delivery recovery and milestone gates are this application's proposed design. They are not attributed to a library as out-of-box features.

- [Claude Code custom agents](https://code.claude.com/docs/en/sub-agents): native agent definitions accept model, effort, permissionMode and tools. The autonomous launcher supplies five explicit role definitions. Account/environment overrides still apply.
