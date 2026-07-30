export const config = { api: { bodyParser: true } };

const GROQ_KEY    = process.env.GROQ_KEY
const GEMINI_KEY  = process.env.GEMINI_KEY
const MISTRAL_KEY = process.env.MISTRAL_KEY

async function callGroq(messages, maxTokens) {
  const start = Date.now()
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_KEY },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, max_tokens: maxTokens, temperature: 0.7 }),
      signal: AbortSignal.timeout(12000)
    })
    const data = await res.json()
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || ""
    return { model: "groq", reply, ms: Date.now() - start, ok: !!reply }
  } catch(e) {
    return { model: "groq", reply: "", ms: Date.now() - start, ok: false, error: e.message }
  }
}

async function callGemini(messages, maxTokens) {
  const start = Date.now()
  try {
    const systemMsg = messages.find(function(m) { return m.role === "system" })
    const chatMsgs = messages.filter(function(m) { return m.role !== "system" })
    const contents = chatMsgs.map(function(m) {
      return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }
    })
    const body = {
      contents: contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
    }
    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] }
    }
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + GEMINI_KEY,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) }
    )
    const data = await res.json()
    const reply = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text || ""
    return { model: "gemini", reply, ms: Date.now() - start, ok: !!reply }
  } catch(e) {
    return { model: "gemini", reply: "", ms: Date.now() - start, ok: false, error: e.message }
  }
}

async function callMistral(messages, maxTokens) {
  const start = Date.now()
  try {
    const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + MISTRAL_KEY },
      body: JSON.stringify({ model: "mistral-large-latest", messages, max_tokens: maxTokens, temperature: 0.7 }),
      signal: AbortSignal.timeout(12000)
    })
    const data = await res.json()
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || ""
    return { model: "mistral", reply, ms: Date.now() - start, ok: !!reply }
  } catch(e) {
    return { model: "mistral", reply: "", ms: Date.now() - start, ok: false, error: e.message }
  }
}

async function judgeReplies(candidates, userMessage) {
  const valid = candidates.filter(function(c) { return c.ok && c.reply && c.reply.trim().length > 10 })
  if (valid.length === 0) return null
  if (valid.length === 1) return valid[0]

  const candidateText = valid.map(function(c, i) {
    return "[" + (i+1) + "] " + c.model + ":\n\"" + c.reply.slice(0, 300) + "\""
  }).join("\n\n")

  const prompt = "Cocuk egitim asistaninin yanit kalitesini degerlendir.\n\nSORU: \"" + (userMessage || "") + "\"\n\nYANITLAR:\n" + candidateText + "\n\nSADECE JSON don dur:\n{\"kazanan\": 1, \"neden\": \"kisa aciklama\"}"

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_KEY },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "Egitim kalite hakemi. SADECE JSON dondur." },
          { role: "user", content: prompt }
        ],
        max_tokens: 100,
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(8000)
    })
    const data = await res.json()
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "{}"
    const result = JSON.parse(text.replace(/```json|```/g, "").trim())
    const idx = (result.kazanan || 1) - 1
    return valid[Math.min(idx, valid.length - 1)]
  } catch {
    return valid.sort(function(a, b) { return a.ms - b.ms })[0]
  }
}

function safetyCheck(reply) {
  if (!reply) return false
  if (reply.trim().length < 10) return false
  const harmful = ["saldır", "öldür", "zarar ver", "uyuşturucu", "silah"]
  if (harmful.some(function(w) { return reply.toLowerCase().includes(w) })) return false
  return true
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body
    const messages = body.messages || []
    const maxTokens = body.max_tokens || 1000

    if (!messages.length) return res.status(400).json({ error: "messages required" })

    const lastUser = messages.slice().reverse().find(function(m) { return m.role === "user" })

    const results = await Promise.all([
      GROQ_KEY    ? callGroq(messages, maxTokens)    : Promise.resolve({ model: "groq",    reply: "", ok: false }),
      GEMINI_KEY  ? callGemini(messages, maxTokens)  : Promise.resolve({ model: "gemini",  reply: "", ok: false }),
      MISTRAL_KEY ? callMistral(messages, maxTokens) : Promise.resolve({ model: "mistral", reply: "", ok: false }),
    ])

    const winner = await judgeReplies(results, lastUser && lastUser.content)

    if (!winner || !winner.reply) {
      return res.status(500).json({ error: "Tum modeller basarisiz oldu" })
    }

    let finalReply = winner.reply
    if (!safetyCheck(finalReply)) {
      const retry = await callGroq(messages, 500)
      if (retry.ok && safetyCheck(retry.reply)) {
        finalReply = retry.reply
      } else {
        finalReply = "Seni duyuyorum! Baska bir konuda yardimci olabilir miyim?"
      }
    }

    return res.status(200).json({
      choices: [{ message: { role: "assistant", content: finalReply } }],
      _meta: { winner: winner.model, models: results.map(function(r) { return { model: r.model, ok: r.ok, ms: r.ms } }) }
    })

  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}
