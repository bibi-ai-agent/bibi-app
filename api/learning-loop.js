export const config = { api: { bodyParser: true } };
import { createClient } from "@supabase/supabase-js"

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const GROQ_KEY = process.env.GROQ_KEY

// Son 7 günün raporlarını analiz et
async function analyzeReports() {
  const week_ago = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  const { data: reports } = await sb
    .from("agent_reports")
    .select("report")
    .gte("date", week_ago)
    .order("date", { ascending: false })

  if (!reports?.length) return null

  const allResults = reports.flatMap(r => r.report?.chatResults || [])
  if (!allResults.length) return null

  // Başarısız kalıpları bul
  const failures = allResults.filter(r => !r.success || (r.scores?.toplam || 0) < 60)
  const successes = allResults.filter(r => r.success && (r.scores?.toplam || 0) >= 80)

  // Sorun türlerini topla
  const issues = {}
  failures.forEach(r => {
    (r.scores?.sorunlar || []).forEach(s => {
      issues[s] = (issues[s] || 0) + 1
    })
  })

  // İyi yanlar
  const goods = {}
  successes.forEach(r => {
    (r.scores?.iyi_yanlar || []).forEach(g => {
      goods[g] = (goods[g] || 0) + 1
    })
  })

  // Yaş grubu performansı
  const agePerf = {}
  allResults.forEach(r => {
    if (!agePerf[r.group]) agePerf[r.group] = { total: 0, sum: 0 }
    agePerf[r.group].total++
    agePerf[r.group].sum += r.scores?.toplam || 0
  })

  return {
    toplam_test: allResults.length,
    basarisiz_test: failures.length,
    basarili_test: successes.length,
    sorunlar: Object.entries(issues).sort((a,b) => b[1]-a[1]).slice(0,5),
    iyi_yanlar: Object.entries(goods).sort((a,b) => b[1]-a[1]).slice(0,5),
    yas_performansi: Object.entries(agePerf).map(([g, v]) => ({
      grup: g, ort_puan: Math.round(v.sum / v.total)
    }))
  }
}

// AI ile haftalık öneri üret
async function generateWeeklyInsight(analysis) {
  if (!analysis) return null

  const prompt = `Bir çocuk eğitim yapay zekasının haftalık test analizini incele ve iyileştirme önerileri sun.

ANALİZ:
- Toplam test: ${analysis.toplam_test}
- Başarısız: ${analysis.basarisiz_test}
- Başarılı: ${analysis.basarili_test}
- En sık sorunlar: ${analysis.sorunlar.map(([s,n]) => s + " (" + n + " kez)").join(", ")}
- İyi yanlar: ${analysis.iyi_yanlar.map(([g,n]) => g + " (" + n + " kez)").join(", ")}
- Yaş grubu puanları: ${analysis.yas_performansi.map(y => y.grup + ": " + y.ort_puan).join(", ")}

Şu başlıklarda Türkçe, kısa ve somut öneriler ver. SADECE JSON döndür:
{
  "kritik_sorun": "en önemli tek sorun",
  "hemen_yapilacak": "bu hafta yapılacak en önemli tek değişiklik",
  "guclu_yan": "sistemin en iyi çalıştığı alan",
  "yas_odak": "hangi yaş grubuna odaklanılmalı",
  "genel_skor": 75
}`

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "Sen bir eğitim teknolojisi analistinin. SADECE JSON döndür." },
          { role: "user", content: prompt }
        ],
        max_tokens: 300, temperature: 0.3
      })
    })
    const data = await res.json()
    return JSON.parse((data.choices?.[0]?.message?.content || "{}").replace(/```json|```/g, "").trim())
  } catch { return null }
}

export default async function handler(req, res) {
  const auth = req.headers["x-cron-secret"] || req.query.secret
  if (auth !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" })

  try {
    // 1. Raporları analiz et
    const analysis = await analyzeReports()
    if (!analysis) return res.status(200).json({ ok: true, message: "Henüz yeterli veri yok" })

    // 2. AI ile haftalık içgörü üret
    const insight = await generateWeeklyInsight(analysis)

    // 3. Supabase'e kaydet
    const record = {
      week: new Date().toISOString().split("T")[0],
      analysis,
      insight,
      created_at: new Date().toISOString()
    }

    await sb.from("learning_insights").upsert({ week: record.week, data: record }, { onConflict: "week" })

    return res.status(200).json({ ok: true, analysis, insight })
  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}
