---
name: standup
description: Draft a standup or daily status update from the user's Dayflow Electron timeline. Use when the user asks for a standup, daily update, or "what did I do yesterday".
---

# Standup from Dayflow Electron

1. Work out which day the user means. "Yesterday" on a Monday usually means
   Friday; ask only if it is unclear.
2. Call `get_timeline` for that day and build "what got done" from its
   activities, skipping `Idle`, `System`, and distraction entries.
3. Call `get_daily` for the day after. A Daily lists the highlights of the
   activity day before it (`highlights_day`) and the tasks planned next: when
   `highlights_day` is the day you are reporting, use its highlights to sharpen
   "what got done" and its tasks and blockers for the other two sections.
4. Call `get_activity_detail` for at most three activities where the one-line
   summary is too thin to describe the work.

Write the update as three short sections: what got done, what is next, and
blockers. Describe outcomes rather than apps and minutes, keep it to what a
teammate needs, and leave out anything personal. Say "None" for blockers
rather than inventing one.
