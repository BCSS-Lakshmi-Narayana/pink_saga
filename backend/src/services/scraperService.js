const { spawn } = require('child_process');
const path = require('path');
const TwitterAccount = require('../models/TwitterAccount');

const scrapeProfile = async (targetHandle, account) => {
    return new Promise((resolve, reject) => {
        // Clean handle
        const cleanHandle = targetHandle.replace('@', '');
        console.log(`[Python] Spawning scraper for ${cleanHandle} using ${account.username}...`);

        const scriptPath = path.resolve(__dirname, '../../scripts/scraper.py');
        const pythonProcess = spawn('python', [scriptPath, account.username, cleanHandle]);

        let dataString = '';
        let errorString = '';

        pythonProcess.stdout.on('data', (data) => {
            dataString += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            // Log stderr but don't fail immediately, sometimes Selenium logs harmless warnings
            console.error(`[Python Log]: ${data.toString()}`);
            errorString += data.toString();
        });

        pythonProcess.on('close', async (code) => {
            if (code !== 0) {
                console.error(`Python script exited with code ${code}`);
                // Verify if dataString has content even if code is non-zero (unlikely but possible)
            }

            try {
                // If the script crashed or returned empty string
                if (!dataString.trim()) {
                    console.warn('[Python] No data returned.');
                    resolve([]);
                    return;
                }

                // Parse the JSON output from Python
                const tweets = JSON.parse(dataString);
                console.log(`[Python] Scraped ${tweets.length} tweets.`);

                // Update stats
                account.daily_stats.requests += 1;
                await account.save();

                resolve(tweets);
            } catch (e) {
                console.error('Failed to parse Python output:', e.message);
                console.error('Raw Output:', dataString);
                resolve([]);
            }
        });
    });
};

const getHealthyAccount = async () => {
    // Just find an active one. 
    // In production with Python sessions, we need an account that has a valid session folder.
    // For now, return the first active one.
    const account = await TwitterAccount.findOne({ status: 'active' });
    return account;
};

const closeBrowser = async () => {
    // No-op. Python script handles its own lifecycle per request.
};

module.exports = {
    scrapeProfile,
    getHealthyAccount,
    closeBrowser
};
