# AppleSupport AI Customer Support Agent

An AI customer-support system built on the [Customer Support on Twitter (TWCS)](https://www.kaggle.com/datasets/thoughtvector/customer-support-on-twitter) dataset. Given a customer message, the system classifies intent, decides auto-handle vs. human escalation, and generates a grounded reply — evaluated against a 200-example hand-labeled golden set, two baselines, and an LLM-as-judge reply-quality pipeline with human agreement checks.

**Brand:** AppleSupport

## Why AppleSupport

| Brand | Support replies |
|---|---|
| AmazonHelp | 169,840 |
| **AppleSupport** | **106,860** |
| Uber_Support | 56,270 |
| SpotifyCares | 43,265 |
| Delta | 42,253 |

AmazonHelp has more volume but spans an unbounded catalog of products/orders, which would have made an 8-class intent taxonomy much harder to keep clean. AppleSupport has high volume *and* a bounded, mostly device/software-centric problem space, which is a better fit for a small, defensible taxonomy within the assignment's scope.

## Architecture

```
Customer message
      │
      ▼
TF-IDF retrieval over historical AppleSupport conversations (top 3)
      │
      ▼
LLM (Groq, openai/gpt-oss-20b) — strict JSON output
      │
      ├─ intent (1 of 8 classes)
      ├─ escalation (auto | human)
      └─ reply (grounded in retrieved examples)
```

- **Retriever** (`scripts/retriever.js`): TF-IDF over `data/apple_conversations.csv` (~106k historical customer→support pairs), via `natural`. Returns top-3 nearest customer messages and their real support replies as grounding evidence.
- **Agent** (`scripts/agent.js`): Groq LLM call with a JSON-schema-constrained response (`intent`, `escalation`, `reply`). Explicitly instructed not to invent policies, URLs, or claim actions it can't take (refunds, forwarding, etc.).

## Data pipeline

1. `analyzeBrands.js` — rank brands by support-reply volume from raw `twcs.csv`.
2. `extractApple.js` — pull AppleSupport's replies into `data/apple_support.csv`.
3. `buildConversations.js` — pair each AppleSupport reply with its parent customer tweet → `data/apple_conversations.csv` (~106k pairs).
4. `sampleConversations.js` — randomly sample 200 pairs → `data/apple_golden_set.csv`.
5. `prepareGoldenSet.js` / `labelGoldenSet.js` — manual CLI labeling of intent + escalation → `data/apple_golden_set_final.csv`.

The raw `twcs.csv` is not committed (see `.gitignore`) — it's large and publicly available on Kaggle.

## Golden evaluation set

200 manually labeled examples, single annotator, 0 unlabeled. Fields: `customer_text`, `intent`, `escalation`.

**Intent taxonomy** (primary intent only — a message is assigned its dominant issue, not every issue mentioned):

| Intent | Covers |
|---|---|
| `ios_update_issue` | Problems genuinely caused by / tied to an iOS update |
| `device_performance` | Freezing, slowness, restarts, overheating, connectivity, dropped calls |
| `battery_issue` | Battery drain, dying at a given %, battery life |
| `app_issue` | App-specific bugs, App Store, WhatsApp, Apple Music, notifications |
| `payment_account_issue` | Charges, payment methods, subscriptions, account access |
| `hardware_issue` | Physical damage, screen/touch faults, faulty accessories, safety issues |
| `product_order_issue` | Orders, print products, engraving, replacements |
| `general_support` | Vague requests with no specific problem |

Key rule: **mentioning an iOS update doesn't automatically mean `ios_update_issue`** — "battery draining fast after update" is `battery_issue`, not `ios_update_issue`, because the primary complaint is the battery. This rule, and the `device_performance` / `ios_update_issue` boundary in general, is the taxonomy's biggest source of ambiguity (see Failure Modes and Limitations below).

**Escalation labels:**

- **auto** — straightforward informational/troubleshooting, low-risk, no account/payment action needed
- **human** — account/payment/refund/unauthorized-charge issues, order/replacement actions, physical damage or safety risk, unclear/high-risk cases, explicit request for a human, or troubleshooting that's already failed

## Baselines

| | Baseline 1: Keyword classifier | Baseline 2: LLM-only (no retrieval) | Main: Retrieval-grounded agent |
|---|---|---|---|
| Model | Rule-based (`baselineClassifier.js`) | Groq `openai/gpt-oss-20b` | Groq `openai/gpt-oss-20b` + TF-IDF |
| Intent accuracy | 25.50% | 61.62% | 59.00% |
| Intent macro F1 | 32.15% | 59.60% | 57.12% |
| Escalation (AUTO F1 / HUMAN F1) | — | 50.0% / 44.7% | 48.7% / 27.7% |

The retrieval-grounded agent does **not** outperform the LLM-only baseline on intent classification, and it's noticeably worse on HUMAN-escalation F1. This is called out explicitly, not hidden — see [Known limitations](#known-limitations) for why, and what a fix looks like.

## Main agent results (200/200 examples completed)

**Intent** — accuracy 59.00%, macro precision 57.52%, macro recall 63.01%, macro F1 57.12%. Per-intent F1 ranges from 36.4% (`payment_account_issue`) to 70.0% (`battery_issue`); full per-class table in `data/main_agent_results.csv`.

**Escalation** — overall accuracy 40.00%, macro F1 38.21%.

| | Precision | Recall | F1 |
|---|---|---|---|
| AUTO | 33.1% | 91.9% | 48.7% |
| HUMAN | 82.1% | 16.7% | 27.7% |

⚠️ **Overall escalation accuracy (40%) is the misleading headline number here.** It looks uniformly bad, but it hides an asymmetric failure: the agent almost always predicts AUTO (91.9% AUTO recall) and rarely escalates a true HUMAN case (16.7% HUMAN recall). In a support-safety context, HUMAN recall is the metric that actually matters — a low overall accuracy caused by over-cautious over-escalation would be a very different (much more acceptable) problem than one caused by under-escalation. This is the single most important weakness in the system: **payment, order, and safety-risk cases are being auto-handled far too often.**

## Reply quality (LLM-as-judge, 1–5 scale, all 200 replies)

| Relevance | Grounding | Helpfulness | Appropriateness | Overall |
|---|---|---|---|---|
| 3.22 | 4.67 | 3.48 | 4.88 | 4.06 |

Judge model: same Groq model (`openai/gpt-oss-20b`) used for generation — a real limitation (no independent judge), disclosed below.

## Human vs. LLM judge agreement

110 of the 200 replies were independently scored by a human on the same 1–5 overall scale. Both scores were rounded to the nearest integer before computing agreement.

- Observed agreement: 53.64%
- Expected agreement: 40.13%
- **Cohen's κ = 0.2256 ("fair" agreement)**

This used **unweighted** kappa on rounded scores — a defensible but imperfect choice for an ordinal 1–5 scale, since it penalizes a near-miss (e.g. human=3, LLM=4) as harshly as a large miss (human=1, LLM=5). A weighted kappa would likely show higher agreement. Also note the human rated one holistic overall score, while the LLM's "overall" is an arithmetic mean of 4 separately-judged sub-scores — the comparison is reasonable but not perfectly like-for-like.

## Top 5 failure modes

1. **Device-performance vs. iOS-update confusion** — e.g. overheating after an update labeled `ios_update_issue` instead of `device_performance`; the "context vs. cause" distinction is genuinely hard.
2. **Missed human escalation** — the dominant failure mode by impact. Customers who already tried Apple's own troubleshooting, repeated restart/shutdown issues, and some account issues get auto-handled. HUMAN recall is only 16.7%.
3. **Unnecessary human escalation** — routine, answerable issues (informational backup questions, reproducible iOS behavior, password-safety questions) sometimes get escalated when AUTO would suffice.
4. **Payment/account vs. app confusion** — e.g. "free app requires a credit card" and Apple Pay Cash availability questions get misrouted between `payment_account_issue` and `app_issue`.
5. **Ambiguous/overlapping intent boundaries** — general overlap between `ios_update_issue`, `device_performance`, `app_issue`, `payment_account_issue`, and `general_support`.

These five were chosen for recurrence, impact, and diagnostic value — not mathematically verified as the five *most frequent* errors (see `scripts/failureAnalysis.js`, which prints curated buckets rather than doing frequency-ranked discovery).

## Known limitations

- **Retrieval corpus overlaps the golden set.** The 200 golden-set examples were sampled directly from `data/apple_conversations.csv`, which is also the TF-IDF retrieval corpus, and they were never excluded from it. In practice, the customer's own historical conversation (including the real support reply) is retrieved as the top evidence example for the majority of golden-set queries. This means the reported grounding score in particular should be read as an upper bound, not a clean measure of generalized retrieval-augmented grounding. **Planned fix:** exclude golden-set IDs from the retrieval corpus before indexing, and re-run evaluation.
- **Single annotator, no inter-annotator agreement** on the golden set's own labels.
- **Judge model = generation model.** Reply-quality scoring uses the same model family as the agent, not an independent judge.
- **Escalation under-recall on HUMAN cases (16.7%)** is the most safety-relevant gap; the escalation prompt lists specific triggers but has no explicit "escalate when uncertain" default.
- **Baseline 2 has no output-schema enforcement**, unlike the main agent, so its 2/200 failures are dropped rather than counted against it — not a perfectly matched comparison.

## Decision log

1. Chose AppleSupport for its combination of high volume and a bounded, tractable problem domain.
2. Used customer→support pairs (not arbitrary tweets) so the retrieval corpus has concrete historical resolutions, not isolated complaints.
3. Built an 8-intent taxonomy to keep the golden-set labeling and evaluation tractable while covering the most common AppleSupport issues.
4. Labeled by **primary** intent rather than every issue mentioned in a message.
5. Kept `device_performance` separate from `ios_update_issue` because an update is often context, not the actual root complaint.
6. Chose TF-IDF over embeddings for retrieval: fast, local, zero external dependency, fully reproducible within the time budget.
7. Retrieved top-3 examples as a balance between useful context and prompt size.
8. Used historical support replies as grounding evidence to reduce unsupported/invented claims in generated replies.
9. Added explicit escalation rules for account/payment/order/safety/specialist cases rather than leaving escalation purely to model judgment.
10. Switched from Gemini to Groq (`openai/gpt-oss-20b`) after hitting Gemini quota limits during repeated evaluation runs.
11. Enforced strict JSON schema output (agent + reply judge) for reliable, machine-parseable evaluation.
12. Used both LLM and human reply scoring because an LLM judge alone isn't automatically trustworthy.
13. Used unweighted Cohen's kappa on rounded scores for simplicity, with the tradeoff disclosed above rather than presented as a perfect measurement.
14. Did not exclude golden-set examples from the retrieval corpus in this iteration — a known gap, not an oversight left undisclosed (see Limitations).

## Repository structure

```
scripts/
  analyzeBrands.js        # rank brands by support volume
  extractApple.js         # extract AppleSupport replies
  buildConversations.js   # build customer<->support pairs
  sampleConversations.js  # sample 200 for golden set
  prepareGoldenSet.js     # scaffold labeling file
  labelGoldenSet.js       # interactive CLI labeler
  baselineClassifier.js   # Baseline 1: keyword classifier
  groqBaseline.js.js      # Baseline 2: LLM-only classifier
  retriever.js            # TF-IDF retrieval
  agent.js                # main retrieval-grounded agent
  evaluateAgent.js         # intent + escalation metrics for main agent
  evaluateReplies.js       # LLM-as-judge reply quality scoring
  prepareHumanJudge.js    # sample replies for human scoring
  calculateAgreement.js   # Cohen's kappa, human vs. LLM
  failureAnalysis.js      # curated failure-mode examples
data/
  apple_conversations.csv       # ~106k historical customer/support pairs
  apple_golden_set_final.csv    # 200 labeled examples
  main_agent_results.csv        # main agent predictions
  reply_quality_results.csv     # LLM judge scores
  human_judge_sample.csv        # human judge scores
```

## Running it

Requires Node.js and a Groq API key.

```bash
npm install
echo "GROQ_API_KEY=your_key_here" > .env
```

Place the raw TWCS `twcs.csv` in the repo root (not committed — see `.gitignore`), then run in order from `scripts/`:

```bash
node analyzeBrands.js          # optional: confirm brand selection
node extractApple.js
node buildConversations.js
node sampleConversations.js
node prepareGoldenSet.js
node labelGoldenSet.js         # interactive — manual labeling
node baselineClassifier.js     # Baseline 1
node groqBaseline.js.js        # Baseline 2 (~200 Groq calls, a few minutes)
node evaluateAgent.js          # main system evaluation (~10-15 min)
node evaluateReplies.js        # LLM judge (~200 Groq calls, resumable)
node prepareHumanJudge.js
node calculateAgreement.js     # after manually filling human_overall_score
node failureAnalysis.js
```

`evaluateAgent.js` is the "main evaluation" referenced by the assignment's 15-minute target. The full pipeline above (including both baselines and the reply-quality judge) takes meaningfully longer end-to-end due to sequential rate-limited API calls.
