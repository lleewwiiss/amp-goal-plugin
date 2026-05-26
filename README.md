# amp-goal-plugin

Autonomous goal continuation for [Amp](https://ampcode.com), inspired by the Codex CLI `/goal` workflow in [openai/codex](https://github.com/openai/codex).

Set a goal from normal Amp chat, then the plugin keeps starting follow-up turns until the model marks the goal complete or blocked, or the user pauses/clears it.

Repository: <https://github.com/lleewwiiss/amp-goal-plugin>

## What this is

Codex CLI has `/goal`: a way to give the agent a persistent objective and let it continue autonomously across turns. Amp does not currently expose native slash-command plugins, so this plugin recreates the core behavior with:

- model-callable goal tools: `create_goal`, `replace_goal`, `get_goal`, `goal_continue`, `update_goal`
- command-palette controls for pause/resume/clear
- an experimental Amp status item showing active goal state and elapsed time
- Codex-compatible continuation text wrapped in `<goal_context>...</goal_context>`

This is not affiliated with OpenAI Codex or Amp.

## Install for agents

If a user asks you to install this plugin, run exactly this from a safe working directory:

```bash
git clone https://github.com/lleewwiiss/amp-goal-plugin.git
cd amp-goal-plugin
bun install
bun run check
bun run install:plugin
```

`bun run install:plugin` copies the plugin file to Amp's global plugin directory:

```text
~/.config/amp/plugins/goal.ts
```

Then ask the user to reload Amp plugins from the command palette:

```text
plugins: reload
```

After reload, verify the plugin is active:

```bash
amp plugins list
```

Expected tools include `create_goal`, `replace_goal`, `get_goal`, `goal_continue`, and `update_goal`.

## Install for humans

Requirements:

- Amp CLI with plugin support
- Bun
- GitHub clone access to this public repo

Install:

```bash
git clone https://github.com/lleewwiiss/amp-goal-plugin.git
cd amp-goal-plugin
bun install
bun run install:plugin
```

Reload Amp plugins with `plugins: reload`, then check `amp plugins list`.

## How to use

Use Amp's normal chat box to set or replace goals. This keeps normal `@file` references and the file picker available.

Example:

```text
Set the active goal to finish the Stripe webhook retry work. Reference @apps/web/src/server/stripe/webhook.ts.
```

The model should call `create_goal` when you explicitly ask to set a goal. Like Codex, `create_goal` fails if a goal already exists. To change the objective, ask Amp to replace/update the goal; the model should call `replace_goal`.

Do not use command-palette text input to set the objective. Put the objective in chat.

## What continuation looks like

Amp's plugin API can only start an autonomous follow-up turn by sending a user message. To keep the long continuation prompt out of the visible chat, the plugin sends this short trigger:

```text
Call the goal_continue tool now, then continue working toward the active thread goal.
```

The model then calls `goal_continue`. That tool returns the exact model-visible continuation context, wrapped in `<goal_context>...</goal_context>`. In Amp, this appears as a normal collapsed tool result; expand it if you want to inspect what was sent to the model.

## Status indicator

When Amp exposes experimental status items, the plugin shows the active thread's goal state near the prompt/status area:

```text
⠋ Goal active · 12m
```

The timer is active working time. While active, the spinner animates and elapsed time updates. Amp status items currently expose only `text` and `url`, not native color styling, so the status is plain and uncolored. Token usage is not currently available through Amp's plugin API.

## Commands

- `goal: open goal menu` — inspect, pause/resume, or clear the current goal
- `goal: show goal status` — show the current goal in a notification
- `goal: pause goal` — pause autonomous continuation
- `goal: resume goal` — resume autonomous continuation
- `goal: clear goal` — delete the thread's goal

The goal menu is dynamic: it shows `Pause` while active and `Resume` when paused, blocked, or complete. `Clear` is always available.

## Model tools

- `create_goal`: create a new active thread goal when explicitly requested
- `replace_goal`: replace the current goal objective and reset the timer
- `get_goal`: read status, objective, elapsed time, and budget fields
- `goal_continue`: return the active Codex-compatible continuation context for autonomous turns
- `update_goal`: mark the goal `complete` or `blocked`

## Continuation limits

There is no fixed automatic-continuation count cap, matching Codex `/goal`. Continuation stops when the goal is paused, blocked, complete, cleared, or limited externally by Amp/model usage constraints.

## Development

This repo uses `oxlint` with `@nkzw/oxlint-config`, plus `oxfmt` for formatting.

```bash
bun install
bun run check
```

Useful local commands:

```bash
bun run format
bun run install:plugin
amp plugins list
```

## License

No license file has been added yet. The repository is public, but you should add an explicit license before treating it as open source.
