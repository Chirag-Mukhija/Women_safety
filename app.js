
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path');
const app = express();
const Location = require('./models/location');
const User = require('./models/user');
const session = require('express-session');
const bcrypt = require('bcrypt');
app.use(express.json());


app.use(session({
  secret: 'yourSecretKey',
  resave: false,
  saveUninitialized: false
}));

dotenv.config();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');



main().then(res=>{
    console.log(`database connected !`)
})
.catch(err => console.log(err));

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/womensafety');
}
app.listen(8080,()=>{
  console.log(`listning to port 8080`)
})
app.get('/', (req, res) => {
    res.render('index');
});
app.post('/panic', async (req, res) => {
  try {
    console.log('Session:', req.session);

    const { latitude, longitude } = req.body;
    const userId = req.session.user?._id;

    if (!latitude || !longitude || !userId) {
      return res.status(400).json({ message: 'Missing location or user info.' });
    }

    // ✅ Prevent duplicate panic alerts within 30 seconds
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
    const recent = await Location.findOne({
      userId,
      timestamp: { $gte: thirtySecondsAgo }
    });

    if (recent) {
      console.log('⛔ Duplicate panic alert blocked.');
      return res.status(409).json({ message: 'Panic alert already sent recently.' });
    }

    const panicLocation = new Location({
      latitude,
      longitude,
      userId
    });

    await panicLocation.save();

    console.log('🚨 Panic location saved:', latitude, longitude);
    res.json({ message: 'Panic alert sent and saved!' });
  } catch (err) {
    console.error('Error saving panic location:', err);
    res.status(500).json({ message: 'Error sending panic alert.' });
  }
});




app.post('/location', async (req, res) => {
  console.log("Session at /location:", req.session); // 👈 ADD THIS

  const { latitude, longitude } = req.body;
  const userId = req.session.user?._id;

  if (!userId) return res.status(401).json({ message: 'User not logged in' });

  try {
    const newLocation = new Location({ latitude, longitude, userId });
    await newLocation.save();
    res.json({ message: 'Location saved successfully!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to save location' });
  }
});



app.get('/map', async (req, res) => {
  const locations = await Location.find().sort({ timestamp: -1 }).limit(50);
  res.render('map', { locations });
});

app.get('/locations-data', async (req, res) => {
  try {
    const locations = await Location.find()
      .sort({ timestamp: -1 })
      .limit(50)
      .populate('userId', 'name email'); // 👈 this adds user info

    res.json(locations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});


// Render Signup Page
app.get('/signup', (req, res) => {
  res.render('signup');
});

// Handle Signup
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.send('User already exists');

    const hashedPassword = await bcrypt.hash(password, 10); // 10 is the salt rounds

    const newUser = new User({ name, email, password: hashedPassword });
    await newUser.save();

    req.session.user = newUser; // Still stores user in session
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.send('Signup failed');
  }
});

// Render Login Page
app.get('/login', (req, res) => {
  res.render('login');
});

// Handle Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });

    if (!user) return res.send('Invalid credentials');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.send('Invalid credentials');

    req.session.user = user;
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    res.send('Login failed');
  }
});

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('dashboard', { user: req.session.user });
});

//logout route 
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/map/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const locations = await Location.find({ userId }).sort({ timestamp: -1 }).limit(50);
    res.render('map', { locations });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load map');
  }
});


