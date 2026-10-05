'use strict';

/**
 * Hidden test suite — sec-xss-001
 * NOT included in the session-runner image. Mounted from host at submit time.
 *
 * Test IDs encode weight: [H1:25] = id=H1, weight=25 points. Total: 40 pts.
 *   H1:25  renderCommentHtml encodes script tags including mixed-case variants
 *   H2:15  renderCommentHtml encodes attribute breakout and event handler payloads
 */

const { renderCommentHtml, addComment, getComments, _reset } = require('../../src/comments');

beforeEach(() => {
  _reset();
});

describe('SEC-XSS-001 — Comment Preview Security (hidden)', () => {

  // ── H1: Script Tag Injection Neutralization ─────────────────────────────
  test('[H1:25] renderCommentHtml encodes script tags including mixed-case variants', () => {
    const payloads = [
      { author: '<script>alert(1)</script>', text: 'Hello <script>alert("xss")</script>' },
      { author: '<sCrIpT>alert(2)</sCrIpT>', text: 'Check <SCRIPT>document.cookie</SCRIPT>' },
    ];

    for (const payload of payloads) {
      const html = renderCommentHtml(payload);
      
      // Must not contain raw unescaped opening or closing script tags (case-insensitive)
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<\/script/i);
      
      // Must HTML-entity-encode angle brackets so raw tags are not executable
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
    }

    // Verify raw storage integrity was preserved during rendering
    addComment('<script>alert(1)</script>', 'text');
    expect(getComments()[0].author).toBe('<script>alert(1)</script>');
  });

  // ── H2: Event Handler / Attribute Breakout Injection ─────────────────────
  test('[H2:15] renderCommentHtml encodes attribute breakout and event handler payloads', () => {
    const payload = {
      author: 'Attacker" onclick="alert(1)',
      text: '<img src="invalid" onerror="alert(document.domain)">',
    };

    const html = renderCommentHtml(payload);

    // Raw unescaped HTML tags (like <img) must not be rendered
    expect(html).not.toMatch(/<img\s/i);

    // Unescaped attribute quotes must not exist to prevent attribute breakout
    // (e.g. Attacker" onclick= must have " replaced by &quot;)
    expect(html).not.toMatch(/author">.*"[^>]*=/i);

    // Quotes and angle brackets must be HTML-entity-encoded
    expect(html).toContain('&quot;');
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
  });

});
