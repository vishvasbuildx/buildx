const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
    User,
    Material,
    Inventory,
    CartItem,
    Order,
    Notification,
    HireRequest
} = require('./models');

const DB_PATH = path.join(__dirname, 'db.json');

async function migrate() {
    try {
        let uri = process.env.MONGODB_URI;

        if (!uri) {
            console.log('No MONGODB_URI found. Starting ephemeral MongoMemoryServer...');
            const dbPath = path.join(__dirname, 'mongo_data');
            if (!fs.existsSync(dbPath)) fs.mkdirSync(dbPath);

            const mongod = await MongoMemoryServer.create({
                instance: { port: 27017, dbPath: dbPath }
            });
            uri = mongod.getUri();
            console.log(`Ephemeral MongoDB started at ${uri}`);
        }

        await mongoose.connect(uri);
        console.log("Connected to MongoDB");

        const rawData = fs.readFileSync(DB_PATH, 'utf8');
        const data = JSON.parse(rawData);

        console.log('Starting migration...');

        if (data.users && data.users.length > 0) {
            await User.deleteMany({});
            await User.insertMany(data.users);
            console.log(`Migrated ${data.users.length} users.`);
        }

        if (data.materials && data.materials.length > 0) {
            await Material.deleteMany({});
            await Material.insertMany(data.materials);
            console.log(`Migrated ${data.materials.length} materials.`);
        }

        if (data.inventory && data.inventory.length > 0) {
            await Inventory.deleteMany({});
            await Inventory.insertMany(data.inventory);
            console.log(`Migrated ${data.inventory.length} inventory items.`);
        }

        if (data.cartItems && data.cartItems.length > 0) {
            await CartItem.deleteMany({});
            await CartItem.insertMany(data.cartItems);
            console.log(`Migrated ${data.cartItems.length} cart items.`);
        } else {
            console.log('No cart items to migrate.');
        }

        if (data.orders && data.orders.length > 0) {
            await Order.deleteMany({});
            await Order.insertMany(data.orders);
            console.log(`Migrated ${data.orders.length} orders.`);
        } else {
            console.log('No orders to migrate.');
        }

        if (data.notifications && data.notifications.length > 0) {
            await Notification.deleteMany({});
            await Notification.insertMany(data.notifications);
            console.log(`Migrated ${data.notifications.length} notifications.`);
        } else {
            console.log('No notifications to migrate.');
        }

        if (data.hireRequests && data.hireRequests.length > 0) {
            await HireRequest.deleteMany({});
            await HireRequest.insertMany(data.hireRequests);
            console.log(`Migrated ${data.hireRequests.length} hire requests.`);
        } else {
            console.log('No hire requests to migrate.');
        }

        console.log('Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
