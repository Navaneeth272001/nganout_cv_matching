# Resume-JD Matcher with LLM Backend

AI-powered resume to job description matching using OpenAI-compatible LLM APIs.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure `.env`

Edit `.env` and add your LLM API key:

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
PORT=3000
```

### 3. Run the Server

```bash
npm start
```

Server will be available at: `http://localhost:3000`

---

## API Key Sources

### OpenAI (Recommended for beginners)
- **Free tier**: $5 credit (for 3 months)
- Sign up: https://platform.openai.com/api-keys
- Model: `gpt-4o-mini` (cheapest option)

### Perplexity
- **Free tier**: Limited API credits
- Sign up: https://www.perplexity.ai/api
- Config:
  ```env
  OPENAI_BASE_URL=https://api.perplexity.ai
  OPENAI_MODEL=llama-2-70b-chat
  ```

### DeepSeek
- **Free tier**: $5 credit
- Sign up: https://platform.deepseek.com/api
- Config:
  ```env
  OPENAI_BASE_URL=https://api.deepseek.com
  OPENAI_MODEL=deepseek-chat
  ```

### Local Ollama (Free, offline)
- Download: https://ollama.ai
- Run: `ollama pull llama2` (or mistral, neural-chat, etc.)
- Config:
  ```env
  OPENAI_BASE_URL=http://localhost:11434/v1
  OPENAI_MODEL=llama2
  ```

---

## How It Works

1. **Upload** resumes and job descriptions (PDF files)
2. **Process** - Frontend sends to backend LLM API
3. **Analyze** - LLM scores each resume vs JD pair:
   - Match score (0-100)
   - Seniority fit (Strong/Medium/Weak)
   - Skill matches
   - Gaps
   - Summary
4. **Export** - Download results as CSV or Excel

---

## Architecture

- **Frontend**: `index.html` + `style.css` + `app.js` (vanilla JS)
- **Backend**: `server.js` (Express.js)
- **LLM**: Any OpenAI-compatible API (OpenAI, Perplexity, DeepSeek, local Ollama, etc.)

---

## Configuration

### Switching LLM Providers

All configuration is in `.env`. Change only these three variables:

| Provider | `OPENAI_BASE_URL` | `OPENAI_MODEL` | Notes |
|----------|-----------------|-----------------|-------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | Most reliable, paid |
| Perplexity | `https://api.perplexity.ai` | `llama-2-70b-chat` | Free tier available |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` | Cheap, good quality |
| Ollama (local) | `http://localhost:11434/v1` | `llama2` | Free, offline, slower |

---

## Troubleshooting

### "API key is not configured"
Make sure `.env` file exists and `OPENAI_API_KEY` is set (not `your_api_key_here`).

### "LLM request failed: 401"
Your API key is invalid or expired. Check it at your provider's dashboard.

### "LLM request failed: 429"
Rate limited. Either:
- Wait a few minutes
- Upgrade your API tier
- Switch to a different provider

### "Failed to parse LLM JSON"
The LLM returned malformed JSON. This can happen with less capable models. Try:
- Switching to `gpt-4o-mini` (recommended)
- Increasing `temperature` in `server.js` slightly

---

## File Structure

```
.
├── .env                 # Configuration (API keys, port, model)
├── package.json         # Node dependencies
├── server.js            # Express backend + LLM integration
├── index.html           # Frontend UI
├── style.css            # Styling
├── app.js               # Frontend logic
└── README.md            # This file
```

---

## Next Steps

- Upload your own resumes and job descriptions
- Adjust prompts in `server.js` for different scoring criteria
- Deploy to a cloud platform (Heroku, Railway, Render, etc.)
- Add database support for result storage
