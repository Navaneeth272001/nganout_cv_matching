// server.js — UNIVERSAL LLM SUPPORT (OpenAI, Perplexity, DeepSeek, Ollama, Groq, Claude)

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const app = express();
const upload = multer();
const PORT = process.env.PORT || 3000;

// Support multiple LLM providers
const API_KEY = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL;
const MODEL = process.env.OPENAI_MODEL;

// Detect provider from BASE_URL
function detectProvider() {
  if (!BASE_URL) return 'UNKNOWN';
  if (BASE_URL.includes('anthropic')) return 'ANTHROPIC';
  if (BASE_URL.includes('openai')) return 'OPENAI';
  if (BASE_URL.includes('perplexity')) return 'PERPLEXITY';
  if (BASE_URL.includes('deepseek')) return 'DEEPSEEK';
  if (BASE_URL.includes('groq')) return 'GROQ';
  if (BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1')) return 'OLLAMA';
  return 'CUSTOM';
}

const PROVIDER = detectProvider();

if (!API_KEY || !BASE_URL || !MODEL) {
  console.error('❌ Missing LLM configuration in .env');
  console.error('Required:');
  console.error('  - OPENAI_API_KEY or ANTHROPIC_API_KEY');
  console.error('  - OPENAI_BASE_URL');
  console.error('  - OPENAI_MODEL');
  process.exit(1);
}

console.log(`✓ Provider: ${PROVIDER}`);
console.log(`✓ Model: ${MODEL}`);
console.log(`✓ Endpoint: ${BASE_URL}`);

app.use(cors());
app.use(express.static(__dirname));

/* ============================================================
RATE LIMITING - PREVENT TOKEN EXHAUSTION
============================================================ */

let requestQueue = [];
let isProcessing = false;
const REQUEST_DELAY = 500; // 500ms between API requests

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

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g;
const phoneRegex = /(\+?91|0)?[\s-]?[6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4}|(\+1[\s-]?)?(\(\d{3}\)|[\s-]?\d{3})[\s-]?\d{3}[\s-]?\d{4}/g;
const linkedinRegex = /(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+/gi;

/* ============================================================
LLM-BASED NAME EXTRACTION (WITH CACHING)
============================================================ */

const nameCache = {};

async function extractNameWithLLM(text, resumeFileName) {
  const cacheKey = resumeFileName;
  if (nameCache[cacheKey]) {
    console.log(`✓ Using cached name for ${resumeFileName}`);
    return nameCache[cacheKey];
  }

  try {
    // Build provider-specific request
    let requestBody = {};
    let headers = {
      'Content-Type': 'application/json'
    };

    if (PROVIDER === 'ANTHROPIC') {
      headers['x-api-key'] = API_KEY;
      headers['anthropic-version'] = '2023-06-01';
      
      requestBody = {
        model: MODEL,
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: `Extract the candidate's full name from this resume text. Return ONLY a valid JSON object with field "name". Do NOT include titles, degrees, company names, or locations.

Resume text:
${text.slice(0, 800)}`
          }
        ]
      };
    } else {
      // OpenAI-compatible format (OpenAI, Groq, Perplexity, DeepSeek, Ollama)
      headers['Authorization'] = `Bearer ${API_KEY}`;
      
      requestBody = {
        model: MODEL,
        temperature: 0.1,
        max_tokens: 50,
        messages: [
          {
            role: 'system',
            content: 'Extract the candidate\'s full name from resume text. Return ONLY JSON: {"name": "Full Name"}. Do NOT include titles, degrees, company names, or locations.'
          },
          {
            role: 'user',
            content: `Extract name from resume:\n\n${text.slice(0, 800)}`
          }
        ]
      };
    }

    const response = await rateLimitedFetch(
      PROVIDER === 'ANTHROPIC' 
        ? 'https://api.anthropic.com/v1/messages'
        : `${BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const err = await response.json();
      console.warn('⚠️ LLM API error:', err.error?.message || JSON.stringify(err));
      return null;
    }

    const data = await response.json();
    let content = '';

    // Extract content based on provider
    if (PROVIDER === 'ANTHROPIC') {
      content = data.content[0].text;
    } else {
      content = data.choices[0].message.content;
    }

    const match = content.match(/\{[\s\S]*\}/);
    
    if (match) {
      const result = JSON.parse(match[0]);
      const name = result.name !== 'Unknown' ? result.name : null;
      
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

    if (blacklist.some(word => lower.includes(word))) continue;
    if (/[0-9@:/!]/.test(line)) continue;

    const normalized =
      /^[A-Z\s]+$/.test(line)
        ? line.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
        : line;

    if (/^[A-Z][a-z]+([\s\-'][A-Z][a-z]+)*([\s][A-Z])?$/.test(normalized)) {
      return normalized;
    }
  }

  return null;
}

/* ============================================================
IMPROVED PHONE NUMBER EXTRACTION
============================================================ */

function extractPhones(text) {
  const matches = text.match(phoneRegex) || [];
  
  if (matches.length > 0) {
    let phone = matches[0]
      .replace(/[\s\-()]/g, '')
      .replace(/^0/, '+91');
    
    return phone || '—';
  }

  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/(\+91[\s]?)?([6-9]\d{9})/);
    if (match) {
      return match[0].trim();
    }
    const match2 = line.match(/\(91\)[\s]?([6-9]\d{4})[\s-]?(\d{5})/);
    if (match2) {
      return `+91${match2[1]}${match2[2]}`;
    }
  }

  return '—';
}

/* ============================================================
ENTITY EXTRACTION
============================================================ */

async function extractEntities(text, resumeFileName) {
  let name = await extractNameWithLLM(text, resumeFileName);
  
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

const truncate = (text, max = 2000) =>
  text.length > max ? text.slice(0, max) : text;

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM did not return valid JSON');
  return JSON.parse(match[0]);
}

/* ============================================================
IMPROVED MATCHING WITH DETAILED ANALYSIS
============================================================ */

async function scoreResumeWithLLM(resumeText, jdText) {
  try {
    // Provider-specific scoring system
    let requestBody = {};
    let headers = {
      'Content-Type': 'application/json'
    };

const systemPrompt = `ATS scoring engine. Score CV vs JD (0-100).

RULES:
- Skills (40%), Experience (30%), Role (20%), Education (10%)
- DIFFERENT CVs = DIFFERENT scores
- 80-95%: Perfect match
- 50-70%: Partial  
- 20-50%: Minimal
- 0-20%: No match

Return ONLY JSON (no other text):
{
  "match_score": 85,
  "skills_match": "80%",
  "seniority_fit": "Strong",
  "summary": "2 sentences max"
}`;


    const userPrompt = `Analyze this CV against the JD and provide a detailed matching score.

RESUME:
${resumeText}

JOB DESCRIPTION:
${jdText}

Provide detailed analysis considering skill gaps, experience level, and role alignment.`;

    if (PROVIDER === 'ANTHROPIC') {
      headers['x-api-key'] = API_KEY;
      headers['anthropic-version'] = '2023-06-01';
      
      requestBody = {
        model: MODEL,
        max_tokens: 500,
        messages: [
          { role: 'user', content: userPrompt }
        ],
        system: systemPrompt
      };
    } else {
      // OpenAI-compatible format
      headers['Authorization'] = `Bearer ${API_KEY}`;
      
      requestBody = {
        model: MODEL,
        temperature: 0.2,
        max_tokens: 500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      };
    }

    const response = await rateLimitedFetch(
      PROVIDER === 'ANTHROPIC'
        ? 'https://api.anthropic.com/v1/messages'
        : `${BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'LLM request failed');
    }

    const data = await response.json();
    let content = '';

    // Extract content based on provider
    if (PROVIDER === 'ANTHROPIC') {
      content = data.content[0].text;
    } else {
      content = data.choices[0].message.content;
    }
    
    const result = extractJSON(content);
    
    // Ensure score is between 0-100
    result.match_score = Math.max(0, Math.min(100, parseInt(result.match_score) || 50));
    
    return result;

  } catch (err) {
    console.error('❌ LLM scoring error:', err.message);
    throw err;
  }
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

      // Process all resumes
      const results = [];

      for (const resumeFile of resumeFiles) {
        try {
          const resumeText = truncate((await pdfParse(resumeFile.buffer)).text);
          
          // Extract entities
          const entities = await extractEntities(resumeText, resumeFile.originalname);

          // Score with LLM
          const llmResult = await scoreResumeWithLLM(resumeText, jdText);

          results.push({
            resume_name: resumeFile.originalname,
            ...entities,
            match_score: llmResult.match_score,
            skills_match: llmResult.skills_match,
            experience_fit: llmResult.experience_fit,
            seniority_fit: llmResult.seniority_fit,
            summary: llmResult.summary
          });

          console.log(`✓ Processed: ${resumeFile.originalname} (${llmResult.match_score}%)`);

        } catch (err) {
          console.error(`❌ Error processing ${resumeFile.originalname}:`, err.message);
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

      const llmResult = await scoreResumeWithLLM(resumeText, jdText);

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