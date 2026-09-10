const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const inputFile = path.join(
    __dirname,
    "../data/apple_golden_set_final.csv"
);

const rows = [];

fs.createReadStream(inputFile)
    .pipe(csv())
    .on("data", row => rows.push(row))
    .on("end", () => {
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

        const results = [];

        rows.forEach(row => {
            const predicted = classifyIntent(row.customer_text);

            results.push({
                actual: row.intent,
                predicted
            });
        });

        // Accuracy
        const correct = results.filter(
            r => r.actual === r.predicted
        ).length;

        const accuracy = correct / results.length;

        // Metrics for each intent
        const metrics = {};

        intents.forEach(intent => {
            const tp = results.filter(
                r => r.actual === intent && r.predicted === intent
            ).length;

            const fp = results.filter(
                r => r.actual !== intent && r.predicted === intent
            ).length;

            const fn = results.filter(
                r => r.actual === intent && r.predicted !== intent
            ).length;

            const precision =
                tp + fp === 0 ? 0 : tp / (tp + fp);

            const recall =
                tp + fn === 0 ? 0 : tp / (tp + fn);

            const f1 =
                precision + recall === 0
                    ? 0
                    : 2 * precision * recall /
                      (precision + recall);

            metrics[intent] = {
                precision,
                recall,
                f1
            };
        });

        // Macro averages
        const macroPrecision =
            average(intents.map(i => metrics[i].precision));

        const macroRecall =
            average(intents.map(i => metrics[i].recall));

        const macroF1 =
            average(intents.map(i => metrics[i].f1));

        console.log("\n===== BASELINE #1 RESULTS =====\n");

        console.log(`Total examples: ${results.length}`);
        console.log(`Correct: ${correct}`);
        console.log(`Accuracy: ${(accuracy * 100).toFixed(2)}%`);

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
            console.log(
                `${intent}: ` +
                `Precision ${(metrics[intent].precision * 100).toFixed(1)}% | ` +
                `Recall ${(metrics[intent].recall * 100).toFixed(1)}% | ` +
                `F1 ${(metrics[intent].f1 * 100).toFixed(1)}%`
            );
        });
    });

function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function classifyIntent(text) {
    const t = text.toLowerCase();

    if (
        t.includes("battery") ||
        t.includes("drain") ||
        t.includes("dies") ||
        t.includes("charging")
    ) {
        return "battery_issue";
    }

    if (
        t.includes("screen") ||
        t.includes("keyboard") ||
        t.includes("broken") ||
        t.includes("damaged") ||
        t.includes("headphone mode")
    ) {
        return "hardware_issue";
    }

    if (
        t.includes("order") ||
        t.includes("print") ||
        t.includes("engraving") ||
        t.includes("replacement")
    ) {
        return "product_order_issue";
    }

    if (
        t.includes("credit card") ||
        t.includes("paypal") ||
        t.includes("payment") ||
        t.includes("charge")
    ) {
        return "payment_account_issue";
    }

    if (
        t.includes("app") ||
        t.includes("spotify") ||
        t.includes("music") ||
        t.includes("notification") ||
        t.includes("text")
    ) {
        return "app_issue";
    }

    if (
        t.includes("ios") ||
        t.includes("update") ||
        t.includes("software")
    ) {
        return "ios_update_issue";
    }

    if (
        t.includes("slow") ||
        t.includes("freeze") ||
        t.includes("crash") ||
        t.includes("restart") ||
        t.includes("wifi") ||
        t.includes("call")
    ) {
        return "device_performance";
    }

    return "general_support";
}