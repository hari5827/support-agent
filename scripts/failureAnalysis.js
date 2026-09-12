const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const inputFile = path.join(
    __dirname,
    "../data/main_agent_results.csv"
);

function loadCSV(file) {
    return new Promise((resolve, reject) => {
        const rows = [];

        fs.createReadStream(file)
            .pipe(csv())
            .on("data", row => rows.push(row))
            .on("end", () => resolve(rows))
            .on("error", reject);
    });
}

function printExamples(title, rows, limit = 5) {
    console.log(`\n================================`);
    console.log(title);
    console.log(`================================`);

    if (rows.length === 0) {
        console.log("No examples found.");
        return;
    }

    rows.slice(0, limit).forEach((row, i) => {
        console.log(`\nExample ${i + 1}`);
        console.log(`Customer: ${row.customer_text}`);
        console.log(`True intent: ${row.true_intent}`);
        console.log(`Predicted intent: ${row.predicted_intent}`);
        console.log(`True escalation: ${row.true_escalation}`);
        console.log(`Predicted escalation: ${row.predicted_escalation}`);
        console.log(`Reply: ${row.reply}`);
    });
}

async function main() {
    const rows = await loadCSV(inputFile);

    console.log(`Loaded ${rows.length} evaluation results.`);

    // 1. All intent classification errors
    const intentFailures = rows.filter(
        row =>
            row.true_intent !== row.predicted_intent
    );

    printExamples(
        "FAILURE MODE 1: INTENT MISCLASSIFICATION",
        intentFailures
    );

    // 2. Human cases incorrectly auto-handled
    const missedEscalations = rows.filter(
        row =>
            row.true_escalation === "human" &&
            row.predicted_escalation === "auto"
    );

    printExamples(
        "FAILURE MODE 2: MISSED HUMAN ESCALATION",
        missedEscalations
    );

    // 3. Auto cases incorrectly escalated
    const unnecessaryEscalations = rows.filter(
        row =>
            row.true_escalation === "auto" &&
            row.predicted_escalation === "human"
    );

    printExamples(
        "FAILURE MODE 3: UNNECESSARY HUMAN ESCALATION",
        unnecessaryEscalations
    );

    // 4. Device-performance classification errors
    const deviceErrors = rows.filter(
        row =>
            row.true_intent === "device_performance" &&
            row.predicted_intent !== "device_performance"
    );

    printExamples(
        "FAILURE MODE 4: DEVICE-PERFORMANCE CONFUSION",
        deviceErrors
    );

    // 5. Payment/account classification errors
    const paymentErrors = rows.filter(
        row =>
            row.true_intent === "payment_account_issue" &&
            row.predicted_intent !== "payment_account_issue"
    );

    printExamples(
        "FAILURE MODE 5: PAYMENT/ACCOUNT CONFUSION",
        paymentErrors
    );
}

main();