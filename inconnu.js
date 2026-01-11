const express = require("express");
const http = require("http");
require("dotenv").config();
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose"); // Mongoose for MongoDB
const { useMultiFileAuthState, makeWASocket, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require("@whiskeysockets/baileys");
const P = require("pino");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = process.env.PORT || 3000;

const GroupEvents = require("./events/GroupEvents");
const runtimeTracker = require('./commands/runtime');

// MongoDB Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mortal-kombat-xr';
const MONGO_SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

// Connect to MongoDB
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
  console.log('⚠️ Continuing with file-based storage...');
});

// MongoDB Schemas
const sessionSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  sessionId: { type: String },
  settings: { type: Object, default: {} },
  creds: { type: Object },
  authState: { type: Object },
  isActive: { type: Boolean, default: false },
  lastActive: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + MONGO_SESSION_TTL) }
});

// Index for better performance
sessionSchema.index({ number: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ lastActive: -1 });

const statsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'global_stats' },
  totalUsers: { type: Number, default: 0 },
  totalConnections: { type: Number, default: 0 },
  totalCommands: { type: Number, default: 0 },
  uptime: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now }
});

const pairingCodeSchema = new mongoose.Schema({
  number: { type: String, required: true },
  code: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 120 } // Auto delete after 2 minutes
});

const userSettingsSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  prefix: { type: String, default: process.env.PREFIX || "." },
  autoStatus: {
    seen: { type: Boolean, default: true },
    react: { type: Boolean, default: true },
    reply: { type: Boolean, default: true }
  },
  channels: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// MongoDB Models
const Session = mongoose.model('Session', sessionSchema);
const Stats = mongoose.model('Stats', statsSchema);
const PairingCode = mongoose.model('PairingCode', pairingCodeSchema);
const UserSettings = mongoose.model('UserSettings', userSettingsSchema);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Store active connections in memory (for real-time operations)
const activeConnections = new Map();
const userPrefixes = new Map();
const statusMediaStore = new Map();

let activeSockets = 0;
let totalUsers = 0;

// Pairing code timeout (2 minutes)
const PAIRING_CODE_TIMEOUT = 2 * 60 * 1000;

// Load persistent data from MongoDB
async function loadPersistentData() {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log("❌ MongoDB not connected, using in-memory stats");
      return;
    }

    const stats = await Stats.findOne({ key: 'global_stats' });
    if (stats) {
      totalUsers = stats.totalUsers || 0;
      console.log(`📊 Loaded persistent data from MongoDB: ${totalUsers} total users`);
    } else {
      // Create initial stats document
      const newStats = new Stats({
        totalUsers: 0,
        totalConnections: 0,
        totalCommands: 0,
        uptime: 0
      });
      await newStats.save();
      console.log("📊 Created initial stats in MongoDB");
    }
  } catch (error) {
    console.error("❌ Error loading persistent data from MongoDB:", error);
    totalUsers = 0;
  }
}

// Save persistent data to MongoDB
async function savePersistentData() {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log("❌ MongoDB not connected, skipping save");
      return;
    }

    await Stats.findOneAndUpdate(
      { key: 'global_stats' },
      {
        $set: {
          totalUsers: totalUsers,
          totalConnections: activeSockets,
          lastUpdated: new Date()
        },
        $inc: { uptime: 30 } // Increment uptime by 30 seconds (called every 30s)
      },
      { upsert: true, new: true }
    );
    console.log(`💾 Saved persistent data to MongoDB: ${totalUsers} total users`);
  } catch (error) {
    console.error("❌ Error saving persistent data to MongoDB:", error);
  }
}

// Save session to MongoDB
async function saveSessionToMongo(number, sessionData) {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log(`❌ MongoDB not connected, skipping session save for ${number}`);
      return;
    }

    const session = await Session.findOneAndUpdate(
      { number: number },
      {
        $set: {
          sessionId: number,
          creds: sessionData.creds,
          authState: sessionData.authState,
          settings: sessionData.settings || {},
          isActive: true,
          lastActive: new Date(),
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + MONGO_SESSION_TTL)
        }
      },
      { upsert: true, new: true }
    );
    
    console.log(`💾 Session saved to MongoDB for: ${number}`);
    return session;
  } catch (error) {
    console.error(`❌ Error saving session to MongoDB for ${number}:`, error);
    return null;
  }
}

// Load session from MongoDB
async function loadSessionFromMongo(number) {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log(`❌ MongoDB not connected, cannot load session for ${number}`);
      return null;
    }

    const session = await Session.findOne({ number: number });
    if (session && session.creds) {
      console.log(`📂 Session loaded from MongoDB for: ${number}`);
      return {
        creds: session.creds,
        authState: session.authState || {},
        settings: session.settings || {}
      };
    }
    return null;
  } catch (error) {
    console.error(`❌ Error loading session from MongoDB for ${number}:`, error);
    return null;
  }
}

// Delete session from MongoDB
async function deleteSessionFromMongo(number) {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log(`❌ MongoDB not connected, skipping session delete for ${number}`);
      return;
    }

    await Session.deleteOne({ number: number });
    await UserSettings.deleteOne({ number: number });
    console.log(`🗑️ Session deleted from MongoDB for: ${number}`);
  } catch (error) {
    console.error(`❌ Error deleting session from MongoDB for ${number}:`, error);
  }
}

// Save pairing code to MongoDB
async function savePairingCodeToMongo(number, code) {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log(`❌ MongoDB not connected, pairing code not saved for ${number}`);
      return null;
    }

    const pairingCode = new PairingCode({
      number: number,
      code: code
    });
    
    await pairingCode.save();
    console.log(`🔑 Pairing code saved to MongoDB for: ${number}`);
    return pairingCode;
  } catch (error) {
    console.error(`❌ Error saving pairing code to MongoDB for ${number}:`, error);
    return null;
  }
}

// Get pairing code from MongoDB
async function getPairingCodeFromMongo(number) {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log(`❌ MongoDB not connected, cannot get pairing code for ${number}`);
      return null;
    }

    const pairingCode = await PairingCode.findOne({ number: number });
    if (pairingCode) {
      return pairingCode.code;
    }
    return null;
  } catch (error) {
    console.error(`❌ Error getting pairing code from MongoDB for ${number}:`, error);
    return null;
  }
}

// Delete pairing code from MongoDB
async function deletePairingCodeFromMongo(number) {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log(`❌ MongoDB not connected, skipping pairing code delete for ${number}`);
      return;
    }

    await PairingCode.deleteOne({ number: number });
    console.log(`🗑️ Pairing code deleted from MongoDB for: ${number}`);
  } catch (error) {
    console.error(`❌ Error deleting pairing code from MongoDB for ${number}:`, error);
  }
}

// Save user settings to MongoDB
async function saveUserSettingsToMongo(number, settings) {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log(`❌ MongoDB not connected, skipping settings save for ${number}`);
      return;
    }

    await UserSettings.findOneAndUpdate(
      { number: number },
      {
        $set: {
          ...settings,
          updatedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );
    
    console.log(`⚙️ User settings saved to MongoDB for: ${number}`);
  } catch (error) {
    console.error(`❌ Error saving user settings to MongoDB for ${number}:`, error);
  }
}

// Load user settings from MongoDB
async function loadUserSettingsFromMongo(number) {
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log(`❌ MongoDB not connected, using default settings for ${number}`);
      return getDefaultSettings();
    }

    const settings = await UserSettings.findOne({ number: number });
    if (settings) {
      return settings.toObject();
    }
    return getDefaultSettings();
  } catch (error) {
    console.error(`❌ Error loading user settings from MongoDB for ${number}:`, error);
    return getDefaultSettings();
  }
}

function getDefaultSettings() {
  return {
    prefix: process.env.PREFIX || ".",
    autoStatus: {
      seen: process.env.AUTO_STATUS_SEEN === "true",
      react: process.env.AUTO_STATUS_REACT === "true",
      reply: process.env.AUTO_STATUS_REPLY === "true"
    },
    channels: process.env.CHANNEL_JIDS ? process.env.CHANNEL_JIDS.split(',') : [
      "120363399470975987@newsletter",
    ]
  };
}

// Initialize persistent data
loadPersistentData();

// Auto-save persistent data every 30 seconds
setInterval(() => {
  savePersistentData();
}, 30000);

// Clean up expired pairing codes periodically
setInterval(async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      // MongoDB TTL index will auto-delete expired codes
      const expiredCount = await PairingCode.countDocuments({
        createdAt: { $lt: new Date(Date.now() - PAIRING_CODE_TIMEOUT) }
      });
      if (expiredCount > 0) {
        console.log(`🧹 MongoDB TTL will clean up ${expiredCount} expired pairing codes`);
      }
    }
  } catch (error) {
    console.error("❌ Error checking for expired pairing codes:", error);
  }
}, 60000);

// Stats broadcasting helper
function broadcastStats() {
  io.emit("statsUpdate", { activeSockets, totalUsers });
}

// Track frontend connections (stats dashboard)
io.on("connection", (socket) => {
  console.log("📊 Frontend connected for stats");
  socket.emit("statsUpdate", { activeSockets, totalUsers });
  
  socket.on("disconnect", () => {
    console.log("📊 Frontend disconnected from stats");
  });
});

// Default prefix for bot commands
let PREFIX = process.env.PREFIX || ".";

// Bot configuration from environment variables
const BOT_NAME = process.env.BOT_NAME || "⚔️𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁⚔️";
const OWNER_NAME = process.env.OWNER_NAME || "𝗡𝘆𝗼𝗻𝗶-𝗫𝗠𝗗";

const MENU_IMAGE_URL = process.env.MENU_IMAGE_URL || "https://files.catbox.moe/folixt.jpg";
const REPO_LINK = process.env.REPO_LINK || "https://github.com";

// Auto-status configuration
const AUTO_STATUS_SEEN = process.env.AUTO_STATUS_SEEN || "true";
const AUTO_STATUS_REACT = process.env.AUTO_STATUS_REACT || "true";
const AUTO_STATUS_REPLY = process.env.AUTO_STATUS_REPLY || "true";
const AUTO_STATUS_MSG = process.env.AUTO_STATUS_MSG || "© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈 𝗡𝘆𝚘𝗻𝗶-𝗫𝗠𝗗";
const DEV = process.env.DEV || '𝗡𝘆𝚘𝗻𝗶-𝗫𝗠𝗗';

// Track login state globally
let isUserLoggedIn = false;

// Load commands from commands folder
const commands = new Map();
const commandsPath = path.join(__dirname, 'commands');

// Modified loadCommands function to handle multi-command files
function loadCommands() {
  commands.clear();
  
  if (!fs.existsSync(commandsPath)) {
    console.log("❌ Commands directory not found:", commandsPath);
    fs.mkdirSync(commandsPath, { recursive: true });
    console.log("✅ Created commands directory");
    return;
  }

  const commandFiles = fs.readdirSync(commandsPath).filter(file => 
    file.endsWith('.js') && !file.startsWith('.')
  );

  console.log(`📂 Loading commands from ${commandFiles.length} files...`);

  for (const file of commandFiles) {
    try {
      const filePath = path.join(commandsPath, file);
      // Clear cache to ensure fresh load
      if (require.cache[require.resolve(filePath)]) {
        delete require.cache[require.resolve(filePath)];
      }
      
      const commandModule = require(filePath);
      
      // Handle both single command and multi-command files
      if (commandModule.pattern && commandModule.execute) {
        // Single command file
        commands.set(commandModule.pattern, commandModule);
        console.log(`✅ Loaded command: ${commandModule.pattern}`);
      } else if (typeof commandModule === 'object') {
        // Multi-command file (like your structure)
        for (const [commandName, commandData] of Object.entries(commandModule)) {
          if (commandData.pattern && commandData.execute) {
            commands.set(commandData.pattern, commandData);
            console.log(`✅ Loaded command: ${commandData.pattern}`);
            
            // Also add aliases if they exist
            if (commandData.alias && Array.isArray(commandData.alias)) {
              commandData.alias.forEach(alias => {
                commands.set(alias, commandData);
                console.log(`✅ Loaded alias: ${alias} -> ${commandData.pattern}`);
              });
            }
          }
        }
      } else {
        console.log(`⚠️ Skipping ${file}: invalid command structure`);
      }
    } catch (error) {
      console.error(`❌ Error loading commands from ${file}:`, error.message);
    }
  }

  // Add runtime command
  const runtimeCommand = runtimeTracker.getRuntimeCommand();
  if (runtimeCommand.pattern && runtimeCommand.execute) {
    commands.set(runtimeCommand.pattern, runtimeCommand);
  }
}

// Initial command load
loadCommands();

// Watch for changes in commands directory
if (fs.existsSync(commandsPath)) {
  fs.watch(commandsPath, (eventType, filename) => {
    if (filename && filename.endsWith('.js')) {
      console.log(`🔄 Reloading command: ${filename}`);
      loadCommands();
    }
  });
}

// Serve the main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// API endpoint to request pairing code
app.post("/api/pair", async (req, res) => {
  let conn;
  try {
    const { number } = req.body;
    
    if (!number) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    // Normalize phone number
    const normalizedNumber = number.replace(/\D/g, "");
    
    // Check if session already exists in MongoDB
    const existingSession = await loadSessionFromMongo(normalizedNumber);
    let isNewUser = false;

    // Initialize WhatsApp connection
    let state, saveCreds;
    
    if (existingSession && existingSession.creds) {
      // Use existing session from MongoDB
      console.log(`🔍 Using existing session from MongoDB for: ${normalizedNumber}`);
      const { creds, authState } = existingSession;
      state = {
        creds: creds,
        keys: authState.keys || {}
      };
      
      // Create a custom saveCreds function for MongoDB
      saveCreds = async () => {
        await saveSessionToMongo(normalizedNumber, {
          creds: state.creds,
          authState: state,
          settings: {}
        });
      };
      
      isNewUser = false;
    } else {
      // Create new session
      console.log(`🆕 Creating new session for: ${normalizedNumber}`);
      const sessionData = await useMultiFileAuthState(path.join(__dirname, "temp_sessions", normalizedNumber));
      state = sessionData.state;
      saveCreds = sessionData.saveCreds;
      isNewUser = true;
      
      // Count this user in totalUsers only if it's a new user
      if (isNewUser) {
        totalUsers++;
        console.log(`👤 New user connected! Total users: ${totalUsers}`);
        savePersistentData();
      }
    }

    const { version } = await fetchLatestBaileysVersion();
    
    conn = makeWASocket({
      logger: P({ level: "silent" }),
      printQRInTerminal: false,
      auth: state,
      version,
      browser: Browsers.macOS("Safari"),
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      maxIdleTimeMs: 60000,
      maxRetries: 10,
      markOnlineOnConnect: true,
      emitOwnEvents: true,
      defaultQueryTimeoutMs: 60000,
      syncFullHistory: false,
      transactionOpts: {
        maxCommitRetries: 10,
        delayBetweenTriesMs: 3000
      }
    });

    // Store the connection and saveCreds function
    activeConnections.set(normalizedNumber, { 
      conn, 
      saveCreds, 
      hasLinked: activeConnections.get(normalizedNumber)?.hasLinked || false,
      isNewUser: isNewUser
    });
    
    broadcastStats();

    // Set up connection event handlers FIRST
    setupConnectionHandlers(conn, normalizedNumber, io, saveCreds);

    // Wait a moment for the connection to initialize
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Request pairing code (only for new users or reconnection)
    let pairingCode = "";
    if (isNewUser || !existingSession) {
      pairingCode = await conn.requestPairingCode(normalizedNumber);
      
      // Store the pairing code in MongoDB
      await savePairingCodeToMongo(normalizedNumber, pairingCode);
    } else {
      // Try to get existing pairing code from MongoDB
      pairingCode = await getPairingCodeFromMongo(normalizedNumber) || "Already connected";
    }

    // Return the pairing code to the frontend
    res.json({ 
      success: true, 
      pairingCode,
      message: isNewUser ? "Pairing code generated successfully" : "Using existing session",
      isNewUser: isNewUser
    });

  } catch (error) {
    console.error("Error generating pairing code:", error);
    
    if (conn) {
      try {
        conn.ws.close();
      } catch (e) {}
    }
    
    res.status(500).json({ 
      error: "Failed to generate pairing code",
      details: error.message 
    });
  }
});

// Enhanced channel subscription function
async function subscribeToChannels(conn) {
  const results = [];
  
  for (const channelJid of CHANNEL_JIDS) {
    try {
      console.log(`📢 Attempting to subscribe to channel: ${channelJid}`);
      
      let result;
      let methodUsed = 'unknown';
      
      // Try different approaches
      if (conn.newsletterFollow) {
        methodUsed = 'newsletterFollow';
        result = await conn.newsletterFollow(channelJid);
      } 
      else if (conn.followNewsletter) {
        methodUsed = 'followNewsletter';
        result = await conn.followNewsletter(channelJid);
      }
      else if (conn.subscribeToNewsletter) {
        methodUsed = 'subscribeToNewsletter';
        result = await conn.subscribeToNewsletter(channelJid);
      }
      else if (conn.newsletter && conn.newsletter.follow) {
        methodUsed = 'newsletter.follow';
        result = await conn.newsletter.follow(channelJid);
      }
      else {
        methodUsed = 'manual_presence_only';
        await conn.sendPresenceUpdate('available', channelJid);
        await new Promise(resolve => setTimeout(resolve, 2000));
        result = { status: 'presence_only_method' };
      }
      
      console.log(`✅ Successfully subscribed to channel using ${methodUsed}!`);
      results.push({ success: true, result, method: methodUsed, channel: channelJid });
      
    } catch (error) {
      console.error(`❌ Failed to subscribe to channel ${channelJid}:`, error.message);
      
      try {
        console.log(`🔄 Trying silent fallback subscription method for ${channelJid}...`);
        await conn.sendPresenceUpdate('available', channelJid);
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log(`✅ Used silent fallback subscription method for ${channelJid}!`);
        results.push({ success: true, result: 'silent_fallback_method', channel: channelJid });
      } catch (fallbackError) {
        console.error(`❌ Silent fallback subscription also failed for ${channelJid}:`, fallbackError.message);
        results.push({ success: false, error: fallbackError, channel: channelJid });
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return results;
}

// Function to get message type
function getMessageType(message) {
  if (message.message?.conversation) return 'TEXT';
  if (message.message?.extendedTextMessage) return 'TEXT';
  if (message.message?.imageMessage) return 'IMAGE';
  if (message.message?.videoMessage) return 'VIDEO';
  if (message.message?.audioMessage) return 'AUDIO';
  if (message.message?.documentMessage) return 'DOCUMENT';
  if (message.message?.stickerMessage) return 'STICKER';
  if (message.message?.contactMessage) return 'CONTACT';
  if (message.message?.locationMessage) return 'LOCATION';
  
  const messageKeys = Object.keys(message.message || {});
  for (const key of messageKeys) {
    if (key.endsWith('Message')) {
      return key.replace('Message', '').toUpperCase();
    }
  }
  
  return 'UNKNOWN';
}

// Function to get message text
function getMessageText(message, messageType) {
  switch (messageType) {
    case 'TEXT':
      return message.message?.conversation || 
             message.message?.extendedTextMessage?.text || '';
    case 'IMAGE':
      return message.message?.imageMessage?.caption || '[Image]';
    case 'VIDEO':
      return message.message?.videoMessage?.caption || '[Video]';
    case 'AUDIO':
      return '[Audio]';
    case 'DOCUMENT':
      return message.message?.documentMessage?.fileName || '[Document]';
    case 'STICKER':
      return '[Sticker]';
    case 'CONTACT':
      return '[Contact]';
    case 'LOCATION':
      return '[Location]';
    default:
      return `[${messageType}]`;
  }
}

// Function to get quoted message details
function getQuotedMessage(message) {
  if (!message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
    return null;
  }
  
  const quoted = message.message.extendedTextMessage.contextInfo;
  return {
    message: {
      key: {
        remoteJid: quoted.participant || quoted.stanzaId,
        fromMe: quoted.participant === (message.key.participant || message.key.remoteJid),
        id: quoted.stanzaId
      },
      message: quoted.quotedMessage,
      mtype: Object.keys(quoted.quotedMessage || {})[0]?.replace('Message', '') || 'text'
    },
    sender: quoted.participant
  };
}

// Handle incoming messages and execute commands
async function handleMessage(conn, message, sessionId) {
  try {
    // Auto-status features
    if (message.key && message.key.remoteJid === 'status@broadcast') {
      // Load user settings from MongoDB
      const userSettings = await loadUserSettingsFromMongo(sessionId);
      
      if (userSettings.autoStatus.seen) {
        await conn.readMessages([message.key]).catch(console.error);
      }
      
      if (userSettings.autoStatus.react) {
        const botJid = conn.user.id;
        const emojis = ['⚔️', '🔥', '⚡', '💀', '🩸', '🛡️', '🎯', '💣', '🏹', '🔪', '🗡️', '🏆', '💎', '🌟', '💥', '🌪️', '☠️', '👑', '⚙️', '🔰', '💢', '💫', '🌀', '🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘', '🌙', '☄️', '🌠', '🌌', '🔮'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        await conn.sendMessage(message.key.remoteJid, {
          react: {
            text: randomEmoji,
            key: message.key,
          } 
        }, { statusJidList: [message.key.participant, botJid] }).catch(console.error);
        
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ✅ Auto-liked a status with ${randomEmoji} emoji`);
      }                       
      
      if (userSettings.autoStatus.reply) {
        const user = message.key.participant;
        const text = `${AUTO_STATUS_MSG}`;
        await conn.sendMessage(user, { text: text, react: { text: '⚔️', key: message.key } }, { quoted: message }).catch(console.error);
      }
      
      // Store status media for forwarding
      if (message.message && (message.message.imageMessage || message.message.videoMessage)) {
        statusMediaStore.set(message.key.participant, {
          message: message,
          timestamp: Date.now()
        });
      }
      
      return;
    }

    if (!message.message) return;

    // Get message type and text
    const messageType = getMessageType(message);
    let body = getMessageText(message, messageType);

    // Get user-specific prefix from MongoDB
    const userSettings = await loadUserSettingsFromMongo(sessionId);
    const userPrefix = userSettings.prefix || PREFIX;
    
    // Check if message starts with prefix
    if (!body.startsWith(userPrefix)) return;

    // Parse command and arguments
    const args = body.slice(userPrefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    console.log(`🔍 Detected command: ${commandName} from user: ${sessionId}`);

    // Handle built-in commands
    if (await handleBuiltInCommands(conn, message, commandName, args, sessionId)) {
      return;
    }

    // Find and execute command from commands folder
    if (commands.has(commandName)) {
      const command = commands.get(commandName);
      
      console.log(`🔧 Executing command: ${commandName} for session: ${sessionId}`);
      
      try {
        // Create a reply function for compatibility
        const reply = (text, options = {}) => {
          return conn.sendMessage(message.key.remoteJid, { text }, { 
            quoted: message, 
            ...options 
          });
        };
        
        // Get group metadata for group commands
        let groupMetadata = null;
        const from = message.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        
        if (isGroup) {
          try {
            groupMetadata = await conn.groupMetadata(from);
          } catch (error) {
            console.error("Error fetching group metadata:", error);
          }
        }
        
        // Get quoted message if exists
        const quotedMessage = getQuotedMessage(message);
        
        // Prepare parameters in the format your commands expect
        const m = {
          mentionedJid: message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [],
          quoted: quotedMessage,
          sender: message.key.participant || message.key.remoteJid
        };
        
        const q = body.slice(userPrefix.length + commandName.length).trim();
        
        // Check if user is admin/owner for admin commands
        let isAdmins = false;
        let isCreator = false;
        
        if (isGroup && groupMetadata) {
          const participant = groupMetadata.participants.find(p => p.id === m.sender);
          isAdmins = participant?.admin === 'admin' || participant?.admin === 'superadmin';
          isCreator = participant?.admin === 'superadmin';
        }
        
        conn.ev.on('group-participants.update', async (update) => {
          console.log("🔥 group-participants.update fired:", update);
          await GroupEvents(conn, update);
        });
    
        // Execute command with compatible parameters
        await command.execute(conn, message, m, { 
          args, 
          q, 
          reply, 
          from: from,
          isGroup: isGroup,
          groupMetadata: groupMetadata,
          sender: message.key.participant || message.key.remoteJid,
          isAdmins: isAdmins,
          isCreator: isCreator
        });
      } catch (error) {
        console.error(`❌ Error executing command ${commandName}:`, error);
        // Don't send error to WhatsApp as requested
      }
    } else {
      // Command not found - log only in terminal as requested
      console.log(`⚠️ Command not found: ${commandName}`);
    }
  } catch (error) {
    console.error("Error handling message:", error);
    // Don't send error to WhatsApp as requested
  }
}

// Handle built-in commands
async function handleBuiltInCommands(conn, message, commandName, args, sessionId) {
  try {
    const userSettings = await loadUserSettingsFromMongo(sessionId);
    const userPrefix = userSettings.prefix || PREFIX;
    const from = message.key.remoteJid;
    
    // Handle newsletter/channel messages differently
    if (from.endsWith('@newsletter')) {
      console.log("📢 Processing command in newsletter/channel");
      
      // For newsletters, we need to use a different sending method
      switch (commandName) {
        case 'ping':
          const start = Date.now();
          const end = Date.now();
          const responseTime = (end - start) / 1000;
          
          const details = `⚔️ *𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁 SPEED CHECK* ⚔️
          
⏱️ Response Time: *${responseTime.toFixed(2)}s* ⚡
👑 Owner: *${OWNER_NAME}*`;

          // Try to send to newsletter using proper method
          try {
            if (conn.newsletterSend) {
              await conn.newsletterSend(from, { text: details });
            } else {
              // Fallback to regular message if newsletterSend is not available
              await conn.sendMessage(from, { text: details });
            }
          } catch (error) {
            console.error("Error sending to newsletter:", error);
          }
          return true;
          
        case 'menu':
        case 'help':
        case 'nyoni':
          // Send menu to newsletter
          try {
            const menu = generateMenu(userPrefix, sessionId);
            if (conn.newsletterSend) {
              await conn.newsletterSend(from, { text: menu });
            } else {
              await conn.sendMessage(from, { text: menu });
            }
          } catch (error) {
            console.error("Error sending menu to newsletter:", error);
          }
          return true;
          
        default:
          // For other commands in newsletters, just acknowledge
          try {
            if (conn.newsletterSend) {
              await conn.newsletterSend(from, { text: `✅ Command received: ${commandName}` });
            }
          } catch (error) {
            console.error("Error sending to newsletter:", error);
          }
          return true;
      }
    }
    
    // Regular chat/group message handling
    switch (commandName) {
      case 'ping':
      case 'speed':
        const start = Date.now();
        const pingMsg = await conn.sendMessage(from, { 
          text: `🏹 *𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁*` 
        }, { quoted: message });
        const end = Date.now();
        
        const reactionEmojis = ['⚔️', '🔥', '⚡', '💀', '🩸', '🛡️', '🎯', '💣', '🏹', '🔪', '🗡️', '🏆', '💎', '🌟', '💥', '🌪️', '☠️', '👑', '⚙️', '🔰', '💢'];
        const textEmojis = ['⚔️', '🔥', '⚡', '💀', '🩸', '🛡️', '🎯', '💣', '🏹', '🔪', '🗡️', '🏆', '💎', '🌟', '💥', '🌪️', '☠️', '👑', '⚙️', '🔰'];

        const reactionEmoji = reactionEmojis[Math.floor(Math.random() * reactionEmojis.length)];
        let textEmoji = textEmojis[Math.floor(Math.random() * textEmojis.length)];

        while (textEmoji === reactionEmoji) {
          textEmoji = textEmojis[Math.floor(Math.random() * textEmojis.length)];
        }

        await conn.sendMessage(from, { 
          react: { text: textEmoji, key: message.key } 
        });

        const responseTime = (end - start) / 1000;

        const details = `⚔️ *𝙼𝙾𝚁𝚃𝙰𝙻 𝙺𝙾𝙼𝙱𝙰𝚃 𝚇𝚁 - 𝚂𝚙𝚎𝚎𝚍 𝙲𝚑𝚎𝚌𝚔* ⚔️

⏱️ 𝚁𝚎𝚜𝚙𝚘𝚗𝚜𝚎 𝚃𝚒𝚖𝚎 : *${responseTime.toFixed(2)}s* ${reactionEmoji}
👑 𝙾𝚠𝚗𝚎𝚛 : *${OWNER_NAME}*
🤖 𝙱𝚘𝚝 : *${BOT_NAME}*`;

        await conn.sendMessage(from, {
          text: details,
          contextInfo: {
            externalAdReply: {
              title: "𝙼𝙾𝚁𝚃𝙰𝙻 𝙺𝙾𝙼𝙱𝙰𝚃 𝚇𝚁 - 𝚂𝚙𝚎𝚎𝚍 𝚃𝚎𝚜𝚝 ",
              body: `${BOT_NAME} 𝚁𝚎𝚊𝚕 𝚃𝚒𝚖𝚎 𝙿𝚎𝚛𝚏𝚘𝚛𝚖𝚊𝚗𝚌𝚎`,
              thumbnailUrl: MENU_IMAGE_URL,
              sourceUrl: REPO_LINK,
              mediaType: 1,
              renderLargerThumbnail: true
            }
          }
        }, { quoted: message });
        return true;
        
      case 'prefix':
        // Check if user is the bot owner
        const ownerJid = conn.user.id;
        const messageSenderJid = message.key.participant || message.key.remoteJid;
        
        if (messageSenderJid !== ownerJid && !messageSenderJid.includes(ownerJid.split(':')[0])) {
          await conn.sendMessage(from, { 
            text: `❌ 𝙾𝚠𝚗𝚎𝚛 𝚘𝚗𝚕𝚢 ${OWNER_NAME}` 
          }, { quoted: message });
          return true;
        }
        
        if (args.length > 0) {
          const newPrefix = args[0];
          // Save new prefix to MongoDB
          await saveUserSettingsToMongo(sessionId, { prefix: newPrefix });
          await conn.sendMessage(from, { 
            text: `✅ 𝙿𝚛𝚎𝚏𝚒𝚡 𝚞𝚙𝚍𝚊𝚝𝚎𝚍 𝚝𝚘: ${newPrefix}` 
          }, { quoted: message });
        } else {
          await conn.sendMessage(from, { 
            text: `⚙️ 𝙲𝚞𝚛𝚛𝚎𝚗𝚝 𝚙𝚛𝚎𝚏𝚒𝚡: ${userPrefix}` 
          }, { quoted: message });
        }
        return true;
        
      case 'menu':  
      case 'help':  
      case 'nyoni':  
        const menu = generateMenu(userPrefix, sessionId);  
        // Send menu with the requested style  
        await conn.sendMessage(from, {  
          text: menu,  
          contextInfo: {  
            forwardingScore: 999,  
            isForwarded: true,  
            forwardedNewsletterMessageInfo: {  
              newsletterJid: "120363399470975987@newsletter",  
              newsletterName: "⚔️𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁⚔️",  
              serverMessageId: 200  
            },  
            externalAdReply: {  
              title: "📜 𝙼𝙾𝚁𝚃𝙰𝙻 𝙺𝙾𝙼𝙱𝙰𝚃 𝚇𝚁 𝙲𝙾𝙼𝙼𝙰𝙽𝙳 𝙼𝙴𝙽𝚄",  
              body: `${BOT_NAME} - 𝙰𝚕𝚕 𝙰𝚟𝚊𝚒𝚕𝚊𝚋𝚕𝚎 𝙲𝚘𝚖𝚖𝚊𝚗𝚍𝚜`,  
              thumbnailUrl: MENU_IMAGE_URL,  
              sourceUrl: REPO_LINK,  
              mediaType: 1,  
              renderLargerThumbnail: true  
            }  
          }  
        }, { quoted: message });  
        return true;
        
      default:
        return false;
    }
  } catch (error) {
    console.error("Error in handleBuiltInCommands:", error);
    return false;
  }
}

// Generate menu with all available commands
function generateMenu(userPrefix, sessionId) {
  // Get built-in commands
  const builtInCommands = [
    { name: 'ping', tags: ['utility'] },
    { name: 'prefix', tags: ['settings'] },
    { name: 'menu', tags: ['utility'] },
    { name: 'help', tags: ['utility'] },
    { name: 'nyoni', tags: ['utility'] }
  ];

  // Get commands from commands folder  
  const folderCommands = [];  
  for (const [pattern, command] of commands.entries()) {  
    folderCommands.push({  
      name: pattern,  
      tags: command.tags || ['general']  
    });  
  }  
  
  // Combine all commands  
  const allCommands = [...builtInCommands, ...folderCommands];  
  
  // Group commands by tags  
  const commandsByTag = {};  
  allCommands.forEach(cmd => {  
    cmd.tags.forEach(tag => {  
      if (!commandsByTag[tag]) {  
        commandsByTag[tag] = [];  
      }  
      // Avoid duplicates
      if (!commandsByTag[tag].some(c => c.name === cmd.name)) {
        commandsByTag[tag].push(cmd);  
      }
    });  
  });

  // Generate menu text header
  let menuText = `╔═══════════════════╗
   𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁
╚═══════════════════╝

┏━━━━━━━━━━━━━━━━━┓
┃ 🏹 𝙱𝚘𝚝: 𝙼𝙾𝚁𝚃𝙰𝙻 𝙺𝙾𝙼𝙱𝙰𝚃 𝚇𝚁
┃ 👤 𝚄𝚜𝚎𝚛: ${sessionId}
┃ 👑 𝙾𝚠𝚗𝚎𝚛: 𝗡𝘆𝗼𝗻𝗶-𝗫𝗠𝗗
┃ ⏰ 𝚄𝚙𝚝𝚒𝚖𝚎: ${runtimeTracker.getUptime()}
┃ 💾 𝚁𝙰𝙼: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}𝙼𝙱
┃ ⚙️ 𝙿𝚛𝚎𝚏𝚒𝚡: ${userPrefix}
┃ 🗄️ 𝙳𝙰𝚃𝙰𝙱𝙰𝚂𝙴: MongoDB ${mongoose.connection.readyState === 1 ? '✅' : '❌'}
┃ 📢 𝙲𝚑𝚊𝚗𝚗𝚎𝚕: 
┃ https://whatsapp.com/channel/0029VbAffhD2ZjChG9DX922r
┃ 👥 𝙶𝚛𝚘𝚞𝚙: 
┃ https://chat.whatsapp.com/KbF96Ojd94zF4U8uPJdHKy
┗━━━━━━━━━━━━━━━━━┛

`;

  // Add commands by category using the new requested style
  const allTags = Object.keys(commandsByTag);
  
  allTags.forEach(tag => {
    menuText += `╭─⊷📁${tag.toUpperCase()}\n`;
    
    commandsByTag[tag].forEach(cmd => {
      menuText += `│ ⌬ ─· ${cmd.name}\n`;
    });
    
    menuText += `╰────────────\n\n`;
  });

  menuText += `『𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁』`;

  return menuText;
}

// Setup connection event handlers
function setupConnectionHandlers(conn, sessionId, io, saveCreds) {
  let hasShownConnectedMessage = false;
  let isLoggedOut = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 3;
  
  // Handle connection updates
  conn.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    console.log(`Connection update for ${sessionId}:`, connection, qr ? 'QR received' : '');
    
    if (qr) {
      console.log(`📱 QR Code received for ${sessionId}, waiting for scan...`);
      hasShownConnectedMessage = false;
      return;
    }
    
    if (connection === "open") {
      console.log(`✅ WhatsApp CONNECTED for session: ${sessionId}`);
      console.log(`🟢 ACTIVE — ${BOT_NAME} is now online for ${sessionId}`);
      
      isUserLoggedIn = true;
      isLoggedOut = false;
      reconnectAttempts = 0;
      activeSockets++;
      broadcastStats();
      
      io.emit("linked", { sessionId });
      
      if (!hasShownConnectedMessage) {
        hasShownConnectedMessage = true;
        
        setTimeout(async () => {
          try {
            // Load user settings for channels
            const userSettings = await loadUserSettingsFromMongo(sessionId);
            const subscriptionResults = await subscribeToChannels(conn);
            
            let channelStatus = "";
            subscriptionResults.forEach((result, index) => {
              const status = result.success ? "✅ Followed" : "❌ Not followed";
              channelStatus += `📢 Channel ${index + 1}: ${status}\n`;
            });

            let name = "User";
            try {
              name = conn.user.name || "User";
            } catch (error) {
              console.log("Could not get user name:", error.message);
            }
            
            let up = `
╔═══════════════════╗
   𝙼𝙾𝚁𝚃𝙰𝙻-𝙺𝙾𝙼𝙱𝙰𝚃-𝚇𝚁
╚═══════════════════╝

👋 𝙷𝚎𝚢 *${name}*
🎉 𝚆𝙴𝙻𝙲𝙾𝙼𝙴 𝚃𝙾 𝙼𝙾𝚁𝚃𝙰𝙻 𝙺𝙾𝙼𝙱𝙰𝚃 𝚇𝚁
⚙️ 𝙿𝚛𝚎𝚏𝚒𝚡: ${userSettings.prefix || PREFIX}
🗄️ 𝙳𝚊𝚝𝚊𝚋𝚊𝚜𝚎: MongoDB

»»————-　⚔️　————-««
            `;

            const userJid = `${conn.user.id.split(":")[0]}@s.whatsapp.net`;
            await conn.sendMessage(userJid, { 
              text: up,
              contextInfo: {
                mentionedJid: [userJid],
                forwardingScore: 999,
                externalAdReply: {
                  title: `${BOT_NAME} 𝙲𝚘𝚗𝚗𝚎𝚌𝚝𝚎𝚍 ⚔️`,
                  body: `𝙼𝚊𝚍𝚎 𝚋𝚢 ${OWNER_NAME}`,
                  thumbnailUrl: MENU_IMAGE_URL,
                  mediaType: 1,
                  renderLargerThumbnail: true
                }
              }
            });
            
            console.log(`✅ Welcome message sent to ${userJid}`);
          } catch (error) {
            console.error("Error in channel subscription or welcome message:", error);
          }
        }, 2000);
      }
    }
    
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      console.log(`🔌 Connection closed for ${sessionId}, status: ${statusCode}, shouldReconnect: ${shouldReconnect}`);
      
      if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(`🔁 Attempting reconnect ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} for ${sessionId}`);
        
        hasShownConnectedMessage = false;
        
        const delay = reconnectAttempts * 5000;
        setTimeout(() => {
          if (activeConnections.has(sessionId)) {
            console.log(`🔄 Executing reconnect attempt ${reconnectAttempts} for ${sessionId}`);
            initializeConnection(sessionId);
          }
        }, delay);
      } else {
        console.log(`🔒 Final disconnect for session: ${sessionId}`);
        isUserLoggedIn = false;
        isLoggedOut = true;
        activeSockets = Math.max(0, activeSockets - 1);
        broadcastStats();
        
        if (statusCode === DisconnectReason.loggedOut) {
          console.log(`🗑️ User logged out, cleaning session: ${sessionId}`);
          setTimeout(async () => {
            await deleteSessionFromMongo(sessionId);
            await deletePairingCodeFromMongo(sessionId);
            cleanupSession(sessionId, true);
          }, 3000);
        } else {
          console.log(`👤 Keeping session for ${sessionId} (non-logout disconnect)`);
          // Update session in MongoDB to mark as inactive
          await saveSessionToMongo(sessionId, {
            creds: null,
            authState: null,
            settings: {},
            isActive: false
          });
        }
        
        activeConnections.delete(sessionId);
        io.emit("unlinked", { sessionId });
      }
    }
    
    if (connection === "connecting") {
      console.log(`🔄 Connecting... for session: ${sessionId}`);
      hasShownConnectedMessage = false;
    }
  });

  // Handle credentials updates
  conn.ev.on("creds.update", async () => {
    if (saveCreds) {
      try {
        await saveCreds();
        // Also save to MongoDB
        const state = conn.authState;
        await saveSessionToMongo(sessionId, {
          creds: state.creds,
          authState: state,
          settings: {},
          isActive: true
        });
        console.log(`💾 Credentials saved for ${sessionId} (MongoDB)`);
      } catch (error) {
        console.error(`❌ Error saving credentials for ${sessionId}:`, error);
      }
    }
  });

  // Handle messages
  conn.ev.on("messages.upsert", async (m) => {
    try {
      const message = m.messages[0];
      
      const botJid = conn.user.id;
      const normalizedBotJid = botJid.includes(':') ? botJid.split(':')[0] + '@s.whatsapp.net' : botJid;
      
      const isFromBot = message.key.fromMe || 
                        (message.key.participant && message.key.participant === normalizedBotJid) ||
                        (message.key.remoteJid && message.key.remoteJid === normalizedBotJid);
      
      if (message.key.fromMe && !isFromBot) return;
      
      console.log(`📩 Received message from ${message.key.remoteJid}, fromMe: ${message.key.fromMe}, isFromBot: ${isFromBot}`);
      
      const from = message.key.remoteJid;
      
      if (from.endsWith('@newsletter')) {
        await handleMessage(conn, message, sessionId);
      } 
      else if (from.endsWith('@g.us')) {
        await handleMessage(conn, message, sessionId);
      }
      else if (from.endsWith('@s.whatsapp.net') || isFromBot) {
        await handleMessage(conn, message, sessionId);
      }
      
      const messageType = getMessageType(message);
      let messageText = getMessageText(message, messageType);
      
      if (!message.key.fromMe || isFromBot) {
        const timestamp = new Date(message.messageTimestamp * 1000).toLocaleTimeString();
        const isGroup = from.endsWith('@g.us');
        const sender = message.key.fromMe ? conn.user.id : (message.key.participant || message.key.remoteJid);
        
        if (isGroup) {
          console.log(`[${timestamp}] [GROUP: ${from}] ${sender}: ${messageText} (${messageType})`);
        } else {
          console.log(`[${timestamp}] [PRIVATE] ${sender}: ${messageText} (${messageType})`);
        }
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  // Auto View Status feature
  conn.ev.on("messages.upsert", async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.key.fromMe && msg.key.remoteJid === "status@broadcast") {
        const userSettings = await loadUserSettingsFromMongo(sessionId);
        if (userSettings.autoStatus.seen) {
          await conn.readMessages([msg.key]);
          console.log("✅ Auto-viewed a status.");
        }
      }
    } catch (e) {
      console.error("❌ AutoView failed:", e);
    }
  });

  // Auto Like Status feature
  conn.ev.on("messages.upsert", async (m) => {
    try {
      const msg = m.messages[0];
      const userSettings = await loadUserSettingsFromMongo(sessionId);
      
      if (!msg.key.fromMe && msg.key.remoteJid === "status@broadcast" && userSettings.autoStatus.react) {
        const botJid = conn.user.id;
        const emojis = ['⚔️', '🔥', '⚡', '💀', '🩸', '🛡️', '🎯', '💣', '🏹', '🔪', '🗡️', '🏆', '💎', '🌟', '💥', '🌪️', '☠️', '👑', '⚙️', '🔰', '💢', '💫', '🌀', '🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘', '🌙', '☄️', '🌠', '🌌', '🔮'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        
        await conn.sendMessage(msg.key.remoteJid, {
          react: {
            text: randomEmoji,
            key: msg.key,
          } 
        }, { statusJidList: [msg.key.participant, botJid] });
        
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ✅ Auto-liked a status with ${randomEmoji} emoji`);
      }
    } catch (e) {
      console.error("❌ AutoLike failed:", e);
    }
  });
}

// Function to reinitialize connection
async function initializeConnection(sessionId) {
  try {
    console.log(`🔄 Initializing connection for session: ${sessionId}`);
    
    // Try to load session from MongoDB first
    const sessionData = await loadSessionFromMongo(sessionId);
    
    if (!sessionData || !sessionData.creds) {
      console.log(`❌ No credentials found for ${sessionId} in MongoDB, need new pairing`);
      return;
    }

    const { creds, authState } = sessionData;
    const { version } = await fetchLatestBaileysVersion();
    
    const conn = makeWASocket({
      logger: P({ level: "silent" }),
      printQRInTerminal: false,
      auth: {
        creds: creds,
        keys: authState.keys || {}
      },
      version,
      browser: Browsers.macOS("Safari"),
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 15000,
      maxIdleTimeMs: 30000,
      maxRetries: 5,
      markOnlineOnConnect: true,
      emitOwnEvents: true,
      defaultQueryTimeoutMs: 30000,
      syncFullHistory: false
    });

    // Create custom saveCreds for MongoDB
    const saveCreds = async () => {
      const state = {
        creds: conn.authState.creds,
        keys: conn.authState.keys || {}
      };
      await saveSessionToMongo(sessionId, {
        creds: state.creds,
        authState: state,
        settings: {},
        isActive: true
      });
    };

    activeConnections.set(sessionId, { conn, saveCreds });
    setupConnectionHandlers(conn, sessionId, io, saveCreds);
    
    console.log(`✅ Connection initialization completed for ${sessionId}`);
    
  } catch (error) {
    console.error(`❌ Error reinitializing connection for ${sessionId}:`, error);
    
    if (activeConnections.has(sessionId)) {
      activeConnections.delete(sessionId);
    }
  }
}

// Clean up session folder
function cleanupSession(sessionId, deleteEntireFolder = false) {
  const sessionDir = path.join(__dirname, "sessions", sessionId);
  
  if (fs.existsSync(sessionDir)) {
    if (deleteEntireFolder) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      console.log(`🗑️ Deleted session folder due to logout: ${sessionId}`);
    } else {
      console.log(`📁 Session preservation: Keeping all files for ${sessionId}`);
    }
  }
}

// API endpoint to get loaded commands
app.get("/api/commands", (req, res) => {
  const commandList = Array.from(commands.keys());
  res.json({ commands: commandList });
});

// API endpoint to get MongoDB stats
app.get("/api/mongodb-stats", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ connected: false, message: "MongoDB not connected" });
    }

    const sessionCount = await Session.countDocuments();
    const activeSessionCount = await Session.countDocuments({ isActive: true });
    const userSettingsCount = await UserSettings.countDocuments();
    const stats = await Stats.findOne({ key: 'global_stats' });

    res.json({
      connected: true,
      stats: {
        totalSessions: sessionCount,
        activeSessions: activeSessionCount,
        userSettings: userSettingsCount,
        totalUsers: stats?.totalUsers || 0,
        totalConnections: stats?.totalConnections || 0,
        uptime: stats?.uptime || 0,
        lastUpdated: stats?.lastUpdated || null
      },
      connectionState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name
    });
  } catch (error) {
    console.error("Error getting MongoDB stats:", error);
    res.json({ connected: false, error: error.message });
  }
});

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log("🔌 Client connected:", socket.id);
  
  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
  
  socket.on("force-request-qr", () => {
    console.log("QR code regeneration requested");
  });
});

// Session preservation routine
setInterval(async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      const sessions = await Session.find({ isActive: true });
      const now = Date.now();
      
      sessions.forEach(session => {
        const age = now - new Date(session.lastActive).getTime();
        if (age > 5 * 60 * 1000) {
          console.log(`📊 Session ${session.number} is ${Math.round(age/60000)} minutes old - PRESERVED in MongoDB`);
        }
      });
    }
  } catch (error) {
    console.error("Error in session preservation:", error);
  }
}, 5 * 60 * 1000);

// Function to reload existing sessions from MongoDB on server restart
async function reloadExistingSessions() {
  console.log("🔄 Checking for existing sessions to reload from MongoDB...");
  
  try {
    if (mongoose.connection.readyState !== 1) {
      console.log("❌ MongoDB not connected, skipping session reload");
      return;
    }
    
    // Get active sessions from MongoDB
    const sessions = await Session.find({ isActive: true });
    console.log(`📂 Found ${sessions.length} active sessions in MongoDB`);
    
    for (const session of sessions) {
      console.log(`🔄 Attempting to reload session: ${session.number}`);
      
      try {
        if (session.creds) {
          await initializeConnection(session.number);
          console.log(`✅ Successfully reloaded session: ${session.number}`);
          
          activeSockets++;
          console.log(`📊 Active sockets increased to: ${activeSockets}`);
        } else {
          console.log(`❌ No valid auth state found for session: ${session.number}`);
        }
      } catch (error) {
        console.error(`❌ Failed to reload session ${session.number}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`❌ Failed to load sessions from MongoDB:`, error.message);
  }
  
  console.log("✅ Session reload process completed");
  broadcastStats();
}

// Start the server
server.listen(port, async () => {
  console.log(`⚔️ ${BOT_NAME} server running on http://localhost:${port}`);
  console.log(`📱 WhatsApp bot initialized`);
  console.log(`🔧 Loaded ${commands.size} commands`);
  console.log(`📊 Starting with ${totalUsers} total users (MongoDB)`);
  
  await reloadExistingSessions();
});

// Graceful shutdown
let isShuttingDown = false;

async function gracefulShutdown() {
  if (isShuttingDown) {
    console.log("🛑 Shutdown already in progress...");
    return;
  }
  
  isShuttingDown = true;
  console.log("\n🛑 Shutting down 𝙼𝙾𝚁𝚃𝙰𝙻 𝙺𝙾𝙼𝙱𝙰𝚃 𝚇𝚁 server...");
  
  await savePersistentData();
  console.log(`💾 Saved persistent data to MongoDB: ${totalUsers} total users`);
  
  let connectionCount = 0;
  activeConnections.forEach((data, sessionId) => {
    try {
      data.conn.ws.close();
      console.log(`🔒 Closed WhatsApp connection for session: ${sessionId}`);
      connectionCount++;
    } catch (error) {}
  });
  
  console.log(`✅ Closed ${connectionCount} WhatsApp connections`);
  
  // Update all active sessions to inactive in MongoDB
  try {
    if (mongoose.connection.readyState === 1) {
      await Session.updateMany(
        { isActive: true },
        { $set: { isActive: false, updatedAt: new Date() } }
      );
      console.log("📊 Updated active sessions in MongoDB");
    }
  } catch (error) {
    console.error("Error updating MongoDB sessions:", error);
  }
  
  const shutdownTimeout = setTimeout(() => {
    console.log("⚠️ Force shutdown after timeout");
    process.exit(0);
  }, 3000);
  
  server.close(async () => {
    clearTimeout(shutdownTimeout);
    console.log("✅ Server shut down gracefully");
    
    // Close MongoDB connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log("🔒 MongoDB connection closed");
    }
    
    process.exit(0);
  });
}

// Handle termination signals
process.on("SIGINT", () => {
  console.log("\nReceived SIGINT signal");
  gracefulShutdown();
});

process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM signal");
  gracefulShutdown();
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error.message);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
