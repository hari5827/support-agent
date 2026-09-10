require("dotenv").config();
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const Groq = require("groq-sdk");

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const inputFile = path.join(
    __dirname,
    "../data/apple_golden_set_final.csv"
);

const outputFile = path.join(
    __dirname,
    "../data/groq_baseline_results.csv"
);

const intents = [
    "ios_update_issue",
    "device_performance",
    "battery_issue",
    "app_issue",
    "payment_account_issue",
    "hardware_issue",
    "product_order_issue",
    "general_support"
];

const rows = [];

fs.createReadStream(inputFile)
    .pipe(csv())
    .on("data", row => rows.push(row))
    .on("end", async () => {
        console.log(`Loaded ${rows.length} examples\n`);

        const results = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];

            try {
                const prediction = await classify(row.customer_text);

                results.push({
                    customer_tweet_id: row.customer_tweet_id,
                    customer_text: row.customer_text,
                    actual_intent: row.intent,
                    predicted_intent: prediction.intent,
                    actual_escalation: row.escalation,
                    predicted_escalation: prediction.escalation
                });

                console.log(
                    `${i + 1}/${rows.length} | ` +
                    `${prediction.intent} | ` +
                    `${prediction.escalation}`
                );

                await sleep(300);

            } catch (error) {
                console.error(
                    `Failed example ${i + 1}: ${error.message}`
                );
            }
        }

        saveResults(results);
        calculateMetrics(results);
    });

async function classify(customerMessage) {

    const response = await groq.chat.completions.create({
        model: "openai/gpt-oss-20b",

        messages: [
            {
                role: "system",
                content: `
You are a customer support intent classifier.

Classify the customer's PRIMARY problem into exactly one intent:

- ios_update_issue
- device_performance
- battery_issue
- app_issue
- payment_account_issue
- hardware_issue
- product_order_issue
- general_support

Intent rules:

- ios_update_issue = problems caused by or directly related to an iOS update
- device_performance = freezing, slow performance, restarting, overheating,
  connectivity/network behavior, calls failing, or general device behavior
- battery_issue = battery drain, battery dying, poor battery life
- app_issue = problems with apps or app functionality
- payment_account_issue = payments, charges, billing, account or subscription issues
- hardware_issue = physical hardware problems, damaged devices/accessories,
  screen/touch problems, electrical/safety issues
- product_order_issue = product orders, replacements, engraving, or order changes
- general_support = vague requests for help without a specific problem

Escalation rules:

- auto = safe/common issue that can reasonably be handled automatically
- human = requires human support, specialist help, sensitive account/payment/order action,
  safety concern, severe issue, repeated failure, or explicit human request.

Return ONLY valid JSON in exactly this format:

{
  "intent": "one allowed intent",
  "escalation": "auto or human"
}
`
            },
            {
                role: "user",
                content: customerMessage
            }
        ],

        temperature: 0
    });

    const text = response.choices[0].message.content;

    return JSON.parse(text);
}

function saveResults(results) {

    const header =
        "customer_tweet_id,customer_text,actual_intent,predicted_intent,actual_escalation,predicted_escalation\n";

    const csvData = results.map(r =>
        [
            r.customer_tweet_id,
            escapeCSV(r.customer_text),
            r.actual_intent,
            r.predicted_intent,
            r.actual_escalation,
            r.predicted_escalation
        ].join(",")
    ).join("\n");

    fs.writeFileSync(
        outputFile,
        header + csvData
    );

    console.log(`\nSaved results to: ${outputFile}`);
}

function calculateMetrics(results) {

    console.log("\n===== GROQ LLM BASELINE #2 =====\n");

    if (results.length === 0) {
        console.log("No successful results.");
        return;
    }

    const intentCorrect = results.filter(
        r => r.actual_intent === r.predicted_intent
    ).length;

    const escalationCorrect = results.filter(
        r => r.actual_escalation === r.predicted_escalation
    ).length;

    console.log(
        `Intent Accuracy: ${(
            intentCorrect / results.length * 100
        ).toFixed(2)}%`
    );

    console.log(
        `Escalation Accuracy: ${(
            escalationCorrect / results.length * 100
        ).toFixed(2)}%`
    );

    // Intent metrics

    const intentMetrics = {};

    intents.forEach(intent => {

        const tp = results.filter(
            r =>
                r.actual_intent === intent &&
                r.predicted_intent === intent
        ).length;

        const fp = results.filter(
            r =>
                r.actual_intent !== intent &&
                r.predicted_intent === intent
        ).length;

        const fn = results.filter(
            r =>
                r.actual_intent === intent &&
                r.predicted_intent !== intent
        ).length;

        const precision =
            tp + fp === 0
                ? 0
                : tp / (tp + fp);

        const recall =
            tp + fn === 0
                ? 0
                : tp / (tp + fn);

        const f1 =
            precision + recall === 0
                ? 0
                : 2 * precision * recall /
                  (precision + recall);

        intentMetrics[intent] = {
            precision,
            recall,
            f1
        };
    });

    const macroPrecision = average(
        intents.map(i => intentMetrics[i].precision)
    );

    const macroRecall = average(
        intents.map(i => intentMetrics[i].recall)
    );

    const macroF1 = average(
        intents.map(i => intentMetrics[i].f1)
    );

    console.log(
        `Macro Precision: ${(macroPrecision * 100).toFixed(2)}%`
    );

    console.log(
        `Macro Recall: ${(macroRecall * 100).toFixed(2)}%`
    );

    console.log(
        `Macro F1: ${(macroF1 * 100).toFixed(2)}%`
    );

    console.log("\n===== PER INTENT =====\n");

    intents.forEach(intent => {

        const m = intentMetrics[intent];

        console.log(
            `${intent}: ` +
            `Precision ${(m.precision * 100).toFixed(1)}% | ` +
            `Recall ${(m.recall * 100).toFixed(1)}% | ` +
            `F1 ${(m.f1 * 100).toFixed(1)}%`
        );
    });

    // Escalation metrics

    const escalationClasses = ["auto", "human"];

    console.log("\n===== ESCALATION METRICS =====\n");

    escalationClasses.forEach(type => {

        const tp = results.filter(
            r =>
                r.actual_escalation === type &&
                r.predicted_escalation === type
        ).length;

        const fp = results.filter(
            r =>
                r.actual_escalation !== type &&
                r.predicted_escalation === type
        ).length;

        const fn = results.filter(
            r =>
                r.actual_escalation === type &&
                r.predicted_escalation !== type
        ).length;

        const precision =
            tp + fp === 0
                ? 0
                : tp / (tp + fp);

        const recall =
            tp + fn === 0
                ? 0
                : tp / (tp + fn);

        const f1 =
            precision + recall === 0
                ? 0
                : 2 * precision * recall /
                  (precision + recall);

        console.log(
            `${type}: ` +
            `Precision ${(precision * 100).toFixed(1)}% | ` +
            `Recall ${(recall * 100).toFixed(1)}% | ` +
            `F1 ${(f1 * 100).toFixed(1)}%`
        );
    });
}

function average(values) {

    return values.reduce(
        (sum, value) => sum + value,
        0
    ) / values.length;
}

function escapeCSV(value) {

    return `"${String(value || "")
        .replace(/"/g, '""')
        .replace(/\r?\n/g, " ")}"`;
}

function sleep(ms) {

    return new Promise(resolve => setTimeout(resolve, ms));
}