const mongoose = require('mongoose');

// Models use the global mongoose connection established in server.js

const UserSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true }, // Keeping string ID to maintain compatibility with UUIDs used previously
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: String,
    city: String,
    role: { type: String, required: true },
    passwordHash: { type: String, required: true },
    createdAt: { type: String, default: () => new Date().toISOString() },
    business: String,
    gst: String,
    materialType: String,
    specialisation: String,
    experience: String,
    rate: String,
    certifications: String,
    skill: String,
    workerExp: String,
    workerRate: String,
    image: String,
    deliveryAddress: String,
    location: String,
    shopDetails: {
        bio: String,
        openingHours: String,
        status: String,
        offers: [String]
    },
    stars: Number,
    emoji: String
});

const MaterialSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    name: String,
    sub: String,
    icon: String,
    image: String,
    category: String,
    unit: String,
    description: String,
    specs: [{ label: String, value: String }],
    rating: Number,
    reviewCount: Number,
    isPrime: Boolean,
    reviews: [{ user: String, rating: Number, comment: String, date: String }]
});

const InventorySchema = new mongoose.Schema({
    materialId: { type: Number, required: true },
    sellerId: { type: String, required: true },
    price: Number,
    stock: Number
});

const CartItemSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    materialId: Number,
    sellerId: String,
    sellerName: String,
    name: String,
    icon: String,
    price: Number,
    unit: String,
    qty: Number
});

const OrderSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    deliveryAddress: String,
    location: String,
    total: Number,
    status: String,
    placedAt: String,
    items: [{
        materialId: Number,
        sellerId: String,
        sellerName: String,
        name: String,
        icon: String,
        price: Number,
        unit: String,
        qty: Number
    }]
});

const NotificationSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    orderId: String,
    sellerId: String,
    sellerName: String,
    phone: String,
    message: String,
    status: String,
    timestamp: String
});

const HireRequestSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    requesterId: String,
    requesterName: String,
    requesterPhone: String,
    professionalId: String, // Kept as String or Number (in db.json some are UUIDs, some might be parsed ints, we use String to be safe)
    professionalName: String,
    professionalType: String,
    startDate: String,
    location: String,
    message: String,
    status: String,
    createdAt: String
});

const User = mongoose.model('User', UserSchema);
const Material = mongoose.model('Material', MaterialSchema);
const Inventory = mongoose.model('Inventory', InventorySchema);
const CartItem = mongoose.model('CartItem', CartItemSchema);
const Order = mongoose.model('Order', OrderSchema);
const Notification = mongoose.model('Notification', NotificationSchema);
const HireRequest = mongoose.model('HireRequest', HireRequestSchema);

module.exports = {
    User,
    Material,
    Inventory,
    CartItem,
    Order,
    Notification,
    HireRequest
};
