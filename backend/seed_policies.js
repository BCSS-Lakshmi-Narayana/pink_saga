const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config();

async function seedData() {
    try {
        console.log('Connecting to target MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        const db = mongoose.connection.db;
        
        const collections = ['policymappings', 'keywords', 'grievancesettings', 'settings'];
        const inputDir = './data_export';
        
        if (!fs.existsSync(inputDir)) {
            console.error(`Error: Directory ${inputDir} not found. Run the export script first.`);
            process.exit(1);
        }
        
        for (const colName of collections) {
            const filePath = `${inputDir}/${colName}.json`;
            if (!fs.existsSync(filePath)) {
                console.warn(`Warning: File ${filePath} not found, skipping...`);
                continue;
            }
            
            console.log(`Reading ${colName}.json...`);
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            if (data.length === 0) {
                console.log(`No data to seed for ${colName}.`);
                continue;
            }

            // Remove _id from documents to allow MongoDB to generate new ones, 
            // or keep them if you want exact replicas (risky if indices conflict).
            // Here we keep them but wrap in try/catch to handle existing IDs.
            console.log(`Clearing existing data in ${colName}...`);
            await db.collection(colName).deleteMany({});
            
            console.log(`Seeding ${data.length} documents into ${colName}...`);
            await db.collection(colName).insertMany(data);
            console.log(`Successfully seeded ${colName}.`);
        }
        
        console.log('Seeding complete.');
        process.exit(0);
    } catch (err) {
        console.error('Seeding failed:', err);
        process.exit(1);
    }
}

seedData();
