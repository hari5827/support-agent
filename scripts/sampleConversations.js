const fs = require("fs");
const csv = require("csv-parser");

const inputFile = "../data/apple_conversations.csv";
const outputFile = "../data/apple_golden_set.csv";

const rows = [];

fs.createReadStream(inputFile)
  .pipe(csv())
  .on("data", (row) => {
    rows.push(row);
  })
  .on("end", () => {
    // Shuffle the conversations randomly
    rows.sort(() => Math.random() - 0.5);

    const sample = rows.slice(0, 200);

    const columns = [
      "customer_tweet_id",
      "customer_text",
      "customer_author_id",
      "customer_created_at",
      "support_tweet_id",
      "support_text",
      "support_created_at",
      "response_tweet_id"
    ];

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

    const output = fs.createWriteStream(outputFile);

    output.write(columns.join(",") + "\n");

    sample.forEach((row) => {
      const values = columns.map((column) =>
        escapeCSV(row[column])
      );

      output.write(values.join(",") + "\n");
    });

    output.end();

    console.log(`Sample created: ${sample.length} conversations`);
    console.log(`Saved to: ${outputFile}`);
  })
  .on("error", (error) => {
    console.error("Error:", error.message);
  });
