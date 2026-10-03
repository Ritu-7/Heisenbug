'use strict';

// src/app.js — thin Express wrapper used by tests
// Tests import this module and use supertest to make HTTP requests.

const express = require('express');
const app = express();

app.use(express.json());

// Import the handler fresh — ensures test state is clean per require() call
const { handlePurchase } = require('./charge');
app.post('/purchase', handlePurchase);

module.exports = app;
