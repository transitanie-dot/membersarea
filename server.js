import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';


const app = express();
const PORT = process.env.PORT || 3000;
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


app.use(cors({ origin: true, credentials: true }));
app.use(express.json());


app.get('/health', (req, res) => res.json({ ok: true }));


app.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Missing fields.' });
    }


    const hashed = await bcrypt.hash(password, 10);


    const { data, error } = await supabase
      .from('contacts')
      .insert([{ name, email, password_hash: hashed }])
      .select()
      .single();


    if (error) {
      return res.status(500).json({ success: false, message: error.message });
    }


    return res.json({
      success: true,
      message: 'Account created successfully.',
      user: { id: data.id, name: data.name, email: data.email }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});


app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Missing fields.' });
    }


    const { data, error } = await supabase
      .from('contacts')
      .select('id,name,email,password_hash')
      .eq('email', email)
      .single();


    if (error || !data) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }


    const ok = await bcrypt.compare(password, data.password_hash || '');
    if (!ok) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }


    return res.json({
      success: true,
      message: 'Login successful.',
      user: { id: data.id, name: data.name, email: data.email }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});


app.listen(PORT, () => console.log(`Server running on ${PORT}`));