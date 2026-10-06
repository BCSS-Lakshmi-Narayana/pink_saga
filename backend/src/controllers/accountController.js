const TwitterAccount = require('../models/TwitterAccount');
const { getHealthyAccount, closeBrowser } = require('../services/scraperService');
const bcrypt = require('bcryptjs');

// @desc    Add a new Twitter bot account
// @route   POST /api/settings/accounts
// @access  Private
const addAccount = async (req, res) => {
    try {
        const { username, password, email, proxy } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and password are required' });
        }

        // Hash password before saving
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const account = await TwitterAccount.create({
            username,
            password: hashedPassword,
            email,
            proxy
        });

        res.status(201).json(account);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Account already exists' });
        }
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get all Twitter bot accounts
// @route   GET /api/settings/accounts
// @access  Private
const getAccounts = async (req, res) => {
    try {
        const accounts = await TwitterAccount.find().select('-password');
        res.status(200).json(accounts);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Delete a Twitter bot account
// @route   DELETE /api/settings/accounts/:id
// @access  Private
const deleteAccount = async (req, res) => {
    try {
        await TwitterAccount.findOneAndDelete({ _id: req.params.id });
        res.status(200).json({ message: 'Account removed' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Force rotation/reset browser
// @route   POST /api/settings/accounts/reset
// @access  Private
const resetBrowser = async (req, res) => {
    try {
        await closeBrowser();
        res.status(200).json({ message: 'Browser session reset' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


module.exports = {
    addAccount,
    getAccounts,
    deleteAccount,
    resetBrowser
};

