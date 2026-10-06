const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config();

async function exportData() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        const db = mongoose.connection.db;
        
        const collections = ['policymappings', 'keywords', 'grievancesettings', 'settings'];
        const outputDir = './data_export';
        
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }
        
        for (const colName of collections) {
            console.log(`Exporting ${colName}...`);
            const data = await db.collection(colName).find({}).toArray();
            const filePath = `${outputDir}/${colName}.json`;
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            console.log(`Saved ${data.length} documents to ${filePath}`);
        }
        
        console.log('Export complete. Files are in the "data_export" folder.');
        process.exit(0);
    } catch (err) {
        console.error('Export failed:', err);
        process.exit(1);
    }
}

exportData();
