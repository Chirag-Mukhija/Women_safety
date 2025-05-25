const mongoose = require('mongoose');

const safeRouteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  start: {
    latitude: Number,
    longitude: Number
  },
  destination: {
    latitude: Number,
    longitude: Number
  },
  safetyMetrics: {
    lightingScore: Number,
    crowdScore: Number,
    incidentCount: Number,
    policeProximity: Number,
    overallSafetyScore: Number
  },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SafeRoute', safeRouteSchema);