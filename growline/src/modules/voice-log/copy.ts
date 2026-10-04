/**
 * Every sentence the voice-note screen says (session 4, feature 1).
 *
 * Collected in one pure file for the reason the qualifications module gave: copy that
 * has to satisfy L1 and L4 is copy a test should be able to read, and a test cannot
 * read a string buried in JSX. `tests/voice-log.test.ts` walks every export.
 *
 * The tone rule for this screen specifically: it must never oversell what it can do.
 * A coach who believes speaking is logging, and finds out three weeks later that their
 * upline saw silence, has been lied to by a feature — so the promise is stated small
 * and the limit is stated plainly, both before the first tap.
 */

export const TITLE = "Say today's work";

export const SUBTITLE =
  "Ten seconds out loud instead of five taps. Speak your numbers, check them, save.";

/**
 * The honesty line, shown BEFORE recording rather than after.
 *
 * This is the sentence that keeps the accountability loop intact. Audio is not a log;
 * only numbers are. Saying so up front costs one line and prevents the whole failure.
 */
export const NOT_A_LOG_YET =
  "A recording on its own is not your log. Your team sees numbers, so you check them on the next screen and save — one tap.";

/**
 * Said once, plainly, because the microphone leaves the app — and it leaves further than
 * this sentence used to admit.
 *
 * The old wording was "Your phone does the listening, the same as the mic key on your
 * keyboard." The analogy was apt; the first clause was not. `Recorder.tsx` uses
 * `webkitSpeechRecognition` (the Web Speech API), and on Chrome — including Chrome on
 * Android, which is the target device — that STREAMS THE AUDIO TO GOOGLE'S SERVERS for
 * recognition. Nothing on the phone does the listening.
 *
 * That matters more here than it would elsewhere: this file's own examples show a coach
 * saying a prospect's name and phone number aloud. Telling them it stayed on the handset
 * was the one thing the sentence existed to establish, and it was wrong.
 *
 * Corrected 2026-08-20 after a data-inventory pass over every outbound transfer.
 */
export const WHERE_THE_AUDIO_GOES =
  "What you say is sent to Google to be turned into text, the same as the mic key on your keyboard does. The recording and the text are kept on your account, readable by you and nobody else — not your upline. If you would rather nothing left your phone, tap the numbers in instead.";

export const HOW_TO_SPEAK =
  'Say the number and the thing: "five shakes, two invites, three follow-ups". English numbers for now.';

export const RECORD_LABEL = "Hold to record";
export const RECORDING_LABEL = "Listening…";
export const STOP_LABEL = "Stop";

export const HEARD_HEADING = "Here's what I heard";
export const NOT_HEARD_HEADING = "I couldn't make out the numbers";

export const NOT_HEARD_BODY =
  "It happens — noise, accent, a word I don't know yet. Your recording is saved. Tap the numbers in and it counts the same.";

/** When some fields came through and others did not. */
export function partialBody(missing: string[]): string {
  if (missing.length === 0) return "";
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `I heard you mention ${list} but not a number for it. Tap it in below.`;
}

export const CONFIRM_LABEL = "Save today's work";
export const SAVED_HEADING = "Saved";

/**
 * What happens to a note that never becomes numbers.
 *
 * Shown on the screen, not only in a policy page. A coach is entitled to know that the
 * recording of their working day has an expiry, and telling them is also what makes
 * the 30-day purge honest rather than a surprise deletion.
 */
export const UNCOUNTED_FATE =
  "A recording you never turn into numbers counts for nothing — not your streak, not your team's view — and is deleted after 30 days.";

/** Once counted, the audio is dropped. Said so the deletion is expected. */
export const AUDIO_DROPPED =
  "Saved. The numbers are in today's log and the recording has been deleted — it had done its job.";

export const NO_MIC_HEADING = "This phone won't let me record";

export const NO_MIC_BODY =
  "No microphone, or permission was declined. Nothing is broken — the tap-in log does exactly the same job.";

export const GO_TO_LOG = "Open the tap-in log";

/** Zero-state on the hub: what will fill this screen. */
export const HUB_BLURB =
  "Speak your day instead of tapping it. Ten seconds, check the numbers, save.";
