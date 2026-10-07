# Coding Rules

## Never Do

- ❌ No TypeScript
- ❌ No React/Vue/frameworks
- ❌ No database servers
- ❌ No hardcoded credentials
- ❌ No cloud LLM APIs
- ❌ No packages > 5MB
- ❌ No `var`
- ❌ No inline styles
- ❌ No .env in Git
- ❌ No Reddit/Xiaohongshu (RAM)

## Always Do

- ✅ async/await over callbacks
- ✅ try/catch on external calls
- ✅ Log with timestamp
- ✅ JSON: `{ success, data, error }`
- ✅ Functional helpers, no classes
- ✅ Functions < 50 lines
- ✅ `const` over `let`
- ✅ Validate input before LLM
- ✅ Fallback if llama.cpp is down
- ✅ Comment non-obvious logic

## Naming

| Item | Convention |
|------|-----------|
| Files | kebab-case |
| Functions | camelCase |
| Constants | UPPER_SNAKE |
| Routes | kebab-case |

## Style

- 2 spaces, single quotes, semicolons
- Max 100 chars/line
- Trailing commas in multi-line literals

## Error Pattern

```javascript
async function handler(req, res) {
  try {
    const result = await doWork(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
}
```

## Dependency Policy

Before installing: stdlib? < 5MB? maintained? writable in < 30 lines?

Only `express` ships as a dependency; `fetch` and `--env-file` replace axios and
dotenv, which keeps `node_modules` in the tens-of-megabytes range.

## Model Discipline

- The deterministic rule engine is the source of truth for EDF deadlines and
  non-export detection.
- LLM output is validated against the purpose code table before use.
- LLM failures degrade to rules-only; they never fail a request.
