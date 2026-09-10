const fs = require("fs");
const readline = require("readline");
const csv = require("csv-parser");
const path = require("path");

const inputFile = path.join(
  __dirname,
  "../data/apple_golden_set_final.csv"
);
const outputFile = path.join(
  __dirname,
  "../data/apple_golden_set_final.csv"
);

const rows = [];

fs.createReadStream(inputFile)
  .pipe(csv())
  .on("data", (row) => rows.push(row))
  .on("end", () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const intents = {
      "1": "ios_update_issue",
      "2": "device_performance",
      "3": "battery_issue",
      "4": "app_issue",
      "5": "payment_account_issue",
      "6": "hardware_issue",
      "7": "product_order_issue",
      "8": "general_support"
    };

    let index = rows.findIndex(
      (row) => !row.intent || !row.escalation
    );

    if (index === -1) {
      console.log("All examples are already labeled.");
      rl.close();
      return;
    }

    function showExample() {
      const row = rows[index];

      console.log("\n----------------------------------------");
      console.log(`Example ${index + 1} / ${rows.length}`);
      console.log("----------------------------------------");

      console.log("\nCUSTOMER:");
      console.log(row.customer_text);

      console.log("\nCurrent labels:");
      console.log(`Intent: ${row.intent || "not labeled"}`);
      console.log(`Escalation: ${row.escalation || "not labeled"}`);

      console.log("\nChoose intent:");
      console.log("1 = ios_update_issue");
      console.log("2 = device_performance");
      console.log("3 = battery_issue");
      console.log("4 = app_issue");
      console.log("5 = payment_account_issue");
      console.log("6 = hardware_issue");
      console.log("7 = product_order_issue");
      console.log("8 = general_support");
      console.log("b = go back");

      rl.question("\nIntent: ", handleIntent);
    }

    function handleIntent(answer) {
      if (answer.toLowerCase() === "b") {
        if (index === 0) {
          console.log("Already at the first example.");
          return showExample();
        }

        index--;
        return showExample();
      }

      if (!intents[answer]) {
        console.log("Invalid choice. Use 1-8 or b.");
        return rl.question("\nIntent: ", handleIntent);
      }

      rows[index].intent = intents[answer];

      console.log("\nChoose escalation:");
      console.log("a = auto");
      console.log("h = human");
      console.log("b = go back");

      rl.question("\nEscalation: ", handleEscalation);
    }

    function handleEscalation(answer) {
      answer = answer.toLowerCase();

      if (answer === "b") {
        return showExample();
      }

      if (answer !== "a" && answer !== "h") {
        console.log("Invalid choice. Use a, h, or b.");
        return rl.question("\nEscalation: ", handleEscalation);
      }

      rows[index].escalation =
        answer === "a" ? "auto" : "human";

      saveProgress();

      if (index < rows.length - 1) {
        index++;
        showExample();
      } else {
        console.log("\nAll examples labeled.");
        rl.close();
      }
    }

    function saveProgress() {
      const columns = [
        "customer_tweet_id",
        "customer_text",
        "support_tweet_id",
        "support_text",
        "intent",
        "escalation"
      ];

      const escapeCSV = (value) => {
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
      };

      const lines = [columns.join(",")];

      rows.forEach((row) => {
        lines.push(
          columns
            .map((column) => escapeCSV(row[column]))
            .join(",")
        );
      });

      fs.writeFileSync(outputFile, lines.join("\n"));

      console.log("Progress saved.");
    }

    showExample();
  })
  .on("error", (error) => {
    console.error("Error:", error.message);
  });