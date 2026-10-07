const express = require('express');
const app = express();

let queryCount = 0;

const ordersDb = [
  { id: 'o1', userId: 'u1', createdAt: '2023-10-01T10:00:00Z', status: 'completed' },
  { id: 'o2', userId: 'u1', createdAt: '2023-10-02T11:00:00Z', status: 'completed' },
  { id: 'o3', userId: 'u1', createdAt: '2023-10-03T12:00:00Z', status: 'pending' },
  { id: 'o4', userId: 'u1', createdAt: '2023-10-04T13:00:00Z', status: 'completed' },
  { id: 'o5', userId: 'u1', createdAt: '2023-10-05T14:00:00Z', status: 'cancelled' }
];

// User 2: 50 orders
for (let i = 1; i <= 50; i++) {
  ordersDb.push({
    id: `o_u2_${i}`,
    userId: 'u2',
    createdAt: `2023-10-06T${String(i).padStart(2, '0')}:00:00Z`,
    status: 'completed'
  });
}

const itemsDb = {
  'o1': [
    { id: 'i1', productName: 'Laptop', price: 1000, quantity: 1 },
    { id: 'i2', productName: 'Mouse', price: 50, quantity: 2 }
  ],
  'o2': [
    { id: 'i3', productName: 'Keyboard', price: 100, quantity: 1 }
  ],
  'o3': [
    { id: 'i4', productName: 'Monitor', price: 300, quantity: 2 }
  ],
  'o4': [
    { id: 'i5', productName: 'HDMI Cable', price: 10, quantity: 3 }
  ],
  'o5': [
    { id: 'i6', productName: 'Desk Lamp', price: 45, quantity: 1 }
  ]
};

for (let i = 1; i <= 50; i++) {
  itemsDb[`o_u2_${i}`] = [
    { id: `i_u2_${i}_1`, productName: `Product ${i}`, price: 10 + i, quantity: 1 }
  ];
}

const db = {
  async getOrdersByUserId(userId, limit, offset) {
    queryCount++;
    const userOrders = ordersDb.filter(o => o.userId === userId);
    return userOrders.slice(offset, offset + limit);
  },
  async getOrderItems(orderId) {
    queryCount++;
    return itemsDb[orderId] || [];
  },
  async getOrderItemsBatch(orderIds) {
    queryCount++;
    const result = {};
    for (const id of orderIds) {
      result[id] = itemsDb[id] || [];
    }
    return result;
  },
  getQueryCount() {
    return queryCount;
  },
  resetQueryCount() {
    queryCount = 0;
  }
};

app.get('/orders', async (req, res) => {
  const { userId, limit = 10, offset = 0 } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const parsedLimit = parseInt(limit, 10);
    const parsedOffset = parseInt(offset, 10);
    const orders = await db.getOrdersByUserId(userId, parsedLimit, parsedOffset);

    const ordersWithItems = [];
    for (const order of orders) {
      const items = await db.getOrderItems(order.id);
      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      ordersWithItems.push({
        ...order,
        items,
        total
      });
    }

    res.json({
      orders: ordersWithItems,
      count: ordersWithItems.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { app, db };
