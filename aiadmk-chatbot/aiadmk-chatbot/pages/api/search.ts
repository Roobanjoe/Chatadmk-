import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { query } = req.body as { query: string };
  try {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing TAVILY_API_KEY' });
    }
    const url = `https://api.tavily.com/search?api_key=${apiKey}&query=${encodeURIComponent(query)}&num_results=5`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Search error ${response.status}`);
    }
    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Search failed' });
  }
}