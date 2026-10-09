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
- **Rich or plain text.** Notes support headings, lists, checklists, quotes, code, links, images and tables. A note can be converted to plain text and back; plain text keeps a table as lines of tab-separated cells and drops fonts and colors.
- **Fonts and colors.** Select text: the toolbar has **Font**, **Font size**, **Text color** and **Highlight**. Each color can be a preset or any color you pick (the system color dialog, or type `#rrggbb`). Choose **Default** or **None** to remove it. The preset text colors stay readable in light and dark theme; a color you pick yourself is shown exactly as chosen. Pasted text keeps its colors, fonts and sizes when they are among these, except the black or white text and white highlight documents use for all their text.
- **Tables.** Type **/table** (or the note menu's **Insert table…**), choose rows and columns, and type; **Tab** and **Shift+Tab** move between cells, **Tab** in the last cell adds a row. Right-click a cell (or **Shift+F10**) to add or delete rows and columns, add or remove the header row, or delete the table; drag a column edge to resize it. Copy a table into a spreadsheet, or paste cells from Excel, LibreOffice, Google Sheets or a web page into a note to make a table. A table can have up to 10,000 cells (for example 100 rows of 100 columns), and a merged cell can span up to 50 columns or rows: a larger table is refused with a message, and larger tab-separated text is pasted as text.
- **Files: copy or link.** Drop or paste a file into a note, or use **/file** (**Attach file**). Images are always copied into the note. For other files Infinity Notes asks how to keep them: **Copy into Infinity Notes** stores a copy in your data folder, so it stays available when the original moves and is part of your backups and exports; **Link to the original** keeps only a link to the file where it is, so **the linked file is not in your backups or exports** (they keep the link) and the link stops working if you move, rename or delete the file. Files larger than 25 MB are never copied: they are linked, with a warning. Tick **Remember my choice**, or set **When adding files** in Settings > Notes and attachments to Ask every time, Always copy into Infinity Notes or Always link to the original; the copy limit can be lowered there. A linked file shows **Linked** and its path when you point at it; **Open** opens documents and images in their app (programs, scripts and shortcuts only open their folder with **Show in folder**), and **Copy into Infinity Notes** turns a link into a copy. When the file is gone (or a backup is restored on another computer) the chip says **File not found at** and the path. Only files on this computer's drives can be linked: on Windows, files on a network location (a shared folder such as `\\server\share`, or a WebDAV folder) are refused with a message; copy them instead. Infinity Notes never connects to a network location by itself, and a link to one inside an imported export is not kept (its chip says **This linked file is no longer available**).
- **Tabs.** Each note opens in a tab; tabs are restored when you start the app again.
- **Search.** **Ctrl+K** searches note titles and text, and runs commands. Filters narrow it to a project or tags.
- **References.** Link to another note (**/link** or the note menu's **Link to note…**). The Details panel (closed until you open it with its title bar button or **Ctrl+Shift+**) shows incoming and outgoing links.
- **Stickies.** **Float as sticky** in the note menu (or **Ctrl+Shift+N** for a new one) opens a note in its own window that stays outside the main window. Pick a color (one of six, or any custom color) and a text color in its color menu, collapse it, or keep it on top where your desktop allows it. On a custom color the text is black or white, whichever reads better, unless you choose a text color. Drag a sticky by its header; click its title to rename it (or press **F2**). The tab and the sticky of a note can be edited at the same time, and each shows what you type in the other. Closing a sticky only hides it.
- **Reminders.** Add a reminder from a note (the note menu's **Add reminder…** or **/reminder**), or accept a suggestion when you type a phrase such as "tomorrow at 5": the app shows the date and time and asks you to confirm; nothing is created on its own. Reminders have a time zone, can repeat, and can follow up. The **Reminders** page and the small **reminder widget** (View > Show reminder widget) show what is due; **Done** completes it, **Snooze** moves it.
- **Keyboard.** **Ctrl+/** shows every shortcut. **Alt** opens the menu bar.

### Locked notes

Lock a note that holds passwords or other confidential text: the note menu's **Lock note…**, **Lock note…** in the Details panel, or **Lock note…** in **Ctrl+K**.

- **Password, and Windows Hello where it is available.** Type a password (at least 8 characters) twice. On Windows with Windows Hello (PIN, fingerprint or face) set up you can also unlock with Windows Hello; the password stays required as the fallback, because a Windows reinstall or a new account cannot open the Windows Hello copy. On Linux, and on Windows without Windows Hello, only the password is offered, and the dialog says why. Windows Hello here confirms it is you before Windows releases a key it keeps for your account; a program running under your Windows account could ask Windows for that key without the prompt. The password protects the note against anyone who only has the files (a backup, a copied disk, another account).
- **No recovery.** A forgotten password cannot be recovered by anyone; the dialog asks you to confirm that.
- **What is encrypted.** The text of the note (rich or plain) is encrypted on your computer. The **title is not encrypted and stays visible** in the tree, tabs, Home and search, so you can find the note; search matches the title only, never the text. Attached images and files, and linked files, are **not** encrypted. Reminders keep working; their notifications say "Reminder in a locked note" instead of the reminder's text. Reminder titles are **not encrypted** and stay visible in the Reminders page and the widget (a reminder made from the note's text has that text as its title); the lock dialog says so.
- **What is destroyed when you lock.** The note's version history, its recovered drafts, its search text and the phrases reminders and suggestions took from it are deleted, and the data file is rewritten so they are not left behind in it. Removing the lock later does not bring them back. Backups and exports made **before** you locked still contain the text: delete them yourself if they must not. Copies the app keeps for its own safety (the copy before a database upgrade, the previous data after a restore) may also hold the earlier text until they are replaced or you delete them in Settings > Backup. What a disk keeps of deleted files is outside the app's reach.
- **Opening.** A locked note's tab shows its title and a password field (and **Use Windows Hello** when it is set up). After three wrong passwords each try waits a little longer. Once unlocked you edit as usual; every save is encrypted and no version history is kept.
- **Locking again.** An unlocked note locks again after 5 minutes without opening or editing it (change this under Settings > Notes and attachments > **Lock unlocked notes again**), when the computer locks or sleeps (screen lock is reported on Windows; on Linux sleep is), and when Infinity Notes quits. Lock it yourself with **Lock now** (note menu or Details) or every note with **Lock all notes** (**Ctrl+K**).
- **Lock settings…** (note menu or Details) changes the password, turns Windows Hello on or off, or removes the lock (each needs the password). A locked note cannot float as a sticky (a sticky is taken off the stickies when you lock it), cannot be converted between rich and plain text, and gets no reminder suggestions.
- **Exports and backups.** **Export all notes** leaves locked notes out and says how many. **Export note as Markdown** works while the note is unlocked and writes its text in the clear to the file you choose. Backups contain locked notes encrypted; a restored backup opens them with the same password.

### What to expect from reminders

Reminders are delivered **only while Infinity Notes is running**, including when only a sticky, the widget or the tray icon is open. When the app is fully quit, nothing is delivered; at the next start you see a summary of what was missed. To keep reminders coming, set **When the main window closes** to **Keep running** (Settings > Windows and tray) and, if you like, turn on **Start Infinity Notes when you sign in** (installed app only).

## 3. Back up and move your data

All your data is in one folder:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\Infinity Notes` |
| Linux | `~/.config/Infinity Notes` |

- **Back up:** **File > Back up now…** writes one `.infinitybackup` file with every note, image, copied file, reminder and setting, checked with SHA-256 hashes. It is safe to do while you work. Linked files are not in it, only their links: back up those files yourself.
- **Automatic backups:** Settings > Backup can write a backup every 1, 7, 14 or 30 days to a folder you choose, keeping the newest 3 to 20.
- **Restore:** **File > Restore from backup…** checks the whole file first, then restarts and swaps it in. Your previous data is kept as a copy until you delete it in Settings > Backup. If anything goes wrong, the app puts your previous data back.
- **Move notes to another computer:** **File > Export all notes…** writes an `.infinityexport` file; **File > Import notes…** adds its notes as a copy and never overwrites existing notes.
- **One note as a document:** **File > Export note as Markdown…** or **Export note as plain text…**. Markdown export drops reminders, fonts and colors and block links; tables become Markdown tables; a linked file becomes a `file://` link to where the file is.

Keep backups on another disk or computer. Uninstalling the app never deletes your data folder.

## 4. Getting help

- Help > Keyboard shortcuts (Ctrl+/).
- Problems at startup are shown on a startup screen with the reason; the logs are in the `logs` folder inside the data folder.
- Known limits are listed in [FINAL_REPORT.md](FINAL_REPORT.md#7-known-limitations).
- On a Windows computer that was also used to develop Infinity Notes, notifications may appear as "Electron" and a click may open Electron instead of the note. That comes from leftovers of earlier development runs; [RELEASE_CHECKLIST.md section 6](RELEASE_CHECKLIST.md#6-development-machines-windows) lists what to remove.
