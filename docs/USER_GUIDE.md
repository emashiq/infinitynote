# Infinity Notes user guide

Infinity Notes keeps notes, floating stickies and reminders on your own computer. It works offline: there is no account, no sync and no network service. This guide covers installing, everyday use, and keeping your data safe.

## 1. Install

The builds are **unsigned local builds**. Windows SmartScreen and some Linux desktops will warn that the publisher is unknown.

### Windows 11 (x64)

Supported: Windows 11 24H2 or later (tested on Windows 11 build 26300). Windows 10 is not supported.

1. Run `Infinity-Notes-Setup-0.1.0-x64-unsigned.exe`. If SmartScreen appears, choose **More info**, then **Run anyway**.
2. The installer installs for the current user by default (no administrator rights). You can change the folder.
3. Start **Infinity Notes** from the Start menu or the desktop shortcut.

Silent install for administrators: `Infinity-Notes-Setup-0.1.0-x64-unsigned.exe /S /currentuser /D=<folder>` (`/D=` must be last, without quotes).

To update, run a newer installer over the installed app. Your notes are kept.

To uninstall, use **Settings > Apps > Installed apps > Infinity Notes > Uninstall**. Uninstalling removes the program, its shortcuts and its uninstall entry. **Your notes are kept** in `%APPDATA%\Infinity Notes`; delete that folder yourself if you want them gone.

### Linux (x64, glibc 2.34 or newer)

- **.deb (Ubuntu, Debian):** `sudo apt install ./infinity-notes-0.1.0-amd64-unsigned.deb` (or `sudo dpkg -i …`). Start it from the applications menu or run `infinity-notes`. Remove it with `sudo apt remove infinity-notes`; your notes in `~/.config/Infinity Notes` are kept.
- **AppImage:** `chmod +x infinity-notes-0.1.0-x86_64-unsigned.AppImage`, then run it. It needs FUSE 2 (`libfuse2t64` on Ubuntu 24.04 and newer).

The app always runs inside Chromium's sandbox; never start it with `--no-sandbox`. Ubuntu 24.04 and newer restrict the user namespaces that sandbox uses, so there the **.deb is the supported package**: it installs an AppArmor profile that allows them (and uses the setuid sandbox helper on systems without user namespaces). An AppImage has no such profile and may refuse to start on those desktops.

## 2. Everyday use

- **Notes** live in **Common** or in a **project**, inside folders as deep as you like. Create them from the tree, from Home, or with **Ctrl+N**. A note's tab is its title: type the title in the new tab, press **Enter**, and keep typing the text. Double-click a tab (or press **F2** on it) to rename the note.
- **Formatting.** Select text and a small toolbar appears above it (**Alt+F10** shows it at the cursor). Type **/** at the start of a line or after a space to insert a heading, list, checklist, image, file, note link or reminder. Right-click the text (or **Shift+F10**) for the note's menu: insert, reminders, Find, Convert, Version history and Float as sticky.
- **Rich or plain text.** Notes support headings, lists, checklists, quotes, code, links and images (paste, drop or insert). A note can be converted to plain text and back.
- **Tabs.** Each note opens in a tab; tabs are restored when you start the app again.
- **Search.** **Ctrl+K** searches note titles and text, and runs commands. Filters narrow it to a project or tags.
- **References.** Link to another note (**/link** or the note menu's **Link to note…**). The Details panel (closed until you open it with its title bar button or **Ctrl+Shift+**) shows incoming and outgoing links.
- **Stickies.** **Float as sticky** in the note menu (or **Ctrl+Shift+N** for a new one) opens a note in its own window that stays outside the main window. Pick a color, collapse it, or keep it on top where your desktop allows it. Drag a sticky by its header; click its title to rename it (or press **F2**). The tab and the sticky of a note can be edited at the same time, and each shows what you type in the other. Closing a sticky only hides it.
- **Reminders.** Add a reminder from a note (the note menu's **Add reminder…** or **/reminder**), or accept a suggestion when you type a phrase such as "tomorrow at 5": the app shows the date and time and asks you to confirm; nothing is created on its own. Reminders have a time zone, can repeat, and can follow up. The **Reminders** page and the small **reminder widget** (View > Show reminder widget) show what is due; **Done** completes it, **Snooze** moves it.
- **Keyboard.** **Ctrl+/** shows every shortcut. **Alt** opens the menu bar.

### What to expect from reminders

Reminders are delivered **only while Infinity Notes is running**, including when only a sticky, the widget or the tray icon is open. When the app is fully quit, nothing is delivered; at the next start you see a summary of what was missed. To keep reminders coming, set **When the main window closes** to **Keep running** (Settings > Windows and tray) and, if you like, turn on **Start Infinity Notes when you sign in** (installed app only).

## 3. Back up and move your data

All your data is in one folder:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\Infinity Notes` |
| Linux | `~/.config/Infinity Notes` |

- **Back up:** **File > Back up now…** writes one `.infinitybackup` file with every note, image, reminder and setting, checked with SHA-256 hashes. It is safe to do while you work.
- **Automatic backups:** Settings > Backup can write a backup every 1, 7, 14 or 30 days to a folder you choose, keeping the newest 3 to 20.
- **Restore:** **File > Restore from backup…** checks the whole file first, then restarts and swaps it in. Your previous data is kept as a copy until you delete it in Settings > Backup. If anything goes wrong, the app puts your previous data back.
- **Move notes to another computer:** **File > Export all notes…** writes an `.infinityexport` file; **File > Import notes…** adds its notes as a copy and never overwrites existing notes.
- **One note as a document:** **File > Export note as Markdown…** or **Export note as plain text…**. Markdown export drops reminders, colors and block links.

Keep backups on another disk or computer. Uninstalling the app never deletes your data folder.

## 4. Getting help

- Help > Keyboard shortcuts (Ctrl+/).
- Problems at startup are shown on a startup screen with the reason; the logs are in the `logs` folder inside the data folder.
- Known limits are listed in [FINAL_REPORT.md](FINAL_REPORT.md#7-known-limitations).
- On a Windows computer that was also used to develop Infinity Notes, notifications may appear as "Electron" and a click may open Electron instead of the note. That comes from leftovers of earlier development runs; [RELEASE_CHECKLIST.md section 6](RELEASE_CHECKLIST.md#6-development-machines-windows) lists what to remove.
