 
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query } = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!query) return res.status(400).json({ error: "Query required" });

  const key = process.env.TAVILY_KEY;
  if (!key) return res.status(500).json({ error: "TAVILY_KEY not configured" });

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "basic",
        max_results: 3,
        include_answer: true,
      })
    });
    const data = await response.json();
    return res.status(200).json({
      answer: data.answer || "",
      results: (data.results || []).map(r => ({
        title: r.title,
        content: r.content?.slice(0, 300),
        url: r.url
      }))
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}