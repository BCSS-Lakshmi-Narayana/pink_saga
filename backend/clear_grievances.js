require('dotenv').config();
const mongoose = require('mongoose');
const Grievance = require('./src/models/Grievance');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('Set MONGODB_URI (and DB_NAME) in backend/.env'); process.exit(1); }

async function run() {
    try {
        console.log(`Connecting to MongoDB...`);
        await mongoose.connect(MONGODB_URI, process.env.DB_NAME ? { dbName: process.env.DB_NAME.trim() } : undefined);
        console.log(`Connected to MongoDB.`);

        const count = await Grievance.countDocuments();
        console.log(`Current grievance count: ${count}`);

        console.log(`Deleting all grievances...`);
        const result = await Grievance.deleteMany({});
        console.log(`Deleted ${result.deletedCount} grievances.`);

        console.log(`Grievances cleared successfully.`);
        process.exit(0);
    } catch (error) {
        console.error(`Script failed:`, error);
        process.exit(1);
    }
}

run();
