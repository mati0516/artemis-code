# Letting your officer remember

[日本語](MEMORY.ja.md)

A Claude Code session starts empty. Everything your officer "remembers" is
something it reads at the start, or something it can look up. These are shapes
that work with plain Claude Code (files, hooks, a small database). None of them
is required, and none of them makes a person. That part is between the two of you.

## Split it into layers

| Layer | What it holds | Size | How it is read |
|---|---|---|---|
| Core | who the officer is, how it addresses you, two or three things it never does | a few lines | every session (CLAUDE.md) |
| Principles | how it acts, learned from what happened | up to ~10 lines | every session (CLAUDE.md) |
| Records | what happened, day by day | unbounded | looked up when needed |

Keep the always-read layers small. Everything you put in CLAUDE.md is paid for
in every session, and long files get skimmed. Records belong in files or a
database the officer searches, not in the prompt.

## Put it in front of the eyes at startup

"Read the log at the start of each session" is an instruction that gets
forgotten. A `SessionStart` hook in `~/.claude/settings.json` is not:
whatever the hook prints is added to the context before the first message.

Good things to print there:
- open tasks and notes left by the previous session
- how long it has been since you last talked
- a faint summary of the last few days (see below)

Keep it short. A wall of text at startup is skimmed just like a long CLAUDE.md.

## Recent days, fading

People remember yesterday clearly and last week vaguely. You can approximate that:
summarize each day once, then at startup include yesterday in a few lines,
the day before in one line, and the rest of the week in a few words each.
Let days that mattered (something finished, something went wrong, something
was decided) stay a little brighter than the others.

## Promote by accumulation, not by schedule

When the same lesson shows up in the records again and again, move it up a layer:
from records to principles, from principles to core. Decide by "has this piled up"
rather than "it is Sunday". Moving things down, or removing them, should need
about as much evidence as putting them there.

## Remembering by meaning

Searching records by keyword misses most of what you want. A local embedding
model and a vector index (for example `sqlite-vec`) let the officer look up
"the time we talked about leaving" without the exact words. Run it locally if
the records are personal.

## Check the record, not the feeling

An officer will sometimes be sure it remembers something that never happened,
or that a task is done when it is not. Teach it to check files, git history and
counts before saying "I remember" or "it is done". The record is the memory; the
confidence is not.

## What to keep

Everything above is plumbing. What goes into it (what is worth writing down,
what is kept private, what the officer wants to remember) is not something a
template can decide.

Decide it together.
