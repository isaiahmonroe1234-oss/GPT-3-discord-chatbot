'use strict';

const { Client, Events, GatewayIntentBits, EmbedBuilder, ActivityType } = require("discord.js");
require("dotenv/config");
const { GoogleGenAI } = require("@google/genai");

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_KEY;
const BOT_CHANNEL = process.env.BOT_CHANNEL || "";
const PAST_MESSAGES = 10;

const COLORS = { gold: '#FFD700', blue: '#54A0FF', purple: '#A55EEA', red: '#FF4757' };
const DIVIDER = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

const genAI = new GoogleGenAI({ apiKey: GEMINI_KEY });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

client.once(Events.ClientReady, (c) => {
    console.log(`[READY] Logged in as ${c.user.tag}`);
    c.user.setActivity("your messages 👀", { type: ActivityType.Watching });
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    const inTargetChannel = BOT_CHANNEL ? message.channel.id === BOT_CHANNEL : false;
    const wasMentioned = message.mentions.has(client.user);
    if (!inTargetChannel && !wasMentioned) return;

    if (!GEMINI_KEY) {
        return message.reply("> ❌ **Missing Key** — `GEMINI_KEY` is not set.");
    }

    message.channel.sendTyping();

    try {
        let rawMessages = Array.from(
            await message.channel.messages.fetch({ limit: PAST_MESSAGES, before: message.id })
        );
        rawMessages = rawMessages.map(m => m[1]).reverse();

        const history = [];
        for (const m of rawMessages) {
            if (m.author.bot && m.author.id !== client.user.id) continue;
            const role = m.author.id === client.user.id ? "model" : "user";
            history.push({ role, parts: [{ text: m.content || "(no text)" }] });
        }

        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            systemInstruction: "You are a helpful, friendly, and witty AI assistant in a Discord server. Keep responses concise and conversational."
        });

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(message.content || "Hello!");
        const aiResponse = result.response.text();

        const embed = new EmbedBuilder()
            .setColor(COLORS.gold)
            .setAuthor({ name: "AI ASSISTANT", iconURL: "https://cdn-icons-png.flaticon.com/512/471/471663.png" })
            .setDescription(`${aiResponse}\n\n${DIVIDER}`)
            .setFooter({ text: `Model: Gemini 1.5 Flash (Free)`, iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        await message.reply({ embeds: [embed] });

    } catch (err) {
        console.error('[AI ERROR]', err.message);
        await message.reply({ embeds: [
            new EmbedBuilder().setColor(COLORS.red).setTitle('❌ AI ERROR').setDescription(`> ${err.message}`).setTimestamp()
        ]});
    }
});

client.login(BOT_TOKEN);
