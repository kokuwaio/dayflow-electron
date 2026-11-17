// Two-step prompts, ported verbatim from upstream Dayflow's local-model path
// (Core/AI/OllamaProvider+Transcription.swift, OllamaProvider+Summaries.swift,
// OllamaPromptPreferences.swift; MIT, see NOTICE.md). Each request is small:
// one frame per describe call, then text-only calls.

export const DESCRIBE_FRAME_PROMPT = `Describe what you see on this computer screen in 1-2 sentences.
Focus on: what application/site is open, what the user is doing, and any relevant details visible.
Be specific and factual.

GOOD EXAMPLES:
✓ "VS Code open with index.js file, writing a React component for user authentication."
✓ "Gmail compose window writing email to client@company.com about project timeline."
✓ "Slack conversation in #engineering channel discussing API rate limiting issues."

BAD EXAMPLES:
✗ "User is coding" (too vague)
✗ "Looking at a website" (doesn't identify which site)
✗ "Working on computer" (completely non-specific)`

export const segmentPrompt = (count: number, duration: string, descriptions: string): string =>
  `You have ${count} snapshots from a ${duration} screen recording.

CRITICAL TASK: Group these snapshots into EXACTLY 2-5 coherent segments that collectively explain ${duration} of activity. Brief interruptions (< 2 minutes) should be absorbed into the surrounding segment.

<thinking>
Draft how you'll group the snapshots before you answer. Decide where the natural breaks occur and ensure the full video is covered.
</thinking>

Here are the snapshots (timestamp → description):
${descriptions}
Respond with a JSON object using this exact shape:
{
  "reasoning": "Use this space to think through how you're going to construct the segments",
  "segments": [
    {
      "startTimestamp": "MM:SS",
      "endTimestamp": "MM:SS",
      "description": "Natural language summary of what happened"
    }
  ]
}

HARD REQUIREMENTS:
- "segments" MUST contain between 2 and 5 items.
- Every timestamp must stay within 00:00 and ${duration}.
- Segments should cover at least 80% of the video (ideally 100%) without inventing events.
- Merge small gaps instead of creating tiny standalone segments.
- Never output additional text outside the JSON object.`

export const segmentRetryCoverage = (pct: number, duration: string): string => `

PREVIOUS ATTEMPT FAILED — Your segments only covered ${pct}% of the ${duration} video.
Merge adjacent snapshots or extend segment boundaries so the segments cover at least 80% of the runtime without inventing events.`

export const segmentRetryInvalid = (error: string): string => `

PREVIOUS ATTEMPT FAILED — The response was invalid (error: ${error}).
Respond with ONLY the JSON object described above. Ensure it contains a "reasoning" string and a "segments" array with 2-5 items covering at least 80% of the video.`

export const SUMMARY_BLOCK = `SUMMARY GUIDELINES:
- Write in first person without using "I" (like a personal journal entry)
- 2-3 sentences maximum
- Include specific details (app names, search topics, etc.)
- Natural, conversational tone

GOOD EXAMPLES:
"Managed Mac system preferences focusing on software updates and accessibility settings. Browsed Chrome searching for iPhone wireless charging info while
checking Twitter and Slack messages."

"Configured GitHub Actions pipeline for automated testing. Quick Slack check interrupted focus, then back to debugging deployment issues."

"Researched React performance optimization techniques in Chrome, reading articles about useMemo patterns. Switched between documentation tabs and took notes in
 Notion about component re-rendering."

"Updated Xcode project dependencies and resolved build errors in SwiftUI views. Tested app on simulator while responding to client messages about timeline
changes."

"Browsed Instagram and TikTok while listening to Spotify playlist. Responded to personal messages on WhatsApp about weekend plans."

"Researched vacation destinations on travel websites and compared flight prices. Checked weather forecasts for different cities while reading travel reviews."

BAD EXAMPLES:
- "The user did various computer activities" (too vague, wrong perspective, never say the user)
- "I was working on my computer doing different tasks" (uses "I", not specific)
- "Spent time on multiple applications and websites" (generic, no details)`

export const TITLE_BLOCK = `Write one activity title for a 15-minute window using ONLY the observations.
Rules:
- 5-10 words, natural and specific, single line
- Choose the dominant activity (most time), not necessarily the first
- Ignore brief interruptions (<3 minutes)
- Include a second activity only if both take ~5+ minutes
- If 3+ unrelated activities appear, output exactly: "Scattered apps and sites"
- Prefer proper nouns/topics (Bookface, Claude, League of Legends, Paul Graham, etc.)
- Never use: worked on, looked at, handled, various, some, multiple, browsing, browse, multitasking, tabs, brief, quick, short
- Do NOT use the word "browsing"; use "scrolling" or "reading" instead
- Avoid long lists; no more than one conjunction
- Return only the title text (no quotes, no JSON)`

export const summaryPrompt = (observations: string, categories: string, allowed: string, languageBlock: string): string =>
  `You are analyzing someone's computer activity from the last 15 minutes.

Activity periods:
${observations}

  Create a summary that captures what happened during this time period.

${SUMMARY_BLOCK}

CATEGORIES:
Choose exactly one:
${categories}

APP SITES (Website Logos)
Identify the main app or website used for this period. Output the canonical DOMAIN, not the app name.
- primary: canonical domain of the main app/website used.
- secondary: another meaningful app used, if relevant.
- Format: lower-case, no protocol, no query or fragments.
- Use product subdomains/paths when canonical (e.g., docs.google.com).
- If you cannot determine a secondary, omit it.
- Do not invent brands; rely on evidence from observations.

  REASONING:
  Explain your thinking process:
  1. What were the main activities and how much time was spent on each?
  2. Was this primarily work-related, personal, or brief distractions?
  3. Which category best fits based on the MAJORITY of time and focus?
  4. How did you structure the summary to capture the most important activities?

${languageBlock}

Return JSON:
{
  "reasoning": "Your step-by-step thinking process",
  "summary": "Your 2-3 sentence summary",
  "category": "${allowed}",
  "app_sites": {"primary": "domain.com", "secondary": "domain.com"}
}`

export const SUMMARY_RETRY =
  'Respond with ONLY the JSON object described above. Ensure it contains "reasoning", "summary", "category", and "app_sites" fields.'

export const titlePrompt = (observations: string, languageBlock: string): string =>
  `${TITLE_BLOCK}
${languageBlock}

OBSERVATIONS:
${observations}`

export const TITLE_RETRY = 'Respond with ONLY the title text on a single line. Do not include JSON or quotes.'

export interface CardText {
  startTime: string
  endTime: string
  title: string
  summary: string
}

export const mergeCheckPrompt = (prev: CardText, next: CardText): string =>
  `Decide if two consecutive activity cards should be merged.

Previous activity (${prev.startTime} - ${prev.endTime}):
Title: ${prev.title}
Summary: ${prev.summary}

New activity (${next.startTime} - ${next.endTime}):
Title: ${next.title}
Summary: ${next.summary}

Merge ONLY if they clearly describe the same ongoing task or intent.
- Tool/app switches are allowed if they support the same goal (e.g., doc writing + research).
- Do NOT merge if there’s a context switch to a different intent (social feed, chat, video, gaming, email, shopping, unrelated reading).
- If unsure, do NOT merge.

Return JSON only:
{"combine": true/false, "reason": "1 short sentence explaining the decision"}

EXAMPLES (5):

1) MERGE
Prev: "Drafted onboarding doc in Google Docs. Looked up API details in the Stripe docs."
New:  "Continued the onboarding doc, then cross-checked examples in Stripe docs."
→ {"combine": true, "reason": "Same intent: onboarding doc + supporting research."}

2) MERGE
Prev: "Analyzed retention curves in Claude. Adjusted questions for clarity."
New:  "Kept refining retention metrics in Claude and Notion."
→ {"combine": true, "reason": "Same intent: retention analysis across tools."}

3) MERGE
Prev: "Fixed React auth bug in VS Code. Ran local tests."
New:  "Validated the auth fix in Postman and added notes to the PR."
→ {"combine": true, "reason": "Same task: auth fix and verification."}

4) DON'T MERGE
Prev: "Reviewed VC blog post on trohan.com."
New:  "Watched League of Legends stream and chatted on Messenger."
→ {"combine": false, "reason": "Different intent: research vs entertainment/chat."}

5) DON'T MERGE
Prev: "Drafted email reply about product launch."
New:  "Scrolled X.com and watched a YouTube clip."
→ {"combine": false, "reason": "Context switch to social/video."}`

export const mergeCardsPrompt = (prev: CardText, next: CardText, languageInstruction: string): string =>
  `Create a single activity card that covers both time periods.

Activity 1 (${prev.startTime} - ${prev.endTime}):
Title: ${prev.title}
Summary: ${prev.summary}

Activity 2 (${next.startTime} - ${next.endTime}):
Title: ${next.title}
Summary: ${next.summary}

Create a unified title and summary that covers the entire period from ${prev.startTime} to ${next.endTime}.
Title rules (use ONLY the titles and summaries above):
- 5-10 words, natural and specific, single line
- Choose the dominant activity (most time), not necessarily the first
- Ignore brief interruptions (<3 minutes) mentioned in the summaries
- Include a second activity only if both take ~5+ minutes
- If 3+ unrelated activities appear, output exactly: "Scattered apps and sites"
- Prefer proper nouns/topics (Bookface, Claude, League of Legends, Paul Graham, etc.)
- Never use: worked on, looked at, handled, various, some, multiple, browsing, browse, multitasking, tabs, brief, quick, short
- Do NOT use the word "browsing"; use "scrolling" or "reading" instead
- Avoid long lists; no more than one conjunction
- In the JSON below, the "title" field must contain only the title text (no extra labels or quotes)
Summary: Two sentences max, first-person perspective without using the word I. Retell how the work flowed from the first card into the second with concrete verbs (debugged, reviewed, watched) and name the stand-out tools/topics once each. Skip laundry lists, filler like “various tasks,” and bullet points.
Avoid the words social, media, platform, platforms, interaction, interactions, various, engaged, blend, activity, activities.
Do not refer to the user; write from the user’s perspective.

${languageInstruction}

  GOOD EXAMPLES:
  Card 1: Customer interviews wrap-up + Card 2: Insights deck synthesis
  Merged Title: Shaped customer story for insights deck
  Merged Summary: Logged interview quotes into Airtable. Highlighted the strongest themes and molded them into the insights deck outline.

  Card 1: QA-ing mobile release + Card 2: Answering support tickets
  Merged Title: Balanced mobile QA while clearing support
  Merged Summary: Ran through the iOS smoke checklist in TestFlight. Hopped into Help Scout to close the urgent tickets.

  BAD EXAMPLES:
  ✗ Title: Coding, gaming, and Swift fixes with AI tools and Dayflow (comma list trying to cover everything)
  ✗ Title: Busy afternoon session (too vague)
  ✗ Summary: Worked on several things across platforms (generic, missing specifics)
  ✗ Summary that omits a named site/app/topic from the inputs
  ✗ Summary longer than three sentences or formatted as bullet points

Return JSON:
{
  "title": "Merged title",
  "summary": "Merged summary"
}`

export const retrySuffix = (error: string, instruction: string): string =>
  `\n\nPREVIOUS ATTEMPT FAILED — The response was invalid (error: ${error}).\n${instruction}`

/** Language instruction for JSON replies (also used by the one-step prompt). */
export const languageForJson = (lang: string): string =>
  lang
    ? `The user only speaks ${lang}. Respond in ${lang}, but keep JSON keys in English exactly as specified. If any rule requires an exact English phrase (e.g., "Scattered apps and sites"), keep it verbatim.`
    : ''

/** Language instruction for plain-text replies (titles). */
export const languageForText = (lang: string): string =>
  lang
    ? `The user only speaks ${lang}. Respond in ${lang}. If any rule requires an exact English phrase (e.g., "Scattered apps and sites"), keep it verbatim.`
    : ''

export const TEXT_SYSTEM = 'You are a helpful assistant.'
export const JSON_SYSTEM = 'You are a helpful assistant. Always respond with valid JSON.'
