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
- **Search.** **Ctrl+K** searches note titles and text, documents and their text (with their kind and a snippet), and runs commands. Filters narrow it to a project or tags.
- **Links.** Type **[[** (or press **Ctrl+Shift+L**, or use **/link** or the note menu's **Link to note or document…**) and pick a note or a document by its title; the list matches loosely ("mtg" finds "Meeting") and shows where each item is. Link a whole note, one of its paragraphs or headings, a whole document, or a place in it: a page of a PDF, a slide, a sheet or cell (`Budget!B2`) of a spreadsheet, a heading of a Word document. **Create note “…”** makes a new note with the typed title next to this one. Select text and press **Ctrl+Shift+K** to turn it into a link that keeps your text. Click a link to open it. Renaming or moving the target keeps links; a target in Trash or deleted shows so, with Restore or Search. (**Ctrl+K** is always search.)
- **Details panel.** Open it with its title bar button or **Ctrl+Shift+\\**. For a note: Info, the **Outline** of its headings (click one to go there), **Comments**, reminders, outgoing links and backlinks, and the **Local graph**. For a document: Info, the notes that link to it, **Comments** and the **Local graph**. Under a note's text you see its word and character count and reading time.
- **Code and diagrams.** A code block (**/code** or three backticks) has a language picker and colors code in common languages. **/diagram** inserts a Mermaid diagram (flowcharts, sequence diagrams, Gantt charts and more): **Edit** shows the source with the drawing below it, **Preview** the drawing only; a mistake in the source is explained under it. **Copy as SVG** and **Copy as PNG** put the drawing on the clipboard. Diagrams follow the light or dark theme; very long diagrams (over 20,000 characters) are not drawn.
- **Math.** Type `$x^2$` (after a space) for a formula in the text, or `$$` and a space at the start of a line (or **/math**) for a formula on its own line. Click a formula to edit its TeX; **Enter** (in a block **Ctrl+Enter**) keeps it, **Escape** cancels. Search finds the TeX, and Markdown export writes `$…$` and `$$…$$`.
- **Export and print a note.** File → **Export note as HTML…** or **Export note as PDF…** writes one file with the note's text, images, diagrams and formulas; **Print note…** opens the system print dialog. The page is made inside Infinity Notes without any window appearing, and never loads anything from the internet. A locked note must be unlocked first.
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
- **Lock settings…** (note menu or Details) changes the password, turns Windows Hello on or off, sets the sticky PIN of a locked sticky, or removes the lock (each needs the password). A locked note cannot be converted between rich and plain text and gets no reminder suggestions.
- **New locked note…** and **New locked sticky…** (File menu, command palette, Home, the tree's right-click menu of Common, projects and folders, and the Stickies page) ask for the password first and create the note already locked: its text is never stored unencrypted, not even as an empty first save, a version, a draft or search text. The new note opens unlocked for this session.

### Locked stickies

A locked note can float as a sticky, and locking a floating sticky keeps it floating. A locked sticky shows its title, color and place, and a blurred panel instead of the text: the text is not in the window at all until you show it.

- **Show it** with the PIN, the password or Windows Hello (where it is set up for the note).
- **The PIN** (4 to 8 digits) is set when you lock or create a sticky, from the sticky's menu (**Set PIN…** / **Change PIN…**) or in **Lock settings…**; each needs the password. The PIN is a quick way to show the sticky again during a session, while the note is unlocked. It does not protect your files: the password does. The PIN is stored only as a check value that cannot open the note, so learning the PIN from your files gives nothing. When the note has locked again (after the idle time, when the computer locks or sleeps, Lock now, Lock all, or quitting), the PIN cannot show it; the sticky says that the password (or Windows Hello) is needed. Wrong PINs slow down like wrong passwords, and after five wrong PINs in a row only the password or Windows Hello shows it.
- **It blurs again** after **Blur locked stickies after** (Settings > Notes and attachments: 30 seconds, 1, 2 or 5 minutes; 1 minute by default) without typing, clicking, scrolling or moving the pointer over its text, at once with **Blur now** in its menu, and whenever the note locks again. What you typed is saved (encrypted) first.
- Note tabs of a locked note keep working as before (the lock screen, Lock now, the idle time).
- The Stickies page lists a locked sticky with a lock and never shows its text. Reminders of a locked sticky still fire; their notifications say "Reminder in a locked note".
- **Exports and backups.** **Export all notes** leaves locked notes out and says how many. **Export note as Markdown** works while the note is unlocked and writes its text in the clear to the file you choose. Backups contain locked notes encrypted; a restored backup opens them with the same password.

### PDF documents

A PDF in the tree (**Import file…** in the tree menu, the File menu, Home or **Ctrl+K**; or **Open in Infinity Notes** on a PDF attached to a note) opens in its own tab.

- **Reading.** Pages scroll continuously. The toolbar has the page number (type a number and press **Enter**), **Zoom out**/**Zoom in** and a zoom list (**Fit width**, **Fit page**, **Automatic**, 50-400 %), and **Rotate view**, which turns the view only and does not change the file. **Pages and outline** shows the sidebar: **Pages** lists thumbnails (click one to go to it), **Outline** lists the PDF's bookmarks. Select text with the mouse and copy it with **Ctrl+C**. Links inside a PDF open nothing; a bookmark to a web address offers **Copy link**.
- **Find.** **Ctrl+F** (or the search button) opens Find in PDF: matches are highlighted as you type, **Enter** and **Shift+Enter** go to the next and previous match, **Match case** and **Whole words** narrow it, **Escape** closes it.
- **Annotating.** The tools are **Select text**, **Highlight** (select text, or draw over anything), **Add text** (click where the text goes), **Draw**, and **Add image** (pick an image file with the system file chooser, then move and resize it). Highlight, text and drawing have a color button. Click a mark to select it; **Delete** removes it, **Ctrl+Z** undoes. Annotations are written into the PDF as standard annotations, so other PDF readers show them.
- **Pages.** Select thumbnails with a click, **Ctrl+click** or **Shift+click** (with the keyboard: arrows, **Space** to select, **Enter** to go there). The **Pages** menu rotates the selected pages left or right, moves them up or down (also **Alt+Up**/**Alt+Down**, or drag a thumbnail to its new place), inserts a blank page, inserts all pages of another PDF you pick (at most 25 MB), extracts the selected pages to a new PDF next to this one ("Report (pages 1-3)"), or deletes them (a PDF keeps at least one page). Without a selection these act on the page in view.
- **Saving.** Changes stay in the tab until you **Save** (**Ctrl+S**); the toolbar says **Unsaved changes** until then. Leaving the tab, closing it or quitting saves them first; if the save fails, the tab stays open. Each save is a new version, and the previous one is kept like a note's versions. A linked PDF is saved back to its original file; if that file changed outside Infinity Notes, choose **Reload** or **Save a copy…**.
- **Password-protected PDFs.** The tab asks for the password; it is used to open the PDF and never stored (it is forgotten when the tab closes). Pages of a protected PDF cannot be rearranged or deleted, and its text is not added to search (its title is).
- **Search.** Ctrl+K finds PDFs by their title and by the text of their first 1,000 pages. A damaged file shows **This file is not a readable PDF** in its tab and is found by its title only.
- PDF forms can be filled in and are saved with the file; PDF scripts never run.

### Spreadsheets (Excel and CSV)

Excel workbooks (.xlsx) and CSV files open in a spreadsheet tab (**Import file…**, **New spreadsheet**, or **Open in Infinity Notes** on an attached file).

- **Editing.** Click a cell and type; start with **=** for a formula (results update when the cells they use change). The toolbar has undo and redo, the format painter, number formats (currency, percent, decimals and more), font, size, bold, italic, strikethrough, underline, text and fill color, borders, merge and unmerge, alignment, wrap, rotation, freeze rows or columns, filter and sort, notes (comments on cells) and quick sums. Right-click a cell or a row or column header to insert or delete rows and columns, hide them, set their size, clear, or sort; drag a header edge to resize. Sheet tabs at the bottom add, rename, copy, delete, color, hide and reorder sheets. Cells without a font of their own use your system's sans font (the first entry of the font menu); saving keeps them without a font, so Excel shows its default.
- **Copy and paste.** **Ctrl+C** copies the selected cells as a table and as tab-separated text, so they paste into Excel, LibreOffice, a note's table or a text editor; **Ctrl+V** pastes tables copied from spreadsheets or web pages, or tab-separated text. (Use the keyboard to paste; the right-click menu has no Paste.)
- **Find.** **Ctrl+F** (or **Find**) searches the shown text of every visible sheet; **Enter** and **Shift+Enter** go to the next and previous match, **Match case** and **Whole cell** narrow it, **Escape** closes it.
- **Saving.** Edits stay in the tab until you **Save** (**Ctrl+S**); the toolbar says **Unsaved changes** until then, and leaving the tab, closing it or quitting saves first. Each save is a new version. A linked file is saved back to its original.
- **What is kept.** Infinity Notes keeps values, formulas, formatting, merges, column widths and row heights, hidden rows and columns, frozen panes, the filter range, notes, tab colors and hidden sheets. When a workbook has things it does not keep (for example charts, pivot tables, pictures, conditional formatting, data validation or named ranges), the tab says so, and before the first save it lists them and asks: **Save without them** or **Cancel**. To keep them, edit the file in Excel or LibreOffice instead (**Open in system app**), or **Export a copy…** first.
- **CSV files** keep values only: formulas are saved as their results, and formatting, notes and other sheets are not saved. The separator (comma, semicolon, tab or bar), the text encoding (UTF-8 with or without a byte-order mark, UTF-16, or Windows-1252) and the line endings are kept as the file had them.
- **Limits.** Files up to 25 MB, up to 64 sheets and 500,000 filled cells open in the editor; larger ones open in your system app. Macro-enabled workbooks (.xlsm) are not opened, and macros never run.
- **Search.** Ctrl+K finds spreadsheets by their title, sheet names and cell values.

### Word documents

Word documents (.docx) open in a Word tab (**Import file…**, **New Word document**, or **Open in Infinity Notes** on an attached file), shown as pages.

- **Editing.** Click in the page and type. The editor toolbar has undo and redo, zoom (**Fit** or 50-150 %), paragraph styles (headings, title and the document's own styles), font and size, **Bold**, **Italic**, **Underline**, **Strikethrough**, text color and highlight, alignment, line and paragraph spacing, numbered and bulleted lists, indent, table cell styles and borders, **Insert table**, **Insert image**, **Link** and comments. Right-click text or a table for more (insert or delete rows and columns, merge cells, add a comment). **Page break** in the toolbar above (or **Ctrl+Enter**) starts a new page; **Shift+Enter** is a line break. Pictures are added with **Insert image** (the system file chooser) or by pasting an image (up to 16 MB in all per paste); pictures from web addresses are not downloaded. Drag a picture's corner to resize it.
- **Comments.** The document's comments show beside the page. You can reply, resolve, and add your own (right-click selected text, **Add comment**); comments you add are written into the file under the name "Infinity Notes", since the app has no accounts.
- **Find.** **Ctrl+F** (or **Find**) searches the text of the pages: matches are highlighted, **Enter** and **Shift+Enter** go to the next and previous match, **Match case** and **Whole words** narrow it, **Escape** closes it. Headers, footers and footnotes are not searched there (Ctrl+K search finds them).
- **Saving.** Edits stay in the tab until you **Save** (**Ctrl+S**); the toolbar says **Unsaved changes** until then, and leaving the tab, closing it or quitting saves first. Infinity Notes writes your edits into the file and keeps everything else in it exactly as it was (headers, footers, styles, pictures and parts it does not show), so the file still opens in Word and LibreOffice. Each save is a new version. A linked file is saved back to its original.
- **Files that open read-only.** If a file holds content Infinity Notes cannot write back unchanged (or uses the "Strict Open XML" format), the tab says why and shows a read-only preview instead of the editor; edit such a file in your system app. Content shown as a placeholder is kept as it is when you save. Macro-enabled documents (.docm) are not opened, and macros never run.
- **Links** inside a document open nothing.
- **Search.** Ctrl+K finds Word documents by their title and by their text, including tables, headers, footers, footnotes and comments.

### PowerPoint presentations

Presentations (.pptx) open in a presentation tab (**Import file…**, **New presentation**, or **Open in Infinity Notes** on an attached file): the slides on the left, the slide in the middle, its speaker notes below.

- **Slides.** Click a slide on the left to show it, or use the arrow keys, Home and End in the list. **New slide** adds a slide with the same layout after the one shown; **Duplicate slide** (**Ctrl+D** in the list) copies it with its notes; **Delete slide** (**Delete** in the list) removes it (a presentation keeps at least one). Drag a slide in the list, or press **Alt+Up** or **Alt+Down**, to move it.
- **Shapes and pictures.** Click a text box, picture or other shape to select it, drag it to move it (it lines up with the slide's edges and center as you get close; hold **Alt** to place it freely), and drag its handles to resize it. With the keyboard: click the slide (or Tab to it), **Tab** selects the next shape, the arrow keys move it (**Alt** with an arrow moves it a little), **Shift** with an arrow resizes it, **Delete** deletes it and **Escape** deselects it. **Page Up** and **Page Down** show the previous and next slide.
- **Text.** Double-click a text box or placeholder, or select it and press **Enter**, to edit its text in place; **Escape** or clicking elsewhere ends editing. Text you type keeps the formatting of the text around it. **Bold**, **Italic**, **Underline** (**Ctrl+B**, **Ctrl+I**, **Ctrl+U**), the font size (type it and press Enter) and the text color in the toolbar format the selected text, or all the text of a selected shape. Pasted text arrives as plain text.
- **Inserting.** **Text box** adds a text box in the middle of the slide, ready to type in. **Picture** adds a PNG or JPEG picture (up to 16 MB) from a file; you can also paste a picture onto the slide, or paste text there to get a text box with it.
- **Speaker notes.** Type in **Speaker notes** below the slide; each line is a paragraph.
- **Undo and redo.** **Undo** and **Redo** in the toolbar, or **Ctrl+Z** and **Ctrl+Y**, step through your changes (while typing in a text box or the notes, Ctrl+Z undoes your typing there).
- **Presenting.** **Present** (or **F5**) shows the slides over the whole window, starting with the one shown. The arrow keys, **Page Up**, **Page Down**, **Space**, **Enter** and a click step through them; **Home** and **End** go to the first and last slide; **Escape** ends the show at the slide you were on. Animations and transitions are not played.
- **Find.** **Ctrl+F** (or **Find**) searches the text on every slide and in the speaker notes; **Enter** and **Shift+Enter** go to the next and previous match, which is outlined on its slide. **Match case** and **Whole words** narrow it.
- **Zoom.** **Fit** shows the whole slide; 50-200 % shows it at that size.
- **Saving.** Changes stay in the tab until you **Save** (**Ctrl+S**); the toolbar says **Unsaved changes** until then, and leaving the tab, closing it or quitting saves first. Infinity Notes changes only the slides you changed (and the slide list when you add, move or delete slides) and keeps everything else in the file exactly as it was, so it still opens in PowerPoint and LibreOffice. Each save is a new version. A linked file is saved back to its original.
- **What is shown simplified.** Slides are drawn by Infinity Notes in the fonts your computer has, so they can look a little different from PowerPoint. If a presentation has transitions, animations, video or audio, SmartArt, charts, embedded objects or ink, a note above the slides says that they are shown simplified or not at all; they are kept in the file when you save. Macro-enabled presentations (.pptm) and very large ones (over 200 MB or 2,000 slides) do not open; use your system app.
- **Search.** Ctrl+K finds presentations by their title and by the text of their slides and speaker notes.

### Web pages (HTML)

A saved web page (.html) opens read-only in its own tab (**Import file…**). It is shown as it was saved, but nothing in it runs: no scripts, no forms, and nothing is loaded from the internet (remote pictures and styles stay blank). Links in the page do not open; a click leaves the page in place and says so. **Links (n)** lists the page's web links to copy, and **Source** shows its markup as text, where you can select text to comment on. Infinity Notes never hands a web page to your browser.

### Versions and copies of documents

PDF, Word, PowerPoint, Excel and CSV tabs have **Versions** in their header: the list shows each earlier version (newest first) with its time and size. **Open** shows it read-only in the tab; **Restore** (or **Restore this version** while viewing it) makes it the current version again, and the version it replaces is kept; **Save as copy** adds it as a new document next to this one ("Budget (revision 2)"). Unsaved changes are saved first. **Export a copy…** writes the saved file (or the version you are viewing) to a place you choose, without adding a document. Versions are kept like a note's versions (the retention settings in Settings apply).

### Comments

Comments are notes about a piece of a note or document, kept beside it in the **Comments** section of the details panel (**Ctrl+Shift+\\** shows the panel).

- **Commenting on a note.** Select text (also inside a table cell) and choose **Comment** in the formatting toolbar, press **Ctrl+Alt+M**, or use **Add comment** in the command palette. The panel opens with a field for the comment; **Ctrl+Enter** saves it and **Escape** cancels. The commented text is highlighted in the note tab. Comments need a rich-text note.
- **Threads.** Each comment starts a thread: **Reply** adds to it, **Edit** changes a comment, **Resolve** marks it done (its highlight goes away; **Resolved** in the panel lists it, **Reopen** brings it back), **Delete thread** removes it with its replies, and **Delete** removes a reply. Deleting asks first and cannot be undone.
- **Finding the text.** Click a thread to select and flash its text in the note. If the text was deleted, the thread shows **Text removed** with the text it was made on. Copying commented text elsewhere does not copy the comment.
- **Documents.** In a PDF, select text and add a comment to mark that area, or add one without a selection for the page shown; numbered markers show the comments on the pages (they are kept in Infinity Notes, not in the PDF file). In a spreadsheet the selected cell is commented, in a presentation the slide shown and the selected shape, and in a Word document the paragraph at the cursor (the document's own Word comments stay in its comments panel). For a web page, show **Source** and select the text there. Clicking a thread opens the document at its place.
- **Locked notes.** Comments on a locked note are encrypted with it and readable only while it is unlocked; locking a note encrypts the comments it already has.
- **Search, Trash and backups.** Ctrl+K also finds notes and documents by their comments (the result shows "Comment: …"). Comments go to Trash and come back with their item and are deleted when it is deleted from Trash. Backups and **Export all notes** keep them (comments of locked notes are not exported); Markdown, HTML and PDF exports of a note do not include them.

### Graph

The **Graph** (the rail button, **Open graph** in the command palette, or **Open graph** on Common, a project or a folder in the tree) shows your notes and documents as dots and the links between them as lines: links to notes and documents, and documents opened in the app from a note's attached or linked files. Notes are circles, documents squares colored by their type (see the legend), and items with more links are bigger. A locked note shows only its title.

- **Show** picks all items, Common, a project or the folder you opened it from (with its subfolders); **Notes** and **Documents** pick the kinds, **Tag** shows notes with that tag, and **Unlinked items** shows or hides items without links.
- Scroll or press **+** and **-** to zoom, drag the background or use the arrow keys to move around, and press **0** to fit the graph. Drag a dot to move it. Pointing at a dot shows its title and its neighbors; click it (or press **Enter** while pointing) to open the item.
- **Search titles** highlights the matching items and dims the rest.
- **List** shows every item with the items it is linked with, for the keyboard and screen readers; each opens with a click.
- The details panel of a note or document has **Local graph**: the item and what is 1, 2 or 3 links away from it.
- Very large notebooks show the 5,000 best-linked items; narrow **Show** to see the rest.

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
