// server.js — FINAL, ACCURATE CV–JD MATCHER (ATS-grade)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse'); // MUST be v1.1.1

const app = express();
const upload = multer();

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL;
const MODEL = process.env.OPENAI_MODEL;

if (!API_KEY || !BASE_URL || !MODEL) {
  console.error('❌ Missing LLM configuration in .env');
  process.exit(1);
}

console.log(`✓ Model: ${MODEL}`);
console.log(`✓ Endpoint: ${BASE_URL}`);

app.use(cors());
app.use(express.static(__dirname));

/* ============================================================
   REGEX + HEURISTICS (DETERMINISTIC EXTRACTION)
   ============================================================ */

const emailRegex =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g;

const phoneRegex =
  /(\+?\d{1,3}[\s-]?)?\d{10}/g;

const linkedinRegex =
  /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+/gi;

function extractName(text) {
  const blacklist = [
    'engineering',
    'engineer',
    'electronics',
    'communication',
    'computer',
    'science',
    'technology',
    'information',
    'chennai',
    'bangalore',
    'india',
    'profile',
    'summary',
    'resume',
    'curriculum',
    'switzerland',
    'germany',
    'france',
    'united states',
    'united kingdom',
    'zurich',
    'embedded',
    'developer',
    'manager',
    'intern',
    'internship',
    'student',
    'graduate',
    'university',
    'college',
    'systems',
    'administrator'
  ];


  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && l.length < 60);

  for (const line of lines.slice(0, 10)) {
    const lower = line.toLowerCase();

    // Reject blacklisted semantic lines
    if (blacklist.some(word => lower.includes(word))) continue;

    // Reject lines with emails, phones, numbers, symbols
    if (/[0-9@:/]/.test(line)) continue;

    // Normalize ALL CAPS
    const normalized =
      /^[A-Z\s]+$/.test(line)
        ? line.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
        : line;

    // Main regex:
    // - First name
    // - Middle/last names
    // - Optional single-letter initials
    if (
      /^[A-Z][a-z]+(\s[A-Z][a-z]+)*(\s[A-Z])?$/.test(normalized)
    ) {
      return normalized;
    }
  }

  return 'Unknown';

}


/* ---------- Entity extraction ---------- */
function extractEntities(text) {
  const linkedinMatch = text.match(linkedinRegex);

  return {
    candidate_name: extractName(text),
    email: (text.match(emailRegex) || [])[0] || '—',
    phone: (text.match(phoneRegex) || [])[0] || '—',
    linkedin: linkedinMatch
      ? linkedinMatch[0].startsWith('http')
        ? linkedinMatch[0]
        : `https://${linkedinMatch[0]}`
      : '—'
  };
}

/* ---------- Helpers ---------- */
const truncate = (text, max = 1500) =>
  text.length > max ? text.slice(0, max) : text;

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM did not return JSON');
  return JSON.parse(match[0]);
}

/* ============================================================
   API
   ============================================================ */

app.post(
  '/api/match',
  upload.fields([
    { name: 'resume', maxCount: 1 },
    { name: 'jd', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const resumeFile = req.files?.resume?.[0];
      const jdFile = req.files?.jd?.[0];

      if (!resumeFile || !jdFile) {
        return res.status(400).json({ error: 'Missing resume or JD file' });
      }

      /* ---------- PDF → TEXT ---------- */
      let resumeText = (await pdfParse(resumeFile.buffer)).text;
      let jdText = (await pdfParse(jdFile.buffer)).text;

      /* ---------- ENTITY EXTRACTION ---------- */
      const entities = extractEntities(resumeText);

      /* ---------- TRUNCATE FOR LLM ---------- */
      resumeText = truncate(resumeText);
      jdText = truncate(jdText);

      const systemPrompt = `
You are an ATS scoring engine.
Return ONLY valid JSON:
{
  "match_score": number,
  "seniority_fit": "Strong" | "Medium" | "Weak",
  "summary": string
}
      `.trim();

      const userPrompt = `
RESUME:
${resumeText}

JOB DESCRIPTION:
${jdText}
      `.trim();

      /* ---------- LLM CALL ---------- */
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          max_tokens: 200,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(err);
      }

      const data = await response.json();
      const llmResult = extractJSON(
        data.choices[0].message.content
      );

      /* ---------- FINAL RESPONSE ---------- */
      res.json({
        ...entities,
        match_score: llmResult.match_score,
        seniority_fit: llmResult.seniority_fit,
        summary: llmResult.summary
      });

    } catch (err) {
      console.error('❌ Match error:', err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

/* ============================================================ */

app.listen(PORT, () => {
  console.log(`\n✅ Server running at http://localhost:${PORT}\n`);
});
