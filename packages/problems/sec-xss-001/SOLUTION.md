## Reference Solution — SEC-XSS-001: Comment previews execute attacker-controlled HTML

### Full corrected code

```javascript
'use strict';

/**
 * Reference Solution — sec-xss-001
 * HTML entity encodes all 5 special characters at the output rendering boundary.
 */

let comments = [];

function _reset() {
  comments = [];
}

function addComment(author, text) {
  const comment = { author, text, createdAt: new Date().toISOString() };
  comments.push(comment);
  return comment;
}

function getComments() {
  return [...comments];
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCommentHtml(comment) {
  if (!comment) return '';
  const safeAuthor = escapeHtml(comment.author);
  const safeText = escapeHtml(comment.text);
  return `<div class="comment"><span class="author">${safeAuthor}</span><p class="text">${safeText}</p></div>`;
}

module.exports = {
  addComment,
  getComments,
  renderCommentHtml,
  _reset,
};
```

### Line-by-line explanation

- **Lines 14-22:** `addComment` and `getComments` preserve raw user input without pre-escaping. Storing raw data ensures search indexing, exports, and non-HTML clients receive authentic data.
- **Lines 24-32:** `escapeHtml(str)` performs contextual output encoding, substituting `&`, `<`, `>`, `"`, and `'` with their respective HTML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`). Crucially, `&` is replaced first to prevent double-encoding other entity replacements.
- **Lines 34-39:** `renderCommentHtml(comment)` encodes `comment.author` and `comment.text` before string interpolation. When a browser parses the resulting HTML, tags like `<script>` or `<img onerror=...>` are rendered as inert text nodes instead of executable markup.

### Diff against starter code

```diff
@@ -32,10 +32,24 @@
  * Returns all stored comments.
  */
 function getComments() {
   return [...comments];
 }
 
+function escapeHtml(str) {
+  if (typeof str !== 'string') return '';
+  return str
+    .replace(/&/g, '&amp;')
+    .replace(/</g, '&lt;')
+    .replace(/>/g, '&gt;')
+    .replace(/"/g, '&quot;')
+    .replace(/'/g, '&#39;');
+}
+
 /**
  * Renders an HTML preview card for a comment (e.g. for email digests).
  */
 function renderCommentHtml(comment) {
   if (!comment) return '';
-  return `<div class="comment"><span class="author">${comment.author}</span><p class="text">${comment.text}</p></div>`;
+  const safeAuthor = escapeHtml(comment.author);
+  const safeText = escapeHtml(comment.text);
+  return `<div class="comment"><span class="author">${safeAuthor}</span><p class="text">${safeText}</p></div>`;
 }
```
