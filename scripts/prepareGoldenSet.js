const fs = require("fs");
const csv = require("csv-parser");
const path = require("path");

const inputFile = path.join(__dirname, "../data/apple_golden_set.csv");
const outputFile = path.join(__dirname, "../data/apple_golden_set_labeled.csv");

const rows = [];

fs.createReadStream(inputFile)
  .pipe(csv())
  .on("data", (row) => {
    rows.push(row);
  })
  .on("end", () => {
    const output = fs.createWriteStream(outputFile);

    const columns = [
      "customer_tweet_id",
      "customer_text",
      "support_tweet_id",
      "support_text",
      "intent",
      "escalation"
    ];

    output.write(columns.join(",") + "\n");

    function escapeCSV(value) {
      if (value === undefined || value === null) return "";

      value = String(value);

      if (
        value.includes(",") ||
        value.includes('"') ||
        value.includes("\n")
      ) {
        return `"${value.replace(/"/g, '""')}"`;
      }

      return value;
    }

    rows.forEach((row) => {
      const newRow = {
        customer_tweet_id: row.customer_tweet_id,
        customer_text: row.customer_text,
        support_tweet_id: row.support_tweet_id,
        support_text: row.support_text,

        // We will fill these manually
        intent: "",
        escalation: ""
      };

      const values = columns.map((column) =>
        escapeCSV(newRow[column])
      );

      output.write(values.join(",") + "\n");
    });

    output.end();

    console.log(`Prepared ${rows.length} examples.`);
    console.log(`Saved to: ${outputFile}`);
  })
  .on("error", (error) => {
    console.error("Error:", error.message);
  });