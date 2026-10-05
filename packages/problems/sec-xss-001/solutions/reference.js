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
