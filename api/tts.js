export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({error:"Method not allowed"});

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const { voiceId, text, voice_settings } = req.body;
  if (!voiceId || !text) return res.status(400).json({error:"voiceId and text required"});

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": process.env.ELEVENLABS_KEY
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: voice_settings || {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.2,
          use_speaker_boost: false
        },
        output_format: "mp3_22050_32"
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({error: err});
    }

    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.byteLength);
    return res.status(200).send(Buffer.from(buffer));
  } catch (e) {
    return res.status(500).json({error: e.message});
  }
}
