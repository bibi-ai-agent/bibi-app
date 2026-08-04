import { createClient } from "@supabase/supabase-js"

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const GROQ_KEY = process.env.GROQ_KEY

async function generateOpeningMessage(child, recentSessions, memory) {

  const sessionSummaries = recentSessions.slice(0, 3).map(function(s) {
    return "- " + (s.title || "Sohbet") + ": " + (s.summary || "")
  }).join("\n")

  const memoryText = memory ? [
    memory.strong_topics && memory.strong_topics.length ? "Guclu: " + memory.strong_topics.join(", ") : "",
    memory.weak_topics && memory.weak_topics.length ? "Zayif: " + memory.weak_topics.join(", ") : ""
  ].filter(Boolean).join(", ") : ""

  const ageStyle = child.age <= 8
    ? "Cok kisa, max 2 cumle, 1-2 emoji, cok samimi ve sicak."
    : child.age <= 12
    ? "Kisa, 2-3 cumle, 1 emoji, arkadascabirsohbet tonu."
    : "Kisa, 2-3 cumle, samimi ve olgun ton."

  const prompt = "Bir cocuk Dai ile yeni sohbet acti. Kisiselllestirilmis karsilama mesaji yaz.\n\nCOCUK: " + child.name + ", " + child.age + " yas\nSON OTURUMLAR:\n" + sessionSummaries + "\nPROFIL: " + (memoryText || "yeni kullanici") + "\n\nKURAL: " + ageStyle + " Gecmis oturuma dogal atif yap. SADECE mesaj metnini yaz, baska hicbir sey yazma."

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_KEY },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "Sen Dai'sin — cocuklar icin Turkce AI ogrenme arkadasisin. KESİN KURAL: Sadece ve sadece Turkce yaz. Hic Ingilizce kelime kullanma. again, okay, hi, hello gibi kelimeler yasak. Sadece mesaj metnini yaz, baska hicbir sey yazma." },
          { role: "user", content: prompt }
        ],
        max_tokens: 150,
        temperature: 0.8
      }),
      signal: AbortSignal.timeout(8000)
    })
    const data = await res.json()
    return data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || null
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body
    const childId = body.child_id
    const child = body.child

    if (!childId) return res.status(400).json({ error: "child_id required" })

    // Son 5 oturumu getir
    const { data: recentSessions } = await sb
      .from("sessions")
      .select("id, title, summary, topic_tags, mood_score, duration_seconds, started_at, ended_at")
      .eq("child_id", childId)
      .not("title", "is", null)
      .order("started_at", { ascending: false })
      .limit(5)

    // Hafıza profilini getir
    const { data: memory } = await sb
      .from("child_memory")
      .select("*")
      .eq("child_id", childId)
      .maybeSingle()

    // Kisiselllestirilmis acilis mesaji uret
    const openingMessage = child ? await generateOpeningMessage(child, recentSessions, memory) : null

    // En cok calısılan konular
    const topicCounts = {}
    if (recentSessions) {
      recentSessions.forEach(function(s) {
        const tags = s.topic_tags || []
        tags.forEach(function(t) {
          topicCounts[t] = (topicCounts[t] || 0) + 1
        })
      })
    }
    const topTopics = Object.entries(topicCounts)
      .sort(function(a, b) { return b[1] - a[1] })
      .slice(0, 3)
      .map(function(e) { return e[0] })

    return res.status(200).json({
      ok: true,
      recent_sessions: recentSessions || [],
      memory: memory || null,
      opening_message: openingMessage,
      top_topics: topTopics
    })

  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}
