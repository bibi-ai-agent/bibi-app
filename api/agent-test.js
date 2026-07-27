import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const GROQ_KEY = process.env.GROQ_API_KEY
const RESEND_KEY = process.env.RESEND_API_KEY

const TEST_CASES = [
  { age:7,  name:'Ayse',   question:'Merhaba Bibi! Bugün cok mutluyum!',             group:'young'  },
  { age:8,  name:'Can',    question:'Köpekler neden havlar?',                         group:'young'  },
  { age:7,  name:'Ela',    question:'2 arti 3 kac eder?',                             group:'young'  },
  { age:10, name:'Mert',   question:'Fotosentez nedir?',                              group:'middle' },
  { age:11, name:'Selin',  question:'Türkiyenin baskenti neresi?',                    group:'middle' },
  { age:12, name:'Kaan',   question:'Deprem neden olur?',                             group:'middle' },
  { age:14, name:'Zeynep', question:'Yapay zeka tehlikeli midir?',                    group:'teen'   },
  { age:15, name:'Emre',   question:'Iklim degisikligini nasil durdurabiliriz?',      group:'teen'   },
  { age:16, name:'Naz',    question:'Kuantum fizigi nedir, basitce anlat.',           group:'teen'   },
]

function buildSystemPrompt(age, name) {
  const style = age<=8
    ? 'Cok basit kelimeler kullan, maksimum 2 cumle, her mesajda 2-3 emoji. Cok sevecen ol.'
    : age<=12
    ? 'Anlasılır dil kullan, 3-4 cumle, emoji kullan. Samimi ve eglenceli ol.'
    : 'Akici ve detayli anlat, 4-5 cumle, uygun yerlerde emoji. Saygili ve bilgili ol.'
  return `Sen Bibi'sin, ${name} adinda ${age} yasinda bir Türk cocugun AI ogrenme arkadasisin. SADECE Türkce konuş, hic Ingilizce kelime kullanma. ${style}`
}

async function askBibi(testCase) {
  const start = Date.now()
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: buildSystemPrompt(testCase.age, testCase.name) },
          { role: 'user',   content: testCase.question }
        ],
        max_tokens: 300,
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(15000)
    })
    const duration = Date.now() - start
    if (!res.ok) { const err = await res.text(); return { success:false, error:`Groq ${res.status}`, duration } }
    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content || ''
    return { success: !!reply, reply, duration }
  } catch(err) {
    return { success:false, error:err.message, duration:Date.now()-start }
  }
}

function evaluateQuality(testCase, reply) {
  if (!reply) return { toplam:0, sorunlar:['Yanit yok'], iyi_yanlar:[] }
  const emojiCount = (reply.match(/[\u{1F300}-\u{1F9FF}]/gu)||[]).length
  const hasEnglish = /\b[a-zA-Z]{4,}\b/.test(reply.replace(/Bibi/gi,''))
  const tooLong = reply.length > 600
  const tooShort = reply.length < 20
  const scores = {
    turkce: hasEnglish?4:10, yas_uygunlugu: tooLong?5:tooShort?4:9,
    emoji: emojiCount>=2?10:emojiCount===1?7:testCase.group==='young'?2:5,
    icerik: tooShort?4:8, sicaklik: reply.includes('!')?9:6,
  }
  const toplam = Math.round((scores.turkce+scores.yas_uygunlugu+scores.emoji+scores.icerik+scores.sicaklik)/5*10)
  const sorunlar = [], iyi_yanlar = []
  if (hasEnglish) sorunlar.push('Ingilizce kelimeler var')
  if (tooLong) sorunlar.push('Yanit cok uzun')
  if (tooShort) sorunlar.push('Yanit cok kisa')
  if (emojiCount===0 && testCase.group==='young') sorunlar.push('Emoji eksik')
  if (!hasEnglish) iyi_yanlar.push('Tam Türkce')
  if (emojiCount>=2) iyi_yanlar.push('Emoji kullanimi iyi')
  if (reply.includes('!')) iyi_yanlar.push('Samimi ton')
  return { ...scores, toplam, sorunlar, iyi_yanlar }
}

function avgOfGroup(results, group) {
  const g = results.filter(r=>r.group===group&&r.success)
  if (!g.length) return 0
  return Math.round(g.reduce((s,r)=>s+(r.scores?.toplam||0),0)/g.length)
}

function scoreColor(n) {
  return n>=85?'#16a34a':n>=70?'#d97706':n>=55?'#ea580c':'#dc2626'
}

function buildEmail(report) {
  const s = report.summary
  const gs = report.group_scores
  const date = new Date(report.created_at).toLocaleDateString('tr-TR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })

  const rowsHtml = report.results.map(r => `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:10px 12px;font-weight:700;">${r.name}, ${r.age}</td>
      <td style="padding:10px 12px;color:#6b7280;font-size:13px;">${r.question}</td>
      <td style="padding:10px 12px;text-align:center;font-weight:900;color:${scoreColor(r.scores?.toplam||0)};">${r.success?(r.scores?.toplam||0)+'/100':'❌ HATA'}</td>
      <td style="padding:10px 12px;color:#6b7280;font-size:12px;">${r.duration_ms}ms</td>
      <td style="padding:10px 12px;font-size:12px;color:#059669;">${r.scores?.iyi_yanlar?.join(', ')||''}</td>
      <td style="padding:10px 12px;font-size:12px;color:#dc2626;">${r.scores?.sorunlar?.join(', ')||''}</td>
    </tr>
  `).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:'Segoe UI',sans-serif;">
  <div style="max-width:700px;margin:0 auto;padding:24px 16px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1A2E2A,#243d38);border-radius:16px;padding:28px 32px;margin-bottom:20px;text-align:center;">
      <div style="font-size:36px;margin-bottom:8px;">🤖</div>
      <div style="color:white;font-size:22px;font-weight:900;">Bibi Agent Raporu</div>
      <div style="color:rgba(255,255,255,.5);font-size:13px;margin-top:4px;">${date}</div>
    </div>

    <!-- Genel Durum -->
    <div style="background:white;border-radius:16px;padding:24px;margin-bottom:16px;border:1px solid #e5e7eb;text-align:center;">
      <div style="font-size:32px;margin-bottom:8px;">${s.genel_durum}</div>
      <div style="font-size:52px;font-weight:900;color:${scoreColor(s.ortalama_puan)};line-height:1;">${s.ortalama_puan}</div>
      <div style="color:#6b7280;font-size:13px;margin-top:4px;">/ 100 ortalama puan</div>
    </div>

    <!-- İstatistikler -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:16px;">
      ${[
        {label:'Başarı Oranı', value:`%${s.basari_orani}`, color:'#16a34a'},
        {label:'Ort. Yanıt',   value:`${s.ortalama_yanit_ms}ms`, color:'#2563eb'},
        {label:'Başarılı',     value:`${s.basarili_test}/${s.toplam_test}`, color:'#16a34a'},
        {label:'Hatalı',       value:s.hatali_test, color:s.hatali_test>0?'#dc2626':'#16a34a'},
      ].map(i=>`
        <div style="background:white;border-radius:12px;padding:16px;border:1px solid #e5e7eb;text-align:center;">
          <div style="font-size:22px;font-weight:900;color:${i.color};">${i.value}</div>
          <div style="color:#6b7280;font-size:11px;margin-top:4px;">${i.label}</div>
        </div>
      `).join('')}
    </div>

    <!-- Yaş Grubu Puanları -->
    <div style="background:white;border-radius:16px;padding:20px;margin-bottom:16px;border:1px solid #e5e7eb;">
      <div style="font-weight:700;color:#374151;margin-bottom:14px;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Yaş Grubu Puanları</div>
      ${[
        {label:'🧒 6-8 Yaş',  score:gs.young},
        {label:'👦 9-12 Yaş', score:gs.middle},
        {label:'🧑 13+ Yaş',  score:gs.teen},
      ].map(g=>`
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
          <div style="width:90px;font-size:12px;color:#374151;">${g.label}</div>
          <div style="flex:1;height:8px;border-radius:4px;background:#f3f4f6;overflow:hidden;">
            <div style="width:${g.score}%;height:100%;border-radius:4px;background:${scoreColor(g.score)};"></div>
          </div>
          <div style="width:40px;text-align:right;font-weight:700;font-size:13px;color:${scoreColor(g.score)};">${g.score}</div>
        </div>
      `).join('')}
    </div>

    <!-- Test Detayları -->
    <div style="background:white;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden;margin-bottom:16px;">
      <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#374151;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Test Detayları</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">Çocuk</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">Soru</th>
            <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;">Puan</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">Süre</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">İyi Yanlar</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">Sorunlar</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="text-align:center;color:#9ca3af;font-size:12px;padding:16px;">
      Bibi AI Agent • Her sabah 09:00'da otomatik gönderilir
    </div>
  </div>
</body>
</html>`
}

async function sendEmail(report) {
  const html = buildEmail(report)
  const s = report.summary
  const subject = `🤖 Bibi Agent Raporu — ${s.genel_durum} | ${s.ortalama_puan}/100 | %${s.basari_orani} başarı`

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Bibi Agent <onboarding@resend.dev>',
      to: ['birkankacar88@gmail.com', 'osman.yirtici@outlook.com'],
      subject,
      html
    })
  })
}

export default async function handler(req, res) {
  const auth = req.headers['x-cron-secret'] || req.query.secret
  if (auth !== process.env.CRON_SECRET) return res.status(401).json({error:'Unauthorized'})

  const today = new Date().toISOString().split('T')[0]
  const results = []
  let totalScore=0, successCount=0, totalDuration=0

  for (const tc of TEST_CASES) {
    const {success,reply,error,duration} = await askBibi(tc)
    totalDuration += duration
    let scores = {toplam:0, sorunlar:['API hatasi'], iyi_yanlar:[]}
    if (success && reply) { scores=evaluateQuality(tc,reply); successCount++; totalScore+=scores.toplam||0 }
    results.push({group:tc.group, age:tc.age, name:tc.name, question:tc.question, reply:reply?.slice(0,300)||null, error:error||null, duration_ms:duration, success, scores})
    await new Promise(r=>setTimeout(r,500))
  }

  const avgScore = successCount>0?Math.round(totalScore/successCount):0
  const avgDuration = Math.round(totalDuration/TEST_CASES.length)
  const successRate = Math.round((successCount/TEST_CASES.length)*100)
  const genel = avgScore>=85?'🟢 Mukemmel':avgScore>=70?'🟡 Iyi':avgScore>=55?'🟠 Orta':'🔴 Kritik'

  const report = {
    date: today,
    summary: {genel_durum:genel, ortalama_puan:avgScore, basari_orani:successRate, ortalama_yanit_ms:avgDuration, toplam_test:TEST_CASES.length, basarili_test:successCount, hatali_test:TEST_CASES.length-successCount},
    group_scores: {young:avgOfGroup(results,'young'), middle:avgOfGroup(results,'middle'), teen:avgOfGroup(results,'teen')},
    results,
    created_at: new Date().toISOString()
  }

  await sb.from('agent_reports').upsert({date:today, report}, {onConflict:'date'})
  await sendEmail(report)

  return res.status(200).json({ok:true, summary:report.summary})
}
