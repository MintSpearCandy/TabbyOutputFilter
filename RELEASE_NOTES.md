Stream keyword/regex filtered output of one terminal into another terminal pane — a [Tabby](https://github.com/Eugeny/tabby) plugin.

## Features

- **Split-pane workflow**: right-click any terminal → *Filter output to new pane...* — or press the new-pane hotkey (`Ctrl+Alt+N` default) to open a filter pane below the focused terminal — or create a Filter connection from the New terminal (+) dropdown
- **Toolbar UI** (SSH/Serial-style): pattern input with history dropdown, `.*` / `!` / `Aa` toggle pills, source terminal selector, live match counter, match-highlighting toggle, Pause/Resume, Clear
- **Grep-style match highlighting**: matched substrings are colored bold red in the filter terminal — toggle per filter from the toolbar, set the default in Settings → Output Filter. Recordings always stay clean (no color codes in the log files)
- **Robust line filtering**: keyword / regex, invert, case-sensitive; ANSI colors preserved; ConPTY/PSReadLine redraw noise and hidden OSC payloads scrubbed; UTF-8 safe across chunk boundaries
- **Recording to file**: full-output recording (indicator at the terminal's top-right) and filtered-output recording — shared stream subscriptions mean several filters recording the same terminal add no extra load on it; recording toasts last 8 s so the file path is readable
- **Settings page**: match-highlighting default, history limit, pause buffer size, recording directory + filename template (`{date}`, `{time}`, `{title}`, `{pattern}`, `{mode}`)
- **Bounded memory everywhere**: unterminated-line cap, pause buffer with oldest-dropping, per-source/per-session refcounted subscriptions

## Install

Download `tabby-output-filter-<version>.zip` below, unzip the `tabby-output-filter` folder into `%USERPROFILE%\.tabby\plugins\node_modules\`, fully exit Tabby (including tray) and start it again.

Requires a recent Tabby (built against `tabby-core` 1.0.231-nightly).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
