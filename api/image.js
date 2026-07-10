export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const prompt = req.query?.prompt || req.body?.prompt;
  if (!prompt) return res.status(400).json({error:"prompt required"});

  try {
    const seed = Math.floor(Math.random() * 1000000);
    const encoded = encodeURIComponent(prompt);
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&seed=${seed}&nologo=true&model=turbo&format=jpeg`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Pollinations error: ${response.status}`);

    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Length", buffer.byteLength);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).send(Buffer.from(buffer));
  } catch (e) {
    return res.status(500).json({error: e.message});
  }
}
