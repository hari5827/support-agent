const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { runAgent } = require("./agent");
const { setExcludedIds } = require("./retriever");

const inputFile = path.join(
    __dirname,
    "../data/apple_golden_set_final.csv"
);

const outputFile = path.join(
    __dirname,
    "../data/main_agent_results.csv"
);

const results = [];

function loadGoldenSet() {
    return new Promise((resolve, reject) => {
        const rows = [];

        fs.createReadStream(inputFile)
            .pipe(csv())
            .on("data", (row) => rows.push(row))
            .on("end", () => resolve(rows))
            .on("error", reject);
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvEscape(value) {
    if (value === undefined || value === null) {
        return "";
    }

    const text = String(value);

    if (
        text.includes(",") ||
        text.includes('"') ||
        text.includes("\n")
    ) {
        return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
}

function saveResults() {
    const headers = [
        "customer_tweet_id",
        "customer_text",
        "true_intent",
        "predicted_intent",
        "true_escalation",
        "predicted_escalation",
        "reply",
        "evidence"
    ];

    const lines = [headers.join(",")];

    for (const row of results) {
        lines.push(
            [
                row.customer_tweet_id,
                row.customer_text,
                row.true_intent,
                row.predicted_intent,
                row.true_escalation,
                row.predicted_escalation,
                row.reply,
                row.evidence
            ]
                .map(csvEscape)
                .join(",")
        );
    }

    fs.writeFileSync(outputFile, lines.join("\n"), "utf8");
}

function calculateMetrics(rows, trueField, predictedField, labels) {
    let correct = 0;

    const metrics = {};

    for (const label of labels) {
        metrics[label] = {
            tp: 0,
            fp: 0,
            fn: 0
        };
    }

    for (const row of rows) {
        const actual = row[trueField];
        const predicted = row[predictedField];

        if (actual === predicted) {
            correct++;
        }

        if (metrics[predicted]) {
            if (predicted === actual) {
                metrics[predicted].tp++;
            } else {
                metrics[predicted].fp++;
            }
        }

        if (metrics[actual] && predicted !== actual) {
            metrics[actual].fn++;
        }
    }

    const accuracy = correct / rows.length;

    let macroPrecision = 0;
    let macroRecall = 0;
    let macroF1 = 0;

    console.log("\nPer-class metrics:");

    for (const label of labels) {
        const { tp, fp, fn } = metrics[label];

        const precision =
            tp + fp === 0 ? 0 : tp / (tp + fp);

        const recall =
            tp + fn === 0 ? 0 : tp / (tp + fn);

        const f1 =
            precision + recall === 0
                ? 0
                : (2 * precision * recall) /
                  (precision + recall);

        macroPrecision += precision;
        macroRecall += recall;
        macroF1 += f1;

        console.log(
            `${label}: ` +
            `Precision ${(precision * 100).toFixed(1)}%, ` +
            `Recall ${(recall * 100).toFixed(1)}%, ` +
            `F1 ${(f1 * 100).toFixed(1)}%`
        );
    }

    macroPrecision /= labels.length;
    macroRecall /= labels.length;
    macroF1 /= labels.length;

    return {
        accuracy,
        macroPrecision,
        macroRecall,
        macroF1
    };
}

async function main() {
    console.log("Loading Golden Set...");

    const goldenSet = await loadGoldenSet();

    console.log(`Loaded ${goldenSet.length} examples.`);
    const goldenSetIds = goldenSet
        .map((row) => row.customer_tweet_id || row.tweet_id || "")
        .filter(Boolean);

    setExcludedIds(goldenSetIds);

    for (let i = 0; i < goldenSet.length; i++) {
        const row = goldenSet[i];

        console.log(
            `\n[${i + 1}/${goldenSet.length}] ${row.customer_text}`
        );

        try {
            const result = await runAgent(row.customer_text);

            const output = {
                customer_tweet_id:
                    row.customer_tweet_id || row.tweet_id || "",
                customer_text: row.customer_text,

                true_intent:
                    row.intent || row.label || "",

                predicted_intent:
                    result.intent,

                true_escalation:
                    row.escalation || "",

                predicted_escalation:
                    result.escalation,

                reply:
                    result.reply,

                evidence:
                    JSON.stringify(
                        result.evidence.map((item) => ({
                            customer_text: item.customer_text,
                            support_text: item.support_text,
                            score: item.score
                        }))
                    )
            };

            results.push(output);

            saveResults();

            console.log(
                `Intent: ${output.true_intent} -> ${output.predicted_intent}`
            );

            console.log(
                `Escalation: ${output.true_escalation} -> ${output.predicted_escalation}`
            );

            // Keep requests safely spaced out.
            if (i < goldenSet.length - 1) {
                await sleep(2200);
            }

        } catch (error) {
            console.error(
                `FAILED example ${i + 1}:`,
                error.message
            );
        }
    }

    console.log("\n================================");
    console.log("EVALUATION COMPLETE");
    console.log("================================");

    console.log(`Successful examples: ${results.length}`);
    console.log(`Failed examples: ${goldenSet.length - results.length}`);

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

    console.log("\n========== INTENT METRICS ==========");

    const intentMetrics = calculateMetrics(
        results,
        "true_intent",
        "predicted_intent",
        intents
    );

    console.log(
        `\nAccuracy: ${(intentMetrics.accuracy * 100).toFixed(2)}%`
    );

    console.log(
        `Macro Precision: ${(intentMetrics.macroPrecision * 100).toFixed(2)}%`
    );

    console.log(
        `Macro Recall: ${(intentMetrics.macroRecall * 100).toFixed(2)}%`
    );

    console.log(
        `Macro F1: ${(intentMetrics.macroF1 * 100).toFixed(2)}%`
    );

    console.log("\n========== ESCALATION METRICS ==========");

    const escalationMetrics = calculateMetrics(
        results,
        "true_escalation",
        "predicted_escalation",
        ["auto", "human"]
    );

    console.log(
        `\nAccuracy: ${(escalationMetrics.accuracy * 100).toFixed(2)}%`
    );

    console.log(
        `Macro Precision: ${(escalationMetrics.macroPrecision * 100).toFixed(2)}%`
    );

    console.log(
        `Macro Recall: ${(escalationMetrics.macroRecall * 100).toFixed(2)}%`
    );

    console.log(
        `Macro F1: ${(escalationMetrics.macroF1 * 100).toFixed(2)}%`
    );

    console.log(`\nResults saved to: ${outputFile}`);
}

main();