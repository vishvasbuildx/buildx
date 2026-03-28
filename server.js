const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const {
  User, Material, Inventory, CartItem, Order, Notification, HireRequest
} = require('./models');

const app = express();

// --- SECURITY HEADERS ---
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;");
  next();
});

/* ── Database Connection ────────────────────────────────────── */
// If MONGODB_URI is provided, connect to it (e.g. Atlas).
// Otherwise, automatically spin up a local MongoDB binary that stores data in /mongo_data
async function connectDB() {
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB Atlas');
  } else {
    try {
      // Create a persistent local directory for our database
      const dbPath = path.join(__dirname, 'mongo_data');
      if (!fs.existsSync(dbPath)) fs.mkdirSync(dbPath);

      const mongod = await MongoMemoryServer.create({
        instance: {
          port: 27017,
          dbPath: dbPath,
          // Removed storageEngine: 'wiredTiger' as it's default and can cause issues on some systems
        }
      });
      const uri = mongod.getUri();
      await mongoose.connect(uri);
      console.log(`✅ Connected to Auto-Provisioned Local MongoDB at ${uri}`);
    } catch (err) {
      console.error('❌ Failed to start local MongoDB:', err);
      process.exit(1);
    }
  }
}

connectDB();

/* ── Email Helper ───────────────────────────────────────────── */
// Configure Nodemailer with Ethereal for testing.
// For production, use your actual SMTP details.
async function sendOrderEmail(sellerEmail, buyerName, itemsDescription) {
  try {
    // Generate test SMTP service account from ethereal.email
    let testAccount = await nodemailer.createTestAccount();

    const transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: testAccount.user, // generated ethereal user
        pass: testAccount.pass, // generated ethereal password
      },
    });

    const info = await transporter.sendMail({
      from: '"BuildX" <noreply@constructhub.com>',
      to: sellerEmail,
      subject: "New Order Placed!",
      text: `Hello, ${buyerName} has placed an order for: ${itemsDescription}`,
      html: `<p>Hello,</p><p><strong>${buyerName}</strong> has placed an order for:</p><p>${itemsDescription}</p>`,
    });

    console.log("Message sent: %s", info.messageId);
    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
  } catch (err) {
    console.error("Error sending email:", err);
  }
}

/* ── Image Update Route ─────────────────────────────────────── */
app.get('/api/fix-images', async (req, res) => {
  const newImages = {
    1: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&q=80&w=600', // Cement
    2: 'https://images.unsplash.com/photo-1533090368676-1fd25485db88?auto=format&fit=crop&q=80&w=600', // Steel
    3: 'https://images.unsplash.com/photo-1589326442617-64b58ad52f86?auto=format&fit=crop&q=80&w=600', // Bricks
    4: 'https://images.unsplash.com/photo-1549045558-8b940ce9b29e?auto=format&fit=crop&q=80&w=600', // Sand
    5: 'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?auto=format&fit=crop&q=80&w=600', // Gravel
    6: 'https://images.unsplash.com/photo-1524247547167-9321d5830985?auto=format&fit=crop&q=80&w=600', // Tiles
    7: 'https://images.unsplash.com/photo-1562184552-32b0cc9da6be?auto=format&fit=crop&q=80&w=600' // Paint
  };
  try {
    for (let id of Object.keys(newImages)) {
        await Material.updateOne({ id: parseInt(id) }, { image: newImages[id] });
    }
    res.send('Images updated successfully');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* ── Middleware ─────────────────────────────────────────────── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.use(session({
  secret: 'constructhub-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

/* ── Auth middleware ────────────────────────────────────────── */
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

/* ══════════════════════════════════════════════════════════════
   AUTH ROUTES
══════════════════════════════════════════════════════════════ */

/* Register */
app.post('/api/register', async (req, res) => {
  try {
    const {
      name, email, phone, city, password, role,
      business, gst, materialType,
      specialisation, experience, rate, certifications,
      skill, workerExp, workerRate, image
    } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password and role are required.' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = new User({
      id: uuidv4(),
      name, email, phone, city, role,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
      // extra fields
      business: business || null,
      gst: gst || null,
      materialType: materialType || null,
      specialisation: specialisation || null,
      experience: experience || null,
      rate: rate || null,
      certifications: certifications || null,
      skill: skill || null,
      workerExp: workerExp || null,
      workerRate: workerRate || null,
      image: image || null,
    });

    await user.save();

    req.session.userId = user.id;
    req.session.role = user.role;

    const { passwordHash, ...safeUser } = user.toObject();
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

/* Login */
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'No account found with that email.' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });

    req.session.userId = user.id;
    req.session.role = user.role;

    const { passwordHash, ...safeUser } = user.toObject();
    res.json({ success: true, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

/* Logout */
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

/* Current user */
app.get('/api/me', requireAuth, async (req, res) => {
  const user = await User.findOne({ id: req.session.userId });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { passwordHash, ...safeUser } = user.toObject();
  res.json(safeUser);
});

/* Upload profile photo (engineers & workers) */
app.put('/api/profile/photo', requireAuth, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided.' });

    // Accept base64 data URLs only (max ~2MB)
    if (!image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid image format. Please upload a JPG, PNG or WebP.' });
    }
    if (image.length > 2_500_000) {
      return res.status(400).json({ error: 'Image too large. Please upload under 2 MB.' });
    }

    const user = await User.findOneAndUpdate(
      { id: req.session.userId },
      { $set: { image } },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const { passwordHash, ...safeUser } = user.toObject();
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════════════════════
   CATALOGUE ROUTES (public)
══════════════════════════════════════════════════════════════ */

/* Materials from DB */
app.get('/api/materials', async (_req, res) => {
  const materials = await Material.find({});
  res.json(materials);
});

/* Get sellers for a material */
app.get('/api/materials/:id/sellers', async (req, res) => {
  const materialId = parseInt(req.params.id);
  const inventory = await Inventory.find({ materialId });

  const sellers = [];
  for (const inv of inventory) {
    const seller = await User.findOne({ id: inv.sellerId });
    sellers.push({
      sellerId: inv.sellerId,
      sellerName: seller ? seller.name : 'Unknown',
      business: seller ? seller.business : '',
      city: seller ? seller.city : '',
      price: inv.price,
      stock: inv.stock,
      openingHours: seller && seller.shopDetails ? seller.shopDetails.openingHours : '',
    });
  }
  res.json(sellers);
});

/* Get materials that have at least one seller listing (Marketplace) */
app.get('/api/marketplace/materials', async (_req, res) => {
  const inventory = await Inventory.find({});
  const listedIds = [...new Set(inventory.map(i => i.materialId))];

  const materials = await Material.find({ id: { $in: listedIds } });

  const filtered = materials.map(m => {
    const prices = inventory.filter(i => i.materialId === m.id).map(i => i.price);
    return {
      ...m.toObject(),
      minPrice: prices.length > 0 ? Math.min(...prices) : 0
    };
  });
  res.json(filtered);
});

/* Get shop profile */
app.get('/api/sellers/:id', async (req, res) => {
  const seller = await User.findOne({ id: req.params.id, role: 'seller' });
  if (!seller) return res.status(404).json({ error: 'Seller not found.' });

  const invDocs = await Inventory.find({ sellerId: req.params.id });
  const materialIds = invDocs.map(i => i.materialId);
  const materials = await Material.find({ id: { $in: materialIds } });

  const inventory = invDocs.map(inv => {
    const material = materials.find(m => m.id === inv.materialId);
    return { ...(material ? material.toObject() : {}), price: inv.price, stock: inv.stock };
  });

  const { passwordHash, ...safeSeller } = seller.toObject();
  res.json({ ...safeSeller, inventory });
});

app.get('/api/engineers', async (_req, res) => {
  const users = await User.find({ role: 'engineer' });
  const engines = users.map(e => ({
    id: e.id,
    name: e.name,
    role: e.specialisation || 'Civil Engineer',
    stars: e.stars || 4,
    exp: (e.experience || '5') + ' yrs',
    rate: e.rate || 0,
    city: e.city || 'Chennai',
    emoji: e.emoji || '👨‍💼',
    image: e.image || null,
    spec: e.specialisation || 'Construction'
  }));
  res.json(engines);
});

app.get('/api/workers', async (_req, res) => {
  const users = await User.find({ role: 'worker' });
  const wrks = users.map(w => ({
    id: w.id,
    name: w.name,
    role: w.skill || 'Worker',
    stars: w.stars || 4,
    exp: (w.workerExp || '5') + ' yrs',
    rate: w.workerRate || 0,
    city: w.city || 'Chennai',
    emoji: w.emoji || '👷',
    image: w.image || null
  }));
  res.json(wrks);
});

/* Update or add seller products */
app.post('/api/seller/products', requireAuth, async (req, res) => {
  if (req.session.role !== 'seller') {
    return res.status(403).json({ error: 'Only sellers can manage products.' });
  }

  const { materialId, price, stock } = req.body;
  if (!materialId || price === undefined || stock === undefined) {
    return res.status(400).json({ error: 'materialId, price and stock are required.' });
  }

  let entry = await Inventory.findOne({ materialId: parseInt(materialId), sellerId: req.session.userId });

  if (entry) {
    entry.price = parseFloat(price);
    entry.stock = parseInt(stock);
    await entry.save();
  } else {
    entry = new Inventory({
      materialId: parseInt(materialId),
      sellerId: req.session.userId,
      price: parseFloat(price),
      stock: parseInt(stock)
    });
    await entry.save();
  }

  res.json({ success: true, entry });
});

/* Delete seller product */
app.delete('/api/seller/products/:materialId', requireAuth, async (req, res) => {
  if (req.session.role !== 'seller') {
    return res.status(403).json({ error: 'Only sellers can manage products.' });
  }

  const materialId = parseInt(req.params.materialId);

  const result = await Inventory.deleteOne({ materialId, sellerId: req.session.userId });

  if (result.deletedCount === 0) {
    return res.status(404).json({ error: 'Product not found in your inventory.' });
  }

  res.json({ success: true });
});

/* ══════════════════════════════════════════════════════════════
   CART & ORDERS
══════════════════════════════════════════════════════════════ */

/* Get cart */
app.get('/api/cart', requireAuth, async (req, res) => {
  const items = await CartItem.find({ userId: req.session.userId });
  res.json(items);
});

/* Add to cart */
app.post('/api/cart/add', requireAuth, async (req, res) => {
  const { materialId, qty, sellerId } = req.body;

  const material = await Material.findOne({ id: parseInt(materialId) });
  if (!material) return res.status(404).json({ error: 'Material not found.' });

  const invEntry = await Inventory.findOne({ materialId: material.id, sellerId });
  if (!invEntry) return res.status(404).json({ error: 'This seller does not stock this material.' });

  const seller = await User.findOne({ id: sellerId });

  let existing = await CartItem.findOne({ userId: req.session.userId, materialId: material.id, sellerId });

  if (existing) {
    existing.qty += parseInt(qty) || 1;
    await existing.save();
  } else {
    existing = new CartItem({
      id: uuidv4(),
      userId: req.session.userId,
      materialId: material.id,
      sellerId: sellerId,
      sellerName: seller ? seller.name : 'Unknown',
      name: material.name,
      icon: material.icon,
      price: invEntry.price,
      unit: material.unit,
      qty: parseInt(qty) || 1,
    });
    await existing.save();
  }
  res.json({ success: true });
});

/* Remove from cart */
app.delete('/api/cart/:id', requireAuth, async (req, res) => {
  await CartItem.deleteOne({ id: req.params.id, userId: req.session.userId });
  res.json({ success: true });
});

/* Checkout — place order */
app.post('/api/checkout', requireAuth, async (req, res) => {
  const { address, location } = req.body;
  const items = await CartItem.find({ userId: req.session.userId });
  if (!items.length) return res.status(400).json({ error: 'Cart is empty.' });

  const buyer = await User.findOne({ id: req.session.userId });

  // Update buyer info if provided
  if (buyer) {
    let changed = false;
    if (address && buyer.deliveryAddress !== address) { buyer.deliveryAddress = address; changed = true; }
    if (location && buyer.location !== location) { buyer.location = location; changed = true; }
    if (changed) await buyer.save();
  }

  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const order = new Order({
    id: uuidv4(),
    userId: req.session.userId,
    deliveryAddress: address || buyer?.deliveryAddress || 'Not specified',
    location: location || buyer?.location || buyer?.city || 'Not specified',
    items: items.map(i => {
      const { userId, _id, ...rest } = i.toObject();
      return rest;
    }),
    total,
    status: 'Confirmed',
    placedAt: new Date().toISOString(),
  });

  await order.save();
  await CartItem.deleteMany({ userId: req.session.userId });

  // Group items by seller and generate WhatsApp links
  const sellerLinks = [];
  const sellerGroups = items.reduce((acc, item) => {
    if (!acc[item.sellerId]) acc[item.sellerId] = { items: [], total: 0 };
    acc[item.sellerId].items.push(item);
    acc[item.sellerId].total += item.price * item.qty;
    return acc;
  }, {});

  for (const sellerId in sellerGroups) {
    const seller = await User.findOne({ id: sellerId });
    if (seller && seller.phone) {
      const group = sellerGroups[sellerId];
      const itemText = group.items.map(i => `- ${i.qty} x ${i.name} (₹${i.price})`).join('\n');

      const message = `*Order from BuildX Company* 🏗️\n\n` +
        `Hello ${seller.business || seller.name},\n` +
        `We have received a new order and need the following items made ready for dispatch:\n\n` +
        `*Items:*\n${itemText}\n\n` +
        `*Total Amount:* ₹${group.total.toLocaleString()}\n\n` +
        `*Buyer Details:*\n` +
        `Name: ${buyer?.name || 'Customer'}\n` +
        `Phone: ${buyer?.phone || 'N/A'}\n` +
        `Delivery: ${address || buyer?.deliveryAddress || 'N/A'}\n\n` +
        `Please make the order ready as soon as possible.`;

      const cleanPhone = seller.phone.replace(/\D/g, '');
      const waPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

      const encodedMsg = encodeURIComponent(message);
      const whatsappUrl = `https://wa.me/${waPhone}?text=${encodedMsg}`;

      sellerLinks.push({
        sellerName: seller.business || seller.name,
        message: message,
        whatsappUrl: whatsappUrl
      });

      // --- SIMULATE AUTOMATIC BACKGROUND SEND ---
      console.log(`\n📲 [BACKGROUND NOTIFICATION] Sending WhatsApp to: ${seller.name} (${waPhone})`);
      console.log(`Message Preview:\n------------------\n${message}\n------------------`);

      // Save notification record
      const notification = new Notification({
        id: uuidv4(),
        orderId: order.id,
        sellerId: sellerId,
        sellerName: seller.name,
        phone: waPhone,
        message: message,
        status: 'Sent Automatically',
        timestamp: new Date().toISOString()
      });
      await notification.save();

      // Also send preview email
      if (seller.email) {
        sendOrderEmail(seller.email, buyer?.name || 'A customer', group.items.map(i => `${i.qty} ${i.name}`).join(', '));
      }
    }
  }

  res.json({ success: true, order, notificationStatus: "Sent Automatically", whatsappLinks: sellerLinks });
});

/* Get my orders */
app.get('/api/orders', requireAuth, async (req, res) => {
  const orders = await Order.find({ userId: req.session.userId });
  res.json(orders);
});

/* Get notifications for seller */
app.get('/api/notifications', requireAuth, async (req, res) => {
  const notes = await Notification.find({ sellerId: req.session.userId }).sort({ _id: -1 });
  res.json(notes);
});

/* Get WhatsApp links for an order */
app.get('/api/order-whatsapp/:orderId', requireAuth, async (req, res) => {
  const order = await Order.findOne({ id: req.params.orderId });
  if (!order) return res.status(404).json({ error: "Order not found" });

  const buyer = await User.findOne({ id: order.userId });
  const sellerLinks = [];

  // Group items by seller
  const sellerGroups = order.items.reduce((acc, item) => {
    if (!acc[item.sellerId]) acc[item.sellerId] = { items: [], total: 0 };
    acc[item.sellerId].items.push(item);
    acc[item.sellerId].total += item.price * item.qty;
    return acc;
  }, {});

  for (const sellerId in sellerGroups) {
    const seller = await User.findOne({ id: sellerId });
    if (seller && seller.phone) {
      const group = sellerGroups[sellerId];
      const itemText = group.items.map(i => `- ${i.qty} x ${i.name} (₹${i.price})`).join('\n');

      const message = `*Order from BuildX Company* 🏗️\n\n` +
        `Hello ${seller.business || seller.name},\n` +
        `We have received a new order and need the following items made ready for dispatch:\n\n` +
        `*Order ID:* ${order.id.slice(0, 8)}\n` +
        `*Items:*\n${itemText}\n\n` +
        `*Total Amount:* ₹${group.total.toLocaleString()}\n\n` +
        `*Buyer Details:*\n` +
        `Name: ${buyer?.name || 'Customer'}\n` +
        `Phone: ${buyer?.phone || 'N/A'}\n` +
        `Delivery: ${order.deliveryAddress || 'N/A'}\n\n` +
        `Please make the order ready as soon as possible.`;

      const cleanPhone = seller.phone.replace(/\D/g, '');
      const waPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const encodedMsg = encodeURIComponent(message);

      sellerLinks.push({
        sellerName: seller.business || seller.name,
        whatsappUrl: `https://wa.me/${waPhone}?text=${encodedMsg}`
      });
    }
  }

  res.json({ whatsappLinks: sellerLinks });
});

/* ══════════════════════════════════════════════════════════════
   HIRE REQUESTS
══════════════════════════════════════════════════════════════ */

/* Send hire request */
app.post('/api/hire', requireAuth, async (req, res) => {
  const { professionalId, professionalName, professionalType, startDate, location, message } = req.body;
  if (!professionalId || !professionalType) return res.status(400).json({ error: 'Professional ID and type required.' });

  const user = await User.findOne({ id: req.session.userId });

  const hireReq = new HireRequest({
    id: uuidv4(),
    requesterId: req.session.userId,
    requesterName: user?.name || 'Unknown',
    requesterPhone: user?.phone || '',
    professionalId: String(professionalId),
    professionalName: professionalName || '',
    professionalType,
    startDate: startDate || '',
    location: location || '',
    message: message || '',
    status: 'Pending',
    createdAt: new Date().toISOString(),
  });

  await hireReq.save();
  res.json({ success: true, hireReq });
});

/* Get hire requests (sent by me OR for my professional ID if engineer/worker) */
app.get('/api/hire-requests', requireAuth, async (req, res) => {
  const user = await User.findOne({ id: req.session.userId });
  if (!user) return res.status(404).json({ error: 'User not found.' });

  let requests;
  if (user.role === 'engineer' || user.role === 'worker') {
    // professionals see incoming requests
    requests = await HireRequest.find({ professionalType: user.role });
  } else {
    // buyers see their own outgoing requests
    requests = await HireRequest.find({ requesterId: req.session.userId });
  }
  res.json(requests);
});

/* ══════════════════════════════════════════════════════════════
   CATCH-ALL: serve index.html
══════════════════════════════════════════════════════════════ */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ── Start ──────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;

function getLocalIP() {
  const interfaces = require('os').networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  🚀  BuildX Server is ACTIVE`);
    console.log(`  🔗  Public Domain: ${process.env.PUBLIC_URL || 'Check Cloudflare Tunnel'}`);
    console.log(`  🌐  Port: ${PORT}\n`);
  });
}

// Export for Vercel Serverless Functions
module.exports = app;
