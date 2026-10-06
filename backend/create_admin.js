const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const User = require('./src/models/User');
const { buildEmailLookup, normalizeEmail } = require('./src/utils/authIdentity');

async function createAdmin() {
    try {
        console.log('Connecting to MongoDB...');
        // Same database the server uses (DB_NAME overrides the one in the URI).
        const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
        await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
        console.log(`Using database: ${mongoose.connection.name}`);

        // --special creates the whitelisted special-access admin (GRIEVANCE_ADMIN_* in .env);
        // otherwise the default admin (DEFAULT_ADMIN_*).
        const special = process.argv.includes('--special');
        const prefix = special ? 'GRIEVANCE_ADMIN' : 'DEFAULT_ADMIN';
        const email = normalizeEmail(process.env[`${prefix}_EMAIL`] || (special ? '' : 'admin@brswatch.local'));
        const password = process.env[`${prefix}_PASSWORD`];
        const fullName = process.env[`${prefix}_NAME`] || (special ? 'Grievance Admin' : 'SANKET Super Admin');
        const role = 'superadmin';

        if (!email || !password) {
            console.error(`Set ${prefix}_EMAIL and ${prefix}_PASSWORD in backend/.env before running this script.`);
            process.exit(1);
        }

        const userExists = await User.findOne({ email: buildEmailLookup(email) });
        if (userExists) {
            console.log('User already exists. Updating email, password, and role...');
            const salt = await bcrypt.genSalt(10);
            userExists.email = email;
            userExists.password = await bcrypt.hash(password, salt);
            userExists.role = role;
            userExists.full_name = fullName;
            userExists.is_active = true;
            await userExists.save();
            console.log('User updated successfully.');
        } else {
            console.log('Creating new superadmin user...');
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            
            await User.create({
                email,
                password: hashedPassword,
                full_name: fullName,
                role: role,
                is_active: true
            });
            console.log('Superadmin user created successfully.');
        }
        
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

createAdmin();
