Stream keyword/regex filtered output of one terminal into another terminal pane — a [Tabby](https://github.com/Eugeny/tabby) plugin.

## Features

- **Split-pane workflow**: right-click any terminal → *Filter output to new pane...* — or press the new-pane hotkey to open a filter pane below the focused terminal — or create a Filter connection from the New terminal (+) dropdown
- **Toolbar UI** (SSH/Serial-style): pattern input with history dropdown, `.*` / `!` / `Aa` toggle pills, source terminal selector, live match counter, match-highlighting toggle, Pause/Resume, Clear
- **Grep-style match highlighting**: matched substrings are colored bold red in the filter terminal — toggle per filter from the toolbar, set the default in Settings → Output Filter. Recordings always stay clean (no color codes in the log files)
- **Robust line filtering**: keyword / regex, invert, case-sensitive; ANSI colors preserved; ConPTY/PSReadLine redraw noise and hidden OSC payloads scrubbed; UTF-8 safe across chunk boundaries
- **Recording to file**: full-output recording (indicator at the terminal's top-right) and filtered-output recording — shared stream subscriptions mean several filters recording the same terminal add no extra load on it; recording toasts last 8 s so the file path is readable
- **Settings page**: match-highlighting default, history limit, pause buffer size, recording directory + filename template (`{date}`, `{time}`, `{title}`, `{pattern}`, `{mode}`)
- **Bounded memory everywhere**: unterminated-line cap, pause buffer with oldest-dropping, per-source/per-session refcounted subscriptions

## What's new in 0.5.5

- **Enter now toggles focus both ways**: Enter in the pattern input applies the filter and focuses the pane; Enter in the pane swings focus back to the input (pane keystrokes go nowhere, so the key is free)
- **One pane per hotkey press**: a re-entry guard stops a single chord from opening two filter panes (Ctrl+Shift-based bindings also fire Tabby's built-in `rearrange-panes` modifier chord, and held keys auto-repeat)
- **Pane-switch hotkeys work to/from filter panes**: the split tab's focused-pane anchor is kept in sync, and a race where Tabby's deferred terminal-focus grab stole focus from the pattern input right after it was focused is now handled (focus is re-asserted)
- Clicking the pattern input reliably focuses it (no more focus flashing back to the terminal)

## Install

Download `tabby-output-filter-<version>.zip` below, unzip the `tabby-output-filter` folder into your Tabby config directory under `plugins\node_modules\` (e.g. `C:\Users\<you>\AppData\Roaming\tabby\plugins\node_modules\`), fully exit Tabby (including tray) and start it again.

Requires a recent Tabby (built against `tabby-core` 1.0.231-nightly).
