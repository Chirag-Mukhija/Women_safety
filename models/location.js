const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
  latitude: Number,
  longitude: Number,
  timestamp: {
    type: Date,
    default: Date.now
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

module.exports = mongoose.model('Location', locationSchema);
