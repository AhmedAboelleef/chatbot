const fs = require('fs');
const axios = require('axios');

module.exports = {
  ai: {
    execute: (args, message, { aiEnabled }) => {
      if (args[0] === 'on') {
        message.channel.send('AI responses enabled globally.');
        return true;
      } else if (args[0] === 'off') {
        message.channel.send('AI responses disabled globally.');
        return false;
      } else {
        message.channel.send('Usage: !ai on/off');
        return aiEnabled;
      }
    },
  },

  channel: {
    execute: (args, message, { channelEnabled }) => {
      if (args[0] === 'on') {
        message.channel.send('AI responses enabled in this channel.');
        return true;
      } else if (args[0] === 'off') {
        message.channel.send('AI responses disabled in this channel.');
        return false;
      } else {
        message.channel.send('Usage: !channel on/off');
        return channelEnabled !== undefined ? channelEnabled : true;
      }
    },
  },

  respondtoall: {
    execute: (args, message, { channelSettings, channelId, saveChannelSettings }) => {
      const respondToAll = channelSettings[channelId]?.respondToAll || false;
      if (args[0] === 'on') {
        message.channel.send('Responding to all messages in this channel.');
        channelSettings[channelId] = { respondToAll: true };
        saveChannelSettings();
        return true;
      } else if (args[0] === 'off') {
        message.channel.send('Responding only to mentions or replies in this channel.');
        channelSettings[channelId] = { respondToAll: false };
        saveChannelSettings();
        return false;
      } else {
        message.channel.send('Usage: !respondtoall on/off');
        return respondToAll;
      }
    },
  },

  api: {
    execute: (args, message, { setSelectedApi }) => {
      const api = args[0]?.toLowerCase();
      if (['groq', 'gemini', 'shapes'].includes(api)) {
        setSelectedApi(api);
        message.channel.send(`API switched to: ${api}`);
        return api;
      } else {
        message.channel.send('Usage: !api groq/gemini/shapes');
        return null;
      }
    },
  },

  gemini: {
    execute: (args, message, { setGeminiModel }) => {
      const model = args[0];
      if (model) {
        setGeminiModel(model);
        message.channel.send(`Gemini model set to: ${model}`);
        return model;
      } else {
        message.channel.send('Usage: !gemini <model_name>');
        return null;
      }
    },
  },

  joke: {
    execute: async (args, message) => {
      try {
        const response = await axios.get('https://official-joke-api.appspot.com/random_joke');
        const { setup, punchline } = response.data;
        message.channel.send(`${setup}\n${punchline}`);
      } catch (error) {
        console.error('Joke API error:', error.message);
        message.channel.send('Error fetching joke. Try again later.');
      }
    },
  },

  meme: {
    execute: async (args, message) => {
      try {
        const response = await axios.get('https://meme-api.com/gimme');
        const { url, title } = response.data;
        message.channel.send(`${title || 'Here\'s a meme!'}\n${url}`);
      } catch (error) {
        console.error('Meme API error:', error.message);
        message.channel.send('Error fetching meme. Try again later.');
      }
    },
  },

  ping: {
    execute: async (args, message, { client }) => {
      const sent = await message.channel.send('Pinging...');
      const latency = sent.createdTimestamp - message.createdTimestamp;
      const wsPing = client.ws.ping;
      sent.edit(`Pong! Latency: ${latency}ms, WebSocket: ${wsPing}ms`);
    },
  },

  stats: {
    execute: (args, message, { apiUsage, startTime }) => {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`;
      
      const stats = [
        `**Bot Stats**`,
        `Uptime: ${uptimeStr}`,
        `API Usage:`,
        `- Groq: ${apiUsage.groq.calls} calls, ${apiUsage.groq.tokens} tokens`,
        `- Shapes: ${apiUsage.shapes.calls} calls, ${apiUsage.shapes.tokens} tokens`,
        `- Gemini: ${apiUsage.gemini.calls} calls, ${apiUsage.gemini.tokens} tokens`,
      ];
      
      message.channel.send(stats.join('\n'));
    },
  },

  avatar: {
    execute: async (args, message, { client }) => {
      const user = message.mentions.users.first() || client.users.cache.get(args[0]) || message.author;
      const avatarUrl = user.avatarURL({ dynamic: true, size: 4096 });
      
      if (!avatarUrl) {
        message.channel.send(`${user.tag} has no avatar.`);
        return;
      }
      
      message.channel.send(`${user.tag}'s avatar:\n${avatarUrl}`);
    },
  },

  servericon: {
    execute: async (args, message) => {
      if (!message.guild) {
        message.channel.send('This command can only be used in a server.');
        return;
      }
      
      const iconUrl = message.guild.iconURL({ dynamic: true, size: 4096 });
      
      if (!iconUrl) {
        message.channel.send('This server has no icon.');
        return;
      }
      
      message.channel.send(`${message.guild.name}'s icon:\n${iconUrl}`);
    },
  },

  spam: {
    execute: async (args, message) => {
      const amount = parseInt(args[0]);
      const spamMessage = args.slice(1).join(' ');
      
      if (isNaN(amount) || amount < 1 || amount > 10) {
        message.channel.send('Usage: !spam <amount (1-10)> <message>');
        return;
      }
      
      if (!spamMessage) {
        message.channel.send('Please provide a message to spam.');
        return;
      }
      
      try {
        for (let i = 0; i < amount; i++) {
          await message.channel.send(spamMessage);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error('Spam command error:', error.message);
        message.channel.send('Error spamming messages. Rate limit or permission issue.');
      }
    },
  },

  clear: {
    execute: async (args, message, { client }) => {
      const amount = parseInt(args[0]);
      
      if (isNaN(amount) || amount < 1 || amount > 100) {
        message.channel.send('Usage: !clear <amount (1-100)>');
        return;
      }
      
      try {
        const fetchedMessages = await message.channel.messages.fetch({ limit: 100 });
        const botMessages = fetchedMessages.filter(msg => msg.author.id === client.user.id).first(amount);
        
        if (botMessages.length === 0) {
          message.channel.send('No messages from me to clear.');
          return;
        }
        
        for (const msg of botMessages) {
          await msg.delete();
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        message.channel.send(`Cleared ${botMessages.length} of my messages.`);
      } catch (error) {
        console.error('Clear command error:', error.message);
        message.channel.send('Error clearing my messages. Possible rate limit or permission issue.');
      }
    },
  },

  help: {
    execute: (args, message) => {
      const helpText = [
        "```js",
        "**Available Commands:**",
        "**AI Control:**",
        "!ai on/off - Toggle AI responses globally",
        "!channel on/off - Toggle AI in current channel",
        "!respondtoall on/off - Respond to all messages in channel",
        "",
        "**API Settings:**",
        "!api groq/gemini/shapes - Switch AI provider",
        "!gemini <model> - Change Gemini model",
        "",
        "**Fun Commands:**",
        "!joke - Get a random joke",
        "!meme - Get a random meme",
        "",
        "**Utility:**",
        "!ping - Check bot latency",
        "!stats - Show bot statistics",
        "!avatar [@user] - Get user avatar",
        "!servericon - Get server icon",
        "",
        "**Moderation:**",
        "!spam <1-10> <msg> - Spam messages",
        "!clear <1-100> - Delete my messages",
        "",
        "Type !help <command> for more info on a specific command.",
        "```"
      ].join("\n");
      
      message.channel.send(helpText);
    },
  }
};