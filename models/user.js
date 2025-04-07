const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: String,
  
    emergencyContactNumber: String, // 📱 New field
    emergencyContactEmail: String   // 📧 New field
  });

module.exports = mongoose.model('User', userSchema);
