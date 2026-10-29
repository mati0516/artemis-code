# Giving your officer a voice

[日本語](VOICE.ja.md)

Artemis Code does not ship a voice. The screen can already play one, though:
when the server sends an `audio` event with a URL, the page plays it and pulses
the cube while it speaks. This note is a map for building the rest yourself
(or for asking your Claude to build it).

## The shape

```
Claude Code session log (.jsonl)
   │  1. follow the newest file, read new lines as they are appended
   ▼
filter
   │  2. keep only what the officer says to you
   ▼
splitter
   │  3. cut into sentences
   ▼
TTS engine  (local HTTP)
   │  4. text → WAV
   ▼
your server
   │  5. serve the WAV, send {type:"audio", url, dur} to the page
   ▼
browser plays it, the cube speaks
```

## 1. Where the words come from

Claude Code writes each conversation to
`~/.claude/projects/<folder-slug>/<session-id>.jsonl`, one JSON object per line.
Follow the newest file under the project you care about. When a newer file appears,
the session has changed: switch to it.

Tip: poll the directory every few seconds. Following a single file forever is
the most common reason a voice "goes quiet" after a restart.

## 2. What to read aloud

Read lines with `"type": "assistant"` and take the `text` parts of
`message.content`. Skip `tool_use`, `tool_result` and `thinking`.

Things worth filtering out:
- code blocks and tables (they sound terrible)
- URLs and long file paths (say "a link" or drop them)
- short narration before tool calls ("Let me check the file…"), if your officer
  talks in a different language from that narration. Filtering sentence by sentence
  on the language you expect works well.

## 3. Splitting

Split on sentence ends (`。！？` / `. ! ?` followed by a space or line end).
Do not split numbers like `1.2.0`. Speak the first sentence as soon as it is ready
and synthesize the rest while it plays; the first sound arriving fast matters more
than anything else.

## 4. A local TTS engine

Any engine with an HTTP API works. Engines with a VOICEVOX-compatible API
(VOICEVOX, AivisSpeech, …) take two calls:

```
POST /audio_query?text=<text>&speaker=<id>   → query JSON
POST /synthesis?speaker=<id>   body = query  → audio/wav
```

You can adjust `speedScale`, `pitchScale` and `intonationScale` in the query
before synthesis.

Tips:
- Engines are slow on the first request after idling. Ping them every
  half-minute or so while waiting.
- A GPU makes a large difference (about 1.8 s → 0.35 s per sentence on a
  mid-range card in our tests).
- **Check the license of every voice model.** Many require a credit line, and
  some forbid certain uses. Put the credit in your README.

## 5. Handing it to the page

Save the WAV somewhere your server serves statically, then send this to every
connected page over the WebSocket:

```json
{ "type": "audio", "url": "/voice/2026-10-29-001.wav", "dur": 3.4 }
```

The page plays the clips in order and never plays the same URL twice.
`dur` (seconds) lets the cube's glow match the speech.

For phones, converting WAV to MP3 on the fly (for example with ffmpeg) cuts the
size by about 14×.

## Asking Claude to build it

A request that usually works:

> Read docs/VOICE.md. Build a small voice pipeline for this repo: follow my newest
> Claude Code session log, read only your own replies aloud through the
> VOICEVOX-compatible engine at http://localhost:50021 (speaker 1), and send
> `audio` events through the existing server. Keep it in one file under `voice/`.
