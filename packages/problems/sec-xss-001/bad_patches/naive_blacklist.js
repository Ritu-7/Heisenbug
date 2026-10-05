'use strict';

/**
 * Bad Patch — sec-xss-001
 * Uses a naive case-sensitive string replacement blacklisting only literal `<script>`.
 * Fails against case variations (<sCrIpT>) and attribute-breakout / event-handler payloads.
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

function naiveSanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<script>/g, '').replace(/<\/script>/g, '');
}

function renderCommentHtml(comment) {
  if (!comment) return '';
  const safeAuthor = naiveSanitize(comment.author);
  const safeText = naiveSanitize(comment.text);
  return `<div class="comment"><span class="author">${safeAuthor}</span><p class="text">${safeText}</p></div>`;
}

module.exports = {
  addComment,
  getComments,
  renderCommentHtml,
  _reset,
};
