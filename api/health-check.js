import { createClient } from "@supabase/supabase-js"

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const RESEND_KEY = process.env.RESEND_API_KEY
const GROQ_KEY = process.env.GROQ_KEY
const GEMINI_KEY = process.env.GEMINI_KEY
const MISTRAL_KEY = process.env.MISTRAL_KEY

async function checkEndpoint(name, url, body) {
  const start = Date.now()
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    })
    const ms = Date.now() - start
    const ok = res.status < 500
    return { name, ok, status: res.status, ms }
  } catch(e) {
    return { name, ok: false, status: 0, ms: Date.now() - start, error: e.message }
  }
}

async function checkSupabase() {
  const tables = ['children', 'sessions', 'messages', 'child_memory', 'emotion_logs', 'weekly_letters', 'emotion_alerts']
  const results = []
  for (const table of tables) {
    try {
      const { error } = await sb.from(table).select('id').limit(1)
      results.push({ table, ok: !error, error: error?.message })
    } catch(e) {
      results.push({ table, ok: false, error: e.message })
    }
  }
  return results
}

async function checkGroq() {
  const start = Date.now()
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'Merhaba' }], max_tokens: 10 }),
      signal: AbortSignal.timeout(8000)
    })
    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content || ''
    return { name: 'Groq', ok: !!reply, ms: Date.now() - start, reply: reply.slice(0, 30) }
  } catch(e) {
    return { name: 'Groq', ok: false, ms: Date.now() - start, error: e.message }
  }
}

async function checkGemini() {
  const start = Date.now()
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + GEMINI_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Merhaba' }] }], generationConfig: { maxOutputTokens: 10 } }),
      signal: AbortSignal.timeout(8000)
    })
    const data = await res.json()
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return { name: 'Gemini', ok: !!reply, ms: Date.now() - start, reply: reply.slice(0, 30) }
  } catch(e) {
    return { name: 'Gemini', ok: false, ms: Date.now() - start, error: e.message }
  }
}

async function checkMistral() {
  const start = Date.now()
  try {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + MISTRAL_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mistral-large-latest', messages: [{ role: 'user', content: 'Merhaba' }], max_tokens: 10 }),
      signal: AbortSignal.timeout(8000)
    })
    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content || ''
    return { name: 'Mistral', ok: !!reply, ms: Date.now() - start, reply: reply.slice(0, 30) }
  } catch(e) {
    return { name: 'Mistral', ok: false, ms: Date.now() - start, error: e.message }
  }
}

async function sendReport(results) {
  if (!RESEND_KEY) return
  const API_BASE = 'https://bibi-app-rho.vercel.app'

  const allOk = results.models.every(m => m.ok) &&
    results.endpoints.every(e => e.ok) &&
    results.supabase.every(s => s.ok)

  const statusColor = allOk ? '#16a34a' : '#dc2626'
  const statusText = allOk ? '✅ TÜM SİSTEMLER ÇALIŞIYOR' : '⚠️ SORUN TESPİT EDİLDİ'

  const modelRows = results.models.map(m =>
    '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">' + m.name + '</td>' +
    '<td style="padding:8px;border-bottom:1px solid #e5e7eb;color:' + (m.ok ? '#16a34a' : '#dc2626') + '">' + (m.ok ? '✅ OK' : '❌ HATA') + '</td>' +
    '<td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">' + m.ms + 'ms</td>' +
    '<td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:11px;">' + (m.error || m.reply || '') + '</td></tr>'
  ).join('')

  const endpointRows = results.endpoints.map(e =>
    '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">' + e.name + '</td>' +
    '<td style="padding:8px;border-bottom:1px solid #e5e7eb;color:' + (e.ok ? '#16a34a' : '#dc2626') + '">' + (e.ok ? '✅ OK' : '❌ HATA') + '</td>' +
    '<td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;">' + e.ms + 'ms</td>' +
    '<td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:11px;">HTTP ' + e.status + '</td></tr>'
  ).join('')

  const supabaseRows = results.supabase.map(s =>
    '<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">' + s.table + '</td>' +
    '<td style="padding:8px;border-bottom:1px solid #e5e7eb;color:' + (s.ok ? '#16a34a' : '#dc2626') + '">' + (s.ok ? '✅ OK' : '❌ HATA') + '</td>' +
    '<td colspan="2" style="padding:8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:11px;">' + (s.error || '') + '</td></tr>'
  ).join('')

  const html = '<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f9fafb;margin:0;padding:20px;">' +
    '<div style="max-width:700px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;">' +
    '<div style="background:linear-gradient(135deg,#1A2E2A,#0D9B7E);padding:24px;">' +
    '<div style="color:white;font-size:22px;font-weight:900;">bibi — Sistem Sağlık Raporu</div>' +
    '<div style="color:rgba(255,255,255,.7);font-size:13px;margin-top:4px;">' + new Date().toLocaleString('tr-TR') + '</div>' +
    '</div>' +
    '<div style="padding:20px;">' +
    '<div style="background:' + (allOk ? '#f0fdf4' : '#fef2f2') + ';border:1px solid ' + statusColor + ';border-radius:12px;padding:14px;margin-bottom:20px;font-weight:700;color:' + statusColor + ';font-size:15px;">' + statusText + '</div>' +
    '<h3 style="color:#374151;margin:0 0 8px;">AI Modelleri</h3>' +
    '<table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin-bottom:20px;">' +
    '<tr style="background:#e5e7eb;"><th style="padding:8px;text-align:left;">Model</th><th style="padding:8px;text-align:left;">Durum</th><th style="padding:8px;text-align:left;">Süre</th><th style="padding:8px;text-align:left;">Detay</th></tr>' +
    modelRows + '</table>' +
    '<h3 style="color:#374151;margin:0 0 8px;">API Endpoint\'leri</h3>' +
    '<table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin-bottom:20px;">' +
    '<tr style="background:#e5e7eb;"><th style="padding:8px;text-align:left;">Endpoint</th><th style="padding:8px;text-align:left;">Durum</th><th style="padding:8px;text-align:left;">Süre</th><th style="padding:8px;text-align:left;">Detay</th></tr>' +
    endpointRows + '</table>' +
    '<h3 style="color:#374151;margin:0 0 8px;">Supabase Tabloları</h3>' +
    '<table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;">' +
    '<tr style="background:#e5e7eb;"><th style="padding:8px;text-align:left;">Tablo</th><th style="padding:8px;text-align:left;">Durum</th><th colspan="2" style="padding:8px;text-align:left;">Detay</th></tr>' +
    supabaseRows + '</table>' +
    '</div></div></body></html>'

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Bibi <onboarding@resend.dev>',
      to: ['birkankacar88@gmail.com'],
      subject: (allOk ? '✅' : '⚠️') + ' Bibi Sistem Raporu — ' + new Date().toLocaleDateString('tr-TR'),
      html
    })
  })
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()

  const auth = req.headers['x-cron-secret'] || req.query.secret
  if (auth !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' })

  const API_BASE = 'https://bibi-app-rho.vercel.app'

  // Tüm kontrolleri paralel çalıştır
  const [groq, gemini, mistral, supabase, ...endpoints] = await Promise.all([
    checkGroq(),
    checkGemini(),
    checkMistral(),
    checkSupabase(),
    checkEndpoint('session-context', API_BASE + '/api/session-context', { child_id: 'health-check', child: { name: 'Test', age: 10 } }),
    checkEndpoint('session-close', API_BASE + '/api/session-close', { session_id: 'health-check' }),
    checkEndpoint('check-alerts', API_BASE + '/api/check-alerts?secret=bibi2026', {}),
  ])

  const results = {
    timestamp: new Date().toISOString(),
    models: [groq, gemini, mistral],
    endpoints,
    supabase,
    allOk: [groq, gemini, mistral].every(m => m.ok) && endpoints.every(e => e.ok) && supabase.every(s => s.ok)
  }

  await sendReport(results)

  return res.status(200).json(results)
}
// health-check 
