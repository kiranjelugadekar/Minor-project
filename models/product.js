const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const productSchema = new Schema({
  name: String,
  description: String,
  startingBid: {
        type: Number,
        required: true
    },
  currentBid: {
        type: Number,
        default: function() { 
            return this.startingBid;
        }
    },
  lastBidder: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
  category: String,
  condition: String,
  quantity: Number,
  imageUrl: {
    type: String,
    default:
      "https://png.pngtree.com/thumb_back/fw800/background/20220804/pngtree-recycling-symbol-reusable-pointing-shape-photo-image_1193543.jpg",
    set: (v) =>
      v == ""
          ? "https://png.pngtree.com/thumb_back/fw800/background/20220804/pngtree-recycling-symbol-reusable-pointing-shape-photo-image_1193543.jpg"
          : v,
  },
  auctionStatus: {
        type: String,
        enum: ['pending', 'active', 'ended'],
        default: 'pending'
    },
   auctionStartTime: {
        type: Date,
        default: null  // Will be set when first bid is placed
  },
  auctionEndTime: {
        type: Date,
        default: null  
  },
  auctionDuration: {
        type: Number,
        default: 2 * 60 * 1000  // Duration in milliseconds (2 minutes)
  },
  winner: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
  winningBid: Number,
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  
}, {
    timestamps: true
});

module.exports = mongoose.model('Product', productSchema);