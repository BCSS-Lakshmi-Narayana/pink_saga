const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const dbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/blura_hub';
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;

    const conn = await mongoose.connect(dbUri, dbName ? { dbName } : undefined);
    console.log(`MongoDB Connected: successfully to database`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
