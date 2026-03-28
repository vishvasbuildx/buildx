const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const compression = require('compression');
const helmet = require('helmet');

const {
  User, Material, Inventory, CartItem, Order, Notification, HireRequest
} = require('./models');

const app = express();

/* ── Performance: Gzip compression for all responses ─────────── */
app.use(compression());

/* ── Security headers via helmet (replaces manual headers) ───── */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

/* ── Database Connection ────────────────────────────────────── */
let mongodInstance = null;

async function connectDB() {
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Connected to MongoDB Atlas');
  } else {
    try {
      const dbPath = path.join(__dirname, 'mongo_data');
      if (!fs.existsSync(dbPath)) fs.mkdirSync(dbPath, { recursive: true });

      // Try port 27017 first, fall back to random port if busy
      let port = 27017;
      try {
        mongodInstance = await MongoMemoryServer.create({
          instance: { port, dbPath, storageEngine: 'wiredTiger' }
        });
      } catch {
        mongodInstance = await MongoMemoryServer.create({
          instance: { dbPath, storageEngine: 'wiredTiger' }
        });
      }

      const uri = mongodInstance.getUri();
      await mongoose.connect(uri, { maxPoolSize: 10 });
      console.log(`✅ Connected to Local MongoDB at ${uri}`);

      // Seed materials if empty
      await seedMaterials();
    } catch (err) {
      console.error('❌ Failed to start local MongoDB:', err.message);
      process.exit(1);
    }
  }

  // Add indexes for fast queries
  await User.collection.createIndex({ email: 1 }, { unique: true }).catch(() => {});
  await User.collection.createIndex({ role: 1 }).catch(() => {});
  await Inventory.collection.createIndex({ materialId: 1, sellerId: 1 }).catch(() => {});
  await CartItem.collection.createIndex({ userId: 1 }).catch(() => {});
  await Order.collection.createIndex({ userId: 1 }).catch(() => {});
  await Notification.collection.createIndex({ sellerId: 1 }).catch(() => {});
}

/* ── Seed default materials ──────────────────────────────────── */
async function seedMaterials() {
  const count = await Material.countDocuments();
  if (count > 0) return;

  const materials = [
    { id: 1, name: 'Cement', sub: 'OPC 53 Grade', icon: '🏗️', category: 'Basic', unit: 'bag', description: 'Premium quality OPC 53 Grade cement', image: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&q=80&w=600' },
    { id: 2, name: 'TMT Steel', sub: 'Fe-500D Grade', icon: '⚙️', category: 'Structure', unit: 'ton', description: 'High-strength TMT steel bars', image: 'https://images.unsplash.com/photo-1533090368676-1fd25485db88?auto=format&fit=crop&q=80&w=600' },
    { id: 3, name: 'Bricks', sub: 'Red Clay Bricks', icon: '🧱', category: 'Basic', unit: '1000 pcs', description: 'Standard red clay bricks', image: 'https://images.unsplash.com/photo-1589326442617-64b58ad52f86?auto=format&fit=crop&q=80&w=600' },
    { id: 4, name: 'River Sand', sub: 'M-Sand / River', icon: '🏖️', category: 'Aggregate', unit: 'cubic ft', description: 'Clean river sand for construction', image: 'https://images.unsplash.com/photo-1549045558-8b940ce9b29e?auto=format&fit=crop&q=80&w=600' },
    { id: 5, name: 'Gravel', sub: '20mm Aggregate', icon: '⛏️', category: 'Aggregate', unit: 'cubic ft', description: 'Crushed stone aggregate', image: 'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?auto=format&fit=crop&q=80&w=600' },
    { id: 6, name: 'Tiles', sub: 'Vitrified / Ceramic', icon: '🪟', category: 'Finishing', unit: 'sq ft', description: 'Premium quality floor and wall tiles', image: 'https://images.unsplash.com/photo-1524247547167-9321d5830985?auto=format&fit=crop&q=80&w=600' },
    { id: 7, name: 'Paint', sub: 'Interior / Exterior', icon: '🎨', category: 'Finishing', unit: 'litre', description: 'High-quality wall paint', image: 'https://images.unsplash.com/photo-1562184552-32b0cc9da6be?auto=format&fit=crop&q=80&w=600' },
  ];

  await Material.insertMany(materials);
  console.log('✅ Default materials seeded.');
}

connectDB();

/* ── Middleware ─────────────────────────────────────────────── */
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true, limit: '3mb' }));

// Serve static files with caching headers for performance
app.use(express.static(path.join(__dirname), {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // Don't cache HTML files (always fresh)
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use(session({
  secret: process.env.SESSION_SECRET || 'buildx-secret-2026-secure',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
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

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() }).lean();
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = new User({
      id: uuidv4(),
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone || null,
      city: city || null,
      role,
      passwordHash: hash,
      createdAt: new Date().toISOString(),
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

    const userObj = user.toObject();
    delete userObj.passwordHash;
    res.json({ success: true, user: userObj });
  } catch (err) {
    console.error('Register error:', err.message);
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

/* Login */
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'No account found with that email.' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });

    req.session.userId = user.id;
    req.session.role = user.role;

    const userObj = user.toObject();
    delete userObj.passwordHash;
    res.json({ success: true, user: userObj });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* Logout */
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Session destroy error:', err);
    res.json({ success: true });
  });
});

/* Current user */
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.session.userId }).lean();
    if (!user) return res.status(404).json({ error: 'User not found.' });
    delete user.passwordHash;
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

/* Upload profile photo */
app.put('/api/profile/photo', requireAuth, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'No image provided.' });

    if (!image.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid image format. Please upload a JPG, PNG or WebP.' });
    }
    if (image.length > 2_500_000) {
      return res.status(400).json({ error: 'Image too large. Please upload under 2 MB.' });
    }

    const user = await User.findOneAndUpdate(
      { id: req.session.userId },
      { $set: { image } },
      { new: true, lean: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });
    delete user.passwordHash;
    res.json({ success: true, user });
  } catch (err) {
    console.error('Photo upload error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════════════════════
   CATALOGUE ROUTES (public)
══════════════════════════════════════════════════════════════ */

/* Materials from DB */
app.get('/api/materials', async (_req, res) => {
  try {
    const materials = await Material.find({}).lean();
    res.json(materials);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch materials.' });
  }
});

/* Fix images route */
app.get('/api/fix-images', async (req, res) => {
  const newImages = {
    1: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&q=80&w=600',
    2: 'https://images.unsplash.com/photo-1533090368676-1fd25485db88?auto=format&fit=crop&q=80&w=600',
    3: 'https://images.unsplash.com/photo-1589326442617-64b58ad52f86?auto=format&fit=crop&q=80&w=600',
    4: 'https://images.unsplash.com/photo-1549045558-8b940ce9b29e?auto=format&fit=crop&q=80&w=600',
    5: 'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?auto=format&fit=crop&q=80&w=600',
    6: 'https://images.unsplash.com/photo-1524247547167-9321d5830985?auto=format&fit=crop&q=80&w=600',
    7: 'https://images.unsplash.com/photo-1562184552-32b0cc9da6be?auto=format&fit=crop&q=80&w=600'
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

/* Get sellers for a material */
app.get('/api/materials/:id/sellers', async (req, res) => {
  try {
    const materialId = parseInt(req.params.id);
    if (isNaN(materialId)) return res.status(400).json({ error: 'Invalid material ID.' });

    const inventory = await Inventory.find({ materialId }).lean();
    const sellerIds = inventory.map(i => i.sellerId);
    const sellersMap = {};
    const sellers = await User.find({ id: { $in: sellerIds } }).lean();
    sellers.forEach(s => sellersMap[s.id] = s);

    const result = inventory.map(inv => {
      const seller = sellersMap[inv.sellerId] || {};
      return {
        sellerId: inv.sellerId,
        sellerName: seller.name || 'Unknown',
        business: seller.business || '',
        city: seller.city || '',
        price: inv.price,
        stock: inv.stock,
        openingHours: seller.shopDetails?.openingHours || '',
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sellers.' });
  }
});

/* Get marketplace materials (with sellers) */
app.get('/api/marketplace/materials', async (_req, res) => {
  try {
    const inventory = await Inventory.find({}).lean();
    const listedIds = [...new Set(inventory.map(i => i.materialId))];
    const materials = await Material.find({ id: { $in: listedIds } }).lean();

    const result = materials.map(m => {
      const prices = inventory.filter(i => i.materialId === m.id).map(i => i.price);
      return { ...m, minPrice: prices.length > 0 ? Math.min(...prices) : 0 };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch marketplace.' });
  }
});

/* Get shop profile */
app.get('/api/sellers/:id', async (req, res) => {
  try {
    const seller = await User.findOne({ id: req.params.id, role: 'seller' }).lean();
    if (!seller) return res.status(404).json({ error: 'Seller not found.' });

    const invDocs = await Inventory.find({ sellerId: req.params.id }).lean();
    const materialIds = invDocs.map(i => i.materialId);
    const materials = await Material.find({ id: { $in: materialIds } }).lean();

    const inventory = invDocs.map(inv => {
      const material = materials.find(m => m.id === inv.materialId) || {};
      return { ...material, price: inv.price, stock: inv.stock };
    });

    delete seller.passwordHash;
    res.json({ ...seller, inventory });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch seller.' });
  }
});

app.get('/api/engineers', async (_req, res) => {
  try {
    const users = await User.find({ role: 'engineer' }).lean();
    const engineers = users.map(e => ({
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
    res.json(engineers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch engineers.' });
  }
});

app.get('/api/workers', async (_req, res) => {
  try {
    const users = await User.find({ role: 'worker' }).lean();
    const workers = users.map(w => ({
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
    res.json(workers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch workers.' });
  }
});

/* Update or add seller products */
app.post('/api/seller/products', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'seller') {
      return res.status(403).json({ error: 'Only sellers can manage products.' });
    }

    const { materialId, price, stock } = req.body;
    if (!materialId || price === undefined || stock === undefined) {
      return res.status(400).json({ error: 'materialId, price and stock are required.' });
    }

    const parsedMaterialId = parseInt(materialId);
    const parsedPrice = parseFloat(price);
    const parsedStock = parseInt(stock);

    if (isNaN(parsedMaterialId) || isNaN(parsedPrice) || isNaN(parsedStock)) {
      return res.status(400).json({ error: 'Invalid values for price or stock.' });
    }

    const entry = await Inventory.findOneAndUpdate(
      { materialId: parsedMaterialId, sellerId: req.session.userId },
      { price: parsedPrice, stock: parsedStock },
      { upsert: true, new: true }
    );
    res.json({ success: true, entry });
  } catch (err) {
    console.error('Seller products error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* Delete seller product */
app.delete('/api/seller/products/:materialId', requireAuth, async (req, res) => {
  try {
    if (req.session.role !== 'seller') {
      return res.status(403).json({ error: 'Only sellers can manage products.' });
    }

    const materialId = parseInt(req.params.materialId);
    if (isNaN(materialId)) return res.status(400).json({ error: 'Invalid material ID.' });

    const result = await Inventory.deleteOne({ materialId, sellerId: req.session.userId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Product not found in your inventory.' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════════════════════
   CART & ORDERS
══════════════════════════════════════════════════════════════ */

/* Get cart */
app.get('/api/cart', requireAuth, async (req, res) => {
  try {
    const items = await CartItem.find({ userId: req.session.userId }).lean();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch cart.' });
  }
});

/* Add to cart */
app.post('/api/cart/add', requireAuth, async (req, res) => {
  try {
    const { materialId, qty, sellerId } = req.body;
    if (!materialId || !sellerId) {
      return res.status(400).json({ error: 'materialId and sellerId are required.' });
    }

    const [material, invEntry, seller] = await Promise.all([
      Material.findOne({ id: parseInt(materialId) }).lean(),
      Inventory.findOne({ materialId: parseInt(materialId), sellerId }).lean(),
      User.findOne({ id: sellerId }).lean()
    ]);

    if (!material) return res.status(404).json({ error: 'Material not found.' });
    if (!invEntry) return res.status(404).json({ error: 'This seller does not stock this material.' });

    const quantity = parseInt(qty) || 1;

    const existing = await CartItem.findOneAndUpdate(
      { userId: req.session.userId, materialId: material.id, sellerId },
      { $inc: { qty: quantity } },
      { new: true }
    );

    if (!existing) {
      await CartItem.create({
        id: uuidv4(),
        userId: req.session.userId,
        materialId: material.id,
        sellerId,
        sellerName: seller?.name || 'Unknown',
        name: material.name,
        icon: material.icon,
        price: invEntry.price,
        unit: material.unit,
        qty: quantity,
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Cart add error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* Remove from cart */
app.delete('/api/cart/:id', requireAuth, async (req, res) => {
  try {
    await CartItem.deleteOne({ id: req.params.id, userId: req.session.userId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

/* Checkout — place order */
app.post('/api/checkout', requireAuth, async (req, res) => {
  try {
    const { address, location } = req.body;
    const items = await CartItem.find({ userId: req.session.userId }).lean();
    if (!items.length) return res.status(400).json({ error: 'Cart is empty.' });

    const buyer = await User.findOne({ id: req.session.userId });

    if (buyer) {
      const updates = {};
      if (address && buyer.deliveryAddress !== address) updates.deliveryAddress = address;
      if (location && buyer.location !== location) updates.location = location;
      if (Object.keys(updates).length) await User.updateOne({ id: buyer.id }, updates);
    }

    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    const order = new Order({
      id: uuidv4(),
      userId: req.session.userId,
      deliveryAddress: address || buyer?.deliveryAddress || 'Not specified',
      location: location || buyer?.location || buyer?.city || 'Not specified',
      items: items.map(({ userId, _id, ...rest }) => rest),
      total,
      status: 'Confirmed',
      placedAt: new Date().toISOString(),
    });

    await order.save();
    await CartItem.deleteMany({ userId: req.session.userId });

    // Group items by seller
    const sellerGroups = items.reduce((acc, item) => {
      if (!acc[item.sellerId]) acc[item.sellerId] = { items: [], total: 0 };
      acc[item.sellerId].items.push(item);
      acc[item.sellerId].total += item.price * item.qty;
      return acc;
    }, {});

    const sellerIds = Object.keys(sellerGroups);
    const sellers = await User.find({ id: { $in: sellerIds } }).lean();
    const sellersMap = {};
    sellers.forEach(s => sellersMap[s.id] = s);

    const sellerLinks = [];

    for (const sellerId of sellerIds) {
      const seller = sellersMap[sellerId];
      if (seller?.phone) {
        const group = sellerGroups[sellerId];
        const itemText = group.items.map(i => `- ${i.qty} x ${i.name} (₹${i.price})`).join('\n');

        const message = `*Order from BuildX* 🏗️\n\n` +
          `Hello ${seller.business || seller.name},\n` +
          `New order received!\n\n` +
          `*Items:*\n${itemText}\n\n` +
          `*Total:* ₹${group.total.toLocaleString('en-IN')}\n\n` +
          `*Buyer:*\n` +
          `Name: ${buyer?.name || 'Customer'}\n` +
          `Phone: ${buyer?.phone || 'N/A'}\n` +
          `Delivery: ${address || buyer?.deliveryAddress || 'N/A'}\n\n` +
          `Please prepare the order.`;

        const cleanPhone = seller.phone.replace(/\D/g, '');
        const waPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
        const whatsappUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;

        sellerLinks.push({ sellerName: seller.business || seller.name, message, whatsappUrl });

        // Save notification (don't await — fire and forget)
        Notification.create({
          id: uuidv4(),
          orderId: order.id,
          sellerId,
          sellerName: seller.name,
          phone: waPhone,
          message,
          status: 'Sent',
          timestamp: new Date().toISOString()
        }).catch(err => console.error('Notification save error:', err.message));
      }
    }

    res.json({ success: true, order, notificationStatus: 'Sent', whatsappLinks: sellerLinks });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'Checkout failed. Please try again.' });
  }
});

/* Get my orders */
app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.session.userId }).lean().sort({ placedAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

/* Get notifications for seller */
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const notes = await Notification.find({ sellerId: req.session.userId }).lean().sort({ _id: -1 }).limit(50);
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

/* Get WhatsApp links for an order */
app.get('/api/order-whatsapp/:orderId', requireAuth, async (req, res) => {
  try {
    const order = await Order.findOne({ id: req.params.orderId }).lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const buyer = await User.findOne({ id: order.userId }).lean();
    const sellerGroups = order.items.reduce((acc, item) => {
      if (!acc[item.sellerId]) acc[item.sellerId] = { items: [], total: 0 };
      acc[item.sellerId].items.push(item);
      acc[item.sellerId].total += item.price * item.qty;
      return acc;
    }, {});

    const sellerIds = Object.keys(sellerGroups);
    const sellers = await User.find({ id: { $in: sellerIds } }).lean();
    const sellersMap = {};
    sellers.forEach(s => sellersMap[s.id] = s);

    const sellerLinks = sellerIds.map(sellerId => {
      const seller = sellersMap[sellerId];
      if (!seller?.phone) return null;

      const group = sellerGroups[sellerId];
      const itemText = group.items.map(i => `- ${i.qty} x ${i.name} (₹${i.price})`).join('\n');
      const message = `*Order from BuildX* 🏗️\n\n*Order ID:* ${order.id.slice(0, 8)}\n*Items:*\n${itemText}\n\n*Total:* ₹${group.total.toLocaleString('en-IN')}\n\n*Buyer:*\nName: ${buyer?.name || 'Customer'}\nDelivery: ${order.deliveryAddress || 'N/A'}`;

      const cleanPhone = seller.phone.replace(/\D/g, '');
      const waPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

      return { sellerName: seller.business || seller.name, whatsappUrl: `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}` };
    }).filter(Boolean);

    res.json({ whatsappLinks: sellerLinks });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch WhatsApp links.' });
  }
});

/* ══════════════════════════════════════════════════════════════
   HIRE REQUESTS
══════════════════════════════════════════════════════════════ */

/* Send hire request */
app.post('/api/hire', requireAuth, async (req, res) => {
  try {
    const { professionalId, professionalName, professionalType, startDate, location, message } = req.body;
    if (!professionalId || !professionalType) {
      return res.status(400).json({ error: 'Professional ID and type required.' });
    }

    const user = await User.findOne({ id: req.session.userId }).lean();

    const hireReq = await HireRequest.create({
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

    res.json({ success: true, hireReq });
  } catch (err) {
    console.error('Hire request error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* Get hire requests */
app.get('/api/hire-requests', requireAuth, async (req, res) => {
  try {
    const user = await User.findOne({ id: req.session.userId }).lean();
    if (!user) return res.status(404).json({ error: 'User not found.' });

    let requests;
    if (user.role === 'engineer' || user.role === 'worker') {
      requests = await HireRequest.find({ professionalType: user.role }).lean();
    } else {
      requests = await HireRequest.find({ requesterId: req.session.userId }).lean();
    }
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch hire requests.' });
  }
});

/* ── Health check ────────────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

/* ══════════════════════════════════════════════════════════════
   CATCH-ALL: serve index.html
══════════════════════════════════════════════════════════════ */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ── Global error handler ────────────────────────────────────── */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

/* ── Start ──────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;

function getLocalIP() {
  const interfaces = require('os').networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// Kill existing process on port before starting
const server = app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log(`\n  🚀  BuildX Server is ACTIVE`);
  console.log(`  🌐  Local:   http://localhost:${PORT}`);
  console.log(`  📡  Network: http://${ip}:${PORT}`);
  console.log(`  ✅  Ready to accept connections\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use!`);
    console.error(`   Run this command to fix it:`);
    console.error(`   npx kill-port ${PORT}\n`);
    process.exit(1);
  } else {
    throw err;
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  server.close();
  await mongoose.connection.close();
  if (mongodInstance) await mongodInstance.stop();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// Export for Vercel Serverless Functions
module.exports = app;
