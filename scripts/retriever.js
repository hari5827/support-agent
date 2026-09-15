const fs = require("fs");
const csv = require("csv-parser");
const natural = require("natural");

const inputFile = "data/apple_conversations.csv";

const conversations = [];
const tfidf = new natural.TfIdf();

const ready = new Promise((resolve, reject) => {
    fs.createReadStream(inputFile)
        .pipe(csv())
        .on("data", (row) => {
            conversations.push(row);
            tfidf.addDocument(row.customer_text);
        })
        .on("end", () => {
            console.log(
                `Retriever loaded ${conversations.length} conversations`
            );
            resolve();
        })
        .on("error", reject);
});
let excludedIds = new Set();

function setExcludedIds(ids) {
    excludedIds = new Set(ids);
    console.log(
        `Retriever: excluding ${excludedIds.size} customer_tweet_id(s) from retrieval results.`
    );
}

async function retrieve(query, topK = 3) {
    await ready;

    const results = [];

    tfidf.tfidfs(query, (i, score) => {
        const row = conversations[i];

        if (excludedIds.has(row.customer_tweet_id)) {
            return;
        }

        results.push({
            customer_tweet_id: row.customer_tweet_id,
            customer_text: row.customer_text,
            support_text: row.support_text,
            score
        });
    });

    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

module.exports = { retrieve, setExcludedIds };