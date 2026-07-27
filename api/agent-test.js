import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const GROQ_KEY = process.env.GROQ_API_KEY
const BIBI_API = 'https://bibi-app-rho.vercel.app'

const TEST_CASES = [
  { age:7,  name:'Ayse',   question:'Merhaba Bibi! Bugün cok mutluyum!',             group:'young'  },
  { age:8,  name:'Can',    question:'Bibi, köpekler neden havlar?',                   group:'young'  },
  { age:7,  name:'Ela',    question:'2 arti 3 kac eder?',                             group:'young'  },
  { age:10, name:'Mert',   question:'Bibi, fotosentez nedir?',                        group:'middle' },
  { age:11, name:'Selin',  question:'Türkiyenin baskenti neresi ve nüfusu ne kadar?', group:'middle' },
  { age:12, name:'Kaan',   question:'Deprem neden olur?',                             group:'middle' },
  { age:14, name:'Zeynep', question:'Yapay zeka tehlikeli midir?',                    group:'teen'   },
  { age:15, name:'Emre',   question:'Iklim degisikligini nasil durdurabiliriz?',      group:'teen'   },
  { age:16, name:'Naz',    question:'Kuantum fizigi nedir, basitce anlat.',           group:'teen'   },
]

async function askBibi(testCase) {
  const start = Date.now()
  try {
    const res = await fetch(`${BIBI_API}/api/chat`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ messages:[{role:'user',content:testCase.question}], childAge:testCase.age, childName:testCase.name, language:'tr' }),
      signal:AbortSignal.timeout(15000)
    })
    const duration = Date.now()-start
    if (!res.ok) return { success:false, error:`HTTP ${res.status}`, duration }
    const data = await res.json()
    const reply = data.reply || data.content || data.message || ''
    return { success:true, reply, duration }
  } catch(err) {
    return { success:false, error:err.message, duration:Date.now()-start }
  }
}

async function evaluateQuality(testCase, reply) {
  if (!reply) return { toplam:0, sorunlar:['Yanit yok'], iyi_yanlar:[] }
  const ageDesc = testCase.group==='young'?'6-8 yas, cok basit dil':testCase.group==='middle'?'9-12 yas, anlasılır dil':'13+ yas, akici dil'
  const prompt = `Sen bir egitim kalite uzmanisın. Türk cocuk uygulamasi Bibinin yanitini degerlendir.
Cocuk: ${testCase.age} yasinda (${ageDesc})
Soru: "${testCase.question}"
Bibinin yaniti: "${reply.slice(0,400)}"
Kriterlere gore 0-10 puan ver. SADECE JSON döndür:
{"turkce":8,"yas_uygunlugu":9,"emoji":7,"icerik":9,"sicaklik":8,"toplam":82,"sorunlar":[],"iyi_yanlar":["aciklayici"]}`
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{'Authorization':`Bearer ${GROQ_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({ model:'llama-3.3-70b-versatile', messages:[{role:'user',content:prompt}], max_tokens:200, temperature:0.1 })
    })
    const data = await res.json()
    return JSON.parse((data.choices?.[0]?.message?.content||'{}').replace(/```json|```/g,'').trim())
  } catch {
    const emojiCount=(reply.match(/[\u{1F300}-\u{1F9FF}]/gu)||[]).length
    const hasEnglish=/[a-zA-Z]{4,}/.test(reply)
    return { turkce:hasEnglish?5:9, yas_uygunlugu:7, emoji:emojiCount>0?9:testCase.group==='young'?3:6, icerik:7, sicaklik:reply.includes('!')?8:6, toplam:hasEnglish?65:emojiCount>0?78:70, sorunlar:hasEnglish?['Ingilizce kelimeler var']:[], iyi_yanlar:['Yanit alindi'] }
  }
}

function avgOfGroup(results,group){
  const g=results.filter(r=>r.group===group&&r.success)
  if(!g.length)return 0
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
    totalDuration+=duration
    let scores={toplam:0,sorunlar:['API hatasi'],iyi_yanlar:[]}
    if(success&&reply){scores=await evaluateQuality(tc,reply);successCount++;totalScore+=scores.toplam||0}
    results.push({group:tc.group,age:tc.age,name:tc.name,question:tc.question,reply:reply?.slice(0,300)||null,error:error||null,duration_ms:duration,success,scores})
    await new Promise(r=>setTimeout(r,1000))
  }

  const avgScore=successCount>0?Math.round(totalScore/successCount):0
  const avgDuration=Math.round(totalDuration/TEST_CASES.length)
  const successRate=Math.round((successCount/TEST_CASES.length)*100)
  const genel=avgScore>=85?'🟢 Mukemmel':avgScore>=70?'🟡 Iyi':avgScore>=55?'🟠 Orta':'🔴 Kritik'

  const report={date:today,summary:{genel_durum:genel,ortalama_puan:avgScore,basari_orani:successRate,ortalama_yanit_ms:avgDuration,toplam_test:TEST_CASES.length,basarili_test:successCount,hatali_test:TEST_CASES.length-successCount},group_scores:{young:avgOfGroup(results,'young'),middle:avgOfGroup(results,'middle'),teen:avgOfGroup(results,'teen')},results,created_at:new Date().toISOString()}

  await sb.from('agent_reports').upsert({date:today,report},{onConflict:'date'})
  return res.status(200).json({ok:true,summary:report.summary})
}
