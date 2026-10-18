## Editorial — SEC-XSS-001: Comment previews execute attacker-controlled HTML

### Root cause

The comment preview renderer (`renderCommentHtml`) constructs HTML strings by directly interpolating untrusted user input into raw HTML markup:
```javascript
return `<div class="comment"><span class="author">${comment.author}</span><p class="text">${comment.text}</p></div>`;
```

Because characters such as `<`, `>`, `"`, `'`, and `&` are not encoded before being interpreted by the browser or HTML email client, any markup or script tags injected by a malicious user will execute in the context of the viewing user's session (Stored Cross-Site Scripting).

### Why it happens in production

Developers often conflate **storage** with **presentation**:
1. **Raw storage is best practice:** User text should be stored raw and unescaped in the database (so that APIs, SMS, exports, and searches see the original characters).
2. **Missing presentation-layer encoding:** When generating HTML snippets, emails, RSS feeds, or server-rendered cards without an auto-escaping template engine (such as React JSX, Mustache, or EJS), developers manually interpolate template literals, omitting output encoding.
3. **Blacklisting traps:** Teams attempt to strip `<script>` tags using regular expressions, forgetting that modern HTML provides dozens of script execution vectors that do not use `<script>` at all.

### Approaches compared

| Approach | Pros | Cons | When to use |
|---|---|---|---|
| **Context-Aware Output Encoding (Recommended)** | Zero external dependencies; preserves raw data integrity in DB; fast; completely neuters HTML injection. | Requires encoding at every output boundary where raw text meets HTML. | Plaintext rendering in HTML templates, emails, and previews. |
| **DOM textContent / Framework Auto-Escaping** | Native browser/framework protection (e.g. React JSX `{comment.text}`). | Only applicable in browser DOM environments, not raw server-side HTML string generation. | Client-side frontend rendering. |
| **HTML Sanitization Allowlist (e.g. DOMPurify / sanitize-html)** | Permits safe formatting (`<b>`, `<i>`, `<a>`) while neutralizing malicious tags and attributes. | Larger package footprint; computational overhead; requires careful configuration. | Rich-text editors, markdown renderers, WYSIWYG comment inputs. |
| **Blacklist Regex Stripping (e.g. removing `<script>`)** | Misleadingly simple. | Trivially bypassed; unsafe. | **Never in production.** |

### Recommended approach

Implement **HTML entity encoding** at the presentation boundary for the 5 critical HTML characters:

```javascript
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

If user input allows Markdown or rich text:
1. Render markdown to HTML first.
2. Run an allowlist-based HTML sanitizer (`DOMPurify.sanitize(html)` or `sanitize-html`).
3. Explicitly disallow `javascript:` and `data:` URIs in `<a href>` and `<img src>` tags.

#### Defense-in-Depth Layering
- **Content Security Policy (CSP):** Set a strict CSP header: `default-src 'self'; script-src 'self'; object-src 'none'`.
- **Cookie Security:** Store authentication tokens with `HttpOnly`, `Secure`, and `SameSite=Lax/Strict` attributes so stolen session tokens cannot be read via JavaScript.

### Test Payloads for Verification

Always test against these common bypass payloads:
1. **Classic inline script:** `<script>alert(1)</script>`
2. **Image error handler:** `<img src="x" onerror="alert(document.cookie)">`
3. **SVG payload:** `<svg/onload=alert('XSS')>`
4. **JavaScript URI link:** `<a href="javascript:alert(1)">Click here</a>`
5. **Attribute escape:** `" onfocus="alert(1)" autofocus="`

### Complexity / performance notes

- **Time Complexity:** $O(L)$ where $L$ is string length; negligible microsecond string replacement.
- **Memory Footprint:** Creates temporary escaped string copies only during render calls; zero persistent state impact.

### Common pitfalls

- **Sanitizing on input rather than encoding on output:** Escaping input before saving it to the database causes double-escaping bugs (e.g., `&amp;amp;`) when displayed in non-HTML interfaces (push notifications, PDF invoices, mobile apps).
- **Incomplete regex blacklist:** Stripping only `<script>` allows `<img onerror=...>`, `<iframe src=...>`, `<body onload=...>`, and `<object data=...>`.
- **Forgetting attribute contexts:** Inserting strings inside HTML attributes (`<input value="${userInput}">`) without encoding quotes allows attackers to break out of the attribute.

### How to verify the fix

1. **Benign text rendering:** Verify that standard comments (`"Hello world!"`, `"5 < 10 & 20 > 15"`) render correctly without corrupting text.
2. **Storage immutability:** Ensure `addComment` persists the exact unmutated string into the database.
3. **Payload containment:** Pass `<script>alert(1)</script>` into `renderCommentHtml()`. Assert that the returned HTML contains `&lt;script&gt;alert(1)&lt;/script&gt;` and does not contain literal `<script>` tags.
