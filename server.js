import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3000;

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabasePublic = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'AirportLink API is running.' });
});

app.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Missing fields.'
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
        user_metadata: {
          full_name: fullName
        }
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

    return res.json({
      success: true,
      message: 'Account created successfully.',
      user: {
        id: userId,
        name: fullName,
        email: normalizedEmail
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Server error.'
    });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Missing fields.'
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
      message: 'Server error.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
