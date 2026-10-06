const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const ongoingEventSchema = new mongoose.Schema({
    id: {
        type: String,
        default: uuidv4,
        unique: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['POLITICAL', 'GOVT', 'TECH', 'OTHER'],
        default: 'OTHER'
    },
    bucket: {
        type: String,
        enum: ['ONGOING', 'DAILY_100_FEED', 'SB_INPUTS'],
        default: 'ONGOING'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

ongoingEventSchema.index({ bucket: 1, createdAt: -1 });

module.exports = mongoose.model('OngoingEvent', ongoingEventSchema);
