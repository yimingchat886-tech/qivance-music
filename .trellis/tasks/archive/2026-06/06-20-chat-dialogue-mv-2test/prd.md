# chat_dialogue_mv 2test real asset chain

## Goal

Make the existing `chat_dialogue_mv` chain run end to end against the real materials already placed in `projects/2test`, and make the rendered chat video follow the 2test product rules:

* A lyric line is a question only when its rendered/display text contains `?` or `？`.
* Question lyric lines render as right-side bubbles and map to the `questioner` speaker.
* Every non-question lyric line renders as a left-side bubble and maps to the `answerer` speaker, including continuation lines.
* `projects/2test/1.jpg` is the left participant avatar and the contact/header avatar.
* `projects/2test/2.jpg` is the right participant avatar.
* Right-side read receipts are driven by visible conversation state, not static decoration.
* The rendered MP4 must be timing-driven: as each lyric line becomes active from `section_map` / line timing, the corresponding chat bubble appears in the video instead of all section bubbles being visible from the start.

## What I already know

* `projects/2test` contains real local materials:
  * `歌词.md`
  * `纸飞机_no-watermark.mp3`
  * `1.jpg`
  * `2.jpg`
* The MP3 probes as stereo MP3, 44.1 kHz, about 146.39 seconds.
* `1.jpg` is a 939 x 940 JPEG; `2.jpg` is a 719 x 719 JPEG.
* `歌词.md` contains 53 lyric lines after skipping section headings and blanks.
* 15 lyric lines contain `?` or `？`; these are the required question bubbles.
* Existing `chat_dialogue_mv` already has V5 full-chain stages: timing, lyrics line map, speaker attribution, conversation plan, chat frames, visual render, mux final, QA report, and render manifest.
* Existing chat speaker attribution currently maps questioner to left and answerer to right; this task intentionally reverses that for the requested business behavior.
* Current `validateSpeakerAttribution` also hardcodes the old rule that `questioner` must be left and `answerer` must be right; this must be updated with the attribution change.
* Current focused speaker-attribution tests assert the old side mapping and must be rewritten rather than preserved.
* Existing chat frame HTML can read `chat_ui.contact_avatar_src`, `left_avatar_src`, and `right_avatar_src`, but the V5 chain does not yet materialize `projects/2test/1.jpg` and `2.jpg` into local html-video assets automatically.
* Existing frame rendering already shows `已读` under the last visible right-side bubble; this is too static for the requested business logic.
* `projects/2test/纸飞机_no-watermark.mp3:Zone.Identifier` is a Windows metadata sidecar and must be ignored.

## Requirements

* Use the existing `chat_dialogue_mv` chain ID and artifact paths.
* Run the 2test project through the production chain, not a diagnostic or mock export.
* Treat `projects/2test/歌词.md` as the only bubble text source; do not rewrite, translate, summarize, or add dialogue.
* Skip Markdown section headings like `[Intro]`, `[Verse]`, `[Chorus]`, `[Bridge]`, and `[Outro]`.
* Classify a lyric line as a question only when its `display_text` contains `?` or `？`.
* Do not classify by Chinese question words, role prefixes, speaker prefixes, model inference, or context alternation for this 2test behavior.
* Render question lyric lines on the right side as `questioner` messages.
* Render every non-question lyric line on the left side as an `answerer` message.
* Consecutive non-question lines must remain left-side; they must not alternate speakers.
* Update speaker-attribution validation so the valid 2test mapping is `questioner` -> `right` and `answerer` -> `left`.
* Conversation-plan validation should continue to require each message side/speaker to match speaker attribution; do not bypass this validation.
* Copy `projects/2test/1.jpg` and `projects/2test/2.jpg` into the generated html-video project assets directory, for example:
  * `video/html-video/.html-video/projects/2test/assets/avatars/1.jpg`
  * `video/html-video/.html-video/projects/2test/assets/avatars/2.jpg`
* Set `conversationPlan.chat_ui.left_avatar_src` to the frame-relative local asset path for `1.jpg`, for example `../assets/avatars/1.jpg`.
* Set `conversationPlan.chat_ui.right_avatar_src` to the frame-relative local asset path for `2.jpg`, for example `../assets/avatars/2.jpg`.
* Set `conversationPlan.chat_ui.contact_avatar_src` to the same local asset path as the left avatar, because the header/contact avatar represents the left participant.
* Do not reference `projects/2test/*.jpg` directly from generated HTML.
* Do not use absolute file paths, `file://` URLs, `http://`, or `https://` for avatar images.
* Fail with a clear validation/blocker message if either required avatar source file is missing or unreadable.
* Preserve existing header title behavior: when the latest visible message in a frame is left-side, the title is `对方正在输入....`; otherwise the title is the configured/default contact name.
* Build chat frame windows from chronological line timing, not section-level buckets: before the first lyric, no bubble is visible; at each message `start_sec`, that bubble becomes visible.
* Keep the latest active lyric bubble visible and use a small sliding recent-message window so older bubbles can scroll out instead of overflowing the chat area.
* Frame durations must come from the next lyric/message start time or final audio duration, so the visual rhythm follows the generated timing artifacts.
* Avatar changes must not remove the safety notice, top time marker, replaceable header avatar slot, or existing local status icon behavior.
* Keep final audio sourced from the locked MP3 materialized as `active_music_take.mp3`.
* Keep production export under `exports/chat_dialogue_mv/final.mp4`.
* Keep manifest, QA, and chain status evidence under the existing `chat_dialogue_mv` contract paths.
* Ignore `*:Zone.Identifier` files during local material discovery/import.
* Preserve existing V5/V6 behavior for `video_chain` and other content types.

## Read Receipt Rule

Confirmed MVP rule, evaluated independently for each rendered chat frame:

1. Build `visibleMessages` using the same order the renderer uses for the frame: `conversationPlan.messages` filtered by `frame.message_ids`.
2. Find the last visible right-side question message in `visibleMessages`.
3. Show exactly one `已读` receipt under that message only if at least one visible left-side message appears after it in `visibleMessages`.
4. If there is no visible right-side question, show no read receipt.
5. If the last visible right-side question has no later visible left-side message in the same frame/window, show no read receipt.
6. Never show `已读` under a left-side message.
7. Do not use hidden future messages outside the current frame/window to decide read state.

This models the business meaning that the left participant has read the right participant's latest visible question only once the visible conversation has advanced to a left-side answer.

Current `validateChatFrameHtml` must be updated: right-side messages must not be required to always expose a read receipt. A frame with right-side messages and no later visible left-side answer is valid and should pass HTML validation.

## Decision (ADR-lite)

**Context**: The right-side read receipt must reflect chat state instead of always appearing as static UI.

**Decision**: Use the confirmed MVP rule: in each frame, show `已读` only under the latest visible right-side question when that question has a later visible left-side answer in the same frame/window.

**Consequences**: The renderer needs a small visible-message-order check. No delivery-state service, network status, or extra persistence is needed for this task.

## Acceptance Criteria

### Classification and conversation plan

* [ ] Speaker attribution maps every lyric line whose `display_text` contains `?` or `？` to `speaker: "questioner"` and `side: "right"`.
* [ ] Speaker attribution maps every lyric line whose `display_text` does not contain `?` or `？` to `speaker: "answerer"` and `side: "left"`.
* [ ] The 2test lyric classification yields exactly 15 right-side question messages from `歌词.md`.
* [ ] The 2test classification proves that every right-side message contains `?` or `？`, and every left-side message does not.
* [ ] Focused tests prove that question words without `?` or `？` do not create right-side questions.
* [ ] Focused tests prove that consecutive non-question lyric lines remain left-side and do not alternate.
* [ ] Speaker-attribution validation accepts `questioner` -> `right` and `answerer` -> `left`.
* [ ] Conversation-plan validation still verifies that each message speaker and side match speaker attribution.

### Avatar and HTML asset staging

* [ ] `1.jpg` and `2.jpg` are copied into the generated html-video project under local assets.
* [ ] Generated frame HTML references `1.jpg` and `2.jpg` by frame-relative local paths, not by source-project paths, absolute paths, `file://`, `http://`, or `https://`.
* [ ] Left-side message avatars render `1.jpg`.
* [ ] Right-side message avatars render `2.jpg`.
* [ ] Header/contact avatar renders the same staged local `1.jpg` asset.
* [ ] Generated HTML still includes the local status icons, safety notice, top time marker, replaceable header avatar slot, and no remote image/style/script references.

### Header title behavior

* [ ] A frame whose latest visible message is right-side shows the configured/default contact name in the header.
* [ ] A frame whose latest visible message is left-side shows `对方正在输入....` in the header.
* [ ] Avatar changes do not alter this title rule.

### Read receipts

* [ ] A frame with only a visible right-side question shows no `已读`.
* [ ] A frame with a visible right-side question followed by a visible left-side answer shows exactly one `已读` under that right-side question.
* [ ] A frame with visible messages `[right question, left answer, right question]` shows no `已读`, because the latest visible right-side question is unanswered.
* [ ] A frame with visible messages `[right question, right question, left answer]` shows exactly one `已读` under the second right-side question.
* [ ] A frame with only left-side messages shows no `已读`.
* [ ] HTML validation passes for valid frames with right-side messages but no read receipt.

### Timing-driven bubble progression

* [ ] Generated frame contracts include an initial pre-lyric frame when the first lyric starts after 0 seconds, with no visible message bubbles.
* [ ] Each lyric line produces a visible-state change at that line's `start_sec`, so bubbles appear in the same order and timing as `conversation_plan.messages`.
* [ ] A frame/window must not expose future messages whose `start_sec` is later than the frame/window start.
* [ ] The last visible message in each non-empty frame/window is the latest lyric whose `start_sec` is active for that window.
* [ ] Frame durations cover the full audio duration without moving the first lyric bubble to time 0.
* [ ] The real 2test report must distinguish technical chain pass from product acceptance, including evidence that the MP4 follows lyric/section timing.

### Production evidence

* [ ] The production chain produces `exports/chat_dialogue_mv/final.mp4`.
* [ ] `exports/chat_dialogue_mv/render_manifest.json` validates as production, non-diagnostic evidence.
* [ ] `data/chains/chat_dialogue_mv/qa_report.json` passes audio stream and duration drift checks.
* [ ] Final MP4 has exactly one audio stream and duration drift within the existing threshold.
* [ ] `npm run typecheck` passes if TypeScript source changes.
* [ ] Focused chat tests pass.
* [ ] A real-asset 2test run report records command, result, final MP4 path, manifest path, QA path, and any environment blocker.

## Definition of Done

* Source changes are limited to the existing chat dialogue chain and the smallest necessary input/avatar plumbing.
* Tests cover the side mapping, avatar wiring, read receipt rule, and timing-driven bubble progression.
* A real `projects/2test` run is attempted with production settings.
* Any timing dependency failure, such as WhisperX or model/network access, is reported as a blocker rather than disguised as a chat-frame failure.
* No new dependency is added.
* No unrelated dirty files are included.
* The implementation does not introduce a generic speaker-classification framework, LLM classifier, delivery-state service, avatar upload surface, or template-level refactor.
* Existing Douyin-style shell layout is preserved except for the side mapping, avatar sources, and read-receipt visibility logic required by this task.
* Existing tests that asserted the old side mapping or unconditional read receipts are updated to the new product rule rather than worked around.

## Technical Approach

1. Update speaker attribution and speaker-attribution validation together so `?` / `？` lyric lines become `questioner` / `right`, and all other lyric lines become `answerer` / `left`.
2. Keep this as direct rule-based logic; do not add an LLM classifier or config system.
3. Add the smallest avatar materialization step needed for `1.jpg` and `2.jpg`: copy both files into the generated html-video project assets, set `conversationPlan.chat_ui.left_avatar_src`, `right_avatar_src`, and `contact_avatar_src` to frame-relative local paths, with `contact_avatar_src` using the staged `1.jpg`.
4. Update read receipt rendering so it is based on visible message order instead of always attaching to the last right-side bubble.
5. Change chat animation/frame contracts to emit timing-driven visible states: an optional empty pre-lyric frame, then one frame/window per message start with a sliding recent-message window.
6. Add focused Node tests for the new behavior.
7. Update focused tests before attempting the real run: attribution side mapping, no question-word fallback, no context alternation for non-question lines, avatar staging/header avatar, header title behavior, read-receipt positive/negative frame cases, and per-lyric timing windows.
8. Run the narrowest useful checks, then attempt the real 2test production chain.

## Out of Scope

* Creating a new chain ID.
* Rewriting the 2test lyrics.
* Editing or deleting user-provided files under `projects/2test`.
* Building a generic avatar upload product surface unless inspection proves it is the smallest way to satisfy 2test.
* Adding a visual template marketplace.
* Changing `video_chain`.
* Adding external services or new dependencies.

## Current Tests That Must Change

* `tests/chat-speaker-attribution.test.ts` currently expects explicit question/answer prefixes to produce `questioner` left and `answerer` right. That must be rewritten for `questioner` right and `answerer` left.
* The "falls back by question punctuation and alternation" test currently expects alternation after the first question. That conflicts with "non-question lyrics on the left." It should instead prove no alternation for this task.
* `tests/chat-frame-contracts.test.ts` currently expects a read receipt to exist whenever the fixture includes a right-side row. It needs negative cases for unanswered right questions.
* The test that renders four messages currently expects `<span>已读</span>` under the last right-side row. Under the new rule, the expected result depends on whether a later visible left-side answer exists after the latest right question.
* The configurable profile/header test should be retained but updated to use the new side semantics and to assert `contact_avatar_src`/left avatar are both the staged `1.jpg` path.

## Items That Should Not Change

* Keep the existing `chat_dialogue_mv` chain ID and artifact paths.
* Keep `projects/2test/歌词.md` as the only bubble text source; do not rewrite, translate, summarize, or add dialogue.
* Continue skipping Markdown section headings and blanks.
* Keep the locked MP3 materialized as `active_music_take.mp3` and final export under `exports/chat_dialogue_mv/final.mp4`.
* Keep ignoring `*:Zone.Identifier` files during local material discovery/import.
* Preserve existing V5/V6 behavior for `video_chain` and other content types.
* Do not add a new dependency, new external service, new chain ID, visual template marketplace, or generic avatar upload surface.

## Technical Notes

* Applied Oracle transcript recommendations from `/home/jym/.oracle/sessions/qivance-chat-dialogue-mv-2test-3/artifacts/transcript.md` on 2026-06-20.
* User confirmed the recommended `已读` strategy on 2026-06-20.
* Loaded `.agents/skills/trellis-start/SKILL.md`.
* Loaded `.agents/skills/trellis-brainstorm/SKILL.md`.
* Loaded `.trellis/spec/guides/project-development.md`.
* Loaded `.trellis/spec/guides/index.md`.
* Loaded `.trellis/spec/backend/index.md`.
* Loaded `.trellis/spec/backend/v4-chat-scheduler-contracts.md`.
* Inspected `docs/qivance_music_chat_dialogue_mv_chain_prd.md`.
* Inspected `.trellis/tasks/06-20-prd-v7-douyin-chat-ui/prd.md`.
* Inspected `src/lib/chat-dialogue/speaker-attribution.ts`.
* Inspected `src/lib/chat-dialogue/conversation-plan.ts`.
* Inspected `src/lib/chat-dialogue/chat-frame-html.ts`.
* Inspected `src/lib/scheduler/v5-task-handlers.ts`.
* Inspected `src/lib/project-core/project-inputs-v5.ts`.
* Inspected `src/lib/chain-registry/chain-registry.ts`.
* Inspected focused chat tests under `tests/chat-*.test.ts`.
* Inspected `projects/2test` material names and media metadata.
