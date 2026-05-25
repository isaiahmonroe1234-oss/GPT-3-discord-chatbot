'use strict';

const { Client, Events, GatewayIntentBits, EmbedBuilder, ActivityType } = require("discord.js");
require("dotenv/config");
const OpenAI = require("openai");

// ─── Configuration ───────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_KEY = process.env.OPENAI_KEY || process.env.OPENAI_API_KEY;
const BOT_CHANNEL = process.env.BOT_CHANNEL || "1506694997062324295";
const PAST_MESSAGES = 10;

// ─── Premium Styling ─────────────────────────────────────────────────────────
const COLORS = { gold: '#FFD700', blue: '#54A0FF', purple: '#A55EEA', red: '#FF4757' };
const DIVIDER = '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬';

const openai = new OpenAI({ apiKey: OPENAI_KEY });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// ─── Ready Event ─────────────────────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
    console.log(`[READY] Logged in as ${c.user.tag}`);
    c.user.setActivity("your messages 👀", { type: ActivityType.Watching });
});

// ─── Message Event ───────────────────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
    // Basic guards
    if (message.author.bot) return;
    if (message.channel.id !== BOT_CHANNEL && !message.mentions.has(client.user)) return;

    // Check for API Key
    if (!OPENAI_KEY) {
        return message.reply("> ❌ **Missing Key** — `OPENAI_KEY` is not set in environment variables.");
    }

    // ─── Handle Image Generation (!image <prompt>) ───────────────────────────
    if (message.content.toLowerCase().startsWith('!image ')) {
        const prompt = message.content.slice(7).trim();
        if (!prompt) return message.reply("> ❌ **Missing Prompt** — What should I generate?");

        const loading = await message.reply("> 🎨 **Generating your masterpiece...** Please wait.");
        try {
            const response = await openai.images.generate({
                model: "dall-e-3",
                prompt: prompt,
                n: 1,
                size: "1024x1024",
            });

            const embed = new EmbedBuilder()
                .setColor(COLORS.purple)
                .setTitle('🎨 AI GENERATED ART')
                .setDescription(`> **Prompt:** ${prompt}\n\n${DIVIDER}`)
                .setImage(response.data[0].url)
                .setFooter({ text: "Powered by DALL-E 3", iconURL: client.user.displayAvatarURL() })
                .setTimestamp();

            await loading.delete().catch(() => {});
            return message.reply({ embeds: [embed] });
        } catch (err) {
            console.error('[IMAGE ERROR]', err.message);
            await loading.delete().catch(() => {});
            return message.reply(`> ❌ **Generation Failed** — ${err.message}`);
        }
    }

    // ─── Handle AI Chat (GPT-4o + Vision) ────────────────────────────────────
    message.channel.sendTyping();

    try {
        // Fetch context
        let rawMessages = Array.from(await message.channel.messages.fetch({ limit: PAST_MESSAGES, before: message.id }));
        rawMessages = rawMessages.map(m => m[1]).reverse();

        const chatMessages = [
            { role: "system", content: "You are a world-class AI Assistant. You are professional, witty, and extremely helpful. You can see images if they are attached to messages." }
        ];

        // Add history
        for (const m of rawMessages) {
            if (m.author.bot && m.author.id !== client.user.id) continue;
            const role = m.author.id === client.user.id ? "assistant" : "user";
            chatMessages.push({ role: role, content: m.content || "Attached an image." });
        }

        // Add current message with Vision support
        const currentContent = [{ type: "text", text: message.content || "Describe this image." }];
        
        const attachment = message.attachments.first();
        if (attachment && attachment.contentType?.startsWith('image/')) {
            currentContent.push({ type: "image_url", image_url: { url: attachment.url } });
        }

        chatMessages.push({ role: "user", content: currentContent });

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: chatMessages,
            max_tokens: 1000
        });

        const aiResponse = response.choices[0].message.content;

        // Premium Embed Response
        const embed = new EmbedBuilder()
            .setColor(COLORS.gold)
            .setAuthor({ name: "AI ASSISTANT", iconURL: "https://cdn-icons-png.flaticon.com/512/471/471663.png" })
            .setDescription(`${aiResponse}\n\n${DIVIDER}`)
            .setFooter({ text: `Model: GPT-4o • ${attachment ? 'Vision Active' : 'Chat Mode'}`, iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        await message.reply({ embeds: [embed] });

    } catch (err) {
        console.error('[AI ERROR]', err.message);
        const errorEmbed = new EmbedBuilder()
            .setColor(COLORS.red)
            .setTitle('❌ AI ERROR')
            .setDescription(`> ${err.message}\n\n${DIVIDER}`)
            .setTimestamp();
        await message.reply({ embeds: [errorEmbed] });
    }
});

client.login(BOT_TOKEN);
