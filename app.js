const express    = require('express');
const mongoose   = require('mongoose');
const bodyParser = require('body-parser');
const session    = require('express-session');
const path       = require('path');
const dotenv     = require('dotenv');
const bcrypt     = require('bcrypt');
const Location   = require('./models/location');
const User       = require('./models/user');
const sendEmail  = require('./utils/sendEmail');

// Import Google Gemini API module
const { GoogleGenAI } = require('@google/genai');

dotenv.config();
const app = express();

// —————————————
// Middleware
// —————————————
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, '..')));

// Session configuration (persistent login: cookie lasts 3 days)
app.use(session({
  secret: 'yourSecretKey',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3 * 24 * 60 * 60 * 1000 } // 3 days in milliseconds
}));

// —————————————
// DB Connection
// —————————————
mongoose.connect('mongodb://127.0.0.1:27017/womensafety', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected!'))
.catch(err => console.error(err));

// —————————————
// Auth Middleware
// —————————————
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return req.session.destroy(() => res.redirect('/login'));
  }
  next();
}

// —————————————
// Routes
// —————————————

// Signup
app.get('/signup', (req, res) => res.render('signup'));
app.post('/signup', async (req, res) => {
  const { name, email, password, emergencyContact } = req.body;
  try {
    if (await User.findOne({ email })) return res.send('User already exists');
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name, email, password: hash, emergencyContact
    });
    req.session.user = user;
    // Redirect to main map page
    res.redirect('/map');
  } catch (e) {
    console.error(e);
    res.send('Signup failed');
  }
});

// Login
app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !await bcrypt.compare(password, user.password))
      return res.send('Invalid credentials');
    req.session.user = user;
    // Redirect to main map page
    res.redirect('/map');
  } catch (e) {
    console.error(e);
    res.send('Login failed');
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Profile (GET)
app.get('/profile', requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.user._id);
    const justUpdated = req.query.updated === 'true';
    res.render('profile', { user, justUpdated });
  } catch (e) {
    console.error(e);
    res.redirect('/map');
  }
});

// Profile (POST)
app.post('/profile/update', requireLogin, async (req, res) => {
  const { emergencyContact, emergencyEmail } = req.body;
  try {
    const updated = await User.findByIdAndUpdate(
      req.session.user._id,
      { emergencyContact, emergencyEmail },
      { new: true }
    );
    req.session.user = updated;
    res.status(200).json({ message: 'Profile updated' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// Save location
app.post('/location', requireLogin, async (req, res) => {
  const { latitude, longitude } = req.body;
  const userId = req.session.user._id;
  if (!latitude || !longitude)
    return res.status(400).json({ message: 'Missing coords' });
  try {
    await Location.create({ latitude, longitude, userId });
    res.json({ message: 'Location saved!' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Save failed' });
  }
});

// Panic alert (save only)
app.post('/panic', requireLogin, async (req, res) => {
  const { latitude, longitude } = req.body;
  const user = req.session.user;
  if (!latitude || !longitude)
    return res.status(400).json({ message: 'Missing coords' });
  try {
    // Save panic alert in the DB
    await Location.create({ latitude, longitude, userId: user._id });

    // Send emergency email if an emergencyEmail is provided
    if (user.emergencyEmail) {
      const googleMapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;
      const message = `
🚨 Panic Alert!

Name: ${user.name}
Email: ${user.email}

📍 Location: ${googleMapsLink}
🕒 Time: ${new Date().toLocaleString()}

This is an emergency alert triggered from the Women’s Safety App.
      `.trim();
      await sendEmail(
        user.emergencyEmail,
        '🚨 Emergency Alert - Panic Button Pressed',
        message
      );
      console.log('Email sent to emergency contact:', user.emergencyEmail);
    } else {
      console.log('No emergency email found for this user.');
    }
    res.json({ message: 'Panic alert recorded and email sent (if applicable).' });
  } catch (e) {
    console.error('Panic alert error:', e);
    res.status(500).json({ message: 'Panic save failed' });
  }
});

// JSON for map: Returns up to 50 most recent location records.
app.get('/locations-data', requireLogin, async (req, res) => {
  try {
    const locations = await Location
      .find({ userId: req.session.user._id })
      .sort({ timestamp: -1 })
      .limit(50);
    res.json(locations);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// Map page with AI evaluation (Google Maps API key is passed from .env)
app.get('/map', requireLogin, (req, res) => {
  res.render('map', {
    googleApiKey: process.env.GOOGLE_MAPS_KEY,
    user: req.session.user
  });
});

// —————————————
// New Endpoint: Evaluate Location Safety using Gemini AI
// —————————————
app.post('/evaluate-location', requireLogin, async (req, res) => {
  const { latitude, longitude } = req.body;
  if (!latitude || !longitude)
    return res.status(400).json({ message: 'Missing coords' });
    
  // Instantiate the GoogleGenAI client using the API key from .env
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });
  
  // Construct a detailed prompt for Gemini
  const prompt = `
Using past crime data, recent news headlines, National Crime Bureau records, and other public data, evaluate the safety of the location at latitude ${latitude} and longitude ${longitude}.
Return exactly a JSON object with two keys:
  "rating": an integer (1, 2, 3, 4, or 5) where 5 means extremely safe and 1 means extremely unsafe.
  "judgement": a one-word value that must be exactly one of either "Safe Area" (if rating is 4 or 5), "Okay Area" (if rating is 3), or "Unsafe Area" (if rating is 1 or 2).
If unable to decide, default to a rating of 3 and "Okay Area".
Return only valid JSON without any extra text.
  `.trim();
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    let result;
    try {
      result = JSON.parse(response.text);
    } catch (err) {
      console.error("Failed to parse AI response as JSON", err, response.text);
      return res.json({ rating: 3, judgement: "Okay Area" });
    }
    
    const rating = Number(result.rating);
    const validRatings = [1, 2, 3, 4, 5];
    const validJudgements = ["Safe Area", "Okay Area", "Unsafe Area"];
    
    if (!validRatings.includes(rating) || !validJudgements.includes(result.judgement)) {
      result.rating = 3;
      result.judgement = "Okay Area";
    } else {
      result.rating = rating;
    }
    
    res.json(result);
  } catch (e) {
    console.error("Gemini API error:", e);
    res.json({ rating: 3, judgement: "Okay Area" });
  }
});

// —————————————
// Scheduled Deletion: Automatically delete location records older than 18 hours
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 18 * 60 * 60 * 1000); // 18 hours ago
    const result = await Location.deleteMany({ timestamp: { $lt: cutoff } });
    console.log(`Cleaned up ${result.deletedCount} location record(s) older than 18 hours.`);
  } catch (error) {
    console.error('Error cleaning up old location data:', error);
  }
}, 60 * 60 * 1000); // Runs every hour

// —————————————
// Start the Server
app.listen(process.env.PORT || 8080, () => {
  console.log('Server listening on port 8080');
});
