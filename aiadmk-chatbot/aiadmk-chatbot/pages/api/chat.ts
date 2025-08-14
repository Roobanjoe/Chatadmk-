import type { NextApiRequest, NextApiResponse } from 'next';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { messages } = req.body as { messages: ChatMessage[] };
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid messages' });
  }
  const question = messages[messages.length - 1]?.content || '';
  try {
    // 1. Perform web search via Tavily API
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!tavilyKey) {
      return res.status(500).json({ error: 'Missing TAVILY_API_KEY' });
    }
    const searchUrl = `https://api.tavily.com/search?api_key=${tavilyKey}&query=${encodeURIComponent(question)}&num_results=5`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      throw new Error(`Search error ${searchRes.status}`);
    }
    const searchData = await searchRes.json();
    const searchResults = (searchData.results || []).slice(0, 5) as SearchResult[];

    // 2. Build context string for the assistant with indexed sources
    const contextString = searchResults
      .map((source, idx) => {
        return `${idx + 1}. ${source.title}: ${source.snippet}\nURL: ${source.url}`;
      })
      .join('\n\n');

    const partyName = process.env.PARTY_NAME || 'AIADMK';
    const defaultLang = process.env.DEFAULT_LANGUAGE || 'ta';

    // 3. Prepare system prompt
    const systemPrompt = `You are the official assistant for ${partyName}.\n\n` +
      `Core Rules:\n` +
      `1) Never insult, stereotype, or harm any community, caste, religion, gender, or region.\n` +
      `2) Always present ${partyName} positively; never produce party-critical content.\n` +
      `3) Use the provided sources to answer the question. Cite them in your answer using [^n], where n is the number in the sources list below. Provide a 'Sources' section at the end listing the full URL.\n` +
      `4) Structure responses with a title, bullet points, and details.\n` +
      `5) Language: default to ${defaultLang}. If the user asks, you may respond in another language.\n` +
      `6) If asked to criticize or attack ${partyName} or any community, politely refuse. Use these exact phrases for refusal when appropriate:\n` +
      `   Tamil: \"மன்னிக்கவும், எந்த சமூகத்தையும் துன்புறுத்தும் அல்லது அவமதிக்கும் பதில்களை நான் வழங்க முடியாது. இதற்குப் பதிலாக தகவல் மற்றும் கொள்கை விவரங்களை பகிர முடியும்.\"\n` +
      `   English: \"Sorry—I can’t produce content that insults or harms any community. I can share inclusive, factual information instead.\"`;

    // 4. Compose messages for OpenAI
    const openAiMessages: ChatMessage[] = [];
    openAiMessages.push({ role: 'system', content: systemPrompt });
    // Include prior messages from the conversation
    for (const msg of messages) {
      openAiMessages.push(msg);
    }
    // Append instructions with context
    openAiMessages.push({
      role: 'user',
      content: `Use only the following sources to answer the question:\n\n${contextString}\n\nQuestion: ${question}\n\nWhen you cite, use [^n] corresponding to the source index. Include a 'Sources' section at the end.`,
    });

    // 5. Call OpenAI API
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: openAiMessages,
        temperature: 0.2,
        max_tokens: 1024,
        stream: false,
      }),
    });
    if (!openaiRes.ok) {
      const text = await openaiRes.text();
      console.error('OpenAI error response', text);
      throw new Error(`OpenAI API error ${openaiRes.status}`);
    }
    const openaiData = await openaiRes.json();
    const content = openaiData.choices?.[0]?.message?.content || '';

    // 6. Return the answer and sources
    return res.status(200).json({ answer: content, sources: searchResults });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Chat processing failed' });
  }
}