export const config = { api: { bodyParser: true } };

const GROQ_KEY    = process.env.GROQ_KEY
const GEMINI_KEY  = process.env.GEMINI_KEY
const MISTRAL_KEY = process.env.MISTRAL_KEY

// ══════════════════════════════════════
// MODEL ÇAĞRILARI
// ══════════════════════════════════════

async function callGroq(messages, maxTokens) {
  const start = Date.now()
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, max_tokens: maxTokens, temperature: 0.7 }),
      signal: AbortSignal.timeout(12000)
    })
    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content || ""
    return { model: "groq-llama3.3", reply, ms: Date.now() - start, ok: !!reply }
  } catch(e) {
    return { model: "groq-llama3.3", reply: "", ms: Date.now() - start, ok: false, error: e.message }
  }
}

async function callGemini(messages, maxTokens) {
  const start = Date.now()
  try {
    // Gemini formatına çevir
    const systemMsg = messages.find(m => m.role === "system")
    const chatMsgs  = messages.filter(m => m.role !== "system")

    const contents = chatMsgs.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }))

    const body = {
      contents,
      systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) }
    )
    const data = await res.json()
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
    return { model: "gemini-2.0-flash", reply, ms: Date.now() - start, ok: !!reply }
  } catch(e) {
    return { model: "gemini-2.0-flash", reply: "", ms: Date.now() - start, ok: false, error: e.message }
  }
}

async function callMistral(messages, maxTokens) {
  const start = Date.now()
  try {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${MISTRAL_KEY}` },
      body: JSON.stringify({ model: "mistral-large-latest", messages, max_tokens: maxTokens, temperature: 0.7 }),
      signal: AbortSignal.timeout(12000)
    })
    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content || ""
    return { model: "mistral-large", reply, ms: Date.now() - start, ok: !!reply }
  } catch(e) {
    return { model: "mistral-large", reply: "", ms: Date.now() - start, ok: false, error: e.message }
  }
}

// ══════════════════════════════════════
// HAKEM DEĞERLENDİRMESİ
// ══════════════════════════════════════
async function judgeReplies(candidates, systemPrompt, userMessage) {
  const valid = candidates.filter(c => c.ok && c.reply?.trim().length > 10)
  if (valid.length === 0) return null
  if (valid.length === 1) return valid[0]

  const prompt = `Sen bir pedagojik kalite hakemine sin. Bir çocuk için hazırlanmış yapay zeka yanıtlarını değerlendir.

SİSTEM PROMPTU ÖZETI: ${systemPrompt?.slice(0, 300) || "Çocuk eğitim asistanı"}

ÇOCUĞUN SORUSU: "${userMessage}"

DEĞERLENDİRME KRİTERLERİ (her biri 0-20 puan):
1. Doğruluk: Bilgi gerçek ve doğru mu?
2. Yaş uygunluğu: Dil ve içerik yaşa uygun mu?
3. Pedagojik değer: Öğrenmeyi destekliyor mu, merak uyandırıyor mu?
4. Türkçe kalitesi: %100 Türkçe, akıcı ve doğal mı?
5. Sıcaklık: Samimi, destekleyici ve motive edici mi?

YANITLAR:
${valid.map((c, i) => `[${i + 1}] ${c.model}:\n"${c.reply.slice(0, 400)}"`).join('\n\n')}

SADECE JSON döndür:
{"kazanan": 1, "puan1": 85, "puan2": 78, "puan3": 72, "neden": "kısa açıklama"}`

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "Sen bir eğitim kalite uzmanısın. SADECE JSON döndür." },
          { role: "user", content: prompt }
        ],
        max_tokens: 200,
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(8000)
    })
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || '{}'
    const result = JSON.parse(text.replace(/```json|```/g, '').trim())
    const winnerIdx = (result.kazanan || 1) - 1
    const winner = valid[Math.min(winnerIdx, valid.length - 1)]
    return { ...winner, hakem_puani: result[`puan${result.kazanan}`] || 0, hakem_neden: result.neden }
  } catch {
    // Hakem başarısız olursa en hızlı geçerli yanıtı seç
    return valid.sort((a, b) => a.ms - b.ms)[0]
  }
}

// ══════════════════════════════════════
// ANA HANDLER
// ══════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body
    const { messages, max_tokens = 1000 } = body

    if (!messages?.length) return res.status(400).json({ error: "messages required" })

    const systemMsg = messages.find(m => m.role === "system")
    const lastUser  = [...messages].reverse().find(m => m.role === "user")

    // 3 modeli paralel çalıştır
    const [groqRes, geminiRes, mistralRes] = await Promise.all([
      GROQ_KEY    ? callGroq(messages, max_tokens)    : Promise.resolve({ model:"groq", reply:"", ok:false }),
      GEMINI_KEY  ? callGemini(messages, max_tokens)  : Promise.resolve({ model:"gemini", reply:"", ok:false }),
      MISTRAL_KEY ? callMistral(messages, max_tokens) : Promise.resolve({ model:"mistral", reply:"", ok:false }),
    ])

    const candidates = [groqRes, geminiRes, mistralRes]

    // Hakem seçimi
    const winner = await judgeReplies(candidates, systemMsg?.content, lastUser?.content)

    if (!winner?.reply) {
      return res.status(500).json({ error: "Tüm modeller başarısız oldu" })
    }

    // OpenAI formatında döndür (geriye dönük uyumluluk)
    return res.status(200).json({
      choices: [{ message: { role: "assistant", content: winner.reply } }],
      _meta: {
        winner_model: winner.model,
        winner_score: winner.hakem_puani,
        models: candidates.map(c => ({ model: c.model, ok: c.ok, ms: c.ms }))
      }
    })

  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}
