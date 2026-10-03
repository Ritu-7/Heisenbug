'use strict';

// src/app.js — thin Express wrapper used by tests
// Tests import this module and use supertest to make HTTP requests.

const express = require('express');
const app = express();

app.use(express.json());

// Import the handler fresh — ensures test mocks are applied before require()
const { handleCheckout } = require('./charge');
app.post('/checkout', handleCheckout);

module.exports = app;
