const fs = require("fs");
const csv = require("csv-parser");

const inputFile = "../twcs.csv";
const outputFile = "../data/apple_support.csv";

fs.mkdirSync("../data", { recursive: true });

const output = fs.createWriteStream(outputFile);

const columns = [
  "tweet_id",
  "author_id",
  "inbound",
  "created_at",
  "text",
  "response_tweet_id",
  "in_response_to_tweet_id"
];

output.write(columns.join(",") + "\n");

function escapeCSV(value) {
  if (value === undefined || value === null) {
    return "";
  }

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

fs.createReadStream(inputFile)
  .pipe(csv())
  .on("data", (row) => {
    // Keep AppleSupport's replies
    if (row.author_id === "AppleSupport" && row.inbound === "False") {
      const values = columns.map((column) =>
        escapeCSV(row[column])
      );

      output.write(values.join(",") + "\n");
    }
  })
  .on("end", () => {
    output.end();

    console.log("AppleSupport extraction complete.");
    console.log(`Saved to: ${outputFile}`);
  })
  .on("error", (error) => {
    console.error("Error:", error.message);
  });