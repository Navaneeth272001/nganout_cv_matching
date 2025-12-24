// server.js — IMPROVED WITH RATE LIMITING + BETTER PHONE EXTRACTION

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');

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
RATE LIMITING - PREVENT TOKEN EXHAUSTION
============================================================ */

let requestQueue = [];
let isProcessing = false;
const REQUEST_DELAY = 500; // 500ms between LLM requests

async function rateLimitedFetch(url, options) {
  return new Promise((resolve, reject) => {
    requestQueue.push(() =>
      fetch(url, options)
        .then(resolve)
        .catch(reject)
    );
    processQueue();
  });
}

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  const request = requestQueue.shift();
  
  try {
    await request();
  } finally {
    await new Promise(r => setTimeout(r, REQUEST_DELAY));
    isProcessing = false;
    processQueue();
  }
}

/* ============================================================
IMPROVED REGEX PATTERNS
============================================================ */

// Email pattern
const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g;

// IMPROVED Phone pattern - handles Indian, US, and international formats
const phoneRegex = /(\+?91|0)?[\s-]?[6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4}|(\+1[\s-]?)?(\(\d{3}\)|[\s-]?\d{3})[\s-]?\d{3}[\s-]?\d{4}/g;

// LinkedIn pattern
const linkedinRegex = /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+/gi;

/* ============================================================
IMPROVED PHONE NUMBER EXTRACTION
============================================================ */

function extractPhones(text) {
  const matches = text.match(phoneRegex) || [];
  
  if (matches.length > 0) {
    // Return first valid phone number, cleaned up
    let phone = matches[0]
      .replace(/[\s\-()]/g, '')
      .replace(/^0/, '+91');
    
    return phone || '—';
  }

  // FALLBACK: Look for patterns that might be missed
  const lines = text.split('\n');
  for (const line of lines) {
    // Pattern: +91 9876543210 or 9876543210
    const match = line.match(/(\+91[\s]?)?([6-9]\d{9})/);
    if (match) {
      return match[0].trim();
    }
    // Pattern: (91) 98765-43210
    const match2 = line.match(/\(91\)[\s]?([6-9]\d{4})[\s-]?(\d{5})/);
    if (match2) {
      return `+91${match2[1]}${match2[2]}`;
    }
  }

  return '—';
}

/* ============================================================
LLM-BASED NAME EXTRACTION (WITH CACHING)
============================================================ */

const nameCache = {};

async function extractNameWithLLM(text, resumeFileName) {
  // Cache check: if we've seen similar resume before, reuse
  const cacheKey = resumeFileName;
  if (nameCache[cacheKey]) {
    console.log(`✓ Using cached name for ${resumeFileName}`);
    return nameCache[cacheKey];
  }

  try {
    const systemPrompt = `You are an expert at extracting candidate names from resumes.
Return ONLY a valid JSON object with field "name" containing the candidate's full name.
If the name cannot be determined, return {"name": "Unknown"}.
Do NOT include titles, degrees, company names, or locations.
Examples:
- Input: "John Smith Senior Engineer at Google" → Output: {"name": "John Smith"}
- Input: "Bangalore Tech Solutions" → Output: {"name": "Unknown"}`;

    const userPrompt = `Extract the candidate's full name from this resume text. Return only JSON.

${text.slice(0, 800)}`;

    const response = await rateLimitedFetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 50,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.warn('⚠️ LLM API error:', err.error?.message);
      return null;
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    const match = content.match(/\{[\s\S]*\}/);
    
    if (match) {
      const result = JSON.parse(match[0]);
      const name = result.name !== 'Unknown' ? result.name : null;
      
      // Cache the result
      if (name) {
        nameCache[cacheKey] = name;
      }
      
      return name;
    }
  } catch (err) {
    console.warn('⚠️ LLM extraction error:', err.message);
  }
  return null;
}

/* ============================================================
FALLBACK REGEX NAME EXTRACTION
============================================================ */

function extractNameRegex(text) {
  const blacklist = [
    'engineering', 'engineer', 'electronics', 'communication',
    'computer', 'science', 'technology', 'information',
    'chennai', 'bangalore', 'india', 'profile', 'summary',
    'resume', 'curriculum', 'switzerland', 'germany', 'france',
    'united states', 'united kingdom', 'zurich', 'embedded',
    'developer', 'manager', 'intern', 'internship', 'student',
    'graduate', 'university', 'college', 'systems', 'administrator',
    'private', 'ltd', 'inc', 'company', 'corp', 'tech', 'solutions',
    'pvt', 'llc', 'gmbh', 'srl', 'group', 'enterprises'
  ];

  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && l.length < 60);

  for (const line of lines.slice(0, 20)) {
    const lower = line.toLowerCase();

    // Reject blacklisted words
    if (blacklist.some(word => lower.includes(word))) continue;

    // Reject lines with emails, phones, numbers, symbols (except apostrophe, hyphen, dot)
    if (/[0-9@:/!]/.test(line)) continue;

    // Normalize ALL CAPS
    const normalized =
      /^[A-Z\s]+$/.test(line)
        ? line.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
        : line;

    // Match: First name + Middle/Last names + optional initials + hyphens/apostrophes
    if (/^[A-Z][a-z]+([\s\-'][A-Z][a-z]+)*([\s][A-Z])?$/.test(normalized)) {
      return normalized;
    }
  }

  return null;
}

/* ============================================================
ENTITY EXTRACTION
============================================================ */

async function extractEntities(text, resumeFileName) {
  // Try LLM name extraction first
  let name = await extractNameWithLLM(text, resumeFileName);
  
  // Fallback to regex
  if (!name) {
    name = extractNameRegex(text);
  }

  const linkedinMatch = text.match(linkedinRegex);
  
  return {
    candidate_name: name || 'Unknown',
    email: (text.match(emailRegex) || [])[0] || '—',
    phone: extractPhones(text),
    linkedin: linkedinMatch
      ? linkedinMatch[0].startsWith('http')
        ? linkedinMatch[0]
        : `https://${linkedinMatch[0]}`
      : '—'
  };
}

/* ============================================================
HELPERS
============================================================ */

const truncate = (text, max = 1500) =>
  text.length > max ? text.slice(0, max) : text;

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM did not return JSON');
  return JSON.parse(match[0]);
}

/* ============================================================
BATCH MATCHING ENDPOINT
============================================================ */

app.post(
  '/api/batch-match',
  upload.fields([
    { name: 'resumes', maxCount: 100 },
    { name: 'jd', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const resumeFiles = req.files?.resumes || [];
      const jdFile = req.files?.jd?.[0];

      if (resumeFiles.length === 0 || !jdFile) {
        return res.status(400).json({ 
          error: 'Missing resumes or JD file' 
        });
      }

      // Parse JD once
      const jdText = truncate((await pdfParse(jdFile.buffer)).text);

      const systemPrompt = `You are an ATS scoring engine.
Return ONLY valid JSON with these exact fields:
{
  "match_score": number (0-100),
  "seniority_fit": "Strong" | "Medium" | "Weak",
  "summary": string
}`.trim();

      // Process all resumes
      const results = [];

      for (const resumeFile of resumeFiles) {
        try {
          const resumeText = truncate((await pdfParse(resumeFile.buffer)).text);
          
          // Extract entities
          const entities = await extractEntities(resumeText, resumeFile.originalname);

          // LLM scoring with rate limiting
          const userPrompt = `RESUME:
${resumeText}

JOB DESCRIPTION:
${jdText}`;

          const response = await rateLimitedFetch(`${BASE_URL}/chat/completions`, {
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
            const err = await response.json();
            throw new Error(err.error?.message || 'LLM request failed');
          }

          const data = await response.json();
          const llmResult = extractJSON(data.choices[0].message.content);

          results.push({
            resume_name: resumeFile.originalname,
            ...entities,
            match_score: llmResult.match_score,
            seniority_fit: llmResult.seniority_fit,
            summary: llmResult.summary
          });

          console.log(`✓ Processed: ${resumeFile.originalname} (${llmResult.match_score}%)`);

        } catch (err) {
          console.error(`❌ Error processing ${resumeFile.originalname}:`, err.message);
          // Add error result for this resume
          results.push({
            resume_name: resumeFile.originalname,
            candidate_name: 'Unknown',
            match_score: 0,
            seniority_fit: 'Weak',
            summary: `Error: ${err.message}`,
            email: '—',
            phone: '—',
            linkedin: '—'
          });
        }
      }

      // RANK by match_score (descending)
      results.sort((a, b) => b.match_score - a.match_score);

      res.json({
        total: results.length,
        ranked_results: results
      });

    } catch (err) {
      console.error('❌ Batch match error:', err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

/* ============================================================
LEGACY SINGLE MATCH ENDPOINT (COMPATIBILITY)
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

      let resumeText = truncate((await pdfParse(resumeFile.buffer)).text);
      let jdText = truncate((await pdfParse(jdFile.buffer)).text);

      const entities = await extractEntities(resumeText, resumeFile.originalname);

      const systemPrompt = `You are an ATS scoring engine.
Return ONLY valid JSON:
{
  "match_score": number,
  "seniority_fit": "Strong" | "Medium" | "Weak",
  "summary": string
}`.trim();

      const userPrompt = `RESUME:
${resumeText}

JOB DESCRIPTION:
${jdText}`;

      const response = await rateLimitedFetch(`${BASE_URL}/chat/completions`, {
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
        const err = await response.json();
        throw new Error(err.error?.message || 'LLM request failed');
      }

      const data = await response.json();
      const llmResult = extractJSON(data.choices[0].message.content);

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