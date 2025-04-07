const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  emergencyContact: { type: String, default: '' },
  emergencyEmail: {
    type: String,
    default: ''
  }
  
});

module.exports = mongoose.model('User', userSchema);
