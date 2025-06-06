// ai-grants.ts - Supabase Edge Function for AI-powered grant matching
// deno-lint-ignore-file no-explicit-any
// @deno-types="https://deno.land/std@0.181.0/server/mod.ts"
import { serve } from 'https://deno.land/std@0.181.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';


const supabaseUrl = Deno.env.get('VITE_SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders(),
    });
  }

  const { query } = await req.json();
  const apiKey = Deno.env.get('AI_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'AI API key not set' }), {
      status: 500,
      headers: corsHeaders(),
    });
  }

  // Improved Gemini prompt for robust keyword extraction
  const body = {
    contents: [{ parts: [{ text: `Extract a comma-separated list of keywords (no sentences, just words) from this user query for grant matching: ${query}` }]}]
  };

  try {
    // 1. Get keywords from Gemini
    const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey;
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const geminiData = await geminiRes.json();
    const keywordsText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // More flexible: split only on commas and trim
    const keywords = keywordsText
      .split(',')
      .map((k: string) => k.trim().toLowerCase())
      .filter((k: string) => k.length > 0);

    // Debug logging
    console.log('User query:', query);
    console.log('Gemini keywords:', keywords);

    // 2. Fetch all grants from Supabase
    const { data: grants, error } = await supabase.from('grants').select('*');
    if (error || !grants) {
      return new Response(JSON.stringify({ error: 'Failed to fetch grants' }), {
        status: 500,
        headers: corsHeaders(),
      });
    }
    console.log('Fetched grants:', grants.map(g => ({ title: g.title, tags: g.tags })));

    // 3. Filter grants by keywords (title, description, tags)
    const matches = grants.filter((grant: any) => {
      const text = `${grant.title} ${grant.description} ${(grant.tags || []).join(' ')}`.toLowerCase();
      return keywords.some((kw: string) => text.includes(kw));
    });

    // 4. Return top 5 matches
    return new Response(JSON.stringify({
      message: matches.length > 0
        ? `Top matching grants:\n${matches.slice(0, 5).map((g: any) => `- ${g.title} (${g.organization})`).join('\n')}`
        : 'No relevant grants found.',
      grants: matches.slice(0, 5)
    }), {
      headers: corsHeaders(),
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to contact Gemini API or Supabase' }), {
      status: 500,
      headers: corsHeaders(),
    });
  }
}); 