import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL is required');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
if (!process.env.SUPABASE_ANON_KEY) throw new Error('SUPABASE_ANON_KEY is required');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabasePublic = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const allowedOrigins = [
  'https://www.airportlink.app',
  'https://airportlink.app',
  'https://www-airportlink-app.filesusr.com'
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(value)) return 'Password must contain at least one letter.';
  if (!/[0-9]/.test(value)) return 'Password must contain at least one number.';
  return null;
}

async function linkPurchasesToUser(email, userId) {
  const { error } = await supabaseAdmin
    .from('bookings')
    .update({ user_id: userId })
    .eq('email', email)
    .is('user_id', null);

  if (error) throw error;
}

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ success: true, message: 'AirportLink API is running.' });
});

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Healthy' });
});

app.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email and password are required.'
      });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ success: false, message: passwordError });
    }

    const fullName = String(name).trim();
    const normalizedEmail = String(email).trim().toLowerCase();
    const safePassword = String(password);

    const { data: createdUserData, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: safePassword,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });

    if (createUserError || !createdUserData?.user) {
      return res.status(400).json({
        success: false,
        message: createUserError?.message || 'Could not create account.'
      });
    }

    const userId = createdUserData.user.id;

    const { error: contactError } = await supabaseAdmin.from('contacts').upsert([
      {
        id: userId,
        full_name: fullName,
        email: normalizedEmail
      }
    ]);

    if (contactError) {
      return res.status(400).json({
        success: false,
        message: contactError.message
      });
    }

    try {
      await linkPurchasesToUser(normalizedEmail, userId);
    } catch (linkError) {
      return res.status(400).json({
        success: false,
        message: linkError.message || 'Account created, but could not link purchases.'
      });
    }

    return res.json({
      success: true,
      message: 'Account created successfully.',
      autoLogin: false,
      user: { id: userId, name: fullName, email: normalizedEmail }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Server error.'
    });
  }
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
    const safePassword = String(password);

    const { data, error } = await supabasePublic.auth.signInWithPassword({
      email: normalizedEmail,
      password: safePassword
    });

    if (error || !data?.user) {
      return res.status(401).json({
        success: false,
        message: error?.message || 'Invalid email or password.'
      });
    }

    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('id, full_name, email')
      .eq('id', data.user.id)
      .maybeSingle();

    return res.json({
      success: true,
      message: 'Login successful.',
      user: {
        id: data.user.id,
        name: contact?.full_name || data.user.user_metadata?.full_name || '',
        email: data.user.email
      },
      session: data.session
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Server error.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
