const STRIPE_SECRET = 'sk_test_51TuqqTFbpmZ6DrU3FN3b6AYCcVZ0frbICdcjMOhRQJGfzU4LXJS95TSqtTBGloUbiaBIJ1SfAYB'
const PRICE_IDS = {
  go: 'price_1TuqvTFbpmZ6DrU3LquWuEj1',
  pro: 'price_1TuqwhFbpmZ6DrU3zKWnWE4i'
}

export const config = { api: { bodyParser: true } }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { plan, parentId, parentEmail, successUrl, cancelUrl } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body

  if (!plan || !PRICE_IDS[plan]) return res.status(400).json({ error: 'Geçersiz plan' })

  try {
    const stripe = await import('stripe').then(m => m.default(STRIPE_SECRET))

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      success_url: successUrl || 'https://bibi-app-rho.vercel.app?success=true',
      cancel_url: cancelUrl || 'https://bibi-app-rho.vercel.app?cancel=true',
      customer_email: parentEmail,
      metadata: { parentId, plan },
      locale: 'tr'
    })

    return res.status(200).json({ url: session.url })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
