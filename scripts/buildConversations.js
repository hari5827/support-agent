const fs = require("fs");
const csv = require("csv-parser");

const inputFile = "../twcs.csv";
const outputFile = "../data/apple_conversations.csv";

const rows = [];
const tweetMap = new Map();

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

// Read the complete dataset first
fs.createReadStream(inputFile)
  .pipe(csv())
  .on("data", (row) => {
    rows.push(row);
    tweetMap.set(row.tweet_id, row);
  })
  .on("end", () => {
    console.log(`Loaded ${rows.length} tweets.`);
    console.log("Building AppleSupport conversations...");

    const conversations = [];

    for (const row of rows) {
      // Only AppleSupport replies
      if (
        row.author_id !== "AppleSupport" ||
        row.inbound !== "False"
      ) {
        continue;
      }

      const parentId = row.in_response_to_tweet_id;

      if (!parentId) continue;

      const customer = tweetMap.get(parentId);

      // Parent must be a customer tweet
      if (!customer || customer.inbound !== "True") {
        continue;
      }

      conversations.push({
        customer_tweet_id: customer.tweet_id,
        customer_text: customer.text,
        customer_author_id: customer.author_id,
        customer_created_at: customer.created_at,

        support_tweet_id: row.tweet_id,
        support_text: row.text,
        support_created_at: row.created_at,

        response_tweet_id: row.response_tweet_id
      });
    }

    const output = fs.createWriteStream(outputFile);

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

    output.write(columns.join(",") + "\n");

    for (const conversation of conversations) {
      const values = columns.map((column) =>
        escapeCSV(conversation[column])
      );

      output.write(values.join(",") + "\n");
    }

    output.end();

    console.log(
      `Created ${conversations.length} customer-support pairs.`
    );
    console.log(`Saved to: ${outputFile}`);
  })
  .on("error", (error) => {
    console.error("Error:", error.message);
  });