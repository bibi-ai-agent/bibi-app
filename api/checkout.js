const https = require('https')

const STRIPE_SECRET = 'sk_test_51TuqqTFbpmZ6DrU3FN3b6AYCcVZ0frbICdcjMOhRQJGfzU4LXJS95TSqtTBGloUbiaBIJ1SfAYBjHypOOypfgNPb00MF0K3qDK'

const PRICE_IDS = {
  go: 'price_1TuqvTFbpmZ6DrU3LquWuEj1',
  pro: 'price_1TuqwhFbpmZ6DrU3zKWnWE4i'
}

function stripeRequest(path, data) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(data).toString()
    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }
    const req = https.request(options, res => {
      let raw = ''
      res.on('data', chunk => raw += chunk)
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(raw) }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const { plan, parentId, parentEmail, successUrl, cancelUrl } = body

  if (!plan || !PRICE_IDS[plan]) return res.status(400).json({ error: 'Geçersiz plan' })

  try {
    const data = {
      'mode': 'subscription',
      'payment_method_types[0]': 'card',
      'line_items[0][price]': PRICE_IDS[plan],
      'line_items[0][quantity]': '1',
      'success_url': successUrl || 'https://bibi-react-three.vercel.app?success=true',
      'cancel_url': cancelUrl || 'https://bibi-react-three.vercel.app?cancel=true',
      'metadata[parentId]': parentId,
      'metadata[plan]': plan,
      'locale': 'tr'
    }
    if (parentEmail) data['customer_email'] = parentEmail

    const result = await stripeRequest('/v1/checkout/sessions', data)
    if (result.status !== 200) return res.status(result.status).json({ error: result.data.error?.message || 'Stripe hatası' })
    return res.status(200).json({ url: result.data.url })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
