---
name: onboarding
description: Check that Dayflow Electron is installed and recording, then summarize the user's day. Use when the user chooses Set up for Dayflow Electron or asks for onboarding.
---

# Set up Dayflow Electron

Call `get_status` with `{}`.

- If the `dayflow-electron` tools are missing or the call fails because no
  data was found, Dayflow Electron is not installed, its terminal command is
  missing, or it has not recorded yet. Tell the user to install it from
  https://github.com/kokuwaio/dayflow-electron/releases, finish its first-run
  setup, and let it record for about fifteen minutes. Outside the Flatpak the
  plugin also needs the terminal command from Dayflow Electron's Settings,
  MCP / CLI. Stop there.
- If `last_capture_at` is more than an hour old, mention that recording looks
  paused and that they can resume it from Dayflow Electron's tray icon.
- If `pending_batches` is above zero, mention that recent time is still being
  analyzed and will appear shortly.

Then call `get_timeline` with `{}` and give the user a three or four line
summary of their day so far, so they see it working. Tell them what they can
ask for next: where their time went, a standup, or a weekly review.

If `edits_enabled` is false, mention once that this plugin can only read the
timeline until they turn on Allow edits in Dayflow Electron under Settings,
MCP / CLI. If they installed the plugin during an existing task, continue that
task.
