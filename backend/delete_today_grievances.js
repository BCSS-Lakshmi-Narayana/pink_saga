require('dotenv').config();
const mongoose = require('mongoose');
const Grievance = require('./src/models/Grievance');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('Set MONGODB_URI (and DB_NAME) in backend/.env'); process.exit(1); }
const TIMEZONE = process.env.GRIEVANCE_DELETE_TZ || 'Asia/Kolkata';
const DEFAULT_LIMIT = Number.parseInt(process.env.GRIEVANCE_DELETE_LIMIT || '2000', 10);
const isExecute = process.argv.includes('--execute');
const requestedDateArg = process.argv.find((arg) => arg.startsWith('--date='));
const requestedLimitArg = process.argv.find((arg) => arg.startsWith('--limit='));

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getTargetLimit() {
    if (!requestedLimitArg) return DEFAULT_LIMIT;
    return parsePositiveInteger(requestedLimitArg.split('=')[1], DEFAULT_LIMIT);
}

function getTargetDate() {
    if (requestedDateArg) {
        return requestedDateArg.split('=')[1];
    }

    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

async function deleteLatestGrievances(limit) {
    console.log(`Selecting the latest ${limit} grievances by created_at...`);

    const grievancesToDelete = await Grievance.find({})
        .select({
            _id: 1,
            id: 1,
            tweet_id: 1,
            platform: 1,
            post_date: 1,
            created_at: 1,
            'posted_by.handle': 1
        })
        .sort({ created_at: -1, _id: -1 })
        .limit(limit)
        .lean();

    console.log(`Matching grievances: ${grievancesToDelete.length}`);

    if (!grievancesToDelete.length) {
        console.log('No grievances matched the request.');
        return;
    }

    const preview = grievancesToDelete.slice(0, 5).map((grievance) => ({
        id: grievance.id,
        tweet_id: grievance.tweet_id,
        platform: grievance.platform,
        handle: grievance.posted_by?.handle || '',
        created_at: grievance.created_at,
        post_date: grievance.post_date
    }));

    console.log('Preview of records to delete:', preview);

    if (!isExecute) {
        console.log(`Dry run only. Re-run with --execute to delete the latest ${grievancesToDelete.length} grievances.`);
        return;
    }

    const idsToDelete = grievancesToDelete.map((grievance) => grievance._id);
    const result = await Grievance.deleteMany({ _id: { $in: idsToDelete } });
    console.log(`Deleted ${result.deletedCount} grievances.`);
}

async function deleteGrievancesByDate(targetDate) {
    const query = {
        $expr: {
            $eq: [
                {
                    $dateToString: {
                        date: '$created_at',
                        format: '%Y-%m-%d',
                        timezone: TIMEZONE
                    }
                },
                targetDate
            ]
        }
    };

    console.log(`Target date: ${targetDate} (${TIMEZONE})`);
    const count = await Grievance.countDocuments(query);
    console.log(`Matching grievances: ${count}`);

    if (!isExecute) {
        console.log(`Dry run only. Re-run with --execute to delete grievances for ${targetDate}.`);
        return;
    }

    const result = await Grievance.deleteMany(query);
    console.log(`Deleted ${result.deletedCount} grievances for ${targetDate}.`);
}

async function run() {
    try {
        console.log(`Connecting to MongoDB...`);
        await mongoose.connect(MONGODB_URI, process.env.DB_NAME ? { dbName: process.env.DB_NAME.trim() } : undefined);
        console.log(`Connected to MongoDB.`);

        if (requestedDateArg) {
            await deleteGrievancesByDate(getTargetDate());
        } else {
            await deleteLatestGrievances(getTargetLimit());
        }

        process.exit(0);
    } catch (error) {
        console.error(`Script failed:`, error);
        process.exit(1);
    }
}

run();
