const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is required');
if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL is required');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is required');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Stripe-Signature']
}));

app.use('/api/stripe-webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Backend is running');
});

app.post('/createaccount', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Missing name, email or password'
      });
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: name
      }
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Account created successfully',
      user: data.user
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Could not create account'
    });
  }
});

app.post('/api/create-checkout-session', async (req, res) => {
  const { amount, currency, booking } = req.body;

  if (!amount || !currency || !booking) {
    return res.status(400).json({ error: 'Missing amount, currency or booking' });
  }

  if (!booking.email || !String(booking.email).trim()) {
    return res.status(400).json({ error: 'Missing booking.email' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: String(currency).toLowerCase(),
            product_data: {
              name: `Transfer: ${booking.pickup} to ${booking.dropoff}`,
              description: `${booking.passengers} passengers, ${booking.distance_km ?? booking.distance ?? ''} km, ${booking.duration_minutes ?? booking.duration ?? ''} min`
            },
            unit_amount: amount
          },
          quantity: 1
        }
      ],
      success_url: 'https://www.airportlink.app/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.airportlink.app/failedpayment?cancel=true',
      customer_email: booking.email,
      metadata: {
        email: booking.email || '',
        full_name: booking.full_name || booking.fullName || '',
        pickup: booking.pickup || '',
        dropoff: booking.dropoff || '',
        booking_date: booking.booking_date || booking.date || '',
        passengers: String(booking.passengers || ''),
        price: String(booking.price || amount || ''),
        distance_km: String(booking.distance_km || booking.distance || ''),
        duration_minutes: String(booking.duration_minutes || booking.duration || ''),
        status: 'paid'
      },
      payment_intent_data: {
        metadata: {
          email: booking.email || '',
          pickup: booking.pickup || '',
          dropoff: booking.dropoff || ''
        }
      }
    });

    return res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Stripe error:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/stripe-webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    return res.status(400).send('Missing Stripe signature');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const md = session.metadata || {};
    const email =
      md.email ||
      session.customer_email ||
      (session.customer_details && session.customer_details.email) ||
      null;

    const bookingRow = {
      user_id: null,
      pickup: md.pickup || null,
      dropoff: md.dropoff || null,
      booking_date: md.booking_date || null,
      passengers: md.passengers ? parseInt(md.passengers, 10) : null,
      price: md.price ? Number(md.price) : null,
      distance_km: md.distance_km ? Number(md.distance_km) : null,
      duration_minutes: md.duration_minutes ? parseInt(md.duration_minutes, 10) : null,
      status: md.status || 'paid',
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: session.payment_intent || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      email
    };

    const { error } = await supabase.from('bookings').insert(bookingRow);

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(500).send(`Supabase error: ${error.message}`);
    }
  }

  return res.json({ received: true });
});

app.post('/api/confirm-payment', async (req, res) => {
  try {
    const { session_id } = req.body;

    if (!session_id || !session_id.startsWith('cs_')) {
      return res.status(400).json({ error: 'Invalid session_id' });
    }

    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return res.status(200).json({
        payment_status: session.payment_status,
        booking_saved: false,
      });
    }

    const metadata = session.metadata || {};
    const email =
      metadata.email ||
      session.customer_email ||
      (session.customer_details && session.customer_details.email) ||
      null;

    const payload = {
      user_id: metadata.user_id || null,
      pickup: metadata.pickup || null,
      dropoff: metadata.dropoff || null,
      booking_date: metadata.booking_date || null,
      passengers: Number(metadata.passengers || 1),
      price: cleanNumber(metadata.price),
      distance_km: cleanNumber(metadata.distance_km),
      duration_minutes: cleanInt(metadata.duration_minutes),
      status: metadata.status || 'paid',
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      email
    };

    const { error } = await supabase
      .from('bookings')
      .upsert(payload, { onConflict: 'stripe_checkout_session_id' });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({
      payment_status: session.payment_status,
      booking_saved: true,
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || 'Failed to confirm payment',
    });
  }
});

function cleanNumber(value) {
  if (!value) return null;
  const match = String(value).replace(',', '.').match(/[\d.]+/);
  return match ? Number(match[0]) : null;
}

function cleanInt(value) {
  const n = cleanNumber(value);
  return n === null ? null : Math.trunc(n);
}

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
