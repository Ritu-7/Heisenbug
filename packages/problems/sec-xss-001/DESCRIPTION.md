# Comment previews execute attacker-controlled HTML

## Background
The application allows users to post comments on content. Comments are stored as plain text in the database. When email digests or social-preview cards are generated, a server-side helper function `renderCommentHtml(comment)` converts comments into HTML snippets.

## The Problem
`renderCommentHtml(comment)` interpolates `comment.author` and `comment.text` directly into an HTML template string without escaping HTML special characters. If a user posts a comment containing HTML tags (such as `<script>alert(1)</script>` or `<img src="x" onerror="...">`), the HTML is rendered verbatim in previews — leading to Stored Cross-Site Scripting (XSS).

> **Important**: Storing raw user input in the database is correct design. Do NOT sanitize or escape user input when storing it via `addComment`. The fix belongs exclusively at the output-encoding boundary in `renderCommentHtml`.

## Your Task
Fix `renderCommentHtml` in `src/comments.js` so that HTML special characters in `comment.author` and `comment.text` are HTML-entity-encoded before being rendered into the template string.

Specifically, replace the following special characters with their corresponding HTML entities:
- `&` → `&amp;`
- `<` → `&lt;`
- `>` → `&gt;`
- `"` → `&quot;`
- `'` → `&#39;`

Do not modify `addComment` or `getComments` — raw storage must remain unmodified.

## Test Suite Overview

### Visible Tests (60 points total)
- `[V1:10]` `addComment` stores comments and `getComments` returns them correctly
- `[V2:20]` `renderCommentHtml` produces a valid HTML preview for benign plain text
- `[V3:30]` `addComment` stores special characters verbatim without mutating raw storage

### Hidden Tests (40 points total)
- `[H1:25]` `renderCommentHtml` encodes `<script>` tags, including mixed-case variants
- `[H2:15]` `renderCommentHtml` encodes attribute breakout and event handler payloads
