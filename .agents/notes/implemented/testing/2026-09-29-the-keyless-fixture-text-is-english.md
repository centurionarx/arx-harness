# Agent Note: The keyless fixture's text is English

Status: implemented

## Problem

The keyless fixture transport in `arx-client-connection` (`src/client/fixture.ts`) seeds the sessions, tool samples, questions, commands, skills, and replies that fixture-mode development and the web snapshots render. Its text was Chinese, inherited with the product, and the owner's rule is that inherited Chinese text is translated. [The tool-card translation](../bug-fix/2026-09-27-tool-cards-follow-the-session-locale.md) left the fixture for a separate change because translating it changes tests and goldens built on it.

## Decision

**The fixture's text is English.** Session titles, messages, reasoning, tool results, todos, questions, command and skill descriptions, retry and failure messages, and streamed replies are English. Each translation keeps the property a test relies on:

- The paging messages keep a phrase ("fixture history message") that the search test finds as a case-insensitive token phrase, and the reasoning text keeps a phrase ("Thought process") that must find nothing, because search covers message text only.
- The max-tokens answer still stops mid-sentence.
- The streamed echo reply stays about as long as before, so the typewriter replay keeps its frame count.
- Each reasoning stress chunk stays two characters, so the chunk count alone sets the stress text volume.
- The plugin-injected message avoids the words of the UI's context-injection disclosure name, so a test that finds that disclosure by name matches one element.

**Tests follow the fixture.** The fixture spec, the five web snapshot tests that open the seeded session by its title, and the `todo-row` golden use the English text.

**CJK test data that exercises CJK handling stays.** Markdown, table-width, file-name, and input tests keep their own CJK samples; the fixture supplies none.

## Alternatives considered

**Keep the fixture Chinese as test data.** The fixture's text reaches every fixture-mode screen and the goldens that record them, so anyone running the Web UI without a key reads it as product text.

**Portuguese fixture text.** English is the key-source language of every dictionary and of the goldens, so a Portuguese fixture would mix languages inside English goldens.

## Consequences

- The `todo-row` golden records English todo items. The other goldens built on the fixture recorded no fixture text and are unchanged.
- This supersedes the consequence in the tool-card translation note that the fixture still carries Chinese session and message text.
- Package tests that carry their own copies of former fixture strings, such as the todo panel, chat retry, and question composer specs, still hold Chinese sample text; they do not read the fixture.
