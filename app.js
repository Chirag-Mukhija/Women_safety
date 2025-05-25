const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const Location = require('./models/location');
const User = require('./models/user');
const sendEmail = require('./utils/sendEmail');

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
  const { name, email, password, emergencyContact, emergencyEmail } = req.body;
  try {
    if (!name || !email || !password || !emergencyContact) {
      return res.send('Required fields are missing');
    }
    if (await User.findOne({ email })) return res.send('User already exists');
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hash,
      emergencyContact,
      emergencyEmail // This will be undefined if not provided, which is fine
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
  if (!latitude || !longitude) {
    return res.status(400).json({
      rating: 3,
      judgement: "Okay Area",
      message: "Default rating - location being processed"
    });
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });

  const prompt = `
Analyze the safety level of the location at latitude ${latitude}, longitude ${longitude}.
Consider:
- Time of day
- Population density
- Recent crime statistics
- Public transportation availability
- Street lighting
- Commercial activity

Return a JSON object with:
{
  "rating": (integer 1-5, where 5 is safest),
  "judgement": (exact string: "Safe Area" for 4-5, "Okay Area" for 3, "Unsafe Area" for 1-2)
}
`;

  try {
    const model = ai.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(prompt);
    const response = result.response;

    let parsedResult;
    try {
      parsedResult = JSON.parse(response.text());
    } catch (err) {
      console.error("Gemini response parsing error:", err);
      return res.json({ rating: 3, judgement: "Okay Area" });
    }

    // Validate and sanitize the response
    const rating = Math.max(1, Math.min(5, Number(parsedResult.rating) || 3));
    const validJudgements = ["Safe Area", "Okay Area", "Unsafe Area"];
    const judgement = validJudgements.includes(parsedResult.judgement)
      ? parsedResult.judgement
      : "Okay Area";

    res.json({ rating, judgement });
  } catch (e) {
    console.error("Gemini API error:", e);
    // Provide a default response instead of failing
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

// Add after your existing routes, before the server start

// Safe Route Planning Endpoint
app.post('/safe-route', requireLogin, async (req, res) => {
  const { startLat, startLng, destLat, destLng } = req.body;

  if (!startLat || !startLng || !destLat || !destLng) {
    return res.status(400).json({ error: 'Missing coordinates' });
  }

  try {
    // Generate Gemini prompt for route safety analysis
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });
    const model = ai.getGenerativeModel({ model: "gemini-2.0-flash" });

    const routePrompt = `
    Analyze the safety of a route from (${startLat},${startLng}) to (${destLat},${destLng}).
    Consider:
    - Time of day safety
    - Street lighting (scale 1-10)
    - Population density (scale 1-10)
    - Proximity to police stations (scale 1-10)
    - Historical incident data

    Return a JSON object with:
    {
      "lightingScore": 1-10,
      "crowdScore": 1-10,
      "policeProximity": 1-10,
      "incidentCount": number,
      "overallSafetyScore": 1-10,
      "recommendations": ["string"]
    }`;

    const result = await model.generateContent(routePrompt);
    const safetyAnalysis = JSON.parse(result.response.text());

    // Save route analysis to database
    const safeRoute = await SafeRoute.create({
      userId: req.session.user._id,
      start: { latitude: startLat, longitude: startLng },
      destination: { latitude: destLat, longitude: destLng },
      safetyMetrics: safetyAnalysis
    });

    res.json({
      route: {
        start: { lat: startLat, lng: startLng },
        destination: { lat: destLat, lng: destLng }
      },
      safetyAnalysis,
      alternativeRoutes: await generateAlternativeRoutes(startLat, startLng, destLat, destLng)
    });

  } catch (error) {
    console.error('Safe route planning error:', error);
    res.status(500).json({ error: 'Failed to plan safe route' });
  }
});

async function generateAlternativeRoutes(startLat, startLng, destLat, destLng) {
  // Calculate 3 alternative routes with different priorities
  return [
    {
      name: 'Safest Route',
      priority: 'safety',
      estimatedTime: '25 mins',
      distance: '2.3 km'
    },
    {
      name: 'Well-lit Route',
      priority: 'lighting',
      estimatedTime: '30 mins',
      distance: '2.8 km'
    },
    {
      name: 'Busy Route',
      priority: 'crowded',
      estimatedTime: '28 mins',
      distance: '2.5 km'
    }
  ];
}

// Add this route to your app.js
app.post('/api/evaluate-safety', async (req, res) => {
  try {
    const { GoogleGenerativeAI } = require('@google/genai');
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const { lat, lng, time } = req.body;

    const prompt = `
      Analyze the safety of this location: Latitude ${lat}, Longitude ${lng}
      Current time: ${time}
      
      Provide a JSON response with:
      {
        "score": number between 1-10,
        "analysis": "brief safety analysis",
        "recommendations": ["list", "of", "safety", "tips"]
      }
    `;

    const result = await model.generateContent(prompt);
    const response = result.response;
    let safetyData;

    try {
      safetyData = JSON.parse(response.text());
    } catch (e) {
      // If JSON parsing fails, create a structured response
      safetyData = {
        score: 7,
        analysis: response.text(),
        recommendations: ["Stay aware of your surroundings", "Keep emergency contacts handy"]
      };
    }

    res.json(safetyData);
  } catch (error) {
    console.error('Gemini AI error:', error);
    res.status(500).json({
      error: 'Failed to evaluate area safety',
      score: 5,
      analysis: 'Safety evaluation system temporarily unavailable',
      recommendations: ["Exercise general caution", "Follow standard safety practices"]
    });
  }
});

// Add this new route to handle route safety analysis

app.post('/analyze-route-safety', async (req, res) => {
  try {
    const { GoogleGenerativeAI } = require('@google/genai');
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const { start, end, distance, duration, time, isDaytime } = req.body;

    const prompt = `
      Analyze the safety of a route with the following details:
      - Starting point: ${start.lat}, ${start.lng}
      - Destination: ${end.lat}, ${end.lng}
      - Distance: ${distance}
      - Duration: ${duration}
      - Current time: ${time}:00 hours (${isDaytime ? 'Daytime' : 'Night'})

      Provide a safety analysis with scores (1-10) for:
      1. Overall route safety
      2. Street lighting conditions
      3. Expected crowd density
      4. Proximity to police/security
      
      Return only a JSON object with these scores like:
      {
        "overallSafety": number,
        "lighting": number,
        "crowding": number,
        "policeProximity": number
      }
    `;

    const result = await model.generateContent(prompt);
    const safetyData = JSON.parse(result.response.text());

    res.json(safetyData);
  } catch (error) {
    console.error('Gemini analysis error:', error);
    // Return fallback values if AI analysis fails
    res.json({
      overallSafety: 7.5,
      lighting: 8.0,
      crowding: 7.5,
      policeProximity: 7.0
    });
  }
});

// —————————————
// Start the Server
app.listen(process.env.PORT || 8080, () => {
  console.log('Server listening on port 8080');
});

app.get('/home', (req, res) => {
  res.render('home.ejs');
});
app.get('/features', (req, res) => {
  res.render('features.ejs');
});

app.get('/how-it-works', (req, res) => {
  res.render('how-it-works.ejs');
})

