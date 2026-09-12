require("dotenv").config();

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const Groq = require("groq-sdk");

const client = new Groq({
    apiKey: process.env.GRO_API_KEY
});

const MODEL = "openai/gpt-oss-20b";

const inputFile = path.join(
    __dirname,
    "../data/main_agent_results.csv"
);

const outputFile = path.join(
    __dirname,
    "../data/reply_quality_results.csv"
);

function loadCSV(file) {
    return new Promise((resolve, reject) => {
        const rows = [];

        if (!fs.existsSync(file)) {
            resolve([]);
            return;
        }

        fs.createReadStream(file)
            .pipe(csv())
            .on("data", row => rows.push(row))
            .on("end", () => resolve(rows))
            .on("error", reject);
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function csvEscape(value) {
    if (value === undefined || value === null) {
        return "";
    }

    const text = String(value);

    if (
        text.includes(",") ||
        text.includes('"') ||
        text.includes("\n")
    ) {
        return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
}

function saveResults(results) {
    const headers = [
        "customer_tweet_id",
        "customer_text",
        "reply",
        "relevance",
        "grounding",
        "helpfulness",
        "appropriateness",
        "overall_score"
    ];

    const lines = [headers.join(",")];

    for (const row of results) {
        lines.push(
            [
                row.customer_tweet_id,
                row.customer_text,
                row.reply,
                row.relevance,
                row.grounding,
                row.helpfulness,
                row.appropriateness,
                row.overall_score
            ]
                .map(csvEscape)
                .join(",")
        );
    }

    fs.writeFileSync(
        outputFile,
        lines.join("\n"),
        "utf8"
    );
}

async function judgeReply(row) {
    let evidence = [];

    try {
        evidence = JSON.parse(row.evidence || "[]");
    } catch {
        evidence = [];
    }

    const evidenceText = evidence
        .map(
            (item, index) =>
                `Example ${index + 1}:
Customer: ${item.customer_text}
Historical Support Reply: ${item.support_text}`
        )
        .join("\n\n");

    const prompt = `
You are evaluating an AI customer-support reply.

Customer message:
${row.customer_text}

AI-generated reply:
${row.reply}

Retrieved historical support conversations:
${evidenceText}

Score the AI reply from 1 to 5 on each criterion.

1. relevance:
Does the reply directly address the customer's problem?

2. grounding:
Is the reply consistent with the retrieved historical support conversations?
Do not reward unsupported claims.

3. helpfulness:
Does the reply provide an appropriate next step or useful response?

4. appropriateness:
Does the reply avoid pretending to have capabilities it does not have?
Does it avoid unsafe, misleading, or unnecessary claims?

Scoring:
1 = very poor
2 = poor
3 = acceptable
4 = good
5 = excellent

Return ONLY the JSON object.
`;

    const response = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.1,

        response_format: {
            type: "json_schema",
            json_schema: {
                name: "reply_quality",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        relevance: {
                            type: "integer",
                            minimum: 1,
                            maximum: 5
                        },
                        grounding: {
                            type: "integer",
                            minimum: 1,
                            maximum: 5
                        },
                        helpfulness: {
                            type: "integer",
                            minimum: 1,
                            maximum: 5
                        },
                        appropriateness: {
                            type: "integer",
                            minimum: 1,
                            maximum: 5
                        }
                    },
                    required: [
                        "relevance",
                        "grounding",
                        "helpfulness",
                        "appropriateness"
                    ],
                    additionalProperties: false
                }
            }
        },

        messages: [
            {
                role: "user",
                content: prompt
            }
        ]
    });

    return JSON.parse(
        response.choices[0].message.content
    );
}

async function judgeWithRetry(row) {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await judgeReply(row);
        } catch (error) {
            const message = error.message || "";

            if (
                error.status === 429 ||
                message.includes("429") ||
                message.toLowerCase().includes("rate limit")
            ) {
                console.log(
                    `Rate limit hit. Waiting 60 seconds... (attempt ${attempt}/${maxRetries})`
                );

                await sleep(60000);
                continue;
            }

            throw error;
        }
    }

    throw new Error("Rate limit persisted after retries.");
}

async function main() {
    console.log("Loading agent results...");

    const rows = await loadCSV(inputFile);

    console.log(`Loaded ${rows.length} replies.`);

    // Load previous progress if it exists
    const existingResults = await loadCSV(outputFile);

    const completedIds = new Set(
        existingResults.map(row => row.customer_tweet_id)
    );

    console.log(
        `Already completed: ${existingResults.length}`
    );

    const results = [...existingResults];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        if (completedIds.has(row.customer_tweet_id)) {
            console.log(
                `[${i + 1}/${rows.length}] Already completed - skipping`
            );
            continue;
        }

        console.log(
            `\n[${i + 1}/${rows.length}] ${row.customer_text}`
        );

        try {
            const scores = await judgeWithRetry(row);

            const average =
                (
                    scores.relevance +
                    scores.grounding +
                    scores.helpfulness +
                    scores.appropriateness
                ) / 4;

            const result = {
                customer_tweet_id:
                    row.customer_tweet_id,

                customer_text:
                    row.customer_text,

                reply:
                    row.reply,

                relevance:
                    scores.relevance,

                grounding:
                    scores.grounding,

                helpfulness:
                    scores.helpfulness,

                appropriateness:
                    scores.appropriateness,

                overall_score:
                    average.toFixed(2)
            };

            results.push(result);
            completedIds.add(row.customer_tweet_id);

            console.log(
                `Relevance: ${scores.relevance}/5`
            );

            console.log(
                `Grounding: ${scores.grounding}/5`
            );

            console.log(
                `Helpfulness: ${scores.helpfulness}/5`
            );

            console.log(
                `Appropriateness: ${scores.appropriateness}/5`
            );

            console.log(
                `Overall: ${average.toFixed(2)}/5`
            );

            // SAVE IMMEDIATELY
            saveResults(results);

            console.log(
                `Progress saved: ${results.length}/${rows.length}`
            );

        } catch (error) {
            console.error(
                `FAILED example ${i + 1}:`,
                error.message
            );
        }

        // Safer Groq pacing: ~15 requests/minute
        if (i < rows.length - 1) {
            await sleep(4000);
        }
    }

    // Final averages
    if (results.length > 0) {
        const averages = {
            relevance: 0,
            grounding: 0,
            helpfulness: 0,
            appropriateness: 0,
            overall: 0
        };

        for (const row of results) {
            averages.relevance += Number(row.relevance);
            averages.grounding += Number(row.grounding);
            averages.helpfulness += Number(row.helpfulness);
            averages.appropriateness += Number(row.appropriateness);
            averages.overall += Number(row.overall_score);
        }

        const count = results.length;

        console.log("\n================================");
        console.log("REPLY QUALITY EVALUATION");
        console.log("================================");

        console.log(`Successful: ${count}`);
        console.log(`Remaining: ${rows.length - count}`);

        console.log(
            `\nRelevance: ${(averages.relevance / count).toFixed(2)}/5`
        );

        console.log(
            `Grounding: ${(averages.grounding / count).toFixed(2)}/5`
        );

        console.log(
            `Helpfulness: ${(averages.helpfulness / count).toFixed(2)}/5`
        );

        console.log(
            `Appropriateness: ${(averages.appropriateness / count).toFixed(2)}/5`
        );

        console.log(
            `Overall: ${(averages.overall / count).toFixed(2)}/5`
        );
    }

    console.log(
        `\nResults saved to: ${outputFile}`
    );
}

main();