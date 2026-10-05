'use strict';

/**
 * Comment Service
 * Stores user comments as raw text and renders HTML preview snippets for email digests and social cards.
 */

let comments = [];

function _reset() {
  comments = [];
}

/**
 * Stores a comment in memory.
 * Raw storage is correct — storing raw text must NOT be altered.
 */
function addComment(author, text) {
  const comment = { author, text, createdAt: new Date().toISOString() };
  comments.push(comment);
  return comment;
}

/**
 * Returns all stored comments.
 */
function getComments() {
  return [...comments];
}

/**
 * Renders an HTML preview card for a comment (e.g. for email digests).
 * 
 * TODO: SECURITY VULNERABILITY — Comment previews execute attacker-controlled HTML.
 * User input (comment.author and comment.text) is currently interpolated directly
 * into the HTML template string with no escaping.
 * 
 * HINT: Escape user input before it becomes HTML, not before it becomes storage.
 */
function renderCommentHtml(comment) {
  if (!comment) return '';
  return `<div class="comment"><span class="author">${comment.author}</span><p class="text">${comment.text}</p></div>`;
}

module.exports = {
  addComment,
  getComments,
  renderCommentHtml,
  _reset,
};
