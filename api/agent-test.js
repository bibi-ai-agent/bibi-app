import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const GROQ_KEY = process.env.GROQ_API_KEY

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
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
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
    if (!res.ok) {
      const err = await res.text()
      return { success: false, error: `Groq ${res.status}: ${err.slice(0,100)}`, duration }
    }
    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content || ''
    return { success: !!reply, reply, duration }
  } catch(err) {
    return { success: false, error: err.message, duration: Date.now()-start }
  }
}

function evaluateQuality(testCase, reply) {
  if (!reply) return { toplam:0, sorunlar:['Yanit yok'], iyi_yanlar:[] }
  const emojiCount = (reply.match(/[\u{1F300}-\u{1F9FF}]/gu)||[]).length
  const hasEnglish = /\b[a-zA-Z]{4,}\b/.test(reply.replace(/Bibi/gi,''))
  const tooLong = reply.length > 600
  const tooShort = reply.length < 20
  const scores = {
    turkce:        hasEnglish ? 4 : 10,
    yas_uygunlugu: tooLong ? 5 : tooShort ? 4 : 9,
    emoji:         emojiCount>=2 ? 10 : emojiCount===1 ? 7 : testCase.group==='young' ? 2 : 5,
    icerik:        tooShort ? 4 : 8,
    sicaklik:      reply.includes('!') ? 9 : 6,
  }
  const toplam = Math.round((scores.turkce+scores.yas_uygunlugu+scores.emoji+scores.icerik+scores.sicaklik)/5*10)
  const sorunlar = []
  const iyi_yanlar = []
  if (hasEnglish) sorunlar.push('Ingilizce kelimeler tespit edildi')
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
    if (success && reply) {
      scores = evaluateQuality(tc, reply)
      successCount++
      totalScore += scores.toplam||0
    }
    results.push({group:tc.group, age:tc.age, name:tc.name, question:tc.question, reply:reply?.slice(0,300)||null, error:error||null, duration_ms:duration, success, scores})
    await new Promise(r=>setTimeout(r,500))
  }

  const avgScore = successCount>0 ? Math.round(totalScore/successCount) : 0
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
  return res.status(200).json({ok:true, summary:report.summary})
}
