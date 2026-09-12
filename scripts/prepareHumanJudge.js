const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const inputFile = path.join(
    __dirname,
    "../data/reply_quality_results.csv"
);

const outputFile = path.join(
    __dirname,
    "../data/human_judge_sample.csv"
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

function shuffle(array) {
    return array.sort(() => Math.random() - 0.5);
}

async function main() {
    const rows = await loadCSV(inputFile);

    console.log(`Loaded ${rows.length} evaluated replies.`);

    if (rows.length < 110) {
        throw new Error("Need at least 110 evaluated replies.");
    }

    const sample = shuffle([...rows]).slice(0, 110);

    const headers = [
        "customer_tweet_id",
        "customer_text",
        "reply",
        "llm_overall_score",
        "human_overall_score"
    ];

    const lines = [headers.join(",")];

    for (const row of sample) {
        lines.push(
            [
                row.customer_tweet_id,
                row.customer_text,
                row.reply,
                row.overall_score,
                ""
            ]
                .map(csvEscape)
                .join(",")
        );
    }

    fs.writeFileSync(
        outputFile,
        lines.join("\n"),
        "utf8"
    );

    console.log("\n================================");
    console.log("HUMAN JUDGE SAMPLE");
    console.log("================================");

    console.log(`Selected: ${sample.length} replies`);
    console.log(`Saved to: ${outputFile}`);

    console.log(
        "\nFill the 'human_overall_score' column with 1-5."
    );

    console.log("1 = very poor");
    console.log("2 = poor");
    console.log("3 = acceptable");
    console.log("4 = good");
    console.log("5 = excellent");
}

main();