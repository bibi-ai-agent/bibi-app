import { createClient } from '@supabase/supabase-js'

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const SUPABASE_URL = 'https://adguyijnyoicmluhursw.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

export const config = { api: { bodyParser: false } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const stripe = await import('stripe').then(m => m.default(STRIPE_SECRET))
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const rawBody = Buffer.concat(chunks)
  const sig = req.headers['stripe-signature']

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)
  } catch (e) {
    return res.status(400).json({ error: `Webhook imzası geçersiz: ${e.message}` })
  }

  const data = event.data.object

  if (event.type === 'checkout.session.completed') {
    const { parentId, plan } = data.metadata
    const customerId = data.customer
    const subscriptionId = data.subscription

    // Stripe'dan subscription bilgilerini al
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    const periodEnd = new Date(sub.current_period_end * 1000).toISOString()

    await sb.from('subscriptions').upsert({
      parent_id: parentId,
      plan,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      status: 'active',
      current_period_end: periodEnd,
      updated_at: new Date().toISOString()
    }, { onConflict: 'parent_id' })
  }

  if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
    const sub = data
    const status = sub.status === 'active' ? 'active' : 'cancelled'
    const plan = status === 'cancelled' ? 'free' : undefined

    const update = {
      status,
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString()
    }
    if (plan) update.plan = plan

    await sb.from('subscriptions')
      .update(update)
      .eq('stripe_subscription_id', sub.id)
  }

  return res.status(200).json({ received: true })
}
