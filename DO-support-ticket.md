# Subject: Clarify my remaining GenAI / prepaid AI credit balance — my dashboard is confusing

**Account / team (please fill in):**
- Account email: (your DigitalOcean login email)
- Team name: (your team name, e.g. "Harsh")
- Account UUID / team URN: (only if you're asked — do NOT paste API tokens, model access keys, or "Bearer" strings)

---

Hi DigitalOcean support,

I'm a hobby developer using your **GenAI inference products** (DeepSeek models, GLM models, and an inference router). I'm **not** running any Droplets or other core-compute resources, but my billing numbers are confusing me and I'd like to confirm what I actually have left.

**What I'm seeing**

1. **Prepaid AI credit balance shows $0.00.** I prepaid $10 and also purchased AI credits (a $50 "AI credit purchase") earlier this month in October 2026 — about $60 total. When I query the billing / prepayment endpoints, the "prepaid remaining" balance I get back is `0.00`, and the month-to-date balance shows `9.00`.

2. **A line item I don't understand.** In my itemized billing breakdown there is a **$9.00 "GST India (18.00%)"** charge. A separate **-$9.18 "AI credit purchase"** credit. Everything else is GenAI token usage (DeepSeek, GLM, Qwen, GPT-Oss inputs/outputs).

3. My usage so far this month looks like it adds up to roughly **$59–$60** in AI inference spend.

**What I'm trying to figure out**

- **What is my actual remaining available balance** for GenAI inference right now? (i.e., after the $10 prepaid is used, the $50 purchase, the $9 tax, and the -$9.18 credit — how much is left to spend, if anything?)
- Why does the prepaid/prepayment API report `balance: 0.00` even though I bought $50 in AI credits this month?
- Should the "$50 AI credit purchase" show up as *available credit remaining*, or is it already consumed into the usage total?

**Some context that may help**

- I do **not** have any core compute (Droplets, etc.) — everything is GenAI inference, so I expected the dollar amounts to map cleanly to AI usage.
- I'm managing my inference router via the GenAI API because the DigitalOcean control panel no longer offers router settings. That part is working — just flagging it in case it's relevant to billing.

**What I need from you**

1. A clear statement of my **current remaining GenAI/prepaid credit balance** as of today.
2. Confirmation of whether the **$50 AI credit purchase** is counted as (a) available credit, or (b) already spent usage.
3. Confirmation that the **$9.00 GST India charge** is a tax line and not compute usage (so I don't chase a $9 "mystery charge").

I can share any of my team's UUIDs if you need them to look me up — just ask. Thanks very much for your help!

Best regards,
(your name)
