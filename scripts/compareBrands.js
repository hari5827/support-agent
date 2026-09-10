const fs = require("fs");
const csv = require("csv-parser");

const brands = [
  "AmazonHelp",
  "AppleSupport",
  "Uber_Support",
  "SpotifyCares",
  "Delta"
];

const supportTweetIds = {};
const relatedTweetIds = {};
const stats = {};

brands.forEach((brand) => {
  supportTweetIds[brand] = new Set();
  relatedTweetIds[brand] = new Set();

  stats[brand] = {
    supportReplies: 0,
    customerTweets: new Set(),
    customerAuthors: new Set(),
    relatedTweets: new Set()
  };
});

// PASS 1: find support tweets for each brand
fs.createReadStream("../twcs.csv")
  .pipe(csv())
  .on("data", (row) => {
    if (
      row.inbound === "False" &&
      brands.includes(row.author_id)
    ) {
      const brand = row.author_id;

      stats[brand].supportReplies++;
      supportTweetIds[brand].add(row.tweet_id);

      stats[brand].relatedTweets.add(row.tweet_id);

      if (row.in_response_to_tweet_id) {
        relatedTweetIds[brand].add(row.in_response_to_tweet_id);
      }

      if (row.response_tweet_id) {
        row.response_tweet_id
          .split(",")
          .forEach((id) => {
            relatedTweetIds[brand].add(id);
          });
      }
    }
  })
  .on("end", () => {
    console.log("First pass complete. Finding related customer tweets...\n");

    // PASS 2
    fs.createReadStream("../twcs.csv")
      .pipe(csv())
      .on("data", (row) => {
        brands.forEach((brand) => {
          if (relatedTweetIds[brand].has(row.tweet_id)) {
            stats[brand].relatedTweets.add(row.tweet_id);

            if (row.inbound === "True") {
              stats[brand].customerTweets.add(row.tweet_id);
              stats[brand].customerAuthors.add(row.author_id);
            }
          }
        });
      })
      .on("end", () => {
        console.log("\nBrand comparison:\n");

        brands.forEach((brand) => {
          const s = stats[brand];

          console.log(`--- ${brand} ---`);
          console.log(`Support replies: ${s.supportReplies}`);
          console.log(`Customer tweets: ${s.customerTweets.size}`);
          console.log(`Unique customers: ${s.customerAuthors.size}`);
          console.log(`Related tweets: ${s.relatedTweets.size}`);
          console.log();
        });
      })
      .on("error", (error) => {
        console.error("Error:", error.message);
      });
  })
  .on("error", (error) => {
    console.error("Error:", error.message);
  });