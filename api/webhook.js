const https = require('https')
const crypto = require('crypto')

const STRIPE_WEBHOOK_SECRET = 'whsec_luxqS3zy6PAOEO7o7ZrRyjG5belYcZHh'
const SUPABASE_URL = 'https://adguyijnyoicmluhursw.supabase.co'
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkZ3V5aWpueW9pY21sdWh1cnN3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjU1NDAyMCwiZXhwIjoyMDk4MTMwMDIwfQ.155EDtcWkcyrFcobRJPopI_LpgVHuy0yd5FxW485m9k'

module.exports.config = { api: { bodyParser: false } }

function supabaseRequest(method, path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const parsed = new URL(`${SUPABASE_URL}/rest/v1/${path}`)
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Prefer': method === 'POST' ? 'resolution=merge-duplicates' : 'return=minimal'
      }
    }
    const req = https.request(options, res => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => resolve({ status: res.statusCode, data: raw }))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function verifyStripeSignature(payload, sig, secret) {
  const parts = sig.split(',').reduce((acc, part) => {
    const [k, v] = part.split('='); acc[k] = v; return acc
  }, {})
  const timestamp = parts.t
  const signatures = Object.keys(parts).filter(k => k.startsWith('v')).map(k => parts[k])
  const signedPayload = `${timestamp}.${payload}`
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
  return signatures.some(s => {
    try { return crypto.timingSafeEqual(Buffer.from(s, 'hex'), Buffer.from(expected, 'hex')) } catch { return false }
  })
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method !== 'POST') return res.status(405).end()

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const rawBody = Buffer.concat(chunks).toString()
  const sig = req.headers['stripe-signature']

  if (!verifyStripeSignature(rawBody, sig, STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'Geçersiz imza' })
  }

  const event = JSON.parse(rawBody)
  const data = event.data.object

  if (event.type === 'checkout.session.completed') {
    const { parentId, plan } = data.metadata || {}
    if (parentId && plan) {
      // Önce kayıt var mı kontrol et, yoksa upsert yap
      await supabaseRequest('POST', 'subscriptions?on_conflict=parent_id', {
        parent_id: parentId,
        plan,
        stripe_customer_id: data.customer,
        stripe_subscription_id: data.subscription,
        status: 'active',
        updated_at: new Date().toISOString()
      })
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const subId = data.id
    await supabaseRequest('PATCH', `subscriptions?stripe_subscription_id=eq.${subId}`, {
      plan: 'free',
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
  }

  return res.status(200).json({ received: true })
}
