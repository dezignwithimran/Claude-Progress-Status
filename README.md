# progress-status

A Claude Code status line that shows how far the current task list has got and how full the context window is, each as a progress bar:

```
Opus 5.5 │ Tasks ██████░░░░ 3/5 60% │ Context ████░░░░░░ 84.2k/200k 42%
```

- **Tasks**: completed / total items in Claude's current task list (from `TodoWrite`, or `TaskCreate`/`TaskUpdate`). Before any task list exists it shows `Tasks —`.
- **Context**: tokens in the context window / the model's limit. The bar is green below 50%, yellow from 50% to 80%, and red above 80%. Red means auto-compact is close.

No dependencies, just Node.js (which Claude Code already uses).

## Install

From GitHub (after you push this repo):

```bash
claude plugin marketplace add <your-github-user>/<repo-name>
```

```bash
claude plugin install progress-status@progress-status-marketplace
```

Or from a local folder while developing:

```bash
claude plugin marketplace add "D:/Imran Haider/Claude Code Plugins/Project Progress & Token Status"
```

Then, inside Claude Code, turn it on:

```
/progress-status:setup
```

This copies the script to `~/.claude/progress-status/` and sets `statusLine` in `~/.claude/settings.json`. If you already had a status line, it is saved and comes back when you run `/progress-status:remove`.

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
claude plugin validate .
```

After changing the scripts, run `/progress-status:setup` again to copy the new version into `~/.claude/progress-status/`.
