const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');


const app = express();
app.use(cors());
app.use(express.json());


const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';


const users = [
  {
    id: 1,
    email: 'demo@airportlink.com',
    passwordHash: bcrypt.hashSync('Password123!', 10),
    name: 'Demo User'
  }
];


app.get('/', (req, res) => {
  res.json({ success: true, message: 'AirportLink API is running.' });
});


app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};


    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.'
      });
    }


    const normalizedEmail = String(email).trim().toLowerCase();
    const user = users.find(u => u.email.toLowerCase() === normalizedEmail);


    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }


    const ok = bcrypt.compareSync(String(password), user.passwordHash);


    if (!ok) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }


    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '2h' }
    );


    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Server error.'
    });
  }
});


app.get('/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;


  if (!token) {
    return res.status(401).json({ success: false, message: 'Missing token.' });
  }


  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return res.json({ success: true, user: payload });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
});


app.listen(PORT, () => console.log(`API running on port ${PORT}`));