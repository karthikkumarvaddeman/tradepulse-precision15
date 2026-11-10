# Import this project into Devin

Devin's documented setup connects a Git provider and then adds a repository. This folder is ready to be pushed to a **private GitHub repository**.

## 1. Create a private GitHub repository

1. Sign in to GitHub and create a new **private** repository named `tradepulse-precision15`.
2. Do not initialize the GitHub repository with a README (this project already contains one).
3. Extract this ZIP to a folder on your PC.
4. Open PowerShell in the extracted `tradepulse-precision15` folder and run:

```powershell
git init
git add .
git commit -m "Create TradePulse Precision 15 starter project"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/tradepulse-precision15.git
git push -u origin main
```

5. Check that `.env` is not present in the GitHub repository. Only `.env.example` should be committed.

## 2. Connect Devin

1. Open Devin and connect your GitHub account in repository settings/integrations.
2. Add the private `tradepulse-precision15` repository to Devin.
3. Start a new Devin session with the prompt below.

## 3. Suggested first Devin prompt

```text
Read AGENTS.md, DEVIN_TASK.md, README.md and all docs before changing code.
This is a clean starter repository for TradePulse Precision 15.
First inspect the repository, run typecheck/tests/build, and report the current state.
Then implement DEVIN_TASK.md in small reviewed phases. Preserve these user decisions:
- Windows PC hosting
- NIFTY and SENSEX only (not BANKNIFTY)
- 15-minute entry candles, completed 1-hour trend filter
- Semi-automatic execution: explicit approval in local dashboard before any order
- Telegram + dashboard alerts
- User capital is below ₹1 lakh; ask for/require exact amount in local .env, do not invent it
- 0.5% risk per trade, 1.5% daily loss cap, maximum two entries per day combined, one open position
- PAPER mode and live orders disabled by default
Do not enable live execution. Implement a mock order gateway first, add tests for all safety rules, and clearly report anything not completed.
```

## 4. Keep secrets local

Do not give Devin the values in `.env`. Do not add Zerodha API secrets, access tokens, Telegram bot token, account IDs, or other credentials to GitHub or Devin prompts. Enter them locally only after the code has been reviewed.
