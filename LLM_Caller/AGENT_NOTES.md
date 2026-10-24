# My_helper Agent Notes

This file is for AI collaborators. Do not replace README.md (README is human-facing).

## 2026-03-31 Current Config Rules

- Save writes a minimal ini layout.
- Basic persists:
  - API endpoint, API key, model
  - main Prompt
  - Quick Prompt
  - hotkeys and UI settings
- Advanced persists:
  - RAG enabled + source path
  - Model Router entries
- Legacy `prompt_2` to `prompt_5`, `user_template`, `[Routes]`, and `[Ensemble]` are backward-compatible read-only leftovers.
- `prompt_1` is now stored as `prompt`.
- Model Router routes are compacted on load/save so blank holes are removed and the list stays continuous.
- Quick Prompt stays in runtime memory while editing, so switching tabs should not restore the default text.

## Project Summary

- Small Win32 desktop helper for quick LLM calls.
- Supports selected-text queries and screenshot queries.
- Uses an overlay window for status and responses.
- Settings are persisted in config.ini.

## Engineering Rules

- Keep behavior stable first, then improve UI wording.
- Do not change README.md unless explicitly requested.
- Prefer shared helper logic for config/UI/runtime consistency.
- Preserve backward compatibility for config.ini when practical.

## 2026-03-25 Changes (Side/Merge flow)

### What changed

1. Removed Advanced-page side prompt editing UI.
- Advanced page now only exposes Merge Prompt-1 / Merge Prompt-2 / Merge Prompt-3.
- Side model prompting now uses the active request prompt (Prompt-1/2/3 from Basic flow).

2. Added reviewer(side) validation helpers.
- Added shared helpers:
  - IsBlankText
  - IsReviewerAllEmptyAt
  - IsReviewerUsableAt
  - RemoveReviewerAt
  - PruneEmptyReviewers

3. Auto-prune empty sides.
- If a side entry has endpoint/key/model all empty, it is auto-deleted:
  - when switching from Advanced to Basic
  - before saving Advanced settings

4. Mark incomplete sides as unavailable.
- In the Sides combo list:
  - usable: Side N
  - incomplete: Side N*
- Incomplete means endpoint/model is missing.

5. LLM call/status filtering.
- Ensemble request now only includes usable sides.
- Waiting status no longer shows unavailable entries like side_model-2: wait for incomplete slots.

6. Config persistence cleanup.
- side_prompt_1/2/3 are now cleared on Advanced save.
- merge prompts remain persisted as main_prompt_1/2/3.

7. Side removal safety check.
- Clicking '-' on a non-empty side now requires explicit confirmation.
- Empty side entries can still be removed directly.

8. Prompt behavior tuning.
- Prompt-1 now strongly enforces answer-only plain text option format.
- Prompt-2 requires answer plus short explanation.
- Prompt-3 requires answer plus detailed explanation.

9. Overlay scroll controls.
- Added two new hotkeys for response scrolling: scroll_up and scroll_down.
- Default bindings: Ctrl+Alt+Left (up), Ctrl+Alt+Right (down).
- Basic settings page places these two bindings directly below opacity +/- in a symmetric layout.

10. Prompt and status text correction.
- Ensemble waiting status labels are simplified to main and side-N.
- Prompt-1 is now direct-answer mode for normal questions; option format applies only to multiple-choice questions.
- Prompt-2 is short answer plus short explanation.
- Prompt-3 is answer plus detailed explanation.

11. Multi-LLM disabled state polish.
- Merge Prompt-1/2/3 labels and edit boxes are now disabled (grayed out) when multi-LLM is turned off.

12. Latency debug output.
- Each response now appends runtime diagnostics as plain text:
  [debug] total=...ms queue=...ms api=...ms ttft=...ms calls=... bytes=... send=...ms wait_header=...ms header_to_first=...ms read_body=...ms
- This helps compare in-app latency vs direct Python API calls.
- Added sampled raw chunk preview block for debugging oversized stream payloads:
  [debug-chunks]\n[ch1] ...\n[ch2] ...\n[ch3] ...

13. Long response stability.
- Increased overlay text cache buffer from 4096 to 262144 chars to prevent early truncation in long answers.
- Do not force max token in app request body; output length should follow backend/model-side configuration.

14. Overlay width and simple-query latency tuning.
- Overlay width is dynamic again (not fixed), with two-pass text measurement to avoid truncation and keep compact width for short responses.
- Prompt-1 requests now force non-stream mode to avoid heavy reasoning_content stream overhead on simple queries.

## Files Updated

- modules/config_module.inc.c
- modules/ui_settings_module.inc.c
- modules/llm_request_module.inc.c
- AGENT_NOTES.md

## Known Behavior

- API key remains optional for reviewer targets (endpoint + model required).
- Side numbering in status reflects original slot index.
- Existing old side_prompt values in memory are ignored at runtime; saving Advanced clears them in config.ini.
