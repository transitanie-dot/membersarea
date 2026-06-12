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
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

function validatePassword(password) {
  const value = String(password || '');

  if (value.length < 8) {
    return 'Password must be at least 8 characters long.';
  }

  if (!/[A-Za-z]/.test(value)) {
    return 'Password must contain at least one letter.';
  }

  if (!/[0-9]/.test(value)) {
    return 'Password must contain at least one number.';
  }

  return null;
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
      return res.status(400).json({
        success: false,
        message: passwordError
      });
    }

    const fullName = String(name).trim();
    const normalizedEmail = String(email).trim().toLowerCase();
    const safePassword = String(password);

    const { data: createdUserData, error: createUserError } =
      await supabaseAdmin.auth.admin.createUser({
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

    const { error: insertContactError } = await supabaseAdmin
      .from('contacts')
      .insert([
        {
          id: userId,
          full_name: fullName,
          email: normalizedEmail
        }
      ]);

    if (insertContactError) {
      return res.status(400).json({
        success: false,
        message: insertContactError.message
      });
    }

    const { data: signInData, error: signInError } =
      await supabasePublic.auth.signInWithPassword({
        email: normalizedEmail,
        password: safePassword
      });

    if (signInError || !signInData?.session) {
      return res.status(200).json({
        success: true,
        message: 'Account created, but automatic login failed.',
        autoLogin: false,
        user: {
          id: userId,
          name: fullName,
          email: normalizedEmail
        }
      });
    }

    return res.json({
      success: true,
      message: 'Account created and login successful.',
      autoLogin: true,
      user: {
        id: signInData.user.id,
        name: fullName,
        email: normalizedEmail
      },
      session: signInData.session
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
  console.log(`Server running on port ${PORT}`);
});
