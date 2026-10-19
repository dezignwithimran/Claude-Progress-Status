# Progress-Status

A Claude Code plugin that shows how far the current task list has got and how full the context window is, each as a progress bar:

```
Opus 5.5 │ Tasks ██████░░░░ 3/5 60% │ Context ████░░░░░░ 84.2k/200k 42%
```

- **Tasks**: completed / total items in Claude's current task list (from `TodoWrite`, or `TaskCreate`/`TaskUpdate`). Before any task list exists it shows `Tasks —`.
- **Context**: tokens in the context window / the model's limit. The bar is green below 50%, yellow from 50% to 80%, and red above 80%. Red means auto-compact is close.

No dependencies, just Node.js (which Claude Code already uses).

## Install

From GitHub:

```bash
claude plugin marketplace add dezignwithimran/claude-progress-status
```

```bash
claude plugin install progress-status@progress-status-marketplace
```

Or from a local clone while developing:

```bash
git clone https://github.com/dezignwithimran/claude-progress-status.git
```

```bash
claude plugin marketplace add ./claude-progress-status
```

Then, inside Claude Code, turn it on:

```
/progress-status:setup
```

This copies the script to `~/.claude/progress-status/` and sets `statusLine` in `~/.claude/settings.json`. If you already had a status line, it is saved and comes back when you run `/progress-status:remove`.

## In the Claude desktop app

The desktop app's Code tab doesn't run terminal status lines, so the plugin also adds a **band above the prompt** there. It needs no setup step: install the plugin and start a new session.

- **Tasks**: a segmented bar with one rounded pill per task. Done tasks are filled, the current one is half-filled, and the rest are grey. All pills turn green once everything is done. Next to it are the count (`2/4`) and the current task's name.
- **Context**: a small ring gauge that fills clockwise, green, then amber from 50%, then red above 80%, with `170k / 200k · 85%` beside it.

In the terminal the band stays out of the way, since the status line already shows the same thing there.

- Tasks come from whichever task list the session uses (the desktop task list, `TodoWrite`, or `TaskCreate`/`TaskUpdate`), as Claude updates it.
- Context comes from the live context window and refreshes after every tool call and reply.
- The band appears once there's something to show, and steps aside while a survey is open.

## Preview the colors (demo mode)

A new session starts green with only a few tokens used. To see every color right away, run this inside Claude Code:

```
/progress-status:demo on
```

Then send a few short messages. Each refresh steps the bottom line through sample values, marked `DEMO`:

| Step | Tasks | Context |
| --- | --- | --- |
| 1 | 1/4 25% | 50k/200k 25% (green) |
| 2 | 2/4 50% | 120k/200k 60% (yellow) |
| 3 | 3/4 75% | 170k/200k 85% (red) |
| 4 | 4/4 100% | 190k/200k 95% (red) |

Turn it off with `/progress-status:demo off`.

> The status line is the bar under the input box. If you ask Claude to run the script with a shell command, the output shows up in the chat without colors. That's Claude Code's tool display, not the plugin.

## Configure

Edit `~/.claude/progress-status/config.json`:

| Key | Default | Meaning |
| --- | --- | --- |
| `barWidth` | `10` | Characters per bar |
| `colors` | `true` | ANSI colors (also turned off by the `NO_COLOR` env var) |
| `showModel` | `true` | Show the model name |
| `showTasks` | `true` | Show the task bar |
| `showCurrentTask` | `false` | Append the in-progress task's text |
| `showContext` | `true` | Show the context bar |
| `separator` | `" │ "` | Text between sections |
| `demo` | `false` | Show cycling sample values (see above) |

## How it works

- Claude Code pipes session JSON into the status line command. Context usage comes from `context_window` (input + cache tokens over `context_window_size`). If that field is missing, it falls back to the last assistant message's `usage` in the transcript.
- The task list is rebuilt from the transcript JSONL. Only new bytes are read on each run: the offset is cached in your temp folder, so it stays fast on long sessions.
- If anything goes wrong, it prints a plain fallback line rather than breaking your status line.

## Remove

```
/progress-status:remove
```

## Develop

```bash
node test/run.js
```

```bash
claude plugin test plugins/progress-status
```

```bash
claude plugin validate .
```

After changing the scripts, run `/progress-status:setup` again to copy the new version into `~/.claude/progress-status/`.

## License

MIT. See [LICENSE](LICENSE).
