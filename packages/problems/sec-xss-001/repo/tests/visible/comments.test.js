'use strict';

/**
 * Visible test suite — sec-xss-001
 * Baked into the session-runner image.
 *
 * Test IDs encode weight: [V1:10] = id=V1, weight=10 points. Total: 60 pts.
 *   V1:10  addComment stores comments and getComments returns them
 *   V2:20  renderCommentHtml produces valid HTML preview for benign text
 *   V3:30  addComment stores special characters verbatim without mutating storage
 */

const { addComment, getComments, renderCommentHtml, _reset } = require('../../src/comments');

beforeEach(() => {
  _reset();
});

describe('SEC-XSS-001 — Comment Preview Renderer (visible)', () => {

  // ── V1: Storage and Retrieval ─────────────────────────────────────────────
  test('[V1:10] addComment stores comments and getComments returns them', () => {
    addComment('Alice', 'Great post!');
    addComment('Bob', 'Thanks for sharing.');

    const all = getComments();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ author: 'Alice', text: 'Great post!' });
    expect(all[1]).toMatchObject({ author: 'Bob', text: 'Thanks for sharing.' });
  });

  // ── V2: Benign HTML Rendering ──────────────────────────────────────────────
  test('[V2:20] renderCommentHtml produces valid HTML preview for benign text', () => {
    const comment = { author: 'Charlie', text: 'Hello world' };
    const html = renderCommentHtml(comment);

    expect(html).toContain('<span class="author">Charlie</span>');
    expect(html).toContain('<p class="text">Hello world</p>');
    expect(html).toMatch(/^<div class="comment">.*<\/div>$/);
  });

  // ── V3: Storage Integrity with Special Characters ─────────────────────────
  test('[V3:30] addComment stores special characters verbatim without mutating storage', () => {
    const rawAuthor = 'AT&T User';
    const rawText = 'Formula: 5 > 3 & 2 < 4 "quoted" \'single\'';
    
    addComment(rawAuthor, rawText);
    const stored = getComments();

    expect(stored).toHaveLength(1);
    expect(stored[0].author).toBe('AT&T User');
    expect(stored[0].text).toBe('Formula: 5 > 3 & 2 < 4 "quoted" \'single\'');
  });

});
