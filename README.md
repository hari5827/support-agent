# AppleSupport AI Customer Support Agent

A retrieval-grounded customer-support system built on the [Customer Support on Twitter (TWCS)](https://www.kaggle.com/datasets/thoughtvector/customer-support-on-twitter) dataset. Given an incoming customer message, the system classifies the intent, decides whether the case can be handled automatically or needs a human, and drafts a reply grounded in real historical AppleSupport conversations — all in a single constrained-JSON LLM call.

**Brand:** AppleSupport · **Golden Set:** 200 manually labeled examples · **LLM:** Groq `openai/gpt-oss-20b`
> [!IMPORTANT]
> **API KEY / RATE-LIMIT NOTE**
>
> This project uses **two separate Groq API keys** for different stages of the evaluation:
>
> - `GROQ_API_KEY` → used by `agent.js` and `groqBaseline.js`
> - `GROQ_EVAL_API_KEY` → used by `evaluateReplies.js` for LLM-based reply evaluation
>
> A separate evaluation key was used because the primary Groq API key reached its rate limit during the full evaluation runs.
>
> **No API keys are included in this repository.** Set your own Groq API keys in `.env` before running the scripts.

## Problem statement

Twitter-based brand support accounts field a high volume of messages that mix trivial, repeatable questions with sensitive account/payment/safety issues. A system that can (a) understand *what* the customer needs, (b) correctly decide *who* should handle it — bot or human — and (c) draft a reply that doesn't invent capabilities or policies the brand doesn't have, is the core building block of a safe support-automation pipeline. This project builds and honestly evaluates that pipeline for one brand (AppleSupport), including where it currently falls short.

## Key capabilities

- **Intent classification** into 8 AppleSupport-specific classes.
- **Auto vs. human escalation** decision, driven by an explicit rules-based prompt (payment/account, order actions, safety risk, explicit human requests, failed troubleshooting).
- **Retrieval** of the 3 most similar historical AppleSupport customer↔reply pairs via local TF-IDF (no external embedding service).
- **Grounded reply generation** that is instructed to use retrieved historical replies as its evidentiary basis and not claim actions (refunds, forwarding, replacements) it can't actually perform.
- **Two baselines** (keyword classifier, LLM-only classifier without retrieval) to contextualize whether retrieval grounding actually helps.
- **LLM-as-a-judge** reply-quality scoring (relevance, grounding, helpfulness, appropriateness) plus a **human-vs-LLM agreement** check via Cohen's kappa.

## Brand selection: why AppleSupport

`scripts/analyzeBrands.js` and `scripts/compareBrands.js` exist specifically to rank support accounts in the raw TWCS dataset by reply volume and compare a shortlist (`AmazonHelp`, `AppleSupport`, `Uber_Support`, `SpotifyCares`, `Delta`). Running the extraction pipeline (`scripts/extractApple.js`) confirms **106,860 AppleSupport support replies** in the dataset — a large corpus for TF-IDF retrieval. AppleSupport was chosen over higher-volume alternatives like AmazonHelp because its problem space (device software, hardware, battery, app behavior, payments, orders) is naturally **bounded**, which made it realistic to design a small, defensible 8-class intent taxonomy within the assignment's scope, rather than trying to cover an open-ended product catalog.

*(Note: the raw `twcs.csv` file that `analyzeBrands.js`/`compareBrands.js` read is gitignored and not part of this repository, so the exact reply counts for the other brands in the shortlist can't be reproduced from what's committed here — only the AppleSupport-side numbers, which are derived from the committed `data/apple_support.csv`.)*

## System architecture

```
                    Customer message
                          │
                          ▼
        ┌─────────────────────────────────────┐
        │   retriever.js — TF-IDF retrieval    │
        │   over data/apple_conversations.csv  │
        │   (~106.6k historical pairs),         │
        │   excluding Golden Set tweet IDs      │
        │   during evaluation                   │
        └─────────────────────────────────────┘
                          │  top-3 similar
                          │  customer↔reply pairs
                          ▼
        ┌─────────────────────────────────────┐
        │   agent.js — Groq LLM call           │
        │   model: openai/gpt-oss-20b           │
        │   strict JSON-schema response         │
        └─────────────────────────────────────┘
                          │
                          ▼
        ┌───────────────────────────────────────────┐
        │  { intent, escalation, reply, evidence }   │
        └───────────────────────────────────────────┘
```

- **Retriever** (`scripts/retriever.js`): builds a `natural.TfIdf` index over every `customer_text` in `data/apple_conversations.csv` at process start, then returns the top-K (K=3) most similar historical conversations for a query, each with its real `support_text` reply. Exposes `setExcludedIds()` so callers can filter specific `customer_tweet_id`s out of results without rebuilding the index.
- **Agent** (`scripts/agent.js`): a single Groq chat-completions call constrained with `response_format: { type: "json_schema" }` to return exactly `{ intent, escalation, reply }`. The system prompt lists the 8 allowed intents, six explicit escalation triggers, and a set of "grounding rules" telling the model to base its reply on the retrieved examples and never claim it can refund, forward, replace, or investigate anything itself.

## Data pipeline

| Step | Script | Output | Notes |
|---|---|---|---|
| 1 | `analyzeBrands.js` | (console only) | Ranks brands in raw `twcs.csv` by support-reply count |
| 2 | `compareBrands.js` | (console only) | Deeper volume/related-tweet comparison across a brand shortlist |
| 3 | `extractApple.js` | `data/apple_support.csv` | AppleSupport's outbound replies only (106,860 rows), used for brand-level scoping — not read by any downstream script |
| 4 | `buildConversations.js` | `data/apple_conversations.csv` | Independently re-reads raw `twcs.csv` and pairs every AppleSupport reply with its parent customer tweet → 106,646 customer↔support pairs. This is the actual retrieval corpus. |
| 5 | `sampleConversations.js` | `data/apple_golden_set.csv` | Randomly samples 200 pairs (unseeded `Math.random()` shuffle) from the conversation corpus |
| 6 | `prepareGoldenSet.js` | `data/apple_golden_set_labeled.csv` | Scaffolds empty `intent`/`escalation` columns for manual labeling |
| 7 | `labelGoldenSet.js` | `data/apple_golden_set_final.csv` | Interactive CLI: single annotator labels each example's intent + escalation, with back/edit support |

`data/apple_support.csv` (step 3) and `data/apple_golden_set.csv` (step 5 output, distinct from the *final* labeled set) are intermediate/exploratory artifacts — the actual retrieval corpus is built independently in step 4 directly from `twcs.csv`, and the actual evaluation set is `data/apple_golden_set_final.csv`. The raw `twcs.csv` itself is not committed (see `.gitignore`) since it's a large, publicly available Kaggle file.

Two additional files in `data/` — `apple_sample_100.csv` and `gemini_baseline_results.csv` — are leftover artifacts from an earlier Gemini-based exploration (see Decision Log) and are not read by any current script.

## Golden Set methodology

- 200 examples, single annotator, sampled randomly from the AppleSupport conversation corpus.
- Every example is labeled with exactly one **primary intent** (not every issue mentioned, if a message raises more than one) and one **escalation** decision (`auto` / `human`).
- Class distribution is **uneven** by construction (random sampling from real traffic, not stratified): `general_support` 61, `device_performance` 42, `ios_update_issue` 41, `app_issue` 27, `hardware_issue` 11, `battery_issue` 10, `payment_account_issue` 7, `product_order_issue` 1. Escalation split: 138 `human` / 62 `auto`.
- All 200 examples are fully labeled (0 missing intent/escalation values in the final file).

## Intent taxonomy

| Intent | Definition (from the classification prompt) |
|---|---|
| `ios_update_issue` | Problems caused by or directly related to an iOS update |
| `device_performance` | Freezing, slow performance, restarting, overheating, connectivity/network behavior, calls failing, or general device behavior |
| `battery_issue` | Battery drain, battery dying, poor battery life |
| `app_issue` | Problems with apps or app functionality |
| `payment_account_issue` | Payments, charges, billing, account or subscription issues |
| `hardware_issue` | Physical hardware problems, damaged devices/accessories, screen/touch problems, electrical/safety issues |
| `product_order_issue` | Product orders, replacements, engraving, or order changes |
| `general_support` | Vague requests for help without a specific problem |

The most consistently ambiguous boundary is **`device_performance` vs. `ios_update_issue`**: an update is frequently the *context* for a complaint (e.g. "since the update my phone keeps restarting") rather than being the customer's actual root complaint, and both the annotator and the model have to make the same judgment call independently.

## Escalation policy

Defined directly in `agent.js`'s system prompt. Escalate to **human** when:

- The issue involves payment, refunds, unauthorized charges, or account problems.
- The customer needs an order change, replacement, or other manual action.
- There is physical damage, electrical/safety risk, or serious hardware failure.
- The customer explicitly asks for a human.
- The problem is unclear or requires specialist investigation.
- The customer has already tried troubleshooting and still needs further help.

Otherwise, `auto` is used for straightforward informational or basic-troubleshooting requests that don't require a manual account/order/action.

## Retrieval approach

`retriever.js` uses `natural.TfIdf` (a local, dependency-free TF-IDF implementation — no external embedding API) built once over all `customer_text` values in `data/apple_conversations.csv`. At query time it scores the query against every indexed document, sorts by score, and returns the top-3 as `{ customer_tweet_id, customer_text, support_text, score }`. The agent then quotes these three customer↔reply pairs to the LLM as grounding evidence.

## Retrieval leakage problem and the fix

The 200 Golden Set examples were sampled directly from `data/apple_conversations.csv` — the same file the TF-IDF retriever is built over. Left unaddressed, this means that during evaluation, a Golden Set query's *own* historical conversation (customer message **and its real support reply**) could be retrieved by the retriever as top evidence, letting the model effectively "see the answer" and inflating grounding/quality scores.

**Fix implemented:** `retriever.js` exposes `setExcludedIds(ids)`, which populates an in-memory `Set` of `customer_tweet_id`s to skip inside the scoring loop in `retrieve()`. `evaluateAgent.js` calls this once at the start of the run with every `customer_tweet_id` in the Golden Set, so **no Golden Set example can retrieve itself (or any other Golden Set example) as evidence** during the reported evaluation. The underlying corpus file (`apple_conversations.csv`) is left untouched — filtering happens at retrieval time, not by removing rows from the source data.

## Baselines

**Baseline 1 — Keyword/rule-based classifier** (`baselineClassifier.js`): a fixed sequence of `String.includes()` checks on lowercased text (e.g. `battery`/`drain`/`charging` → `battery_issue`; `screen`/`broken`/`damaged` → `hardware_issue`), falling through to `general_support` if nothing matches. Intent-only — it makes no escalation prediction.

**Baseline 2 — LLM-only classifier** (`groqBaseline.js.js`): the same Groq model (`openai/gpt-oss-20b`) as the main agent, given the same intent/escalation definitions, but with **no retrieval evidence** and `temperature: 0`. Predicts both intent and escalation from the customer message alone. It has no output-schema enforcement or retry logic, so 2 of 200 examples failed and were dropped rather than counted against it (198/200 completed) — a caveat worth keeping in mind when comparing it directly to the main agent's 200/200.

## Baseline comparison

| | Baseline 1: Keyword | Baseline 2: LLM-only (no retrieval) | Main: Retrieval-grounded agent |
|---|---|---|---|
| Examples completed | 200/200 | 198/200 | 200/200 |
| Intent accuracy | 25.50% | **61.62%** | 58.00% |
| Intent macro F1 | 32.15% | **59.60%** | 54.53% |
| Escalation accuracy | n/a (no escalation output) | 47.47% | 40.50% |
| Escalation AUTO F1 | n/a | **50.0%** | 48.5% |
| Escalation HUMAN F1 | n/a | **44.7%** | 29.6% |

**The retrieval-grounded main agent does not outperform the LLM-only baseline** on this Golden Set — it's ~3.6 points lower on intent accuracy, ~5 points lower on intent macro F1, and meaningfully worse on HUMAN-escalation F1 (29.6% vs. 44.7%). Retrieval evidence appears to add noise to this pipeline's decisions rather than helping, at least in its current form (see Known Limitations and Decision Log for discussion).

## Main agent results (200/200 Golden Set examples)

**Intent classification**

| Metric | Value |
|---|---|
| Accuracy | 58.00% |
| Macro Precision | 56.56% |
| Macro Recall | 63.15% |
| Macro F1 | 54.53% |

**Escalation decision**

| Metric | Value |
|---|---|
| Accuracy | 40.50% |
| Macro Precision | 56.89% |
| Macro Recall | 54.22% |
| Macro F1 | 39.04% |

| Class | Precision | Recall | F1 |
|---|---|---|---|
| AUTO | 33.1% | 90.3% | 48.5% |
| HUMAN | 80.6% | 18.1% | 29.6% |

## Per-intent metrics (main agent)

| Intent | Precision | Recall | F1 |
|---|---|---|---|
| `ios_update_issue` | 48.6% | 82.9% | 61.3% |
| `device_performance` | 80.0% | 28.6% | 42.1% |
| `battery_issue` | 70.0% | 70.0% | 70.0% |
| `app_issue` | 52.9% | 66.7% | 59.0% |
| `payment_account_issue` | 50.0% | 28.6% | 36.4% |
| `hardware_issue` | 42.1% | 72.7% | 53.3% |
| `product_order_issue` | 33.3% | 100.0% | 50.0% |
| `general_support` | 75.6% | 55.7% | 64.2% |

`product_order_issue` has only 1 true example in the Golden Set (its 100% recall / 33.3% precision come from 1 correct hit out of 3 predictions), and `payment_account_issue` has only 7 — both classes' metrics should be read as noisy point estimates, not stable rates. See Known Limitations.

## Why the headline escalation accuracy is misleading

40.50% overall escalation accuracy looks poor, but the error is strongly asymmetric rather than random: **AUTO recall is 90.3%**, meaning the agent almost always predicts `auto`, while **HUMAN recall is only 18.1%** — it correctly escalates fewer than 1 in 5 cases that actually need a human. A support system that's *too cautious* (over-escalating) is annoying but safe; a system that *under-escalates* payment, order, and safety-risk cases is the more dangerous failure mode, because it silently lets those cases get an automated response instead of a human one. **HUMAN recall (18.1%) is the single most important number in this evaluation**, and it's currently the system's clearest weakness — well below the LLM-only baseline's 44.7% HUMAN F1.

## Reply quality (LLM-as-judge, 1–5 scale, all 200 replies)

| Relevance | Grounding | Helpfulness | Appropriateness | Overall |
|---|---|---|---|---|
| 3.54 | 4.46 | 3.81 | 4.93 | 4.18 |

The judge model is the **same** Groq model (`openai/gpt-oss-20b`) used to generate the replies — there is no independent judge here, which is a real limitation (see below). Grounding (4.46) and Appropriateness (4.93) score highest, consistent with the agent's prompt explicitly discouraging invented policies/URLs and unsupported claims; Relevance (3.54) is the weakest dimension, consistent with the intent/escalation error patterns above.

## Human vs. LLM judge agreement

110 of the 200 judged replies were independently scored by a human on the same 1–5 overall scale. Both the human score and the LLM's overall score (originally an average of its 4 sub-scores) were rounded to the nearest integer before comparison.

| Metric | Value |
|---|---|
| Observed Agreement (Po) | 52.73% |
| Expected Agreement (Pe) | 40.50% |
| Cohen's Kappa | 0.2054 |
| Interpretation | Fair agreement |

The confusion matrix shows the LLM judge clusters heavily around scores 3–5 and rarely uses 1–2, and disagreements are concentrated in the 3-vs-4 and 4-vs-5 boundary rather than being spread randomly — consistent with "fair" rather than "poor" agreement. This uses **unweighted** kappa, which penalizes a near-miss (human=3, LLM=4) exactly as harshly as a large miss (human=1, LLM=5); a weighted kappa would likely read higher, but wasn't computed here.

## Top 5 failure modes

**1. `device_performance` vs. `ios_update_issue` confusion.** The update is often context, not the root cause, and the agent doesn't reliably separate them.
> *"Ffs constantly my iphone is spasming out or just freezes ...doing my head in @AppleSupport any chance you sort the bugs out and do an update"* — true: `device_performance`, predicted: `ios_update_issue`
> *"@115858 ios 11 made my phone bug and now its hella slow!! Sos"* — true: `device_performance`, predicted: `ios_update_issue`

**2. Missed human escalation — the highest-impact failure mode.** Cases that clearly need a human (repeated restarts, unresolved troubleshooting, account issues) get routed to `auto`.
> *"@AppleSupport my iPhone 7 Plus keeps restarting. What should I do? It's up to date completely?"* — intent correctly predicted (`device_performance`), but true escalation: `human`, predicted: `auto`
> *"@AppleSupport iPhone 7 across all email accounts on the mail app. And the device has been restarted"* — intent correctly predicted (`app_issue`), but true escalation: `human`, predicted: `auto`

**3. Unnecessary human escalation on routine, answerable issues.** The inverse error — over-cautious escalation of things `auto` could have handled.
> *"@115858 @AppleSupport Your OEM Lightning cable, needs to be built better. Its good quality, but it breaks off way to easy at the tip inside the charge port for iOS devices."* — intent correctly predicted (`hardware_issue`), true escalation: `auto`, predicted: `human`
> *".@AppleSupport why's my keyboard messed up yo"* — true intent: `device_performance` (predicted `app_issue`), true escalation: `auto`, predicted: `human`

**4. Payment/account vs. app confusion.** Account-lock and payment-adjacent issues get misrouted between `payment_account_issue` and `app_issue`.
> *"@115858 please help my phone is icloud locked help help please"* — true: `app_issue`, predicted: `payment_account_issue` (escalation also flipped: true `auto`, predicted `human`)

**5. `general_support` boundary confusion.** Short, low-signal messages get inconsistently routed against `device_performance`/`hardware_issue`, in both directions.
> *"Why won't my phone auto lock?!! @AppleSupport and yes auto lock is turned on for 30seconds"* — true: `device_performance`, predicted: `general_support` (also a missed human escalation)
> *"@applesupport so y'all just not gon fix these boxes?"* — true: `general_support`, predicted: `hardware_issue`

These were selected via `scripts/failureAnalysis.js`, which prints curated buckets (misclassifications, missed/unnecessary escalations, class-specific confusions) rather than doing frequency-ranked discovery — they illustrate recurring patterns, not a statistically ranked top 5.

## Known limitations

- **HUMAN-escalation recall is only 18.1%** — the system's most safety-relevant gap. The escalation prompt lists specific triggers but has no explicit "escalate when uncertain" default, so ambiguous cases tend to fall through to `auto`.
- **The retrieval-grounded agent underperforms the LLM-only baseline** on intent accuracy (58.00% vs. 61.62%), intent macro F1 (54.53% vs. 59.60%), and HUMAN-escalation F1 (29.6% vs. 44.7%). Retrieval evidence is not currently improving this pipeline's decisions.
- **Severe class imbalance in a few intents.** `product_order_issue` has exactly 1 true example and `payment_account_issue` has 7 in the 200-example Golden Set; their precision/recall/F1 figures are noisy point estimates, not stable rates, and a single misclassification swings them by tens of percentage points.
- **Single annotator, no inter-annotator agreement** on the Golden Set's own intent/escalation labels — there's no measure of how consistent a second labeler would be.
- **Judge model = generation model.** Reply-quality scoring uses the same Groq model family as the agent itself, not an independent judge, which is a conflict of interest even though it's disclosed and cross-checked against 110 human scores.
- **Unweighted kappa on rounded scores** treats a 1-point near-miss the same as a 4-point miss on an inherently ordinal 1–5 scale.
- **Non-deterministic sampling.** `sampleConversations.js` (Golden Set selection) and `prepareHumanJudge.js` (human-judge sample) both use an unseeded `Math.random()` shuffle, so re-running the pipeline from scratch would not reproduce the exact same 200 Golden Set examples or the same 110 human-judge sample committed in `data/`.
- **Baseline 2 (LLM-only) has no output-schema enforcement or retry logic**, so 2/200 examples silently failed and were excluded rather than counted as errors — not a perfectly matched comparison against the main agent's 200/200.
- **`evaluateAgent.js` has no resume support** (unlike `evaluateReplies.js`, which explicitly skips already-completed `customer_tweet_id`s) — an interrupted run of the main evaluation has to restart from the beginning.
- Two files in `data/` (`apple_sample_100.csv`, `gemini_baseline_results.csv`) are leftover artifacts from earlier exploration and aren't part of the documented, reproducible pipeline described in this README.

## Decision log

1. Selected AppleSupport as the target brand for its combination of high reply volume (106,860 extracted replies) and a bounded, device/software-centric problem space suited to a small intent taxonomy.
2. Built customer↔support pairs (buildConversations.js), not isolated tweets, so retrieval evidence contains both the historical customer problem and the corresponding AppleSupport response.
3. Sampled 200 pairs at random for the Golden Set to keep manual labeling tractable within the assignment's scope, accepting the resulting class imbalance as a tradeoff.
4. Labeled each example by a single **primary** intent rather than multi-label, via a custom interactive CLI tool (`labelGoldenSet.js`) with back/edit support.
5. Defined 8 intent classes with explicit written definitions embedded directly in the classification prompts, rather than leaving categories to model judgment alone.
6. Kept `device_performance` and `ios_update_issue` as separate classes despite their overlap, since an update is often context rather than the actual root complaint.
7. Chose local TF-IDF (`natural`) over an embedding-based retriever — no external embedding API, fully reproducible without extra infrastructure, fast to build over ~106k documents.
8. Retrieved the top-3 evidence examples per query as a tradeoff between useful context and prompt size.
9. Constrained the agent's LLM output with a strict JSON schema (`response_format: json_schema`) instead of free-text parsing, to make automated intent/escalation scoring reliable.
10. Wrote explicit "grounding rules" into the agent's system prompt instructing it not to claim it can refund, forward, replace, or investigate anything, and not to invent policies or URLs.
11. Implemented two baselines — a rule-based keyword classifier and a no-retrieval LLM classifier — specifically to test whether retrieval grounding helps, rather than assuming it would.
12. Used Groq with openai/gpt-oss-20b after Gemini quota limits made repeated evaluation impractical, prioritizing a reproducible provider/model setup for the remaining experiments.
13. Fixed Golden Set retrieval leakage by excluding Golden Set `customer_tweet_id`s from TF-IDF results at evaluation time (`retriever.js`'s `setExcludedIds`), rather than physically removing them from the corpus file, so the corpus itself stays reusable outside evaluation.
14. Used the same LLM as an automated reply-quality judge across 4 rubric dimensions (relevance, grounding, helpfulness, appropriateness), then deliberately cross-checked it against 110 independently human-scored replies rather than trusting the LLM judge alone.
15. Used unweighted Cohen's kappa on rounded 1–5 overall scores for human-vs-LLM agreement, accepting that it treats near-misses and large misses equally rather than implementing a weighted variant.

## Repository structure

```
scripts/
  analyzeBrands.js         # rank brands in raw twcs.csv by support-reply volume
  compareBrands.js         # deeper volume/related-tweet comparison across a brand shortlist
  extractApple.js          # extract AppleSupport's outbound replies -> apple_support.csv
  buildConversations.js    # pair AppleSupport replies with parent customer tweets -> apple_conversations.csv
  sampleConversations.js   # randomly sample 200 pairs -> apple_golden_set.csv
  prepareGoldenSet.js      # scaffold empty intent/escalation columns for labeling
  labelGoldenSet.js        # interactive CLI labeler -> apple_golden_set_final.csv
  baselineClassifier.js    # Baseline 1: keyword/rule-based intent classifier
  groqBaseline.js.js       # Baseline 2: LLM-only classifier (no retrieval)
  retriever.js             # TF-IDF retrieval over apple_conversations.csv
  agent.js                 # main retrieval-grounded agent (intent + escalation + reply)
  evaluateAgent.js         # runs the main agent over the Golden Set, computes metrics
  evaluateReplies.js       # LLM-as-judge reply-quality scoring (resumable)
  prepareHumanJudge.js     # samples 110 replies for independent human scoring
  calculateAgreement.js    # Cohen's kappa, human vs. LLM judge
  failureAnalysis.js       # prints curated failure-mode examples
data/
  apple_conversations.csv         # ~106.6k historical customer/support pairs (retrieval corpus)
  apple_golden_set.csv            # 200 sampled pairs, pre-labeling
  apple_golden_set_labeled.csv    # 200 pairs with empty label scaffold
  apple_golden_set_final.csv      # 200 fully labeled Golden Set examples
  apple_support.csv               # 106,860 raw AppleSupport replies (extraction/scoping only)
  apple_sample_100.csv            # leftover exploratory artifact, not used by any script
  groq_baseline_results.csv       # Baseline 2 predictions (198/200)
  gemini_baseline_results.csv     # leftover artifact from earlier Gemini exploration
  main_agent_results.csv          # main agent predictions + evidence (200/200)
  reply_quality_results.csv       # LLM judge scores (200/200)
  human_judge_sample.csv          # 110-example human-vs-LLM scoring sheet
package.json / package-lock.json
.gitignore                        # excludes node_modules, .env, twcs.csv
```

## Installation / setup

Requires Node.js and a Groq API key.

```bash
npm install
```

## Environment variables

Create a `.env` file in the project root:

```
GROQ_API_KEY=your_key_here
```

This is read by `agent.js` and `groqBaseline.js.js`. `evaluateReplies.js` reads `process.env.GRO_API_KEY` (a typo) instead — this is harmless in practice because the Groq SDK falls back to reading `GROQ_API_KEY` from the environment itself whenever the `apiKey` option it's given is `undefined`, but it's worth fixing for clarity.

## Running it

To regenerate everything from scratch you also need the raw TWCS `twcs.csv` in the project root (not committed — see `.gitignore`; publicly available on Kaggle). All commands are run from the project root.

```bash
# Optional: brand scoping / selection
node scripts/analyzeBrands.js
node scripts/compareBrands.js

# Data pipeline (requires twcs.csv)
node scripts/extractApple.js
node scripts/buildConversations.js
node scripts/sampleConversations.js
node scripts/prepareGoldenSet.js
node scripts/labelGoldenSet.js          # interactive — manual labeling

# Baselines
node scripts/baselineClassifier.js      # Baseline 1: keyword classifier
node scripts/groqBaseline.js.js         # Baseline 2: LLM-only (~200 Groq calls)

# Main agent evaluation
node scripts/evaluateAgent.js           # ~200 Groq calls, ~2.2s spacing between calls

# Reply quality + human agreement
node scripts/evaluateReplies.js         # LLM-as-judge, resumable, ~4s spacing
node scripts/prepareHumanJudge.js       # samples 110 replies into human_judge_sample.csv
#  -> manually fill the human_overall_score column (1-5) in data/human_judge_sample.csv
node scripts/calculateAgreement.js      # Cohen's kappa

# Failure analysis
node scripts/failureAnalysis.js
```

## Reproducibility notes

- `sampleConversations.js` (Golden Set selection) and `prepareHumanJudge.js` (human-judge sample) both shuffle with an unseeded `Math.random()`. Re-running the pipeline from scratch will select a *different* 200-example Golden Set and a different 110-example human sample than the ones already committed in `data/` — the numbers in this README are computed from those exact committed files, not from a fresh run.
- The main agent (`agent.js`) uses `temperature: 0.2`; Baseline 2 uses `temperature: 0`; the reply-quality judge uses `temperature: 0.1`. Low but nonzero temperatures mean individual reruns of `evaluateAgent.js` or `evaluateReplies.js` are not guaranteed to reproduce identical per-example predictions, even against the same Golden Set.
- `evaluateReplies.js` is resumable (it skips `customer_tweet_id`s already present in `reply_quality_results.csv`); `evaluateAgent.js` is not, and always restarts from an empty results array.
- All reported metrics were independently recomputed directly from the committed CSVs (`data/main_agent_results.csv`, `data/groq_baseline_results.csv`, `data/reply_quality_results.csv`, `data/human_judge_sample.csv`) to confirm they match this README exactly.

## Conclusion

The main retrieval-grounded agent classifies intent correctly 58% of the time (54.53% macro F1) and generates replies that score well on grounding (4.46/5) and appropriateness (4.93/5) — it mostly doesn't invent policies or claim capabilities it doesn't have. But on this Golden Set, it is **outperformed by the simpler LLM-only baseline** on both intent classification and, more importantly, on HUMAN-escalation F1, and its **HUMAN recall is only 18.1%** — it fails to escalate roughly 4 out of every 5 cases that genuinely need a person. That gap, not the headline 40.50% escalation accuracy, is the number that matters most for a system meant to sit in front of real customer support traffic, and it's the clearest next thing to fix, ahead of any further gains from retrieval or reply-quality tuning.
