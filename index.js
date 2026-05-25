'use strict';

const { Client, Events, GatewayIntentBits, EmbedBuilder, ActivityType } = require("discord.js");
require("dotenv/config");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_KEY;
const BOT_CHANNEL = process.env.BOT_CHANNEL || "";
const PAST_MESSAGES = 10;

const COLORS = { gold: '#FFD700', blue: '#54A0FF', purple: '#A55EEA', red: '#FF4757', green: '#2ECC71', orange: '#FF6B35' };
const DIVIDER = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

const genAI = new GoogleGenerativeAI(GEMINI_KEY);

// ─── Rate Limit Tracker ───────────────────────────────────────────────────────
const rateLimiter = {
    requests: [],
    maxPerMinute: 12,
    cooldowns: new Map(),
    userCooldownMs: 8000,

    canRequest() {
        const now = Date.now();
        this.requests = this.requests.filter(t => now - t < 60000);
        return this.requests.length < this.maxPerMinute;
    },

    record() {
        this.requests.push(Date.now());
    },

    timeUntilReset() {
        if (this.requests.length === 0) return 0;
        const oldest = this.requests[0];
        return Math.ceil((60000 - (Date.now() - oldest)) / 1000);
    },

    isUserOnCooldown(userId) {
        const last = this.cooldowns.get(userId);
        if (!last) return false;
        return Date.now() - last < this.userCooldownMs;
    },

    setUserCooldown(userId) {
        this.cooldowns.set(userId, Date.now());
    },

    userTimeLeft(userId) {
        const last = this.cooldowns.get(userId);
        if (!last) return 0;
        return Math.ceil((this.userCooldownMs - (Date.now() - last)) / 1000);
    }
};

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

// ─── Helper: run AI with rate limit check ────────────────────────────────────
async function runAI(message, fn) {
    const userId = message.author.id;

    if (rateLimiter.isUserOnCooldown(userId)) {
        const secs = rateLimiter.userTimeLeft(userId);
        const embed = new EmbedBuilder()
            .setColor(COLORS.orange)
            .setTitle('⏳ Slow Down!')
            .setDescription(`You're sending messages too fast.\n\nPlease wait **${secs}s** before trying again.\n\n${DIVIDER}`)
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    if (!rateLimiter.canRequest()) {
        const secs = rateLimiter.timeUntilReset();
        const embed = new EmbedBuilder()
            .setColor(COLORS.orange)
            .setTitle('🚦 Rate Limited')
            .setDescription(`The bot has hit its request limit for this minute.\n\nPlease wait **${secs}s** and try again.\n\n${DIVIDER}`)
            .setFooter({ text: 'Free tier: 12 requests/minute' })
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    rateLimiter.setUserCooldown(userId);
    rateLimiter.record();

    try {
        await fn();
    } catch (err) {
        console.error('[AI ERROR]', err.message);

        const isRateLimit = err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('retry');
        const embed = new EmbedBuilder()
            .setColor(isRateLimit ? COLORS.orange : COLORS.red)
            .setTitle(isRateLimit ? '🚦 Rate Limited by Google' : '❌ AI ERROR')
            .setDescription(isRateLimit
                ? `Too many requests to the Gemini API.\n\nPlease wait **15–30 seconds** and try again.\n\n${DIVIDER}`
                : `> ${err.message}\n\n${DIVIDER}`)
            .setFooter({ text: isRateLimit ? 'Free tier has limited requests per minute' : 'Something went wrong' })
            .setTimestamp();
        await message.reply({ embeds: [embed] });
    }
}

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    const inTargetChannel = BOT_CHANNEL ? message.channel.id === BOT_CHANNEL : false;
    const wasMentioned = message.mentions.has(client.user);
    if (!inTargetChannel && !wasMentioned) return;

    const content = message.content.trim();

    // ─── !help ────────────────────────────────────────────────────────────────
    if (content.toLowerCase() === '!help') {
        const helpEmbed = new EmbedBuilder()
            .setColor(COLORS.blue)
            .setTitle('🤖 Bot Commands')
            .setDescription(DIVIDER)
            .addFields(
                { name: '💬 Chat', value: 'Type normally or @mention me anywhere' },
                { name: '❓ !help', value: 'Shows this command list' },
                { name: '🤖 !ask <question>', value: 'Ask the AI a direct question' },
                { name: '🔥 !roast @user', value: 'Roast someone with AI' },
                { name: '😂 !joke', value: 'Get a random joke' },
                { name: '🏓 !ping', value: 'Check if the bot is alive' }
            )
            .setFooter({ text: 'Powered by Gemini 2.0 Flash (Free)', iconURL: client.user.displayAvatarURL() })
            .setTimestamp();
        return message.reply({ embeds: [helpEmbed] });
    }

    // ─── !ping ────────────────────────────────────────────────────────────────
    if (content.toLowerCase() === '!ping') {
        const ping = client.ws.ping;
        const embed = new EmbedBuilder()
            .setColor(COLORS.green)
            .setTitle('🏓 Pong!')
            .setDescription(`Bot is alive!\n\n**Latency:** ${ping}ms\n\n${DIVIDER}`)
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // ─── !joke ────────────────────────────────────────────────────────────────
    if (content.toLowerCase() === '!joke') {
        message.channel.sendTyping();
        return runAI(message, async () => {
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            const result = await model.generateContent("Tell me one short, funny joke. Just the joke, no intro.");
            const joke = result.response.text();
            const embed = new EmbedBuilder()
                .setColor(COLORS.purple)
                .setTitle('😂 Random Joke')
                .setDescription(`${joke}\n\n${DIVIDER}`)
                .setFooter({ text: 'Powered by Gemini', iconURL: client.user.displayAvatarURL() })
                .setTimestamp();
            await message.reply({ embeds: [embed] });
        });
    }

    // ─── !roast @user ─────────────────────────────────────────────────────────
    if (content.toLowerCase().startsWith('!roast')) {
        const target = message.mentions.users.first();
        const targetName = target ? target.username : "this person";
        message.channel.sendTyping();
        return runAI(message, async () => {
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            const result = await model.generateContent(
                `Write a funny, lighthearted roast for someone named "${targetName}". Keep it playful, not mean. 2-3 sentences max.`
            );
            const roast = result.response.text();
            const embed = new EmbedBuilder()
                .setColor(COLORS.red)
                .setTitle(`🔥 Roasting ${targetName}...`)
                .setDescription(`${roast}\n\n${DIVIDER}`)
                .setFooter({ text: `Requested by ${message.author.username}`, iconURL: client.user.displayAvatarURL() })
                .setTimestamp();
            await message.reply({ embeds: [embed] });
        });
    }

    // ─── !ask <question> ──────────────────────────────────────────────────────
    if (content.toLowerCase().startsWith('!ask ')) {
        const question = content.slice(5).trim();
        if (!question) return message.reply('> ❌ Please provide a question! e.g. `!ask what is the meaning of life`');
        message.channel.sendTyping();
        return runAI(message, async () => {
            const model = genAI.getGenerativeModel({
                model: "gemini-2.0-flash",
                systemInstruction: "Answer concisely and helpfully. You are a Discord bot assistant."
            });
            const result = await model.generateContent(question);
            const answer = result.response.text();
            const embed = new EmbedBuilder()
                .setColor(COLORS.gold)
                .setAuthor({ name: "AI ASSISTANT", iconURL: "https://cdn-icons-png.flaticon.com/512/471/471663.png" })
                .setDescription(`**Q: ${question}**\n\n${answer}\n\n${DIVIDER}`)
                .setFooter({ text: `Asked by ${message.author.username}`, iconURL: client.user.displayAvatarURL() })
                .setTimestamp();
            await message.reply({ embeds: [embed] });
        });
    }

    // ─── General AI Chat ──────────────────────────────────────────────────────
    if (!GEMINI_KEY) return message.reply("> ❌ **Missing Key** — `GEMINI_KEY` is not set.");

    message.channel.sendTyping();

    return runAI(message, async () => {
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
            model: "gemini-2.0-flash",
            systemInstruction: "You are a helpful, friendly, and witty AI assistant in a Discord server. Keep responses concise and conversational."
        });

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(content || "Hello!");
        const aiResponse = result.response.text();

        const embed = new EmbedBuilder()
            .setColor(COLORS.gold)
            .setAuthor({ name: "AI ASSISTANT", iconURL: "https://cdn-icons-png.flaticon.com/512/471/471663.png" })
            .setDescription(`${aiResponse}\n\n${DIVIDER}`)
            .setFooter({ text: `Model: Gemini 2.0 Flash (Free)`, iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
    });
});

client.login(BOT_TOKEN);
