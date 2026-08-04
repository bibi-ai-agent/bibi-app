import { createClient } from "@supabase/supabase-js"

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const RESEND_KEY = process.env.RESEND_API_KEY

async function sendAlertEmail(parentEmail, parentName, childName, alerts) {
  if (!RESEND_KEY || !parentEmail) return
  const alertRows = alerts.map(function(a) {
    return '<tr><td style="padding:10px 12px;border-bottom:1px solid #fee2e2;">' + a.message + '</td></tr>'
  }).join('')

  const html = '<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f9fafb;margin:0;padding:20px;">' +
    '<div style="max-width:600px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;">' +
    '<div style="background:#dc2626;padding:24px;text-align:center;">' +
    '<div style="color:white;font-size:24px;font-weight:900;">⚠️ Bibi Uyarısı</div>' +
    '<div style="color:rgba(255,255,255,.8);font-size:14px;margin-top:4px;">' + childName + ' için dikkat gerektiren durum</div>' +
    '</div>' +
    '<div style="padding:24px;">' +
    '<p style="color:#374151;">Sayın ' + parentName + ',</p>' +
    '<p style="color:#6b7280;">' + childName + ' için aşağıdaki uyarılar oluştu:</p>' +
    '<table style="width:100%;border-collapse:collapse;background:#fff5f5;border-radius:8px;overflow:hidden;">' +
    alertRows + '</table>' +
    '<p style="color:#6b7280;margin-top:16px;">Dai uygulamasından daha fazla bilgi alabilirsiniz.</p>' +
    '</div></div></body></html>'

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Bibi <onboarding@resend.dev>',
      to: [parentEmail],
      subject: '⚠️ ' + childName + ' için Bibi Uyarısı',
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
    // Tüm aktif çocukları getir
    const { data: children } = await sb
      .from('children')
      .select('id, name, parent_id, age')

    if (!children || children.length === 0) return res.status(200).json({ ok: true, checked: 0 })

    let totalAlerts = 0

    for (const child of children) {
      const newAlerts = []

      // 1. Son 3 günün duygularını kontrol et
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      const { data: emotions } = await sb
        .from('emotion_logs')
        .select('emotion, created_at')
        .eq('child_id', child.id)
        .gte('created_at', threeDaysAgo)
        .order('created_at', { ascending: false })

      if (emotions && emotions.length >= 3) {
        const negativeEmotions = ['sad', 'frustrated', 'anxious', 'uzgun', 'sinirli', 'uzgün', 'stresli']
        const recentNegative = emotions.filter(function(e) {
          return negativeEmotions.includes(e.emotion)
        })
        if (recentNegative.length >= 3) {
          newAlerts.push({
            child_id: child.id,
            alert_type: 'negative_emotion',
            message: child.name + ' son 3 gündür üzgün veya stresli görünüyor. Biraz konuşmak iyi gelebilir. 😔'
          })
        }
      }

      // 2. Son 5 gün aktivite var mı kontrol et
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
      const { data: recentMsgs } = await sb
        .from('messages')
        .select('id')
        .eq('child_id', child.id)
        .gte('created_at', fiveDaysAgo)
        .limit(1)

      if (!recentMsgs || recentMsgs.length === 0) {
        newAlerts.push({
          child_id: child.id,
          alert_type: 'inactive',
          message: child.name + ' 5 gündür Dai ile konuşmadı. Uygulamayı birlikte açmak isteyebilirsiniz. 📱'
        })
      }

      // 3. Bu haftanın mesaj sayısı vs geçen hafta
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

      const { data: thisWeekMsgs } = await sb
        .from('messages')
        .select('id')
        .eq('child_id', child.id)
        .gte('created_at', oneWeekAgo)

      const { data: lastWeekMsgs } = await sb
        .from('messages')
        .select('id')
        .eq('child_id', child.id)
        .gte('created_at', twoWeeksAgo)
        .lt('created_at', oneWeekAgo)

      const thisCount = thisWeekMsgs?.length || 0
      const lastCount = lastWeekMsgs?.length || 0

      if (lastCount > 10 && thisCount < lastCount * 0.5) {
        newAlerts.push({
          child_id: child.id,
          alert_type: 'performance_drop',
          message: child.name + ' bu hafta geçen haftaya göre çok daha az aktif. Motivasyon düşüklüğü olabilir. 📉'
        })
      }

      // Yeni alarmları kaydet (aynı tip alarm zaten yoksa)
      for (const alert of newAlerts) {
        const { data: existing } = await sb
          .from('emotion_alerts')
          .select('id')
          .eq('child_id', child.id)
          .eq('alert_type', alert.alert_type)
          .eq('resolved', false)
          .limit(1)

        if (!existing || existing.length === 0) {
          await sb.from('emotion_alerts').insert(alert)
          totalAlerts++
        }
      }

      // Email bildir (yeni alarm varsa)
      if (newAlerts.length > 0 && child.parent_id) {
        const { data: parent } = await sb
          .from('parents')
          .select('email, full_name')
          .eq('id', child.parent_id)
          .maybeSingle()

        if (parent?.email) {
          await sendAlertEmail(parent.email, parent.full_name || 'Değerli Ebeveyn', child.name, newAlerts)
        }
      }
    }

    return res.status(200).json({ ok: true, checked: children.length, new_alerts: totalAlerts })

  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}
