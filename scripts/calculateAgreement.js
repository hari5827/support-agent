const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const inputFile = path.join(
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

async function main() {
    const rows = await loadCSV(inputFile);

    console.log(`Loaded ${rows.length} judgments.`);

    const matrix = Array.from(
        { length: 5 },
        () => Array(5).fill(0)
    );

    let valid = 0;

    for (const row of rows) {
       const llm = Math.round(Number(row.llm_overall_score));
       const human = Math.round(Number(row.human_overall_score));

        if (
            llm >= 1 && llm <= 5 &&
            human >= 1 && human <= 5
        ) {
            matrix[human - 1][llm - 1]++;
            valid++;
        }
    }

    console.log(`Valid judgments: ${valid}`);

    if (valid === 0) {
        throw new Error("No valid human scores found.");
    }

    // Observed agreement
    let diagonal = 0;

    for (let i = 0; i < 5; i++) {
        diagonal += matrix[i][i];
    }

    const Po = diagonal / valid;

    // Expected agreement
    let Pe = 0;

    for (let i = 0; i < 5; i++) {
        let humanTotal = 0;
        let llmTotal = 0;

        for (let j = 0; j < 5; j++) {
            humanTotal += matrix[i][j];
            llmTotal += matrix[j][i];
        }

        Pe +=
            (humanTotal / valid) *
            (llmTotal / valid);
    }

    // Cohen's Kappa
    const kappa = (Po - Pe) / (1 - Pe);

    console.log("\n================================");
    console.log("HUMAN vs LLM AGREEMENT");
    console.log("================================");

    console.log("\nConfusion Matrix");
    console.log("Rows = Human | Columns = LLM\n");

    console.log("       LLM");
    console.log("      1  2  3  4  5");

    for (let i = 0; i < 5; i++) {
        console.log(
            `${i + 1}   ${matrix[i]
                .map(x => String(x).padStart(2, " "))
                .join(" ")}`
        );
    }

    console.log(
        `\nObserved Agreement (Po): ${(Po * 100).toFixed(2)}%`
    );

    console.log(
        `Expected Agreement (Pe): ${(Pe * 100).toFixed(2)}%`
    );

    console.log(
        `Cohen's Kappa: ${kappa.toFixed(4)}`
    );

    let interpretation;

    if (kappa < 0) {
        interpretation = "Poor / less than chance";
    } else if (kappa < 0.20) {
        interpretation = "Slight agreement";
    } else if (kappa < 0.40) {
        interpretation = "Fair agreement";
    } else if (kappa < 0.60) {
        interpretation = "Moderate agreement";
    } else if (kappa < 0.80) {
        interpretation = "Substantial agreement";
    } else {
        interpretation = "Strong agreement";
    }

    console.log(
        `Interpretation: ${interpretation}`
    );
}

main();