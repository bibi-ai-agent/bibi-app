import { createClient } from "@supabase/supabase-js"

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const GROQ_KEY = process.env.GROQ_KEY

async function generateTitleAndSummary(messages) {
  if (!messages || messages.length === 0) return { title: "Kisa Sohbet", summary: "", tags: [] }

  const conversation = messages.slice(-20).map(function(m) {
    return (m.role === "user" ? "Cocuk: " : "Bibi: ") + m.content
  }).join("\n")

  const prompt = "Asagidaki cocuk-Bibi konusmasini analiz et.\n\nKONUSMA:\n" + conversation + "\n\nSADECE JSON dondur:\n{\"title\": \"3-5 kelime baslik\", \"summary\": \"2-3 cumle ozet\", \"tags\": [\"konu1\", \"konu2\"]}"

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_KEY },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "Cocuk egitim analisti. SADECE JSON dondur. Turkce yaz." },
          { role: "user", content: prompt }
        ],
        max_tokens: 200,
        temperature: 0.3
      }),
      signal: AbortSignal.timeout(10000)
    })
    const data = await res.json()
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "{}"
    return JSON.parse(text.replace(/```json|```/g, "").trim())
  } catch {
    return { title: "Gunluk Sohbet", summary: "", tags: ["gunluk"] }
  }
}

function calcMoodScore(messages) {
  const positiveWords = ["mutlu", "harika", "super", "sevindim", "guzel", "mükemmel", "bravo", "tesekkur"]
  const negativeWords = ["uzgun", "kotu", "mutsuz", "korku", "sinir", "nefret", "agla", "zor"]
  let score = 5
  const userMessages = messages.filter(function(m) { return m.role === "user" })
  userMessages.forEach(function(m) {
    const t = (m.content || "").toLowerCase()
    positiveWords.forEach(function(w) { if (t.includes(w)) score += 0.5 })
    negativeWords.forEach(function(w) { if (t.includes(w)) score -= 0.5 })
  })
  return Math.max(1, Math.min(10, Math.round(score * 10) / 10))
}

function detectTopicTags(messages) {
  const tagMap = {
    "matematik": ["matematik", "hesap", "sayi", "toplama", "cikarma", "carpma", "bolme", "geometri", "denklem", "kesir"],
    "fen": ["fen", "fizik", "kimya", "biyoloji", "atom", "hucre", "enerji", "deney", "evrim", "gezegen"],
    "tarih": ["tarih", "osmanli", "ataturk", "cumhuriyet", "savas", "medeniyet"],
    "dil": ["ingilizce", "kelime", "gramer", "yabanci", "turkce", "siir", "hikaye"],
    "sanat": ["resim", "muzik", "dans", "sanat", "ciz"],
    "odev": ["odev", "sinav", "test", "soru", "problem"],
    "gunluk": ["nasil", "bugun", "hava", "yedim", "oyun", "arkadas"]
  }
  const allText = messages.map(function(m) { return m.content || "" }).join(" ").toLowerCase()
  const tags = []
  Object.keys(tagMap).forEach(function(tag) {
    if (tagMap[tag].some(function(kw) { return allText.includes(kw) })) {
      tags.push(tag)
    }
  })
  return tags.length > 0 ? tags : ["gunluk"]
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body
    const sessionId = body.session_id
    const startedAt = body.started_at

    if (!sessionId) return res.status(400).json({ error: "session_id required" })

    // Oturumdaki mesajları getir
    const { data: messages } = await sb
      .from("messages")
      .select("role, content, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })

    if (!messages || messages.length === 0) {
      return res.status(200).json({ ok: true, message: "Bos oturum" })
    }

    // AI ile baslik ve ozet uret
    const aiResult = await generateTitleAndSummary(messages)

    // Duygu skoru hesapla
    const moodScore = calcMoodScore(messages)

    // Konu etiketleri
    const tags = aiResult.tags || detectTopicTags(messages)

    // Süre hesapla
    const endedAt = new Date()
    const startedAtDate = startedAt ? new Date(startedAt) : null
    const durationSeconds = startedAtDate ? Math.round((endedAt - startedAtDate) / 1000) : 0

    // Sessions tablosunu güncelle
    await sb.from("sessions").update({
      title: aiResult.title || "Gunluk Sohbet",
      summary: aiResult.summary || "",
      topic_tags: tags,
      mood_score: moodScore,
      duration_seconds: durationSeconds,
      ended_at: endedAt.toISOString(),
      message_count: messages.length
    }).eq("id", sessionId)

    return res.status(200).json({
      ok: true,
      title: aiResult.title,
      summary: aiResult.summary,
      tags,
      mood_score: moodScore,
      duration_seconds: durationSeconds
    })

  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}
