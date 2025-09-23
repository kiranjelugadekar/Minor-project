const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const bidSchema = new Schema({
    amount: {
        type: Number,
        required: true
    },
    product: {
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    bidder: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['active', 'won', 'lost'],
        default: 'active'
    }
});

module.exports = mongoose.model('Bid', bidSchema);