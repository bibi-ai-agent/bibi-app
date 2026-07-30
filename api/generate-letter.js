import { createClient } from "@supabase/supabase-js"

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const GROQ_KEY = process.env.GROQ_KEY
const RESEND_KEY = process.env.RESEND_API_KEY

async function generateLetter(child, weekData, memory, personality) {
  const topicsText = Object.entries(weekData.topics || {})
    .sort(function(a, b) { return b[1] - a[1] })
    .slice(0, 3)
    .map(function(e) { return e[0] + ' (' + e[1] + ' kez)' })
    .join(', ')

  const emotionText = Object.entries(weekData.emotions || {})
    .sort(function(a, b) { return b[1] - a[1] })
    .slice(0, 3)
    .map(function(e) { return e[0] + ' (' + e[1] + ' kez)' })
    .join(', ')

  const strongTopics = (memory?.strong_topics || []).join(', ') || 'henüz belirlenmedi'
  const weakTopics = (memory?.weak_topics || []).join(', ') || 'henüz belirlenmedi'

  const personalityText = personality
    ? 'Merak: ' + Math.round(personality.openness || 0) + '/100, ' +
      'Sorumluluk: ' + Math.round(personality.conscientiousness || 0) + '/100, ' +
      'Sosyallik: ' + Math.round(personality.extraversion || 0) + '/100'
    : 'henüz tamamlanmadı'

  const prompt = 'Bir cocuk egitim uygulamasinin haftalik veli mektubunu yaz.\n\n' +
    'COCUK: ' + child.name + ', ' + child.age + ' yas\n' +
    'BU HAFTA AKTIF GUN: ' + weekData.activeDays + '/7\n' +
    'TOPLAM MESAJ: ' + weekData.messageCount + '\n' +
    'EN COK KONUSTULAN KONULAR: ' + (topicsText || 'gunluk sohbet') + '\n' +
    'DUYGU DAGILIMI: ' + (emotionText || 'belirsiz') + '\n' +
    'GUCLU KONULAR: ' + strongTopics + '\n' +
    'ZORLANAN KONULAR: ' + weakTopics + '\n' +
    'KISILIK PROFILI: ' + personalityText + '\n\n' +
    'KURALLAR:\n' +
    '- Samimi, sicak, profesyonel Turkce yaz\n' +
    '- 5 bolum olmali: 1) Bu haftanin ozeti 2) One cikan 3 an 3) Guclu gordugun 2 alan 4) Dikkat edilmesi gereken 1 konu 5) Gelecek hafta icin 2 oneri\n' +
    '- Her bolum 2-3 cumle\n' +
    '- Ebeveyne hitap et, cocuga degil\n' +
    '- Somut ve uygulanabilir oneriler ver\n\n' +
    'SADECE mektup metnini yaz, baslik veya JSON yazma.'

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Sen bir cocuk egitim uzmanisin. Sicak ve profesyonel Turkce yaz.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 600,
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(15000)
    })
    const data = await res.json()
    return data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || ''
  } catch { return '' }
}

async function generateCareerAnalysis(child, memory, weekData) {
  const topTopics = Object.entries(weekData.topics || {})
    .sort(function(a, b) { return b[1] - a[1] })
    .slice(0, 5)
    .map(function(e) { return e[0] })

  const prompt = 'Bir cocugun egitim verisinden kariyer egilimleri analiz et.\n\n' +
    'COCUK: ' + child.name + ', ' + child.age + ' yas\n' +
    'EN COK ILGI DUYDUGU KONULAR: ' + topTopics.join(', ') + '\n' +
    'GUCLU ALANLARI: ' + (memory?.strong_topics || []).join(', ') + '\n' +
    'GENEL DUYGU PROFİLİ: ' + JSON.stringify(memory?.emotional_profile || {}) + '\n\n' +
    'SADECE JSON dondur:\n' +
    '{"career_trends":[{"alan":"Muhendislik","yuzde":78},{"alan":"Bilim","yuzde":65},{"alan":"Tasarim","yuzde":45}],' +
    '"strong_skills":["Analitik dusunme","Merak"],' +
    '"development_areas":["Sosyal iletisim","Sabir"],' +
    '"parent_tip":"Bu hafta Cem e bir deney seti alabilirsiniz."}'

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Cocuk egitim analisti. SADECE JSON dondur.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(10000)
    })
    const data = await res.json()
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '{}'
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch { return {} }
}

async function sendLetterEmail(parentEmail, parentName, childName, letter, week) {
  if (!RESEND_KEY || !parentEmail || !letter) return
  const paragraphs = letter.split('\n').filter(function(p) { return p.trim() })
    .map(function(p) { return '<p style="color:#374151;line-height:1.7;margin:0 0 12px;">' + p + '</p>' })
    .join('')

  const html = '<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f9fafb;margin:0;padding:20px;">' +
    '<div style="max-width:600px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;">' +
    '<div style="background:linear-gradient(135deg,#1A2E2A,#0D9B7E);padding:28px;text-align:center;">' +
    '<div style="color:white;font-size:26px;font-weight:900;">bibi</div>' +
    '<div style="color:rgba(255,255,255,.7);font-size:13px;margin-top:4px;">' + childName + ' için Haftalık Rapor — ' + week + '</div>' +
    '</div>' +
    '<div style="padding:28px;">' +
    '<p style="color:#374151;">Sayın ' + parentName + ',</p>' +
    paragraphs +
    '</div>' +
    '<div style="background:#f9fafb;padding:16px;text-align:center;color:#9ca3af;font-size:12px;">Bibi AI • Her Pazartesi otomatik gönderilir</div>' +
    '</div></body></html>'

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Bibi <onboarding@resend.dev>',
      to: [parentEmail],
      subject: '📊 ' + childName + ' Haftalık Rapor — ' + week,
      html: html
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

  try {
    const week = new Date().toISOString().split('T')[0]
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: children } = await sb.from('children').select('id, name, age, parent_id, personality_scores')
    if (!children || children.length === 0) return res.status(200).json({ ok: true, processed: 0 })

    let processed = 0

    for (const child of children) {
      // Bu hafta zaten mektup var mı?
      const { data: existing } = await sb.from('weekly_letters').select('id').eq('child_id', child.id).eq('week', week).maybeSingle()
      if (existing) continue

      // Bu haftanın mesajlarını getir
      const { data: messages } = await sb.from('messages').select('role, content, topic, created_at')
        .eq('child_id', child.id).gte('created_at', oneWeekAgo)
      if (!messages || messages.length < 5) continue // Yeterli veri yoksa atla

      // Haftalık veri özeti
      const topicCounts = {}
      messages.forEach(function(m) {
        if (m.topic && m.topic !== 'Genel') {
          topicCounts[m.topic] = (topicCounts[m.topic] || 0) + 1
        }
      })

      const { data: emotions } = await sb.from('emotion_logs').select('emotion')
        .eq('child_id', child.id).gte('created_at', oneWeekAgo)
      const emotionCounts = {}
      if (emotions) {
        emotions.forEach(function(e) {
          emotionCounts[e.emotion] = (emotionCounts[e.emotion] || 0) + 1
        })
      }

      // Aktif gün sayısı
      const days = new Set(messages.map(function(m) { return m.created_at.split('T')[0] }))

      const weekData = {
        messageCount: messages.length,
        activeDays: days.size,
        topics: topicCounts,
        emotions: emotionCounts
      }

      // Hafıza ve kişilik
      const { data: memory } = await sb.from('child_memory').select('*').eq('child_id', child.id).maybeSingle()

      // Mektup ve kariyer analizi üret
      const [letter, careerAnalysis] = await Promise.all([
        generateLetter(child, weekData, memory, child.personality_scores),
        generateCareerAnalysis(child, memory, weekData)
      ])

      if (!letter) continue

      // Kaydet
      await sb.from('weekly_letters').insert({
        child_id: child.id,
        week: week,
        letter: letter,
        summary: { weekData, careerAnalysis }
      })

      // Kariyer analizini hafızaya kaydet
      if (careerAnalysis && Object.keys(careerAnalysis).length > 0) {
        await sb.from('child_memory').upsert({
          child_id: child.id,
          career_analysis: careerAnalysis,
          updated_at: new Date().toISOString()
        }, { onConflict: 'child_id' })
      }

      // Veliye email gönder
      if (child.parent_id) {
        const { data: parent } = await sb.from('parents').select('email, full_name').eq('id', child.parent_id).maybeSingle()
        if (parent?.email) {
          await sendLetterEmail(parent.email, parent.full_name || 'Değerli Ebeveyn', child.name, letter, week)
        }
      }

      processed++
      await new Promise(function(r) { setTimeout(r, 500) })
    }

    return res.status(200).json({ ok: true, processed, week })
  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}
