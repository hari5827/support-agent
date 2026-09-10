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

async function retrieve(query, topK = 3) {
    await ready;

    const results = [];

    tfidf.tfidfs(query, (i, score) => {
        results.push({
            customer_text: conversations[i].customer_text,
            support_text: conversations[i].support_text,
            score
        });
    });

    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

module.exports = { retrieve };