// === groupevents.js ===
const { isJidGroup } = require('@whiskeysockets/baileys');

const defaultProfilePics = [
  'https://files.catbox.moe/1oq196.jpg',
  'https://files.catbox.moe/1oq196.jpg',
  'https://files.catbox.moe/1oq196.jpg',
];

// Store violation counts per user per group
const violationCounts = new Map();

// Newsletter context (for forwarded-style look)
const getContextInfo = (mentionedJids) => ({
  mentionedJid: mentionedJids,
  forwardingScore: 999,
  isForwarded: true,
  forwardedNewsletterMessageInfo: {
    newsletterJid: '120363282833839832@newsletter',
    newsletterName: "ꜱᴀɴɴᴜ ᴍᴅ ᴍɪɴɪ",
    serverMessageId: 200,
  },
});

// Fonction Antilink
const antiLinkHandler = async (conn, m, groupId) => {
  try {
    const message = m.message;
    if (!message) return;

    // Detect links in different message types
    let detectedLink = null;

    // Check message text
    if (message.conversation && /https?:\/\/[^\s]+/gi.test(message.conversation)) {
      detectedLink = message.conversation.match(/https?:\/\/[^\s]+/gi)[0];
    }
    
    // Check extended text messages
    if (message.extendedTextMessage?.text && /https?:\/\/[^\s]+/gi.test(message.extendedTextMessage.text)) {
      detectedLink = message.extendedTextMessage.text.match(/https?:\/\/[^\s]+/gi)[0];
    }

    // Check image captions
    if (message.imageMessage?.caption && /https?:\/\/[^\s]+/gi.test(message.imageMessage.caption)) {
      detectedLink = message.imageMessage.caption.match(/https?:\/\/[^\s]+/gi)[0];
    }

    // Check video captions
    if (message.videoMessage?.caption && /https?:\/\/[^\s]+/gi.test(message.videoMessage.caption)) {
      detectedLink = message.videoMessage.caption.match(/https?:\/\/[^\s]+/gi)[0];
    }

    if (detectedLink) {
      const sender = m.key.participant || m.key.remoteJid;
      const user = sender.split('@')[0];
      
      // Initialize violation count for user in this group
      const userKey = `${groupId}_${sender}`;
      const currentViolations = violationCounts.get(userKey) || 0;
      const newViolations = currentViolations + 1;
      violationCounts.set(userKey, newViolations);
      
      // Delete the message containing the link
      await conn.sendMessage(groupId, {
        delete: {
          id: m.key.id,
          participant: sender,
          remoteJid: groupId,
          fromMe: false
        }
      });

      // Warning message based on violation count
      let warningMsg = '';
      let shouldKick = false;

      if (newViolations >= 3) {
        warningMsg = `🚫 *FINAL WARNING - USER KICKED*\n\n@${user} has been removed from the group for sharing links 3 times.\nViolations: ${newViolations}/3`;
        shouldKick = true;
      } else if (newViolations === 2) {
        warningMsg = `⚠️ *SECOND WARNING*\n\n@${user} - Link detected!\nViolations: ${newViolations}/3\nNext violation will result in removal from group.`;
      } else {
        warningMsg = `⚠️ *FIRST WARNING*\n\n@${user} - Link detected!\nViolations: ${newViolations}/3\nPlease stop sharing links in this group.`;
      }

      await conn.sendMessage(groupId, {
        text: warningMsg,
        mentions: [sender]
      });

      // Kick user after 3 violations
      if (shouldKick) {
        try {
          await conn.groupParticipantsUpdate(groupId, [sender], "remove");
          // Reset violation count after kicking
          violationCounts.delete(userKey);
        } catch (kickError) {
          console.error("Failed to kick user:", kickError);
          await conn.sendMessage(groupId, {
            text: `❌ Failed to remove @${user}. Bot may need admin permissions.`,
            mentions: [sender]
          });
        }
      }

      return true; // Link detected and handled
    }
  } catch (error) {
    console.error("Antilink error:", error);
  }
  return false;
};

// Function to reset violations (for admin commands)
const resetViolations = (groupId, userId = null) => {
  if (userId) {
    // Reset specific user
    const userKey = `${groupId}_${userId}`;
    violationCounts.delete(userKey);
  } else {
    // Reset all users in group
    for (const [key] of violationCounts) {
      if (key.startsWith(groupId)) {
        violationCounts.delete(key);
      }
    }
  }
};

// Function to get violation count
const getViolationCount = (groupId, userId) => {
  const userKey = `${groupId}_${userId}`;
  return violationCounts.get(userKey) || 0;
};

module.exports = async (conn, update, m) => {
  try {
    // === ANTILINK HANDLING ===
    if (m && m.key && isJidGroup(m.key.remoteJid)) {
      await antiLinkHandler(conn, m, m.key.remoteJid);
    }

    // === GROUP EVENTS HANDLING ===
    const { id, participants, action } = update || {};
    if (!id || !isJidGroup(id) || !participants) return;

    const groupMetadata = await conn.groupMetadata(id);
    const groupName = groupMetadata.subject || "Group";
    const desc = groupMetadata.desc || "No Description available.";
    const groupMembersCount = groupMetadata.participants?.length || 0;
    const timestamp = new Date().toLocaleString();

    for (const participant of participants) {
      const userName = participant.split("@")[0];

      // Try to fetch profile picture
      let userPpUrl;
      try {
        userPpUrl = await conn.profilePictureUrl(participant, "image");
      } catch {
        userPpUrl = defaultProfilePics[Math.floor(Math.random() * defaultProfilePics.length)];
      }

      // === STYLIZED WELCOME ===
      if (action === "add") {
        const welcomeText = `
╭───┤🥷𝚆𝙴𝙻𝙲𝙾𝙼𝙴 𝙷𝙾𝙼𝙴🧚‍♂️├────
│ 
│ 👋 𝙷𝙴𝚈 @${userName}!
│ 🏠 𝚆𝙴𝙻𝙲𝙾𝙼𝙴 𝚃𝙾: ${groupName}
│ 🔢 𝙼𝙴𝙼𝙱𝙴𝚁 #: ${groupMembersCount}
│ 🕒 𝙹𝙾𝙸𝙽𝙴𝙳: ${timestamp}
│ 
│ 📝 𝙶𝚁𝙾𝚄𝙿 𝙳𝙴𝚂𝙲𝚁𝚁𝙸𝙿𝚃𝙸𝙾𝙽:
│ ${desc}
│ 
│ 🥷 ʙᴏᴛ ᴄʜᴀɴɴᴇʟ ꜰᴏʟʟᴏᴡ:
https://whatsapp.com/channel/0029VbC2V7k3QxS4uRS8cB1P
│ 🧚‍♂️ ʙᴏᴛ ɢʀᴏᴜᴘ ᴊᴏɪɴ:
https://chat.whatsapp.com/LcOBCsUP0wl8xSDnngXzjp?mode=wwt
│
│      © 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🥷𝚂𝙰𝙽𝙽𝚄 𝙼𝙳 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃
╰─────────────-─────
        `.trim();

        await conn.sendMessage(id, {
          image: { url: userPpUrl },
          caption: welcomeText,
          mentions: [participant],
          contextInfo: getContextInfo([participant]),
        });
      }

      // === STYLIZED GOODBYE ===
      else if (action === "remove") {
        const goodbyeText = `
╭─────┤👋𝙶𝙾𝙾𝙳𝙱𝚈𝙴├──────
│ 
│ 👋 𝙵𝙰𝚁𝙴𝚆𝙴𝙻𝙻 @${userName}!
│ 🏠 𝚈𝙾𝚄 𝙻𝙴𝙵𝚃: ${groupName}
│ 🕒 𝚃𝙸𝙼𝙴: ${timestamp}
│ 
│ 🌟 𝐖𝙴 𝙻𝙻 𝐌𝙸𝚂𝚂 𝐘𝙾𝚄 👋
│
│ 🥷 ʙᴏᴛ ᴄʜᴀɴɴᴇʟ ꜰᴏʟʟᴏᴡ:
https://whatsapp.com/channel/0029VbC2V7k3QxS4uRS8cB1P
│ 🧚‍♂️ ʙᴏᴛ ɢʀᴏᴜᴘ ᴊᴏɪɴ:
https://chat.whatsapp.com/LcOBCsUP0wl8xSDnngXzjp?mode=wwt
│
│      © 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🥷𝚂𝙰𝙽𝙽𝚄 𝙼𝙳 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃
╰─────────────-─────
        `.trim();

        await conn.sendMessage(id, {
          image: { url: userPpUrl },
          caption: goodbyeText,
          mentions: [participant],
          contextInfo: getContextInfo([participant]),
        });
      }
    }
  } catch (err) {
    console.error("GroupEvents error:", err);
  }
};

// Export functions for external use
module.exports.antiLinkHandler = antiLinkHandler;
module.exports.resetViolations = resetViolations;
module.exports.getViolationCount = getViolationCount;
module.exports.violationCounts = violationCounts;
