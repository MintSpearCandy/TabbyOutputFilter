# tabby-output-filter

A [Tabby](https://github.com/Eugeny/tabby) plugin that streams **filtered output** of one terminal into another terminal pane.

Lines of the source terminal's output are matched against a keyword or regular expression, and matching lines are printed in real time to a separate "filter" terminal — with their original colors preserved.

## Features

- **Split-pane workflow**: right-click any terminal → *Filter output to new pane...* → a filter terminal opens below it, bound to that terminal
- **New-pane hotkey**: `Ctrl+Alt+N` (default) opens a filter pane below whichever terminal pane currently has focus
- **New connection type**: "Filter output" also appears in the New terminal (+) dropdown
- **Toolbar UI**: like SSH/Serial tabs, the filter terminal has a toolbar with everything in it — pattern input with an attached history dropdown button, `.*` / `!` / `Aa` toggle pills, source terminal selector, live match counter, match-highlighting toggle, Pause/Resume and Clear
- **Keyword / regex** line matching, with **invert** and **case-sensitive** options
- **Match highlighting** (grep-style): matched substrings are colored bold red in the filter terminal — toggle it per filter from the toolbar, and set the default in Settings → Output Filter. Recordings always stay clean (no color codes in the log files)
- **Colors preserved**: matching is done on plain text, but matched lines are forwarded with their ANSI colors intact
- **Filter history**: recent filters are persisted globally; picking one from the history menu applies it immediately — the number of entries kept is configurable in Settings → Output Filter
- **Hotkeys**: `Ctrl+Alt+F` (default) focuses the pattern input (`Esc` returns focus to the terminal); `Ctrl+Alt+N` opens a new filter pane
- **Recording to file**: two modes — **full recording** (everything a terminal outputs, save-output style, with a recording indicator at the terminal's top-right) and **filtered recording** (only the matched lines of a filter, from the filter toolbar's Record button). Recordings share output-stream subscriptions, so several filters recording the same terminal add no extra load on it. File paths are generated from a configurable directory + filename template (`{date}`, `{time}`, `{title}`, `{pattern}`, `{mode}`; default `{date}_{time}.log`)
- **Robust binding**: survives SSH reconnects of the source; if the source tab is closed, the filter pane stays open and lets you pick another source

## Usage

1. Right-click a terminal and choose *Filter output to new pane...*
2. In the filter tab's toolbar, type a pattern (e.g. `ERROR`, or a regex like `time[=<]\d+`) and press **Enter** — every control in the toolbar applies immediately
3. Matching lines stream into the filter pane; the toolbar shows a live `matched/total` counter
4. Switch the source terminal at any time; open the **history dropdown** (clock icon next to the pattern input) to re-apply a recent filter or clear the history

Settings → **Output Filter** configures the history limit, match highlighting default, the pause buffer size, and recording defaults (directory + filename template). Recording can also be started/stopped from the terminal right-click menu.

An empty pattern passes every line through (a live `tail -f` view of the terminal).

## Known limitations

- **Regex is evaluated on the renderer thread**: a pathological pattern with catastrophic backtracking (e.g. `(a+)+$`) typed into your own filter can freeze the window until it finishes. Since the pattern is always user-authored, this is self-inflicted by design.
- The source stream is taken from the terminal tab's output passthrough (`enablePassthrough`, on by default). Another plugin that disables passthrough on a tab also stops its filter output.
- Buffers are bounded: an unterminated line is force-flushed after 1 MiB, and the pause buffer drops its oldest entries beyond a configurable limit (`outputFilter.pauseBufferLimitBytes` in `config.yaml`).

## Building from source

```bash
npm install
npm run build
```

## Packaging & installing

```bash
npm run package            # build + stage release/tabby-output-filter/ + zip
npm run package:install    # same, then copy it into Tabby's plugins dir
```

`npm run package` produces a self-contained package in `release/`:

- `tabby-output-filter/` — drop this folder into `%USERPROFILE%\.tabby\plugins\node_modules\`
- `tabby-output-filter-<version>.zip` — same content as an archive

The package needs no `node_modules` of its own: runtime modules (`tabby-core`, `tabby-terminal`, `@angular/*`, `rxjs`) are provided by the Tabby app itself, and the remaining dependencies are already inlined into `dist/index.js`.

After installing, fully exit Tabby (including the tray icon) and start it again — plugins are only loaded at startup.

## License

MIT
