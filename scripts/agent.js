require("dotenv").config();

const Groq = require("groq-sdk");
const { retrieve } = require("./retriever");

const client = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const MODEL = "openai/gpt-oss-20b";

const intents = [
    "ios_update_issue",
    "device_performance",
    "battery_issue",
    "app_issue",
    "payment_account_issue",
    "hardware_issue",
    "product_order_issue",
    "general_support"
];

async function runAgent(customerMessage) {
    const evidence = await retrieve(customerMessage, 3);

    const evidenceText = evidence
        .map(
            (item, index) =>
                `Example ${index + 1}:
Customer: ${item.customer_text}
Support: ${item.support_text}`
        )
        .join("\n\n");

    const systemPrompt = `
You are an Apple customer support agent.

Your task is to:
1. Classify the customer's primary intent.
2. Decide whether the case should be handled automatically or escalated to a human.
3. Write a short support reply grounded in the retrieved historical examples.

Allowed intents:
${intents.join(", ")}

Escalate to human when:
- The issue involves payment, refunds, unauthorized charges, or account problems.
- The customer needs an order change, replacement, or other manual action.
- There is physical damage, electrical/safety risk, or serious hardware failure.
- The customer explicitly asks for a human.
- The problem is unclear or requires specialist investigation.
- The customer has already tried troubleshooting and still needs further help.

Use auto for straightforward informational or basic troubleshooting requests that do not require manual account/order/action.

GROUNDING RULES:
- Use the historical examples as your main source for the reply.
- Do not claim that you can forward, refund, replace, investigate, or perform any action yourself.
- Do not invent Apple policies, URLs, or support procedures.
- Do not copy irrelevant information from the examples.
- Keep the reply concise and natural.
- If the examples only show Apple asking the customer for more information, do the same.
- Do not give a long generic troubleshooting checklist unless the historical examples support it.

Return ONLY valid JSON matching the required schema.
`;

    const userPrompt = `
Customer message:
${customerMessage}

Retrieved historical conversations:
${evidenceText}
`;

    const response = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.2,

        response_format: {
            type: "json_schema",
            json_schema: {
                name: "support_agent_response",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        intent: {
                            type: "string",
                            enum: intents
                        },
                        escalation: {
                            type: "string",
                            enum: ["auto", "human"]
                        },
                        reply: {
                            type: "string"
                        }
                    },
                    required: [
                        "intent",
                        "escalation",
                        "reply"
                    ],
                    additionalProperties: false
                }
            }
        },

        messages: [
            {
                role: "system",
                content: systemPrompt
            },
            {
                role: "user",
                content: userPrompt
            }
        ]
    });

    const result = JSON.parse(
        response.choices[0].message.content
    );

    return {
        ...result,
        evidence
    };
}


async function main() {
    const testMessages = [
        "My iPhone is very slow and keeps freezing",
        "My battery is draining really fast after the latest update",
        "I was charged for something I didn't purchase"
    ];

    for (const message of testMessages) {
        console.log("\n================================");
        console.log("CUSTOMER:", message);

        try {
            const result = await runAgent(message);

            console.log("\nINTENT:", result.intent);
            console.log("ESCALATION:", result.escalation);
            console.log("REPLY:", result.reply);

            console.log("\nEVIDENCE:");

            result.evidence.forEach((item, index) => {
                console.log(
                    `${index + 1}. ${item.customer_text}`
                );
            });

        } catch (error) {
            console.error(
                "Agent error:",
                error.message
            );
        }
    }
}


// This allows evaluateAgent.js to import runAgent()
// without automatically running the test messages.
module.exports = { runAgent };

if (require.main === module) {
    main();
}