process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const { Client } = require('discord.js-selfbot-v13');
const Groq = require('groq-sdk');
const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();


const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const commands = require('./commands');
const knowledge = require('./knowledge');

const client = new Client();
const groq = new Groq({ apiKey: config.groqApiKey });
const shapes_client = new OpenAI({
  apiKey: config.shapesApiKey,
  baseURL: 'https://api.shapes.inc/v1',
});
const gemini = new GoogleGenerativeAI(config.geminiApiKey);

const ensureDirectory = (dirPath) => {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath);
};

ensureDirectory(path.join(__dirname, 'images'));

const startTime = Date.now();
let aiEnabled = true;
let channelEnabled = {};
let selectedApi = config.defaultApi || 'groq';
let geminiModel = 'gemini-1.5-flash';



const db = new sqlite3.Database('ai.db', (err) => {
  if (err) console.error('Database error:', err);
  db.run(`CREATE TABLE IF NOT EXISTS memory (
    channelId TEXT,
    userId TEXT,
    message TEXT,
    timestamp INTEGER
  )`);
});

function storeMessage(channelId, userId, message) {
  db.run(`INSERT INTO memory (channelId, userId, message, timestamp) VALUES (?, ?, ?, ?)`,
    [channelId, userId, message, Date.now()]);
}

function getRecentMessages(channelId, userId, callback) {
  db.all(
    `SELECT message FROM memory WHERE channelId = ? AND userId = ? ORDER BY timestamp DESC LIMIT 10`,
    [channelId, userId],
    (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        callback([]);
      } else {
        callback(rows ? rows.map(row => row.message).reverse() : []);
      }
    }
);
}

const apiUsage = {
  groq: { calls: 0, tokens: 0 },
  shapes: { calls: 0, tokens: 0 },
  gemini: { calls: 0, tokens: 0 },
};

let channelSettings = {};
if (fs.existsSync('channel.json')) {
  channelSettings = JSON.parse(fs.readFileSync('channel.json', 'utf8'));
}

const saveChannelSettings = () => {
  fs.writeFileSync('channel.json', JSON.stringify(channelSettings, null, 2));
};

const simulateTyping = async (channel) => {
  try {
    await channel.sendTyping();
    const typingDelay = Math.floor(Math.random() * 4000) + 6000; // 6-10 seconds
    return new Promise(resolve => setTimeout(resolve, typingDelay));
  } catch (error) {
    console.error('Typing error:', error);
  }
};

const generateTextResponse = async (prompt) => {
  try {
    let response;
    
    if (selectedApi === 'groq') {
      response = await groq.chat.completions.create({
        model: 'llama3-8b-8192',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
      });
      apiUsage.groq.calls++;
      apiUsage.groq.tokens += response.usage?.total_tokens || 0;
      return response.choices[0].message.content.trim();
    }
    else if (selectedApi === 'shapes') {
      response = await shapes_client.chat.completions.create({
        model: 'shapesinc/dalle3-r1ja',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
      });
      apiUsage.shapes.calls++;
      apiUsage.shapes.tokens += response.usage?.total_tokens || 0;
      return response.choices[0].message.content.trim();
    }
    else if (selectedApi === 'gemini') {
      const model = gemini.getGenerativeModel({ model: geminiModel });
      const result = await model.generateContent(prompt);
      apiUsage.gemini.calls++;
      return result.response.text().trim();
    }
    
    throw new Error('Invalid API selected');
  } catch (error) {
    console.error(`${selectedApi} generation error:`, error);
    throw error;
  }
};

const generateImage = async (prompt, message) => {
  try {
    if (!config.shapesApiKey || !config.shapesImageModel) {
      throw new Error('Image generation not configured');
    }

    await simulateTyping(message.channel);
    
    const response = await shapes_client.chat.completions.create({
      model: config.shapesImageModel,
      messages: [{ role: 'user', content: `!imagine ${prompt}` }],
      max_tokens: 1000,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in response');

    const urlMatch = content.match(/(https?:\/\/[^\s]+)/);
    if (!urlMatch) {
      return message.reply(`"${content}". No image found`);
    }

    const imageUrl = urlMatch[0];
    const fileName = `image_${Date.now()}.png`;
    const filePath = path.join(__dirname, 'images', fileName);

    const imageResponse = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'stream',
    });

    const writer = fs.createWriteStream(filePath);
    imageResponse.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    await message.reply({
      content: 'Generated image:',
      files: [filePath],
    });

  } catch (error) {
    console.error('Image generation error:', error);
    await message.reply(error.message || 'Failed to generate image');
  }
};

const handleCommand = async (message, args, commandName) => {
  if (message.author.id !== config.ownerId) return;

  try {
    const context = {
      aiEnabled,
      channelEnabled: channelEnabled[message.channel.id],
      channelSettings,
      channelId: message.channel.id,
      saveChannelSettings,
      simulateTyping,
      selectedApi,
      geminiModel,
      apiUsage,
      startTime,
      client,
      setSelectedApi: (api) => { selectedApi = api; },
      setGeminiModel: (model) => { geminiModel = model; },
    };

    if (commandName === 'imagine') {
      const prompt = args.join(' ');
      if (!prompt) return message.reply('Usage: !imagine <description>');
      return generateImage(prompt, message);
    }

    const command = commands[commandName];
    if (!command) return message.reply('Unknown command. Try !help');

    const result = await command.execute(args, message, context);
    
    if (commandName === 'ai') aiEnabled = result;
    else if (commandName === 'channel') channelEnabled[message.channel.id] = result;

  } catch (error) {
    console.error('Command error:', error);
    await message.reply('Command failed: ' + error.message);
  }
};

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.id === client.user.id) return;

  try {
    const prefix = config.prefix;
    const isCommand = message.content.startsWith(prefix);
    const isMention = message.mentions.users.has(client.user.id);
    const isReply = message.reference && (await message.fetchReference()).author.id === client.user.id;
    const channelId = message.channel.id;
    const respondToAll = channelSettings[channelId]?.respondToAll || false;

    if (isCommand) {
      const args = message.content.slice(prefix.length).trim().split(/ +/);
      const commandName = args.shift().toLowerCase();
      return handleCommand(message, args, commandName);
    }

    if (!aiEnabled || (channelId in channelEnabled && !channelEnabled[channelId])) return;
    if (!respondToAll && !isMention && !isReply) return;
    getRecentMessages(channelId, message.author.id, async (recentMessages) => {

      try {
        await simulateTyping(message.channel);
        const context = recentMessages.join('\n');
        const personality = knowledge.personality;
        const prompt = `${personality}\n${context}\nUser: ${message.content}\nBot:`;
        await simulateTyping(message.channel);
        const reply = await generateTextResponse(prompt);
        await message.reply(reply);
        storeMessage(channelId, message.author.id, `User: ${message.content}`);
        storeMessage(channelId, message.author.id, `Bot: ${reply}`);
      } catch (error) {
        console.error('Message processing error:', error);
        await message.reply('Bro i am busy say again.');
      }
    });

  } catch (error) {
    console.error('Message handling error:', error);
  }
});

client.login(config.token).catch(err => {
  console.error('Login failed:', err);
  process.exit(1);
});