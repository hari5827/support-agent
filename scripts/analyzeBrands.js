const fs = require("fs");
const csv = require("csv-parser");

const filePath = "../twcs.csv";

const brandCounts = {};

fs.createReadStream(filePath)
  .pipe(csv())
  .on("data", (row) => {
    if (row.inbound === "False") {
      const brand = row.author_id;

      if (brand) {
        brandCounts[brand] = (brandCounts[brand] || 0) + 1;
      }
    }
  })
  .on("end", () => {
    const sortedBrands = Object.entries(brandCounts)
      .sort((a, b) => b[1] - a[1]);

    console.log("\nTop support accounts:\n");

    sortedBrands.slice(0, 30).forEach(([brand, count], index) => {
      console.log(`${index + 1}. ${brand} - ${count} replies`);
    });
  })
  .on("error", (error) => {
    console.error("Error:", error.message);
  });